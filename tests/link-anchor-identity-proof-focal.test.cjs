"use strict";

const assert = require("node:assert/strict");
const realCases = require("./fixtures/link-anchor-identity-real-cases.sanitized.json");
const { runAnchorTitleProvenanceFixtures } = require("./helpers/run-anchor-title-provenance-fixtures.cjs");
const {
  normalizarOfertaImportada,
  avaliarGateIdentidadeMercadoLivre
} = require("../modules/engine/importer/importer.service");

// Synthetic validator fixtures use only fixture-prefixed job/event/workspace IDs.
function syntheticProof({ marketplace, job, original, canonical, id, title, source, occurrenceId = "fixture-link-occurrence-1" }) {
  return {
    versao: 1,
    marketplace,
    jobId: String(job.id),
    eventoId: String(job.evento_id),
    workspaceId: job.cliente_id,
    ocorrenciaLink: { id: occurrenceId, ordem: 1, campo: "url_original", urlOriginal: original },
    produto: { produtoIdCanonico: id, urlCanonica: canonical },
    titulo: { valor: title, fonte: source }
  };
}

function syntheticMlCase({ mlb = "900000001", title = "Monitor Orbit de Estudos 27 Polegadas Fixture",
  radarTitle = "Oferta somente hoje", source = "jsonld.name", proofId = mlb, proofCanonical, proofJob,
  proofOccurrence = "fixture-ml-link-1", proofMissing = false, anchor, canonical, productId } = {}) {
  const job = { id: "fixture-job-ml-validator-01", evento_id: "fixture-event-ml-validator-01",
    cliente_id: "fixture-workspace-ml-validator", marketplace: "mercadolivre" };
  const urlAnchor = anchor || `https://produto.mercadolivre.com.br/MLB-${mlb}-fixture-_JM`;
  const urlCanonical = canonical || urlAnchor;
  const id = productId || `MLB${mlb}`;
  const officialProofTitle = title;
  const raw = {
    ok: true,
    marketplace: "mercadolivre",
    titulo: radarTitle,
    preco: 219.9,
    precoOriginal: 399.9,
    cupom: "RADAR20",
    linkOriginal: urlAnchor,
    linkExpandido: urlCanonical,
    linkAfiliado: `https://meli.la/fixture-${job.cliente_id}`,
    metadata: {
      adapter: "mercadolivre",
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id,
      linkOriginalEngine: urlAnchor,
      urlFinalImportador: urlCanonical,
      identidadeCanonicaMl: { status: "consistente", mlbForteConfirmado: true,
        mlbProduto: `MLB${mlb}`, mlbRevalidado: `MLB${mlb}`, urlOriginal: urlAnchor,
        urlCanonicaRevalidada: urlCanonical },
      ...(proofMissing ? {} : { provaTituloTecnico: syntheticProof({
        marketplace: "mercadolivre", job: { ...job, ...(proofJob ? { id: proofJob } : {}) },
        original: urlAnchor, canonical: proofCanonical || urlCanonical, id: `MLB${proofId}`,
        title: officialProofTitle, source, occurrenceId: proofOccurrence
      }) }),
      linksComerciais: [
        { papelLink: "produto", urlOriginal: urlAnchor, ocorrenciaId: "fixture-ml-link-1", ordemCaptura: 1 },
        { papelLink: "resgate", urlOriginal: "https://promo.example/fixture-resgate", ocorrenciaId: "fixture-ml-link-2", ordemCaptura: 2 }
      ],
      produto: { titulo: officialProofTitle, tituloFonteOficial: source, urlFinal: urlCanonical,
        produtoIdDetectado: `MLB${mlb}`, imagem: "https://http2.mlstatic.com/fixture-image.jpg" }
    }
  };
  return { job, raw, offer: normalizarOfertaImportada(raw, job) };
}

// Synthetic direct-proof checks cover validator rejection paths only. Producer propagation is tested below via real adapter/importer code.
const syntheticMl = syntheticMlCase();
assert.equal(syntheticMl.offer.titulo, "Monitor Orbit de Estudos 27 Polegadas Fixture");
assert.equal(syntheticMl.offer.metadata.provaTituloTecnicoValidada.validacao, "confirmada_pelo_importador");
assert.equal(avaliarGateIdentidadeMercadoLivre(syntheticMl.offer, syntheticMl.offer.metadata).retida, false);
assert.equal(syntheticMl.offer.preco, 219.9);
assert.equal(syntheticMl.offer.precoOriginal, 399.9);
assert.equal(syntheticMl.offer.cupom, "RADAR20");
assert.equal(syntheticMl.offer.metadata.linksComerciais.length, 2);

for (const bad of [
  { proofId: "900000099" },
  { proofJob: "fixture-job-ml-other-01" },
  { proofOccurrence: "fixture-ml-other-occurrence" },
  { source: "texto_radar" },
  { anchor: "https://produto.mercadolivre.com.br/MLB-900000099-other-_JM" },
  { proofCanonical: "https://produto.mercadolivre.com.br/MLB-900000099-other-_JM" },
  { proofMissing: true }
]) {
  const sample = syntheticMlCase(bad);
  assert.equal(sample.offer.titulo, "", "ML diverging or absent proof cannot confirm title");
  assert.equal(avaliarGateIdentidadeMercadoLivre(sample.offer, sample.offer.metadata).retida, true);
}

// Amazon real-identity regression fixture: official page title for this ASIN, but a fixture job, not the historical job.
const amazonJob = { id: "fixture-job-amazon-real-asin-01", evento_id: "fixture-event-amazon-real-asin-01",
  cliente_id: "fixture-workspace-amazon", marketplace: "amazon" };
const amazonAsin = "B07K11FVBY";
const amazonUrl = `https://www.amazon.com.br/dp/${amazonAsin}`;
const amazonTitle = "Havit Mouse Pad Grande 70 X 30 Cm Gamer, Hv-MP861, Movimento Suave e Preciso, Costurado, Preto";
function amazonValidatorFixture({ anchor = amazonUrl, canonical = amazonUrl, asin = amazonAsin,
  source = "amazon_importer", proofMissing = false } = {}) {
  const raw = {
    ok: true, marketplace: "amazon", titulo: "Grupo de ofertas Gerais",
    preco: 31.99, precoOriginal: 49.9, cupom: "RADAR10", linkOriginal: anchor, linkExpandido: canonical,
    linkAfiliado: "https://amzn.to/fixture-workspace-amazon",
    metadata: {
      adapter: "amazon", jobId: amazonJob.id, eventoId: amazonJob.evento_id,
      clienteId: amazonJob.cliente_id, linkOriginalEngine: anchor,
      diagnosticoAmazon: { tituloOrigem: source, importadorBloqueado: false, tituloGenerico: false },
      ...(!proofMissing ? { provaTituloTecnico: syntheticProof({ marketplace: "amazon", job: amazonJob,
        original: anchor, canonical, id: asin, title: amazonTitle, source, occurrenceId: "fixture-amazon-link-1" }) } : {}),
      linksComerciais: [{ papelLink: "produto", urlOriginal: anchor, ocorrenciaId: "fixture-amazon-link-1", ordemCaptura: 1 },
        { papelLink: "resgate", urlOriginal: "https://promo.example/fixture-amazon-coupon", ocorrenciaId: "fixture-amazon-link-2", ordemCaptura: 2 }],
      produto: { titulo: amazonTitle, asin, urlFinal: canonical,
        imagem: "https://m.media-amazon.com/images/I/fixture-image.jpg" }
    }
  };
  return normalizarOfertaImportada(raw, amazonJob);
}
const amazonRealAsin = amazonValidatorFixture();
assert.equal(amazonRealAsin.titulo, amazonTitle);
assert.equal(amazonRealAsin.preco, 31.99);
assert.equal(amazonRealAsin.precoOriginal, 49.9);
assert.equal(amazonRealAsin.cupom, "RADAR10");
assert.equal(amazonRealAsin.metadata.linksComerciais.length, 2);
assert.equal(amazonValidatorFixture({ canonical: "https://www.amazon.com.br/dp/B000000001" }).titulo, "");
assert.equal(amazonValidatorFixture({ source: "radar_mirror" }).titulo, "");
assert.equal(amazonValidatorFixture({ proofMissing: true }).titulo, "");

// Synthetic Shopee validator controls use fictional job/shop/item identifiers.
const shopeeJob = { id: "fixture-job-shopee-validator-01", evento_id: "fixture-event-shopee-validator-01",
  cliente_id: "fixture-workspace-shopee-validator", marketplace: "shopee" };
const shopeeAnchor = "https://shopee.com.br/product/900001/900002";
const shopeeTitle = "Cooler Aigo Darkflash DC360 Fixture";
function syntheticShopeeCase({ shopId = "900001", itemId = "900002", source = "api.productOfferV2", proofMissing = false } = {}) {
  const canonical = `https://shopee.com.br/product/${shopId}/${itemId}`;
  const raw = {
    ok: true, marketplace: "shopee", titulo: "Grupo de ofertas Gerais",
    preco: 79.9, precoOriginal: 119.9, cupom: "SHOPEE10", linkOriginal: shopeeAnchor,
    linkExpandido: canonical, linkAfiliado: "https://shope.ee/fixture-workspace-shopee",
    produtoIdDetectado: `${shopId}/${itemId}`,
    metadata: {
      adapter: "shopee", jobId: shopeeJob.id, eventoId: shopeeJob.evento_id,
      clienteId: shopeeJob.cliente_id, linkOriginalEngine: shopeeAnchor,
      ...(!proofMissing ? { provaTituloTecnico: syntheticProof({ marketplace: "shopee", job: shopeeJob,
        original: shopeeAnchor, canonical, id: `${shopId}/${itemId}`, title: shopeeTitle, source,
        occurrenceId: "fixture-shopee-link-1" }) } : {}),
      linksComerciais: [{ papelLink: "produto", urlOriginal: shopeeAnchor, ocorrenciaId: "fixture-shopee-link-1", ordemCaptura: 1 },
        { papelLink: "moedas", urlOriginal: "https://promo.example/fixture-shopee-extra", ocorrenciaId: "fixture-shopee-link-2", ordemCaptura: 2 }],
      produto: { titulo: shopeeTitle, tituloOrigem: source, shopId, itemId, linkExpandido: canonical,
        identidadeProdutoValidada: { fonte: source, shopId, itemId, urlCanonica: canonical } }
    }
  };
  return normalizarOfertaImportada(raw, shopeeJob);
}
const shopeeSynthetic = syntheticShopeeCase();
assert.equal(shopeeSynthetic.titulo, shopeeTitle);
assert.equal(shopeeSynthetic.preco, 79.9);
assert.equal(shopeeSynthetic.precoOriginal, 119.9);
assert.equal(shopeeSynthetic.cupom, "SHOPEE10");
assert.equal(shopeeSynthetic.metadata.linksComerciais.length, 2);
assert.equal(syntheticShopeeCase({ itemId: "900099" }).titulo, "");
assert.equal(syntheticShopeeCase({ source: "html_fallback" }).titulo, "");
assert.equal(syntheticShopeeCase({ proofMissing: true }).titulo, "");

// Historical records are kept separate and only test the observed missing-provenance condition.
assert.equal(realCases.fixtureType, "sanitized_persisted_production_snapshots");
assert.equal(realCases.cases.length, 4);
for (const sample of realCases.cases) {
  assert.equal(sample.persistedTechnicalTitleProof, false, `real job ${sample.jobId} must not be assigned a synthetic proof`);
  assert.ok(sample.productId, `real job ${sample.jobId} retains its observed canonical product identifier`);
}
assert.deepEqual(realCases.cases.filter(sample => sample.marketplace === "mercadolivre").map(sample => sample.jobId), ["1105316", "1105171"]);
assert.ok(realCases.cases.filter(sample => sample.marketplace === "mercadolivre")
  .every(sample => sample.persistedOfficialTitleProvenance === false),
"the historical ML snapshots do not contain an official title source to replay");
assert.equal(realCases.cases.find(sample => sample.jobId === "1105284").productId, "B07K11FVBY");
assert.equal(realCases.cases.find(sample => sample.jobId === "1105284").persistedOfficialTitleProvenance, true);
assert.equal(realCases.cases.find(sample => sample.jobId === "1103477").productId, "284312776/58258390791");
assert.equal(realCases.cases.find(sample => sample.jobId === "1103477").persistedOfficialTitleProvenance, false);

(async () => {
  const fixtures = await runAnchorTitleProvenanceFixtures(process.cwd());
  const ml = fixtures.mercadolivre;
  assert.equal(ml.ok, true, JSON.stringify(ml));
  assert.equal(ml.proofPresent, true, "ML adapter propagates proof generated from the official HTML/JSON-LD importer response");
  assert.equal(ml.titleSource, "jsonld.name");
  assert.equal(ml.productId, "MLB900000001");
  assert.equal(ml.proofJobId, "fixture-job-ml-source-01");
  assert.equal(ml.proofEventId, "fixture-event-ml-source-01");
  assert.equal(ml.proofWorkspaceId, "fixture-workspace-ml-a");
  assert.equal(ml.proofOccurrence, "fixture-ml-occurrence-01");
  assert.equal(ml.proofAnchorUrl, "https://produto.mercadolivre.com.br/MLB-900000001-fixture-item-_JM");
  assert.equal(ml.proofCanonicalUrl, ml.proofAnchorUrl);
  assert.equal(ml.proofTitle, ml.normalizedTitle);
  assert.equal(ml.normalizedTitle, "Monitor Orbit de Estudos 27 Polegadas Fixture");
  assert.equal(ml.normalizedProof, "confirmada_pelo_importador");
  assert.equal(ml.price, 219.9);
  assert.equal(ml.previousPrice, 499.9, "the captured Radar De price survives the ML adapter projection");
  assert.equal(ml.coupon, "RADAR20");
  assert.equal(ml.affiliate, "https://meli.la/fixture-fixture-workspace-ml-a");
  assert.equal(ml.commercialLinks, 1);
  assert.deepEqual(ml.commercialLinkOriginals, ["https://produto.mercadolivre.com.br/MLB-900000001-fixture-item-_JM"]);
  assert.equal(ml.imagePresent, true);
  assert.equal(ml.imageUrl, "https://http2.mlstatic.com/fixture-image.jpg");
  assert.deepEqual(ml.requested, ["https://produto.mercadolivre.com.br/MLB-900000001-fixture-item-_JM"]);
  const mlNoRadarDe = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    mercadolivre: { radarMissingPrevious: true, pagePreviousPrice: 349.9 }
  });
  assert.equal(mlNoRadarDe.mercadolivre.previousPrice, null,
    "without Radar De, a marketplace/page previous price is not promoted to commercial truth");
  const mlPagePriceCannotReplaceRadarDe = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    mercadolivre: { pagePreviousPrice: 349.9 }
  });
  assert.equal(mlPagePriceCannotReplaceRadarDe.mercadolivre.previousPrice, 499.9,
    "Radar De remains authoritative over a different page price");
  const mlNoTitle = await runAnchorTitleProvenanceFixtures(process.cwd(), { mercadolivre: { noOfficialTitle: true } });
  assert.equal(mlNoTitle.mercadolivre.proofPresent, false);
  assert.equal(mlNoTitle.mercadolivre.normalizedTitle, "", "ML with no source title remains held without inventing one");
  const mlForeignProduct = await runAnchorTitleProvenanceFixtures(process.cwd(), { mercadolivre: { foreignProduct: true } });
  assert.equal(mlForeignProduct.mercadolivre.proofPresent, false);
  assert.equal(mlForeignProduct.mercadolivre.terminalReason, "mercadolivre_identidade_inconsistente");
  const mlWorkspaceB = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    mercadolivre: { workspace: "fixture-workspace-ml-b" }
  });
  assert.equal(mlWorkspaceB.mercadolivre.proofWorkspaceId, "fixture-workspace-ml-b");
  assert.notEqual(ml.affiliate, mlWorkspaceB.mercadolivre.affiliate,
    "Mercado Livre affiliate conversion remains workspace-specific");

  const shopee = fixtures.shopee;
  assert.equal(shopee.ok, true, JSON.stringify(shopee));
  assert.equal(shopee.proofPresent, true, "Shopee adapter propagates proof generated from the exact productOfferV2 node");
  assert.equal(shopee.titleSource, "api.productOfferV2");
  assert.equal(shopee.identitySource, "api.productOfferV2");
  assert.equal(shopee.productId, "900001/900002");
  assert.equal(shopee.proofJobId, "fixture-job-shopee-source-01");
  assert.equal(shopee.proofEventId, "fixture-event-shopee-source-01");
  assert.equal(shopee.proofWorkspaceId, "fixture-workspace-shopee-a");
  assert.equal(shopee.proofOccurrence, "fixture-shopee-occurrence-01");
  assert.equal(shopee.proofAnchorUrl, "https://s.shopee.com.br/fixture-product-link");
  assert.equal(shopee.proofCanonicalUrl, "https://shopee.com.br/product/900001/900002");
  assert.equal(shopee.proofTitle, shopee.normalizedTitle);
  assert.equal(shopee.normalizedTitle, "Cooler Aigo Darkflash DC360 Fixture");
  assert.equal(shopee.normalizedProof, "confirmada_pelo_importador");
  assert.equal(shopee.price, 219.9);
  assert.equal(shopee.previousPrice, 499.9, "the captured Radar De price survives the Shopee adapter projection");
  assert.equal(shopee.coupon, "SHOPEE10");
  assert.equal(shopee.affiliate, shopee.expectedAffiliate);
  assert.equal(shopee.commercialLinks, 1);
  assert.deepEqual(shopee.commercialLinkOriginals, ["https://s.shopee.com.br/fixture-product-link"]);
  assert.equal(shopee.imagePresent, true);
  assert.equal(shopee.imageUrl, "https://cf.shopee.com.br/file/fixture-official-image.jpg");

  const shopeeNoRadarDe = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    shopee: { radarMissingPrevious: true, pagePreviousPrice: 349.9 }
  });
  assert.equal(shopeeNoRadarDe.shopee.previousPrice, null,
    "Shopee API priceMin/priceMax are not substituted as Radar De when the message omits it");
  const shopeeRadarDeWins = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    shopee: { pagePreviousPrice: 349.9 }
  });
  assert.equal(shopeeRadarDeWins.shopee.previousPrice, 499.9,
    "Shopee Radar De is preserved even when the import result carries a different page price");

  const shopeeHtmlTitle = await runAnchorTitleProvenanceFixtures(process.cwd(), { shopee: { noApiTitle: true } });
  assert.equal(shopeeHtmlTitle.shopee.titleSource, "html_fallback");
  assert.equal(shopeeHtmlTitle.shopee.proofPresent, false, "IDs alone cannot make an HTML fallback title official");
  const shopeeWrongShop = await runAnchorTitleProvenanceFixtures(process.cwd(), { shopee: { wrongShop: true } });
  assert.equal(shopeeWrongShop.shopee.ok, false, "mismatched shopId is rejected");
  assert.equal(shopeeWrongShop.shopee.terminalReason, "shopee_identidade_produto_nao_confirmada");
  const shopeeWrongItem = await runAnchorTitleProvenanceFixtures(process.cwd(), { shopee: { wrongItem: true } });
  assert.equal(shopeeWrongItem.shopee.proofPresent, false, "mismatched itemId cannot produce title proof");
  assert.equal(shopeeWrongItem.shopee.normalizedTitle, "");

  const shopeeWorkspaceB = await runAnchorTitleProvenanceFixtures(process.cwd(), {
    shopee: { workspace: "fixture-workspace-shopee-b", appId: "fixture-app-shopee-b" }
  });
  assert.equal(shopeeWorkspaceB.shopee.proofPresent, true);
  assert.equal(shopeeWorkspaceB.shopee.affiliate, shopeeWorkspaceB.shopee.expectedAffiliate);
  assert.notEqual(shopee.affiliate, shopeeWorkspaceB.shopee.affiliate,
    "affiliate URLs remain workspace-specific");

  console.log("link-anchor-identity-proof-focal.test.cjs OK; real snapshots separated, ML and Shopee source chains verified");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
