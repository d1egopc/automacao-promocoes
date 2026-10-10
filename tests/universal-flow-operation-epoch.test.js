"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MODES, validarEstadoOperacional, lerEstadoOperacional,
  classificarCapturaNoEpoch, exigirCapturaUniversal } =
  require("../modules/engine/operation-epoch");

const epoch = "2026-10-10T12:00:00.000Z";

test("no stored state and missing table both fail closed", async () => {
  assert.throws(() => validarEstadoOperacional(null), /operation_state_missing/);
  await assert.rejects(lerEstadoOperacional({ query: async () => ({ rows: [] }) }),
    /operation_state_missing/);
  await assert.rejects(lerEstadoOperacional({ query: async () => {
    throw new Error("relation engine_operation_state does not exist");
  } }), /does not exist/);
});

test("pre-epoch capture never becomes new work, including after restart", () => {
  const state = { mode: MODES.UNIVERSAL, operationEpochStartedAt: epoch };
  const oldCapture = "2026-10-10T11:59:59.999Z";
  assert.equal(classificarCapturaNoEpoch({ capturedAt: oldCapture,
    operationEpochStartedAt: epoch }), "LEGACY");
  assert.deepEqual(exigirCapturaUniversal({ capturedAt: oldCapture, state }),
    { ok: false, generation: "LEGACY", reason: "pre_epoch_capture" });
  assert.deepEqual(exigirCapturaUniversal({ capturedAt: oldCapture, state }),
    { ok: false, generation: "LEGACY", reason: "pre_epoch_capture" });
});

test("post-epoch capture preserves factual T0", () => {
  const capturedAt = "2026-10-10T12:00:00.001Z";
  assert.deepEqual(exigirCapturaUniversal({ capturedAt,
    state: { mode: MODES.UNIVERSAL, operationEpochStartedAt: epoch } }),
    { ok: true, generation: "UNIVERSAL", capturedAt });
  assert.equal(classificarCapturaNoEpoch({ capturedAt: epoch,
    operationEpochStartedAt: epoch }), "UNIVERSAL");
});

test("ambiguous mode or missing T0 fails closed", () => {
  assert.throws(() => validarEstadoOperacional({ mode: "unknown" }), /unknown/);
  assert.throws(() => validarEstadoOperacional({ mode: MODES.UNIVERSAL }), /missing/);
  assert.throws(() => exigirCapturaUniversal({ capturedAt: "",
    state: { mode: MODES.UNIVERSAL, operationEpochStartedAt: epoch } }), /capture_t0/);
  assert.equal(exigirCapturaUniversal({ capturedAt: epoch,
    state: { mode: MODES.CUTOVER_PREPARED } }).ok, false);
});
