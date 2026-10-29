"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { resolverHttpGenerico, resolverRedirectUniversal } = require("../modules/radar/redirect/redirect-resolver");
const { evidenciaProdutoHtml, identidadeUrlProduto } = require("../modules/radar/redirect/redirect-product-evidence");

const product = "https://www.amazon.com.br/dp/B012345678";
function htmlProduct(url = product, extra = {}) {
  return `<link rel="canonical" href="${url}"><h1>Furadeira de impacto profissional</h1><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Furadeira de impacto profissional", url, ...extra
  })}</script>`;
}
function fixture(map = new Map()) {
  const calls = [];
  const safeHttpDeps = {
    lookup: async host => [{ address: host.startsWith("private.") ? "10.0.0.1" : "8.8.8.8", family: 4 }],
    requestImpl(url, _options, callback) {
      const req = new EventEmitter();
      req.destroy = () => { req.destroyed = true; };
      req.end = () => queueMicrotask(() => {
        if (req.destroyed) return;
        calls.push(url.href);
        const value = map.get(url.href) || { status: 200, body: "" };
        if (value.error) { req.emit("error", new Error(value.error)); return; }
        const res = new EventEmitter();
        res.statusCode = value.status; res.headers = { location: value.location || "" }; res.complete = true;
        res.destroy = () => { res.destroyed = true; };
        callback(res); res.emit("data", Buffer.from(value.body || "")); if (!res.destroyed) res.emit("end");
      });
      return req;
    }
  };
  const options = { adminValidation: true, resolucaoEmCamadas: true, secureDynamic: true,
    descobertaContextual: true, timeout: 4500, maxRedirects: 5, safeHttpDeps };
  return { calls, map, options, run: url => resolverRedirectUniversal(url, options) };
}

test("existing HTTP/static layers continue beyond an official intermediate and bind factual identity", async () => {
  const f = fixture(new Map([
    ["https://external.example.com/s/first", { status: 200, body: '<meta http-equiv="refresh" content="0;url=https://amzlink.to/example">' }],
    ["https://amzlink.to/example", { status: 302, location: product }],
    [product, { status: 200, body: htmlProduct() }]
  ]));
  const before = await resolverHttpGenerico("https://external.example.com/s/first", { ...f.options, resolucaoEmCamadas: false });
  assert.equal(before.urlExpandida, "https://amzlink.to/example");
  assert.equal(before.produtoConfirmado, undefined);
  f.calls.length = 0;
  const after = await f.run("https://external.example.com/s/first");
  assert.equal(after.urlExpandida, product); assert.equal(after.produtoConfirmado, true);
  assert.equal(after.afiliacaoConfirmada, false); assert.equal(after.prontoComercial, false);
  assert.equal(f.calls.length, 3);
});

test("HTTP 200, product-shaped URL, challenge, generic title and ambiguous products do not prove identity", async () => {
  for (const body of ["", "<title>Robot Check</title>" + htmlProduct(),
    htmlProduct(product, { name: "Vendido por marketplaces" }),
    htmlProduct() + `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Outro produto", url: "https://www.amazon.com.br/dp/B012345679" })}</script>`,
    htmlProduct(product, { url: "https://www.amazon.com.br/dp/B012345679" }),
    htmlProduct().replace('rel="canonical" href="' + product, 'rel="canonical" href="https://www.amazon.com.br/dp/B012345679')]) {
    assert.equal(evidenciaProdutoHtml(body, product).confirmada, false);
    const f = fixture(new Map([[product, { status: 200, body }]]));
    assert.notEqual((await f.run(product)).produtoConfirmado, true);
  }
});

test("proofs reject spoofed marketplace hosts, contradictory offers and unrelated URLs", () => {
  assert.equal(identidadeUrlProduto("https://amazon.com.br.evil.example/dp/B012345678"), "");
  assert.equal(identidadeUrlProduto("https://evilaliexpress.com/item/1005001234567.html"), "");
  assert.equal(identidadeUrlProduto("https://evil-kabum.com.br/produto/123456"), "");
  assert.equal(evidenciaProdutoHtml(htmlProduct(product, { offers: { url: "https://www.amazon.com.br/dp/B012345679" } }), product).confirmada, false);
  assert.equal(evidenciaProdutoHtml(htmlProduct(product, { url: "https://unrelated.example/product/123" }), product).confirmada, false);
});

test("Amazon primary product reuses factual-title/ASIN contracts and rejects mismatches and CAPTCHA", () => {
  const dom = `<link rel="canonical" href="${product}"><span id="productTitle">Furadeira de impacto profissional</span><input id="ASIN" name="ASIN" value="B012345678">`;
  assert.equal(evidenciaProdutoHtml(dom, product).confirmada, true);
  for (const body of [dom.replace('value="B012345678"', 'value="B012345679"'),
    dom.replace('rel="canonical"', 'rel="alternate"'), dom + '<input name="ASIN" value="B012345679">',
    dom + '<form action="/errors/validateCaptcha"></form>',
    dom.replace("Furadeira de impacto profissional", "Produto Amazon"),
    dom + '<span id="productTitle">Outro produto</span>',
    dom + htmlProduct("https://www.amazon.com.br/dp/B012345679")]) {
    assert.equal(evidenciaProdutoHtml(body, product).confirmada, false);
  }
});

test("existing strict Mercado Livre featured identity resolves a social landing; CTA alone never proves product", async () => {
  const original = "https://meli.la/example", social = "https://www.mercadolivre.com.br/social/example";
  const card = { id: "card-featured", recommendation_data: { recommendation_info: { polycards: [{ metadata: {
    id: "MLB7777777777", product_id: "MLB33333333", wid: "MLB7777777777", pid_extended: "MLBP33333333_MLB7777777777",
    url: "www.mercadolivre.com.br/produto-seguro/p/MLB33333333", url_params: "?matt_event_ts=123", url_fragments: ""
  } }] } } };
  const body = `<script>${JSON.stringify({ cards: [card] })}</script>`;
  const f = fixture(new Map([[original, { status: 301, location: social }], [social, { status: 200, body }]]));
  const result = await f.run(original);
  assert.equal(result.produtoConfirmado, true); assert.match(result.urlExpandida, /\/p\/MLB33333333/);
  assert.equal(result.afiliacaoConfirmada, false);
  const onlyCta = `<script>${JSON.stringify({ cards: [{ id: "card-featured", action_links: [{ id: "show_product", type: "link", url: "https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM" }] }] })}</script>`;
  assert.equal(evidenciaProdutoHtml(onlyCta, social).confirmada, false);
  const blocked = fixture(new Map([[original, { status: 301, location: social }], [social, { status: 200, body: onlyCta }],
    ["https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM", { status: 403 }]]));
  assert.equal((await blocked.run(original)).motivo, "http_status_403");
});

test("all response bodies including redirect bodies consume the total safe HTTP byte budget", async () => {
  const { obterHttpSeguro } = require("../modules/radar/redirect/safe-redirect-http");
  const f = fixture(new Map([["https://external.example.com/first", { status: 302, location: product, body: "12345" }],
    [product, { status: 200, body: "678901" }]]));
  await assert.rejects(obterHttpSeguro("https://external.example.com/first", { ...f.options.safeHttpDeps,
    maxBytes: 10, maxTotalBytes: 10 }), /REDIRECT_BODY_LIMIT/);
  for (const invalid of [NaN, -1, Infinity, 0]) await assert.rejects(obterHttpSeguro(product, {
    ...f.options.safeHttpDeps, maxBytes: 10, maxBytesForUrl: () => invalid }), /REDIRECT_BODY_LIMIT/);
});

test("existing public Promozone contract is called only at its fixed endpoint, then verifies the destination", async () => {
  const original = "https://go.promozone.ai/Abc123";
  const api = "https://link-shortener-501307668672.southamerica-east1.run.app/resolve/Abc123";
  const f = fixture(new Map([[api, { status: 200, body: JSON.stringify({ destinationUrl: product }) }], [product, { status: 200, body: htmlProduct() }]]));
  const result = await f.run(original);
  assert.equal(result.produtoConfirmado, true); assert.equal(result.metodo, "promozone_api");
  assert.deepEqual(f.calls, [api, product]);
  const other = fixture(); await other.run("https://promozone.ai.evil.example/Abc123");
  assert.ok(!other.calls.some(url => url.includes("run.app")));
});

test("provider response, parameter hints and static HTML cannot bypass SSRF or authentication errors", async () => {
  const f = fixture(new Map([
    ["https://external.example.com/s/private", { status: 200, body: '<meta http-equiv="refresh" content="0;url=https://private.amazon.com.br/dp/B012345678">' }],
    ["https://external.example.com/s/blocked", { status: 403, body: htmlProduct() }],
    ["https://amzlink.to/example", { status: 302, location: "http://169.254.169.254/latest" }]
  ]));
  assert.equal((await f.run("https://external.example.com/s/private")).motivo, "URL_BLOQUEADA_SEGURANCA");
  assert.equal((await f.run("https://amzlink.to/example")).motivo, "URL_BLOQUEADA_SEGURANCA");
  assert.equal((await f.run("https://external.example.com/s/blocked")).motivo, "http_status_403");
  assert.ok(!f.calls.some(url => url.includes("private.amazon.com.br") || url.includes("169.254")));
  assert.notEqual((await f.run("https://external.example.com/s/hint?url=" + encodeURIComponent(product))).produtoConfirmado, true);
});

test("redirect budget is global across HTML layers; loops and oversized bodies stay blocked", async () => {
  const map = new Map();
  map.set("https://external.example.com/s/first", { status: 200, body: '<meta http-equiv="refresh" content="0;url=https://amzlink.to/a">' });
  for (let i = 0; i < 7; i++) map.set(`https://amzlink.to/${i ? i : 'a'}`, { status: 302, location: `https://amzlink.to/${i + 1}` });
  const f = fixture(map); assert.equal((await f.run("https://external.example.com/s/first")).motivo, "REDIRECT_LIMIT");
  assert.ok(f.calls.length <= 7);
  const big = fixture(new Map([[product, { status: 200, body: "x".repeat(2 * 1024 * 1024 + 1) }]]));
  assert.equal((await big.run(product)).motivo, "REDIRECT_BODY_LIMIT");
  const unknown = fixture(new Map([["https://external.example.com/s/big", { status: 200, body: "x".repeat(1024 * 1024 + 1) }]]));
  assert.equal((await unknown.run("https://external.example.com/s/big")).motivo, "REDIRECT_BODY_LIMIT");
  const loop = fixture(new Map([[product, { status: 302, location: product }]]));
  assert.equal((await loop.run(product)).motivo, "REDIRECT_LOOP");
});

test("larger bounded documents are allowed only for an official Amazon product; legacy and spoofed hosts keep 1 MiB", async () => {
  const body = htmlProduct() + " ".repeat(1024 * 1024 + 10);
  const f = fixture(new Map([[product, { status: 200, body }]]));
  assert.equal((await f.run(product)).produtoConfirmado, true);
  assert.equal((await resolverHttpGenerico(product, { ...f.options, resolucaoEmCamadas: false })).motivo, "REDIRECT_BODY_LIMIT");
  const spoof = "https://amazon.com.br.evil.example/dp/B012345678";
  const bad = fixture(new Map([[spoof, { status: 200, body }]]));
  assert.equal((await bad.run(spoof)).motivo, "REDIRECT_BODY_LIMIT");
});

test("deadline is shared and expired work never starts a new network attempt", async () => {
  const f = fixture();
  const result = await resolverHttpGenerico(product, { ...f.options, deadlineAt: performance.now() - 1 });
  assert.equal(result.motivo, "redirect_timeout"); assert.equal(f.calls.length, 0);
});

test("OFF preserves the existing early return; literal external scripts are never executed", async () => {
  const original = "https://external.example.com/s/js";
  const f = fixture(new Map([[original, { status: 200, body: `<script>globalThis.EXTERNAL_CODE_EXECUTED=true;window.location="${product}"</script>` }], [product, { status: 200, body: htmlProduct() }]]));
  const before = await resolverHttpGenerico(original, { ...f.options, resolucaoEmCamadas: false });
  assert.equal(before.metodo, "window_location"); assert.equal(f.calls.length, 1);
  const after = await f.run(original); assert.equal(after.produtoConfirmado, true);
  assert.equal(globalThis.EXTERNAL_CODE_EXECUTED, undefined);
  const unsafe = await resolverHttpGenerico(original, { ...f.options, secureDynamic: false });
  assert.equal(unsafe.ok, false); assert.equal(unsafe.motivo, "URL_BLOQUEADA_SEGURANCA");
});
