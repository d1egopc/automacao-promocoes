"use strict";

const STATES = Object.freeze({
  ACTIVE: "active",
  REQUESTED: "requested",
  DRAINING: "draining",
  QUIESCED: "quiesced",
  FAILED: "failed"
});

const DEFAULT_DRAIN_TIMEOUT_MS = 5000;
const DEFAULT_QUIET_WINDOW_MS = 50;

async function waitForSocketClose(socket, { timeoutMs = 5000, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  if (!socket) return { closed: true, reason: "no_socket" };
  if (socket.ws?.isClosed === true) return { closed: true, reason: "already_closed" };
  const emitter = socket.ev;
  if (!emitter || typeof emitter.once !== "function") throw new Error("socket_close_observer_unavailable");
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeoutImpl(timer);
      try { emitter.off?.("connection.update", onUpdate); } catch { /* best effort */ }
      if (error) reject(error);
      else resolve(result);
    };
    const onUpdate = update => {
      if (update?.connection === "close") finish(null, { closed: true, reason: "connection_update_close" });
    };
    emitter.once("connection.update", onUpdate);
    timer = setTimeoutImpl(() => finish(new Error("socket_close_not_confirmed")), Math.max(1, Number(timeoutMs) || 5000));
    try {
      const endResult = socket.end();
      if (endResult && typeof endResult.then === "function") endResult.catch(error => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function erroQuiescence(code, message = code) {
  const erro = new Error(message);
  erro.code = code;
  return erro;
}

function snapshotState({ sessionId, state, accepting, socketClosed, pending, blockedWrites, writeErrors, epoch, lastFailureReason }) {
  return Object.freeze({
    sessionId,
    state,
    accepting,
    socketClosed,
    pending,
    blockedWrites,
    writeErrors,
    epoch,
    lastFailureReason
  });
}

/**
 * Tracks auth writes and in-flight callbacks for one Baileys session.
 * `saveCreds` covers creds.json; keys.set covers Signal/session/pre-key files.
 * The tracker is intentionally session-local and never contains auth data.
 */
function createAuthWriteTracker({ sessionId = "", now = () => Date.now(), sleepImpl = sleep } = {}) {
  let state = STATES.ACTIVE;
  let accepting = true;
  let socketClosed = false;
  let pending = 0;
  let blockedWrites = 0;
  let writeErrors = 0;
  let epoch = 0;
  let lastActivityAt = now();
  let lastFailureReason = "";

  function begin(kind = "unknown") {
    if (!accepting) {
      blockedWrites += 1;
      lastActivityAt = now();
      if (state === STATES.QUIESCED) {
        state = STATES.FAILED;
        lastFailureReason = "auth_write_activity_after_quiesced";
      }
      throw erroQuiescence("auth_write_blocked_quiescing", `auth_write_blocked_quiescing:${kind}`);
    }

    pending += 1;
    lastActivityAt = now();
    let released = false;
    return (erro) => {
      if (released) return;
      released = true;
      pending = Math.max(0, pending - 1);
      lastActivityAt = now();
      if (erro) writeErrors += 1;
    };
  }

  async function run(kind, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("auth_write_operation_required");
    }
    const release = begin(kind);
    try {
      return await operation();
    } catch (erro) {
      release(erro);
      throw erro;
    } finally {
      release();
    }
  }

  function request() {
    if (state === STATES.QUIESCED) {
      return { ok: true, alreadyQuiesced: true, epoch };
    }
    if (state !== STATES.ACTIVE) {
      return { ok: false, reason: "quiescence_already_requested", state };
    }
    state = STATES.REQUESTED;
    epoch += 1;
    socketClosed = false;
    blockedWrites = 0;
    writeErrors = 0;
    lastFailureReason = "";
    lastActivityAt = now();
    return { ok: true, alreadyQuiesced: false, epoch };
  }

  function beginDrain({ closed = false } = {}) {
    if (state !== STATES.REQUESTED) {
      return { ok: false, reason: "quiescence_not_requested", state, epoch };
    }
    if (closed !== true) {
      state = STATES.FAILED;
      accepting = false;
      lastFailureReason = "socket_close_not_proven";
      return { ok: false, reason: "socket_close_not_proven", state, epoch };
    }
    socketClosed = true;
    accepting = false;
    state = STATES.DRAINING;
    lastActivityAt = now();
    return { ok: true, state, epoch, socketClosed };
  }

  async function waitForDrain({
    timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
    quietWindowMs = DEFAULT_QUIET_WINDOW_MS
  } = {}) {
    if (state !== STATES.DRAINING || accepting || socketClosed !== true) {
      return { ok: false, reason: "socket_close_not_proven", state, socketClosed };
    }
    const inicio = now();
    const limite = inicio + Math.max(0, Number(timeoutMs) || 0);

    while (pending > 0 && now() <= limite) {
      await sleepImpl(Math.min(10, Math.max(1, limite - now())));
    }

    if (pending > 0) {
      state = STATES.FAILED;
      lastFailureReason = "auth_writes_drain_timeout";
      return { ok: false, reason: "auth_writes_drain_timeout", state, pending, blockedWrites, writeErrors };
    }

    const quietUntil = now() + Math.max(0, Number(quietWindowMs) || 0);
    while (now() < quietUntil) {
      if (pending > 0 || blockedWrites > 0 || writeErrors > 0) {
        state = STATES.FAILED;
        lastFailureReason = "auth_write_activity_during_drain";
        return { ok: false, reason: "auth_write_activity_during_drain", state, pending, blockedWrites, writeErrors };
      }
      await sleepImpl(Math.min(10, Math.max(1, quietUntil - now())));
    }

    if (pending > 0 || blockedWrites > 0 || writeErrors > 0) {
      state = STATES.FAILED;
      lastFailureReason = "auth_write_activity_during_drain";
      return { ok: false, reason: "auth_write_activity_during_drain", state, pending, blockedWrites, writeErrors };
    }

    state = STATES.QUIESCED;
    return { ok: true, state, pending, blockedWrites, writeErrors, epoch, drainedAt: now(), lastActivityAt };
  }

  function resume(expectedEpoch) {
    if (state !== STATES.QUIESCED || Number(expectedEpoch) !== epoch) {
      return { ok: false, reason: "quiescence_token_invalid", state, epoch };
    }
    accepting = true;
    socketClosed = false;
    state = STATES.ACTIVE;
    lastFailureReason = "";
    lastActivityAt = now();
    return { ok: true, state, epoch };
  }

  function fail(reason = "quiescence_failed") {
    accepting = false;
    socketClosed = false;
    state = STATES.FAILED;
    lastFailureReason = reason;
    return { ok: false, reason, state, epoch, pending, blockedWrites, writeErrors };
  }

  function recover(expectedEpoch) {
    if (state !== STATES.FAILED || Number(expectedEpoch) !== epoch || pending !== 0) {
      return { ok: false, reason: "failed_quiescence_recovery_not_safe", state, epoch, pending };
    }
    accepting = true;
    socketClosed = false;
    state = STATES.ACTIVE;
    lastActivityAt = now();
    return { ok: true, state, epoch, recoveredFrom: lastFailureReason || "quiescence_failed" };
  }

  function assertSnapshotAllowed(expectedEpoch) {
    if (state !== STATES.QUIESCED || socketClosed !== true || Number(expectedEpoch) !== epoch || pending !== 0 || blockedWrites !== 0 || writeErrors !== 0) {
      throw erroQuiescence("snapshot_not_allowed", "snapshot_not_allowed_before_verified_quiescence");
    }
    return Object.freeze({ sessionId, epoch, state, pending, blockedWrites, writeErrors });
  }

  function wrapAuthState(authState = {}) {
    if (authState && authState.__optimusQuiescenceWrapped === true) return authState;
    const originalState = authState.state || authState;
    const originalKeys = originalState?.keys || {};
    const originalSaveCreds = authState.saveCreds;
    const wrappedKeys = {
      ...originalKeys,
      get: typeof originalKeys.get === "function" ? originalKeys.get.bind(originalKeys) : originalKeys.get,
      set: typeof originalKeys.set === "function"
        ? (...args) => run("keys.set", () => originalKeys.set(...args))
        : originalKeys.set
    };
    const wrapped = {
      state: { ...originalState, keys: wrappedKeys },
      saveCreds: typeof originalSaveCreds === "function"
        ? (...args) => run("creds.update", () => originalSaveCreds(...args))
        : originalSaveCreds
    };
    Object.defineProperty(wrapped, "__optimusQuiescenceWrapped", { value: true, enumerable: false });
    return wrapped;
  }

  function status() {
    return snapshotState({ sessionId, state, accepting, socketClosed, pending, blockedWrites, writeErrors, epoch, lastFailureReason });
  }

  return Object.freeze({
    sessionId,
    begin,
    request,
    beginDrain,
    run,
    waitForDrain,
    resume,
    recover,
    fail,
    assertSnapshotAllowed,
    wrapAuthState,
    isQuiescing: () => state !== STATES.ACTIVE,
    isBlocked: () => accepting === false,
    status
  });
}

function createSessionQuiescenceRegistry(options = {}) {
  const trackers = new Map();

  function trackerFor(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) throw new TypeError("session_id_required");
    if (!trackers.has(id)) trackers.set(id, createAuthWriteTracker({ ...options, sessionId: id }));
    return trackers.get(id);
  }

  function isQuiescing(sessionId = "") {
    return trackerFor(sessionId).isQuiescing();
  }

  function wrapAuthState(sessionId, authState) {
    return trackerFor(sessionId).wrapAuthState(authState);
  }

  function run(sessionId, kind, operation) {
    return trackerFor(sessionId).run(kind, operation);
  }

  function enter(sessionId, kind) {
    return trackerFor(sessionId).begin(kind);
  }

  function status(sessionId) {
    return trackerFor(sessionId).status();
  }

  function request(sessionId) {
    const tracker = trackerFor(sessionId);
    const requested = tracker.request();
    return { ...requested, tracker, sessionId: String(sessionId).trim() };
  }

  async function quiesce(sessionId, { endSocket, timeoutMs, quietWindowMs } = {}) {
    const pedido = request(sessionId);
    if (!pedido.ok) return pedido;
    try {
      if (typeof endSocket !== "function") throw new Error("socket_close_callback_required");
      const endResult = await endSocket();
      const drainGate = pedido.tracker.beginDrain({ closed: endResult === true || endResult?.closed === true });
      if (!drainGate.ok) return { ...drainGate, sessionId: pedido.sessionId, epoch: pedido.epoch, tracker: pedido.tracker };
      const drain = await pedido.tracker.waitForDrain({ timeoutMs, quietWindowMs });
      return { ...drain, sessionId: pedido.sessionId, epoch: pedido.epoch, tracker: pedido.tracker };
    } catch (erro) {
      return { ...pedido.tracker.fail("quiescence_operation_failed"), sessionId: pedido.sessionId, errorCode: erro.code || "quiescence_operation_failed" };
    }
  }

  function resume(sessionId, epoch) {
    return trackerFor(sessionId).resume(epoch);
  }

  function recover(sessionId, epoch) {
    return trackerFor(sessionId).recover(epoch);
  }

  function assertSnapshotAllowed(sessionId, epoch) {
    return trackerFor(sessionId).assertSnapshotAllowed(epoch);
  }

  return Object.freeze({ trackerFor, isQuiescing, wrapAuthState, run, enter, status, request, quiesce, resume, recover, assertSnapshotAllowed });
}

module.exports = {
  STATES,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_QUIET_WINDOW_MS,
  waitForSocketClose,
  createAuthWriteTracker,
  createSessionQuiescenceRegistry
};
