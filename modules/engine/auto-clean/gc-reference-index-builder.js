"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  hashRenderEmValor,
  selecionarConteudoVivo,
  REFERENCE_REASON
} = require("./gc-reference-index");
const {
  FILA_GC_REFERENCES_ARQUIVO,
  projecaoCobreFilaViva
} = require("../../fila/fila-gc-references");

const SCHEMA_VERSION = 2;
const INDEX_ROOT = path.join("auto-clean", "gc-references");
const CURRENT_FILE = "current.json";
const BUILDING_FILE = "building.json";
const DEFAULT_BUILD_BYTES = 16 * 1024 * 1024;
const DEFAULT_BUILD_DURATION_MS = 750;
const MAX_INDEX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_QUEUE_PROJECTION_BYTES = 4 * 1024 * 1024;
const INDEX_MAX_AGE_MS = 30 * 60 * 1000;
const HISTORY_DAYS = 7;
const REASON = Object.freeze({
  INDEX_MISSING: "REFERENCE_INDEX_MISSING",
  INDEX_STALE: "REFERENCE_INDEX_STALE",
  INDEX_CORRUPT: "REFERENCE_INDEX_CORRUPT",
  BUILD_INCOMPLETE: "REFERENCE_INDEX_BUILD_INCOMPLETE",
  BUILD_BUDGET: "REFERENCE_INDEX_BUILD_BUDGET",
  BUILD_TIME: "REFERENCE_INDEX_BUILD_TIME",
  COMPACT_SOURCE_MISSING: "REFERENCE_COMPACT_SOURCE_MISSING",
  COMPACT_SOURCE_STALE: "REFERENCE_COMPACT_SOURCE_STALE",
  COMPACT_SOURCE_TOO_LARGE: "REFERENCE_COMPACT_SOURCE_TOO_LARGE",
  SOURCE_CHANGED: REFERENCE_REASON.SOURCE_CHANGED,
  SOURCE_READ_ERROR: REFERENCE_REASON.READ_ERROR,
  SOURCE_INVALID_JSON: REFERENCE_REASON.FILE_INVALID_JSON,
  JSONL_PARSE_ERROR: REFERENCE_REASON.JSONL_PARSE_ERROR,
  INDEX_TOO_LARGE: "REFERENCE_INDEX_TOO_LARGE"
});

function generationId(nowMs) {
  return `${nowMs}-${crypto.randomBytes(6).toString("hex")}`;
}

function indexDir(dataDir, workspaceId) {
  return path.join(dataDir, INDEX_ROOT, workspaceId);
}

function safeMeta(stat, key, kind, source, file) {
  const dev = stat.dev;
  const ino = stat.ino;
  const devValido = typeof dev === "bigint" ? dev >= 0n : Number.isFinite(Number(dev)) && Number(dev) >= 0;
  const inoValido = typeof ino === "bigint" ? ino > 0n : Number.isFinite(Number(ino)) && Number(ino) > 0;
  return {
    key,
    kind,
    source,
    file: path.basename(file),
    size: Number(stat.size || 0),
    mtimeMs: Math.trunc(Number(stat.mtimeMs || 0)),
    identity: devValido && inoValido
      ? `${dev}:${ino}`
      : ""
  };
}

async function statOptional(file, fsApi) {
  try {
    const stat = await fsApi.lstat(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) return { invalid: true };
    return { stat };
  } catch (error) {
    if (error?.code === "ENOENT") return { missing: true };
    return { error: true };
  }
}

function snapshotComparable(discovery) {
  return [...discovery.guards, ...discovery.sources]
    .map(item => ({ key: item.key, size: item.size, mtimeMs: item.mtimeMs }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function sameSnapshot(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function sourceMeta(source = {}) {
  return {
    key: source.key,
    kind: source.kind,
    source: source.source,
    file: source.file,
    size: Number(source.size || 0),
    mtimeMs: Number(source.mtimeMs || 0),
    identity: String(source.identity || "")
  };
}

function sourceState(source = {}) {
  return {
    ...sourceMeta(source),
    targetSize: Number(source.size || 0),
    cursor: 0,
    complete: false,
    refs: {}
  };
}

function validateSourceState(value = {}) {
  return typeof value?.key === "string" &&
    ["jsonl", "projection", "queueRefs", "array", "vitrine", "manual"].includes(value?.kind) &&
    typeof value?.source === "string" && typeof value?.file === "string" &&
    Number.isInteger(value?.targetSize) && value.targetSize >= 0 &&
    Number.isInteger(value?.cursor) && value.cursor >= 0 && value.cursor <= value.targetSize &&
    typeof value?.complete === "boolean" && validateRefs(value?.refs);
}

function validateSourceStates(value = {}, order = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(order)) return false;
  if (!order.every(key => typeof key === "string" && validateSourceState(value[key]))) return false;
  return Object.keys(value).every(key => order.includes(key));
}

function rebuildRefs(state = {}) {
  const refs = {};
  for (const key of state.sourceOrder || []) {
    const item = state.sourceStates?.[key];
    if (!item) continue;
    for (const hash of Object.keys(item.refs || {})) {
      const origins = new Set(refs[hash] || []);
      origins.add(item.source);
      refs[hash] = [...origins].sort();
    }
  }
  state.refs = refs;
  return refs;
}

function sameSourceMeta(a = {}, b = {}) {
  return Number(a.size || 0) === Number(b.size || 0) &&
    Number(a.mtimeMs || 0) === Number(b.mtimeMs || 0) &&
    (!a.identity || !b.identity || a.identity === b.identity);
}

function sourceReplaced(a = {}, b = {}) {
  return Boolean(a.identity && b.identity && a.identity !== b.identity);
}

function jsonlDate(key = "") {
  const match = String(key).match(/:(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : "";
}

function jsonlExpiredFromWindow(key = "", discovery = {}) {
  const date = jsonlDate(key);
  if (!date) return false;
  const currentDates = (discovery.sources || []).filter(item => item.kind === "jsonl")
    .map(item => jsonlDate(item.key)).filter(Boolean).sort();
  return currentDates.length > 0 && date < currentDates[0];
}

async function discoverSources({ dataDir, workspaceId, nowMs, fsApi, validatedQueueProjection = null }) {
  const root = path.join(dataDir, "clientes", workspaceId);
  const guards = [];
  const sources = [];
  let discoveryError = null;
  let bytesRead = 0;
  let validatedQueueProjectionNext = null;

  const guardFiles = [
    ["guard:fila", "fila.json"],
    ["guard:historico", "fila-historico.json"]
  ];
  for (const [key, name] of guardFiles) {
    const file = path.join(root, name);
    const found = await statOptional(file, fsApi);
    if (found.error || found.invalid) discoveryError ||= { reasonCode: REASON.SOURCE_READ_ERROR, source: "guard", file: name };
    if (found.stat) guards.push(safeMeta(found.stat, key, "guard", "guard", file));
  }
  const legacyGuards = [...guards];
  const filaVivaFile = path.join(root, "fila-viva.json");
  const filaVivaFound = await statOptional(filaVivaFile, fsApi);
  if (filaVivaFound.error || filaVivaFound.invalid) {
    discoveryError ||= { reasonCode: REASON.SOURCE_READ_ERROR, source: "fila", file: "fila-viva.json" };
  }
  if (filaVivaFound.stat) {
    guards.push(safeMeta(filaVivaFound.stat, "guard:fila-viva", "guard", "fila", filaVivaFile));
  }

  const compact = [
    ["compact:projecao", "fila-projecao-leve.json", "projection", "fila"],
    ["compact:fila-gc-references", FILA_GC_REFERENCES_ARQUIVO, "queueRefs", "fila"],
    ["compact:vitrine", "vitrine.json", "vitrine", "vitrine"],
    ["compact:manual", "manual_ofertas_v2.json", "manual", "manual"],
    ["compact:achados-v2", "manual_achados_v2.json", "array", "manual"],
    ["compact:listas-v2", "manual_listas_v2.json", "array", "manual"],
    ["compact:social-agendamentos", "social-agendamentos.json", "array", "social"],
    ["compact:social-rascunhos", "social-rascunhos.json", "array", "social"],
    ["compact:social-publicacoes", "social-publicacoes.json", "array", "social"],
    ["compact:social-oportunidades", "social-oportunidades.json", "array", "social"]
  ];
  for (const [key, name, kind, source] of compact) {
    const file = path.join(root, name);
    const found = await statOptional(file, fsApi);
    if (found.error || found.invalid) discoveryError ||= { reasonCode: REASON.SOURCE_READ_ERROR, source, file: name };
    if (found.stat) sources.push({ ...safeMeta(found.stat, key, kind, source, file), absolutePath: file });
  }

  for (let day = HISTORY_DAYS; day >= 0; day -= 1) {
    const date = new Date(nowMs - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const folder of ["fila-historico-leve-incremental", "fila-historico-incremental"]) {
      const file = path.join(root, folder, `${date}.jsonl`);
      const found = await statOptional(file, fsApi);
      if (found.error || found.invalid) {
        discoveryError ||= { reasonCode: REASON.SOURCE_READ_ERROR, source: "historico", file: path.basename(file) };
      }
      if (found.stat) {
        sources.push({ ...safeMeta(found.stat, `jsonl:${folder}:${date}`, "jsonl", "historico", file), absolutePath: file });
      }
    }
  }

  const projection = sources.find(item => item.key === "compact:projecao");
  if (legacyGuards.length && !projection) {
    discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_MISSING, source: "fila", file: "fila-projecao-leve.json" };
  }
  if (projection) {
    const newestGuard = legacyGuards.reduce((max, item) => Math.max(max, item.mtimeMs), 0);
    if (newestGuard > projection.mtimeMs) {
      discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_STALE, source: "fila", file: projection.file };
    }
  }
  const filaVivaGuard = guards.find(item => item.key === "guard:fila-viva");
  const filaGcProjection = sources.find(item => item.key === "compact:fila-gc-references");
  if (filaVivaGuard && !filaGcProjection) {
    discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_MISSING, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
  } else if (filaGcProjection && !filaVivaGuard) {
    discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_STALE, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
  } else if (filaGcProjection && filaVivaGuard && !discoveryError) {
    if (filaGcProjection.size > MAX_QUEUE_PROJECTION_BYTES) {
      discoveryError = { reasonCode: REASON.COMPACT_SOURCE_TOO_LARGE, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
    } else {
      try {
        const reusable = validatedQueueProjection &&
          sameSourceMeta(validatedQueueProjection.projectionMeta, filaGcProjection) &&
          sameSourceMeta(validatedQueueProjection.queueGuard, filaVivaGuard) &&
          projecaoCobreFilaViva(validatedQueueProjection.value, workspaceId, filaVivaGuard);
        let parsed;
        if (reusable) {
          parsed = validatedQueueProjection.value;
        } else {
          const content = await fsApi.readFile(filaGcProjection.absolutePath, "utf8");
          bytesRead += Buffer.byteLength(content, "utf8");
          parsed = JSON.parse(content);
        }
        const checked = await statOptional(filaGcProjection.absolutePath, fsApi);
        if (!checked.stat || !sameSourceMeta(filaGcProjection,
          safeMeta(checked.stat, filaGcProjection.key, filaGcProjection.kind, filaGcProjection.source, filaGcProjection.absolutePath))) {
          discoveryError = { reasonCode: REASON.SOURCE_CHANGED, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
        } else if (!projecaoCobreFilaViva(parsed, workspaceId, filaVivaGuard)) {
          discoveryError = { reasonCode: REASON.COMPACT_SOURCE_STALE, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
        } else {
          const currentGuard = await statOptional(filaVivaFile, fsApi);
          if (!currentGuard.stat || !sameSourceMeta(filaVivaGuard,
            safeMeta(currentGuard.stat, "guard:fila-viva", "guard", "fila", filaVivaFile))) {
            discoveryError = { reasonCode: REASON.COMPACT_SOURCE_STALE, source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
          } else {
            filaGcProjection.prevalidatedValue = parsed;
            validatedQueueProjectionNext = {
              projectionMeta: sourceMeta(filaGcProjection),
              queueGuard: sourceMeta(filaVivaGuard),
              value: parsed
            };
          }
        }
      } catch (error) {
        discoveryError = { reasonCode: error instanceof SyntaxError ? REASON.SOURCE_INVALID_JSON : REASON.SOURCE_READ_ERROR,
          source: "fila", file: FILA_GC_REFERENCES_ARQUIVO };
      }
    }
  }

  return { guards, sources, error: discoveryError, bytesRead,
    validatedQueueProjection: validatedQueueProjectionNext,
    snapshot: snapshotComparable({ guards, sources }) };
}

function validateRefs(refs) {
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return false;
  return Object.entries(refs).every(([hash, origins]) =>
    /^[a-f0-9]{32,64}$/.test(hash) && Array.isArray(origins) &&
    origins.every(origin => typeof origin === "string" && origin.length <= 80)
  );
}

function validateCurrent(value, workspaceId) {
  return value?.schemaVersion === SCHEMA_VERSION && value?.status === "complete" &&
    value?.workspaceId === workspaceId && Number.isFinite(value?.completedAtMs) &&
    Array.isArray(value?.sourceSnapshot) && Array.isArray(value?.sourceOrder) &&
    validateSourceStates(value?.sourceStates, value?.sourceOrder) && validateRefs(value?.refs);
}

function validateBuilding(value, workspaceId) {
  return value?.schemaVersion === SCHEMA_VERSION && value?.status === "building" &&
    value?.workspaceId === workspaceId && typeof value?.generation === "string" &&
    Number.isInteger(value?.sourceIndex) && value.sourceIndex >= 0 &&
    Number.isInteger(value?.sourceCursor) && value.sourceCursor >= 0 &&
    Array.isArray(value?.sourceSnapshot) && Array.isArray(value?.sourceOrder) &&
    validateSourceStates(value?.sourceStates, value?.sourceOrder) && validateRefs(value?.refs);
}

async function readSmallJson(file, workspaceId, validator, fsApi) {
  try {
    const stat = await fsApi.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_FILE_BYTES) {
      return { ok: false, reasonCode: REASON.INDEX_CORRUPT };
    }
    const value = JSON.parse(await fsApi.readFile(file, "utf8"));
    return validator(value, workspaceId)
      ? { ok: true, value }
      : { ok: false, reasonCode: REASON.INDEX_CORRUPT };
  } catch (error) {
    return error?.code === "ENOENT"
      ? { ok: false, reasonCode: REASON.INDEX_MISSING }
      : { ok: false, reasonCode: REASON.INDEX_CORRUPT };
  }
}

async function atomicWriteJson(file, value, fsApi) {
  await fsApi.mkdir(path.dirname(file), { recursive: true });
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_INDEX_FILE_BYTES) {
    const error = new Error(REASON.INDEX_TOO_LARGE);
    error.code = REASON.INDEX_TOO_LARGE;
    throw error;
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fsApi.writeFile(tmp, serialized, { flag: "wx" });
  await fsApi.rename(tmp, file);
}

function refsToMap(refs) {
  return new Map(Object.entries(refs || {}).map(([hash, origins]) => [hash, new Set(origins)]));
}

function addValueRefs(value, workspaceId, source, refs, depth = 0) {
  if (depth > 32) {
    const error = new Error(REFERENCE_REASON.COMPLEXITY_LIMIT);
    error.code = REFERENCE_REASON.COMPLEXITY_LIMIT;
    throw error;
  }
  if (typeof value === "string") {
    for (const hash of hashRenderEmValor(value, workspaceId)) {
      const origins = new Set(refs[hash] || []);
      origins.add(source);
      refs[hash] = [...origins].sort();
    }
  } else if (Array.isArray(value)) {
    for (const item of value) addValueRefs(item, workspaceId, source, refs, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) addValueRefs(item, workspaceId, source, refs, depth + 1);
  }
}

function liveDocument(parsed, source, file, nowMs, workspaceId) {
  if (source.kind === "projection") {
    if (!parsed || parsed.versao !== 1 || String(parsed.clienteId || "") !== workspaceId || !Array.isArray(parsed.itens)) {
      const error = new Error(REFERENCE_REASON.FORMAT_INVALID);
      error.code = REFERENCE_REASON.FORMAT_INVALID;
      throw error;
    }
    return selecionarConteudoVivo(parsed, file, "historico", nowMs);
  }
  if (source.kind === "vitrine") return selecionarConteudoVivo(parsed, file, "vitrine", nowMs);
  if (!Array.isArray(parsed)) {
    const error = new Error(REFERENCE_REASON.FORMAT_INVALID);
    error.code = REFERENCE_REASON.FORMAT_INVALID;
    throw error;
  }
  return selecionarConteudoVivo(parsed, file, source.source, nowMs);
}

async function processJsonSource({ source, workspaceId, nowMs, remainingBytes, maxBytes, fsApi, queueGuard, queueGuardPath }) {
  const prevalidatedQueueProjection = source.kind === "queueRefs" && source.prevalidatedValue;
  if (!prevalidatedQueueProjection && source.size > remainingBytes) {
    return { complete: false, bytes: 0,
      reasonCode: source.size > maxBytes ? REASON.COMPACT_SOURCE_TOO_LARGE : REASON.BUILD_BUDGET };
  }
  let parsed;
  if (prevalidatedQueueProjection) {
    parsed = source.prevalidatedValue;
  } else {
    let content;
    try { content = await fsApi.readFile(source.absolutePath, "utf8"); }
    catch { return { complete: false, bytes: 0, fatal: true, reasonCode: REASON.SOURCE_READ_ERROR }; }
    try { parsed = JSON.parse(content); }
    catch { return { complete: false, bytes: source.size, fatal: true, reasonCode: REASON.SOURCE_INVALID_JSON }; }
  }
  const refs = {};
  try {
    if (source.kind === "queueRefs") {
      if (!projecaoCobreFilaViva(parsed, workspaceId, queueGuard)) {
        return { complete: false, bytes: source.size, fatal: true, reasonCode: REASON.COMPACT_SOURCE_STALE };
      }
      for (const hash of parsed.hashes) refs[hash] = [source.source];
    } else {
      addValueRefs(liveDocument(parsed, source, source.file, nowMs, workspaceId), workspaceId, source.source, refs);
    }
  }
  catch (error) {
    return { complete: false, bytes: source.size, fatal: true,
      reasonCode: error?.code || REFERENCE_REASON.FORMAT_INVALID };
  }
  const after = await statOptional(source.absolutePath, fsApi);
  if (!after.stat) {
    return { complete: false, bytes: source.size, changed: true,
      reasonCode: after.error || after.invalid ? REASON.SOURCE_READ_ERROR : REASON.SOURCE_CHANGED };
  }
  const afterMeta = safeMeta(after.stat, source.key, source.kind, source.source, source.absolutePath);
  if (!sameSourceMeta(source, afterMeta)) {
    return { complete: false, bytes: source.size, changed: true, reasonCode: REASON.SOURCE_CHANGED };
  }
  if (prevalidatedQueueProjection && queueGuardPath) {
    const latestGuard = await statOptional(queueGuardPath, fsApi);
    if (!latestGuard.stat || !sameSourceMeta(queueGuard,
      safeMeta(latestGuard.stat, "guard:fila-viva", "guard", "fila", queueGuardPath))) {
      return { complete: false, bytes: 0, changed: true, reasonCode: REASON.COMPACT_SOURCE_STALE };
    }
  }
  return { complete: true, bytes: prevalidatedQueueProjection ? 0 : source.size, refs };
}

function mergeSourceRefs(target = {}, chunk = {}) {
  for (const [hash, origins] of Object.entries(chunk)) {
    const merged = new Set(target[hash] || []);
    for (const origin of origins || []) merged.add(origin);
    target[hash] = [...merged].sort();
  }
}

async function processJsonlSource({ source, sourceProgress, workspaceId, nowMs, remainingBytes, fsApi }) {
  const cursor = sourceProgress.cursor || 0;
  const targetSize = sourceProgress.targetSize;
  if (cursor >= targetSize) return { complete: true, bytes: 0, nextCursor: targetSize };
  const toRead = Math.min(remainingBytes, targetSize - cursor);
  if (toRead <= 0) return { complete: false, bytes: 0, reasonCode: REASON.BUILD_BUDGET };
  const buffer = Buffer.allocUnsafe(toRead);
  let handle;
  let bytesRead = 0;
  try {
    handle = await fsApi.open(source.absolutePath, "r");
    ({ bytesRead } = await handle.read(buffer, 0, toRead, cursor));
  } catch {
    return { complete: false, bytes: 0, fatal: true, reasonCode: REASON.SOURCE_READ_ERROR };
  } finally {
    if (handle) { try { await handle.close(); } catch {} }
  }
  const reachedEnd = cursor + bytesRead >= targetSize;
  let usable = bytesRead;
  if (!reachedEnd) {
    const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (lastNewline < 0) {
      return { complete: false, bytes: 0, fatal: true, reasonCode: REASON.COMPACT_SOURCE_TOO_LARGE };
    }
    usable = lastNewline + 1;
  }
  const text = buffer.subarray(0, usable).toString("utf8");
  const chunkRefs = {};
  let lineNumber = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineNumber += 1;
    let parsed;
    try { parsed = JSON.parse(line); }
    catch {
      return { complete: false, bytes: usable, fatal: true, reasonCode: REASON.JSONL_PARSE_ERROR, lineNumber };
    }
    try {
      const live = selecionarConteudoVivo([parsed], "fila-historico.json", "historico", nowMs);
      addValueRefs(live, workspaceId, source.source, chunkRefs);
    } catch (error) {
      return { complete: false, bytes: usable, fatal: true,
        reasonCode: error?.code || REFERENCE_REASON.COMPLEXITY_LIMIT, lineNumber };
    }
  }
  const after = await statOptional(source.absolutePath, fsApi);
  if (!after.stat) {
    return { complete: false, bytes: usable, dangerous: true,
      reasonCode: after.error || after.invalid ? REASON.SOURCE_READ_ERROR : REASON.SOURCE_CHANGED };
  }
  const afterMeta = safeMeta(after.stat, source.key, source.kind, source.source, source.absolutePath);
  if (sourceReplaced(sourceProgress, afterMeta) || afterMeta.size < targetSize) {
    return { complete: false, bytes: usable, dangerous: true, reasonCode: REASON.SOURCE_CHANGED };
  }
  mergeSourceRefs(sourceProgress.refs, chunkRefs);
  const complete = cursor + usable >= targetSize;
  return { complete, bytes: usable, nextCursor: cursor + usable,
    reasonCode: complete ? "" : REASON.BUILD_BUDGET };
}

function newBuilding(workspaceId, discovery, nowMs) {
  const order = discovery.sources.map(source => source.key);
  const states = Object.fromEntries(discovery.sources.map(source => [source.key, sourceState(source)]));
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "building",
    workspaceId,
    generation: generationId(nowMs),
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    sourceIndex: 0,
    sourceCursor: 0,
    sourceSnapshot: discovery.snapshot,
    sourceOrder: order,
    sourceStates: states,
    refs: {}
  };
}

function buildingFromCurrent(current, discovery, nowMs) {
  return {
    ...JSON.parse(JSON.stringify(current)),
    status: "building",
    generation: generationId(nowMs),
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    sourceIndex: Number(current.sourceOrder?.length || 0),
    sourceCursor: 0,
    sourceSnapshot: discovery.snapshot
  };
}

function reconcileState(state, discovery) {
  const currentByKey = new Map(discovery.sources.map(source => [source.key, source]));
  const previousOrder = [...(state.sourceOrder || [])];
  const activeKey = previousOrder[state.sourceIndex] || "";

  for (const key of previousOrder) {
    if (currentByKey.has(key)) continue;
    const previous = state.sourceStates[key];
    if (previous?.kind === "jsonl" && !jsonlExpiredFromWindow(key, discovery)) {
      return { dangerous: true, reasonCode: REASON.SOURCE_CHANGED, source: previous.source, file: previous.file };
    }
    delete state.sourceStates[key];
  }

  for (const source of discovery.sources) {
    const previous = state.sourceStates[source.key];
    if (!previous) {
      state.sourceStates[source.key] = sourceState(source);
      continue;
    }
    if (previous.kind !== source.kind || previous.source !== source.source) {
      return { dangerous: true, reasonCode: REASON.SOURCE_CHANGED, source: source.source, file: source.file };
    }
    if (source.kind === "jsonl") {
      if (sourceReplaced(previous, source) || source.size < previous.cursor || source.size < previous.targetSize ||
          (source.size === previous.targetSize && source.mtimeMs !== previous.mtimeMs)) {
        return { dangerous: true, reasonCode: REASON.SOURCE_CHANGED, source: source.source, file: source.file };
      }
      if (source.size > previous.targetSize) {
        previous.targetSize = source.size;
        previous.complete = previous.cursor >= previous.targetSize;
      }
      Object.assign(previous, sourceMeta(source));
      continue;
    }
    if (!sameSourceMeta(previous, source)) {
      Object.assign(previous, sourceMeta(source), {
        targetSize: source.size,
        cursor: 0,
        complete: false,
        refs: {}
      });
    }
  }

  state.sourceOrder = discovery.sources.map(source => source.key);
  state.sourceSnapshot = discovery.snapshot;
  if (activeKey && state.sourceOrder.includes(activeKey)) {
    state.sourceIndex = state.sourceOrder.indexOf(activeKey);
  } else {
    state.sourceIndex = Math.min(Number(state.sourceIndex || 0), state.sourceOrder.length);
  }
  if (state.sourceIndex >= state.sourceOrder.length) {
    const pending = state.sourceOrder.findIndex(key => state.sourceStates[key]?.complete !== true);
    state.sourceIndex = pending >= 0 ? pending : state.sourceOrder.length;
  }
  const current = state.sourceStates[state.sourceOrder[state.sourceIndex]];
  state.sourceCursor = current?.cursor || 0;
  rebuildRefs(state);
  return { dangerous: false };
}

function hasPendingSources(state = {}) {
  return (state.sourceOrder || []).some(key => state.sourceStates?.[key]?.complete !== true);
}

function sanitizedBuild(result) {
  return {
    workspace: result.workspaceId,
    generation: result.generation || "",
    source: result.source || "",
    bytesProcessed: result.bytesProcessed || 0,
    refsFound: result.refsFound || 0,
    complete: result.complete === true,
    durationMs: result.durationMs || 0,
    nextCursor: result.nextCursor || 0,
    reasonCode: result.reasonCode || ""
  };
}

async function buildOrLoadReferenceIndex(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const started = clock();
  const fsApi = options.fsApi || fs.promises;
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const workspaceId = String(options.workspaceId || "");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxBytes = Math.max(1, Number(options.maxBytesPerRun) || DEFAULT_BUILD_BYTES);
  const maxDurationMs = Math.max(1, Number(options.maxDurationMs) || DEFAULT_BUILD_DURATION_MS);
  const logger = options.logger || console;
  if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId)) {
    return { complete: false, refs: new Map(), reasonCode: "REFERENCE_WORKSPACE_INVALID" };
  }

  const directory = indexDir(dataDir, workspaceId);
  const currentFile = path.join(directory, CURRENT_FILE);
  const buildingFile = path.join(directory, BUILDING_FILE);
  const current = await readSmallJson(currentFile, workspaceId, validateCurrent, fsApi);
  const persisted = await readSmallJson(buildingFile, workspaceId, validateBuilding, fsApi);
  const discovery = await discoverSources({ dataDir, workspaceId, nowMs, fsApi });
  if (discovery.error) {
    return { complete: false, refs: new Map(), ...discovery.error,
      generation: persisted.ok ? persisted.value.generation : "", sourceSnapshot: discovery.snapshot,
      bytesProcessed: discovery.bytesRead || 0 };
  }
  if ((discovery.bytesRead || 0) > maxBytes) {
    return { complete: false, refs: new Map(), workspaceId, reasonCode: REASON.BUILD_BUDGET,
      bytesProcessed: discovery.bytesRead, sourcesRead: discovery.validatedQueueProjection ? 1 : 0,
      durationMs: clock() - started, sourceSnapshot: discovery.snapshot };
  }

  const currentFresh = current.ok &&
    nowMs - current.value.completedAtMs <= (options.maxIndexAgeMs ?? INDEX_MAX_AGE_MS);
  if (current.ok) {
    const probe = JSON.parse(JSON.stringify(current.value));
    const reusable = reconcileState(probe, discovery);
    if (currentFresh && !reusable.dangerous && !hasPendingSources(probe) &&
        sameSnapshot(current.value.sourceSnapshot, discovery.snapshot)) {
      return { complete: true, refs: refsToMap(current.value.refs), generation: current.value.generation,
        refsCount: Object.keys(current.value.refs).length, bytesProcessed: discovery.bytesRead || 0,
        sourcesRead: discovery.validatedQueueProjection ? 1 : 0,
        reasonCode: "", sourceSnapshot: discovery.snapshot };
    }
  }

  const currentCorrupt = current.reasonCode === REASON.INDEX_CORRUPT;
  const persistedAfterCurrent = persisted.ok && current.ok &&
    Number(persisted.value.startedAtMs || 0) > Number(current.value.completedAtMs || 0);
  let state = persisted.ok && !currentCorrupt && (currentFresh || !current.ok || persistedAfterCurrent)
    ? persisted.value
    : (current.ok && currentFresh
      ? buildingFromCurrent(current.value, discovery, nowMs)
      : newBuilding(workspaceId, discovery, nowMs));
  const initialReconciliation = reconcileState(state, discovery);
  if (initialReconciliation.dangerous) {
    const restarted = newBuilding(workspaceId, discovery, nowMs);
    await atomicWriteJson(buildingFile, restarted, fsApi);
    const changed = { complete: false, refs: new Map(), workspaceId, generation: restarted.generation,
      source: initialReconciliation.source || "validation",
      referenceFile: initialReconciliation.file || "",
      reasonCode: initialReconciliation.reasonCode || REASON.SOURCE_CHANGED,
      bytesProcessed: 0, sourcesRead: 0, refsFound: 0, nextCursor: 0,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(changed))); } catch {}
    return changed;
  }
  let bytesProcessed = discovery.bytesRead || 0;
  let sourcesRead = discovery.validatedQueueProjection ? 1 : 0;
  let lastSource = "";
  let lastFile = "";
  let stopReason = REASON.BUILD_INCOMPLETE;

  while (hasPendingSources(state)) {
    if (clock() - started >= maxDurationMs) { stopReason = REASON.BUILD_TIME; break; }
    if (state.sourceIndex >= state.sourceOrder.length || state.sourceStates[state.sourceOrder[state.sourceIndex]]?.complete) {
      const pending = state.sourceOrder.findIndex(key => state.sourceStates[key]?.complete !== true);
      if (pending < 0) break;
      state.sourceIndex = pending;
    }
    const key = state.sourceOrder[state.sourceIndex];
    const source = discovery.sources.find(item => item.key === key);
    const progress = state.sourceStates[key];
    if (!source || !progress) {
      stopReason = REASON.SOURCE_CHANGED;
      break;
    }
    lastSource = source.source;
    lastFile = source.file;
    const remainingBytes = maxBytes - bytesProcessed;
    if (remainingBytes <= 0) { stopReason = REASON.BUILD_BUDGET; break; }
    const result = source.kind === "jsonl"
      ? await processJsonlSource({ source, sourceProgress: progress, workspaceId, nowMs, remainingBytes, fsApi })
      : await processJsonSource({ source, workspaceId, nowMs, remainingBytes, maxBytes, fsApi,
        queueGuard: discovery.guards.find(item => item.key === "guard:fila-viva"),
        queueGuardPath: path.join(dataDir, "clientes", workspaceId, "fila-viva.json") });
    bytesProcessed += result.bytes || 0;
    if (result.dangerous) {
      const latest = await discoverSources({ dataDir, workspaceId, nowMs, fsApi,
        validatedQueueProjection: discovery.validatedQueueProjection });
      bytesProcessed += latest.bytesRead || 0;
      const restarted = newBuilding(workspaceId, latest.error ? discovery : latest, nowMs);
      await atomicWriteJson(buildingFile, restarted, fsApi);
      const changed = { complete: false, refs: new Map(), workspaceId, generation: restarted.generation,
        source: source.source, referenceFile: source.file,
        reasonCode: result.reasonCode || REASON.SOURCE_CHANGED, bytesProcessed,
        sourcesRead, refsFound: 0, nextCursor: 0, durationMs: clock() - started };
      try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(changed))); } catch {}
      return changed;
    }
    if (result.fatal) {
      state.updatedAtMs = nowMs;
      rebuildRefs(state);
      await atomicWriteJson(buildingFile, state, fsApi);
      const failed = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
        source: source.source, referenceFile: source.file, reasonCode: result.reasonCode,
        lineNumber: result.lineNumber, bytesProcessed, refsFound: Object.keys(state.refs).length,
        sourcesRead, nextCursor: progress.cursor, durationMs: clock() - started };
      try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(failed))); } catch {}
      return failed;
    }
    if (result.changed) {
      stopReason = result.reasonCode || REASON.SOURCE_CHANGED;
      break;
    }
    if (source.kind === "jsonl") {
      progress.cursor = result.nextCursor || progress.cursor || 0;
    } else if (result.complete) {
      progress.refs = result.refs || {};
      progress.cursor = progress.targetSize;
    }
    progress.complete = result.complete === true;
    state.sourceCursor = progress.cursor || 0;
    if (!result.complete) { stopReason = result.reasonCode || REASON.BUILD_INCOMPLETE; break; }
    state.sourceIndex += 1;
    state.sourceCursor = 0;
    sourcesRead += 1;
  }

  state.updatedAtMs = nowMs;
  rebuildRefs(state);
  if (hasPendingSources(state)) {
    await atomicWriteJson(buildingFile, state, fsApi);
    const partial = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
      source: lastSource, referenceFile: lastFile, reasonCode: stopReason, bytesProcessed,
      sourcesRead, refsFound: Object.keys(state.refs).length,
      nextCursor: state.sourceStates[state.sourceOrder[state.sourceIndex]]?.cursor || state.sourceCursor,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(partial))); } catch {}
    return partial;
  }

  const finalDiscovery = await discoverSources({ dataDir, workspaceId, nowMs, fsApi,
    validatedQueueProjection: discovery.validatedQueueProjection });
  bytesProcessed += finalDiscovery.bytesRead || 0;
  if (finalDiscovery.error) {
    await atomicWriteJson(buildingFile, state, fsApi);
    const changed = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
      source: finalDiscovery.error.source || "validation",
      referenceFile: finalDiscovery.error.file || "",
      reasonCode: finalDiscovery.error.reasonCode, bytesProcessed, sourcesRead,
      refsFound: Object.keys(state.refs).length, nextCursor: state.sourceCursor,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(changed))); } catch {}
    return changed;
  }
  if (bytesProcessed > maxBytes) {
    state.updatedAtMs = nowMs;
    await atomicWriteJson(buildingFile, state, fsApi);
    const limited = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
      source: "validation", reasonCode: REASON.BUILD_BUDGET, bytesProcessed, sourcesRead,
      refsFound: Object.keys(state.refs).length, nextCursor: state.sourceCursor,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(limited))); } catch {}
    return limited;
  }
  const finalReconciliation = reconcileState(state, finalDiscovery);
  if (finalReconciliation.dangerous) {
    const restarted = newBuilding(workspaceId, finalDiscovery, nowMs);
    await atomicWriteJson(buildingFile, restarted, fsApi);
    const changed = { complete: false, refs: new Map(), workspaceId, generation: restarted.generation,
      source: finalReconciliation.source || "validation",
      referenceFile: finalReconciliation.file || "",
      reasonCode: finalReconciliation.reasonCode || REASON.SOURCE_CHANGED,
      bytesProcessed, sourcesRead, refsFound: 0, nextCursor: 0,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(changed))); } catch {}
    return changed;
  }
  if (hasPendingSources(state)) {
    state.updatedAtMs = nowMs;
    await atomicWriteJson(buildingFile, state, fsApi);
    const changed = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
      source: "validation", reasonCode: REASON.SOURCE_CHANGED,
      bytesProcessed, sourcesRead, refsFound: Object.keys(state.refs).length,
      nextCursor: state.sourceStates[state.sourceOrder[state.sourceIndex]]?.cursor || 0,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(changed))); } catch {}
    return changed;
  }

  const ready = {
    schemaVersion: SCHEMA_VERSION,
    status: "complete",
    workspaceId,
    generation: state.generation,
    startedAtMs: state.startedAtMs,
    completedAtMs: nowMs,
    sourceSnapshot: state.sourceSnapshot,
    sourceOrder: state.sourceOrder,
    sourceStates: state.sourceStates,
    refs: state.refs
  };
  await atomicWriteJson(currentFile, ready, fsApi);
  await atomicWriteJson(buildingFile, buildingFromCurrent(ready, finalDiscovery, nowMs), fsApi);
  const completed = { complete: true, refs: refsToMap(state.refs), workspaceId, generation: state.generation,
    refsCount: Object.keys(state.refs).length, bytesProcessed, sourcesRead, durationMs: clock() - started,
    sourceSnapshot: state.sourceSnapshot };
  try {
    logger.log("[GC-REFERENCE-INDEX-READY]", JSON.stringify({ workspace: workspaceId,
      generation: state.generation, refs: completed.refsCount,
      buildDurationMs: Math.max(0, nowMs - state.startedAtMs) }));
  } catch {}
  return completed;
}

module.exports = {
  buildOrLoadReferenceIndex,
  discoverSources,
  indexDir,
  CURRENT_FILE,
  BUILDING_FILE,
  DEFAULT_BUILD_BYTES,
  DEFAULT_BUILD_DURATION_MS,
  INDEX_MAX_AGE_MS,
  SCHEMA_VERSION,
  REASON
};
