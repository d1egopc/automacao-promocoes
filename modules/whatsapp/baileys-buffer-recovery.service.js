"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");

// Temporary, instance-local repair. Never enable by workspace alone or affect
// another session while the linked-device recovery is being homologated.
function createBufferRecovery({ workspaceId, sessionId, isCurrent,
  now = Date.now, monotonic = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout, report = () => {} } = {}) {
  if (workspaceId !== "user_k3phmbkf" || sessionId !== "user_k3phmbkf_ServCel") return null;
  if (typeof isCurrent !== "function") throw new Error("buffer_identity_required");
  const contexts = new AsyncLocalStorage(), historical = new WeakSet();
  let pending = false, closed = false, timer = null, ev, ws, deadline = 0;
  let cutoff = Math.ceil(now() / 1000), recovered = false;
  const emit = stage => { try { report(stage); } catch {} };
  const endPending = () => {
    pending = false;
    cutoff = Math.max(cutoff, Math.ceil(now() / 1000));
    if (timer) cancel(timer);
    timer = null;
  };
  const expired = () => {
    if (closed || !pending) return;
    if (monotonic() < deadline) { timer = schedule(expired, Math.ceil(deadline - monotonic())); timer?.unref?.(); return; }
    let current = false;
    try { current = isCurrent(ev) === true && ws?.isOpen === true; } catch {}
    if (!current) { endPending(); closed = true; emit("stale_or_closed"); return; }
    // First establish the history fence, then release the native buffer once.
    // Pending decrypt/upsert work remains historical by timestamp/type/context.
    endPending(); recovered = true;
    try {
      if (ev?.isBuffering?.() === true) { emit("initial_timeout_recovery"); ev.flush(); }
      else emit("initial_buffer_already_released");
    } catch { closed = true; emit("recovery_failed_closed"); }
  };
  const suppress = message => {
    if (!message || typeof message !== "object") return true;
    if (historical.has(message)) return true;
    const stamp = Number(message.messageTimestamp);
    return closed || pending || !Number.isSafeInteger(stamp) || stamp <= cutoff || stamp > Math.ceil(now() / 1000);
  };
  return {
    isOffline: node => node?.attrs?.offline === "1",
    start({ ev: emitter, ws: socket }) {
      if (ev || closed) return;
      ev = emitter; ws = socket; pending = true;
    },
    open() {
      if (!ev || !pending || closed || timer !== null) return;
      deadline = monotonic() + 20000;
      timer = schedule(expired, 20000); timer?.unref?.();
    },
    complete() { if (!closed && pending) { endPending(); emit("offline_completion"); } },
    stop() { endPending(); closed = true; },
    observeMessage(message, type) {
      if (message && typeof message === "object" && (type !== "notify" || suppress(message))) historical.add(message);
    },
    runMessage(message, work) { return contexts.run(suppress(message), work); },
    suppressCurrentContext: () => contexts.getStore() === true,
    shouldSuppressMessage: suppress,
    snapshot: () => ({ pending, recovered, closed }),
  };
}
module.exports = { createBufferRecovery };
