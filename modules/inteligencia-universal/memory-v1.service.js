"use strict";

const { queryEngineShadow } = require("../engine/database");
const {
  GLOBAL_OFFICIAL_SOURCES,
  tableAvailable,
  readProductMemory,
  upsertProductMemory
} = require("./memory-v1.repository");

const MEMORY_MODES = Object.freeze({ OFF: "off", SHADOW: "shadow" });
const DEFAULTS = Object.freeze({
  maxConcurrency: 2,
  maxQueue: 64,
  timeoutMs: 400,
  tableCacheMs: 30000,
  negativeCacheMs: 5 * 60 * 1000,
  maxNegativeEntries: 1000
});

const runtime = {
  queue: [],
  running: 0,
  inFlight: new Set(),
  queuedKeys: new Set(),
  negativeCache: new Map(),
  tableAvailable: null,
  tableCheckedUntil: 0,
  scheduled: false,
  completed: 0,
  failed: 0,
  dropped: 0
};

function text(value = "", max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function memoryMode(env = process.env) {
  if (String(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_DISABLED || "").trim() === "1") return MEMORY_MODES.OFF;
  return String(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_MODE || "").trim().toLowerCase() === MEMORY_MODES.SHADOW
    ? MEMORY_MODES.SHADOW
    : MEMORY_MODES.OFF;
}

function memoryLimits(env = process.env) {
  return Object.freeze({
    maxConcurrency: clampInteger(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_CONCURRENCY,
      DEFAULTS.maxConcurrency, 1, 4),
    maxQueue: clampInteger(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_QUEUE_MAX,
      DEFAULTS.maxQueue, 1, 256),
    timeoutMs: clampInteger(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_TIMEOUT_MS,
      DEFAULTS.timeoutMs, 100, 1000),
    tableCacheMs: clampInteger(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_TABLE_CACHE_MS,
      DEFAULTS.tableCacheMs, 1000, 300000),
    negativeCacheMs: clampInteger(env.OPTIMUS_INTELLIGENCE_V1_MEMORY_NEGATIVE_CACHE_MS,
      DEFAULTS.negativeCacheMs, 1000, 15 * 60 * 1000),
    maxNegativeEntries: DEFAULTS.maxNegativeEntries
  });
}

function defaultQuery(timeoutMs) {
  return (sql, params) => queryEngineShadow(sql, params, { timeoutSqlMs: timeoutMs });
}

function memoryIdentity(metadata = {}) {
  const identity = metadata.identity || {};
  if (identity.confirmed !== true || identity.divergent === true || !identity.marketplace || !identity.identityKey) {
    return null;
  }
  const productId = text(identity.productId, 180) || (identity.sku ? `sku:${text(identity.sku, 170)}` : "");
  if (!productId || !identity.evidenceHash) return null;
  return Object.freeze({
    marketplace: text(identity.marketplace, 40),
    productId,
    sku: text(identity.sku, 180),
    variantKey: text(identity.variant, 180),
    identityKey: text(identity.identityKey, 600),
    identityEvidenceHash: text(identity.evidenceHash, 64),
    source: text(identity.source, 80).toLowerCase()
  });
}

function memoryScope(metadata = {}, workspaceId = "") {
  const identity = memoryIdentity(metadata);
  if (!identity) return { ok: false, reason: "memory_identity_unconfirmed" };
  if (GLOBAL_OFFICIAL_SOURCES.has(identity.source)) {
    return { ok: true, scopeType: "global", workspaceId: "", identity };
  }
  const workspace = text(workspaceId, 120);
  if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(workspace)) {
    return { ok: false, reason: "memory_private_workspace_required" };
  }
  return { ok: true, scopeType: "workspace", workspaceId: workspace, identity };
}

function stableAttributes(offer = {}) {
  const raw = offer.raw && typeof offer.raw === "object" ? offer.raw : {};
  const metadata = (offer.metadata && typeof offer.metadata === "object" ? offer.metadata : raw.metadata) || {};
  const product = metadata.produto && typeof metadata.produto === "object" ? metadata.produto : {};
  const first = (...values) => values.map(value => text(value, 120)).find(Boolean) || null;
  return {
    brand: first(offer.marca, offer.brand, product.marca, product.brand),
    model: first(offer.modelo, offer.model, product.modelo, product.model),
    capacity: first(offer.capacidade, offer.capacity, product.capacidade, product.capacity),
    quantity: first(offer.quantidade, offer.quantity, product.quantidade, product.quantity)
  };
}

function buildMemoryRecord(offer = {}, metadata = {}, workspaceId = "") {
  const scope = memoryScope(metadata, workspaceId);
  if (!scope.ok) return scope;
  const attrs = stableAttributes(offer);
  return {
    ok: true,
    record: {
      scopeType: scope.scopeType,
      workspaceId: scope.workspaceId,
      marketplace: scope.identity.marketplace,
      productId: scope.identity.productId,
      sku: scope.identity.sku,
      variantKey: scope.identity.variantKey,
      identityKey: scope.identity.identityKey,
      identityEvidenceHash: scope.identity.identityEvidenceHash,
      factualTitle: metadata.factualTitle?.factual === true ? metadata.factualTitle.title : null,
      ...attrs,
      categoryPrimary: metadata.category?.principal || "Diversos",
      categoryAffinities: metadata.category?.affinities || [],
      classificationStatus: metadata.classificationStatus || "pending",
      safetyClass: metadata.safety?.class || "uncertain",
      source: scope.identity.source,
      confidence: metadata.category?.confidence || metadata.factualTitle?.confidence || "unconfirmed",
      schemaVersion: metadata.schemaVersion || "optimus-intelligence-v1-phase-a",
      classifierVersion: metadata.category?.classifierVersion || metadata.schemaVersion || "unknown",
      confirmedAt: new Date().toISOString(),
      negativeUntil: null
    }
  };
}

function memoryKey(record = {}) {
  return [record.scopeType, record.workspaceId, record.marketplace, record.productId,
    record.sku, record.variantKey].join("|");
}

function pruneNegativeCache(now = Date.now(), limits = DEFAULTS) {
  for (const [key, expiresAt] of runtime.negativeCache) {
    if (expiresAt <= now) runtime.negativeCache.delete(key);
  }
  while (runtime.negativeCache.size > limits.maxNegativeEntries) {
    runtime.negativeCache.delete(runtime.negativeCache.keys().next().value);
  }
}

function markNegative(key, limits, now = Date.now()) {
  runtime.negativeCache.set(key, now + limits.negativeCacheMs);
  pruneNegativeCache(now, limits);
}

async function ensureTableAvailable(query, limits, now = Date.now()) {
  if (runtime.tableAvailable !== null && runtime.tableCheckedUntil > now) {
    return runtime.tableAvailable;
  }
  const result = await tableAvailable({ query });
  runtime.tableAvailable = result.ok === true && result.available === true;
  runtime.tableCheckedUntil = now + limits.tableCacheMs;
  return runtime.tableAvailable;
}

async function readThroughMemoryV1({ offer = {}, metadata = {}, workspaceId = "", query,
  env = process.env, now = Date.now() } = {}) {
  if (memoryMode(env) !== MEMORY_MODES.SHADOW) {
    return { ok: true, mode: MEMORY_MODES.OFF, memory: null, queries: 0 };
  }
  const limits = memoryLimits(env);
  const built = buildMemoryRecord(offer, metadata, workspaceId);
  if (!built.ok) return { ok: true, mode: MEMORY_MODES.SHADOW, skipped: true, reason: built.reason, queries: 0 };
  const key = memoryKey(built.record);
  pruneNegativeCache(now, limits);
  if ((runtime.negativeCache.get(key) || 0) > now) {
    return { ok: true, mode: MEMORY_MODES.SHADOW, skipped: true, reason: "memory_negative_cache", queries: 0 };
  }
  const safeQuery = query || defaultQuery(limits.timeoutMs);
  let queries = 1;
  if (!(await ensureTableAvailable(safeQuery, limits, now))) {
    markNegative(key, limits, now);
    return { ok: false, mode: MEMORY_MODES.SHADOW, reason: "memory_table_unavailable", queries };
  }

  let existing = null;
  if (built.record.scopeType === "workspace") {
    const workspaceRead = await readProductMemory({ query: safeQuery, ...built.record,
      scopeType: "workspace", workspaceId: built.record.workspaceId });
    queries += 1;
    if (workspaceRead.ok && workspaceRead.record && !workspaceRead.record.invalidated_at) existing = workspaceRead.record;
  }
  if (!existing) {
    const globalRead = await readProductMemory({ query: safeQuery, ...built.record,
      scopeType: "global", workspaceId: "" });
    queries += 1;
    if (globalRead.ok && globalRead.record && !globalRead.record.invalidated_at) existing = globalRead.record;
  }

  const written = await upsertProductMemory({ query: safeQuery, record: built.record });
  queries += 1;
  if (!written.ok) {
    markNegative(key, limits, now);
    return { ok: false, mode: MEMORY_MODES.SHADOW, reason: written.reason || "memory_write_failed", queries };
  }
  return {
    ok: true,
    mode: MEMORY_MODES.SHADOW,
    memory: existing,
    persisted: true,
    conflict: written.conflict === true,
    revision: Number(written.record?.record_revision || 0),
    queries
  };
}

function pumpQueue() {
  runtime.scheduled = false;
  const limits = memoryLimits();
  while (runtime.running < limits.maxConcurrency && runtime.queue.length) {
    const task = runtime.queue.shift();
    runtime.queuedKeys.delete(task.key);
    runtime.running += 1;
    runtime.inFlight.add(task.key);
    Promise.resolve()
      .then(() => readThroughMemoryV1(task.payload))
      .then(result => {
        runtime.completed += 1;
        if (!result.ok) runtime.failed += 1;
      })
      .catch(() => { runtime.failed += 1; })
      .finally(() => {
        runtime.running -= 1;
        runtime.inFlight.delete(task.key);
        schedulePump();
      });
  }
}

function schedulePump() {
  if (runtime.scheduled || !runtime.queue.length) return;
  runtime.scheduled = true;
  queueMicrotask(pumpQueue);
}

function scheduleMemoryObservation({ offer = {}, metadata = {}, workspaceId = "", env = process.env, query } = {}) {
  if (memoryMode(env) !== MEMORY_MODES.SHADOW) {
    return { mode: MEMORY_MODES.OFF, scheduled: false, reason: "memory_off" };
  }
  const built = buildMemoryRecord(offer, metadata, workspaceId);
  if (!built.ok) return { mode: MEMORY_MODES.SHADOW, scheduled: false, reason: built.reason };
  const limits = memoryLimits(env);
  const key = memoryKey(built.record);
  if (runtime.inFlight.has(key) || runtime.queuedKeys.has(key)) {
    return { mode: MEMORY_MODES.SHADOW, scheduled: false, reason: "memory_single_flight" };
  }
  if (runtime.queue.length >= limits.maxQueue) {
    runtime.dropped += 1;
    return { mode: MEMORY_MODES.SHADOW, scheduled: false, reason: "memory_queue_full" };
  }
  runtime.queue.push({ key, payload: { offer, metadata, workspaceId, env, query } });
  runtime.queuedKeys.add(key);
  schedulePump();
  return { mode: MEMORY_MODES.SHADOW, scheduled: true, queueDepth: runtime.queue.length };
}

function memoryRuntimeStatus() {
  return Object.freeze({
    queueDepth: runtime.queue.length,
    running: runtime.running,
    inFlight: runtime.inFlight.size,
    negativeCacheSize: runtime.negativeCache.size,
    completed: runtime.completed,
    failed: runtime.failed,
    dropped: runtime.dropped
  });
}

async function drainMemoryQueueForTests(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while ((runtime.running || runtime.queue.length || runtime.scheduled) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return memoryRuntimeStatus();
}

function resetMemoryRuntimeForTests() {
  runtime.queue.length = 0;
  runtime.running = 0;
  runtime.inFlight.clear();
  runtime.queuedKeys.clear();
  runtime.negativeCache.clear();
  runtime.tableAvailable = null;
  runtime.tableCheckedUntil = 0;
  runtime.scheduled = false;
  runtime.completed = 0;
  runtime.failed = 0;
  runtime.dropped = 0;
}

module.exports = {
  MEMORY_MODES,
  DEFAULTS,
  memoryMode,
  memoryLimits,
  memoryIdentity,
  memoryScope,
  buildMemoryRecord,
  readThroughMemoryV1,
  scheduleMemoryObservation,
  memoryRuntimeStatus,
  drainMemoryQueueForTests,
  resetMemoryRuntimeForTests
};
