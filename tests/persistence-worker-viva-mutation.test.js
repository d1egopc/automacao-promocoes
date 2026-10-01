"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function ambiente(root, clientes) {
  return {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: clientes.join(","),
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "5000",
    FILA_V2_OPERACIONAL_ROLLOUT: "global"
  };
}

function storage(root) {
  function getClienteJsonPath(clienteId, arquivo) {
    return path.join(root, "clientes", String(clienteId), String(arquivo));
  }
  function writeClienteJson(clienteId, arquivo, valor) {
    const file = getClienteJsonPath(clienteId, arquivo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.test-partial`;
    fs.writeFileSync(temp, JSON.stringify(valor, null, 2), "utf8");
    fs.renameSync(temp, file);
    return true;
  }
  return { getClienteJsonPath, writeClienteJson };
}

function repositorySerializado(eventos) {
  const states = new Map();
  const lanes = new Map();
  return {
    states,
    registrarMutacaoDuravel(clienteId, dados) {
      const anterior = lanes.get(clienteId) || Promise.resolve();
      const atual = anterior.then(async () => {
        const state = states.get(clienteId) || {
          revision: 0,
          vivaGeneration: 0,
          durableCheckpointGeneration: 0,
          dirtyGeneration: null,
          vivaFileProof: null,
          legacyFileProof: null
        };
        const nextGeneration = state.vivaGeneration + 1;
        eventos.push(`generation:${clienteId}:${nextGeneration}`);
        const escrita = await dados.escreverArquivo({
          state,
          nextGeneration,
          fileRevision: dados.fileRevision
        });
        if (escrita?.ok !== true) {
          eventos.push(`rollback:${clienteId}:${nextGeneration}`);
          return { ok: false, motivo: escrita?.motivo || "arquivo_viva_falhou", state, resultadoArquivo: escrita };
        }
        assert(escrita.vivaFileProof, "proof deve existir antes do commit logico");
        eventos.push(`db_update:${clienteId}:${nextGeneration}`);
        const proximo = {
          ...state,
          revision: state.revision + 1,
          vivaGeneration: nextGeneration,
          dirtyGeneration: state.dirtyGeneration || state.durableCheckpointGeneration + 1,
          vivaFileProof: escrita.vivaFileProof
        };
        states.set(clienteId, proximo);
        return { ok: true, motivo: "manifest_state_mutacao_confirmada", state: proximo };
      });
      lanes.set(clienteId, atual.catch(() => {}));
      return atual;
    }
  };
}

function item(id, clienteId, status = "pendente") {
  return { id, clienteId, titulo: `Oferta ${id}`, preco: 100, status };
}

function workerTemporario(root, source) {
  const file = path.join(root, `viva-worker-fault-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

async function medirResponsividade(executar) {
  const atrasos = [];
  let anterior = process.hrtime.bigint();
  const timer = setInterval(() => {
    const agora = process.hrtime.bigint();
    atrasos.push(Math.max(0, Number(agora - anterior) / 1e6 - 5));
    anterior = agora;
  }, 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  const inicio = process.hrtime.bigint();
  const resultado = await executar();
  const totalMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  await new Promise(resolve => setTimeout(resolve, 20));
  clearInterval(timer);
  return { resultado, totalMs, eventLoopMaxMs: Math.max(0, ...atrasos) };
}

async function benchmarkLocal(root, coordinator) {
  if (process.env.BENCHMARK_VIVA !== "1") return;
  const arquivos = storage(root);
  const payload = "x".repeat(1500);
  const entradas = Array.from({ length: 25000 }, (_, indice) => ({
    id: `bench-${indice}`,
    bucket: "viva",
    status: "pendente",
    posicaoLegada: indice,
    item: { id: `bench-${indice}`, clienteId: "workspace-viva-benchmark", status: "pendente", payload }
  }));
  for (const cliente of ["workspace-viva-sync", "workspace-viva-benchmark"]) {
    arquivos.writeClienteJson(cliente, "fila-viva.json", entradas.map(entrada => ({
      ...entrada,
      item: { ...entrada.item, clienteId: cliente }
    })));
  }
  const alvoSync = item("bench-12500", "workspace-viva-sync", "processando");
  const sync = await medirResponsividade(() => filaOperacionalV2.atualizarItemFilaVivaIncremental(
    "workspace-viva-sync",
    alvoSync,
    { ...arquivos, agora: 2000 }
  ));
  const worker = await medirResponsividade(() => coordinator.mutateViva({
    clienteId: "workspace-viva-benchmark",
    checkpointRevision: "viva-benchmark-revision-01",
    targetGeneration: 1,
    mutationType: "update",
    item: item("bench-12500", "workspace-viva-benchmark", "processando"),
    dataDir: root,
    nowMs: 2000
  }));
  console.log("persistence-worker-viva-benchmark", JSON.stringify({
    snapshotBytes: fs.statSync(arquivos.getClienteJsonPath("workspace-viva-sync", "fila-viva.json")).size,
    sync: { totalMs: sync.totalMs, eventLoopMaxMs: sync.eventLoopMaxMs },
    worker: {
      totalMs: worker.totalMs,
      ackMs: worker.resultado?.coordinatorMetrics?.jobTotalMs,
      eventLoopMaxMs: worker.eventLoopMaxMs,
      workerMetrics: worker.resultado?.metrics
    }
  }));
}

async function testarCrashTimeout(root) {
  const clienteId = "workspace-viva-fault";
  const baseEnv = ambiente(root, [clienteId]);
  const payload = {
    clienteId,
    checkpointRevision: "viva-fault-revision-0001",
    targetGeneration: 1,
    mutationType: "insert",
    item: item("fault", clienteId),
    dataDir: root
  };
  const crashFile = workerTemporario(root, "require('worker_threads').parentPort.on('message', () => process.exit(42));");
  const crash = criarCoordenadorPersistencia({ env: baseEnv, workerPath: crashFile, logger: { log() {} } });
  try {
    const resultado = await crash.mutateViva(payload);
    assert.strictEqual(resultado.ok, false);
    assert(["worker_exit", "worker_error"].includes(resultado.motivo));
  } finally {
    await crash.shutdown();
    fs.rmSync(crashFile, { force: true });
  }

  const timeoutFile = workerTemporario(root, "require('worker_threads').parentPort.on('message', () => {});");
  const timeout = criarCoordenadorPersistencia({
    env: { ...baseEnv, FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "1000" },
    workerPath: timeoutFile,
    logger: { log() {} }
  });
  try {
    const resultado = await timeout.mutateViva({ ...payload, checkpointRevision: "viva-timeout-revision-01" });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "worker_timeout");
  } finally {
    await timeout.shutdown();
    fs.rmSync(timeoutFile, { force: true });
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-viva-worker-"));
  const clientes = ["workspace-viva-a", "workspace-viva-b", "workspace-viva-direct", "workspace-viva-benchmark"];
  const env = ambiente(root, clientes);
  const arquivos = storage(root);
  const eventos = [];
  const repo = repositorySerializado(eventos);
  const coordinator = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  assert.strictEqual(
    coordinator.modeForViva("workspace-novo-sem-allowlist"),
    "worker",
    "workspace novo elegivel deve herdar viva_mutation sem allowlist"
  );
  const canaryTemporario = criarCoordenadorPersistencia({
    env: {
      ...env,
      FILA_VIVA_MUTATION_WORKER_ROLLOUT: "canary",
      FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-viva-a"
    },
    logger: { log() {} }
  });
  assert.strictEqual(canaryTemporario.modeForViva("workspace-viva-a"), "worker");
  assert.strictEqual(canaryTemporario.modeForViva("workspace-fora-canary"), "legacy");
  await canaryTemporario.shutdown();
  const controller = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env,
    ...arquivos,
    manifestStateRepository: repo,
    logger: { log() {} },
    modoPersistenciaViva: clienteId => coordinator.modeFor(clienteId),
    agendarMutacaoViva: async payload => {
      const resultado = await coordinator.mutateViva({ ...payload, dataDir: root });
      eventos.push(`ack:${payload.clienteId}:${payload.targetGeneration}`);
      const proofPath = arquivos.getClienteJsonPath(payload.clienteId, filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO);
      const proofNoAck = fs.existsSync(proofPath)
        ? JSON.parse(fs.readFileSync(proofPath, "utf8"))
        : null;
      assert.notStrictEqual(
        proofNoAck?.generation,
        payload.targetGeneration,
        "ACK do worker deve anteceder o proof da nova generation no main"
      );
      return resultado;
    }
  });

  try {
    const novoWorkspace = "workspace-novo-sem-allowlist";
    const novoResultado = await coordinator.mutateViva({
      clienteId: novoWorkspace,
      checkpointRevision: "viva-global-default-0001",
      targetGeneration: 1,
      mutationType: "insert",
      item: item("novo-default", novoWorkspace),
      dataDir: root,
      nowMs: 850
    });
    assert.strictEqual(novoResultado.ok, true);
    assert.strictEqual(novoResultado.persistenceMode, "worker");

    const direto = "workspace-viva-direct";
    const [diretoA, diretoB] = await Promise.all([
      coordinator.mutateViva({
        clienteId: direto,
        checkpointRevision: "viva-direct-revision-01",
        targetGeneration: 1,
        mutationType: "insert",
        item: item("direct-a", direto),
        dataDir: root,
        nowMs: 900
      }),
      coordinator.mutateViva({
        clienteId: direto,
        checkpointRevision: "viva-direct-revision-02",
        targetGeneration: 2,
        mutationType: "insert",
        item: item("direct-b", direto),
        dataDir: root,
        nowMs: 901
      })
    ]);
    assert.strictEqual(diretoA.ok, true);
    assert.strictEqual(diretoB.ok, true);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(direto, "fila-viva.json"), "utf8")).map(entrada => entrada.id).sort(),
      ["direct-a", "direct-b"],
      "lane VIVA deve impedir lost update no mesmo workspace"
    );

    const cliente = clientes[0];
    const primeiro = item("a", cliente);
    const insert = await controller.inserirItemFilaVivaCoordenado(cliente, primeiro, { agora: 1000 });
    assert.strictEqual(insert.ok, true);
    assert.strictEqual(insert.persistenceMode, "worker");
    assert(eventos.indexOf(`ack:${cliente}:1`) < eventos.indexOf(`db_update:${cliente}:1`));
    assert.strictEqual(JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8")).length, 1);

    const update = await controller.atualizarItemFilaVivaCoordenado(cliente, item("a", cliente, "processando"), { agora: 1001 });
    assert.strictEqual(update.ok, true);
    assert.strictEqual(update.atualizouViva, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8"))[0].item.status, "processando");

    const idempotente = await controller.inserirItemFilaVivaCoordenado(cliente, item("a", cliente, "processando"), { agora: 1002 });
    assert.strictEqual(idempotente.ok, true);
    assert.strictEqual(idempotente.idempotente, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8")).length, 1);

    const remove = await controller.removerItemFilaVivaCoordenado(cliente, primeiro, { agora: 1003 });
    assert.strictEqual(remove.ok, true);
    assert.strictEqual(remove.removeuDaViva, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8")), []);

    const concorrentes = await Promise.all([
      controller.inserirItemFilaVivaCoordenado(cliente, item("b", cliente), { agora: 1004 }),
      controller.inserirItemFilaVivaCoordenado(cliente, item("c", cliente), { agora: 1005 })
    ]);
    assert.deepStrictEqual(concorrentes.map(valor => valor.generation), [5, 6]);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8")).map(entrada => entrada.id).sort(),
      ["b", "c"]
    );

    const outro = clientes[1];
    const [a, b] = await Promise.all([
      controller.inserirItemFilaVivaCoordenado(cliente, item("d", cliente), { agora: 1006 }),
      controller.inserirItemFilaVivaCoordenado(outro, item("x", outro), { agora: 1006 })
    ]);
    assert.strictEqual(a.generation, 7);
    assert.strictEqual(b.generation, 1);

    const terminalBase = item("terminal", cliente);
    assert.strictEqual((await controller.inserirItemFilaVivaCoordenado(cliente, terminalBase, { agora: 1007 })).ok, true);
    const terminal = await controller.atualizarItemFilaVivaCoordenado(
      cliente,
      { ...terminalBase, status: "expirado", expiradoEm: new Date(1008).toISOString() },
      { agora: 1008 }
    );
    assert.strictEqual(terminal.ok, true);
    assert.strictEqual(terminal.removeuDaViva, true);
    assert.strictEqual(terminal.terminalHistorico, undefined);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(arquivos.getClienteJsonPath(cliente, "fila-viva.json"), "utf8")).some(entrada => entrada.id === "terminal"),
      false
    );

    const stateAntes = repo.states.get(cliente);
    const falha = await controller.inserirItemFilaVivaCoordenado(cliente, item("erro", cliente), {
      modoPersistenciaViva: () => "worker",
      agendarMutacaoViva: async () => ({ ok: false, motivo: "worker_timeout" }),
      agora: 1009
    });
    assert.strictEqual(falha.ok, false);
    assert.strictEqual(repo.states.get(cliente), stateAntes, "erro do worker nao pode avancar DB");
    assert(eventos.includes(`rollback:${cliente}:10`));

    await testarCrashTimeout(root);
    await benchmarkLocal(root, coordinator);

    console.log("persistence-worker-viva-mutation: OK (insert/update/remove/fifo/idempotencia/ack/proof/fail-closed)");
  } finally {
    await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
