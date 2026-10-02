"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fila = require("../modules/fila/fila-operacional-v2");
const mutationIntent = require("../modules/fila/viva-mutation-intent");
const removalFence = require("../modules/fila/viva-removal-fence");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const quiet = { log() {}, warn() {} };

function criarStorage(root) {
  return {
    getClienteJsonPath(cliente, nome) { return path.join(root, "clientes", cliente, nome); },
    writeClienteJson(cliente, nome, valor) {
      const file = path.join(root, "clientes", cliente, nome);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(valor, null, 2));
      fs.renameSync(temp, file);
      return true;
    }
  };
}

function criarRepositorio(cliente, inicial) {
  const states = new Map([[cliente, inicial]]);
  return {
    states,
    async lerStateObservacional(id) { return { ok: true, state: states.get(id) }; },
    async capturarTargetCheckpoint(id, dados) {
      const state = states.get(id);
      if (dados.expectedTargetGeneration !== undefined &&
          Number(dados.expectedTargetGeneration) !== Number(state.vivaGeneration)) {
        return { ok: false, motivo: "checkpoint_expected_target_mismatch", state };
      }
      const checkpointRevision = dados.checkpointRevision || `checkpoint-${Date.now()}-${Math.random()}`;
      const pendente = { ...state, authorityReady: false, pendingCheckpointRevision: checkpointRevision,
        pendingCheckpointTargetGeneration: state.vivaGeneration,
        pendingCheckpointStartedAt: new Date().toISOString() };
      states.set(id, pendente);
      return { ok: true, clienteId: id, checkpointRevision,
        targetGeneration: state.vivaGeneration, state: pendente };
    },
    async confirmarCheckpointDuravel(id, dados) {
      const state = states.get(id);
      if (state.pendingCheckpointRevision !== dados.checkpointRevision ||
          state.pendingCheckpointTargetGeneration !== dados.targetGeneration) {
        return { ok: false, motivo: "checkpoint_revision_nao_pertence", state };
      }
      const publicado = await dados.publicarCheckpoint({ clienteId: id, state,
        targetGeneration: dados.targetGeneration, checkpointRevision: dados.checkpointRevision });
      if (publicado?.ok !== true || publicado.legacyFileProof?.generation !== dados.targetGeneration) {
        return { ok: false, motivo: publicado?.motivo || "checkpoint_proof_missing", state };
      }
      const confirmado = { ...state, revision: Number(state.revision) + 1,
        durableCheckpointGeneration: dados.targetGeneration, dirtyGeneration: null,
        legacyFileProof: publicado.legacyFileProof, authorityReady: false,
        pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null,
        pendingCheckpointStartedAt: null };
      states.set(id, confirmado);
      return { ok: true, motivo: "checkpoint_confirmado", state: confirmado,
        legacyFileProof: publicado.legacyFileProof };
    }
  };
}

async function criarCenario(nome, gap, opcoes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fence-restart-${nome}-`));
  const cliente = `workspace_${nome}`;
  const store = criarStorage(root);
  const env = { ...process.env, DATA_DIR: root, FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global", FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_RECOVERY_AUTORIDADE: "generation" };
  const durable = 100;
  const fenceGeneration = durable + gap;
  const vivaGeneration = fenceGeneration + 1;
  const removidos = opcoes.multiplas ? ["terminal-a", "terminal-b"] : ["terminal-a"];
  const itensRemovidos = removidos.map(id => ({ id, clienteId: cliente,
    status: "expirada_operacional", preco: 10 }));
  const seguro = { id: "item-seguro", clienteId: cliente, status: "pendente", preco: 20 };
  store.writeClienteJson(cliente, "fila.json", [...itensRemovidos, seguro]);
  store.writeClienteJson(cliente, "fila-viva.json", [
    ...(opcoes.vivaContemFence ? itensRemovidos.map((item, indice) => ({
      id: item.id, item, bucket: "viva", status: item.status, posicaoLegada: indice
    })) : []),
    { id: seguro.id, item: seguro, bucket: "viva", status: seguro.status,
      posicaoLegada: itensRemovidos.length }
  ]);
  const proof = fila.publicarProofFilaViva(cliente, {
    generation: vivaGeneration, fileRevision: `viva-${nome}`
  }, { ...store, logger: quiet });
  assert.strictEqual(proof.ok, true);
  const state = { revision: 10, vivaGeneration, durableCheckpointGeneration: durable,
    dirtyGeneration: durable + 1, vivaFileProof: proof.proof, legacyFileProof: null,
    authorityReady: true, authorityReadyGeneration: vivaGeneration, authorityReadyRevision: 10,
    pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null,
    pendingCheckpointStartedAt: null };
  const repo = criarRepositorio(cliente, state);
  if (opcoes.manifesto !== false) {
    store.writeClienteJson(cliente, "fila-v2-manifest.json", { version: 2, manifestVersion: 2,
      clienteId: cliente, vivaGeneration, durableCheckpointGeneration: durable,
      dirtyGeneration: durable + 1, vivaFileProof: proof.proof });
  }
  for (const item of itensRemovidos) {
    removalFence.escrever(root, cliente, { schema: 1, clienteId: cliente,
      jobId: `job-${item.id}`, generation: fenceGeneration, operation: "terminal",
      identityHashes: fila.identidadesItemFilaV2(item).map(mutationIntent.digest),
      createdAt: new Date().toISOString() });
  }
  const historyDir = path.join(root, "clientes", cliente, "fila-historico-incremental");
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, "2026-10.jsonl"),
    itensRemovidos.map(item => JSON.stringify(item)).join("\n") + "\n");
  const coordinator = criarCoordenadorPersistencia({ env, logger: quiet });
  const controller = fila.criarControladorFilaOperacionalV2({ ...store, env,
    manifestStateRepository: repo, logger: quiet,
    agendarProbeViva: payload => coordinator.probeVivaSnapshot({ ...payload, dataDir: root }) });
  return { root, cliente, store, env, repo, coordinator, controller, durable,
    fenceGeneration, vivaGeneration, removidos, seguro, historyDir };
}

async function fecharCenario(cenario) {
  await cenario.coordinator.shutdown();
  fs.rmSync(cenario.root, { recursive: true, force: true });
}

async function obterAutoridade(cenario) {
  return cenario.controller.reconciliarIntentMutacaoViva(cenario.cliente, {
    recoveryRemovalFenceCheckpoint: true
  });
}

async function prepararCheckpoint(cenario, autoridade) {
  const target = await cenario.controller.capturarTargetCheckpointCoordenado(cenario.cliente, {
    expectedTargetGeneration: autoridade.targetGeneration,
    motivo: "recovery_removal_fence_restart"
  });
  if (target.ok !== true) return { target };
  const prepared = await cenario.coordinator.prepare({ clienteId: cenario.cliente,
    checkpointRevision: target.checkpointRevision, targetGeneration: target.targetGeneration,
    expectedVivaHash: autoridade.expectedVivaHash, dataDir: cenario.root,
    persistenceMode: "worker" });
  return { target, prepared };
}

async function confirmarCheckpoint(cenario, target, prepared) {
  return cenario.controller.confirmarCheckpointCoordenado(cenario.cliente, {
    targetGeneration: target.targetGeneration, checkpointRevision: target.checkpointRevision,
    motivo: "recovery_removal_fence_restart",
    publicarCheckpoint: ({ targetGeneration, checkpointRevision }) =>
      cenario.coordinator.publish({ clienteId: cenario.cliente, dataDir: cenario.root,
        targetGeneration, checkpointRevision, tempIdentity: prepared.tempIdentity,
        expectedSourceRevisions: prepared.sourceRevisions, persistenceMode: "worker" })
  });
}

function verificarConvergencia(cenario) {
  const legacy = JSON.parse(fs.readFileSync(path.join(cenario.root, "clientes", cenario.cliente, "fila.json"), "utf8"));
  assert.deepStrictEqual(legacy.map(item => item.id), [cenario.seguro.id]);
  assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 0);
  assert.strictEqual(cenario.repo.states.get(cenario.cliente).durableCheckpointGeneration,
    cenario.vivaGeneration);
  const linhas = fs.readFileSync(path.join(cenario.historyDir, "2026-10.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean);
  assert.strictEqual(linhas.length, cenario.removidos.length);
}

async function executarNormal(nome, gap, opcoes = {}) {
  const cenario = await criarCenario(nome, gap, opcoes);
  try {
    const autoridade = await obterAutoridade(cenario);
    assert.strictEqual(autoridade.ok, true, JSON.stringify(autoridade));
    assert.strictEqual(autoridade.checkpointRequired, true);
    assert.strictEqual(autoridade.targetGeneration, cenario.vivaGeneration);
    assert.match(autoridade.expectedVivaHash, /^[a-f0-9]{64}$/);
    const { target, prepared } = await prepararCheckpoint(cenario, autoridade);
    assert.strictEqual(target.ok, true);
    assert.strictEqual(prepared.ok, true);
    const confirmado = await confirmarCheckpoint(cenario, target, prepared);
    assert.strictEqual(confirmado.ok, true);
    verificarConvergencia(cenario);
    const apos = await obterAutoridade(cenario);
    assert.strictEqual(apos.ok, true);
    assert.strictEqual(apos.checkpointRequired, false);
  } finally { await fecharCenario(cenario); }
}

async function testarFailClosed() {
  for (const caso of ["proof", "manifest", "viva_fence"]) {
    const cenario = await criarCenario(`fail_${caso}`, 1, {
      manifesto: caso !== "manifest", vivaContemFence: caso === "viva_fence"
    });
    try {
      if (caso === "proof") {
        fs.writeFileSync(path.join(cenario.root, "clientes", cenario.cliente,
          fila.FILA_VIVA_PROOF_ARQUIVO), JSON.stringify({ generation: 999 }));
      }
      const resultado = await obterAutoridade(cenario);
      assert.strictEqual(resultado.ok, false);
      assert.strictEqual(resultado.failClosed, true);
      assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 1);
    } finally { await fecharCenario(cenario); }
  }
}

async function testarHashMudouDepoisDaProva() {
  const cenario = await criarCenario("hash_changed", 1);
  try {
    const autoridade = await obterAutoridade(cenario);
    const vivaPath = path.join(cenario.root, "clientes", cenario.cliente, "fila-viva.json");
    const viva = JSON.parse(fs.readFileSync(vivaPath, "utf8"));
    viva.push({ id: "item-novo", item: { id: "item-novo", clienteId: cenario.cliente,
      status: "pendente" }, bucket: "viva", status: "pendente", posicaoLegada: 2 });
    cenario.store.writeClienteJson(cenario.cliente, "fila-viva.json", viva);
    const { target, prepared } = await prepararCheckpoint(cenario, autoridade);
    assert.strictEqual(target.ok, true);
    assert.strictEqual(prepared.ok, false);
    assert.strictEqual(cenario.repo.states.get(cenario.cliente).durableCheckpointGeneration,
      cenario.durable);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 1);
  } finally { await fecharCenario(cenario); }
}

async function testarCrashAntesPublicacao() {
  const cenario = await criarCenario("crash_before_publish", 1);
  try {
    const autoridade = await obterAutoridade(cenario);
    const primeira = await prepararCheckpoint(cenario, autoridade);
    assert.strictEqual(primeira.prepared.ok, true);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 1);
    assert.strictEqual(cenario.repo.states.get(cenario.cliente).durableCheckpointGeneration,
      cenario.durable);
    const retryAuthority = await obterAutoridade(cenario);
    assert.strictEqual(retryAuthority.checkpointRequired, true);
    const segunda = await prepararCheckpoint(cenario, retryAuthority);
    assert.strictEqual(segunda.prepared.ok, true);
    assert.strictEqual((await confirmarCheckpoint(cenario, segunda.target, segunda.prepared)).ok, true);
    verificarConvergencia(cenario);
  } finally { await fecharCenario(cenario); }
}

async function testarCrashDepoisPublicacao() {
  const cenario = await criarCenario("crash_after_publish", 1);
  try {
    const autoridade = await obterAutoridade(cenario);
    const primeira = await prepararCheckpoint(cenario, autoridade);
    const publicado = await cenario.coordinator.publish({ clienteId: cenario.cliente,
      dataDir: cenario.root, targetGeneration: primeira.target.targetGeneration,
      checkpointRevision: primeira.target.checkpointRevision,
      tempIdentity: primeira.prepared.tempIdentity,
      expectedSourceRevisions: primeira.prepared.sourceRevisions, persistenceMode: "worker" });
    assert.strictEqual(publicado.ok, true);
    assert.strictEqual(cenario.repo.states.get(cenario.cliente).durableCheckpointGeneration,
      cenario.durable);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 1);
    const retryAuthority = await obterAutoridade(cenario);
    assert.strictEqual(retryAuthority.checkpointRequired, true);
    const segunda = await prepararCheckpoint(cenario, retryAuthority);
    assert.strictEqual((await confirmarCheckpoint(cenario, segunda.target, segunda.prepared)).ok, true);
    verificarConvergencia(cenario);
  } finally { await fecharCenario(cenario); }
}

async function testarCrashDepoisDurable() {
  const cenario = await criarCenario("crash_after_durable", 1);
  const unlinkOriginal = fs.unlinkSync;
  try {
    const autoridade = await obterAutoridade(cenario);
    const checkpoint = await prepararCheckpoint(cenario, autoridade);
    fs.unlinkSync = function(file) {
      if (String(file).includes(removalFence.DIRECTORY)) throw new Error("crash_before_fence_cleanup");
      return unlinkOriginal.apply(this, arguments);
    };
    assert.strictEqual((await confirmarCheckpoint(cenario, checkpoint.target, checkpoint.prepared)).ok, true);
    fs.unlinkSync = unlinkOriginal;
    assert.strictEqual(cenario.repo.states.get(cenario.cliente).durableCheckpointGeneration,
      cenario.vivaGeneration);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 1);
    const recovered = await obterAutoridade(cenario);
    assert.strictEqual(recovered.ok, true);
    verificarConvergencia(cenario);
  } finally {
    fs.unlinkSync = unlinkOriginal;
    await fecharCenario(cenario);
  }
}

async function testarSemFenceEForceExplicito() {
  const cenario = await criarCenario("sem_fence", 1);
  try {
    removalFence.limparAte(cenario.root, cenario.cliente, cenario.vivaGeneration);
    const resultado = await obterAutoridade(cenario);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.checkpointRequired, false);
    const checkpoint = fila.criarControladorCheckpointLegadoV2();
    assert.strictEqual(checkpoint.iniciarCheckpoint(cenario.cliente, { forcar: true }).deve, false);
    assert.strictEqual(checkpoint.iniciarCheckpoint(cenario.cliente, {
      forcar: true, removalFenceRecovery: true, motivo: "recovery"
    }).deve, true);
  } finally { await fecharCenario(cenario); }
}

function testarWiringIndex() {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const helper = source.indexOf("concluirRecoveryRemovalFencePendente");
  const lazy = source.indexOf("recovered = await concluirRecoveryRemovalFencePendente", helper);
  const load = source.indexOf("carregarFila(cliente, callerTagInicializacaoFila", lazy);
  assert(helper >= 0 && lazy > helper && load > lazy,
    "lazy boot deve concluir checkpoint de recovery antes de carregar workspace");
}

async function main() {
  await executarNormal("diego_like", 6);
  await executarNormal("wolf_like", 1);
  await executarNormal("multiple_fences", 3, { multiplas: true });
  await testarFailClosed();
  await testarHashMudouDepoisDaProva();
  await testarCrashAntesPublicacao();
  await testarCrashDepoisPublicacao();
  await testarCrashDepoisDurable();
  await testarSemFenceEForceExplicito();
  testarWiringIndex();
  console.log("removal-fence-restart-recovery: OK");
}

main().catch(erro => { console.error(erro); process.exitCode = 1; });
