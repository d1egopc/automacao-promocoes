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
          physicalBytesRecovered: 0, durationMs: now() - at
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

module.exports = { createRecurringLane, validateReadOnly, summarizeGc };
