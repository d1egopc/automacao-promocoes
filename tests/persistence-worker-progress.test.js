"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const workerPath = path.join(__dirname, "fixtures", "persistence-worker-progress.js");

async function scenario(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "persistence-progress-"));
  const logs = [];
  const coordinator = criarCoordenadorPersistencia({
    workerPath,
    env: {
      ...process.env,
      DATA_DIR: root,
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-progress",
      FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "1000"
    },
    logger: { log: (_tag, payload) => logs.push(JSON.parse(payload)) }
  });
  try {
    const started = Date.now();
    const first = coordinator.prepare({
      clienteId: "workspace-progress",
      checkpointRevision: `progress-${name}-0001`,
      dataDir: root,
      targetGeneration: 7
    });
    const second = name === "ok" ? coordinator.prepare({
      clienteId: "workspace-progress",
      checkpointRevision: "progress-ok-0002",
      dataDir: root,
      targetGeneration: 8
    }) : null;
    const result = await first;
    const secondResult = second ? await second : null;
    const progress = logs.filter(item => item.evento === "job_progress");
    assert.ok(progress.length >= (name === "timeout" ? 3 : 1), JSON.stringify(logs));
    assert.ok(progress.every(item => !Object.hasOwn(item, "fila") &&
      !Object.hasOwn(item, "itens") && !Object.hasOwn(item, "buffer")));
    assert.ok(progress.every(item => Buffer.byteLength(JSON.stringify(item)) < 1024));
    if (name === "timeout") {
      assert.strictEqual(result.motivo, "worker_timeout");
      assert.ok(Date.now() - started < 3000, "progress must not renew timeout");
      assert.strictEqual(coordinator.getState().globalCircuitOpen, true);
      const timeout = logs.find(item => item.evento === "job_timeout");
      assert.strictEqual(timeout.lastProgressStage, "legacy_read_completed");
      assert.ok(timeout.lastProgressAt);
      assert.ok(
        timeout.totalElapsedMs >= 900 && timeout.totalElapsedMs < 3000,
        `unexpected timeout elapsed: ${timeout.totalElapsedMs}; sinceLastProgress=${timeout.elapsedSinceLastProgressMs}; lastProgressStage=${timeout.lastProgressStage}`
      );
      assert.ok(timeout.elapsedSinceLastProgressMs >= 0);
      assert.ok(logs.filter(item => item.evento === "job_ok").length === 0);
    } else if (name === "ok") {
      assert.strictEqual(result.ok, true);
      assert.strictEqual(secondResult.ok, true);
      assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
      const ok = logs.filter(item => item.evento === "job_ok");
      assert.strictEqual(ok.length, 2);
      assert.ok(logs.findIndex(item => item.evento === "job_progress") < logs.findIndex(item => item.evento === "job_ok"));
      assert.ok(ok[0].jobKey !== ok[1].jobKey);
    } else if (name.startsWith("stale")) {
      assert.strictEqual(result.motivo, "STALE_REVISION");
      assert.strictEqual(result.retryable, true);
      assert.strictEqual(result.circuitOpened, false);
      assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
      assert.strictEqual(Object.values(coordinator.getState().checkpointCircuitByWorkspace).some(Boolean), false);
      assert.strictEqual(logs.find(item => item.stage === "prepare_stale")?.staleStage,
        name === "stale-read" ? "during_read" : "before_backup");
    } else if (name === "error") {
      assert.strictEqual(result.motivo, "CHECKPOINT_WRITE_FAILED");
      assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
      assert.strictEqual(Object.values(coordinator.getState().checkpointCircuitByWorkspace).some(Boolean), true);
    } else if (name === "crash") {
      assert.strictEqual(result.ok, false);
      assert.strictEqual(coordinator.getState().globalCircuitOpen, true);
    }
    console.log(`persistence progress ${name}: PASS`);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function realWorkerStages() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "persistence-progress-real-"));
  const clienteId = "workspace-progress";
  const dir = path.join(root, "clientes", clienteId);
  const logs = [];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fila.json"), JSON.stringify([
    { id: "fixture-1", clienteId, status: "pendente", marketplace: "fixture" }
  ]));
  fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
  const coordinator = criarCoordenadorPersistencia({
    env: {
      ...process.env,
      DATA_DIR: root,
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: clienteId,
      FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "10000"
    },
    logger: { log: (_tag, payload) => logs.push(JSON.parse(payload)) }
  });
  try {
    const checkpointRevision = "progress-real-0001";
    const result = await coordinator.prepare({ clienteId, checkpointRevision,
      targetGeneration: 1, dataDir: root });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    const stages = logs.filter(item => item.evento === "job_progress").map(item => item.stage);
    assert.deepStrictEqual(stages, [
      "prepare_started", "legacy_read_completed", "viva_read_completed", "merge_completed",
      "source_revalidated", "backup_completed", "stringify_completed",
      "temp_write_completed", "prepare_completed"
    ]);
    assert.ok(logs.filter(item => item.evento === "job_progress")
      .every(item => Buffer.byteLength(JSON.stringify(item)) < 1024));
    assert.strictEqual(logs.filter(item => item.evento === "job_ok").length, 1);
    assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
    const cleaned = await coordinator.cleanup({ clienteId, checkpointRevision, dataDir: root });
    assert.strictEqual(cleaned.ok, true);
    const directWorker = new Worker(path.join(__dirname, "..", "modules", "fila", "persistence-worker.js"), {
      env: { ...process.env, DATA_DIR: root }
    });
    const rawProgress = [];
    try {
      const directResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("direct_worker_timeout")), 10000);
        directWorker.on("error", reject);
        directWorker.on("message", message => {
          if (message.type === "persistence_progress") rawProgress.push(message);
          if (message.type === "persistence_result" || message.type === "persistence_error") {
            clearTimeout(timeout);
            resolve(message);
          }
        });
        directWorker.postMessage({
          operation: "checkpoint_prepare", jobId: "direct-progress-0001", clienteId,
          checkpointRevision: "progress-direct-0001", targetGeneration: 1,
          dataDir: root, nowMs: Date.now()
        });
      });
      assert.strictEqual(directResult.type, "persistence_result", JSON.stringify(directResult));
      assert.strictEqual(rawProgress.length, 9);
      const allowed = new Set(["type", "jobId", "operation", "stage", "elapsedMs", "stageMs",
        "targetGeneration", "legacyBytes", "vivaBytes", "outputBytes", "stringifyMs", "writeMs", "staleStage"]);
      for (const message of rawProgress) {
        assert.ok(Buffer.byteLength(JSON.stringify(message)) < 1024);
        for (const [key, value] of Object.entries(message)) {
          assert.ok(allowed.has(key), `unexpected progress key: ${key}`);
          assert.ok(!Array.isArray(value) && !Buffer.isBuffer(value));
          assert.ok(value === null || ["string", "number", "boolean"].includes(typeof value));
        }
      }
    } finally {
      await directWorker.terminate();
    }
    console.log("persistence progress real stages: PASS");
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  for (const name of ["ok", "error", "crash", "stale-read", "stale-before", "timeout"]) await scenario(name);
  await realWorkerStages();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
