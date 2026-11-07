"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { construirMetadataIntelligenceV1 } = require("../modules/inteligencia-universal/foundation-v1.service");
const {
  memoryMode,
  memoryLimits,
  buildMemoryRecord,
  readThroughMemoryV1,
  scheduleMemoryObservation,
  drainMemoryQueueForTests,
  resetMemoryRuntimeForTests
} = require("../modules/inteligencia-universal/memory-v1.service");
const { normalizeMemoryRecord } = require("../modules/inteligencia-universal/memory-v1.repository");

function officialOffer(id = "SKU-100") {
  return {
    marketplace: "magalu",
    productId: id,
    sku: id,
    identityConfirmed: true,
    identitySource: "api_oficial",
    tituloOficial: "Ventilador Arno X-Treme 40 cm",
    marca: "Arno",
    modelo: "X-Treme",
    capacidade: "40 cm",
    precoAtual: 199.9,
    cupom: "VENTO10",
    linkAfiliado: "https://example.invalid/affiliate?token=secret"
  };
}

test.beforeEach(() => resetMemoryRuntimeForTests());

test("migration permanece aditiva e fora do bootstrap automatico", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../modules/inteligencia-universal/intelligence-product-memory.additive.sql"), "utf8");
  const bootstrap = fs.readFileSync(path.join(__dirname, "../modules/engine/universal-runtime-bootstrap.js"), "utf8");
  assert.match(migration, /^-- Intelligence V1 Phase B/m);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /lock_timeout = '500ms'/);
  assert.doesNotMatch(bootstrap, /intelligence-product-memory/);
});

test("modo default OFF nao consulta banco e limites permanecem estritos", async () => {
  let calls = 0;
  const offer = officialOffer();
  const metadata = construirMetadataIntelligenceV1(offer);
  const result = await readThroughMemoryV1({ offer, metadata, workspaceId: "user_a",
    env: {}, query: async () => { calls += 1; throw new Error("nao_deveria_consultar"); } });
  assert.equal(memoryMode({}), "off");
  assert.equal(result.mode, "off");
  assert.equal(calls, 0);
  assert.deepEqual(memoryLimits({
    OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY: "999",
    OPTIMUS_INTELLIGENCE_V1_MEMORY_QUEUE_MAX: "9999",
    OPTIMUS_INTELLIGENCE_V1_MEMORY_TIMEOUT_MS: "99999"
  }), {
    maxConcurrency: 4, maxQueue: 256, timeoutMs: 1000,
    tableCacheMs: 30000, negativeCacheMs: 300000, maxNegativeEntries: 1000
  });
});

test("fonte oficial usa escopo global e evidencia privada exige workspace", () => {
  const official = officialOffer();
  const officialMetadata = construirMetadataIntelligenceV1(official);
  const global = buildMemoryRecord(official, officialMetadata, "user_a");
  assert.equal(global.ok, true);
  assert.equal(global.record.scopeType, "global");
  assert.equal(global.record.workspaceId, "");

  const privateOffer = { ...official, identitySource: "extension_verified", productId: "EXT-1", sku: "EXT-1" };
  const privateMetadata = construirMetadataIntelligenceV1(privateOffer);
  assert.equal(buildMemoryRecord(privateOffer, privateMetadata, "").reason, "memory_private_workspace_required");
  const scoped = buildMemoryRecord(privateOffer, privateMetadata, "user_a");
  assert.equal(scoped.record.scopeType, "workspace");
  assert.equal(scoped.record.workspaceId, "user_a");
});

test("registro persistivel contem somente fatos estaveis permitidos", () => {
  const offer = officialOffer();
  const metadata = construirMetadataIntelligenceV1(offer);
  const built = buildMemoryRecord(offer, metadata, "user_a");
  const serialized = JSON.stringify(built.record);
  for (const forbidden of ["199.9", "VENTO10", "example.invalid", "affiliate", "secret", "user_a"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(built.record.brand, "Arno");
  assert.equal(built.record.model, "X-Treme");
  assert.equal(built.record.capacity, "40 cm");
  assert.equal(built.record.categoryPrimary, "Climatização e Ventilação");
});

test("fonte privada nunca pode ser normalizada como fato global", () => {
  const normalized = normalizeMemoryRecord({
    scopeType: "global", workspaceId: "", marketplace: "magalu", productId: "1",
    identityKey: "magalu:1", identityEvidenceHash: "a".repeat(64),
    classificationStatus: "resolved", safetyClass: "general",
    source: "extension_verified", categoryPrimary: "Diversos",
    schemaVersion: "v1", classifierVersion: "v1"
  });
  assert.equal(normalized.ok, false);
  assert.equal(normalized.reason, "global_source_not_official");
});

test("identidade ou SKU divergente nao agenda persistencia", () => {
  const offer = {
    ...officialOffer(),
    productId: "PRODUTO-A",
    metadata: { produto: { productId: "PRODUTO-B", sku: "SKU-B", identitySource: "api_oficial" } }
  };
  const metadata = construirMetadataIntelligenceV1(offer);
  assert.equal(metadata.identity.divergent, true);
  assert.equal(buildMemoryRecord(offer, metadata, "user_a").reason, "memory_identity_unconfirmed");
});

test("tabela ausente e falha de query sao fail-open com cache negativo curto", async () => {
  const offer = officialOffer();
  const metadata = construirMetadataIntelligenceV1(offer);
  let calls = 0;
  const query = async () => { calls += 1; return { rows: [{ available: false }], rowCount: 1 }; };
  const env = { OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE: "shadow",
    OPTIMUS_INTELLIGENCE_V1_MEMORY_NEGATIVE_CACHE_MS: "1000" };
  const first = await readThroughMemoryV1({ offer, metadata, workspaceId: "user_a", env, query, now: 1000 });
  const second = await readThroughMemoryV1({ offer, metadata, workspaceId: "user_a", env, query, now: 1100 });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "memory_table_unavailable");
  assert.equal(second.ok, true);
  assert.equal(second.reason, "memory_negative_cache");
  assert.equal(calls, 1);
});

test("fila shadow e limitada, single-flight e nunca bloqueia o chamador", async () => {
  const previousMode = process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE;
  const previousConcurrency = process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY;
  const previousDisabled = process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_DISABLED;
  process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE = "shadow";
  process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY = "1";
  delete process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_DISABLED;
  let active = 0;
  let maxActive = 0;
  const rows = new Map();
  const query = async (sql, params = []) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    if (/to_regclass/.test(sql)) return { rows: [{ available: true }], rowCount: 1 };
    if (/^SELECT memory_id/.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (/^INSERT INTO intelligence_product_memory/.test(sql.trim())) {
      rows.set(params[3], true);
      return { rows: [{ record_revision: 1, invalidation_reason: null }], rowCount: 1 };
    }
    throw new Error("query_inesperada");
  };
  try {
    const offerA = officialOffer("A-1");
    const metadataA = construirMetadataIntelligenceV1(offerA);
    const first = scheduleMemoryObservation({ offer: offerA, metadata: metadataA,
      workspaceId: "user_a", env: process.env, query });
    const duplicate = scheduleMemoryObservation({ offer: offerA, metadata: metadataA,
      workspaceId: "user_a", env: process.env, query });
    const offerB = officialOffer("B-1");
    const second = scheduleMemoryObservation({ offer: offerB,
      metadata: construirMetadataIntelligenceV1(offerB), workspaceId: "user_a", env: process.env, query });
    assert.equal(first.scheduled, true);
    assert.equal(duplicate.reason, "memory_single_flight");
    assert.equal(second.scheduled, true);
    const drained = await drainMemoryQueueForTests();
    assert.equal(drained.running, 0);
    assert.equal(drained.queueDepth, 0);
    assert.equal(drained.failed, 0);
    assert.equal(rows.size, 2);
    assert.equal(maxActive, 1);
  } finally {
    if (previousMode === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE = previousMode;
    if (previousConcurrency === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY = previousConcurrency;
    if (previousDisabled === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_DISABLED;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MEMORY_DISABLED = previousDisabled;
  }
});
