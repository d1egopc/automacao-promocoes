"use strict";

const { validarEstadoOperacional, exigirCapturaUniversal } =
  require("./operation-epoch");

// The real server installs this once, before listeners and ingress workers.
// Standalone service tests that do not start index.js remain legacy fixtures.
let runtimeState = null;

function instalarEstadoIngressReal(state) {
  const validated = validarEstadoOperacional({ mode: state?.mode,
    operation_epoch_started_at: state?.operationEpochStartedAt });
  if (runtimeState &&
      JSON.stringify(runtimeState) !== JSON.stringify(validated)) {
    throw new Error("ingress_runtime_mode_change_requires_restart");
  }
  runtimeState = validated;
  return runtimeState;
}

function verificarCapturaIngressReal(capturedAt) {
  if (!runtimeState || runtimeState.mode !== "UNIVERSAL") {
    return { ok: true, mode: runtimeState?.mode || "LEGACY_FIXTURE" };
  }
  if (!capturedAt || !Number.isFinite(new Date(capturedAt).getTime())) {
    return { ok: false, reason: "capture_t0_required" };
  }
  try {
    const result = exigirCapturaUniversal({ capturedAt: new Date(capturedAt).toISOString(),
      state: runtimeState });
    return { ok: result.ok === true, mode: "UNIVERSAL",
      reason: result.reason || "" };
  } catch {
    return { ok: false, reason: "capture_t0_invalid" };
  }
}

function modoIngressReal() {
  return runtimeState?.mode || "LEGACY_FIXTURE";
}

function exigirAutoridadeLegacyReal(operation = "legacy_operation") {
  if (modoIngressReal() === "UNIVERSAL") {
    throw new Error(`${operation}_disabled_in_universal_epoch`);
  }
  return true;
}

function sqlFiltroEpochReal(eventAlias = "e") {
  if (modoIngressReal() !== "UNIVERSAL") return "TRUE";
  if (!/^[a-z][a-z0-9_]*$/i.test(eventAlias)) {
    throw new Error("epoch_sql_alias_invalid");
  }
  return `${eventAlias}.capturado_em >= (
    SELECT operation_epoch_started_at FROM engine_operation_state
    WHERE id=1 AND mode='UNIVERSAL')`;
}

module.exports = { instalarEstadoIngressReal, verificarCapturaIngressReal,
  modoIngressReal, exigirAutoridadeLegacyReal, sqlFiltroEpochReal };
