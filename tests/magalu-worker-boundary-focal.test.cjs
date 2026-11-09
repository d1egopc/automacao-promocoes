"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const resolver = require("../optimus-capture/local-worker/magalu-identity.js");
const { chaveIdentidadeMagalu, validarResultadoMagaluIdentity } = require("../modules/local-worker/magalu-identity.contract");

const sourceUrl = "https://magazineluiza.onelink.me/589508454/focal123";
const finalUrl = "https://www.magazineluiza.com.br/produto-focal/p/242057800/te/teste/";
const product = {
  produtoId: "242057800",
  sku: "242057800",
  titulo: "Produto Magalu de teste",
  imagem: "https://a-static.mlcdn.com.br/470x352/produto-focal.jpg",
  urlOriginal: finalUrl
};

function setup({ missingAlways = false, error = "", pageUrl = finalUrl, productOverride = {}, captures = null } = {}) {
  const calls = [];
  const removed = [];
  const delays = [];
  const tabs = {
    create: async () => ({ id: 71, status: "complete", url: pageUrl }),
    get: async () => ({ id: 71, status: "complete", url: pageUrl }),
    sendMessage: async (_id, message, options) => {
      calls.push({ message, options });
      if (error) throw new Error(error);
      if (missingAlways || calls.length === 1) {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }
      const change = captures ? captures[Math.min(calls.length - 2, captures.length - 1)] : productOverride;
      return { ok: true, produto: { ...product, ...change } };
    },
    remove: async id => removed.push(id),
    onUpdated: { addListener() {}, removeListener() {} }
  };
  const original = {
    chrome: global.chrome,
    fetch: global.fetch,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout
  };
  global.chrome = { tabs };
  global.fetch = async () => ({ ok: false, status: 403, redirected: true, url: finalUrl, body: { cancel: async () => {} } });
  global.setTimeout = (fn, ms) => {
    if (ms < 1000) { delays.push(ms); return original.setTimeout(fn, 0); }
    return original.setTimeout(fn, ms);
  };
  const restore = () => {
    global.chrome = original.chrome;
    global.fetch = original.fetch;
    global.setTimeout = original.setTimeout;
    global.clearTimeout = original.clearTimeout;
  };
  return { calls, removed, delays, restore };
}

async function resolverAtual() {
  return resolver.resolver({ sourceUrl, identityKey: chaveIdentidadeMagalu(sourceUrl) });
}

test("late document_idle receiver retries in the same tab and validates identity", async () => {
  const fixture = setup();
  try {
    const result = await resolverAtual();
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.calls[1].options, { frameId: 0 });
    assert.deepEqual(fixture.removed, [71]);
    assert.equal(validarResultadoMagaluIdentity(result, { sourceUrl, identityKey: chaveIdentidadeMagalu(sourceUrl) }).identidadeValidada, true);
  } finally { fixture.restore(); }
});

test("late official title is read again from the same product tab after HTTP 403", async () => {
  const fixture = setup({ captures: [{ titulo: "" }, { titulo: product.titulo }] });
  try {
    const result = await resolverAtual();
    assert.equal(result.observedProductId, product.produtoId);
    assert.equal(fixture.calls.length, 3, "receiver retry, incomplete title, then official title");
    assert.deepEqual(fixture.removed, [71]);
  } finally { fixture.restore(); }
});

test("late title cannot validate a different product", async () => {
  const fixture = setup({ captures: [{ titulo: "" }, { titulo: product.titulo, produtoId: "999999999" }] });
  try {
    await assert.rejects(resolverAtual(), /magalu_identity_produto_id_divergente/);
    assert.deepEqual(fixture.removed, [71]);
  } finally { fixture.restore(); }
});

test("permanent receiver absence is bounded and returns a stable reason", async () => {
  const fixture = setup({ missingAlways: true });
  try {
    await assert.rejects(resolverAtual(), /magalu_identity_content_script_ausente/);
    assert.equal(fixture.calls.length, 3);
    assert.deepEqual(fixture.removed, [71]);
    assert.ok(fixture.delays.reduce((total, value) => total + value, 0) <= 500);
  } finally { fixture.restore(); }
});

test("unrelated receiver errors are not retried", async () => {
  const fixture = setup({ error: "Port closed for another reason" });
  try {
    await assert.rejects(resolverAtual(), /Port closed for another reason/);
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.removed, [71]);
  } finally { fixture.restore(); }
});

for (const caso of [
  { name: "final URL without product", options: { pageUrl: "https://www.magazineluiza.com.br/" }, reason: "magalu_identity_url_final_nao_produto" },
  { name: "product ID mismatch", options: { productOverride: { produtoId: "999999999" } }, reason: "magalu_identity_produto_id_divergente" },
  { name: "unofficial image", options: { productOverride: { imagem: "https://example.test/image.jpg" } }, reason: "magalu_identity_imagem_nao_oficial" }
]) {
  test(`identity failure has a fixed sanitized reason: ${caso.name}`, async () => {
    const fixture = setup(caso.options);
    try {
      await assert.rejects(resolverAtual(), new RegExp(caso.reason));
      assert.deepEqual(fixture.removed, [71]);
    } finally { fixture.restore(); }
  });
}
