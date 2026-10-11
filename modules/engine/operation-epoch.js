"use strict";

// Local cutover building block; not imported by the production startup.
// This module is deliberately independent of the legacy queue. The cutover
// timestamp is an explicit, durable operational boundary, never a substitute
// for an offer's factual capture clock (T0).
const MODES = Object.freeze({
  LEGACY: "LEGACY",
  CUTOVER_PREPARED: "CUTOVER_PREPARED",
  UNIVERSAL: "UNIVERSAL",
  ROLLBACK_FROZEN: "ROLLBACK_FROZEN"
});

function utcInstant(value, field) {
  const source = value instanceof Date ? value.toISOString() : value;
  if (typeof source !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source)) {
    throw new Error(`${field}_utc_required`);
  }
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field}_invalid`);
  return parsed;
}

function validarEstadoOperacional(row) {
  // An empty singleton may mean missing cutover state after a failure. Never
  // silently revive the legacy runtime or infer an epoch in that situation.
  if (!row) throw new Error("operation_state_missing");
  const mode = String(row.mode || "");
  if (!Object.values(MODES).includes(mode)) throw new Error("operation_mode_unknown");
  const raw = row.operation_epoch_started_at;
  if (mode === MODES.UNIVERSAL && !raw) {
    throw new Error("universal_epoch_missing");
  }
  if (mode === MODES.LEGACY && raw) {
    throw new Error("legacy_epoch_inconsistent");
  }
  return Object.freeze({ mode,
    operationEpochStartedAt: raw ? utcInstant(raw, "operation_epoch").toISOString() : null });
}

async function lerEstadoOperacional(client) {
  if (!client || typeof client.query !== "function") {
    throw new Error("operation_epoch_client_required");
  }
  // A missing table is a failed preflight, not permission to guess an epoch.
  const result = await client.query(`SELECT mode, operation_epoch_started_at
    FROM engine_operation_state WHERE id=1`);
  return validarEstadoOperacional(result.rows[0]);
}

function classificarCapturaNoEpoch({ capturedAt, operationEpochStartedAt }) {
  const t0 = utcInstant(capturedAt, "capture_t0");
  const epoch = utcInstant(operationEpochStartedAt, "operation_epoch");
  return t0.getTime() < epoch.getTime() ? "LEGACY" : "UNIVERSAL";
}

function exigirCapturaUniversal({ capturedAt, state }) {
  const current = validarEstadoOperacional(state && "mode" in state
    ? { mode: state.mode,
      operation_epoch_started_at: state.operationEpochStartedAt ??
        state.operation_epoch_started_at }
    : state);
  if (current.mode !== MODES.UNIVERSAL) {
    return { ok: false, reason: "universal_mode_not_active" };
  }
  const generation = classificarCapturaNoEpoch({ capturedAt,
    operationEpochStartedAt: current.operationEpochStartedAt });
  return generation === "UNIVERSAL"
    ? { ok: true, generation, capturedAt: utcInstant(capturedAt, "capture_t0").toISOString() }
    : { ok: false, generation, reason: "pre_epoch_capture" };
}

module.exports = { MODES, utcInstant, validarEstadoOperacional,
  lerEstadoOperacional, classificarCapturaNoEpoch, exigirCapturaUniversal };
