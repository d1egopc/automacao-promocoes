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
  compactFile(workerData)
    .then(result => parentPort.postMessage({ ok: true, result }))
    .catch(error => parentPort.postMessage({ ok: false, error: error?.message, code: error?.code || null }));
}

module.exports = { compactInWorker, compactFile };
