"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseCanaryClientes,
  decisaoPersistenciaWorkspace
} = require("../modules/fila/persistence-protocol");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function workspaceKey(clienteId) {
  return crypto.createHash("sha256").update(clienteId).digest("hex").slice(0, 12);
}

function makeWorker(root, source) {
  const file = path.join(root, "multi-worker-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".js");
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function env(root, clients, extra = {}) {
  return {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: clients.join(","),
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "5000",
    FILA_PERSISTENCIA_MAX_PENDING_JOBS: "100",
    FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE: "25",
    FILA_PERSISTENCIA_MAX_PENDING_BYTES: String(8 * 1024 * 1024),
    FILA_PERSISTENCIA_MAX_PENDING_BYTES_WORKSPACE: String(1024 * 1024),
    ...extra
  };
}

function jobPayload(clienteId, n) {
  return {
    clienteId,
    checkpointRevision: "multi-revision-" + clienteId + "-" + n,
    dataDir: "/tmp/persistence-multiworkspace"
  };
}

const delayedWorker = [
  "const { parentPort } = require('worker_threads');",
  "parentPort.on('message', job => {",
  "  const delay = job.clienteId === 'workspace-a' ? 6 : 1;",
  "  setTimeout(() => parentPort.postMessage({ type: 'persistence_result', jobId: job.jobId, result: { ok: true, operation: job.operation, metrics: { testWorkspace: job.clienteId, sequence: job.checkpointRevision } } }), delay);",
  "});"
].join("\n");

const localFailureWorker = [
  "const { parentPort } = require('worker_threads');",
  "parentPort.on('message', job => {",
  "  if (job.clienteId === 'workspace-fail') {",
  "    parentPort.postMessage({ type: 'persistence_error', jobId: job.jobId, error: { code: 'STALE_REVISION', message: 'revision_changed_for_workspace' } });",
  "    return;",
  "  }",
  "  parentPort.postMessage({ type: 'persistence_result', jobId: job.jobId, result: { ok: true, metrics: { testWorkspace: job.clienteId } } });",
  "});"
].join("\n");

const crashWorker = [
  "const { parentPort } = require('worker_threads');",
  "parentPort.on('message', () => process.exit(42));"
].join("\n");

async function testCanaryRouting() {
  const disabled = decisaoPersistenciaWorkspace({ FILA_PERSISTENCE_WORKER: "0" }, "workspace-a");
  assert.strictEqual(disabled.mode, "legacy");
  assert.strictEqual(disabled.motivo, "worker_global_disabled");

  const missing = decisaoPersistenciaWorkspace({
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: ""
  }, "workspace-a");
  assert.strictEqual(missing.mode, "legacy");
  assert.strictEqual(missing.motivo, "worker_global_enabled_but_no_canary");

  const wildcard = parseCanaryClientes({
    FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-a,*"
  });
  assert.strictEqual(wildcard.valido, false);

  const selected = decisaoPersistenciaWorkspace({
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-a,workspace-b"
  }, "workspace-a");
  const excluded = decisaoPersistenciaWorkspace({
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-a,workspace-b"
  }, "workspace-c");
  assert.strictEqual(selected.mode, "worker");
  assert.strictEqual(excluded.mode, "legacy");
}

async function testFairnessAndFifo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-multi-fairness-"));
  const clients = ["workspace-a", "workspace-b", "workspace-c"];
  const completions = [];
  const sequences = new Map();
  const logs = [];
  const coordinator = criarCoordenadorPersistencia({
    env: env(root, clients),
    workerPath: makeWorker(root, delayedWorker),
    logger: { log: (_prefix, payload) => logs.push(JSON.parse(payload)) }
  });
  try {
    const jobs = [];
    for (let i = 1; i <= 20; i += 1) jobs.push(coordinator.prepare(jobPayload("workspace-a", i)));
    for (let i = 1; i <= 3; i += 1) jobs.push(coordinator.prepare(jobPayload("workspace-b", i)));
    jobs.push(coordinator.prepare(jobPayload("workspace-c", 1)));
    const results = await Promise.all(jobs);
    assert.ok(results.every(result => result.ok === true));
    for (const log of logs) {
      if (log.evento === "job_ok") {
        completions.push(log.workspaceKey);
        if (!sequences.has(log.workspaceKey)) sequences.set(log.workspaceKey, []);
        sequences.get(log.workspaceKey).push(Number(String(log.sequence || "").split("-").pop()));
      }
    }
    assert.strictEqual(completions.length, 24);
    assert.ok(completions.slice(1, 6).some(key => key === workspaceKey("workspace-b") || key === workspaceKey("workspace-c")));
    assert.strictEqual(completions.filter(key => key === workspaceKey("workspace-b")).length, 3);
    assert.deepStrictEqual(sequences.get(workspaceKey("workspace-a")), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepStrictEqual(sequences.get(workspaceKey("workspace-b")), [1, 2, 3]);
    assert.deepStrictEqual(sequences.get(workspaceKey("workspace-c")), [1]);
    const state = coordinator.getState();
    assert.strictEqual(state.queueDepthGlobal, 0);
    assert.strictEqual(state.globalCircuitOpen, false);
    assert.strictEqual(state.lanes.length, 3);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testLocalCircuitAndGlobalCrash() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-multi-failure-"));
  try {
    const clients = ["workspace-fail", "workspace-healthy"];
    const local = criarCoordenadorPersistencia({
      env: env(root, clients),
      workerPath: makeWorker(root, localFailureWorker),
      logger: { log() {} }
    });
    try {
      const [failed, failedQueued, healthy] = await Promise.all([
        local.prepare(jobPayload("workspace-fail", 1)),
        local.prepare(jobPayload("workspace-fail", 2)),
        local.prepare(jobPayload("workspace-healthy", 1))
      ]);
      assert.strictEqual(failed.ok, false);
      assert.strictEqual(failed.motivo, "STALE_REVISION");
      assert.strictEqual(failedQueued.ok, false);
      assert.strictEqual(failedQueued.motivo, "STALE_REVISION");
      assert.strictEqual(healthy.ok, true);
      assert.strictEqual(local.getState().globalCircuitOpen, false);
      assert.strictEqual(Object.values(local.getState().circuitByWorkspace).some(Boolean), true);
    } finally {
      await local.shutdown();
    }

    const global = criarCoordenadorPersistencia({
      env: env(root, ["workspace-a", "workspace-b"]),
      workerPath: makeWorker(root, crashWorker),
      logger: { log() {} }
    });
    try {
      const [first, second] = await Promise.all([
        global.prepare(jobPayload("workspace-a", 1)),
        global.prepare(jobPayload("workspace-b", 1))
      ]);
      assert.ok(["worker_exit", "worker_error"].includes(first.motivo));
      assert.strictEqual(second.ok, false);
      assert.strictEqual(global.getState().globalCircuitOpen, true);
    } finally {
      await global.shutdown();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testBackpressure() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-multi-backpressure-"));
  const coordinator = criarCoordenadorPersistencia({
    env: env(root, ["workspace-a"], {
      FILA_PERSISTENCIA_MAX_PENDING_JOBS: "2",
      FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE: "2"
    }),
    workerPath: makeWorker(root, delayedWorker),
    logger: { log() {} }
  });
  try {
    const first = coordinator.prepare(jobPayload("workspace-a", 1));
    const second = coordinator.prepare(jobPayload("workspace-a", 2));
    const rejected = await coordinator.prepare(jobPayload("workspace-a", 3));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.motivo, "persistence_worker_backpressure_retryable");
    assert.strictEqual(rejected.retryable, true);
    assert.strictEqual((await first).ok, true);
    assert.strictEqual((await second).ok, true);
    assert.ok(coordinator.getState().backpressureRejections >= 1);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testPinnedModeDuringCheckpoint() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-multi-pinned-"));
  const runtimeEnv = env(root, ["workspace-a"]);
  const coordinator = criarCoordenadorPersistencia({
    env: runtimeEnv,
    workerPath: makeWorker(root, delayedWorker),
    logger: { log() {} }
  });
  try {
    const prepared = await coordinator.prepare(jobPayload("workspace-a", 1));
    assert.strictEqual(prepared.ok, true);
    runtimeEnv.FILA_PERSISTENCIA_CANARY_CLIENTES = "workspace-b";
    const published = await coordinator.publish({
      ...jobPayload("workspace-a", 1),
      persistenceMode: prepared.persistenceMode
    });
    assert.strictEqual(published.ok, true);
    assert.strictEqual(published.persistenceMode, "worker");
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await testCanaryRouting();
  await testFairnessAndFifo();
  await testLocalCircuitAndGlobalCrash();
  await testBackpressure();
  await testPinnedModeDuringCheckpoint();
  console.log("persistence-worker-multiworkspace: OK (canary/fairness/fifo/local-global-circuit/backpressure)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
