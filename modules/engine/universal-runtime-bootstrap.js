"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { lerEstadoOperacional, MODES } = require("./operation-epoch");

// This is called by the real index.js startup, after the base Engine schema.
// Additive DDL is idempotent; it does not select a cutover time or enable the
// Universal executor. The persisted singleton is the sole mode authority.
async function prepararModoOperacionalReal({ pool, readFile = name =>
  fs.readFileSync(path.join(__dirname, name), "utf8") } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("operational_runtime_pool_required");
  }
  await pool.query(readFile("operation-epoch.additive.sql"));
  await pool.query(readFile("universal-queue.additive.sql"));
  await pool.query(readFile("universal-one-shot-smoke.additive.sql"));
  await pool.query(`INSERT INTO engine_operation_state (id,mode)
    VALUES (1,'LEGACY') ON CONFLICT (id) DO NOTHING`);
  const state = await lerEstadoOperacional(pool);
  if (state.mode === MODES.UNIVERSAL) {
    await pool.query(readFile("radar-replay.candidate.sql"));
  }
  const ledger = await pool.query(`SELECT to_regclass('financial_credit_ledger') AS table_name`);
  if (ledger.rows?.[0]?.table_name) {
    await pool.query(readFile("universal-credits.additive.sql"));
  } else if (state.mode === MODES.UNIVERSAL) {
    throw new Error("universal_financial_ledger_missing");
  }
  return state;
}

function escolherMotorOperacional(state) {
  if (!state || !Object.values(MODES).includes(state.mode)) {
    throw new Error("operational_runtime_mode_unproven");
  }
  if (state.mode === MODES.UNIVERSAL && !state.operationEpochStartedAt) {
    throw new Error("operational_runtime_epoch_missing");
  }
  if (state.mode === MODES.ROLLBACK_FROZEN) {
    throw new Error("operational_runtime_frozen");
  }
  return state.mode === MODES.UNIVERSAL ? "UNIVERSAL" : "LEGACY";
}

module.exports = { prepararModoOperacionalReal, escolherMotorOperacional };
