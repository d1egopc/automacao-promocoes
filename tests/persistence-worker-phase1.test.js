"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const { mesclarFilaLegadaComViva } = require("../modules/fila/fila-operacional-v2");

function revision(numero) {
  return `phase1-revision-${numero}`;
}

function prepararFixture(root, clienteId = "workspace-a") {
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  const legado = [
    { id: "a", clienteId, status: "pendente", titulo: "A", preco: 10 },
    { id: "b", clienteId, status: "enviado", titulo: "B", preco: 20 }
  ];
  const viva = [
    { id: "a", clienteId, status: "enviado", titulo: "A", preco: 10 },
    { id: "c", clienteId, status: "pendente", titulo: "C", preco: 30 }
  ];
  fs.writeFileSync(path.join(dir, "fila.json"), JSON.stringify(legado, null, 2));
  fs.writeFileSync(path.join(dir, "fila-viva.json"), JSON.stringify(viva, null, 2));
  return { dir, legado, viva };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-phase1-"));
  const clienteId = "workspace-a";
  const fixture = prepararFixture(root, clienteId);
  const nowMs = Date.now();
  const esperado = mesclarFilaLegadaComViva(clienteId, fixture.legado, fixture.viva, { agora: nowMs }).filaCliente;
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "30000"
  };
  const coordenador = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  try {
    const primeiro = await coordenador.prepare({
      clienteId,
      checkpointRevision: revision(1),
      dataDir: root,
      nowMs
    });
    assert.strictEqual(primeiro.ok, true);
    assert.strictEqual(typeof primeiro.itens, "number");
    assert.strictEqual(Array.isArray(primeiro.fila), false, "fila completa não pode voltar ao main");
    assert.strictEqual(Array.isArray(primeiro.resultado), false, "resultado completo não pode voltar ao main");
    const revisaoInicial = coordenador.revalidarSources(clienteId, primeiro.sourceRevisions, { dataDir: root, incluirLegacy: false });
    assert.strictEqual(revisaoInicial.ok, true);

    const publicado = await coordenador.publish({
      clienteId,
      checkpointRevision: revision(1),
      targetGeneration: 1,
      dataDir: root,
      tempIdentity: primeiro.tempIdentity,
      expectedSourceRevisions: primeiro.sourceRevisions
    });
    assert.strictEqual(publicado.ok, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fixture.dir, "fila.json"), "utf8")), esperado);
    assert.strictEqual(fs.existsSync(path.join(fixture.dir, "fila.proof.json")), true);
    assert.strictEqual(fs.existsSync(path.join(fixture.dir, "fila.json.bak")), true);

    const workerThreadId = primeiro.metrics.workerThreadId;
    let processRssMax = primeiro.metrics.processRssBytesAtJob;
    let processRssMin = primeiro.metrics.processRssBytesAtJob;
    for (let i = 2; i <= 101; i += 1) {
      const proximo = await coordenador.prepare({
        clienteId,
        checkpointRevision: revision(i),
        dataDir: root,
        nowMs: nowMs + i
      });
      assert.strictEqual(proximo.ok, true);
      assert.strictEqual(proximo.metrics.workerThreadId, workerThreadId, "o mesmo Worker deve ser reutilizado");
      processRssMax = Math.max(processRssMax, proximo.metrics.processRssBytesAtJob || 0);
      processRssMin = Math.min(processRssMin, proximo.metrics.processRssBytesAtJob || processRssMin);
      const fim = await coordenador.publish({
        clienteId,
        checkpointRevision: revision(i),
        targetGeneration: i,
        dataDir: root,
        tempIdentity: proximo.tempIdentity,
        expectedSourceRevisions: proximo.sourceRevisions
      });
      assert.strictEqual(fim.ok, true);
    }

    const stalePrep = await coordenador.prepare({
      clienteId,
      checkpointRevision: revision(5),
      dataDir: root,
      nowMs
    });
    assert.strictEqual(stalePrep.ok, true);
    fs.writeFileSync(path.join(fixture.dir, "fila-viva.json"), JSON.stringify([
      ...fixture.viva,
      { id: "d", clienteId, status: "pendente" }
    ], null, 2));
    const stale = await coordenador.publish({
      clienteId,
      checkpointRevision: revision(5),
      targetGeneration: 5,
      dataDir: root,
      tempIdentity: stalePrep.tempIdentity,
      expectedSourceRevisions: stalePrep.sourceRevisions
    });
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.motivo, "checkpoint_source_revision_changed");
    const cleanup = await coordenador.cleanup({ clienteId, checkpointRevision: revision(5), dataDir: root });
    assert.strictEqual(cleanup.ok, true);

    const fixtureB = prepararFixture(root, "workspace-b");
    const [workspaceAJob, workspaceBJob] = await Promise.all([
      coordenador.prepare({ clienteId, checkpointRevision: revision(6), dataDir: root, nowMs }),
      coordenador.prepare({ clienteId: "workspace-b", checkpointRevision: revision(7), dataDir: root, nowMs })
    ]);
    assert.strictEqual(workspaceAJob.ok, true);
    assert.strictEqual(workspaceBJob.ok, true);
    assert.strictEqual(workspaceAJob.metrics.workerThreadId, workerThreadId);
    assert.strictEqual(workspaceBJob.metrics.workerThreadId, workerThreadId);
    const [workspaceAPublish, workspaceBPublish] = await Promise.all([
      coordenador.publish({
        clienteId,
        checkpointRevision: revision(6),
        targetGeneration: 6,
        dataDir: root,
        tempIdentity: workspaceAJob.tempIdentity,
        expectedSourceRevisions: workspaceAJob.sourceRevisions
      }),
      coordenador.publish({
        clienteId: "workspace-b",
        checkpointRevision: revision(7),
        targetGeneration: 7,
        dataDir: root,
        tempIdentity: workspaceBJob.tempIdentity,
        expectedSourceRevisions: workspaceBJob.sourceRevisions
      })
    ]);
    assert.strictEqual(workspaceAPublish.ok, true);
    assert.strictEqual(workspaceBPublish.ok, true);
    assert.strictEqual(fs.existsSync(path.join(fixtureB.dir, "fila.proof.json")), true);

    const estado = coordenador.getState();
    assert.strictEqual(estado.circuitOpen, false);
    assert.strictEqual(estado.queued, 0);
    assert.ok(processRssMax >= processRssMin);
    console.log("persistence-worker-phase1: OK");
  } finally {
    await coordenador.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const off = criarCoordenadorPersistencia({
    env: { ...env, FILA_PERSISTENCE_WORKER: "0" },
    logger: { log() {} }
  });
  const desligado = await off.prepare({
    clienteId,
    checkpointRevision: revision(200),
    dataDir: root
  });
  assert.strictEqual(desligado.motivo, "persistence_worker_disabled");
  assert.strictEqual(off.getState().workerCreated, false);
  await off.shutdown();

  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-invalid-"));
  prepararFixture(invalidRoot, clienteId);
  fs.writeFileSync(path.join(invalidRoot, "clientes", clienteId, "fila-viva.json"), "{invalid");
  const invalid = criarCoordenadorPersistencia({ env: { ...env, DATA_DIR: invalidRoot }, logger: { log() {} } });
  try {
    const falha = await invalid.prepare({
      clienteId,
      checkpointRevision: revision(201),
      dataDir: invalidRoot
    });
    assert.strictEqual(falha.ok, false);
    assert.strictEqual(invalid.getState().circuitOpen, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(invalidRoot, "clientes", clienteId, "fila.json"), "utf8")), fixture.legado);
  } finally {
    await invalid.shutdown();
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }

  const terminated = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  const terminatedState = await terminated.terminateForTest();
  assert.strictEqual(terminatedState, undefined);
  const afterTerminate = await terminated.prepare({
    clienteId,
    checkpointRevision: revision(202),
    dataDir: root
  });
  assert.strictEqual(afterTerminate.motivo, "persistence_worker_circuit_open");
  await terminated.shutdown();
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
