"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { prepararModoOperacionalReal, escolherMotorOperacional } =
  require("../modules/engine/universal-runtime-bootstrap");

function pool(mode, epoch = null, hasLedger = true) {
  const calls = [];
  return { calls, query: async sql => {
    calls.push(sql);
    if (sql.includes("SELECT mode, operation_epoch_started_at")) {
      return { rows: [{ mode, operation_epoch_started_at: epoch }] };
    }
    if (sql.includes("to_regclass('financial_credit_ledger')")) {
      return { rows: [{ table_name: hasLedger ? "financial_credit_ledger" : null }] };
    }
    return { rows: [] };
  } };
}

test("real startup migration leaves LEGACY as the only executor", async () => {
  const db = pool("LEGACY");
  const state = await prepararModoOperacionalReal({ pool: db,
    readFile: name => `-- ${name}` });
  assert.equal(escolherMotorOperacional(state), "LEGACY");
  assert.equal(db.calls.length, 6);
  assert.match(db.calls[2], /ON CONFLICT \(id\) DO NOTHING/);
});

test("PREPARED does not start Universal sends", async () => {
  const state = await prepararModoOperacionalReal({
    pool: pool("CUTOVER_PREPARED"), readFile: () => "-- fixture" });
  assert.equal(escolherMotorOperacional(state), "LEGACY");
});

test("UNIVERSAL selects only the new motor with persisted epoch", async () => {
  const state = await prepararModoOperacionalReal({
    pool: pool("UNIVERSAL", "2026-10-10T12:00:00.000Z"),
    readFile: () => "-- fixture" });
  assert.equal(escolherMotorOperacional(state), "UNIVERSAL");
});

test("UNIVERSAL without the existing financial ledger fails closed", async () => {
  await assert.rejects(prepararModoOperacionalReal({
    pool: pool("UNIVERSAL", "2026-10-10T12:00:00.000Z", false),
    readFile: () => "-- fixture" }), /universal_financial_ledger_missing/);
});

test("missing state, missing epoch and frozen mode fail closed", async () => {
  await assert.rejects(prepararModoOperacionalReal({
    pool: pool("UNIVERSAL"), readFile: () => "-- fixture" }),
  /universal_epoch_missing/);
  assert.throws(() => escolherMotorOperacional({ mode: "ROLLBACK_FROZEN" }),
    /frozen/);
  assert.throws(() => escolherMotorOperacional(null), /mode_unproven/);
});
