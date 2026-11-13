"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolver } = require("../optimus-capture/local-worker/mercadolivre-identity.js");

const catalogoReal = "MLB22147432";
const anuncioReal = "MLB4772233032";
// Same technical selector as the audited occurrence, with a sanitized slug.
const urlCaso = "https://www.mercadolivre.com.br/carretilha-fixture/p/MLB22147432?pdp_filters=item_id%3AMLB4772233032";
const catalogId = "MLB12345001";
const listingId = "MLB9876500001";
const outroAnuncio = "MLB9876500002";
const origem = "https://www.mercadolivre.com.br";
const url = origem + "/fixture/p/" + catalogId + "?pdp_filters=item_id%3A" + listingId;
const urlOutro = url.replace(listingId, outroAnuncio);
const titulo = "Carretilha Sintetica Modelo X";
const produto = { "@type": "Product", itemId: listingId, catalogProductId: catalogId, variationId: "12345", name: titulo };

function html(registro = produto, canonica = url) {
  return '<link rel="canonical" href="' + canonica + '">' +
    '<script type="application/ld+json">' + JSON.stringify(registro) + "</script>";
}

function mock(t, response = {}) {
  const fetch = t.mock.method(globalThis, "fetch", async (requestUrl, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, url: requestUrl, redirected: false, text: async () => html(), ...response };
  });
  return fetch.mock;
}

test("entrada 262813 chega uma vez à consulta, sem afirmar prova histórica", async t => {
  const fetch = mock(t, { ok: false, status: 403, text: async () => "" });
  await assert.rejects(resolver({ productId: anuncioReal, sourceUrl: urlCaso }), /ml_identity_http_403/);
  assert.equal(fetch.callCount(), 1);
  assert.equal(fetch.calls[0].arguments[0], urlCaso);
  assert.equal(new URL(urlCaso).pathname.split("/").at(-1), catalogoReal);
});

test("prova sintética do mesmo objeto com anúncio, catálogo e variante", async t => {
  const fetch = mock(t);
  const result = await resolver({ productId: listingId, sourceUrl: url, variationId: "12345" });
  assert.equal(fetch.callCount(), 1);
  assert.equal(result.identidadeValidada, true);
  assert.equal(result.tituloOficial, titulo);
  assert.equal(result.origemTitulo, "jsonld.name");
  assert.equal(result.finalUrl, url);
  assert.equal(result.provaTecnica.listingId, listingId);
  assert.equal(result.provaTecnica.catalogId, catalogId);
  assert.equal(result.provaTecnica.variationId, "12345");
  assert.equal(result.imagemOficial, "");
});

test("URL de catálogo sem seleção, seletores ambíguos, tracking e host inválido falham antes da consulta", async t => {
  const fetch = mock(t);
  const entradas = [
    [url.split("?")[0], catalogId],
    [url, catalogId],
    [url.replace(listingId, catalogId), catalogId],
    [url + "&pdp_filters=item_id%3A" + listingId, listingId],
    [url + "&item_id=" + outroAnuncio, listingId],
    [url + "&utm_source=fixture", listingId],
    [url + "&", listingId],
    [url + "#fixture", listingId],
    [url.replace("item_id%3A", "item_id%3A" + outroAnuncio + "%2C"), listingId],
    [url.replace("/p/", "/%70/"), listingId],
    [url.replace("www.mercadolivre.com.br", "www.mercadolivre.com.br.example.invalid"), listingId],
    [url.replace("www.", "sub."), listingId],
    [url.replace("www.", "fixture@www."), listingId],
    [url.replace(".br/", ".br:444/"), listingId],
    [url.replace("https:", "http:"), listingId]
  ];
  for (const [sourceUrl, productId] of entradas) {
    await assert.rejects(resolver({ productId, sourceUrl }), /ml_identity_(?:catalogo_url|entrada)_invalida/);
  }
  assert.equal(fetch.callCount(), 0);
});

test("redirecionamento ou URL final trocada não produz prova", async t => {
  for (const [final, redirected] of [[urlOutro, false], [url, true], ["https://example.invalid/", false], ["", false]]) {
    await t.test(final || "URL final ausente", async sub => {
      mock(sub, { url: final, redirected });
      await assert.rejects(resolver({ productId: listingId, sourceUrl: url }), /ml_identity_redirect_produto_divergente/);
    });
  }
});

test("resposta sem vínculo, com IDs contraditórios ou título inadequado não confirma identidade", async t => {
  const casos = [
    ["catálogo sozinho", { "@type": "Product", productID: catalogId, name: titulo }, /sem_prova_anuncio/],
    ["anúncio diferente", { ...produto, itemId: outroAnuncio }, /sem_prova_anuncio/],
    ["catálogo ausente", { ...produto, catalogProductId: undefined }, /vinculo_divergente/],
    ["catálogo diferente", { ...produto, catalogProductId: "MLB12345002" }, /vinculo_divergente/],
    ["ID contraditório", { ...produto, item_id: outroAnuncio }, /vinculo_divergente/],
    ["URL de outro anúncio", { ...produto, url: urlOutro }, /vinculo_divergente/],
    ["variante diferente", { ...produto, variationId: "54321" }, /variacao_conflitante/],
    ["variante só no SKU", { ...produto, variationId: undefined, offers: { sku: "12345" } }, /variacao_conflitante/],
    ["variante contraditória", { ...produto, variantId: "54321" }, /variacao_conflitante/],
    ["título ausente", { ...produto, name: undefined }, /sem_titulo_oficial/],
    ["título promocional", { ...produto, name: "Confira agora esta promoção" }, /sem_titulo_oficial/]
  ];
  for (const [nome, registro, erro] of casos) {
    await t.test(nome, async sub => {
      mock(sub, { text: async () => html(registro) });
      await assert.rejects(resolver({ productId: listingId, sourceUrl: url, variationId: "12345" }), erro);
    });
  }
});

test("duas ocorrências do mesmo catálogo não compartilham a prova do primeiro anúncio", async t => {
  const fetch = mock(t, { text: async () => html(produto, url) });
  await resolver({ productId: listingId, sourceUrl: url });
  await assert.rejects(resolver({ productId: outroAnuncio, sourceUrl: urlOutro }), /canonical_divergente/);
  assert.deepEqual(fetch.calls.map(call => call.arguments[0]), [url, urlOutro]);
});
