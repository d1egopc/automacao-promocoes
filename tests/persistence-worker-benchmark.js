"use strict";

// Fixture generator/benchmark local. It never writes into the repository and is
// intentionally not part of the application startup or production workflow.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const { mesclarFilaLegadaComViva } = require("../modules/fila/fila-operacional-v2");

const CLASSES = [50, 170, 250].map(sizeMiB => ({
  sizeMiB,
  targetBytes: sizeMiB * 1024 * 1024
}));

function bytesMiB(bytes) {
  return Number(bytes || 0) / (1024 * 1024);
}

function writeFixture(root, targetBytes) {
  const clienteId = "workspace-benchmark";
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  const item = {
    id: "fixture-000000000",
    clienteId,
    status: "pendente",
    titulo: "fixture de persistencia phase1",
    preco: 10,
    metadata: "x".repeat(640)
  };
  const itemText = JSON.stringify(item);
  const aproximadoPorItem = Buffer.byteLength(itemText, "utf8") + 2;
  const quantidade = Math.max(1, Math.floor((targetBytes - 2) / aproximadoPorItem));
  const file = path.join(dir, "fila.json");
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, "[");
    let chunk = [];
    for (let i = 0; i < quantidade; i += 1) {
      chunk.push(JSON.stringify({ ...item, id: `fixture-${String(i).padStart(9, "0")}` }));
      if (chunk.length >= 1000) {
        fs.writeSync(fd, chunk.join(","));
        fs.writeSync(fd, i + 1 < quantidade ? "," : "");
        chunk = [];
      }
    }
    if (chunk.length) fs.writeSync(fd, chunk.join(","));
    fs.writeSync(fd, "]");
  } finally {
    fs.closeSync(fd);
  }
  fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
  return { clienteId, file, bytes: fs.statSync(file).size };
}

async function measureLag(run) {
  const samples = [];
  const started = process.hrtime.bigint();
  let expected = Date.now() + 25;
  const timer = setInterval(() => {
    const now = Date.now();
    samples.push(Math.max(0, now - expected));
    expected += 25;
  }, 25);
  try {
    const result = await run();
    samples.push(Math.max(0, Date.now() - expected));
    const sorted = samples.slice().sort((a, b) => a - b);
    const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      result,
      wallMs: Number(process.hrtime.bigint() - started) / 1e6,
      lagP50Ms: percentile(0.50),
      lagP95Ms: percentile(0.95),
      lagMaxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      samples: sorted.length
    };
  } finally {
    clearInterval(timer);
  }
}

async function legacyMeasure(fixture, root) {
  const legadoPath = fixture.file;
  const vivaPath = path.join(root, "clientes", fixture.clienteId, "fila-viva.json");
  const legado = JSON.parse(fs.readFileSync(legadoPath, "utf8"));
  const viva = JSON.parse(fs.readFileSync(vivaPath, "utf8"));
  const merge = mesclarFilaLegadaComViva(fixture.clienteId, legado, viva, { agora: Date.now() });
  const content = JSON.stringify(merge.filaCliente, null, 2);
  const temp = `${legadoPath}.benchmark.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, legadoPath);
  return { bytes: Buffer.byteLength(content, "utf8"), itens: merge.filaCliente.length };
}

async function workerMeasure(fixture, root, sequence) {
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: fixture.clienteId,
    FILA_PERSISTENCIA_DIAGNOSTICO_MEMORIA: "1",
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "300000"
  };
  const coordinator = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  try {
    const prepared = await coordinator.prepare({
      clienteId: fixture.clienteId,
      checkpointRevision: `benchmark-revision-${sequence}`,
      dataDir: root,
      nowMs: Date.now()
    });
    if (!prepared.ok) return prepared;
    const published = await coordinator.publish({
      clienteId: fixture.clienteId,
      checkpointRevision: `benchmark-revision-${sequence}`,
      targetGeneration: sequence,
      dataDir: root,
      tempIdentity: prepared.tempIdentity,
      expectedSourceRevisions: prepared.sourceRevisions
    });
    return { prepared, published };
  } finally {
    await coordinator.shutdown();
  }
}

async function main() {
  const output = [];
  for (const classe of CLASSES) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `fila-persistence-bench-${classe.sizeMiB}-`));
    try {
      const fixture = writeFixture(root, classe.targetBytes);
      const worker = await measureLag(() => workerMeasure(fixture, root, classe.sizeMiB));
      const legado = await measureLag(() => legacyMeasure(fixture, root));
      output.push({
        classeMiB: classe.sizeMiB,
        fixtureMiB: bytesMiB(fixture.bytes),
        legacy: legado,
        worker: {
          ...worker,
          prepare: worker.result?.prepared?.metrics || null,
          publish: worker.result?.published?.metrics || null,
          ok: worker.result?.published?.ok === true
        },
        mainRssAfterBytes: process.memoryUsage().rss,
        mainHeapAfterBytes: process.memoryUsage().heapUsed
      });
      if (global.gc) global.gc();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), output }, null, 2));
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
