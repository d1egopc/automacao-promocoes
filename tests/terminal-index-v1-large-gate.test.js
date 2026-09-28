"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { monitorEventLoopDelay } = require("perf_hooks");

const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const terminalIndex = require("../modules/fila/terminal-index-shadow");

const ativo = ["1", "true", "on", "yes"].includes(String(process.env.TERMINAL_INDEX_LARGE_GATE || "").toLowerCase());
if (!ativo) {
  console.log("terminal-index-v1-large-gate: SKIP (use TERMINAL_INDEX_LARGE_GATE=1)");
  process.exit(0);
}

function escreverFixture(file, targetBytes) {
  const fd = fs.openSync(file, "w");
  const padding = "x".repeat(96 * 1024);
  let bytes = 0;
  let itens = 0;
  try {
    bytes += fs.writeSync(fd, "[");
    while (bytes < targetBytes) {
      const item = JSON.stringify({
        id: `terminal_large_${String(itens).padStart(8, "0")}`,
        status: itens % 11 === 0 ? "retida" : "enviado",
        metadata: { fixture: padding }
      });
      bytes += fs.writeSync(fd, `${itens ? "," : ""}${item}`);
      itens += 1;
    }
    bytes += fs.writeSync(fd, "]");
    fs.fsyncSync(fd);
    return { bytes, itens };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const targetMiB = Math.max(1, Number(process.env.TERMINAL_INDEX_LARGE_MIB || 500));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-index-large-"));
  const cliente = "workspace_large";
  const dir = path.join(root, "clientes", cliente);
  const incremental = path.join(dir, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR);
  fs.mkdirSync(incremental, { recursive: true });
  const legacy = path.join(dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE);
  let coordinator;
  try {
    const fixture = escreverFixture(legacy, targetMiB * 1024 * 1024);
    fs.writeFileSync(path.join(incremental, "2026-09-28.jsonl"), `${JSON.stringify({ item: { id: "incremental_large", status: "retida" } })}\n`);

    const histograma = monitorEventLoopDelay({ resolution: 20 });
    histograma.enable();
    let rssPeak = process.memoryUsage().rss;
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    }, 25);
    const before = process.memoryUsage();
    const started = process.hrtime.bigint();
    coordinator = criarCoordenadorPersistencia({
      env: {
        ...process.env,
        DATA_DIR: root,
        FILA_PERSISTENCE_WORKER: "1",
        FILA_PERSISTENCIA_CANARY_CLIENTES: cliente,
        FILA_PERSISTENCE_WORKER_TIMEOUT_MS: String(20 * 60 * 1000)
      },
      logger: { log() {} }
    });
    const job = await coordinator.bootstrapTerminalIndex({
      clienteId: cliente,
      checkpointRevision: "terminal-large-0001",
      targetGeneration: 500,
      dataDir: root,
      persistenceMode: "worker"
    });
    const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
    clearInterval(ticker);
    histograma.disable();
    assert.strictEqual(job.ok, true);
    assert.strictEqual(job.totalTerminais, fixture.itens + 1);
    assert(ticks > 5, "main event-loop deve continuar executando durante bootstrap pesado");
    const validacao = terminalIndex.validarTerminalIndex(cliente, { getClientePath: () => dir });
    assert.strictEqual(validacao.valido, true);
    const lookupStarted = process.hrtime.bigint();
    assert(Array.isArray(validacao.index.entries.terminal_large_00000000));
    const lookupMs = Number(process.hrtime.bigint() - lookupStarted) / 1e6;
    const after = process.memoryUsage();
    const report = {
      targetMiB,
      fixtureBytes: fixture.bytes,
      itens: fixture.itens,
      indexBytes: job.metrics.indexBytes,
      descriptorBytes: job.metrics.messageBytes,
      wallMs,
      workerReadMs: job.metrics.readMs,
      workerParseMs: job.metrics.parseMs,
      workerHeapUsedBytes: job.metrics.workerHeapUsedBytes,
      rssBeforeBytes: before.rss,
      rssPeakBytes: Math.max(rssPeak, job.metrics.processRssBytesAtJob),
      rssAfterBytes: after.rss,
      mainLagP95Ms: histograma.percentile(95) / 1e6,
      mainLagMaxMs: histograma.max / 1e6,
      lookupMs,
      ticks
    };
    assert(report.descriptorBytes < 4096);
    assert(report.mainLagMaxMs < 1000, `main event-loop bloqueado: ${report.mainLagMaxMs}ms`);
    assert(report.indexBytes < fixture.bytes / 100, "indice deve ser pelo menos duas ordens de grandeza menor que fonte grande");
    console.log("terminal-index-v1-large-gate:", JSON.stringify(report));
  } finally {
    if (coordinator) await coordinator.shutdown({ timeoutMs: 10000 });
    const resolved = path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir())));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
