"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertAbsolute, assertDurableStorage } = require("./durable-path");

const STATUSES = Object.freeze(["LEGACY", "PREPARING", "QUIESCED", "V3_MIGRATED"]);
const TRANSITIONS = Object.freeze({ LEGACY: ["PREPARING"], PREPARING: ["QUIESCED"], QUIESCED: ["V3_MIGRATED"], V3_MIGRATED: [] });

function createWorkspaceFence({ migratedWorkspaceIds = [] } = {}) {
  const migrated = new Set(migratedWorkspaceIds.map(value => String(value).trim()).filter(Boolean));
  return Object.freeze({
    isMigrated(workspaceId) { return migrated.has(String(workspaceId || "")); },
    legacyAllowed(workspaceId) { return !migrated.has(String(workspaceId || "")); },
    v3Required(workspaceId) { return migrated.has(String(workspaceId || "")); }
  });
}

function validateState(value) {
  if (!value || value.version !== 2 || !value.workspaces || typeof value.workspaces !== "object") throw new Error("mensageiro_v3_fence_corrompido");
  for (const entry of Object.values(value.workspaces)) if (!STATUSES.includes(entry?.status)) throw new Error("mensageiro_v3_fence_corrompido");
  return value;
}

function createPersistentWorkspaceFence({ filePath, store } = {}) {
  if (store) {
    const status = workspaceId => store.getWorkspaceFence(workspaceId).status;
    const api = {
      status,
      isMigrated(workspaceId) { return status(workspaceId) === "V3_MIGRATED"; },
      legacyAllowed(workspaceId) { return status(workspaceId) === "LEGACY"; },
      v3Required(workspaceId) { return status(workspaceId) === "V3_MIGRATED"; },
      markPreparing(workspaceId, details = {}) { return store.transitionWorkspaceFence(workspaceId, "PREPARING", details); },
      markQuiesced(workspaceId, details = {}) { return store.transitionWorkspaceFence(workspaceId, "QUIESCED", details); },
      markMigrated(workspaceId, details = {}) {
        const current = status(workspaceId);
        if (current === "V3_MIGRATED") return store.getWorkspaceFence(workspaceId);
        if (current === "LEGACY") store.transitionWorkspaceFence(workspaceId, "PREPARING", details);
        if (store.getWorkspaceFence(workspaceId).status === "PREPARING") store.transitionWorkspaceFence(workspaceId, "QUIESCED", details);
        return store.transitionWorkspaceFence(workspaceId, "V3_MIGRATED", details);
      },
      markLegacy() { throw new Error("fence_reversao_bloqueada"); }
    };
    return Object.freeze(api);
  }
  if (!filePath) throw new Error("fence_file_path_obrigatorio");
  const normalized = assertAbsolute(filePath, "fence_file_path_invalido");
  assertDurableStorage(normalized, { createParent: true });
  const lockPath = `${normalized}.lock`;
  const markerPath = `${normalized}.migrated`;
  const empty = () => ({ version: 2, revision: 0, workspaces: {} });
  const read = () => {
    try { return validateState(JSON.parse(fs.readFileSync(normalized, "utf8"))); }
    catch (error) {
      if (error.code === "ENOENT") {
        if (fs.existsSync(markerPath)) throw new Error("mensageiro_v3_fence_missing");
        return empty();
      }
      if (error instanceof SyntaxError) throw new Error("mensageiro_v3_fence_corrompido");
      throw error;
    }
  };
  const write = value => {
    const tmp = `${normalized}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2), "utf8"); if (process.platform !== "win32") fs.fsyncSync(fd); }
    catch (error) { try { fs.closeSync(fd); } catch {} try { fs.rmSync(tmp, { force: true }); } catch {} throw error; }
    fs.closeSync(fd);
    try {
      if (process.platform === "win32") { fs.copyFileSync(tmp, normalized); fs.rmSync(tmp, { force: true }); }
      else {
        fs.renameSync(tmp, normalized);
        if (process.platform !== "win32") { const dirFd = fs.openSync(path.dirname(normalized), "r"); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); } }
      }
    } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch {} throw error; }
  };
  const withLock = fn => {
    let fd; const started = Date.now();
    for (;;) {
      try { fd = fs.openSync(lockPath, "wx", 0o600); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() - started > 10_000) throw new Error("mensageiro_v3_fence_lock_timeout");
        try { const stat = fs.statSync(lockPath); if (Date.now() - stat.mtimeMs > 10 * 60_000 && stat.size === 0) fs.rmSync(lockPath, { force: true }); }
        catch (statError) { if (statError.code !== "ENOENT") throw statError; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try { return fn(); } finally { try { fs.closeSync(fd); } catch {} try { fs.rmSync(lockPath, { force: true }); } catch {} }
  };
  const transition = (workspaceId, nextStatus, details = {}) => withLock(() => {
    const id = String(workspaceId || "").trim();
    if (!id || !STATUSES.includes(nextStatus)) throw new Error("fence_estado_invalido");
    const state = read(); const current = state.workspaces[id] || { status: "LEGACY", revision: 0 };
    if (current.status === nextStatus) return current;
    if (!TRANSITIONS[current.status]?.includes(nextStatus)) throw new Error("fence_transicao_invalida");
    const next = { ...current, ...details, status: nextStatus, revision: Number(current.revision || 0) + 1, updatedAt: new Date().toISOString() };
    state.workspaces[id] = next; state.revision += 1;
    if (nextStatus === "V3_MIGRATED") fs.writeFileSync(markerPath, JSON.stringify({ workspaceId: id, revision: next.revision, at: next.updatedAt }), { mode: 0o600 });
    write(state); return next;
  });
  const status = workspaceId => (read().workspaces[String(workspaceId || "")] || { status: "LEGACY", revision: 0 }).status;
  return Object.freeze({
    status,
    isMigrated: workspaceId => status(workspaceId) === "V3_MIGRATED",
    legacyAllowed: workspaceId => status(workspaceId) === "LEGACY",
    v3Required: workspaceId => status(workspaceId) === "V3_MIGRATED",
    markPreparing: (workspaceId, details) => transition(workspaceId, "PREPARING", details),
    markQuiesced: (workspaceId, details) => transition(workspaceId, "QUIESCED", details),
    markMigrated(workspaceId, details = {}) {
      const current = status(workspaceId);
      if (current === "V3_MIGRATED") return read().workspaces[String(workspaceId)];
      if (current === "LEGACY") transition(workspaceId, "PREPARING", details);
      if (status(workspaceId) === "PREPARING") transition(workspaceId, "QUIESCED", details);
      return transition(workspaceId, "V3_MIGRATED", details);
    },
    markLegacy() { throw new Error("fence_reversao_bloqueada"); }
  });
}

module.exports = { createWorkspaceFence, createPersistentWorkspaceFence, STATUSES };
