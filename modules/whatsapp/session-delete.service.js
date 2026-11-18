"use strict";

const path = require("node:path");

const DELETE_STATES = Object.freeze({
  DELETING: "deleting",
  DELETED: "deleted",
  FAILED: "failed"
});

function texto(value = "") {
  return String(value || "").trim();
}

function validarSessaoIdSeguro(sessionId = "") {
  const id = texto(sessionId);
  if (!id || id === "." || id === ".." || id.includes("\0") || id.includes("/") || id.includes("\\")) {
    const error = new Error("session_id_invalid");
    error.code = "session_id_invalid";
    throw error;
  }
  return id;
}

function ownerDaSessao(meta = {}) {
  return texto(meta?.workspaceId || meta?.clienteId || "");
}

function resolverSessaoAutorizadaParaExclusao({
  requestedId = "",
  actorWorkspaceId = "",
  actorRole = "",
  explicitTargetWorkspaceId = "",
  explicitTargetSessionId = "",
  sessoesMeta = {},
  normalizarSessaoId
} = {}) {
  const solicitada = validarSessaoIdSeguro(requestedId);
  const workspaceAtor = texto(actorWorkspaceId);
  if (!workspaceAtor || typeof normalizarSessaoId !== "function") {
    return { ok: false, statusCode: 401, reason: "authenticated_workspace_required" };
  }

  const normalizada = validarSessaoIdSeguro(normalizarSessaoId(workspaceAtor, solicitada));
  const candidatos = [...new Set([normalizada, solicitada])];
  const existentes = candidatos
    .map(sessionId => ({ sessionId, meta: sessoesMeta?.[sessionId] }))
    .filter(item => item.meta && typeof item.meta === "object");

  const propria = existentes.find(item => ownerDaSessao(item.meta) === workspaceAtor);
  if (propria) {
    return {
      ok: true,
      sessionId: propria.sessionId,
      ownerWorkspaceId: workspaceAtor,
      authorization: "workspace_owner"
    };
  }

  const exata = existentes.find(item => item.sessionId === solicitada);
  if (!exata) {
    return { ok: false, statusCode: 404, reason: "session_not_found_or_not_owned" };
  }

  const ownerWorkspaceId = ownerDaSessao(exata.meta);
  const adminExplicitamenteAutorizado = actorRole === "admin_master" &&
    ownerWorkspaceId &&
    texto(explicitTargetWorkspaceId) === ownerWorkspaceId &&
    texto(explicitTargetSessionId) === solicitada;

  if (!adminExplicitamenteAutorizado) {
    return { ok: false, statusCode: 403, reason: "cross_workspace_session_delete_denied" };
  }

  return {
    ok: true,
    sessionId: solicitada,
    ownerWorkspaceId,
    authorization: "admin_master_explicit"
  };
}

function resolverAuthStoreSeguro(dataDir = "/data", sessionId = "") {
  const id = validarSessaoIdSeguro(sessionId);
  const base = path.resolve(texto(dataDir) || "/data");
  const authPath = path.resolve(base, `auth_${id}`);
  if (path.dirname(authPath) !== base || authPath === base) {
    const error = new Error("auth_store_path_outside_data_dir");
    error.code = "auth_store_path_outside_data_dir";
    throw error;
  }
  return authPath;
}

function createSessionDeletionRegistry() {
  const entries = new Map();
  const epochs = new Map();

  function begin(sessionId = "") {
    const id = validarSessaoIdSeguro(sessionId);
    const current = entries.get(id);
    if (current?.state === DELETE_STATES.DELETING) {
      return { ok: false, reason: "session_delete_in_progress", ...current };
    }
    if (current?.state === DELETE_STATES.DELETED) {
      return { ok: false, reason: "session_already_deleted", ...current };
    }
    const epoch = Number(epochs.get(id) || 0) + 1;
    epochs.set(id, epoch);
    const token = Object.freeze({ sessionId: id, epoch });
    const next = { sessionId: id, epoch, state: DELETE_STATES.DELETING, token, reason: "" };
    entries.set(id, next);
    return { ok: true, ...next };
  }

  function matches(sessionId, token) {
    const current = entries.get(texto(sessionId));
    return Boolean(current && token && current.token === token && current.epoch === token.epoch);
  }

  function complete(sessionId, token) {
    const id = texto(sessionId);
    if (!matches(id, token)) return { ok: false, reason: "session_delete_token_invalid" };
    const current = entries.get(id);
    const next = { ...current, state: DELETE_STATES.DELETED, reason: "" };
    entries.set(id, next);
    return { ok: true, ...next };
  }

  function fail(sessionId, token, reason = "session_delete_failed") {
    const id = texto(sessionId);
    if (!matches(id, token)) return { ok: false, reason: "session_delete_token_invalid" };
    const current = entries.get(id);
    const next = { ...current, state: DELETE_STATES.FAILED, reason: texto(reason) || "session_delete_failed" };
    entries.set(id, next);
    return { ok: false, ...next };
  }

  function releaseForRecreate(sessionId, { metadataExists = false, authExists = false } = {}) {
    const id = validarSessaoIdSeguro(sessionId);
    const current = entries.get(id);
    if (!current) return { ok: true, released: false };
    if (current.state !== DELETE_STATES.DELETED || metadataExists || authExists) {
      return { ok: false, reason: "session_recreate_not_clean", state: current.state };
    }
    entries.delete(id);
    return { ok: true, released: true, previousEpoch: current.epoch };
  }

  function isBlocked(sessionId = "") {
    return entries.has(texto(sessionId));
  }

  function status(sessionId = "") {
    const current = entries.get(texto(sessionId));
    if (!current) return { sessionId: texto(sessionId), state: "active", epoch: Number(epochs.get(texto(sessionId)) || 0) };
    return { sessionId: current.sessionId, state: current.state, epoch: current.epoch, reason: current.reason };
  }

  return Object.freeze({ begin, complete, fail, releaseForRecreate, isBlocked, status });
}

function createReconnectTimerRegistry({ setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const timers = new Map();

  function cancel(sessionId = "") {
    const id = texto(sessionId);
    const timer = timers.get(id);
    if (!timer) return false;
    clearTimeoutImpl(timer);
    timers.delete(id);
    return true;
  }

  function schedule(sessionId, delayMs, callback) {
    const id = validarSessaoIdSeguro(sessionId);
    if (typeof callback !== "function") throw new TypeError("reconnect_callback_required");
    cancel(id);
    const timer = setTimeoutImpl(() => {
      if (timers.get(id) !== timer) return;
      timers.delete(id);
      callback();
    }, Math.max(0, Number(delayMs) || 0));
    timers.set(id, timer);
    return timer;
  }

  return Object.freeze({ cancel, schedule, has: sessionId => timers.has(texto(sessionId)) });
}

async function aguardarPendenciasZeradas({ getPending, timeoutMs = 5000, pollMs = 10 } = {}) {
  if (typeof getPending !== "function") throw new TypeError("get_pending_required");
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (Number(getPending() || 0) > 0 && Date.now() <= deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Number(pollMs) || 10)));
  }
  const pending = Number(getPending() || 0);
  return pending === 0
    ? { ok: true, pending: 0 }
    : { ok: false, pending, reason: "session_delete_pending_operations" };
}

async function executarComTimeout(operation, { timeoutMs = 5000, timeoutCode = "session_delete_operation_timeout" } = {}) {
  if (typeof operation !== "function") throw new TypeError("delete_operation_required");
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(timeoutCode);
          error.code = timeoutCode;
          reject(error);
        }, Math.max(1, Number(timeoutMs) || 5000));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  DELETE_STATES,
  validarSessaoIdSeguro,
  ownerDaSessao,
  resolverSessaoAutorizadaParaExclusao,
  resolverAuthStoreSeguro,
  createSessionDeletionRegistry,
  createReconnectTimerRegistry,
  aguardarPendenciasZeradas,
  executarComTimeout
};
