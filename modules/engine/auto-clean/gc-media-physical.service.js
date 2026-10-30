"use strict";

const fs = require("fs");
const path = require("path");
const { selecionarRoundRobin } = require("./workspace-rotation");
const { buildOrLoadReferenceIndex } = require("./gc-reference-index-builder");
const { referenciasSocialPostgres } = require("./gc-social-reference-index");
const { MEDIA_RELEASE, released } = require("./deletion-release");
const quarantine = require("./gc-media-quarantine");

const STATE_FILE = "auto-clean-media-physical-state.json";
const RETENTION_MS = 192 * 60 * 60 * 1000;
const OBSERVATION_DELAY_MS = 15 * 60 * 1000;
const MAX_SCAN_PER_RUN = 500;
const MAX_DELETE_PER_RUN = 32;
const MAX_TOTAL_DELETE_PER_BATCH = 64;
const DEFAULT_MICROBATCH_SIZE = 16;
const DEFAULT_TARGETS_PER_BATCH = 4;
const MAX_TARGETS_PER_BATCH = 10;
const MAX_DURATION_MS = 2000;
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

async function safeTargetDirectory(dataDir, target, fsApi) {
  const root = path.resolve(dataDir);
  const dir = path.resolve(target.dir);
  if (!dir.startsWith(root + path.sep)) return false;
  let current = root;
  for (const part of path.relative(root, dir).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fsApi.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }
  return true;
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

function scopedRelease(target) {
  if (process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE !== "approved" || target?.kind !== "identity") return false;
  const scopes = String(process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES || "").split(",").map(value => value.trim());
  return scopes.includes(target.id) && /^identity:[A-Za-z0-9_-]+$/.test(target.id);
}

function deleteEnabled(options, target) {
  const envEnabled = String(process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE || "").toLowerCase() === "true";
  return options.execute === true &&
    ((released(MEDIA_RELEASE) && (options.mediaDeleteEnabled === true || envEnabled)) || scopedRelease(target));
}

async function runMediaPhysical(options = {}) {
  const started = Date.now();
  const fsApi = options.fsApi || fs.promises;
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxScan = Math.min(2000, Math.max(1, Number(options.maxScan) || MAX_SCAN_PER_RUN));
  const maxDelete = Math.min(MAX_DELETE_PER_RUN, Math.max(1, Number(options.maxDelete) || MAX_DELETE_PER_RUN));
  const maxDurationMs = Math.min(MAX_DURATION_MS, Math.max(50,
    Number(options.maxDurationMs) || MAX_DURATION_MS));
  const hasBudget = () => Date.now() - started >= maxDurationMs;
  const state = await loadState(dataDir, fsApi);
  const targets = await listTargets(dataDir, fsApi);
  const requestedTarget = String(options.targetId || "");
  const selectedId = targets.some(item => item.id === requestedTarget)
    ? requestedTarget
    : selecionarRoundRobin(targets.map(item => item.id), state.lastTarget, 1).selecionados[0] || "";
  const target = targets.find(item => item.id === selectedId);
  const summary = { target: selectedId, kind: target?.kind || "", workspace: target?.workspace || "",
    scanned: 0, createdSinceLastRun: 0, createdBytes: 0, referenced: 0, young: 0,
    candidates: 0, candidateBytes: 0, removed: 0, bytesFreed: 0, errors: 0,
    backlog: 0, backlogBytes: 0, revalidations: 0, microBatches: 1,
    quarantined: 0, quarantineBytes: 0, restored: 0,
    throttled: false, stopReason: "", dryRun: !deleteEnabled(options, target), durationMs: 0 };
  if (!target) return summary;
  state.lastTarget = target.id;

  if (!await safeTargetDirectory(dataDir, target, fsApi)) {
    summary.errors++;
    summary.stopReason = "media_target_directory_unsafe";
    return summary;
  }

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

  if (scopedRelease(target) && options.execute === true) {
    try {
      const swept = await quarantine.sweep({ dataDir, target, nowMs,
        loadRefs: () => (options.referenceLoader || loadReferences)(target,
          { ...options, dataDir, nowMs: Date.now(), fsApi }) });
      summary.removed += swept.removed;
      summary.bytesFreed += swept.bytesFreed;
      summary.restored += swept.restored;
    } catch (error) {
      summary.errors++;
      summary.stopReason = error.code || "media_recovery_failed";
      summary.throttled = true;
      return summary;
    }
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
    if (hasBudget()) { summary.throttled = true; summary.stopReason = "time_budget"; break; }
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
          state.candidates[candidateId] = { firstSeenAt: nowMs, fingerprint: currentFingerprint, size: stat.size };
        }
      } else if (nowMs - Number(observed.firstSeenAt || 0) >= OBSERVATION_DELAY_MS &&
          ready.length + (scopedRelease(target) ? 0 : summary.removed) < maxDelete) {
        observed.size = stat.size;
        ready.push({ candidateId, file, key, fingerprint: currentFingerprint, size: stat.size });
      }
    } catch { summary.errors++; }
  }
  const targetCandidates = Object.entries(state.candidates)
    .filter(([key]) => key.startsWith(`${target.id}/`));
  summary.backlog = targetCandidates.length;
  summary.backlogBytes = targetCandidates.reduce((sum, [, value]) => sum + Number(value?.size || 0), 0);

  if (!summary.dryRun && ready.length) {
    for (const item of ready) {
      if (hasBudget()) { summary.throttled = true; summary.stopReason = "time_budget"; break; }
      if (typeof options.beforeRevalidate === "function") {
        await options.beforeRevalidate({ target, ready, item });
      }
      const revalidated = await (options.referenceLoader || loadReferences)(target,
        { ...options, dataDir, nowMs: Date.now(), fsApi });
      summary.revalidations++;
      if (!revalidated?.complete) {
        summary.errors++;
        summary.referenceReasonCode = revalidated?.reasonCode || "GC_MEDIA_REVALIDATION_FAILED";
        summary.throttled = true;
        summary.stopReason = "reference_revalidation_failed";
        break;
      }
      if (revalidated.refs.has(item.key)) { delete state.candidates[item.candidateId]; summary.referenced++; continue; }
      try {
        const stat = await fsApi.lstat(item.file);
        if (!stat.isFile() || stat.isSymbolicLink() || fingerprint(stat) !== item.fingerprint) {
          delete state.candidates[item.candidateId]; summary.errors++; continue;
        }
        // The release can be revoked while reference revalidation is running.
        if (!deleteEnabled(options, target)) { summary.throttled = true; summary.stopReason = "delete_release_revoked"; break; }
        if (scopedRelease(target)) {
          await quarantine.stage({ dataDir, target, item, nowMs, io: fsApi });
          summary.quarantined++;
          summary.quarantineBytes += item.size;
        } else {
          await fsApi.unlink(item.file);
          summary.removed++;
          summary.bytesFreed += item.size;
        }
        delete state.candidates[item.candidateId];
      } catch (error) { if (error?.code !== "ENOENT") summary.errors++; }
    }
  }
  const remainingCandidates = Object.entries(state.candidates)
    .filter(([key]) => key.startsWith(`${target.id}/`));
  summary.backlog = remainingCandidates.length;
  summary.backlogBytes = remainingCandidates.reduce((sum, [, value]) => sum + Number(value?.size || 0), 0);
  await saveState(dataDir, state, fsApi);
  summary.durationMs = Date.now() - started;
  summary.createdGiB = summary.createdBytes / (1024 ** 3);
  summary.bytesFreedGiB = summary.bytesFreed / (1024 ** 3);
  summary.backlogGiB = summary.backlogBytes / (1024 ** 3);
  return summary;
}

async function runMediaPhysicalBatch(options = {}) {
  const started = Date.now();
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const fsApi = options.fsApi || fs.promises;
  const maxTargets = Math.min(MAX_TARGETS_PER_BATCH, Math.max(1,
    Number(options.maxTargetsPerRun) || DEFAULT_TARGETS_PER_BATCH));
  const microBatchSize = Math.min(MAX_DELETE_PER_RUN, Math.max(1,
    Number(options.microBatchSize) || DEFAULT_MICROBATCH_SIZE));
  const maxDelete = Math.min(MAX_TOTAL_DELETE_PER_BATCH, Math.max(1,
    Number(options.maxDelete) || MAX_TOTAL_DELETE_PER_BATCH));
  const maxDurationMs = Math.min(MAX_DURATION_MS, Math.max(50,
    Number(options.maxDurationMs) || MAX_DURATION_MS));
  const scopedOnly = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE === "approved" &&
    !released(MEDIA_RELEASE);
  const targets = (await listTargets(dataDir, fsApi))
    .filter(target => !scopedOnly || scopedRelease(target));
  const state = await loadState(dataDir, fsApi);
  const targetIds = selecionarRoundRobin(targets.map(item => item.id), state.lastTarget, maxTargets).selecionados;
  const summaries = [];
  let removed = 0;
  let quarantined = 0;
  let loadThrottled = false;

  for (const targetId of targetIds) {
    if (Date.now() - started >= maxDurationMs ||
        (scopedOnly ? quarantined : removed + quarantined) >= maxDelete) break;
    if (typeof options.loadGuard === "function") {
      const allowed = await options.loadGuard({ elapsedMs: Date.now() - started, removed, targetId });
      if (allowed === false || allowed?.allow === false) { loadThrottled = true; break; }
    }
    const remainingTime = Math.max(50, maxDurationMs - (Date.now() - started));
    const remainingDeletes = maxDelete - (scopedOnly ? quarantined : removed + quarantined);
    const result = await runMediaPhysical({ ...options, dataDir, fsApi, targetId,
      maxDelete: Math.min(microBatchSize, remainingDeletes), maxDurationMs: remainingTime });
    summaries.push(result);
    removed += Number(result.removed || 0);
    quarantined += Number(result.quarantined || 0);
    if (result.throttled && result.stopReason === "time_budget") break;
  }

  const aggregate = {
    target: summaries.map(item => item.target).filter(Boolean).join(","),
    kind: "batch", workspace: "", targetsProcessed: summaries.length,
    targets: summaries.map(item => item.target).filter(Boolean),
    scanned: 0, createdSinceLastRun: 0, createdBytes: 0, referenced: 0, young: 0,
    candidates: 0, candidateBytes: 0, removed: 0, bytesFreed: 0, errors: 0,
    backlog: 0, backlogBytes: 0, revalidations: 0, microBatches: summaries.length,
    quarantined: 0, quarantineBytes: 0, restored: 0,
    dryRun: summaries.every(item => item.dryRun !== false),
    throttled: loadThrottled || summaries.some(item => item.throttled),
    stopReason: loadThrottled ? "load_guard" : (summaries.find(item => item.stopReason)?.stopReason || ""),
    targetResults: summaries,
    durationMs: Date.now() - started
  };
  for (const item of summaries) {
    for (const key of ["scanned", "createdSinceLastRun", "createdBytes", "referenced", "young", "candidates",
      "candidateBytes", "removed", "bytesFreed", "errors", "backlog", "backlogBytes", "revalidations",
      "quarantined", "quarantineBytes", "restored"]) {
      aggregate[key] += Number(item[key] || 0);
    }
  }
  if (scopedOnly && targets.length === 0) {
    aggregate.errors = 1;
    aggregate.stopReason = "no_scoped_targets_verified";
  }
  aggregate.createdGiB = aggregate.createdBytes / (1024 ** 3);
  aggregate.bytesFreedGiB = aggregate.bytesFreed / (1024 ** 3);
  aggregate.backlogGiB = aggregate.backlogBytes / (1024 ** 3);
  return aggregate;
}

module.exports = { runMediaPhysical, runMediaPhysicalBatch, RETENTION_MS, OBSERVATION_DELAY_MS, MAX_SCAN_PER_RUN,
  MAX_DELETE_PER_RUN, MAX_TOTAL_DELETE_PER_BATCH, DEFAULT_MICROBATCH_SIZE, DEFAULT_TARGETS_PER_BATCH,
  MAX_DURATION_MS, STATE_FILE, loadReferences, referenceKey, deleteEnabled, scopedRelease };
