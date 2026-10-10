"use strict";

// Laboratory-only wiring. Not imported by the production bootstrap.
const { criarLifecycleLaneCandidata } = require("./lifecycle-lane.candidate");
const { runSteadyLifecycle } = require("./lifecycle-steady.candidate");

function criarBootstrapLocalCandidato({
  lifecyclePool, lifecycleLimit = 10, lifecycleIntervalMs = 1000,
  persistWatchdog, runRadarReplay = async () => ({ estado: "vazio" }),
  runClonePass = async () => ({ ok: true }), cloneIntervalMs = 1000,
  replayIntervalMs = 1000, runLegacyDrain = null,
  legacyDrainLimit = 100, legacyDrainIntervalMs = 1000,
  legacyDrainCompletionRequired = true,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (!lifecyclePool || typeof persistWatchdog !== "function") {
    throw new Error("local_bootstrap_lifecycle_dependencies_required");
  }
  const legacyEnabled = typeof runLegacyDrain === "function";
  const boundedLegacyLimit = Math.max(1, Math.min(100,
    Number.isInteger(legacyDrainLimit) ? legacyDrainLimit : 100));
  let legacyReady = !legacyEnabled;
  const lane = criarLifecycleLaneCandidata({
    intervalMs: lifecycleIntervalMs, setIntervalFn, clearIntervalFn,
    persistWatchdog: snapshot => persistWatchdog(legacyReady ? snapshot : {
      ...snapshot, lastSuccess: null, lastError: "legacy_drain_not_checked"
    }),
    runBatch: async () => {
      const result = await runSteadyLifecycle({ pool: lifecyclePool,
        limit: lifecycleLimit });
      return { ...result, pulado: result.skipped === true,
        terminalizados: result.terminalized || [],
        motivo: result.reason || result.error };
    }
  });
  let radarTimer = null;
  let cloneTimer = null;
  let legacyTimer = null;
  let radarRunning = false;
  let cloneRunning = false;
  let legacyRunning = false;
  let started = false;
  async function replayTick() {
    if (!started || radarRunning) return { skipped: true };
    radarRunning = true;
    try { return await runRadarReplay(); }
    finally { radarRunning = false; }
  }
  async function cloneTick() {
    if (!started || cloneRunning) return { skipped: true };
    cloneRunning = true;
    try { return await runClonePass(); }
    finally { cloneRunning = false; }
  }
  async function legacyTick() {
    if (!started || !legacyEnabled || legacyRunning) return { skipped: true };
    legacyRunning = true;
    try {
      const result = await runLegacyDrain({ limit: boundedLegacyLimit });
      if (result?.ok !== true ||
          !Number.isInteger(result.processed) ||
          result.processed < 0 || result.processed > boundedLegacyLimit) {
        legacyReady = false;
        await persistWatchdog({ ...lane.state(60000), lastSuccess: null,
          lastError: "legacy_drain_failed_or_unbounded" });
        return { ok: false, motivo: "legacy_drain_failed_or_unbounded" };
      }
      // A successful bounded batch is progress, not proof that legacy work
      // was reconciled. Keep admission unhealthy until the drain explicitly
      // reports completion after its own verification pass.
      legacyReady = result.completed === true ||
        (legacyDrainCompletionRequired === false && result.ok === true);
      await persistWatchdog(legacyReady ? lane.state(60000) : {
        ...lane.state(60000), lastSuccess: null,
        lastError: "legacy_drain_incomplete"
      });
      return result;
    } catch (error) {
      legacyReady = false;
      await persistWatchdog({ ...lane.state(60000), lastSuccess: null,
        lastError: String(error?.message || error) });
      return { ok: false, motivo: "legacy_drain_failed" };
    } finally { legacyRunning = false; }
  }
  async function start() {
    if (started) return { ok: true, alreadyStarted: true };
    started = true;
    lane.start();
    // The first bounded selector pass must complete before replay can admit.
    const lifecycle = await lane.tick();
    const legacy = legacyEnabled ? await legacyTick() : { ok: true, skipped: true };
    radarTimer = setIntervalFn(() => { void replayTick().catch(() => {}); },
      replayIntervalMs);
    cloneTimer = setIntervalFn(() => { void cloneTick().catch(() => {}); },
      cloneIntervalMs);
    if (legacyEnabled) legacyTimer = setIntervalFn(() => {
      void legacyTick().catch(() => {});
    }, legacyDrainIntervalMs);
    radarTimer?.unref?.();
    cloneTimer?.unref?.();
    legacyTimer?.unref?.();
    return { ok: lifecycle?.ok === true && legacy?.ok === true,
      lifecycle, legacy,
      replay: await replayTick(), clone: await cloneTick() };
  }
  function stop() {
    started = false;
    lane.stop();
    if (radarTimer) clearIntervalFn(radarTimer);
    if (cloneTimer) clearIntervalFn(cloneTimer);
    if (legacyTimer) clearIntervalFn(legacyTimer);
    radarTimer = null;
    cloneTimer = null;
    legacyTimer = null;
  }
  return { start, stop, replayTick, cloneTick, legacyTick,
    lifecycleTick: lane.tick,
    lifecycleState: lane.state };
}

module.exports = { criarBootstrapLocalCandidato };
