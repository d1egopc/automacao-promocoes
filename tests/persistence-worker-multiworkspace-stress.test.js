"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function makeWorker(root) {
  const file = path.join(root, "stress-worker-" + Date.now() + ".js");
  fs.writeFileSync(file, [
    "const { parentPort } = require('worker_threads');",
    "parentPort.on('message', job => parentPort.postMessage({ type: 'persistence_result', jobId: job.jobId, result: { ok: true, metrics: { bytesRead: 0, parsedItems: 1 } } }));"
  ].join("\n"), "utf8");
  return file;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-multi-stress-"));
  const clients = Array.from({ length: 25 }, (_, index) => "workspace-" + (index + 1));
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: clients.join(","),
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "5000",
    FILA_PERSISTENCIA_MAX_PENDING_JOBS: "200",
    FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE: "25"
  };
  const coordinator = criarCoordenadorPersistencia({
    env,
    workerPath: makeWorker(root),
    logger: { log() {} }
  });
  try {
    const reports = [];
    for (const workspaceCount of [1, 3, 5, 10, 20, 25]) {
      const lag = [];
      let lastTick = process.hrtime.bigint();
      const timer = setInterval(() => {
        const now = process.hrtime.bigint();
        lag.push(Number(now - lastTick) / 1e6 - 1);
        lastTick = now;
      }, 1);
      const before = process.memoryUsage();
      const started = process.hrtime.bigint();
      const promises = [];
      for (let workspaceIndex = 0; workspaceIndex < workspaceCount; workspaceIndex += 1) {
        const clienteId = clients[workspaceIndex];
        for (let jobIndex = 1; jobIndex <= 3; jobIndex += 1) {
          promises.push(coordinator.prepare({
            clienteId,
            checkpointRevision: "stress-" + workspaceCount + "-" + workspaceIndex + "-" + jobIndex,
            dataDir: root
          }));
        }
      }
      const results = await Promise.all(promises);
      clearInterval(timer);
      const after = process.memoryUsage();
      const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(results.every(result => result.ok === true));
      const cleanLag = lag.map(value => Math.max(0, value));
      const report = {
        workspaces: workspaceCount,
        jobs: results.length,
        wallMs: Number(wallMs.toFixed(2)),
        eventLoopLagP50Ms: Number(percentile(cleanLag, 0.50).toFixed(3)),
        eventLoopLagP95Ms: Number(percentile(cleanLag, 0.95).toFixed(3)),
        eventLoopLagMaxMs: Number(Math.max(0, ...cleanLag).toFixed(3)),
        rssBefore: before.rss,
        rssAfter: after.rss,
        heapUsedAfter: after.heapUsed,
        queueDepthGlobal: coordinator.getState().queueDepthGlobal,
        globalCircuitOpen: coordinator.getState().globalCircuitOpen
      };
      reports.push(report);
      console.log("[persistence-worker-multiworkspace-stress]", JSON.stringify(report));
    }
    assert.ok(reports.every(report => report.globalCircuitOpen === false));
    assert.ok(reports.every(report => report.queueDepthGlobal === 0));
    console.log("persistence-worker-multiworkspace-stress: OK");
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
