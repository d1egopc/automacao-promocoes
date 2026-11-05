"use strict";

// This lane never authorizes a DELETE merely because the legacy recurring flag is on.
function createRecurringLane({ enabled, intervalMs, validate, execute, mode,
  now = Date.now, defer = setImmediate, logger = console }) {
  let busy = false;
  let last = null;
  return function schedule() {
    const at = now();
    if (!enabled() || busy || (last !== null && at - last < intervalMs())) return false;
    busy = true;
    last = at;
    defer(() => {
      if (!enabled()) { busy = false; return; }
      const destructive = mode() === "execute";
      Promise.resolve().then(() => destructive ? execute() : validate()).then(result => {
        logger.log("[OPTIMUS-AUTO-CLEAN-LANE]", JSON.stringify({
          mode: destructive ? "execute" : "validate", ok: result?.ok === true,
          eligible: Number(result?.eligible || 0), protected: Number(result?.protected || 0),
          blocked: Number(result?.blocked || 0), removed: Number(result?.removed || 0),
          // PostgreSQL row bytes are logical, never filesystem space recovered.
          logicalBytesReleased: Number(result?.logicalBytesReleased || 0),
          physicalBytesRecovered: Number(result?.physicalBytesRecovered || 0),
          backlog: Number(result?.backlog || 0), backlogBytes: Number(result?.backlogBytes || 0),
          quarantined: Number(result?.quarantined || 0), durationMs: now() - at
        }));
      }).catch(() => {
        logger.log("[OPTIMUS-AUTO-CLEAN-LANE]", JSON.stringify({
          mode: destructive ? "execute" : "validate", ok: false,
          blocked: 1, removed: 0, physicalBytesRecovered: 0, reason: "lane_failed"
        }));
      }).finally(() => { busy = false; });
    });
    return true;
  };
}

// Read-only Shadow admission. Work is detached from the commercial cycle and
// each scope has at most one run. A process-wide cap protects I/O when many
// workspaces are admitted at once. Aborting is cooperative: callers receive a
// signal/deadline and must check it between bounded stages.
function createShadowLane({ enabled, run, deadlineMs = () => 30000, maxGlobal = 1,
  now = Date.now, defer = setImmediate, setTimer = setTimeout, clearTimer = clearTimeout,
  logger = console }) {
  const activeScopes = new Set();
  let active = 0;
  let sequence = 0;

  function release(scope) {
    activeScopes.delete(scope);
    active = Math.max(0, active - 1);
  }

  function schedule(options = {}) {
    if (!enabled()) return { accepted: false, reason: "shadow_disabled" };
    const rawScope = String(options.scope || "global");
    const scope = /^[a-zA-Z0-9:_-]{1,96}$/.test(rawScope) ? rawScope : "invalid";
    if (activeScopes.has(scope)) return { accepted: false, reason: "scope_busy" };
    if (active >= Math.max(1, Number(maxGlobal) || 1)) {
      return { accepted: false, reason: "global_concurrency_limit" };
    }

    active += 1;
    activeScopes.add(scope);
    const admittedAt = now();
    const limitMs = Math.max(100, Math.min(120000, Number(deadlineMs()) || 30000));
    const runId = ++sequence;
    defer(() => {
      if (!enabled()) {
        release(scope);
        return;
      }
      const controller = new AbortController();
      const timer = setTimer(() => controller.abort(new Error("AUTO_CLEAN_SHADOW_DEADLINE")), limitMs);
      Promise.resolve().then(() => run({
        ...options,
        execute: false,
        shadowReadOnly: true,
        signal: controller.signal,
        deadlineAt: admittedAt + limitMs
      })).then(result => {
        logger.log("[OPTIMUS-AUTO-CLEAN-SHADOW-LANE]", JSON.stringify({
          runId,
          scope: scope === "global" ? "global" : "scoped",
          ok: result?.ok === true,
          aborted: controller.signal.aborted,
          eligible: Number(result?.totalElegiveis || 0),
          protected: Number(result?.totalProtegidos || 0),
          durationMs: Math.max(0, now() - admittedAt)
        }));
      }).catch(error => {
        logger.log("[OPTIMUS-AUTO-CLEAN-SHADOW-LANE]", JSON.stringify({
          runId,
          scope: scope === "global" ? "global" : "scoped",
          ok: false,
          aborted: controller.signal.aborted,
          reason: controller.signal.aborted ? "shadow_deadline" : "shadow_failed",
          errorType: String(error?.code || error?.name || "error").slice(0, 64)
        }));
      }).finally(() => {
        clearTimer(timer);
        release(scope);
      });
    });
    return { accepted: true, runId, deadlineAt: admittedAt + limitMs };
  }

  schedule.status = () => ({ active, scopes: activeScopes.size, maxGlobal: Math.max(1, Number(maxGlobal) || 1) });
  return schedule;
}

async function validateReadOnly({ pool, inventory }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '1000ms'");
    await client.query("SET LOCAL lock_timeout = '100ms'");
    const rows = await inventory({ loteLimite: 32, execute: false, amostraRapida: true,
      queryEngine: async (sql, params) => ({ ok: true, resultado: await client.query(sql, params) }) });
    return { ok: !rows.some(r => r.erro), eligible: rows.reduce((n, r) => n + Number(r.elegiveis || 0), 0),
      protected: rows.reduce((n, r) => n + Number(r.protegidos || 0), 0),
      blocked: rows.filter(r => r.erro).length, removed: 0, logicalBytesReleased: 0 };
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
}

function summarizeGc(value = {}) {
  const media = value.mediaPhysical || {};
  const results = media.targetResults || [];
  const reasons = {};
  for (const result of results) {
    if (result.referenceComplete === false) {
      const code = /^REFERENCE_[A-Z_]+$/.test(result.referenceReasonCode || "")
        ? result.referenceReasonCode : "REFERENCE_UNAVAILABLE";
      reasons[code] = (reasons[code] || 0) + 1;
    }
  }
  return { inspected: Number(media.scanned || 0), eligible: Number(media.candidates || 0),
    protected: Number(media.referenced || 0) + Number(media.young || 0),
    blocked: results.filter(r => r.referenceComplete === false).length,
    removed: Number(media.removed || 0), physicalBytesRecovered: Number(media.bytesFreed || 0),
    dryRun: media.dryRun !== false, reasons };
}

module.exports = { createRecurringLane, createShadowLane, validateReadOnly, summarizeGc };
