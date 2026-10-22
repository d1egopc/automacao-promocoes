"use strict";

const fs = require("fs");
const path = require("path");
const { selecionarRoundRobin } = require("./workspace-rotation");
const { buildOrLoadReferenceIndex } = require("./gc-reference-index-builder");
const { referenciasSocialPostgres } = require("./gc-social-reference-index");

const STATE_FILE = "auto-clean-media-physical-state.json";
const RETENTION_MS = 192 * 60 * 60 * 1000;
const OBSERVATION_DELAY_MS = 15 * 60 * 1000;
const MAX_SCAN_PER_RUN = 500;
const MAX_DELETE_PER_RUN = 32;
const MAX_STATE_CANDIDATES = 12000;
const EXT_SOCIAL = /\.(?:jpe?g|png|webp|mp4|mov|webm)$/i;

function emptyState() {
  return { version: 1, lastTarget: "", cursors: {}, candidates: {}, lastObservedAt: {} };
}

async function loadState(dataDir, fsApi) {
  try {
    const parsed = JSON.parse(await fsApi.readFile(path.join(dataDir, STATE_FILE), "utf8"));
    if (parsed?.version !== 1 || !parsed.cursors || !parsed.candidates || !parsed.lastObservedAt) {
      throw new Error("GC_MEDIA_STATE_INVALID");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function saveState(dataDir, state, fsApi) {
  const file = path.join(dataDir, STATE_FILE);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsApi.writeFile(tmp, JSON.stringify(state), { flag: "wx" });
  await fsApi.rename(tmp, file);
}

async function listDirs(root, fsApi) {
  try {
    const entries = await fsApi.readdir(root, { withFileTypes: true });
    return entries.filter(item => item.isDirectory() && !item.isSymbolicLink() && /^[a-zA-Z0-9_-]+$/.test(item.name))
      .map(item => item.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function listTargets(dataDir, fsApi) {
  const identities = await listDirs(path.join(dataDir, "identidade-visual-ofertas", "clientes"), fsApi);
  const socials = await listDirs(path.join(dataDir, "social", "midia", "publica"), fsApi);
  return [
    ...identities.map(workspace => ({ id: `identity:${workspace}`, kind: "identity", workspace,
      dir: path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados") })),
    ...socials.map(bucket => ({ id: `social:${bucket}`, kind: "social", workspace: bucket,
      dir: path.join(dataDir, "social", "midia", "publica", bucket) }))
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function fingerprint(stat) {
  return `${Number(stat.dev || 0)}:${Number(stat.ino || 0)}:${Number(stat.size || 0)}:${Math.trunc(Number(stat.mtimeMs || 0))}`;
}

function referenceKey(target, name) {
  return target.kind === "identity" ? name.slice(0, -4).toLowerCase() : `social:${target.workspace}/${name}`;
}

function fileAllowed(target, entry) {
  if (!entry.isFile() || entry.isSymbolicLink()) return false;
  return target.kind === "identity"
    ? /^[a-f0-9]{32,64}\.png$/i.test(entry.name)
    : /^[a-zA-Z0-9_.-]+$/.test(entry.name) && EXT_SOCIAL.test(entry.name);
}

async function loadReferences(target, options) {
  const builder = options.referenceIndexBuilder || buildOrLoadReferenceIndex;
  const common = { dataDir: options.dataDir, nowMs: options.nowMs, fsApi: options.fsApi,
    maxBytesPerRun: options.maxReferenceBytes, maxDurationMs: options.maxReferenceDurationMs,
    maxIndexAgeMs: options.maxIndexAgeMs, logger: options.logger };
  if (target.kind === "identity") return builder({ ...common, workspaceId: target.workspace });

  const refs = new Map();
  const clients = await listDirs(path.join(options.dataDir, "clientes"), options.fsApi);
  const generations = [];
  for (const workspaceId of clients) {
    const index = await builder({ ...common, workspaceId });
    if (!index?.complete) return { complete: false, refs: new Map(),
      reasonCode: index?.reasonCode || "GC_SOCIAL_REFERENCE_INCOMPLETE" };
    generations.push(index.generation || "");
    for (const [key, sources] of index.refs || []) {
      if (key.startsWith(`social:${target.workspace}/`)) refs.set(key, sources);
    }
  }
  const db = await (options.socialReferenceProvider || referenciasSocialPostgres)({
    bucket: target.workspace, query: options.queryEngine
  });
  if (!db?.complete) return { complete: false, refs: new Map(),
    reasonCode: db?.reasonCode || "GC_SOCIAL_DB_REFERENCE_INCOMPLETE" };
  for (const key of db.refs || []) {
    if (!refs.has(key)) refs.set(key, new Set());
    refs.get(key).add("postgres");
  }
  return { complete: true, refs, generation: generations.join(":"), reasonCode: "" };
}

function deleteEnabled(options) {
  const envEnabled = String(process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE || "").toLowerCase() === "true";
  return options.execute === true && (options.mediaDeleteEnabled === true || envEnabled);
}

async function runMediaPhysical(options = {}) {
  const started = Date.now();
  const fsApi = options.fsApi || fs.promises;
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxScan = Math.min(2000, Math.max(1, Number(options.maxScan) || MAX_SCAN_PER_RUN));
  const maxDelete = Math.min(MAX_DELETE_PER_RUN, Math.max(1, Number(options.maxDelete) || MAX_DELETE_PER_RUN));
  const state = await loadState(dataDir, fsApi);
  const targets = await listTargets(dataDir, fsApi);
  const selectedId = selecionarRoundRobin(targets.map(item => item.id), state.lastTarget, 1).selecionados[0] || "";
  const target = targets.find(item => item.id === selectedId);
  const summary = { target: selectedId, kind: target?.kind || "", workspace: target?.workspace || "",
    scanned: 0, createdSinceLastRun: 0, createdBytes: 0, referenced: 0, young: 0,
    candidates: 0, candidateBytes: 0, removed: 0, bytesFreed: 0, errors: 0,
    backlog: 0, dryRun: !deleteEnabled(options), durationMs: 0 };
  if (!target) return summary;
  state.lastTarget = target.id;

  const references = await (options.referenceLoader || loadReferences)(target,
    { ...options, dataDir, nowMs, fsApi });
  summary.referenceComplete = references?.complete === true;
  summary.referenceReasonCode = references?.reasonCode || "";
  if (!references?.complete) {
    summary.errors++;
    await saveState(dataDir, state, fsApi);
    summary.durationMs = Date.now() - started;
    return summary;
  }

  let entries = [];
  try { entries = (await fsApi.readdir(target.dir, { withFileTypes: true })).filter(entry => fileAllowed(target, entry)); }
  catch (error) {
    if (error?.code !== "ENOENT") summary.errors++;
    await saveState(dataDir, state, fsApi);
    summary.durationMs = Date.now() - started;
    return summary;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const startAt = Math.min(Number(state.cursors[target.id] || 0), entries.length);
  const slice = entries.slice(startAt, startAt + maxScan);
  state.cursors[target.id] = startAt + slice.length >= entries.length ? 0 : startAt + slice.length;
  const previousObservedAt = Number(state.lastObservedAt[target.id] || 0);
  state.lastObservedAt[target.id] = nowMs;
  const ready = [];
  for (const entry of slice) {
    const file = path.resolve(target.dir, entry.name);
    if (!file.startsWith(path.resolve(target.dir) + path.sep)) { summary.errors++; continue; }
    try {
      const stat = await fsApi.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { summary.errors++; continue; }
      summary.scanned++;
      if (previousObservedAt > 0 && stat.mtimeMs > previousObservedAt && stat.mtimeMs <= nowMs) {
        summary.createdSinceLastRun++; summary.createdBytes += stat.size;
      }
      const candidateId = `${target.id}/${entry.name}`;
      const key = referenceKey(target, entry.name);
      if (references.refs.has(key)) {
        summary.referenced++; delete state.candidates[candidateId]; continue;
      }
      if (nowMs - stat.mtimeMs <= RETENTION_MS) {
        summary.young++; delete state.candidates[candidateId]; continue;
      }
      summary.candidates++; summary.candidateBytes += stat.size;
      const observed = state.candidates[candidateId];
      const currentFingerprint = fingerprint(stat);
      if (!observed || observed.fingerprint !== currentFingerprint) {
        if (Object.keys(state.candidates).length < MAX_STATE_CANDIDATES) {
          state.candidates[candidateId] = { firstSeenAt: nowMs, fingerprint: currentFingerprint };
        }
      } else if (nowMs - Number(observed.firstSeenAt || 0) >= OBSERVATION_DELAY_MS && ready.length < maxDelete) {
        ready.push({ candidateId, file, key, fingerprint: currentFingerprint, size: stat.size });
      }
    } catch { summary.errors++; }
  }
  summary.backlog = Object.keys(state.candidates).filter(key => key.startsWith(`${target.id}/`)).length;

  if (!summary.dryRun && ready.length) {
    if (typeof options.beforeRevalidate === "function") await options.beforeRevalidate({ target, ready });
    const revalidated = await (options.referenceLoader || loadReferences)(target,
      { ...options, dataDir, nowMs, fsApi });
    if (!revalidated?.complete) {
      summary.errors++;
      summary.referenceReasonCode = revalidated?.reasonCode || "GC_MEDIA_REVALIDATION_FAILED";
    } else {
      for (const item of ready) {
        if (revalidated.refs.has(item.key)) { delete state.candidates[item.candidateId]; summary.referenced++; continue; }
        try {
          const stat = await fsApi.lstat(item.file);
          if (!stat.isFile() || stat.isSymbolicLink() || fingerprint(stat) !== item.fingerprint) {
            delete state.candidates[item.candidateId]; summary.errors++; continue;
          }
          await fsApi.unlink(item.file);
          delete state.candidates[item.candidateId];
          summary.removed++; summary.bytesFreed += item.size;
        } catch (error) { if (error?.code !== "ENOENT") summary.errors++; }
      }
    }
  }
  await saveState(dataDir, state, fsApi);
  summary.durationMs = Date.now() - started;
  return summary;
}

module.exports = { runMediaPhysical, RETENTION_MS, OBSERVATION_DELAY_MS, MAX_SCAN_PER_RUN,
  MAX_DELETE_PER_RUN, STATE_FILE, loadReferences, referenceKey, deleteEnabled };
