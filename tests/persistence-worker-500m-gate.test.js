"use strict";

// Linux/Node 24 gate only. The fixture is generated under the OS temp dir and
// is deleted at the end; no production or repository data is used.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const TARGET_BYTES = 500 * 1024 * 1024;

function memoria() {
  const valor = process.memoryUsage();
  return {
    rssBytes: valor.rss,
    heapUsedBytes: valor.heapUsed,
    heapTotalBytes: valor.heapTotal,
    externalBytes: valor.external
  };
}

function percentil(valores, p) {
  const ordenados = valores.slice().sort((a, b) => a - b);
  if (!ordenados.length) return 0;
  return ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))];
}

function escreverFixture(root) {
  const clienteId = "workspace-500m-gate";
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  const modelo = {
    id: "fixture-000000000",
    clienteId,
    status: "pendente",
    titulo: "fixture deterministica persistence worker 500m",
    preco: 10,
    metadata: "x".repeat(640)
  };
  const porItem = Buffer.byteLength(JSON.stringify(modelo), "utf8") + 2;
  const quantidade = Math.max(1, Math.floor((TARGET_BYTES - 2) / porItem));
  const arquivo = path.join(dir, "fila.json");
  const fd = fs.openSync(arquivo, "w");
  try {
    fs.writeSync(fd, "[");
    let lote = [];
    for (let indice = 0; indice < quantidade; indice += 1) {
      lote.push(JSON.stringify({
        ...modelo,
        id: `fixture-${String(indice).padStart(9, "0")}`
      }));
      if (lote.length >= 1000) {
        fs.writeSync(fd, lote.join(","));
        fs.writeSync(fd, indice + 1 < quantidade ? "," : "");
        lote = [];
      }
    }
    if (lote.length) fs.writeSync(fd, lote.join(","));
    fs.writeSync(fd, "]");
  } finally {
    fs.closeSync(fd);
  }
  fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
  return {
    clienteId,
    dir,
    arquivo,
    bytes: fs.statSync(arquivo).size
  };
}

async function medirLag(run) {
  const amostras = [];
  const inicio = process.hrtime.bigint();
  let esperado = Date.now() + 25;
  const timer = setInterval(() => {
    const agora = Date.now();
    amostras.push(Math.max(0, agora - esperado));
    esperado += 25;
  }, 25);
  try {
    const resultado = await run();
    amostras.push(Math.max(0, Date.now() - esperado));
    return {
      resultado,
      wallMs: Number(process.hrtime.bigint() - inicio) / 1e6,
      lagP50Ms: percentil(amostras, 0.50),
      lagP95Ms: percentil(amostras, 0.95),
      lagMaxMs: amostras.length ? Math.max(...amostras) : 0,
      samples: amostras.length
    };
  } finally {
    clearInterval(timer);
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-500m-gate-"));
  const fixture = escreverFixture(root);
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "600000"
  };
  const antes = memoria();
  const coordenador = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  let medicao;
  let preparado;
  let publicado;
  try {
    medicao = await medirLag(async () => {
      preparado = await coordenador.prepare({
        clienteId: fixture.clienteId,
        checkpointRevision: "gate-500m-revision-0001",
        dataDir: root,
        nowMs: Date.now()
      });
      assert.strictEqual(preparado.ok, true);
      assert.strictEqual(Array.isArray(preparado.fila), false);
      publicado = await coordenador.publish({
        clienteId: fixture.clienteId,
        checkpointRevision: "gate-500m-revision-0001",
        targetGeneration: 1,
        dataDir: root,
        tempIdentity: preparado.tempIdentity,
        expectedSourceRevisions: preparado.sourceRevisions
      });
      return publicado;
    });
    assert.strictEqual(publicado.ok, true);
    const finalStat = fs.statSync(fixture.arquivo);
    const proof = JSON.parse(fs.readFileSync(path.join(fixture.dir, "fila.proof.json"), "utf8"));
    assert.strictEqual(Number(proof.size), finalStat.size);
    assert.strictEqual(fs.existsSync(`${fixture.arquivo}.bak`), true);
  } finally {
    await coordenador.shutdown();
  }
  if (typeof global.gc === "function") global.gc();
  const depois = memoria();
  const resumo = {
    fixtureBytes: fixture.bytes,
    fixtureMiB: fixture.bytes / (1024 * 1024),
    before: antes,
    afterWorkerExitAndGc: depois,
    worker: {
      prepare: preparado?.metrics || null,
      publish: publicado?.metrics || null
    },
    mainResponsiveness: {
      wallMs: medicao.wallMs,
      lagP50Ms: medicao.lagP50Ms,
      lagP95Ms: medicao.lagP95Ms,
      lagMaxMs: medicao.lagMaxMs,
      samples: medicao.samples
    }
  };
  console.log(JSON.stringify(resumo));
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
