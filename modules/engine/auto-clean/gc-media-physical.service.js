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
// Bounded deletion working set. Universal totals come from the independent,
// paginated census below and are never truncated by this queue capacity.
const MAX_WORKING_SET_CANDIDATES = 12000;
const EXT_SOCIAL = /\.(?:jpe?g|png|webp|mp4|mov|webm)$/i;

function emptyState() {
  return { version: 2, lastTarget: "", cursors: {}, cursorNames: {}, candidates: {}, lastObservedAt: {}, census: {} };
}

async function loadState(dataDir, fsApi) {
  try {
    const parsed = JSON.parse(await fsApi.readFile(path.join(dataDir, STATE_FILE), "utf8"));
    if (![1, 2].includes(parsed?.version) || !parsed.cursors || !parsed.candidates || !parsed.lastObservedAt) {
      throw new Error("GC_MEDIA_STATE_INVALID");
    }
    return { ...parsed, version: 2, cursorNames: parsed.cursorNames || {}, census: parsed.census || {} };
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

// A concurrent cycle can load an older state snapshot while another cycle
// stages a candidate into quarantine. The source then disappears from the
// target directory, but the older writer could otherwise persist the stale
// candidate again. Reconcile only missing/invalid source files; never infer
// eligibility from age and never touch quarantine payloads here.
async function pruneMissingCandidates(state, target, fsApi) {
  const prefix = `${target.id}/`;
  const candidates = Object.keys(state?.candidates || {})
    .filter(candidateId => candidateId.startsWith(prefix));
  if (!candidates.length) return 0;

  let entries;
  try {
    entries = await fsApi.readdir(target.dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") return 0;
    for (const candidateId of candidates) delete state.candidates[candidateId];
    return candidates.length;
  }

  const present = new Set(entries.filter(entry => fileAllowed(target, entry)).map(entry => entry.name));
  let removed = 0;
  for (const candidateId of candidates) {
    const name = candidateId.slice(prefix.length);
    if (present.has(name)) continue;
    const file = path.resolve(target.dir, name);
    if (path.dirname(file) !== path.resolve(target.dir)) continue;
    try {
      const stat = await fsApi.lstat(file);
      if (stat.isFile() && !stat.isSymbolicLink()) continue;
    } catch (error) {
      if (error?.code !== "ENOENT") continue;
    }
    delete state.candidates[candidateId];
    removed += 1;
  }
  return removed;
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
  if (!scopedReleaseConfigured() || target?.kind !== "identity") return false;
  if (!/^identity:[A-Za-z0-9_-]+$/.test(target.id)) return false;
  return explicitIdentityScopes("OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES").has(target.id);
}

function explicitIdentityScopes(envName) {
  const values = String(process.env[envName] || "").split(",")
    .map(value => value.trim()).filter(Boolean);
  if (!values.length || values.some(value => !/^identity:[A-Za-z0-9_-]+$/.test(value))) return new Set();
  return new Set(values);
}

function scopedReleaseConfigured() {
  return process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE === "approved" &&
    explicitIdentityScopes("OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES").size > 0;
}

function scopedUnlinkRelease(target) {
  if (!scopedRelease(target) ||
      process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_UNLINK_RELEASE !== "approved") return false;
  return explicitIdentityScopes("OPTIMUS_AUTO_CLEAN_MEDIA_UNLINK_SCOPES").has(target.id);
}

function deleteEnabled(options, target) {
  const envEnabled = String(process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE || "").toLowerCase() === "true";
  return options.execute === true &&
    ((released(MEDIA_RELEASE) && (options.mediaDeleteEnabled === true || envEnabled)) || scopedRelease(target));
}

function censusState(state, targetId, nowMs, startingNewPass) {
  if (startingNewPass || !state.census[targetId] || state.census[targetId].complete === true) {
    const previous = state.census[targetId]?.lastComplete || null;
    state.census[targetId] = {
      generation: Number(state.census[targetId]?.generation || 0) + 1,
      startedAtMs: nowMs,
      scanned: 0,
      eligible: 0,
      eligibleBytes: 0,
      protected: 0,
      blocked: 0,
      complete: false,
      lastComplete: previous
    };
  }
  return state.census[targetId];
}

function candidateScope(candidateId = "") {
  const value = String(candidateId || "");
  const separator = value.indexOf("/");
  return separator > 0 ? value.slice(0, separator) : value;
}

function reservarSlotCandidato(state, targetId) {
  const candidates = state?.candidates && typeof state.candidates === "object"
    ? state.candidates : {};
  const entries = Object.entries(candidates);
  if (entries.length < MAX_WORKING_SET_CANDIDATES) return { ok: true, evicted: null };

  const counts = new Map();
  for (const [candidateId] of entries) {
    const scope = candidateScope(candidateId);
    counts.set(scope, (counts.get(scope) || 0) + 1);
  }
  const scopes = new Set([...counts.keys(), String(targetId || "")]);
  const quota = Math.max(1, Math.floor(MAX_WORKING_SET_CANDIDATES / Math.max(1, scopes.size)));
  if ((counts.get(String(targetId || "")) || 0) >= quota) {
    return { ok: false, evicted: null, motivo: "candidate_scope_quota_full", quota };
  }

  // Preserve mature observations. Only the newest entry from an over-represented
  // scope may yield one slot, and only to let an under-quota scope make progress.
  const evictable = entries
    .filter(([candidateId]) => {
      const scope = candidateScope(candidateId);
      return scope !== String(targetId || "") && (counts.get(scope) || 0) > quota;
    })
    .sort((a, b) => Number(b[1]?.firstSeenAt || 0) - Number(a[1]?.firstSeenAt || 0));
  if (!evictable.length) {
    return { ok: false, evicted: null, motivo: "candidate_global_capacity_fairness_blocked", quota };
  }
  const [evictedId] = evictable[0];
  delete candidates[evictedId];
  return { ok: true, evicted: evictedId, quota };
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
    blocked: 0, candidateCapacityEvictions: 0, candidateCapacityBlocked: 0,
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

  // Reconcile stale observations before any reference gate. This keeps a
  // candidate that was atomically moved to quarantine out of later snapshots.
  summary.staleCandidatesPruned = await pruneMissingCandidates(state, target, fsApi);

  const references = await (options.referenceLoader || loadReferences)(target,
    { ...options, dataDir, nowMs, fsApi });
  summary.referenceComplete = references?.complete === true;
  summary.referenceReasonCode = references?.reasonCode || "";
  if (!references?.complete) {
    summary.blocked++;
    summary.stopReason = references?.reasonCode || "media_reference_incomplete";
    await saveState(dataDir, state, fsApi);
    summary.durationMs = Date.now() - started;
    return summary;
  }

  if (scopedRelease(target) && options.execute === true) {
    try {
      const swept = await quarantine.sweep({ dataDir, target, nowMs,
        allowUnlink: released(MEDIA_RELEASE) || scopedUnlinkRelease(target),
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
  const lastName = String(state.cursorNames[target.id] || "");
  // A name cursor is stable if files are added or deleted while a census is in
  // progress. New names before the cursor are intentionally picked up by the
  // next generation rather than causing skips or duplicate page counts.
  const startAt = lastName
    ? entries.findIndex(entry => entry.name.localeCompare(lastName) > 0)
    : 0;
  const normalizedStart = startAt < 0 ? entries.length : startAt;
  const slice = entries.slice(normalizedStart, normalizedStart + maxScan);
  const census = censusState(state, target.id, nowMs, !lastName);
  const previousObservedAt = Number(state.lastObservedAt[target.id] || 0);
  state.lastObservedAt[target.id] = nowMs;
  const ready = [];
  let processedInPage = 0;
  let lastProcessedName = lastName;
  for (const entry of slice) {
    if (hasBudget()) { summary.throttled = true; summary.stopReason = "time_budget"; break; }
    processedInPage += 1;
    lastProcessedName = entry.name;
    const file = path.resolve(target.dir, entry.name);
    if (!file.startsWith(path.resolve(target.dir) + path.sep)) { summary.errors++; continue; }
    try {
      const stat = await fsApi.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { summary.errors++; continue; }
      summary.scanned++;
      census.scanned++;
      if (previousObservedAt > 0 && stat.mtimeMs > previousObservedAt && stat.mtimeMs <= nowMs) {
        summary.createdSinceLastRun++; summary.createdBytes += stat.size;
      }
      const candidateId = `${target.id}/${entry.name}`;
      const key = referenceKey(target, entry.name);
      if (references.refs.has(key)) {
        summary.referenced++; census.protected++; delete state.candidates[candidateId]; continue;
      }
      if (nowMs - stat.mtimeMs <= RETENTION_MS) {
        summary.young++; census.protected++; delete state.candidates[candidateId]; continue;
      }
      summary.candidates++; summary.candidateBytes += stat.size;
      census.eligible++; census.eligibleBytes += stat.size;
      const observed = state.candidates[candidateId];
      const currentFingerprint = fingerprint(stat);
      if (!observed) {
        const slot = reservarSlotCandidato(state, target.id);
        if (slot.ok) {
          state.candidates[candidateId] = { firstSeenAt: nowMs, fingerprint: currentFingerprint, size: stat.size };
          if (slot.evicted) summary.candidateCapacityEvictions++;
        } else {
          summary.candidateCapacityBlocked++;
        }
      } else if (observed.fingerprint !== currentFingerprint) {
        observed.firstSeenAt = nowMs;
        observed.fingerprint = currentFingerprint;
        observed.size = stat.size;
      } else if (nowMs - Number(observed.firstSeenAt || 0) >= OBSERVATION_DELAY_MS &&
          ready.length + (scopedRelease(target) ? 0 : summary.removed) < maxDelete) {
        observed.size = stat.size;
        ready.push({ candidateId, file, key, fingerprint: currentFingerprint, size: stat.size });
      }
    } catch { summary.errors++; }
  }
  // A concurrent stage may happen after the initial reconciliation but before
  // this cycle reaches its final save. Reconcile once more immediately before
  // persisting state so an older snapshot cannot reintroduce the candidate.
  summary.staleCandidatesPruned += await pruneMissingCandidates(state, target, fsApi);
  const completedPage = normalizedStart + processedInPage >= entries.length;
  state.cursors[target.id] = completedPage ? 0 : normalizedStart + processedInPage;
  state.cursorNames[target.id] = completedPage ? "" : lastProcessedName;
  if (completedPage && !summary.throttled) {
    census.complete = true;
    census.completedAtMs = nowMs;
    census.lastComplete = {
      generation: census.generation,
      startedAtMs: census.startedAtMs,
      completedAtMs: nowMs,
      scanned: census.scanned,
      eligible: census.eligible,
      eligibleBytes: census.eligibleBytes,
      protected: census.protected,
      blocked: census.blocked
    };
    summary.censusCompletedThisRun = true;
  }
  const censusReport = census.lastComplete || census;
  summary.censusComplete = census.complete === true;
  summary.censusGeneration = Number(censusReport.generation || census.generation || 0);
  summary.censusScanned = Number(censusReport.scanned || 0);
  summary.censusEligible = Number(censusReport.eligible || 0);
  summary.censusEligibleBytes = Number(censusReport.eligibleBytes || 0);
  summary.censusProtected = Number(censusReport.protected || 0);
  summary.censusBlocked = Number(censusReport.blocked || 0);
  const scopedCensusReady = !scopedRelease(target) || (
    Number.isSafeInteger(Number(census.lastComplete?.completedAtMs)) &&
    Number(census.lastComplete?.scanned || 0) > 0 &&
    Number(census.lastComplete?.blocked || 0) === 0 &&
    Number(census.lastComplete?.scanned || 0) ===
      Number(census.lastComplete?.eligible || 0) + Number(census.lastComplete?.protected || 0)
  );
  if (!scopedCensusReady) {
    summary.blocked++;
    summary.stopReason = "media_census_incomplete";
  }
  const targetCandidates = Object.entries(state.candidates)
    .filter(([key]) => key.startsWith(`${target.id}/`));
  summary.backlog = targetCandidates.length;
  summary.backlogBytes = targetCandidates.reduce((sum, [, value]) => sum + Number(value?.size || 0), 0);

  if (!summary.dryRun && scopedCensusReady && ready.length) {
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

async function runMediaPhysicalBatchInternal(options = {}) {
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
    blocked: 0,
    backlog: 0, backlogBytes: 0, revalidations: 0, microBatches: summaries.length,
    quarantined: 0, quarantineBytes: 0, restored: 0,
    dryRun: summaries.every(item => item.dryRun !== false),
    throttled: loadThrottled || summaries.some(item => item.throttled),
    stopReason: loadThrottled ? "load_guard" : (summaries.find(item => item.stopReason)?.stopReason || ""),
    targetResults: summaries,
    censusResults: summaries.filter(item => item.censusCompletedThisRun === true).map(item => ({
      target: item.target,
      generation: item.censusGeneration,
      candidates: item.censusScanned,
      eligible: item.censusEligible,
      eligibleBytes: item.censusEligibleBytes,
      protected: item.censusProtected,
      blocked: item.censusBlocked
    })),
    durationMs: Date.now() - started
  };
  for (const item of summaries) {
    for (const key of ["scanned", "createdSinceLastRun", "createdBytes", "referenced", "young", "candidates",
      "candidateBytes", "removed", "bytesFreed", "errors", "blocked", "backlog", "backlogBytes", "revalidations",
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

let mediaBatchActive = false;
async function runMediaPhysicalBatch(options = {}) {
  if (mediaBatchActive) {
    return {
      target: "", kind: "batch", workspace: "", targetsProcessed: 0, targets: [],
      scanned: 0, candidates: 0, candidateBytes: 0, removed: 0, bytesFreed: 0,
      blocked: 1, errors: 0, backlog: 0, backlogBytes: 0, quarantined: 0,
      dryRun: true, throttled: true, stopReason: "media_batch_single_flight",
      targetResults: [], censusResults: [], durationMs: 0
    };
  }
  mediaBatchActive = true;
  try {
    return await runMediaPhysicalBatchInternal(options);
  } finally {
    mediaBatchActive = false;
  }
}

module.exports = { runMediaPhysical, runMediaPhysicalBatch, RETENTION_MS, OBSERVATION_DELAY_MS, MAX_SCAN_PER_RUN,
  MAX_DELETE_PER_RUN, MAX_TOTAL_DELETE_PER_BATCH, DEFAULT_MICROBATCH_SIZE, DEFAULT_TARGETS_PER_BATCH,
  MAX_DURATION_MS, MAX_WORKING_SET_CANDIDATES, STATE_FILE,
  loadReferences, referenceKey, deleteEnabled, scopedRelease, scopedReleaseConfigured, scopedUnlinkRelease };
