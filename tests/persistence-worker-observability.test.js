"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function hashWorkspace(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function makeWorker(root) {
  const file = path.join(root, `observability-worker-${Date.now()}.js`);
  fs.writeFileSync(file, [
    "const { parentPort } = require('worker_threads');",
    "parentPort.on('message', job => {",
    "  const delay = job.checkpointRevision.endsWith('-1') ? 80 : 1;",
    "  setTimeout(() => parentPort.postMessage({ type: 'persistence_result', jobId: job.jobId, result: { ok: true, operation: job.operation, metrics: { readMs: 2, parseMs: 3, calculateMs: 4, stringifyMs: 5, writeMs: 6, bytes: 7 } } }), delay);",
    "});"
  ].join("\n"), "utf8");
  return file;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-observability-"));
  const logs = [];
  const workspace = "workspace-observability";
  const revision1 = "observability-1";
  const revision2 = "observability-2";
  const coordinator = criarCoordenadorPersistencia({
    env: {
      ...process.env,
      DATA_DIR: root,
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: workspace,
      FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "5000"
    },
    workerPath: makeWorker(root),
    logger: { log: (_tag, payload) => logs.push(JSON.parse(payload)) }
  });

  try {
    const firstPromise = coordinator.prepare({
      clienteId: workspace,
      checkpointRevision: revision1,
      dataDir: root
    });
    const secondPromise = coordinator.prepare({
      clienteId: workspace,
      checkpointRevision: revision2,
      dataDir: root
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, true);

    const completed = logs.filter(item => item.evento === "job_ok");
    assert.strictEqual(completed.length, 2);
    assert.ok(completed.every(item => item.workspaceKey === hashWorkspace(workspace)));
    assert.ok(completed.every(item => /^[a-f0-9]{12}$/.test(item.checkpointKey)));
    assert.ok(completed.every(item => !JSON.stringify(item).includes(workspace)));
    assert.ok(completed.every(item => Number.isFinite(item.queuedAt)));
    assert.ok(completed.every(item => Number.isFinite(item.startedAt)));
    assert.ok(completed.every(item => Number.isFinite(item.finishedAt)));
    assert.ok(completed.every(item => item.queueWaitMs >= 0));
    assert.ok(completed.every(item => item.workerServiceMs >= 0));
    assert.ok(completed.every(item => item.jobTotalMs >= item.queueWaitMs));
    assert.ok(completed.every(item => item.jobTotalMs >= item.workerServiceMs));
    assert.ok(completed.every(item => Math.abs(
      item.jobTotalMs - item.queueWaitMs - item.workerServiceMs
    ) <= 5));

    const firstLog = completed.find(item => item.checkpointKey === hashWorkspace(revision1));
    const secondLog = completed.find(item => item.checkpointKey === hashWorkspace(revision2));
    assert.ok(firstLog.workerServiceMs >= 50, JSON.stringify(firstLog));
    assert.ok(secondLog.queueWaitMs >= 30, JSON.stringify(secondLog));
    assert.strictEqual(first.coordinatorMetrics.queueWaitMs, firstLog.queueWaitMs);
    assert.strictEqual(first.coordinatorMetrics.workerServiceMs, firstLog.workerServiceMs);
    assert.strictEqual(first.coordinatorMetrics.jobTotalMs, firstLog.jobTotalMs);
    assert.deepStrictEqual(coordinator.getState().maxQueueWaitByWorkspace, {
      [hashWorkspace(workspace)]: secondLog.queueWaitMs
    });
    assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
    console.log("persistence-worker-observability: OK");
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
