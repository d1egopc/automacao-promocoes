"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { criarLifecycleLaneCandidata } = require("../modules/engine/lifecycle-lane.candidate");

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test("lane independente: single-flight, coalescing e watchdog", async () => {
  let clock = 1000;
  let timer;
  let calls = 0;
  let active = 0;
  let peak = 0;
  const first = deferred();
  const snapshots = [];
  const lane = criarLifecycleLaneCandidata({
    intervalMs: 50,
    now: () => clock,
    setIntervalFn: callback => { timer = callback; return { unref() {} }; },
    clearIntervalFn: () => { timer = null; },
    persistWatchdog: async snapshot => { snapshots.push(snapshot); },
    runBatch: async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      if (calls === 1) await first.promise;
      active--;
      clock += 10;
      return { ok: true, terminalizados: [{ id: calls }] };
    }
  });
  assert.equal(lane.state(100).health, "UNKNOWN");
  assert.equal(lane.start().ok, true);
  assert.equal(typeof timer, "function");
  const inFlight = lane.tick();
  await Promise.resolve();
  await lane.tick();
  await lane.tick();
  first.resolve();
  await inFlight;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  assert.equal(lane.state(100).coalescedTicks, 2);
  assert.equal(lane.state(100).health, "HEALTHY");
  assert.equal(snapshots.length, 2);
  clock += 101;
  assert.equal(lane.state(100).health, "CRITICAL");
  lane.stop();
  assert.equal(timer, null);
});

test("falha de lote ou persistência não anuncia saúde normal", async () => {
  let clock = 1000;
  let succeed = false;
  const lane = criarLifecycleLaneCandidata({
    intervalMs: 50,
    now: () => clock,
    runBatch: async () => succeed
      ? { ok: true, terminalizados: [] }
      : { ok: false, motivo: "database_unavailable" },
    persistWatchdog: async () => {}
  });
  await lane.tick();
  assert.equal(lane.state(100).health, "UNKNOWN");
  assert.equal(lane.state(100).lastError, "database_unavailable");
  succeed = true;
  clock += 10;
  await lane.tick();
  assert.equal(lane.state(100).health, "HEALTHY");
  lane.stop();

  const failedPersistence = criarLifecycleLaneCandidata({
    intervalMs: 50,
    now: () => clock,
    runBatch: async () => ({ ok: true, terminalizados: [] }),
    persistWatchdog: async () => { throw new Error("watchdog_store_down"); }
  });
  await failedPersistence.tick();
  assert.equal(failedPersistence.state(100).health, "UNKNOWN");
  assert.match(failedPersistence.state(100).lastError, /watchdog_persist_failed/);
});
