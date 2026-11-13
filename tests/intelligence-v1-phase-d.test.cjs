"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  construirMetadataIntelligenceV1
} = require("../modules/inteligencia-universal/foundation-v1.service");
const {
  ROUTING_ACTIVE_RELEASED,
  routingMode,
  buildRoutingBridge,
  validateRoutingBridge,
  projectedCategoryCandidates
} = require("../modules/inteligencia-universal/routing-shadow-v1.service");
const {
  analisarDestinosOferta,
  categoriasCandidatasOferta
} = require("../modules/engine/distributor/distributor.service");
const {
  aplicarSombraInteligenciaUniversalV2
} = require("../modules/engine/importer/importer.service");

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "fixtures/intelligence-v1-phase-d.sanitized.json"
), "utf8"));

function withBridge(offer) {
  const bridge = buildRoutingBridge(construirMetadataIntelligenceV1(offer));
  return { ...offer, metadata: { intelligenceV1Routing: bridge } };
}

function context(destinations, mode = "shadow") {
  return {
    destinosPorCliente: { workspace_a: destinations },
    intelligenceRoutingEnv: { OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: mode }
  };
}

test("contrato OFF SHADOW ACTIVE e invalido falham de forma fechada", () => {
  assert.equal(ROUTING_ACTIVE_RELEASED, false);
  assert.deepEqual(routingMode({}), {
    requestedMode: "off", effectiveMode: "off", activeReleased: false, reason: "routing_off"
  });
  assert.equal(routingMode({ OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "shadow" }).effectiveMode, "shadow");
  assert.deepEqual(routingMode({ OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "active" }), {
    requestedMode: "active", effectiveMode: "off", activeReleased: false, reason: "active_not_released"
  });
  assert.equal(routingMode({ OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "qualquer" }).effectiveMode, "off");
});

test("ponte e estritamente sanitizada e exige identidade/evidencia/versionamento", () => {
  const metadata = construirMetadataIntelligenceV1(fixture.splitAirConditioner.offer);
  const bridge = buildRoutingBridge({
    ...metadata,
    preco: 100,
    cupom: "SEGREDO",
    linkAfiliado: "https://example.test/private",
    trackingId: "private",
    cookies: "private"
  });
  const serialized = JSON.stringify(bridge);
  assert.equal(validateRoutingBridge(bridge).valid, true);
  assert.equal(bridge.classificationStatus, "resolved");
  assert.equal(bridge.category.principal, "Climatização e Ventilação");
  assert.deepEqual(bridge.category.affinities, ["Eletrodomésticos"]);
  assert.doesNotMatch(serialized, /SEGREDO|example\.test|tracking|cookies|preco|cupom|linkAfiliado/i);
  assert.equal(bridge.eligibilityAuthoritative, false);

  const invalid = structuredClone(bridge);
  invalid.identity.evidenceHash = "invalido";
  assert.equal(validateRoutingBridge(invalid).valid, false);
  assert.deepEqual(projectedCategoryCandidates({
    legacyCategories: ["Climatização e Ventilação"], bridge: invalid
  }).addedCategories, []);

  const invented = structuredClone(bridge);
  invented.category.affinities = ["Categoria Inventada"];
  assert.equal(validateRoutingBridge(invented).valid, false);
  assert.deepEqual(projectedCategoryCandidates({
    legacyCategories: ["Climatização e Ventilação"], bridge: invented
  }).addedCategories, []);
});

test("OFF mantem exatamente a decisao legada e nao materializa comparativo", () => {
  const offer = withBridge(fixture.splitAirConditioner.offer);
  const baseline = analisarDestinosOferta("workspace_a", offer, context(fixture.splitAirConditioner.destinations, "off"));
  const invalidMode = analisarDestinosOferta("workspace_a", offer, context(fixture.splitAirConditioner.destinations, "invalid"));
  const activeBlocked = analisarDestinosOferta("workspace_a", offer, context(fixture.splitAirConditioner.destinations, "active"));
  assert.deepEqual(invalidMode, baseline);
  assert.deepEqual(activeBlocked, baseline);
  assert.equal(baseline.intelligenceRoutingShadow, undefined);
  assert.deepEqual(categoriasCandidatasOferta(offer), ["Climatização e Ventilação"]);
});

test("SHADOW compara categoria principal e afinidade sem duplicar destino ou criar target", () => {
  const offer = withBridge(fixture.splitAirConditioner.offer);
  const result = analisarDestinosOferta("workspace_a", offer, context(fixture.splitAirConditioner.destinations));
  const shadow = result.intelligenceRoutingShadow;
  assert.equal(result.compativeis.length, 2);
  assert.equal(shadow.legacyEligibleCount, 2);
  assert.equal(shadow.projectedEligibleCount, 6);
  assert.equal(shadow.inclusions.length, 4);
  assert.deepEqual(shadow.addedCategories, ["Eletrodomésticos"]);
  assert.equal(new Set(shadow.projectedDestinationRefs).size, 6);
  assert.equal(shadow.targetsCreated, 0);
  assert.equal(shadow.externalCalls, 0);
  assert.equal(shadow.authoritative, false);
  assert.equal(result.compativeis.some(item => item.destino.id === "telegram-eletro-a"), false);
  assert.equal(result.compativeis.some(item => item.destino.id === "discord-eletro-b"), false);
  assert.equal(shadow.projectedEligibleCount < fixture.splitAirConditioner.destinations.length, true);
});

test("marketplace e origem continuam obrigatorios no comparativo multicanal", () => {
  const offer = withBridge(fixture.splitAirConditioner.offer);
  const shadow = analisarDestinosOferta(
    "workspace_a", offer, context(fixture.splitAirConditioner.destinations)
  ).intelligenceRoutingShadow;
  assert.equal(shadow.projectedEligibleCount, 6);
  assert.equal(shadow.projectedDestinationRefs.length, 6);
});

test("seguranca adulta bloqueia destinos ativos e continua visivel no shadow", () => {
  const offer = withBridge(fixture.adult.offer);
  const result = analisarDestinosOferta("workspace_a", offer, context(fixture.adult.destinations));
  assert.equal(result.compativeis.length, 0);
  assert.equal(result.intelligenceRoutingShadow.legacyEligibleCount, 0);
  assert.equal(result.intelligenceRoutingShadow.projectedEligibleCount, 0);
  assert.equal(result.intelligenceRoutingShadow.securityBlocked, true);
  assert.equal(result.intelligenceRoutingShadow.approvalBlocked, true);
  assert.equal(result.intelligenceRoutingShadow.safetyClass, "adult");
});

test("produto incerto, metadata ausente ou divergente nao cria elegibilidade", () => {
  const uncertainMetadata = construirMetadataIntelligenceV1({
    marketplace: "magalu",
    tituloOficial: "Acessório modelo QX série 2026",
    productId: "qx-2026",
    identityConfirmed: true,
    identitySource: "pagina_oficial",
    categoria: "Diversos"
  });
  const uncertainBridge = buildRoutingBridge(uncertainMetadata);
  const uncertain = projectedCategoryCandidates({ legacyCategories: ["Diversos"], bridge: uncertainBridge });
  const missing = projectedCategoryCandidates({ legacyCategories: ["Diversos"], bridge: {} });
  const divergentMetadata = construirMetadataIntelligenceV1({
    marketplace: "amazon",
    tituloOficial: "Mouse Gamer Modelo X",
    productId: "A",
    metadata: { produto: { productId: "B" } },
    identityConfirmed: true,
    identitySource: "api_oficial",
    categoria: "Periféricos"
  });
  const divergent = projectedCategoryCandidates({
    legacyCategories: ["Periféricos"], bridge: buildRoutingBridge(divergentMetadata)
  });
  assert.deepEqual(uncertain.addedCategories, []);
  assert.deepEqual(missing.addedCategories, []);
  assert.deepEqual(divergent.addedCategories, []);
});

test("falha de metadata ou servico shadow permanece fail-open para o legado", () => {
  const metadata = {};
  Object.defineProperty(metadata, "intelligenceV1Routing", {
    enumerable: true,
    get() { throw new Error("shadow service unavailable"); }
  });
  const offer = { ...fixture.splitAirConditioner.offer, metadata };
  const result = analisarDestinosOferta(
    "workspace_a", offer, context(fixture.splitAirConditioner.destinations)
  );
  assert.equal(result.compativeis.length, 2);
  assert.equal(result.intelligenceRoutingShadow, undefined);
});

test("referencias sanitizadas preservam isolamento entre workspaces", () => {
  const offer = withBridge(fixture.splitAirConditioner.offer);
  const destinations = fixture.splitAirConditioner.destinations;
  const a = analisarDestinosOferta("workspace_a", offer, {
    destinosPorCliente: { workspace_a: destinations },
    intelligenceRoutingEnv: { OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "shadow" }
  }).intelligenceRoutingShadow;
  const b = analisarDestinosOferta("workspace_b", offer, {
    destinosPorCliente: { workspace_b: destinations },
    intelligenceRoutingEnv: { OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "shadow" }
  }).intelligenceRoutingShadow;
  assert.equal(a.projectedEligibleCount, b.projectedEligibleCount);
  assert.notDeepEqual(a.projectedDestinationRefs, b.projectedDestinationRefs);
  assert.doesNotMatch(JSON.stringify(offer.metadata.intelligenceV1Routing), /workspace_[ab]/);
});

test("importador transporta a ponte sem campos comerciais e sem autoridade", async () => {
  const offer = {
    ...fixture.splitAirConditioner.offer,
    titulo: fixture.splitAirConditioner.offer.tituloOficial,
    preco: 2499.9,
    precoOriginal: 2999.9,
    cupom: "CLIMA10",
    linkOriginal: "https://example.test/product",
    linkAfiliado: "https://example.test/affiliate",
    imagem: "https://example.test/image.jpg",
    metadata: {
      produto: {
        produtoId: "MLB900001",
        identityConfirmed: true,
        identitySource: "api_oficial",
        tituloOficial: fixture.splitAirConditioner.offer.tituloOficial
      }
    }
  };
  const oldMode = process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
  const oldDisabled = process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
  let result;
  try {
    process.env.OPTIMUS_INTELLIGENCE_V1_MODE = "shadow";
    delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    result = await aplicarSombraInteligenciaUniversalV2(offer, offer, {
      id: 1,
      cliente_id: "workspace_a"
    }, {
      consultaMemoriaHistoricaPromise: Promise.resolve({
        memoriaDisponivel: true,
        memoria: [],
        motivo: "fixture"
      })
    });
  } finally {
    if (oldMode === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MODE = oldMode;
    if (oldDisabled === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    else process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED = oldDisabled;
  }
  const bridge = result.metadata.intelligenceV1Routing;
  assert.equal(validateRoutingBridge(bridge).valid, true);
  assert.equal(bridge.eligibilityAuthoritative, false);
  assert.doesNotMatch(JSON.stringify(bridge), /2499|CLIMA10|example\.test|workspace_a/);
});
