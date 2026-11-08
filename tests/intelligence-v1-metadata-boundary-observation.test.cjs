"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const observation = require("../modules/inteligencia-universal/metadata-boundary-observation");
const {
  construirMetadataIntelligenceV1
} = require("../modules/inteligencia-universal/foundation-v1.service");
const {
  buildRoutingBridge,
  metadataContractReasonClasses,
  validateRoutingBridge
} = require("../modules/inteligencia-universal/routing-shadow-v1.service");
const { analisarDestinosOferta } = require("../modules/engine/distributor/distributor.service");

const ENV = {
  OPTIMUS_INTELLIGENCE_V1_MODE: "shadow",
  OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE: "shadow"
};
const offer = {
  marketplace: "mercadolivre",
  tituloOficial: "Ar-condicionado Split Inverter 12000 BTU",
  productId: "fixture-product-1",
  identityConfirmed: true,
  identitySource: "api_oficial",
  categoria: "Climatização e Ventilação"
};

test.afterEach(() => observation.reset());

test("propagacao builder -> importer -> persistencia -> distributor preserva envelope", () => {
  const metadata = construirMetadataIntelligenceV1(offer);
  const bridge = buildRoutingBridge(metadata);
  assert.ok(bridge);
  assert.equal(validateRoutingBridge(bridge).valid, true);

  for (const boundary of observation.BOUNDARIES) {
    observation.observeMetadataBoundary(boundary, {
      present: true,
      valid: true,
      outcome: "present",
      env: ENV
    });
  }

  const rows = observation.snapshot();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.boundary), ["builder", "distributor", "importer", "persistence"]);
  assert.ok(rows.every(row => row.present && row.valid && row.reasons.length === 0 && row.count === 1));
});

test("perda intencional do envelope aparece somente na fronteira afetada", () => {
  const metadata = construirMetadataIntelligenceV1(offer);
  const bridge = buildRoutingBridge(metadata);
  assert.ok(bridge);
  observation.observeMetadataBoundary("builder", { present: true, valid: true, env: ENV });
  observation.observeMetadataBoundary("importer", { present: false, valid: false, reasons: ["envelope_missing"], env: ENV });
  observation.observeMetadataBoundary("persistence", { present: false, valid: false, reasons: ["envelope_missing"], env: ENV });
  observation.observeMetadataBoundary("distributor", {
    present: false,
    valid: false,
    reasons: observation.reasonClassesFromValidationErrors([
      "bridge_version_invalid", "classification_not_resolved", "identity_not_confirmed", "safety_invalid"
    ]),
    env: ENV
  });

  const rows = observation.snapshot();
  const importer = rows.find(row => row.boundary === "importer");
  const distributor = rows.find(row => row.boundary === "distributor");
  assert.deepEqual(importer.reasons, ["envelope_missing"]);
  assert.deepEqual(distributor.reasons, ["classification", "identity", "safety"]);
});

test("motivos de contrato nao carregam payload ou identificadores", () => {
  const metadata = construirMetadataIntelligenceV1(offer);
  const reasons = metadataContractReasonClasses(metadata);
  assert.deepEqual(reasons, []);
  const invalid = { ...metadata, safety: { ...metadata.safety, class: "" } };
  assert.deepEqual(metadataContractReasonClasses(invalid), ["safety"]);
  assert.doesNotMatch(JSON.stringify(observation.snapshot()), /fixture-product|Ar-condicionado|mercadolivre/i);
});

test("Distributor registra perda real do envelope sem alterar a decisao legada", () => {
  const resultado = analisarDestinosOferta("workspace_fixture", {
    marketplace: "mercadolivre",
    categoria: "Diversos",
    origem: "optimus",
    metadata: {}
  }, {
    destinosPorCliente: {
      workspace_fixture: [{
        id: "destino-fixture",
        ativo: true,
        marketplaces: ["mercadolivre"],
        categorias: ["Diversos"]
      }]
    },
    intelligenceRoutingEnv: ENV
  });

  assert.equal(resultado.compativeis.length, 1);
  const row = observation.snapshot().find(item => item.boundary === "distributor");
  assert.ok(row);
  assert.equal(row.present, false);
  assert.equal(row.valid, false);
  assert.deepEqual(row.reasons, ["classification", "identity", "safety"]);
});
