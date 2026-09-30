"use strict";

// Local synthetic benchmark only; does not read DATA_DIR or production files.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
const { Worker } = require("worker_threads");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function fixtureFile(dir, fileName, clienteId, targetMiB, idPrefix) {
  const file = path.join(dir, fileName);
  const model = { id: `${idPrefix}-000000000`, clienteId, status: "pendente",
    marketplace: "fixture", titulo: "fixture persistence progress", preco: 10,
    metadata: "x".repeat(896) };
  const itemBytes = Buffer.byteLength(JSON.stringify(model), "utf8") + 1;
  const count = Math.floor((targetMiB * 1024 * 1024 - 2) / itemBytes);
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, "[");
    let batch = [];
    for (let i = 0; i < count; i += 1) {
      batch.push(JSON.stringify({ ...model, id: `${idPrefix}-${String(i).padStart(9, "0")}` }));
      if (batch.length === 1000) {
        fs.writeSync(fd, batch.join(","));
        if (i + 1 < count) fs.writeSync(fd, ",");
        batch = [];
      }
    }
    if (batch.length) fs.writeSync(fd, batch.join(","));
    fs.writeSync(fd, "]");
  } finally { fs.closeSync(fd); }
  return { file, bytes: fs.statSync(file).size, count };
}

async function one(label, legacyMiB, vivaMiB) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "persistence-stage-bench-"));
  const clienteId = "workspace-stage-bench";
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  let coordinator;
  const cpuWorkers = [];
  try {
    const legacy = fixtureFile(dir, "fila.json", clienteId, legacyMiB, "legacy");
    const viva = fixtureFile(dir, "fila-viva.json", clienteId, vivaMiB, "viva");
    if (process.env.PERSISTENCE_BENCH_CPU_CONTENTION === "1") {
      for (let i = 0; i < 8; i += 1) {
        cpuWorkers.push(new Worker("let value = 1; while (true) { value = Math.sqrt(value + 2); if (value > 2) value = 1; }", { eval: true }));
      }
    }
    const progress = [];
    coordinator = criarCoordenadorPersistencia({
      env: {
        ...process.env, DATA_DIR: root, FILA_PERSISTENCE_WORKER: "1",
        FILA_PERSISTENCIA_CANARY_CLIENTES: clienteId,
        FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "600000"
      },
      logger: { log: (_tag, payload) => {
        const item = JSON.parse(payload);
        if (item.evento === "job_progress") progress.push(item);
      } }
    });
    const lag = monitorEventLoopDelay({ resolution: 10 });
    const eluBefore = performance.eventLoopUtilization();
    const cpuBefore = process.cpuUsage();
    const rssBeforeBytes = process.memoryUsage().rss;
    let rssPeakBytes = rssBeforeBytes;
    const sample = setInterval(() => {
      rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
    }, 100);
    lag.enable();
    const started = performance.now();
    let result;
    try {
      result = await coordinator.prepare({ clienteId,
        checkpointRevision: `stage-bench-${label}-0001`, targetGeneration: 1,
        dataDir: root });
    } finally {
      lag.disable();
      clearInterval(sample);
    }
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    const elu = performance.eventLoopUtilization(eluBefore);
    const report = {
      label, node: process.version,
      contentionThreads: cpuWorkers.length,
      legacyBytes: legacy.bytes, vivaBytes: viva.bytes,
      legacyItems: legacy.count, vivaItems: viva.count,
      ok: result?.ok === true, motivo: result?.motivo || "",
      wallMs, cpuMs: (cpu.user + cpu.system) / 1000,
      eventLoopUtilization: elu.utilization,
      mainLagP95Ms: lag.percentile(95) / 1e6,
      mainLagMaxMs: lag.max / 1e6,
      rssBeforeBytes, rssPeakBytes: Math.max(rssPeakBytes, process.memoryUsage().rss),
      rssAfterBytes: process.memoryUsage().rss,
      workerHeapUsedBytes: result?.metrics?.workerHeapUsedBytes || null,
      workerMetrics: result?.metrics || null,
      stages: progress.map(item => ({ stage: item.stage, elapsedMs: item.elapsedMs,
        stageMs: item.stageMs, legacyBytes: item.legacyBytes, vivaBytes: item.vivaBytes,
        outputBytes: item.outputBytes, stringifyMs: item.stringifyMs, writeMs: item.writeMs }))
    };
    console.log(JSON.stringify(report));
    if (result?.ok === true) {
      await coordinator.cleanup({ clienteId, checkpointRevision: `stage-bench-${label}-0001`, dataDir: root });
    }
  } finally {
    await Promise.all(cpuWorkers.map(worker => worker.terminate()));
    if (coordinator) await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  await one("wolf-264", 264, 43);
  await one("diego-330", 330, 52);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
