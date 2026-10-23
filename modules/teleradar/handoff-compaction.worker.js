"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const TERMINAL = new Set(["acked", "failed_permanent"]);

function hash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function terminalTimestamp(record = {}) {
  for (const field of ["radarAcceptedAt", "failedAt", "handoffAttemptedAt", "handoffPersistedAt", "capturedAt"]) {
    const value = Date.parse(record[field] || "");
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function terminalTombstone(record = {}) {
  return {
    eventId: record.eventId,
    status: record.status,
    archived: true,
    capturedAt: record.capturedAt || null,
    handoffPersistedAt: record.handoffPersistedAt || null,
    handoffAttemptedAt: record.handoffAttemptedAt || null,
    radarAcceptedAt: record.radarAcceptedAt || null,
    failedAt: record.failedAt || null,
    handoffLatencyMs: record.handoffLatencyMs ?? null,
    lastErrorCode: record.lastErrorCode || null,
    radarReceipt: record.radarReceipt && typeof record.radarReceipt === "object"
      ? {
          code: record.radarReceipt.code || null,
          radarEventId: record.radarReceipt.radarEventId ?? null,
          duplicate: record.radarReceipt.duplicate === true
        }
      : null
  };
}

async function syncFile(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
  } finally {
    await handle.close();
  }
}

async function writeImmutable(file, content) {
  try {
    const current = await fs.promises.readFile(file);
    if (hash(current) !== hash(content)) throw new Error("TELERADAR_ARCHIVE_HASH_CONFLICT");
    return { created: false };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (process.platform === "win32") {
    try {
      await fs.promises.writeFile(file, content, { flag: "wx", mode: 0o600 });
      await syncFile(file);
      return { created: true };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = await fs.promises.readFile(file);
      if (hash(current) !== hash(content)) throw new Error("TELERADAR_ARCHIVE_HASH_CONFLICT");
      return { created: false };
    }
  }

  const temp = `${file}.t.${process.pid}.${Date.now().toString(36)}`;
  await fs.promises.writeFile(temp, content, { flag: "wx", mode: 0o600 });
  await syncFile(temp);
  try {
    await fs.promises.rename(temp, file);
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => {});
    if (error?.code !== "EEXIST") throw error;
    const current = await fs.promises.readFile(file);
    if (hash(current) !== hash(content)) throw new Error("TELERADAR_ARCHIVE_HASH_CONFLICT");
    return { created: false };
  }
  return { created: true };
}

async function writeActiveAtomic(file, content, sourceStat) {
  const temp = `${file}.compact.${process.pid}.${Date.now()}`;
  const backup = `${file}.bak`;
  await fs.promises.writeFile(temp, content, { flag: "wx", mode: sourceStat.mode & 0o777 });
  await fs.promises.chown(temp, sourceStat.uid, sourceStat.gid).catch(error => {
    if (error?.code !== "EPERM") throw error;
  });
  await syncFile(temp);
  await fs.promises.copyFile(file, backup);
  if (process.platform === "win32") {
    await fs.promises.writeFile(file, content);
    await syncFile(file);
    await fs.promises.rm(temp, { force: true });
  } else {
    await fs.promises.rename(temp, file);
  }
}

async function writeJsonAtomicFromWorker(file, content, sourceStat = null) {
  if (sourceStat) {
    await writeActiveAtomic(file, content, sourceStat);
    return;
  }
  const temp = `${file}.write.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(temp, content, { flag: "wx", mode: 0o600 });
  await syncFile(temp);
  try {
    await fs.promises.rename(temp, file);
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => {});
    throw error;
  }
}

function handoffMutation(state, { entryKey, operation, payload = {} } = {}) {
  const entries = state.entries;
  const current = entries[entryKey] || null;
  if (operation === "persist") {
    if (current) return { changed: false, result: { created: false, record: current } };
    entries[entryKey] = payload.record;
    return { changed: true, result: { created: true, record: payload.record } };
  }
  if (operation === "claim") {
    if (!current) return { changed: false, result: { claimed: false, reason: "handoff_not_found" } };
    if (current.status === "acked" || current.status === "failed_permanent") {
      return { changed: false, result: { claimed: false, reason: current.status, record: current } };
    }
    const nowMs = Date.parse(payload.attemptedAt);
    const nextMs = Date.parse(current.nextAttemptAt || "");
    if (current.status === "pending" && Number.isFinite(nextMs) && nextMs > nowMs) {
      return { changed: false, result: { claimed: false, reason: "backoff", record: current } };
    }
    const currentLeaseMs = Date.parse(current.leaseUntil || "");
    if (current.status === "delivering" && Number.isFinite(currentLeaseMs) && currentLeaseMs > nowMs) {
      return { changed: false, result: { claimed: false, reason: "leased", record: current } };
    }
    current.status = "delivering";
    current.attempts = Number(current.attempts || 0) + 1;
    current.handoffAttemptedAt = payload.attemptedAt;
    current.leaseUntil = new Date(nowMs + Math.max(1000, Number(payload.leaseMs) || 30000)).toISOString();
    entries[entryKey] = current;
    return { changed: true, result: { claimed: true, record: current } };
  }
  if (!current) throw new Error("TELERADAR_HANDOFF_NOT_FOUND");
  if (operation === "mark_attempted") {
    current.handoffAttemptedAt = payload.attemptedAt;
  } else if (operation === "retry") {
    current.status = "pending";
    current.nextAttemptAt = payload.nextAttemptAt;
    current.leaseUntil = null;
    current.lastErrorCode = payload.errorCode;
  } else if (operation === "accepted") {
    current.status = "acked";
    current.radarAcceptedAt = payload.acceptedAt;
    current.handoffLatencyMs = Math.max(0, Date.parse(payload.acceptedAt) - Date.parse(current.capturedAt));
    current.nextAttemptAt = null;
    current.leaseUntil = null;
    current.lastErrorCode = null;
    current.radarReceipt = payload.receipt;
  } else if (operation === "permanent") {
    current.status = "failed_permanent";
    current.failedAt = payload.failedAt;
    current.nextAttemptAt = null;
    current.leaseUntil = null;
    current.lastErrorCode = payload.errorCode;
  } else {
    throw new Error("TELERADAR_HANDOFF_MUTATION_UNKNOWN");
  }
  entries[entryKey] = current;
  return { changed: true, result: current };
}

async function mutateHandoffFile({ file, entryKey, clientId, operation, payload } = {}) {
  if (!path.isAbsolute(String(file || ""))) throw new Error("TELERADAR_MUTATION_PATH_REQUIRED");
  let raw;
  let sourceStat = null;
  try {
    raw = await fs.promises.readFile(file, "utf8");
    sourceStat = await fs.promises.stat(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    raw = JSON.stringify({ schemaVersion: 1, entries: {}, clienteId: clientId });
  }
  const state = JSON.parse(raw);
  if (state?.schemaVersion !== 1 || !state.entries || Array.isArray(state.entries)) {
    throw new Error("TELERADAR_STORAGE_CORRUPTED");
  }
  const mutation = handoffMutation(state, { entryKey, operation, payload });
  if (mutation.changed) {
    const content = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeJsonAtomicFromWorker(file, content, sourceStat);
  }
  return mutation.result;
}

function mutateHandoffInWorker(options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { mode: "mutate_handoff", ...options } });
    worker.once("message", message => {
      if (message?.ok === true) resolve(message.result);
      else reject(Object.assign(new Error(message?.error || "TELERADAR_MUTATION_FAILED"), { code: message?.code }));
    });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code !== 0) reject(new Error(`TELERADAR_MUTATION_WORKER_EXIT_${code}`));
    });
  });
}

async function compactFile({
  file,
  keepTerminal = 512,
  terminalHighWater = 768,
  maxActiveBytes = 4 * 1024 * 1024,
  _testFailAfterArchive = false
} = {}) {
  if (!path.isAbsolute(String(file || ""))) throw new Error("TELERADAR_COMPACTION_PATH_REQUIRED");
  const raw = await fs.promises.readFile(file);
  const sourceStat = await fs.promises.stat(file);
  const state = JSON.parse(raw.toString("utf8"));
  if (state?.schemaVersion !== 1 || !state.entries || Array.isArray(state.entries)) {
    throw new Error("TELERADAR_STORAGE_CORRUPTED");
  }

  const terminal = Object.entries(state.entries)
    .filter(([, record]) => TERMINAL.has(String(record?.status || "")) && record?.archived !== true)
    .sort((left, right) => terminalTimestamp(left[1]) - terminalTimestamp(right[1]) || left[0].localeCompare(right[0]));
  const shouldCompact = terminal.length > terminalHighWater || raw.length > maxActiveBytes;
  if (!shouldCompact || terminal.length <= keepTerminal) {
    return { compacted: false, bytesBefore: raw.length, terminal: terminal.length, active: Object.keys(state.entries).length };
  }

  const archiveCount = terminal.length - keepTerminal;
  const archivedEntries = Object.fromEntries(terminal.slice(0, archiveCount));
  const activeEntries = { ...state.entries };
  for (const [key, record] of Object.entries(archivedEntries)) {
    activeEntries[key] = terminalTombstone(record);
  }

  const archiveState = {
    schemaVersion: 1,
    kind: "teleradar_handoff_terminal_archive",
    clientId: state.clienteId || null,
    sourceSha256: hash(raw),
    entryCount: archiveCount,
    entries: archivedEntries
  };
  const archiveContent = Buffer.from(`${JSON.stringify(archiveState)}\n`, "utf8");
  const archiveHash = hash(archiveContent);
  const archiveDir = path.join(path.dirname(file), "teleradar-ha");
  await fs.promises.mkdir(archiveDir, { recursive: true, mode: 0o700 });
  const archiveFile = path.join(archiveDir, `s-${archiveHash.slice(0, 24)}.json`);
  await writeImmutable(archiveFile, archiveContent);
  if (_testFailAfterArchive === true && process.env.NODE_ENV === "test") {
    throw new Error("TELERADAR_TEST_FAILURE_AFTER_ARCHIVE");
  }

  const activeState = { ...state, entries: activeEntries };
  const activeContent = Buffer.from(`${JSON.stringify(activeState, null, 2)}\n`, "utf8");
  await writeActiveAtomic(file, activeContent, sourceStat);

  return {
    compacted: true,
    archiveFile,
    archiveSha256: archiveHash,
    archived: archiveCount,
    terminalKept: keepTerminal,
    active: Object.keys(activeEntries).length,
    bytesBefore: raw.length,
    bytesAfter: activeContent.length
  };
}

function compactInWorker(options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: options });
    worker.once("message", message => {
      if (message?.ok === true) resolve(message.result);
      else reject(Object.assign(new Error(message?.error || "TELERADAR_COMPACTION_FAILED"), { code: message?.code }));
    });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code !== 0) reject(new Error(`TELERADAR_COMPACTION_WORKER_EXIT_${code}`));
    });
  });
}

if (!isMainThread) {
  const task = workerData?.mode === "mutate_handoff"
    ? mutateHandoffFile(workerData)
    : compactFile(workerData);
  task
    .then(result => parentPort.postMessage({ ok: true, result }))
    .catch(error => parentPort.postMessage({ ok: false, error: error?.message, code: error?.code || null }));
}

module.exports = { compactInWorker, compactFile, mutateHandoffInWorker, mutateHandoffFile };
