"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { construirTerminalIndex, construirTerminalIndexDelta } = require("../modules/fila/terminal-index-worker");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const terminalIndex = require("../modules/fila/terminal-index-shadow");

const operacional = {
  normalizarEntradasViva(items) {
    const item = items[0] || {};
    const status = String(item.status || item.estado || "").toLowerCase();
    return [{ bucket: ["retida", "erro", "enviado", "cancelado"].includes(status) ? "historico" : "viva", status }];
  },
  identidadePrimariaExataFilaV2(item = {}) {
    return item.id ? `id:${item.id}` : "";
  },
  rankStatusFilaV2(status = "") {
    return { retida: 1, erro: 2, enviado: 3, cancelado: 4 }[String(status).toLowerCase()] || 0;
  }
};

function fixture(prefix = "terminal-index-delta-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cliente = "workspace_delta";
  const dir = path.join(root, "clientes", cliente);
  const incremental = path.join(dir, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR);
  fs.mkdirSync(incremental, { recursive: true });
  const legacy = path.join(dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE);
  const jsonl = path.join(incremental, "2026-09-28.jsonl");
  fs.writeFileSync(legacy, JSON.stringify([{ id: "legacy", status: "retida" }]), "utf8");
  fs.writeFileSync(jsonl, `${JSON.stringify({ item: { id: "seed", status: "enviado" } })}\n`, "utf8");
  return { root, cliente, dir, incremental, legacy, jsonl, limpar: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function bootstrap(f, revision = "delta-bootstrap-0001") {
  return construirTerminalIndex({
    operation: "terminal_index_bootstrap",
    clienteId: f.cliente,
    checkpointRevision: revision,
    targetGeneration: 10,
    dataDir: f.root,
    nowMs: Date.parse("2026-09-28T12:00:00.000Z")
  }, { operacional });
}

function delta(f, revision = `delta-${Date.now()}-${Math.random().toString(16).slice(2)}`, hooks) {
  return construirTerminalIndexDelta({
    operation: "terminal_index_delta",
    clienteId: f.cliente,
    checkpointRevision: revision,
    dataDir: f.root,
    nowMs: Date.parse("2026-09-28T12:01:00.000Z")
  }, { operacional, hooks });
}

function append(f, items) {
  fs.appendFileSync(f.jsonl, items.map(item => `${JSON.stringify({ item })}\n`).join(""), "utf8");
}

function assertNoPartial(f) {
  assert.strictEqual(fs.readdirSync(f.dir).some(nome => nome.includes(".partial.")), false);
}

async function testDeltaBatches() {
  const f = fixture();
  try {
    const primeiro = bootstrap(f);
    assert.strictEqual(primeiro.ok, true);
    assert.strictEqual(primeiro.metrics.messageBytes < 4096, true);
    assert.strictEqual(terminalIndex.validarTerminalIndex(f.cliente, { getClientePath: () => f.dir, fs }).valido, true);
    const proofInicial = JSON.parse(fs.readFileSync(path.join(f.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE), "utf8"));
    assert.strictEqual(proofInicial.maintenanceVersion, 1);
    assert.strictEqual(proofInicial.sourceCursors[0].cursorBytes, fs.statSync(f.jsonl).size);

    for (const quantidade of [1, 10, 100]) {
      const itens = Array.from({ length: quantidade }, (_, indice) => ({ id: `delta-${quantidade}-${indice}`, status: indice % 2 ? "enviado" : "retida" }));
      append(f, itens);
      const antes = fs.statSync(f.jsonl).size;
      assert.strictEqual(terminalIndex.validarTerminalIndex(f.cliente, { getClientePath: () => f.dir, fs }).valido, false, "source N+1 deve tornar proof N stale antes do delta");
      const resultado = delta(f, `delta-${quantidade}-0001`);
      assert.strictEqual(resultado.ok, true);
      assert.strictEqual(resultado.operation, "terminal_index_delta");
      assert.strictEqual(resultado.deltaRecords, quantidade);
      assert.strictEqual(resultado.metrics.scanMode, "tail");
      assert.strictEqual(resultado.metrics.deltaScanBytes < antes, true, `delta ${quantidade} deve ler somente a cauda`);
      assert.strictEqual(resultado.metrics.messageBytes < 4096, true);
      assert.strictEqual(resultado.generation > primeiro.generation, true);
      assert.strictEqual(terminalIndex.validarTerminalIndex(f.cliente, { getClientePath: () => f.dir, fs }).valido, true);
    }
  } finally {
    f.limpar();
  }
}

async function testRotationAndStale() {
  const rotacao = fixture("terminal-index-rotation-");
  try {
    bootstrap(rotacao, "rotation-bootstrap-0001");
    const novo = path.join(rotacao.incremental, "2026-09-29.jsonl");
    fs.writeFileSync(novo, `${JSON.stringify({ item: { id: "rotated", status: "enviado" } })}\n`, "utf8");
    const resultado = delta(rotacao, "rotation-delta-0001");
    assert.strictEqual(resultado.ok, true, "rotação diária append-compatible deve ser aceita");
  } finally {
    rotacao.limpar();
  }

  const truncado = fixture("terminal-index-truncate-");
  try {
    bootstrap(truncado, "truncate-bootstrap-0001");
    fs.writeFileSync(truncado.jsonl, "", "utf8");
    assert.throws(() => delta(truncado, "truncate-delta-0001"), erro => erro?.code === "STALE_REVISION");
  } finally {
    truncado.limpar();
  }

  const substituido = fixture("terminal-index-replace-");
  try {
    bootstrap(substituido, "replace-bootstrap-0001");
    const temporario = `${substituido.jsonl}.replace`;
    fs.writeFileSync(temporario, fs.readFileSync(substituido.jsonl));
    fs.renameSync(temporario, substituido.jsonl);
    assert.throws(() => delta(substituido, "replace-delta-0001"), erro => erro?.code === "STALE_REVISION");
  } finally {
    substituido.limpar();
  }

  const legadoMudou = fixture("terminal-index-legacy-change-");
  try {
    bootstrap(legadoMudou, "legacy-bootstrap-0001");
    fs.writeFileSync(legadoMudou.legacy, JSON.stringify([{ id: "legacy", status: "enviado" }]), "utf8");
    assert.throws(() => delta(legadoMudou, "legacy-delta-0001"), erro => erro?.code === "TERMINAL_INDEX_LEGACY_CHANGED");
  } finally {
    legadoMudou.limpar();
  }
}

async function testCrashSafety() {
  const f = fixture("terminal-index-delta-crash-");
  try {
    const inicial = bootstrap(f, "crash-bootstrap-0001");
    append(f, [{ id: "crash-index", status: "enviado" }]);
    assert.throws(() => delta(f, "crash-index-0001", { afterIndexPartial() { throw new Error("crash_delta_index"); } }), /crash_delta_index/);
    assertNoPartial(f);
    const proofDepois = JSON.parse(fs.readFileSync(path.join(f.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE), "utf8"));
    assert.strictEqual(Number(proofDepois.generation), Number(inicial.generation));

    append(f, [{ id: "crash-proof", status: "enviado" }]);
    assert.throws(() => delta(f, "crash-proof-0001", { beforeProofRename() { throw new Error("crash_delta_proof"); } }), /crash_delta_proof/);
    assertNoPartial(f);
    const index = JSON.parse(fs.readFileSync(path.join(f.dir, terminalIndex.TERMINAL_INDEX_FILE), "utf8"));
    const proof = JSON.parse(fs.readFileSync(path.join(f.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE), "utf8"));
    assert.notStrictEqual(index.generation, proof.generation, "índice novo sem proof novo deve permanecer inválido/stale");
  } finally {
    f.limpar();
  }
}

async function testCoalescing() {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-index-coalesce-"));
  const workerFile = path.join(f, "worker.cjs");
  fs.writeFileSync(workerFile, `const { parentPort } = require("worker_threads"); let n = 0; parentPort.on("message", job => { n += 1; setTimeout(() => parentPort.postMessage({ type: "persistence_result", jobId: job.jobId, result: job.checkpointRevision.startsWith("shadow-fail") ? { ok: false, operation: job.operation, motivo: "STALE_REVISION" } : { ok: true, operation: job.operation, metrics: { workerInvocations: n } } }), 25); });\n`, "utf8");
  let coordinator;
  try {
    const env = {
      ...process.env,
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace_delta",
      FILA_PERSISTENCIA_MAX_PENDING_JOBS: "10",
      FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE: "10",
      DATA_DIR: f
    };
    coordinator = criarCoordenadorPersistencia({ env, workerPath: workerFile, logger: { log() {} } });
    const payload = { clienteId: "workspace_delta", checkpointRevision: "coalesce-0001", dataDir: f, persistenceMode: "worker" };
    const promises = Array.from({ length: 100 }, () => coordinator.deltaTerminalIndex(payload));
    const resultados = await Promise.all(promises);
    const reais = resultados.filter(item => item.coalesced !== true);
    assert(reais.length <= 2, "cem appends devem resultar em no máximo job ativo + um job pendente");
    assert(resultados.some(item => item.coalesced === true));
    await new Promise(resolve => setTimeout(resolve, 100));
    const falhaShadow = await coordinator.deltaTerminalIndex({ ...payload, checkpointRevision: "shadow-fail-0001" });
    assert.strictEqual(falhaShadow.ok, false);
    assert.strictEqual(coordinator.getState().globalCircuitOpen, false, "erro esperado do shadow não pode abrir o circuito");
  } finally {
    if (coordinator) await coordinator.shutdown({ timeoutMs: 5000 });
    fs.rmSync(f, { recursive: true, force: true });
  }
}

async function testAppendHook() {
  let filaOperacional;
  try {
    filaOperacional = require("../modules/fila/fila-operacional-v2");
  } catch (erro) {
    if (erro?.code === "MODULE_NOT_FOUND" && String(erro?.message || "").includes("sharp")) {
      console.log("terminal-index-v1-1-delta: append-hook SKIP (dependência local sharp ausente; gate CI executa com npm ci)");
      return;
    }
    throw erro;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-index-append-hook-"));
  const cliente = "workspace_hook";
  const dir = path.join(root, "clientes", cliente);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE), "[]", "utf8");
  const initial = construirTerminalIndex({
    clienteId: cliente,
    checkpointRevision: "hook-bootstrap-0001",
    targetGeneration: 1,
    dataDir: root,
    nowMs: Date.parse("2026-09-28T11:59:00.000Z")
  }, { operacional });
  assert.strictEqual(initial.ok, true);
  const agendamentos = [];
  const deps = {
    fs,
    agora: Date.parse("2026-09-28T12:00:00.000Z"),
    env: { FILA_TERMINAL_INDEX_SHADOW: "1" },
    getClientePath: () => dir,
    agendarTerminalIndexBootstrap: payload => {
      agendamentos.push({ tipo: "bootstrap", payload });
      return Promise.resolve({ ok: true });
    },
    agendarTerminalIndexDelta: payload => {
      agendamentos.push({ tipo: "delta", payload });
      return Promise.resolve({ ok: true, coalesced: false });
    },
    logger: { log() {} }
  };
  try {
    const item = { id: "hook-item", status: "enviado", marketplace: "mercadolivre", enviadoEm: "2026-09-28T12:00:00.000Z" };
    const primeiro = filaOperacional.appendHistoricoIncremental(cliente, item, deps);
    assert.strictEqual(primeiro.ok, true);
    assert.strictEqual(agendamentos.length, 1, "append factual deve agendar uma manutenção delta");
    assert.strictEqual(agendamentos[0].tipo, "delta");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(agendamentos[0].payload, "item"), false);
    assert.strictEqual(fs.existsSync(primeiro.file), true, "o callback ocorre depois do append JSONL");

    const segundo = filaOperacional.appendHistoricoIncremental(cliente, item, deps);
    assert.strictEqual(segundo.idempotente, true);
    assert.strictEqual(agendamentos.length, 1, "append idempotente não deve agendar delta");

    const off = filaOperacional.appendHistoricoIncremental(cliente, { ...item, id: "hook-off", enviadoEm: "2026-09-28T12:01:00.000Z" }, {
      ...deps,
      env: { FILA_TERMINAL_INDEX_SHADOW: "0" }
    });
    assert.strictEqual(off.ok, true);
    assert.strictEqual(agendamentos.length, 1, "Shadow OFF deve manter o append sem manutenção");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await testDeltaBatches();
  await testRotationAndStale();
  await testCrashSafety();
  await testCoalescing();
  await testAppendHook();
  assert.strictEqual(terminalIndex.flagAtiva({ FILA_TERMINAL_INDEX_SHADOW: "0" }), false);
  assert.strictEqual(terminalIndex.flagAtiva({ FILA_TERMINAL_INDEX_SHADOW: "1" }), true);
  console.log("terminal-index-v1-1-delta: OK (tail/1-10-100/rotation/stale/crash/coalescing/shadow)");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
