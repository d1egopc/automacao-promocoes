"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const {
  projetarReferenciasFilaViva,
  FILA_GC_REFERENCES_ARQUIVO
} = require("../modules/fila/fila-gc-references");
const {
  buildOrLoadReferenceIndex
} = require("../modules/engine/auto-clean/gc-reference-index-builder");

const AGORA = Date.parse("2026-10-11T15:45:50.000Z");

function fixture(workspace = "user_b2oogwwl") {
  const dataDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-checkpoint-projecao-"));
  const clientDir = path.join(dataDir, "clientes", workspace);
  fs.mkdirSync(clientDir, { recursive: true });
  const getClienteJsonPath = (cliente, arquivo) => path.join(dataDir, "clientes", cliente, arquivo);
  const writes = [];
  const writeClienteJson = (cliente, arquivo, value) => {
    writes.push({ cliente, arquivo, value });
    fs.mkdirSync(path.dirname(getClienteJsonPath(cliente, arquivo)), { recursive: true });
    fs.writeFileSync(getClienteJsonPath(cliente, arquivo), JSON.stringify(value), "utf8");
    return true;
  };
  return { dataDir, workspace, clientDir, getClienteJsonPath, writeClienteJson, writes };
}

function item(workspace, id = "oferta_1", extra = {}) {
  return {
    id,
    ofertaId: id,
    clienteId: workspace,
    status: "pendente",
    titulo: "Oferta viva",
    imagem: `https://cdn.example/${workspace}/${id}.png`,
    marketplace: "amazon",
    criadoEm: "2026-10-11T15:00:00.000Z",
    ...extra
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

function setMtime(file, millis) {
  const when = new Date(millis);
  fs.utimesSync(file, when, when);
}

function baseSources(f) {
  const viva = [{ item: item(f.workspace), bucket: "viva", id: "oferta_1", status: "pendente" }];
  writeJson(path.join(f.clientDir, "fila-viva.json"), viva);
  writeJson(path.join(f.clientDir, "fila.json"), []);
  writeJson(path.join(f.clientDir, "fila-historico.json"), []);
  return viva;
}

function cleanup(f) {
  filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(f.workspace);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function testCheckpointRepairsStaleProjectionAndPreservesSources() {
  const f = fixture();
  try {
    const viva = baseSources(f);
    writeJson(path.join(f.clientDir, "fila-projecao-leve.json"), { versao: 1, clienteId: f.workspace, total: 0, itens: [] });
    setMtime(path.join(f.clientDir, "fila-projecao-leve.json"), AGORA - 7_746);
    setMtime(path.join(f.clientDir, "fila.json"), AGORA);
    const filaAntes = fs.readFileSync(path.join(f.clientDir, "fila-viva.json"), "utf8");
    const historicoAntes = fs.readFileSync(path.join(f.clientDir, "fila-historico.json"), "utf8");
    const result = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, {
      agora: AGORA,
      checkpointRevision: "checkpoint-1"
    }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async ({ projecao }) => ({
        ok: projecao.itens.length === 1,
        motivo: "fixture_sources_coerentes"
      })
    });
    assert.strictEqual(result.ok, true, "checkpoint posterior deve reconstruir a projeção");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(f.clientDir, "fila-projecao-leve.json"), "utf8")).itens[0].id, "oferta_1");
    assert.strictEqual(fs.readFileSync(path.join(f.clientDir, "fila-viva.json"), "utf8"), filaAntes);
    assert.strictEqual(fs.readFileSync(path.join(f.clientDir, "fila-historico.json"), "utf8"), historicoAntes);
    assert.deepStrictEqual(f.writes.map(write => write.arquivo), ["fila-projecao-leve.json"]);
    assert.strictEqual(viva.length, 1);
  } finally { cleanup(f); }
}

async function testConcurrentCheckpointsCoalesceAndRetainLiveReference() {
  const f = fixture("user_concurrent");
  try {
    baseSources(f);
    const a = filaOperacionalV2.agendarProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    const b = filaOperacionalV2.agendarProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA + 1 }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    const [ra, rb] = await Promise.all([a.promise, b.promise]);
    assert.strictEqual(ra.ok, true);
    assert.strictEqual(rb.ok, true);
    assert.strictEqual(a.promise, b.promise, "checkpoints concorrentes devem compartilhar a tarefa");
    assert.strictEqual(f.writes.filter(write => write.arquivo === "fila-projecao-leve.json").length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.clientDir, "fila-projecao-leve.json"), "utf8")).itens.length, 1);
  } finally { cleanup(f); }
}

async function testEmptyWorkspaceAndWriteFailureStayFailClosed() {
  const f = fixture("user_empty");
  try {
    writeJson(path.join(f.clientDir, "fila-viva.json"), []);
    const empty = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    assert.strictEqual(empty.ok, true, "workspace sem atividade recente pode publicar projeção vazia coerente");
    const failed = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: () => false,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    assert.strictEqual(failed.ok, false, "falha de escrita não pode confirmar projeção");
  } finally { cleanup(f); }
}

async function testReadFailureStaysFailClosed() {
  const f = fixture("user_read_failure");
  try {
    fs.writeFileSync(path.join(f.clientDir, "fila-viva.json"), "{invalid", "utf8");
    const result = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    assert.strictEqual(result.ok, false, "JSON vivo inválido deve bloquear a projeção");
    assert.strictEqual(f.writes.length, 0, "falha de leitura não pode escrever projeção");
  } finally { cleanup(f); }
}

async function testSourceChangeDuringWriteBlocksProjection() {
  const f = fixture("user_race");
  try {
    baseSources(f);
    const original = f.writeClienteJson;
    const raceWriter = (cliente, arquivo, value) => {
      const result = original(cliente, arquivo, value);
      if (arquivo === "fila-projecao-leve.json") {
        fs.appendFileSync(path.join(f.clientDir, "fila-viva.json"), " ");
      }
      return result;
    };
    const result = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: raceWriter,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.motivo, "fila_viva_alterada_durante_projecao");
  } finally { cleanup(f); }
}

async function testIndexReachesCompleteAfterProjectionRecovery() {
  const f = fixture("user_index");
  try {
    const viva = baseSources(f);
    setMtime(path.join(f.clientDir, "fila.json"), AGORA - 1_000);
    setMtime(path.join(f.clientDir, "fila-historico.json"), AGORA - 1_000);
    const rebuilt = await filaOperacionalV2.reconstruirProjecaoLeveAposCheckpoint(f.workspace, { agora: AGORA }, {
      getClienteJsonPath: f.getClienteJsonPath,
      writeClienteJson: f.writeClienteJson,
      logger: { log() {} },
      validarProjecaoAposCheckpoint: async () => ({ ok: true })
    });
    assert.strictEqual(rebuilt.ok, true);
    const vivaPath = path.join(f.clientDir, "fila-viva.json");
    const stat = fs.statSync(vivaPath);
    writeJson(path.join(f.clientDir, FILA_GC_REFERENCES_ARQUIVO), projetarReferenciasFilaViva(viva, f.workspace, stat));
    // Fixture-only ordering: the repaired projection is published after the guards.
    setMtime(path.join(f.clientDir, "fila-projecao-leve.json"), Date.now() + 1_000);
    const result = await buildOrLoadReferenceIndex({
      dataDir: f.dataDir,
      workspaceId: f.workspace,
      nowMs: AGORA,
      maxBytesPerRun: 16 * 1024 * 1024,
      maxDurationMs: 5_000,
      logger: { log() {} }
    });
    assert.strictEqual(result.complete, true, `índice deve concluir sem stale: ${result.reasonCode || ""}`);
    const current = JSON.parse(fs.readFileSync(path.join(f.dataDir, "auto-clean", "gc-references", f.workspace, "current.json"), "utf8"));
    assert.strictEqual(current.status, "complete");
    assert.ok(Object.values(current.sourceStates).every(source => source.complete === true));
  } finally { cleanup(f); }
}

(async () => {
  await testCheckpointRepairsStaleProjectionAndPreservesSources();
  await testConcurrentCheckpointsCoalesceAndRetainLiveReference();
  await testEmptyWorkspaceAndWriteFailureStayFailClosed();
  await testReadFailureStaysFailClosed();
  await testSourceChangeDuringWriteBlocksProjection();
  await testIndexReachesCompleteAfterProjectionRecovery();
  console.log("checkpoint-projecao-coerencia.test.js OK");
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
