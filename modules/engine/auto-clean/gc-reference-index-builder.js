"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  hashRenderEmValor,
  selecionarConteudoVivo,
  REFERENCE_REASON
} = require("./gc-reference-index");

const SCHEMA_VERSION = 1;
const INDEX_ROOT = path.join("auto-clean", "gc-references");
const CURRENT_FILE = "current.json";
const BUILDING_FILE = "building.json";
const DEFAULT_BUILD_BYTES = 16 * 1024 * 1024;
const DEFAULT_BUILD_DURATION_MS = 750;
const MAX_INDEX_FILE_BYTES = 16 * 1024 * 1024;
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
  return {
    key,
    kind,
    source,
    file: path.basename(file),
    size: Number(stat.size || 0),
    mtimeMs: Math.trunc(Number(stat.mtimeMs || 0))
  };
}

async function statOptional(file, fsApi) {
  try {
    const stat = await fsApi.lstat(file);
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

async function discoverSources({ dataDir, workspaceId, nowMs, fsApi }) {
  const root = path.join(dataDir, "clientes", workspaceId);
  const guards = [];
  const sources = [];
  let discoveryError = null;

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

  const compact = [
    ["compact:projecao", "fila-projecao-leve.json", "projection", "fila"],
    ["compact:fila-viva", "fila-viva.json", "array", "fila"],
    ["compact:vitrine", "vitrine.json", "vitrine", "vitrine"],
    ["compact:manual", "manual_ofertas_v2.json", "manual", "manual"],
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
  if (guards.length && !projection) {
    discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_MISSING, source: "fila", file: "fila-projecao-leve.json" };
  }
  if (projection) {
    const newestGuard = guards.reduce((max, item) => Math.max(max, item.mtimeMs), 0);
    if (newestGuard > projection.mtimeMs) {
      discoveryError ||= { reasonCode: REASON.COMPACT_SOURCE_STALE, source: "fila", file: projection.file };
    }
  }

  return { guards, sources, error: discoveryError, snapshot: snapshotComparable({ guards, sources }) };
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
    Array.isArray(value?.sourceSnapshot) && validateRefs(value?.refs);
}

function validateBuilding(value, workspaceId) {
  return value?.schemaVersion === SCHEMA_VERSION && value?.status === "building" &&
    value?.workspaceId === workspaceId && typeof value?.generation === "string" &&
    Number.isInteger(value?.sourceIndex) && value.sourceIndex >= 0 &&
    Number.isInteger(value?.sourceCursor) && value.sourceCursor >= 0 &&
    Array.isArray(value?.sourceSnapshot) && validateRefs(value?.refs);
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

async function processJsonSource({ source, state, workspaceId, nowMs, remainingBytes, maxBytes, fsApi }) {
  if (source.size > remainingBytes) {
    return { complete: false, bytes: 0,
      reasonCode: source.size > maxBytes ? REASON.COMPACT_SOURCE_TOO_LARGE : REASON.BUILD_BUDGET };
  }
  let content;
  try { content = await fsApi.readFile(source.absolutePath, "utf8"); }
  catch { return { complete: false, bytes: 0, fatal: true, reasonCode: REASON.SOURCE_READ_ERROR }; }
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { return { complete: false, bytes: source.size, fatal: true, reasonCode: REASON.SOURCE_INVALID_JSON }; }
  try { addValueRefs(liveDocument(parsed, source, source.file, nowMs, workspaceId), workspaceId, source.source, state.refs); }
  catch (error) {
    return { complete: false, bytes: source.size, fatal: true,
      reasonCode: error?.code || REFERENCE_REASON.FORMAT_INVALID };
  }
  return { complete: true, bytes: source.size };
}

async function processJsonlSource({ source, state, workspaceId, nowMs, remainingBytes, fsApi }) {
  const cursor = state.sourceCursor || 0;
  if (cursor >= source.size) return { complete: true, bytes: 0, nextCursor: source.size };
  const toRead = Math.min(remainingBytes, source.size - cursor);
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
  const reachedEnd = cursor + bytesRead >= source.size;
  let usable = bytesRead;
  if (!reachedEnd) {
    const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (lastNewline < 0) {
      return { complete: false, bytes: 0, fatal: true, reasonCode: REASON.COMPACT_SOURCE_TOO_LARGE };
    }
    usable = lastNewline + 1;
  }
  const text = buffer.subarray(0, usable).toString("utf8");
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
      addValueRefs(live, workspaceId, source.source, state.refs);
    } catch (error) {
      return { complete: false, bytes: usable, fatal: true,
        reasonCode: error?.code || REFERENCE_REASON.COMPLEXITY_LIMIT, lineNumber };
    }
  }
  const complete = cursor + usable >= source.size;
  return { complete, bytes: usable, nextCursor: cursor + usable,
    reasonCode: complete ? "" : REASON.BUILD_BUDGET };
}

function newBuilding(workspaceId, discovery, nowMs) {
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
    refs: {}
  };
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
  const discovery = await discoverSources({ dataDir, workspaceId, nowMs, fsApi });
  if (discovery.error) {
    return { complete: false, refs: new Map(), ...discovery.error, sourceSnapshot: discovery.snapshot };
  }

  const current = await readSmallJson(currentFile, workspaceId, validateCurrent, fsApi);
  if (current.ok) {
    const fresh = nowMs - current.value.completedAtMs <= (options.maxIndexAgeMs ?? INDEX_MAX_AGE_MS);
    if (fresh && sameSnapshot(current.value.sourceSnapshot, discovery.snapshot)) {
      return { complete: true, refs: refsToMap(current.value.refs), generation: current.value.generation,
        refsCount: Object.keys(current.value.refs).length, bytesProcessed: 0, sourcesRead: 0,
        reasonCode: "", sourceSnapshot: discovery.snapshot };
    }
  }

  const persisted = await readSmallJson(buildingFile, workspaceId, validateBuilding, fsApi);
  let state = persisted.ok && sameSnapshot(persisted.value.sourceSnapshot, discovery.snapshot)
    ? persisted.value
    : newBuilding(workspaceId, discovery, nowMs);
  let bytesProcessed = 0;
  let sourcesRead = 0;
  let lastSource = "";
  let lastFile = "";
  let stopReason = REASON.BUILD_INCOMPLETE;

  while (state.sourceIndex < discovery.sources.length) {
    if (clock() - started >= maxDurationMs) { stopReason = REASON.BUILD_TIME; break; }
    const source = discovery.sources[state.sourceIndex];
    lastSource = source.source;
    lastFile = source.file;
    const remainingBytes = maxBytes - bytesProcessed;
    if (remainingBytes <= 0) { stopReason = REASON.BUILD_BUDGET; break; }
    const result = source.kind === "jsonl"
      ? await processJsonlSource({ source, state, workspaceId, nowMs, remainingBytes, fsApi })
      : await processJsonSource({ source, state, workspaceId, nowMs, remainingBytes, maxBytes, fsApi });
    bytesProcessed += result.bytes || 0;
    if (result.fatal) {
      state.updatedAtMs = nowMs;
      await atomicWriteJson(buildingFile, state, fsApi);
      const failed = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
        source: source.source, referenceFile: source.file, reasonCode: result.reasonCode,
        lineNumber: result.lineNumber, bytesProcessed, refsFound: Object.keys(state.refs).length,
        sourcesRead, nextCursor: state.sourceCursor, durationMs: clock() - started };
      try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(failed))); } catch {}
      return failed;
    }
    state.sourceCursor = result.nextCursor || 0;
    if (!result.complete) { stopReason = result.reasonCode || REASON.BUILD_INCOMPLETE; break; }
    state.sourceIndex += 1;
    state.sourceCursor = 0;
    sourcesRead += 1;
  }

  state.updatedAtMs = nowMs;
  if (state.sourceIndex < discovery.sources.length) {
    await atomicWriteJson(buildingFile, state, fsApi);
    const partial = { complete: false, refs: new Map(), workspaceId, generation: state.generation,
      source: lastSource, referenceFile: lastFile, reasonCode: stopReason, bytesProcessed,
      sourcesRead, refsFound: Object.keys(state.refs).length, nextCursor: state.sourceCursor,
      durationMs: clock() - started };
    try { logger.log("[GC-REFERENCE-INDEX-BUILD]", JSON.stringify(sanitizedBuild(partial))); } catch {}
    return partial;
  }

  const finalDiscovery = await discoverSources({ dataDir, workspaceId, nowMs, fsApi });
  if (finalDiscovery.error || !sameSnapshot(state.sourceSnapshot, finalDiscovery.snapshot)) {
    const restarted = newBuilding(workspaceId, finalDiscovery, nowMs);
    await atomicWriteJson(buildingFile, restarted, fsApi);
    const changed = { complete: false, refs: new Map(), workspaceId, generation: restarted.generation,
      source: "validation", reasonCode: finalDiscovery.error?.reasonCode || REASON.SOURCE_CHANGED,
      bytesProcessed, sourcesRead, refsFound: 0, nextCursor: 0, durationMs: clock() - started };
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
    refs: state.refs
  };
  await atomicWriteJson(currentFile, ready, fsApi);
  await atomicWriteJson(buildingFile, {
    schemaVersion: SCHEMA_VERSION,
    status: "building",
    workspaceId,
    generation: generationId(nowMs),
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    sourceIndex: 0,
    sourceCursor: 0,
    sourceSnapshot: state.sourceSnapshot,
    refs: {}
  }, fsApi);
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
