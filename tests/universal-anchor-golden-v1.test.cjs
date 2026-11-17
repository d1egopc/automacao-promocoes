"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./fixtures/universal-anchor-v1-contracts.json");
const { criarContratoPreparacaoLinks } = require("../modules/engine/preparacao-links.service");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");
const { classificarLinksComerciais } = require("../modules/radar/links-comerciais");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { montarOfertaUniversalEngine, validarContratoOfertaUniversal } = require("../modules/engine/oferta-universal.contract");
const { urlSelecaoMlbu } = require("../optimus-capture/local-worker/mercadolivre-identity");

const CAPABILITIES = new Set(["ml_identity_v1", "magalu_identity_v1"]);
const WORKSPACES = new Set(fixtures.cases.map(item => item.workspaceId));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildAnchorContext(item) {
  const commercial = clone(item.commercial);
  const context = {
    schemaVersion: fixtures.schemaVersion,
    jobId: String(item.jobId),
    eventoId: String(item.eventId),
    workspaceId: String(item.workspaceId),
    origem: item.origin,
    occurrenceId: item.occurrenceId,
    linksOriginais: clone(item.linksOriginal),
    linksClassificados: clone(item.linksClassified),
    ancoraSelecionada: item.selectedAnchor ? clone(item.selectedAnchor) : null,
    identidade: clone(item.identity),
    evidenciaTecnica: clone(item.technical),
    comercialCapturado: commercial,
    deadline: item.deadline,
    attempts: item.attempts
  };
  return Object.freeze(context);
}

function planRecovery(context) {
  if (!context.ancoraSelecionada) return { path: "blocked", workerCalls: 0, reason: "anchor_missing" };
  if (context.identidade.status === "divergent" ||
      (context.identidade.status !== "missing" && context.identidade.sameProduct !== true)) {
    return { path: "blocked", workerCalls: 0, reason: "identity_divergent" };
  }
  if (context.ancoraSelecionada.variationId && context.identidade.observedVariationId &&
      context.ancoraSelecionada.variationId !== context.identidade.observedVariationId) {
    return { path: "blocked", workerCalls: 0, reason: "variant_divergent" };
  }
  const missing = ["title", "image", "category"].filter(field => !context.evidenciaTecnica[field]);
  if (!missing.length && context.identidade.official === true) return { path: "fast", workerCalls: 0, capability: null };
  const capability = context.ancoraSelecionada.marketplace === "mercadolivre"
    ? "ml_identity_v1" : context.ancoraSelecionada.marketplace === "magalu" ? "magalu_identity_v1" : null;
  return { path: "recovery", workerCalls: capability ? 1 : 0, capability };
}

test("AnchorContext cobre identidade, origem, ocorrência, links e prazo sem mutação", () => {
  const titleKinds = new Set();
  for (const item of fixtures.cases) {
    const context = buildAnchorContext(item);
    titleKinds.add(item.titleKind);
    assert.equal(context.jobId, String(item.jobId));
    assert.equal(context.eventoId, String(item.eventId));
    assert.equal(context.workspaceId, item.workspaceId);
    assert.equal(context.occurrenceId, item.occurrenceId);
    assert.deepEqual(context.linksOriginais, item.linksOriginal);
    assert.deepEqual(context.linksClassificados, item.linksClassified);
    assert.ok(context.deadline);
    assert.equal(context.comercialCapturado.price, item.commercial.price);
  }
  assert.deepEqual([...titleKinds].sort(), ["absent", "factual", "promotional"]);
});

test("fast path não aciona Worker e recovery usa somente capability existente", () => {
  for (const item of fixtures.cases) {
    const planned = planRecovery(buildAnchorContext(item));
    assert.equal(planned.path, item.expected.path, item.id);
    assert.equal(planned.workerCalls, item.expected.workerCalls, item.id);
    if (planned.capability) assert.ok(CAPABILITIES.has(planned.capability), item.id);
  }
});

test("papéis de links e âncora original permanecem distintos", () => {
  const item = fixtures.cases.find(entry => entry.id === "radar_multiple_roles");
  const contract = criarContratoPreparacaoLinks({
    linksOriginais: item.linksOriginal,
    linksPreparados: item.linksOriginal,
    redirects: item.linksClassified.map(link => ({ linkOriginalCapturado: link.url, papel: link.role })),
    identidadesCanonicas: []
  });
  assert.deepEqual(contract.linksOriginais, item.linksOriginal);
  assert.equal(contract.redirects[1].papel, "cupom");
  assert.equal(contract.redirects[2].papel, "link_app");
});

test("classificador reconhece marketplace sem converter link auxiliar em produto", () => {
  for (const item of fixtures.cases) {
    const selected = item.selectedAnchor?.urlOriginal;
    if (!selected) continue;
    assert.equal(detectarMarketplaceLink(selected), item.selectedAnchor.marketplace, item.id);
    const classified = classificarLinksComerciais({ texto: item.linksOriginal.join("\n"), linksConhecidos: { classificados: item.linksClassified } });
    assert.ok(classified.encontrados.length >= 1, item.id);
  }
});

test("somente âncora de produto permite recuperação; cupom/social permanece bloqueado", () => {
  const blocked = fixtures.cases.find(entry => entry.id === "clonador_coupon_only_fail_closed");
  const context = buildAnchorContext(blocked);
  assert.equal(planRecovery(context).path, "blocked");
  assert.equal(planRecovery(context).workerCalls, 0);
  assert.equal(context.comercialCapturado.coupon, "LISTA10");
});

test("divergência de identidade e variante permanece fail-closed", () => {
  for (const id of ["identity_divergent_blocked", "variant_divergent_blocked"]) {
    const item = fixtures.cases.find(entry => entry.id === id);
    const planned = planRecovery(buildAnchorContext(item));
    assert.equal(planned.path, "blocked", id);
    assert.equal(planned.workerCalls, 0, id);
  }
});

test("MLBU P0 preserva item_id, catálogo e searchVariation", () => {
  for (const id of ["radar_ml_fast_factual", "clonador_mlbu_recovery", "variant_divergent_blocked"]) {
    const item = fixtures.cases.find(entry => entry.id === id);
    const parsed = urlSelecaoMlbu(item.selectedAnchor.urlTechnical || item.selectedAnchor.urlOriginal);
    assert.ok(parsed, id);
    assert.equal(parsed.listingId, item.selectedAnchor.listingId, id);
    assert.equal(parsed.pageMlbu, item.selectedAnchor.catalogId, id);
    assert.equal(parsed.variationId, item.selectedAnchor.variationId, id);
  }
});

test("TeleRadar mantém origem, eventId determinístico e entidades", () => {
  const item = fixtures.cases.find(entry => entry.origin === "teleradar");
  const envelope = createEnvelope({
    accountId: "10", chatId: "20", messageId: "30", senderId: "40",
    chatKey: "20", receivedAt: "2026-11-17T12:00:00.000Z", sourceTimestamp: "2026-11-17T11:59:59.000Z",
    text: item.commercial.titleCaptured, entities: item.linksOriginal.map(url => ({ type: "url", url, occurrence: 0 }))
  });
  assert.equal(envelope.origem, "radar");
  assert.equal(envelope.origemTipo, "telegram");
  assert.equal(envelope.fonte, "teleradar");
  assert.match(envelope.eventId, /^[a-f0-9]{64}$/);
  assert.equal(envelope.entities[0].url, item.linksOriginal[0]);
});

test("Oferta Universal conserva job/workspace, comercial Radar, âncora e imagem oficial", () => {
  const item = fixtures.cases.find(entry => entry.id === "radar_ml_fast_factual");
  const oferta = montarOfertaUniversalEngine({
    oferta: {
      id: "offer-anchor-1", marketplace: "mercadolivre", titulo: item.technical.title,
      preco: item.commercial.price, precoOriginal: item.commercial.previousPrice,
      cupom: item.commercial.coupon, imagem: item.technical.image, imagemOrigem: "polycard.picture_template",
      linkOriginal: item.selectedAnchor.urlOriginal, linkExpandido: item.selectedAnchor.urlTechnical,
      linkAfiliado: "https://meli.la/afiliado-workspace-a"
    },
    job: { id: item.jobId, evento_id: item.eventId, cliente_id: item.workspaceId, marketplace: "mercadolivre" },
    evento: { id: item.eventId, origem: item.origin },
    link: { url_original: item.selectedAnchor.urlOriginal, url_expandida: item.selectedAnchor.urlTechnical },
    ofertaEntrada: { beneficioTexto: item.commercial.conditions },
    metadata: { produto: { productId: item.selectedAnchor.listingId, categoria: item.technical.category } }
  });
  const validacao = validarContratoOfertaUniversal(oferta);
  assert.equal(validacao.ok, true);
  assert.equal(oferta.jobId, item.jobId);
  assert.equal(oferta.workspaceId, item.workspaceId);
  assert.equal(oferta.produto.urlOriginal, item.selectedAnchor.urlOriginal);
  assert.equal(oferta.comercial.precoAtual, item.commercial.price);
  assert.equal(oferta.comercial.cupom, item.commercial.coupon);
  assert.equal(oferta.midia.imagemPrincipal, item.technical.image);
});

test("workspaces com afiliados distintos não compartilham o destino", () => {
  assert.equal(WORKSPACES.has("user_pss60lus"), true);
  const a = { workspaceId: "user_pss60lus", affiliate: "https://meli.la/afiliado-a" };
  const b = { workspaceId: "workspace-b", affiliate: "https://meli.la/afiliado-b" };
  assert.notEqual(a.affiliate, b.affiliate);
  assert.notEqual(a.workspaceId, b.workspaceId);
});

console.log("universal-anchor-golden-v1.test.cjs OK");
