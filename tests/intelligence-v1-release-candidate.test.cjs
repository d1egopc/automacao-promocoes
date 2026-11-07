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
  buildRoutingBridge,
  projectedCategoryCandidates,
  routingMode
} = require("../modules/inteligencia-universal/routing-shadow-v1.service");
const {
  analisarDestinosOferta
} = require("../modules/engine/distributor/distributor.service");

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "fixtures/intelligence-v1-phase-d.sanitized.json"
), "utf8"));

function withBridge(offer) {
  const bridge = buildRoutingBridge(construirMetadataIntelligenceV1(offer));
  return { ...offer, metadata: { intelligenceV1Routing: bridge } };
}

function context(destinations, env) {
  return {
    destinosPorCliente: { workspace_release: destinations },
    intelligenceRoutingEnv: env
  };
}

function withoutShadowLog(callback) {
  const original = console.log;
  console.log = () => {};
  try {
    return callback();
  } finally {
    console.log = original;
  }
}

test("release candidate keeps OFF authoritative when ACTIVE or an invalid mode is requested", () => {
  assert.equal(ROUTING_ACTIVE_RELEASED, false);
  assert.equal(routingMode({ OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "active" }).effectiveMode, "off");
  assert.equal(routingMode({
    OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "active",
    OPTIMUS_INTELLIGENCE_V1_ROUTING_DISABLED: "1"
  }).effectiveMode, "off");

  const offer = withBridge(fixture.splitAirConditioner.offer);
  const destinations = fixture.splitAirConditioner.destinations;
  const baseline = analisarDestinosOferta("workspace_release", offer, context(destinations, {
    OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "off"
  }));
  const active = analisarDestinosOferta("workspace_release", offer, context(destinations, {
    OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "active"
  }));
  const invalid = analisarDestinosOferta("workspace_release", offer, context(destinations, {
    OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "unexpected"
  }));

  assert.deepEqual(active, baseline);
  assert.deepEqual(invalid, baseline);
  assert.equal(baseline.intelligenceRoutingShadow, undefined);
});

test("shadow caps observation above 250 destinations without truncating the legacy decision", () => {
  const offer = withBridge(fixture.splitAirConditioner.offer);
  const destinations = Array.from({ length: 251 }, (_, index) => ({
    id: `destination-${String(index + 1).padStart(3, "0")}`,
    tipo: ["whatsapp", "telegram", "discord"][index % 3],
    ativo: true,
    origemOfertas: "optimus",
    marketplaces: ["mercadolivre"],
    categorias: ["Eletrodomésticos"]
  }));

  const result = withoutShadowLog(() => analisarDestinosOferta(
    "workspace_release",
    offer,
    context(destinations, { OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "shadow" })
  ));

  assert.equal(result.destinos.length, 251);
  assert.equal(result.compativeis.length, 0);
  assert.equal(result.rejeitados.length, 251);
  assert.equal(result.intelligenceRoutingShadow.coverageComplete, false);
  assert.equal(result.intelligenceRoutingShadow.approvalBlocked, true);
  assert.equal(result.intelligenceRoutingShadow.projectedEligibleCount, 250);
  assert.equal(result.intelligenceRoutingShadow.targetsCreated, 0);
  assert.equal(result.intelligenceRoutingShadow.externalCalls, 0);
  assert.equal(result.intelligenceRoutingShadow.authoritative, false);
});

test("adult safety blocks every projected category while ACTIVE remains unreleased", () => {
  const offer = withBridge(fixture.adult.offer);
  const projection = projectedCategoryCandidates({
    legacyCategories: ["Diversos"],
    bridge: offer.metadata.intelligenceV1Routing
  });
  assert.equal(projection.securityBlocked, true);
  assert.equal(projection.approvalBlocked, true);
  assert.deepEqual(projection.categories, []);
  assert.equal(routingMode({ OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "active" }).reason, "active_not_released");
});
