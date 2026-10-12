const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..", "optimus-capture");
const source = fs.readFileSync(path.join(root, "content/launcher.js"), "utf8");
const workerSource = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
const detector = require(path.join(root, "core/marketplace-detector.js"));
const policy = require(path.join(root, "core/launcher-policy.js"));
const mlRealUrl = "https://www.mercadolivre.com.br/conjunto-moletom-calca-unissex-paris-canguru-casaco-frio/up/MLBU3862120597";
const urls = [
  mlRealUrl,
  "https://www.amazon.com.br/dp/B0G2T13LT6",
  "https://shopee.com.br/product/123456/987654",
  "https://pt.aliexpress.com/item/1005007871648778.html",
  "https://www.kabum.com.br/produto/123456/produto",
  "https://www.magazineluiza.com.br/produto/p/123456/"
];
const nonProductUrls = [
  "https://www.mercadolivre.com.br/", "https://www.mercadolivre.com.br/ofertas",
  "https://lista.mercadolivre.com.br/moletom", "https://www.amazon.com.br/",
  "https://shopee.com.br/search?keyword=moletom", "https://pt.aliexpress.com/",
  "https://www.kabum.com.br/busca/teclado", "https://www.magazineluiza.com.br/"
];
// UI may use host predicates; any commercial/product detection is a regression.
const visibilityDetector = { ...detector, detectarMarketplacePorUrl() { throw new Error("product gating forbidden"); } };
const launcherPolicy = { contextForUrl: (value) => policy.contextForUrl(value, visibilityDetector) };

function environment(url = urls[0], { width = 1440, height = 900, blockers = [] } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const messages = [];
  const observers = [];
  const logs = [];
  let timerId = 0;
  let hitTests = 0;
  let scans = 0;
  class Node {
    constructor(tag) {
      this.tag = tag; this.children = []; this.listeners = {};
      this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    }
    get isConnected() { return this === document.documentElement || Boolean(this.parentElement?.isConnected); }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
      this.parentElement = null;
    }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    attachShadow(options) { this.shadowOptions = options; this.shadow = new Node("shadow"); return this.shadow; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { assert(!this.listeners[name], "no duplicate node listener"); this.listeners[name] = callback; }
  }
  const document = {
    documentElement: new Node("html"), body: new Node("body"),
    createElement: (tag) => new Node(tag),
    getElementById: (id) => document.documentElement.children.find((node) => node.id === id),
    querySelectorAll() { scans++; throw new Error("global scan forbidden"); },
    elementsFromPoint(x, y) {
      hitTests++;
      return blockers.filter((node) => {
        const rect = node.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });
    }
  };
  const context = {
    document, location: new URL(url), innerWidth: width, innerHeight: height,
    OptimusCaptureDetector: detector,
    OptimusLauncherPolicy: launcherPolicy,
    console: { info: (message) => logs.push(message) },
    chrome: { runtime: {
      getURL: (resource) => `chrome-extension://fixture/${resource}`,
      sendMessage: (message) => { messages.push(message); return Promise.resolve({ ok: true }); }
    } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
    },
    getComputedStyle: (node) => ({ position: node.position || "static" }),
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { throw new Error("idle polling forbidden"); },
    addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
    navigation: { addEventListener(name, callback) { listeners.set(`navigation:${name}`, [callback]); } }
  };
  context.top = context;
  vm.createContext(context);
  const inject = () => vm.runInContext(source, context);
  const flush = () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach((task) => task()); };
  const host = () => document.getElementById("optimus-capture-launcher-v1");
  const button = () => host().shadow.children.find((node) => node.tag === "button");
  return { context, document, listeners, timers, observers, messages, logs, inject, flush, host, button,
    stats: () => ({ hitTests, scans }) };
}

function obstacle(rect, position = "fixed", tag = "div") {
  return { position, matches: () => tag === "button", getBoundingClientRect: () => ({
    ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top
  }) };
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
  assert.deepStrictEqual(manifest.permissions, ["activeTab", "sidePanel", "storage", "alarms"]);
  assert(manifest.content_scripts[0].js.includes("content/launcher.js"));
  assert(manifest.content_scripts[0].js.indexOf("core/launcher-policy.js") < manifest.content_scripts[0].js.indexOf("content/launcher.js"));
  assert.deepStrictEqual(manifest.web_accessible_resources[0].resources, ["assets/icon-32.png"]);
  assert.deepStrictEqual(manifest.web_accessible_resources[0].matches, manifest.content_scripts[0].matches);
  for (const url of urls) {
    const env = environment(url); env.inject();
    assert.strictEqual(env.host().style.display, "block", url);
    assert.strictEqual(env.host().shadowOptions.mode, "open");
    assert.strictEqual(env.context.__optimusCaptureLauncherV1.modeActions.openSelectionMode, null);
    env.button().listeners.click({ isTrusted: false });
    assert.strictEqual(env.messages.length, 0, "synthetic click cannot open panel");
    env.button().listeners.click({ isTrusted: true });
    assert.strictEqual(env.messages.length, 1, "sendMessage runs synchronously within click");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(env.messages[0])), { type: "OPTIMUS_OPEN_CURRENT_PRODUCT" });
    await new Promise(setImmediate);
    assert.strictEqual(env.button().disabled, false);
    const initialHost = env.host();
    for (let i = 0; i < 8; i++) env.inject();
    assert.strictEqual(env.host(), initialHost);
    assert.strictEqual(env.observers.length, 1);
    assert.strictEqual(env.timers.size, 0, "no idle timer");
    assert.strictEqual(env.listeners.get("scroll").length, 1);
    env.context.location = new URL(`${url}?variant=next`);
    env.listeners.get("navigation:currententrychange")[0](); env.flush();
    assert.strictEqual(env.host(), initialHost, "SPA keeps one launcher");
    env.context.location = new URL(new URL(url).origin);
    env.listeners.get("navigation:currententrychange")[0](); env.flush();
    assert.strictEqual(env.host(), initialHost, "home remains homologated without product context");
    env.context.location = new URL("https://google.com");
    env.listeners.get("navigation:currententrychange")[0](); env.flush();
    assert.strictEqual(env.host(), undefined, "foreign domain removes launcher");
    env.context.location = new URL(url); env.listeners.get("popstate")[0](); env.flush();
    assert(env.host(), "back to product restores launcher");
    assert.strictEqual(env.observers.length, 1);
    assert.strictEqual(env.stats().scans, 0);
    const afterRefresh = environment(url); afterRefresh.inject(); assert(afterRefresh.host());
  }
  for (const url of nonProductUrls) {
    assert.strictEqual(detector.detectarMarketplacePorUrl(url).suportado, false, "old product rule rejects this fixture");
    const env = environment(url); env.inject();
    assert.strictEqual(env.host().style.display, "block", `domain-only: ${url}`);
    assert.strictEqual(env.timers.size, 0);
    env.button().listeners.click({ isTrusted: true });
    assert.strictEqual(env.messages.length, 1, "home/search opens panel, not product capture in launcher");
  }
  const shopeePosition = environment(urls[2]); shopeePosition.inject();
  assert.strictEqual(shopeePosition.host().style.bottom, "120px", "Shopee launcher stays clear of chat");
  const mlPosition = environment(urls[0]); mlPosition.inject();
  assert.strictEqual(mlPosition.host().style.bottom, "16px", "other marketplaces keep baseline position");
  assert.strictEqual(detector.detectarMarketplacePorUrl(mlRealUrl).suportado, true,
    "old product gate alone does NOT explain the reported MLBU incident");
  for (const panelState of ["closed", "never-opened"]) {
    const env = environment(mlRealUrl);
    env.context.chrome.sidePanel = { state: panelState };
    env.context.OptimusCaptureAuth = { restaurarSessao() { throw new Error("login cannot gate visibility"); } };
    env.context.OptimusCaptureRegistry = { capturarPaginaAtual() { throw new Error("capture cannot gate visibility"); } };
    env.inject();
    assert.strictEqual(env.host().style.display, "block", `panel=${panelState}, no login/capture`);
    assert.strictEqual(env.messages.length, 0, "rendering never requests panel/capture");
  }
  for (const url of [mlRealUrl, nonProductUrls[0], nonProductUrls[2]]) {
    const parsed = new URL(url);
    assert(parsed.protocol === "https:" && (parsed.hostname === "mercadolivre.com.br" || parsed.hostname.endsWith(".mercadolivre.com.br")));
    assert(manifest.content_scripts[0].matches.includes("https://*.mercadolivre.com.br/*"));
    assert(policy.contextForUrl(url, visibilityDetector).homologated);
  }
  for (const url of ["https://google.com", "https://mail.google.com/mail", "https://example.org",
    "https://mercadolivre.com.br.evil.test/up/MLBU123", "http://www.kabum.com.br/produto/123456/x"]) {
    const env = environment(url); env.inject(); assert.strictEqual(env.host(), undefined, url);
  }
  const frame = environment(); frame.context.top = {}; frame.inject(); assert(!frame.host());
  const env = environment(); env.inject();
  const before = env.stats().hitTests;
  for (let i = 0; i < 20; i++) env.observers[0].callback([{ target: env.document.body }]);
  assert.strictEqual(env.timers.size, 1, "mutation burst debounced");
  env.flush(); assert.strictEqual(env.timers.size, 0);
  assert(env.stats().hitTests - before <= 72, "bounded point probes");
  env.host().remove(); env.observers[0].callback([{ target: env.document.documentElement }]); env.flush();
  assert(env.host(), "SPA root replacement recovers single launcher");
  for (const width of [1440, 360]) {
    const fixtures = [
      obstacle({ left: width - 220, right: width, top: 740, bottom: 900 }),
      obstacle({ left: 0, right: width, top: 820, bottom: 900 }, "sticky"),
      obstacle({ left: width - 220, right: width, top: 830, bottom: 900 }, "static", "button")
    ];
    for (const blocker of fixtures) {
      const positioned = environment(urls[0], { width, blockers: [blocker] }); positioned.inject();
      assert.strictEqual(positioned.host().style.display, "block");
      const bottom = 900 - parseFloat(positioned.host().style.bottom);
      assert(bottom <= blocker.getBoundingClientRect().top - 10, "launcher lifted above critical control");
    }
  }
  const covered = environment(urls[0], { blockers: [obstacle({ left: 0, right: 1440, top: 0, bottom: 900 })] });
  covered.inject(); assert.strictEqual(covered.host().style.display, "none", "full consent/dialog must not be covered");

  let onMessage; const calls = [];
  const worker = {
    importScripts() {}, OptimusCaptureDetector: detector, OptimusLauncherPolicy: launcherPolicy,
    chrome: { runtime: { id: "fixture", onMessage: { addListener: (handler) => { onMessage = handler; } },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    sidePanel: { open(options) { calls.push(options); return Promise.resolve(); } } }
  };
  vm.runInNewContext(workerSource, worker);
  const sender = { id: "fixture", frameId: 0, tab: { id: 7, windowId: 11 }, url: urls[0] };
  let response;
  assert.strictEqual(onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, sender, (r) => { response = r; }), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [{ tabId: 7 }]);
  await new Promise(setImmediate); assert.strictEqual(response.ok, true);
  for (const invalid of [{ ...sender, frameId: 1 }, { ...sender, id: "foreign" },
    { ...sender, url: "https://google.com" }, { ...sender, tab: {} }]) {
    onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, invalid, (r) => { response = r; });
    assert.strictEqual(response.ok, false);
  }
  onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT", product: {} }, sender, (r) => { response = r; });
  assert.strictEqual(response.ok, false); assert.strictEqual(calls.length, 1);
  for (const [index, url] of urls.entries()) {
    const marketplaceSender = { ...sender, tab: { id: 20 + index, windowId: 11 }, url };
    assert.strictEqual(onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, marketplaceSender, (r) => { response = r; }), true);
    await new Promise(setImmediate); assert.strictEqual(response.ok, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.at(-1))), { tabId: 20 + index });
  }
  for (const url of nonProductUrls) {
    assert.strictEqual(onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, { ...sender, url }, (r) => { response = r; }), true);
    await new Promise(setImmediate); assert.strictEqual(response.ok, true);
  }
  const beforeReopen = calls.length;
  onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, sender, (r) => { response = r; });
  await new Promise(setImmediate); assert.strictEqual(response.ok, true);
  assert.strictEqual(calls.length, beforeReopen + 1, "click reopens a panel closed with X");
  const newTab = { ...sender, tab: { id: 99, windowId: 11 }, url: urls[2] };
  onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, newTab, (r) => { response = r; });
  await new Promise(setImmediate); assert.strictEqual(response.ok, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.at(-1))), { tabId: 99 });
  worker.chrome.sidePanel.open = () => Promise.reject(new Error("gesture expired"));
  onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, sender, (r) => { response = r; });
  await new Promise(setImmediate); assert.strictEqual(response.ok, false);
  assert.strictEqual(onMessage({ type: "OTHER" }, sender, () => {}), false);
  delete worker.chrome.sidePanel.open;
  onMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" }, sender, (r) => { response = r; });
  assert.strictEqual(response.motivo, "side_panel_requer_chrome_116");
  console.log("optimus-capture-launcher.test.js PASS — 6 marketplaces, gesture routing, SPA, singleton, bounded layout, no payload/polling");
})().catch((error) => { console.error(error); process.exitCode = 1; });
