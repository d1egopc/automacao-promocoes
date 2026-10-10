"use strict";

// Local candidate; intentionally not started by the product bootstrap.
// The database lease and statement timeout live in terminalizer-pre-importer.
function criarLifecycleLaneCandidata({
  runBatch,
  intervalMs,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  persistWatchdog = async () => {}
} = {}) {
  if (typeof runBatch !== "function") throw new Error("lifecycle_run_batch_required");
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("lifecycle_interval_required");
  }
  let timer = null;
  let running = false;
  let pending = false;
  let stopped = false;
  const watchdog = {
    lastAttempt: null,
    lastSuccess: null,
    lastDurationMs: null,
    lastProcessed: 0,
    lastError: null,
    coalescedTicks: 0
  };

  async function persist() {
    try {
      await persistWatchdog({ ...watchdog });
      return true;
    } catch (error) {
      watchdog.lastSuccess = null;
      watchdog.lastError = `watchdog_persist_failed:${String(error?.message || error)}`;
      return false;
    }
  }

  async function tick() {
    if (stopped) return { ok: false, motivo: "lifecycle_parado" };
    if (running) {
      pending = true;
      watchdog.coalescedTicks += 1;
      return { ok: true, coalesced: true };
    }
    running = true;
    let result = null;
    try {
      // At most one immediate catch-up pass. Further ticks are coalesced into
      // the following scheduled opportunity, never an unbounded tight loop.
      for (let pass = 0; pass < 2; pass++) {
        pending = false;
        const started = now();
        watchdog.lastAttempt = started;
        try {
          result = await runBatch();
          watchdog.lastDurationMs = Math.max(0, now() - started);
          if (result?.ok === true && result.pulado !== true) {
            watchdog.lastSuccess = now();
            watchdog.lastProcessed = Array.isArray(result.terminalizados)
              ? result.terminalizados.length : Number(result.processed || 0);
            watchdog.lastError = null;
          } else if (result?.ok !== true) {
            watchdog.lastError = String(result?.motivo || "lifecycle_batch_failed");
          }
          if (!(await persist())) result = { ok: false, motivo: watchdog.lastError };
        } catch (error) {
          watchdog.lastDurationMs = Math.max(0, now() - started);
          watchdog.lastError = String(error?.message || error);
          await persist();
          result = { ok: false, motivo: watchdog.lastError };
        }
        if (!pending || stopped) break;
      }
    } finally {
      running = false;
    }
    return result;
  }

  function start() {
    if (timer) return { ok: true, jaIniciado: true };
    stopped = false;
    timer = setIntervalFn(() => { void tick(); }, intervalMs);
    if (typeof timer?.unref === "function") timer.unref();
    return { ok: true, intervalMs };
  }

  function stop() {
    stopped = true;
    pending = false;
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  function state(maxStalenessMs) {
    const snapshot = { ...watchdog, running, pending, stopped };
    if (!watchdog.lastSuccess) return { ...snapshot, health: "UNKNOWN" };
    if (!Number.isFinite(maxStalenessMs) || maxStalenessMs <= 0) {
      return { ...snapshot, health: "UNKNOWN" };
    }
    return { ...snapshot,
      health: now() - watchdog.lastSuccess > maxStalenessMs ? "CRITICAL" : "HEALTHY" };
  }

  return { start, stop, tick, state };
}

module.exports = { criarLifecycleLaneCandidata };
