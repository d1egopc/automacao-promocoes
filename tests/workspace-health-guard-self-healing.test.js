"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fila = require("../modules/fila/fila-operacional-v2");
const mutationIntent = require("../modules/fila/viva-mutation-intent");
const removalFence = require("../modules/fila/viva-removal-fence");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function criarLogger() {
  const eventos = [];
  return {
    eventos,
    log(tag, payload) {
      try { eventos.push({ tag, ...JSON.parse(payload) }); } catch {}
    },
    warn(tag, payload) { this.log(tag, payload); }
  };
}

function criarStorage(root) {
  return {
    getClientePath(cliente) { return path.join(root, "clientes", cliente); },
    getClienteJsonPath(cliente, nome) { return path.join(root, "clientes", cliente, nome); },
    readClienteJson(cliente, nome, fallback = null) {
      try { return JSON.parse(fs.readFileSync(path.join(root, "clientes", cliente, nome), "utf8")); }
      catch { return fallback; }
    },
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

function criarRepositorio(states) {
  return {
    states,
    async lerStateObservacional(cliente) { return { ok: true, state: states.get(cliente) }; },
    async registrarMutacaoDuravel(cliente, dados) {
      const antes = states.get(cliente);
      const nextGeneration = Number(antes.vivaGeneration) + 1;
      const escrita = await dados.escreverArquivo({
        state: antes,
        nextGeneration,
        fileRevision: dados.fileRevision
      });
      if (escrita?.ok !== true) return { ok: false, motivo: escrita?.motivo || "writer_failed", state: antes };
      const depois = {
        ...antes,
        revision: Number(antes.revision) + 1,
        vivaGeneration: nextGeneration,
        dirtyGeneration: antes.dirtyGeneration || Number(antes.durableCheckpointGeneration) + 1,
        vivaFileProof: escrita.vivaFileProof,
        authorityReady: false
      };
      states.set(cliente, depois);
      return { ok: true, state: depois };
    },
    async capturarTargetCheckpoint(cliente, dados) {
      const antes = states.get(cliente);
      if (dados.expectedTargetGeneration !== undefined &&
          Number(dados.expectedTargetGeneration) !== Number(antes.vivaGeneration)) {
        return { ok: false, motivo: "checkpoint_expected_target_mismatch", state: antes };
      }
      const checkpointRevision = dados.checkpointRevision || `health-${cliente}-${antes.vivaGeneration}`;
      const depois = {
        ...antes,
        authorityReady: false,
        pendingCheckpointRevision: checkpointRevision,
        pendingCheckpointTargetGeneration: antes.vivaGeneration,
        pendingCheckpointStartedAt: new Date().toISOString()
      };
      states.set(cliente, depois);
      return { ok: true, clienteId: cliente, checkpointRevision,
        targetGeneration: antes.vivaGeneration, state: depois };
    },
    async confirmarCheckpointDuravel(cliente, dados) {
      const antes = states.get(cliente);
      const publicado = await dados.publicarCheckpoint({
        clienteId: cliente,
        state: antes,
        targetGeneration: dados.targetGeneration,
        checkpointRevision: dados.checkpointRevision
      });
      if (publicado?.ok !== true ||
          Number(publicado.legacyFileProof?.generation) !== Number(dados.targetGeneration)) {
        return { ok: false, motivo: publicado?.motivo || "checkpoint_proof_missing", state: antes };
      }
      const depois = {
        ...antes,
        revision: Number(antes.revision) + 1,
        durableCheckpointGeneration: dados.targetGeneration,
        dirtyGeneration: null,
        legacyFileProof: publicado.legacyFileProof,
        authorityReady: false,
        pendingCheckpointRevision: null,
        pendingCheckpointTargetGeneration: null,
        pendingCheckpointStartedAt: null
      };
      states.set(cliente, depois);
      return { ok: true, motivo: "checkpoint_confirmado", state: depois,
        legacyFileProof: publicado.legacyFileProof };
    }
  };
}

function entrada(item, posicaoLegada) {
  return { id: item.id, item, bucket: "viva", status: item.status, posicaoLegada };
}

function lerJson(cenario, cliente, nome) {
  return JSON.parse(fs.readFileSync(path.join(cenario.root, "clientes", cliente, nome), "utf8"));
}

function idsViva(cenario, cliente) {
  return lerJson(cenario, cliente, "fila-viva.json").map(item => item.id).sort();
}

function historico(cenario, cliente) {
  const dir = path.join(cenario.root, "clientes", cliente, fila.HISTORICO_INCREMENTAL_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(nome => nome.endsWith(".jsonl"))
    .flatMap(nome => fs.readFileSync(path.join(dir, nome), "utf8").split(/\r?\n/).filter(Boolean));
}

async function criarCenario(nome, opcoes = {}) {
  fila.resetarWorkspaceHealthGuardParaTeste();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspace-health-${nome}-`));
  const cliente = opcoes.cliente || `user_${nome}_${Date.now()}`;
  const outroCliente = `${cliente}_isolado`;
  const storage = criarStorage(root);
  const logger = criarLogger();
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global",
    FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_OPERACIONAL_BLOCKLIST_CLIENTES: "user_blocklist_fixture",
    FILA_V2_RECOVERY_AUTORIDADE: "generation"
  };
  const terminal = {
    clienteId: cliente,
    id: "engine_terminal_100",
    ofertaId: 100,
    produtoId: "MLB-HEALTH-100",
    linkOriginal: "https://produto.exemplo/health-100",
    titulo: "Produto Health Guard",
    preco: 99.9,
    status: "enviado",
    enviadoEm: new Date(1000).toISOString(),
    providerMessageId: "provider-health-100"
  };
  const aliases = [
    { ...terminal, id: "alias-produto", ofertaId: 101, status: "pendente",
      enviadoEm: undefined, providerMessageId: undefined },
    { clienteId: cliente, id: "alias-link", ofertaId: 102,
      linkOriginal: terminal.linkOriginal, titulo: terminal.titulo, preco: terminal.preco, status: "pendente" },
    { clienteId: cliente, id: "alias-titulo", ofertaId: 103,
      titulo: terminal.titulo, preco: terminal.preco, status: "pendente" }
  ].slice(0, opcoes.aliases == null ? 3 : opcoes.aliases);
  if (opcoes.workspaceConflitante === true && aliases[0]) {
    aliases[0] = { ...aliases[0], clienteId: outroCliente };
  }
  let representanteVivo = null;
  if (opcoes.representanteVivo === true && aliases[0]) {
    aliases[0] = { ...aliases[0], produtoId: "ALIAS-LOCAL-UNICO" };
    representanteVivo = { clienteId: cliente, id: "representante-vivo-legitimo",
      produtoId: "ALIAS-LOCAL-UNICO", titulo: "Outro cadastro ainda vivo",
      preco: 55, status: "pendente" };
  }
  const seguro = { clienteId: cliente, id: "item-seguro", ofertaId: 900,
    titulo: "Item sem relacao", preco: 10, status: "pendente" };
  const outro = { ...seguro, clienteId: outroCliente, id: "item-outro-workspace" };
  const itensViva = [...aliases, ...(representanteVivo ? [representanteVivo] : []), seguro];
  const viva = itensViva.map(entrada);
  storage.writeClienteJson(cliente, "fila.json", itensViva);
  storage.writeClienteJson(cliente, "fila-viva.json", viva);
  storage.writeClienteJson(outroCliente, "fila.json", [outro]);
  storage.writeClienteJson(outroCliente, "fila-viva.json", [entrada(outro, 0)]);
  const proof = fila.publicarProofFilaViva(cliente, {
    generation: 5,
    fileRevision: `health-${nome}`
  }, { ...storage, logger });
  assert.strictEqual(proof.ok, true);
  const state = {
    revision: 5,
    vivaGeneration: 5,
    durableCheckpointGeneration: 3,
    dirtyGeneration: 4,
    vivaFileProof: proof.proof,
    legacyFileProof: null,
    authorityReady: opcoes.authorityReady !== false,
    authorityReadyGeneration: 5,
    authorityReadyRevision: 5,
    pendingCheckpointRevision: null,
    pendingCheckpointTargetGeneration: null,
    pendingCheckpointStartedAt: null
  };
  const states = new Map([[cliente, state]]);
  const repo = criarRepositorio(states);
  storage.writeClienteJson(cliente, "fila-v2-manifest.json", {
    version: 2,
    manifestVersion: 2,
    clienteId: cliente,
    vivaGeneration: 5,
    durableCheckpointGeneration: 3,
    dirtyGeneration: 4,
    vivaFileProof: proof.proof
  });
  const historyDir = path.join(root, "clientes", cliente, fila.HISTORICO_INCREMENTAL_DIR);
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, "2026-10.jsonl"), `${JSON.stringify(entrada(terminal, 0))}\n`);
  if (opcoes.semFence !== true) {
    removalFence.escrever(root, cliente, {
      schema: 1,
      clienteId: cliente,
      jobId: `terminal-${nome}`,
      generation: 4,
      operation: opcoes.fenceOperation || "terminal",
      identityHashes: fila.identidadesItemFilaV2(terminal).map(mutationIntent.digest),
      createdAt: new Date().toISOString()
    });
  }
  if (opcoes.segundoTerminal === true) {
    removalFence.escrever(root, cliente, {
      schema: 1,
      clienteId: cliente,
      jobId: `terminal-${nome}-ambiguo`,
      generation: 5,
      operation: "terminal",
      identityHashes: fila.identidadesItemFilaV2(terminal).map(mutationIntent.digest),
      createdAt: new Date().toISOString()
    });
  }
  const coordinator = criarCoordenadorPersistencia({ env, logger });
  const mutationTypes = [];
  const controller = fila.criarControladorFilaOperacionalV2({
    ...storage,
    env,
    manifestStateRepository: repo,
    logger,
    modoPersistenciaViva: () => "worker",
    agendarMutacaoViva: payload => {
      mutationTypes.push(payload.mutationType);
      return coordinator.mutateViva({ ...payload, dataDir: root });
    },
    agendarProbeViva: payload => coordinator.probeVivaSnapshot({ ...payload, dataDir: root })
  });
  storage.writeClienteJson(cliente, "automacao.json", { automacaoAtiva: false });
  return { root, cliente, outroCliente, terminal, aliases, representanteVivo, seguro, outro, storage,
    logger, env, states, repo, coordinator, controller, mutationTypes };
}

async function destruirCenario(cenario) {
  await cenario.coordinator.shutdown();
  fs.rmSync(cenario.root, { recursive: true, force: true });
}

async function executarGuard(cenario) {
  return cenario.controller.reconciliarIntentMutacaoViva(cenario.cliente, {
    recoveryRemovalFenceCheckpoint: true,
    workspaceHealthGuard: true
  });
}

async function concluirCheckpoint(cenario, recovery) {
  const target = await cenario.controller.capturarTargetCheckpointCoordenado(cenario.cliente, {
    expectedTargetGeneration: recovery.targetGeneration,
    motivo: "workspace_health_guard_test"
  });
  assert.strictEqual(target.ok, true, JSON.stringify(target));
  const prepared = await cenario.coordinator.prepare({
    clienteId: cenario.cliente,
    checkpointRevision: target.checkpointRevision,
    targetGeneration: target.targetGeneration,
    expectedVivaHash: recovery.expectedVivaHash,
    dataDir: cenario.root,
    persistenceMode: "worker"
  });
  assert.strictEqual(prepared.ok, true, JSON.stringify(prepared));
  const confirmado = await cenario.controller.confirmarCheckpointCoordenado(cenario.cliente, {
    targetGeneration: target.targetGeneration,
    checkpointRevision: target.checkpointRevision,
    motivo: "workspace_health_guard_test",
    publicarCheckpoint: ({ targetGeneration, checkpointRevision }) =>
      cenario.coordinator.publish({
        clienteId: cenario.cliente,
        checkpointRevision,
        targetGeneration,
        dataDir: cenario.root,
        tempIdentity: prepared.tempIdentity,
        expectedSourceRevisions: prepared.sourceRevisions,
        persistenceMode: "worker"
      })
  });
  assert.strictEqual(confirmado.ok, true, JSON.stringify(confirmado));
  const final = await cenario.controller.reconciliarIntentMutacaoViva(cenario.cliente, {
    recoveryRemovalFenceCheckpoint: true,
    workspaceHealthGuard: true
  });
  assert.strictEqual(final.ok, true, JSON.stringify(final));
  assert.strictEqual(final.checkpointRequired, false);
  cenario.controller.registrarWorkspaceHealthGuardConcluido(cenario.cliente, recovery, final);
  return final;
}

async function testarRecoveryUniversal(cliente) {
  const cenario = await criarCenario(cliente.replace(/\W/g, "_"), { cliente });
  try {
    const historicoAntes = historico(cenario, cenario.cliente);
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.strictEqual(recovery.checkpointRequired, true);
    assert.strictEqual(recovery.workspaceHealthGuard.removidos, 3);
    assert.strictEqual(recovery.workspaceHealthGuard.unrelatedRemoved, 0);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.deepStrictEqual(idsViva(cenario, cenario.outroCliente), [cenario.outro.id]);
    assert.deepStrictEqual(lerJson(cenario, cenario.cliente, "automacao.json"), {
      automacaoAtiva: false
    });
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
    assert.deepStrictEqual(cenario.mutationTypes, ["remove"]);
    assert.strictEqual(cenario.terminal.providerMessageId, "provider-health-100");
    await concluirCheckpoint(cenario, recovery);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 0);
    assert.deepStrictEqual(lerJson(cenario, cenario.cliente, "fila.json").map(item => item.id),
      [cenario.seguro.id]);
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
    fila.resetarWorkspaceHealthGuardParaTeste();
    const aposRestart = await executarGuard(cenario);
    assert.strictEqual(aposRestart.ok, true);
    assert.strictEqual(aposRestart.checkpointRequired, false);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
    const eventos = cenario.logger.eventos.map(evento => evento.evento);
    assert(eventos.includes("workspace_health_guard_detected"));
    assert(eventos.includes("workspace_health_guard_recovery_started"));
    assert(eventos.includes("workspace_health_guard_recovery_success"));
  } finally { await destruirCenario(cenario); }
}

async function testarTerminalAmbiguoFailClosed() {
  const cenario = await criarCenario("terminal_ambiguo", {
    segundoTerminal: true,
    cliente: "user_future_ambigua"
  });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.workspaceHealthGuard.recusada, true);
    assert.strictEqual(resultado.workspaceHealthGuard.motivo, "fence_terminal_ambiguo");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    const repetida = await executarGuard(cenario);
    assert.strictEqual(repetida.workspaceHealthGuard.repetida, true);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    fila.resetarWorkspaceHealthGuardParaTeste();
    const depoisRestart = await executarGuard(cenario);
    assert.strictEqual(depoisRestart.workspaceHealthGuard.recusada, true);
    assert.strictEqual(depoisRestart.workspaceHealthGuard.motivo, "fence_terminal_ambiguo");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarDuasWorkspacesSimultaneas() {
  const a = await criarCenario("simultanea_a", { cliente: "user_future_simultanea_a" });
  const b = await criarCenario("simultanea_b", { cliente: "user_future_simultanea_b" });
  try {
    const [resultadoA, resultadoB] = await Promise.all([executarGuard(a), executarGuard(b)]);
    assert.strictEqual(resultadoA.ok, true, JSON.stringify(resultadoA));
    assert.strictEqual(resultadoB.ok, true, JSON.stringify(resultadoB));
    assert.strictEqual(resultadoA.workspaceHealthGuard.removidos, 3);
    assert.strictEqual(resultadoB.workspaceHealthGuard.removidos, 3);
    assert.deepStrictEqual(idsViva(a, a.cliente), [a.seguro.id]);
    assert.deepStrictEqual(idsViva(b, b.cliente), [b.seguro.id]);
    assert.deepStrictEqual(idsViva(a, a.outroCliente), [a.outro.id]);
    assert.deepStrictEqual(idsViva(b, b.outroCliente), [b.outro.id]);
  } finally {
    await Promise.all([destruirCenario(a), destruirCenario(b)]);
  }
}

async function testarRepresentanteVivoFailClosed() {
  const cenario = await criarCenario("representante_vivo", { representanteVivo: true });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.workspaceHealthGuard.motivo, "remocao_simulada_nao_exata");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarWorkspaceConflitanteFailClosed() {
  const cenario = await criarCenario("workspace_conflitante", { workspaceConflitante: true });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.workspaceHealthGuard.motivo, "identidade_ou_workspace_conflitante");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    assert.deepStrictEqual(idsViva(cenario, cenario.outroCliente), [cenario.outro.id]);
  } finally { await destruirCenario(cenario); }
}

async function testarFenceNaoTerminalFailClosed() {
  const cenario = await criarCenario("fence_remove", { fenceOperation: "remove" });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.workspaceHealthGuard.motivo, "fence_nao_terminal");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarFenceTransitoriaNaoAcionaGuard() {
  const cenario = await criarCenario("fence_transitoria", { aliases: 0 });
  try {
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, true, JSON.stringify(resultado));
    assert.strictEqual(resultado.checkpointRequired, true);
    assert.strictEqual(resultado.workspaceHealthGuard, undefined);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
  } finally { await destruirCenario(cenario); }
}

async function testarAuthorityNotReadyNaoAcionaGuard() {
  const cenario = await criarCenario("authority_not_ready", { authorityReady: false });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "authority_not_ready");
    assert.strictEqual(resultado.workspaceHealthGuard, undefined);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarWorkspaceSaudavelOciosa() {
  const cenario = await criarCenario("ociosa", { aliases: 0, semFence: true });
  try {
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.checkpointRequired, false);
    assert.strictEqual(resultado.workspaceHealthGuard, undefined);
    assert.deepStrictEqual(lerJson(cenario, cenario.cliente, "automacao.json"), {
      automacaoAtiva: false
    });
  } finally { await destruirCenario(cenario); }
}

async function testarRestartEntreRemocaoECheckpoint() {
  const cenario = await criarCenario("restart_antes_checkpoint");
  try {
    const historicoAntes = historico(cenario, cenario.cliente);
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    const generationDepois = cenario.states.get(cenario.cliente).vivaGeneration;
    fila.resetarWorkspaceHealthGuardParaTeste();
    const target = await cenario.controller.capturarTargetCheckpointCoordenado(cenario.cliente, {
      expectedTargetGeneration: generationDepois,
      motivo: "restart_health_guard"
    });
    assert.strictEqual(target.ok, true);
    const retomada = await executarGuard(cenario);
    assert.strictEqual(retomada.ok, true, JSON.stringify(retomada));
    assert.strictEqual(retomada.checkpointRequired, true);
    assert.strictEqual(retomada.workspaceHealthGuard, undefined);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
  } finally { await destruirCenario(cenario); }
}

async function testarDuplaChamadaPosRemocao() {
  const cenario = await criarCenario("dupla_chamada");
  try {
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    const generation = cenario.states.get(cenario.cliente).vivaGeneration;
    const segunda = await executarGuard(cenario);
    assert.strictEqual(segunda.ok, false);
    assert.strictEqual(segunda.motivo, "authority_not_ready");
    assert.strictEqual(cenario.states.get(cenario.cliente).vivaGeneration, generation);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.strictEqual(historico(cenario, cenario.cliente).length, 1);
  } finally { await destruirCenario(cenario); }
}

async function testarProofEManifestFailClosed() {
  for (const tipo of ["proof", "manifest"]) {
    const cenario = await criarCenario(`invalid_${tipo}`);
    try {
      const antes = idsViva(cenario, cenario.cliente);
      if (tipo === "proof") {
        cenario.storage.writeClienteJson(cenario.cliente, fila.FILA_VIVA_PROOF_ARQUIVO, {
          generation: 999
        });
      } else {
        const manifest = lerJson(cenario, cenario.cliente, "fila-v2-manifest.json");
        cenario.storage.writeClienteJson(cenario.cliente, "fila-v2-manifest.json", {
          ...manifest,
          vivaGeneration: 999
        });
      }
      const resultado = await executarGuard(cenario);
      assert.strictEqual(resultado.ok, false);
      assert.strictEqual(resultado.failClosed, true);
      assert.notStrictEqual(resultado.motivo, "workspace_health_guard_checkpoint_required");
      assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    } finally { await destruirCenario(cenario); }
  }
}

async function testarIntentCorruptoFailClosed() {
  const cenario = await criarCenario("intent_corrupto");
  try {
    fs.writeFileSync(mutationIntent.caminho(cenario.root, cenario.cliente), "{invalido");
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "intent_corrupt");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function provarFalhaRecuperavel(cenario) {
  const fences = removalFence.listar(cenario.root, cenario.cliente);
  const falha = await cenario.controller.provarRecoveryRemovalFencesPendentes(
    cenario.cliente,
    fences,
    { workspaceHealthGuard: true }
  );
  assert.strictEqual(falha.motivo, "removal_fence_viva_not_covered");
  assert(falha.workspaceHealthGuardContext);
  return falha;
}

async function testarCorridaGenerationFailClosed() {
  const cenario = await criarCenario("corrida_generation");
  try {
    const falha = await provarFalhaRecuperavel(cenario);
    const antes = idsViva(cenario, cenario.cliente);
    const state = cenario.states.get(cenario.cliente);
    cenario.states.set(cenario.cliente, {
      ...state,
      revision: Number(state.revision) + 1,
      vivaGeneration: Number(state.vivaGeneration) + 1
    });

    const resultado = await cenario.controller.tentarWorkspaceHealthGuardRemovalFence(
      cenario.cliente,
      falha
    );
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "workspace_health_guard_generation_changed");
    assert.strictEqual(resultado.failClosed, true);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    assert.deepStrictEqual(cenario.mutationTypes, []);
  } finally { await destruirCenario(cenario); }
}

async function testarCorridaHashFailClosed() {
  const cenario = await criarCenario("corrida_hash");
  try {
    const falha = await provarFalhaRecuperavel(cenario);
    const vivaPath = path.join(cenario.root, "clientes", cenario.cliente, "fila-viva.json");
    const vivaConcorrente = lerJson(cenario, cenario.cliente, "fila-viva.json");
    vivaConcorrente.push(entrada({
      clienteId: cenario.cliente,
      id: "item-concorrente",
      ofertaId: 999,
      titulo: "Item inserido concorrentemente",
      preco: 30,
      status: "pendente"
    }, vivaConcorrente.length));
    fs.writeFileSync(vivaPath, JSON.stringify(vivaConcorrente, null, 2));
    const hashConcorrente = mutationIntent.hashArquivo(vivaPath);

    const resultado = await cenario.controller.tentarWorkspaceHealthGuardRemovalFence(
      cenario.cliente,
      falha
    );
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "viva_precondition_hash_mismatch");
    assert.strictEqual(resultado.failClosed, true);
    assert.strictEqual(mutationIntent.hashArquivo(vivaPath), hashConcorrente);
    assert(idsViva(cenario, cenario.cliente).includes("item-concorrente"));
    assert.deepStrictEqual(cenario.mutationTypes, ["remove"]);
  } finally { await destruirCenario(cenario); }
}

async function testarMatrizPuraFailClosed() {
  const cenario = await criarCenario("matriz_pura");
  try {
    const fences = removalFence.listar(cenario.root, cenario.cliente);
    const falha = await cenario.controller.provarRecoveryRemovalFencesPendentes(
      cenario.cliente,
      fences,
      { workspaceHealthGuard: true }
    );
    assert.strictEqual(falha.motivo, "removal_fence_viva_not_covered");
    const contexto = falha.workspaceHealthGuardContext;
    const casos = [
      {
        nome: "classe desconhecida",
        falha: { ...falha, motivo: "intent_snapshot_unknown" },
        esperado: "classe_nao_recuperavel"
      },
      {
        nome: "intent ambiguo",
        falha: { ...falha, workspaceHealthGuardContext: { ...contexto, intentAbsent: false } },
        esperado: "mutation_intent_ambiguo"
      },
      {
        nome: "cardinalidade invalida",
        falha: { ...falha, workspaceHealthGuardContext: {
          ...contexto,
          probe: { ...contexto.probe, vivaItemCount: -1 }
        } },
        esperado: "snapshot_cardinalidade_invalida"
      },
      {
        nome: "proof generation divergente",
        falha: { ...falha, workspaceHealthGuardContext: {
          ...contexto,
          vivaProof: { ...contexto.vivaProof, generation: contexto.vivaProof.generation + 1 }
        } },
        esperado: "proof_generation_incoerente"
      },
      {
        nome: "simulacao incompleta",
        falha: { ...falha, workspaceHealthGuardContext: {
          ...contexto,
          probe: { ...contexto.probe, vivaFenceRelatedCandidates: [] }
        } },
        esperado: "remocao_simulada_nao_exata"
      }
    ];
    for (const caso of casos) {
      const resultado = fila.avaliarWorkspaceHealthGuardRemovalFence(cenario.cliente, caso.falha);
      assert.strictEqual(resultado.ok, false, caso.nome);
      assert.strictEqual(resultado.motivo, caso.esperado, caso.nome);
    }
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente),
      [...cenario.aliases.map(item => item.id), cenario.seguro.id].sort());
  } finally { await destruirCenario(cenario); }
}

function percentil(valores, fracao) {
  const ordenados = valores.slice().sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil(ordenados.length * fracao) - 1)];
}

async function benchmarkGuard(totalItens) {
  const cenario = await criarCenario(`bench_${totalItens}`);
  try {
    const extras = Array.from({ length: Math.max(0, totalItens - 4) }, (_, indice) => ({
      clienteId: cenario.cliente,
      id: `bench-${totalItens}-${indice}`,
      ofertaId: 10_000 + indice,
      produtoId: `BENCH-${totalItens}-${indice}`,
      titulo: `Produto benchmark ${indice}`,
      preco: 20 + indice,
      status: "pendente"
    }));
    cenario.storage.writeClienteJson(cenario.cliente, "fila-viva.json", [
      ...cenario.aliases.map(entrada),
      entrada(cenario.seguro, 3),
      ...extras.map((item, indice) => entrada(item, indice + 4))
    ]);
    const proof = fila.publicarProofFilaViva(cenario.cliente, {
      generation: 5,
      fileRevision: `bench-${totalItens}`
    }, { ...cenario.storage, logger: cenario.logger });
    assert.strictEqual(proof.ok, true);
    cenario.states.set(cenario.cliente, {
      ...cenario.states.get(cenario.cliente),
      vivaFileProof: proof.proof
    });
    const manifest = lerJson(cenario, cenario.cliente, "fila-v2-manifest.json");
    cenario.storage.writeClienteJson(cenario.cliente, "fila-v2-manifest.json", {
      ...manifest,
      vivaFileProof: proof.proof
    });
    const fences = removalFence.listar(cenario.root, cenario.cliente);
    const recoveryMs = [];
    for (let i = 0; i < 7; i += 1) {
      const inicio = process.hrtime.bigint();
      const resultado = await cenario.controller.provarRecoveryRemovalFencesPendentes(
        cenario.cliente,
        fences,
        { workspaceHealthGuard: true }
      );
      recoveryMs.push(Number(process.hrtime.bigint() - inicio) / 1e6);
      assert.strictEqual(resultado.motivo, "removal_fence_viva_not_covered");
      assert.strictEqual(resultado.workspaceHealthGuardContext.probe.vivaItemCount, totalItens);
    }
    removalFence.limparAte(cenario.root, cenario.cliente, 5);
    const healthyMs = [];
    for (let i = 0; i < 20; i += 1) {
      const inicio = process.hrtime.bigint();
      const resultado = await executarGuard(cenario);
      healthyMs.push(Number(process.hrtime.bigint() - inicio) / 1e6);
      assert.strictEqual(resultado.ok, true);
    }
    return {
      totalItens,
      healthyP50Ms: percentil(healthyMs, 0.5),
      healthyP95Ms: percentil(healthyMs, 0.95),
      recoveryP50Ms: percentil(recoveryMs, 0.5),
      recoveryP95Ms: percentil(recoveryMs, 0.95)
    };
  } finally { await destruirCenario(cenario); }
}

function testarWiringUniversal() {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(source.includes("workspaceHealthGuard: true"));
  assert(source.includes("registrarWorkspaceHealthGuardConcluido"));
  assert(!source.includes("user_g3qkc18m"));
}

async function main() {
  await testarRecoveryUniversal("user_john_fixture");
  await testarRecoveryUniversal("user_workspace_diferente");
  await testarRecoveryUniversal("user_future_001");
  await testarRecoveryUniversal("admin");
  await testarDuasWorkspacesSimultaneas();
  await testarTerminalAmbiguoFailClosed();
  await testarRepresentanteVivoFailClosed();
  await testarWorkspaceConflitanteFailClosed();
  await testarFenceNaoTerminalFailClosed();
  await testarFenceTransitoriaNaoAcionaGuard();
  await testarAuthorityNotReadyNaoAcionaGuard();
  await testarWorkspaceSaudavelOciosa();
  await testarRestartEntreRemocaoECheckpoint();
  await testarDuplaChamadaPosRemocao();
  await testarProofEManifestFailClosed();
  await testarIntentCorruptoFailClosed();
  await testarCorridaGenerationFailClosed();
  await testarCorridaHashFailClosed();
  await testarMatrizPuraFailClosed();
  testarWiringUniversal();
  const benchmarks = [await benchmarkGuard(440), await benchmarkGuard(4400)];
  console.log(`workspace-health-guard-benchmark: ${JSON.stringify(benchmarks)}`);
  console.log("workspace-health-guard-self-healing: OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
