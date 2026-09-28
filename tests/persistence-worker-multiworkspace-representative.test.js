"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function writeFixture(root, clienteId, targetMiB) {
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  const model = {
    id: "fixture-000000000",
    clienteId,
    status: "pendente",
    titulo: "fixture multiworkspace deterministica",
    preco: 10,
    metadata: "x".repeat(640)
  };
  const itemBytes = Buffer.byteLength(JSON.stringify(model), "utf8") + 1;
  const count = Math.max(1, Math.floor((targetMiB * 1024 * 1024 - 2) / itemBytes));
  const file = path.join(dir, "fila.json");
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, "[");
    let batch = [];
    for (let index = 0; index < count; index += 1) {
      batch.push(JSON.stringify({
        ...model,
        id: "fixture-" + String(index).padStart(9, "0")
      }));
      if (batch.length === 1000) {
        fs.writeSync(fd, batch.join(","));
        fs.writeSync(fd, index + 1 < count ? "," : "");
        batch = [];
      }
    }
    if (batch.length) fs.writeSync(fd, batch.join(","));
    fs.writeSync(fd, "]");
  } finally {
    fs.closeSync(fd);
  }
  fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
  return {
    clienteId,
    dir,
    bytes: fs.statSync(file).size,
    count
  };
}

function keyCounts(order) {
  return order.reduce((acc, key) => {
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function workspaceKey(clienteId) {
  return require("crypto").createHash("sha256").update(clienteId).digest("hex").slice(0, 12);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))];
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-representative-"));
  const fixtures = [
    writeFixture(root, "workspace-heavy", 500),
    writeFixture(root, "workspace-medium", 170),
    writeFixture(root, "workspace-small", 50)
  ];
  if (typeof global.gc === "function") global.gc();
  const logs = [];
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: fixtures.map(item => item.clienteId).join(","),
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "600000",
    FILA_PERSISTENCIA_DIAGNOSTICO_MEMORIA: "1"
  };
  const coordinator = criarCoordenadorPersistencia({
    env,
    logger: { log: (_prefix, payload) => logs.push(JSON.parse(payload)) }
  });
  const lag = [];
  let lastTick = process.hrtime.bigint();
  const before = process.memoryUsage();
  const started = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    lag.push(Math.max(0, Number(now - lastTick) / 1e6 - 25));
    lastTick = now;
  }, 25);
  try {
    const heavyFirst = coordinator.prepare({
      clienteId: "workspace-heavy",
      checkpointRevision: "representative-heavy-0001",
      dataDir: root
    });
    const medium = coordinator.prepare({
      clienteId: "workspace-medium",
      checkpointRevision: "representative-medium-0001",
      dataDir: root
    });
    const small = coordinator.prepare({
      clienteId: "workspace-small",
      checkpointRevision: "representative-small-0001",
      dataDir: root
    });
    const heavySecond = coordinator.prepare({
      clienteId: "workspace-heavy",
      checkpointRevision: "representative-heavy-0002",
      dataDir: root
    });
    const requests = [
      { promise: heavyFirst, clienteId: "workspace-heavy", checkpointRevision: "representative-heavy-0001" },
      { promise: medium, clienteId: "workspace-medium", checkpointRevision: "representative-medium-0001" },
      { promise: small, clienteId: "workspace-small", checkpointRevision: "representative-small-0001" },
      { promise: heavySecond, clienteId: "workspace-heavy", checkpointRevision: "representative-heavy-0002" }
    ];
    const results = await Promise.all(requests.map(item => item.promise));
    clearInterval(timer);
    assert.ok(results.every(result => result.ok === true), JSON.stringify(results));
    assert.ok(results.every(result => Array.isArray(result.fila) === false));
    for (const request of requests) {
      const cleanup = await coordinator.cleanup({
        clienteId: request.clienteId,
        checkpointRevision: request.checkpointRevision,
        dataDir: root,
        persistenceMode: "worker"
      });
      assert.strictEqual(cleanup.ok, true, JSON.stringify(cleanup));
    }
    const completed = logs.filter(item => item.evento === "job_ok" && item.operacao === "checkpoint_prepare");
    const order = completed.map(item => item.workspaceKey);
    const heavyKey = workspaceKey("workspace-heavy");
    const mediumKey = workspaceKey("workspace-medium");
    const smallKey = workspaceKey("workspace-small");
    assert.strictEqual(completed.length, 4);
    assert.strictEqual(keyCounts(order)[heavyKey], 2);
    const secondHeavyIndex = order.lastIndexOf(heavyKey);
    const beforeSecondHeavy = new Set(order.slice(0, secondHeavyIndex));
    assert.ok(beforeSecondHeavy.has(mediumKey), JSON.stringify({ order, heavyKey, mediumKey }));
    assert.ok(beforeSecondHeavy.has(smallKey), JSON.stringify({ order, heavyKey, smallKey }));
    const state = coordinator.getState();
    assert.strictEqual(state.globalCircuitOpen, false);
    assert.strictEqual(state.queueDepthGlobal, 0);
    const after = process.memoryUsage();
    const workerMetrics = results.map(result => result.metrics || {});
    console.log(JSON.stringify({
      ok: true,
      fixtures: fixtures.map(item => ({ bytes: item.bytes, count: item.count })),
      completionOrderHasSmallBeforeSecondHeavy: true,
      wallMs: Number(process.hrtime.bigint() - started) / 1e6,
      mainLagP50Ms: percentile(lag, 0.5),
      mainLagP95Ms: percentile(lag, 0.95),
      mainLagMaxMs: lag.length ? Math.max(...lag) : 0,
      rssBefore: before.rss,
      rssAfter: after.rss,
      workerRssPeak: Math.max(...workerMetrics.map(item => Number(item.processRssBytesAtJob || 0))),
      workerHeapPeak: Math.max(...workerMetrics.map(item => Number(item.workerHeapUsedBytes || 0))),
      completedByWorkspace: state.completedByWorkspace,
      maxQueueWaitByWorkspace: state.maxQueueWaitByWorkspace,
      rssAfter: process.memoryUsage().rss
    }));
  } finally {
    clearInterval(timer);
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
