"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const TARGET_SESSION_ID = "admin_Radar Zap Claro";
const DEFAULT_AUTH_ROOT = path.join("/data", `auth_${TARGET_SESSION_ID}`);
const DEFAULT_SNAPSHOT_ROOT = path.join("/data", "recovery", "auth-snapshots", "radar-claro");
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function texto(value) {
  return String(value == null ? "" : value).trim();
}

function inteiro(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function resultadoErro(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

function resultadoPublico(result = {}) {
  const allowed = [
    "ok", "reason", "state", "epoch", "socketClosed", "pending", "blockedWrites", "writeErrors",
    "lastFailureReason", "alreadyQuiesced", "alreadySnapshotted", "targetSessionId", "errorCode",
    "snapshotId", "manifestSha256", "fileCount", "bytes"
  ];
  return allowed.reduce((output, key) => {
    if (result[key] !== undefined) output[key] = result[key];
    return output;
  }, {});
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function hashFile(filePath, fsApi = fsp) {
  const bytes = await fsApi.readFile(filePath);
  return sha256Buffer(bytes);
}

async function listarArvore(root, fsApi = fsp, relative = "") {
  const dir = path.join(root, relative);
  const entries = await fsApi.readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(relative, entry.name);
    const absolute = path.join(root, rel);
    if (entry.isSymbolicLink()) throw new Error("auth_snapshot_symlink_rejected");
    if (entry.isDirectory()) {
      output.push(...await listarArvore(root, fsApi, rel));
      continue;
    }
    if (!entry.isFile()) throw new Error("auth_snapshot_unsupported_entry");
    const stat = await fsApi.stat(absolute);
    output.push({
      relativePath: rel.replace(/\\/g, "/"),
      mode: stat.mode & 0o777,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      sha256: await hashFile(absolute, fsApi)
    });
  }
  return output;
}

function manifestComparable(entries) {
  return JSON.stringify(entries.map(item => ({
    relativePath: item.relativePath,
    mode: item.mode,
    size: item.size,
    mtimeMs: item.mtimeMs,
    sha256: item.sha256
  })));
}

function manifestSummary(entries) {
  return {
    fileCount: entries.length,
    bytes: entries.reduce((total, item) => total + Number(item.size || 0), 0),
    sha256: sha256Buffer(Buffer.from(manifestComparable(entries), "utf8"))
  };
}

async function garantirDiretorioPrivado(dir, fsApi = fsp) {
  await fsApi.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsApi.chmod(dir, 0o700);
  const stat = await fsApi.lstat(dir);
  if (!stat.isDirectory() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("auth_snapshot_directory_not_private");
  }
}

function novoSnapshotId(now = () => Date.now(), randomBytes = crypto.randomBytes) {
  const timestamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, "");
  return `snapshot-${timestamp}-${randomBytes(8).toString("hex")}`;
}

async function copiarArvoreVerificada({ sourceRoot, snapshotRoot, snapshotId, fsApi = fsp, now, randomBytes }) {
  const sourceStat = await fsApi.lstat(sourceRoot);
  if (!sourceStat.isDirectory()) throw new Error("auth_store_not_directory");

  const before = await listarArvore(sourceRoot, fsApi);
  const stageDir = path.join(snapshotRoot, `.${snapshotId}.tmp`);
  const finalDir = path.join(snapshotRoot, snapshotId);
  await garantirDiretorioPrivado(snapshotRoot, fsApi);
  await fsApi.mkdir(stageDir, { recursive: false, mode: 0o700 });

  try {
    for (const item of before) {
      const destination = path.join(stageDir, item.relativePath);
      await fsApi.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fsApi.copyFile(path.join(sourceRoot, item.relativePath), destination, fs.constants.COPYFILE_EXCL);
      await fsApi.chmod(destination, item.mode);
      await fsApi.utimes(destination, new Date(item.mtimeMs), new Date(item.mtimeMs));
    }

    const after = await listarArvore(sourceRoot, fsApi);
    if (manifestComparable(before) !== manifestComparable(after)) {
      throw new Error("auth_store_changed_during_snapshot");
    }
    const copied = await listarArvore(stageDir, fsApi);
    if (manifestComparable(before) !== manifestComparable(copied)) {
      throw new Error("auth_snapshot_manifest_mismatch");
    }

    const manifest = {
      version: 1,
      target: TARGET_SESSION_ID,
      createdAt: new Date(now()).toISOString(),
      entries: before,
      summary: manifestSummary(before)
    };
    const manifestPath = path.join(stageDir, "MANIFEST.json");
    const manifestJson = JSON.stringify(manifest, null, 2);
    const handle = await fsApi.open(manifestPath, "wx", 0o600);
    try {
      await handle.writeFile(manifestJson, "utf8");
    } finally {
      await handle.close();
    }
    await fsApi.rename(stageDir, finalDir);
    return {
      ok: true,
      snapshotId,
      manifestSha256: sha256Buffer(Buffer.from(manifestJson, "utf8")),
      ...manifest.summary
    };
  } catch (error) {
    await fsApi.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function createSessionQuiescenceAdminCaller(options = {}) {
  const registry = options.registry;
  if (!registry || typeof registry.status !== "function") throw new TypeError("quiescence_registry_required");
  const authRoot = options.authRoot || DEFAULT_AUTH_ROOT;
  const snapshotRoot = options.snapshotRoot || DEFAULT_SNAPSHOT_ROOT;
  const fsApi = options.fsApi || fsp;
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const quiesceSession = options.quiesceSession;
  const resumeSession = options.resumeSession;
  const recoverSession = options.recoverSession;
  const startSession = options.startSession;
  let pauseInFlight = null;
  let snapshotInFlight = null;
  let resumeInFlight = null;
  let lastSnapshot = null;

  function state() {
    const current = registry.status(TARGET_SESSION_ID);
    return {
      targetSessionId: TARGET_SESSION_ID,
      state: current.state,
      epoch: current.epoch,
      socketClosed: current.socketClosed === true,
      pending: current.pending,
      blockedWrites: current.blockedWrites,
      writeErrors: current.writeErrors,
      lastFailureReason: current.lastFailureReason || "",
      pauseInFlight: Boolean(pauseInFlight),
      snapshotInFlight: Boolean(snapshotInFlight),
      resumeInFlight: Boolean(resumeInFlight),
      snapshotReady: Boolean(lastSnapshot && lastSnapshot.epoch === current.epoch),
      snapshotId: lastSnapshot?.snapshotId || ""
    };
  }

  function authorizeRequest(req = {}) {
    const remoteAddress = texto(req.socket?.remoteAddress || req.connection?.remoteAddress);
    if (!LOOPBACK_ADDRESSES.has(remoteAddress)) return resultadoErro("loopback_required");
    const forwarded = texto(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"]);
    if (forwarded) {
      const firstForwarded = forwarded.split(",", 1)[0].trim();
      if (!LOOPBACK_ADDRESSES.has(firstForwarded)) return resultadoErro("forwarded_client_not_loopback");
    }
    if (req.usuario?.papel !== "admin_master") return resultadoErro("admin_master_required");
    const supplied = texto(req.body?.sessaoId || req.query?.sessaoId);
    if (supplied && supplied !== TARGET_SESSION_ID) return resultadoErro("session_target_fixed");
    return { ok: true, targetSessionId: TARGET_SESSION_ID };
  }

  function audit(operation, result = {}) {
    logger("[WHATSAPP-QUIESCENCE-ADMIN]", JSON.stringify({
      operation,
      targetSessionId: TARGET_SESSION_ID,
      epoch: result.epoch ?? state().epoch,
      ok: result.ok === true,
      reason: result.reason || ""
    }));
  }

  async function pause() {
    const current = state();
    if (current.state === "quiesced") return { ok: true, alreadyQuiesced: true, ...current };
    if (current.state === "failed") return resultadoErro("failed_requires_explicit_recovery", current);
    if (pauseInFlight) return resultadoErro("pause_in_progress", current);
    if (typeof quiesceSession !== "function") return resultadoErro("quiesce_callback_unavailable", current);
    pauseInFlight = (async () => {
      try {
        const result = await quiesceSession(TARGET_SESSION_ID);
        audit("pause", result);
        return result.ok === true
          ? { ...resultadoPublico(result), ...state() }
          : resultadoPublico(result);
      } catch (error) {
        registry.trackerFor(TARGET_SESSION_ID).fail("pause_failed");
        const result = resultadoErro("pause_failed", { epoch: state().epoch });
        audit("pause", result);
        return result;
      }
    })();
    try {
      return await pauseInFlight;
    } finally {
      pauseInFlight = null;
    }
  }

  async function snapshot(epoch) {
    const current = state();
    const expectedEpoch = inteiro(epoch);
    if (expectedEpoch === null || expectedEpoch !== current.epoch) return resultadoErro("epoch_mismatch", current);
    if (current.state !== "quiesced" || current.socketClosed !== true) return resultadoErro("snapshot_requires_quiesced", current);
    if (current.snapshotReady) return { ok: true, alreadySnapshotted: true, ...current };
    if (snapshotInFlight) return resultadoErro("snapshot_in_progress", current);
    const tracker = registry.trackerFor(TARGET_SESSION_ID);
    try {
      registry.assertSnapshotAllowed(TARGET_SESSION_ID, expectedEpoch);
    } catch (error) {
      return resultadoErro(error.code || "snapshot_not_allowed", current);
    }
    snapshotInFlight = (async () => {
      const snapshotId = novoSnapshotId(now, randomBytes);
      try {
        const result = await copiarArvoreVerificada({ sourceRoot: authRoot, snapshotRoot, snapshotId, fsApi, now, randomBytes });
        lastSnapshot = { ...result, epoch: expectedEpoch };
        audit("snapshot", result);
        return resultadoPublico({ ...result, epoch: expectedEpoch });
      } catch (error) {
        tracker.fail("snapshot_failed");
        const result = resultadoErro(error.code || error.message || "snapshot_failed", { epoch: expectedEpoch });
        audit("snapshot", result);
        return result;
      } finally {
        snapshotInFlight = null;
      }
    })();
    return snapshotInFlight;
  }

  async function resume(epoch) {
    const current = state();
    const expectedEpoch = inteiro(epoch);
    if (expectedEpoch === null || expectedEpoch !== current.epoch) return resultadoErro("epoch_mismatch", current);
    if (current.state !== "quiesced") return resultadoErro("resume_requires_quiesced", current);
    if (!current.snapshotReady) return resultadoErro("snapshot_required_before_resume", current);
    if (resumeInFlight) return resultadoErro("resume_in_progress", current);
    if (typeof resumeSession !== "function" || typeof startSession !== "function") return resultadoErro("resume_callback_unavailable", current);
    resumeInFlight = (async () => {
      const resumed = resumeSession(TARGET_SESSION_ID, expectedEpoch);
      if (resumed?.ok !== true) {
        const result = resultadoErro(resumed?.reason || "resume_not_allowed", { epoch: expectedEpoch });
        audit("resume", result);
        return result;
      }
      try {
        const started = await startSession(TARGET_SESSION_ID);
        if (started === null || started === false) throw new Error("resume_start_not_confirmed");
        lastSnapshot = null;
        const result = { ok: true, epoch: expectedEpoch, state: state().state };
        audit("resume", result);
        return result;
      } catch (error) {
        registry.trackerFor(TARGET_SESSION_ID).fail("resume_start_failed");
        const result = resultadoErro("resume_start_failed", { epoch: expectedEpoch });
        audit("resume", result);
        return result;
      }
    })();
    try {
      return await resumeInFlight;
    } finally {
      resumeInFlight = null;
    }
  }

  async function recover(epoch) {
    const current = state();
    const expectedEpoch = inteiro(epoch);
    if (expectedEpoch === null || expectedEpoch !== current.epoch) return resultadoErro("epoch_mismatch", current);
    if (current.state !== "failed") return resultadoErro("recover_requires_failed", current);
    if (typeof recoverSession !== "function" || typeof startSession !== "function") return resultadoErro("recover_callback_unavailable", current);
    const recovered = recoverSession(TARGET_SESSION_ID, expectedEpoch);
    if (recovered?.ok !== true) {
      const result = resultadoErro(recovered?.reason || "recover_not_allowed", { epoch: expectedEpoch });
      audit("recover", result);
      return result;
    }
    try {
      const started = await startSession(TARGET_SESSION_ID);
      if (started === null || started === false) throw new Error("recover_start_not_confirmed");
      const result = { ok: true, epoch: expectedEpoch, state: state().state };
      audit("recover", result);
      return result;
    } catch (error) {
      registry.trackerFor(TARGET_SESSION_ID).fail("recover_start_failed");
      const result = resultadoErro("recover_start_failed", { epoch: expectedEpoch });
      audit("recover", result);
      return result;
    }
  }

  function status() {
    return { ok: true, ...state() };
  }

  return Object.freeze({
    targetSessionId: TARGET_SESSION_ID,
    authRoot,
    snapshotRoot,
    authorizeRequest,
    status,
    pause,
    snapshot,
    resume,
    recover
  });
}

module.exports = {
  TARGET_SESSION_ID,
  DEFAULT_AUTH_ROOT,
  DEFAULT_SNAPSHOT_ROOT,
  LOOPBACK_ADDRESSES,
  createSessionQuiescenceAdminCaller,
  listarArvore,
  copiarArvoreVerificada
};
