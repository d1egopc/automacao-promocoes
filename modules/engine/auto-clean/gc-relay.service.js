"use strict";

const fs = require("fs");
const path = require("path");
const { selecionarRoundRobin } = require("./workspace-rotation");
const { buildOrLoadReferenceIndex } = require("./gc-reference-index-builder");

const STATE_FILE = "auto-clean-gc-relay-state.json";
const MIN_INTERVAL_MS = 15 * 60 * 1000;
const CANDIDATE_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_ENTRIES_PER_RUN = 50;
const MAX_DURATION_MS = 3000;
const CLASSIFICACAO = Object.freeze({
  VIVO_REFERENCIADO: "VIVO_REFERENCIADO",
  JOVEM: "JOVEM",
  CANDIDATO_ORFAO: "CANDIDATO_ORFAO",
  ERRO: "ERRO"
});
const sessions = new Map();
let inFlight = null;

function emptyState() {
  return { version: 1, lastRunAt: 0, lastWorkspace: "", offsets: {} };
}

async function loadState(dataDir, fsApi) {
  try {
    const parsed = JSON.parse(await fsApi.readFile(path.join(dataDir, STATE_FILE), "utf8"));
    if (parsed?.version !== 1 || !parsed.offsets || typeof parsed.offsets !== "object" || Array.isArray(parsed.offsets)) {
      throw new Error("GC_RELAY_STATE_INVALID");
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

async function listWorkspaces(root, fsApi) {
  let entries;
  try { entries = await fsApi.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  return entries.filter(entry => entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name))
    .map(entry => entry.name).sort();
}

async function closeSession(key) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (session) { try { await session.dir.close(); } catch {} }
}

async function getSession(key, renderDir, offset, fsApi) {
  if (sessions.has(key)) return sessions.get(key);
  const stat = await fsApi.lstat(renderDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("GC_RENDER_DIR_NOT_REGULAR");
  const dir = await fsApi.opendir(renderDir);
  const session = { dir, resumeRemaining: Math.max(0, Number(offset) || 0) };
  sessions.set(key, session);
  return session;
}

function classificarRender({ sources, ageMs, referenceComplete }) {
  if (sources?.size) return CLASSIFICACAO.VIVO_REFERENCIADO;
  if (ageMs <= CANDIDATE_AGE_MS) return CLASSIFICACAO.JOVEM;
  return referenceComplete ? CLASSIFICACAO.CANDIDATO_ORFAO : CLASSIFICACAO.ERRO;
}

async function runOnce(options = {}) {
  const started = Date.now();
  const fsApi = options.fsApi || fs.promises;
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const maxEntries = Math.min(MAX_ENTRIES_PER_RUN, Math.max(1, Number(options.maxEntries) || MAX_ENTRIES_PER_RUN));
  const maxDurationMs = Math.min(MAX_DURATION_MS, Math.max(1, Number(options.maxDurationMs) || MAX_DURATION_MS));
  const state = await loadState(dataDir, fsApi);
  if (nowMs - Number(state.lastRunAt || 0) < minIntervalMs) {
    return { dryRun: true, skipped: true, reason: "interval", inspected: 0 };
  }

  const root = path.join(dataDir, "identidade-visual-ofertas", "clientes");
  const workspaces = await listWorkspaces(root, fsApi);
  const { selecionados } = selecionarRoundRobin(workspaces, state.lastWorkspace, 1);
  const workspace = selecionados[0] || "";
  const summary = { workspace, inspected: 0, live: 0, young: 0, candidates: 0,
    candidateBytes: 0, errors: 0, vitrineConflicts: 0, historyConflicts: 0,
    replayed: 0, dryRun: true, durationMs: 0 };
  state.lastRunAt = nowMs;
  if (!workspace) {
    await saveState(dataDir, state, fsApi);
    return summary;
  }
  state.lastWorkspace = workspace;
  const renderDir = path.join(root, workspace, "renderizados");
  const key = `${dataDir}:${workspace}`;
  let references;
  try {
    references = await (options.referenceIndexBuilder || buildOrLoadReferenceIndex)({
      dataDir,
      workspaceId: workspace,
      nowMs,
      maxBytesPerRun: options.maxReferenceBytes,
      maxDurationMs: options.maxReferenceDurationMs,
      maxIndexAgeMs: options.maxIndexAgeMs,
      logger: options.logger,
      fsApi
    });
    summary.referenceComplete = references.complete;
    summary.referenceBytesRead = references.bytesRead ?? references.bytesProcessed ?? 0;
    summary.referenceSourcesRead = references.sourcesRead ?? 0;
    summary.referenceGeneration = references.generation || "";
    summary.referenceRefs = references.refsCount ?? references.refs?.size ?? 0;
    if (!references.complete) {
      summary.errors += 1;
      summary.referenceReasonCode = references.reasonCode || references.errorCode || "REFERENCE_READ_ERROR";
      summary.referenceSource = references.referenceSource || references.source || "unknown";
      summary.referenceFile = references.referenceFile || "";
      if (references.lineNumber) summary.referenceLineNumber = references.lineNumber;
    }
  } catch {
    references = { complete: false, refs: new Map() };
    summary.referenceComplete = false;
    summary.errors += 1;
  }

  try {
    const session = await getSession(key, renderDir, state.offsets[workspace] || 0, fsApi);
    for (let reads = 0; reads < maxEntries && Date.now() - started < maxDurationMs; reads += 1) {
      const entry = await session.dir.read();
      if (!entry) {
        await closeSession(key);
        state.offsets[workspace] = 0;
        summary.directoryComplete = true;
        break;
      }
      if (session.resumeRemaining > 0) {
        session.resumeRemaining -= 1;
        summary.replayed += 1;
        continue;
      }
      state.offsets[workspace] = (Number(state.offsets[workspace]) || 0) + 1;
      summary.inspected += 1;
      if (!/^[a-f0-9]{32,64}\.png$/i.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) { summary.errors += 1; continue; }
      const file = path.resolve(renderDir, entry.name);
      if (!file.startsWith(path.resolve(renderDir) + path.sep)) { summary.errors += 1; continue; }
      try {
        const stat = await fsApi.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) { summary.errors += 1; continue; }
        const hash = entry.name.slice(0, -4).toLowerCase();
        const sources = references.refs.get(hash);
        const classification = classificarRender({ sources, ageMs: nowMs - stat.mtimeMs,
          referenceComplete: references.complete });
        if (classification === CLASSIFICACAO.VIVO_REFERENCIADO) {
          summary.live += 1;
          if (sources.has("vitrine")) summary.vitrineConflicts += 1;
          if (sources.has("historico")) summary.historyConflicts += 1;
        } else if (classification === CLASSIFICACAO.JOVEM) {
          summary.young += 1;
        } else if (classification === CLASSIFICACAO.ERRO) {
          summary.errors += 1;
        } else {
          summary.candidates += 1;
          summary.candidateBytes += stat.size;
        }
      } catch { summary.errors += 1; }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") summary.errors += 1;
    await closeSession(key);
  }
  await saveState(dataDir, state, fsApi);
  summary.durationMs = Date.now() - started;
  return summary;
}

function sanitizeSummary(summary) {
  const fields = ["workspace", "inspected", "live", "young", "candidates", "candidateBytes",
    "errors", "vitrineConflicts", "historyConflicts", "replayed", "dryRun", "durationMs",
    "referenceComplete", "referenceBytesRead", "referenceSourcesRead", "referenceReasonCode",
    "referenceSource", "referenceFile", "referenceLineNumber", "referenceGeneration", "referenceRefs",
    "directoryComplete", "skipped", "reason"];
  return Object.fromEntries(fields.filter(key => summary[key] !== undefined).map(key => [key, summary[key]]));
}

async function executarGcRelaySeguro(options = {}) {
  if (inFlight) return { dryRun: true, skipped: true, reason: "already_running", inspected: 0 };
  inFlight = runOnce(options);
  try {
    const summary = sanitizeSummary(await inFlight);
    if (!summary.skipped) {
      try { (options.logger || console).log("[AUTO-CLEAN-GC-RELAY]", JSON.stringify(summary)); } catch {}
    }
    return summary;
  } catch (error) {
    const summary = { dryRun: true, inspected: 0, errors: 1, reason: error?.code || "relay_failed" };
    try { (options.logger || console).log("[AUTO-CLEAN-GC-RELAY]", JSON.stringify(summary)); } catch {}
    return summary;
  } finally {
    inFlight = null;
  }
}

module.exports = { executarGcRelaySeguro, runOnce, closeSession, STATE_FILE,
  MIN_INTERVAL_MS, CANDIDATE_AGE_MS, MAX_ENTRIES_PER_RUN, CLASSIFICACAO, classificarRender };
