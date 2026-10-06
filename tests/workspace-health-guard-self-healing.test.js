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

function criarRepositorio(states, opcoes = {}) {
  const readinessCalls = [];
  const readinessWrites = [];
  return {
    states,
    readinessCalls,
    readinessWrites,
    async lerStateObservacional(cliente) { return { ok: true, state: states.get(cliente) }; },
    async prepararReadinessAutoridade(cliente, dados = {}) {
      const antes = states.get(cliente);
      readinessCalls.push({ cliente, expectedRevision: dados.expectedRevision, revision: antes.revision });
      if (opcoes.readinessFalha === true) {
        return { ok: false, ready: false, motivo: "readiness_fixture_falhou", state: antes };
      }
      if (dados.expectedRevision !== undefined && Number(dados.expectedRevision) !== Number(antes.revision)) {
        return { ok: true, ready: false, motivo: "revision_stale", state: antes };
      }
      const leitura = await dados.lerManifesto({ clienteId: cliente, state: antes });
      if (leitura?.ok !== true) return { ok: true, ready: false, motivo: leitura?.motivo || "manifest_indisponivel", state: antes };
      const atual = states.get(cliente);
      if (dados.expectedRevision !== undefined && Number(dados.expectedRevision) !== Number(atual.revision)) {
        return { ok: true, ready: false, motivo: "revision_stale", state: atual };
      }
      const depois = {
        ...atual,
        revision: Number(atual.revision) + 1,
        authorityReady: true,
        authorityReadyGeneration: Number(atual.vivaGeneration),
        authorityReadyRevision: Number(atual.revision) + 1
      };
      states.set(cliente, depois);
      readinessWrites.push({ cliente, revision: depois.revision, generation: depois.vivaGeneration });
      if (opcoes.corromperProofDepoisReadiness === true) {
        opcoes.storage.writeClienteJson(cliente, fila.FILA_VIVA_PROOF_ARQUIVO, { generation: 999 });
      }
      if (typeof opcoes.depoisReadiness === "function") {
        await opcoes.depoisReadiness({
          cliente,
          state: depois,
          states,
          root: opcoes.root,
          storage: opcoes.storage
        });
      }
      return { ok: true, ready: true, motivo: "authority_readiness_ready", state: depois };
    },
    async invalidarAuthorityReady(cliente, dados = {}) {
      const atual = states.get(cliente);
      if (dados.expectedRevision !== undefined && Number(dados.expectedRevision) !== Number(atual.revision)) {
        return { ok: true, invalidado: false, motivo: "revision_stale", state: atual };
      }
      if (dados.expectedVivaGeneration !== undefined &&
          Number(dados.expectedVivaGeneration) !== Number(atual.vivaGeneration)) {
        return { ok: true, invalidado: false, motivo: "generation_stale", state: atual };
      }
      if (atual.authorityReady !== true) {
        return { ok: true, invalidado: false, idempotente: true,
          motivo: "authority_ready_ja_invalidada", state: atual };
      }
      const depois = {
        ...atual,
        revision: Number(atual.revision) + 1,
        authorityReady: false,
        authorityReadyGeneration: null,
        authorityReadyRevision: null
      };
      states.set(cliente, depois);
      return { ok: true, invalidado: true, motivo: dados.motivo || "authority_ready_invalidada", state: depois };
    },
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
        authorityReady: false,
        authorityReadyGeneration: null,
        authorityReadyRevision: null
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
        authorityReadyGeneration: null,
        authorityReadyRevision: null,
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
    authorityReadyGeneration: opcoes.authorityReady === false ? null : 5,
    authorityReadyRevision: opcoes.authorityReady === false ? null : 5,
    pendingCheckpointRevision: null,
    pendingCheckpointTargetGeneration: null,
    pendingCheckpointStartedAt: null
  };
  const states = new Map([[cliente, state]]);
  const repo = criarRepositorio(states, { ...opcoes, root, cliente, storage });
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
  let claimChecks = 0;
  const controller = fila.criarControladorFilaOperacionalV2({
    ...storage,
    env,
    manifestStateRepository: repo,
    existeClaimAtivoWorkspace: async () => {
      claimChecks += 1;
      if (opcoes.claimQueryFalha === true) throw new Error("claim_query_fixture_falhou");
      return {
        ok: true,
        existe: opcoes.claimAtivo === true ||
          (opcoes.claimAtivoAposPrimeiraConsulta === true && claimChecks > 1)
      };
    },
    logger,
    modoPersistenciaViva: () => "worker",
    agendarMutacaoViva: payload => {
      mutationTypes.push(payload.mutationType);
      return coordinator.mutateViva({ ...payload, dataDir: root });
    },
    agendarProbeViva: async payload => {
      const resultado = await coordinator.probeVivaSnapshot({ ...payload, dataDir: root });
      if (typeof opcoes.depoisProbe === "function") {
        await opcoes.depoisProbe({ payload, resultado, root, cliente, states });
      }
      return resultado;
    }
  });
  storage.writeClienteJson(cliente, "automacao.json", { automacaoAtiva: false });
  return { root, cliente, outroCliente, terminal, aliases, representanteVivo, seguro, outro, storage,
    logger, env, states, repo, coordinator, controller, mutationTypes,
    getClaimChecks: () => claimChecks };
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

async function testarAuthorityNotReadyComRepresentantesPermaneceFailClosed() {
  const cenario = await criarCenario("authority_not_ready", { authorityReady: false });
  try {
    const antes = idsViva(cenario, cenario.cliente);
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "authority_readiness_representante_protegido_presente");
    assert.strictEqual(resultado.workspaceHealthGuard, undefined);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarAuthorityNotReadySeguroAutoRecupera() {
  const cenario = await criarCenario("authority_not_ready_seguro", { authorityReady: false, aliases: 0 });
  try {
    const historicoAntes = historico(cenario, cenario.cliente);
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.strictEqual(recovery.checkpointRequired, true);
    assert.strictEqual(recovery.motivo, "removal_fence_checkpoint_required");
    assert.strictEqual(recovery.workspaceHealthGuard, undefined);
    assert.strictEqual(recovery.workspaceHealthGuardReadiness.preparada, true);
    assert.strictEqual(cenario.states.get(cenario.cliente).authorityReady, true);
    assert.strictEqual(cenario.getClaimChecks(), 2, "classe excepcional faz duas consultas bounded de lease");
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.deepStrictEqual(lerJson(cenario, cenario.cliente, "automacao.json"), {
      automacaoAtiva: false
    });
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
    assert.deepStrictEqual(cenario.mutationTypes, []);
    await concluirCheckpoint(cenario, recovery);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 0);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), [cenario.seguro.id]);
    assert.deepStrictEqual(historico(cenario, cenario.cliente), historicoAntes);
    const eventos = cenario.logger.eventos.map(evento => evento.evento);
    assert(eventos.includes("workspace_health_guard_authority_not_ready_detected"));
    assert(eventos.includes("workspace_health_guard_authority_safe_class_proven"));
    assert(eventos.includes("workspace_health_guard_authority_readiness_prepared"));
    assert(eventos.includes("workspace_health_guard_authority_revalidation_success"));
    assert(eventos.includes("workspace_health_guard_authority_recovery_success"));
  } finally { await destruirCenario(cenario); }
}

async function testarWorkspaceSaudavelOciosa() {
  const cenario = await criarCenario("ociosa", { aliases: 0, semFence: true });
  try {
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.checkpointRequired, false);
    assert.strictEqual(resultado.workspaceHealthGuard, undefined);
    assert.strictEqual(cenario.getClaimChecks(), 0, "hot path saudavel nao consulta claims");
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
    assert.strictEqual(segunda.motivo, "authority_readiness_fence_nao_terminal");
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

function atualizarSnapshotVivaCenario(cenario, entradas, fileRevision = "authority-readiness-test") {
  cenario.storage.writeClienteJson(cenario.cliente, "fila-viva.json", entradas);
  const proof = fila.publicarProofFilaViva(cenario.cliente, {
    generation: cenario.states.get(cenario.cliente).vivaGeneration,
    fileRevision
  }, { ...cenario.storage, logger: cenario.logger });
  assert.strictEqual(proof.ok, true, JSON.stringify(proof));
  cenario.states.set(cenario.cliente, {
    ...cenario.states.get(cenario.cliente),
    vivaFileProof: proof.proof
  });
  const manifest = lerJson(cenario, cenario.cliente, "fila-v2-manifest.json");
  cenario.storage.writeClienteJson(cenario.cliente, "fila-v2-manifest.json", {
    ...manifest,
    vivaFileProof: proof.proof
  });
}

async function testarAuthorityReadinessIntentAtivoFailClosed() {
  const cenario = await criarCenario("authority_intent_ativo", { authorityReady: false, aliases: 0 });
  try {
    const vivaPath = path.join(cenario.root, "clientes", cenario.cliente, "fila-viva.json");
    const currentHash = mutationIntent.hashArquivo(vivaPath);
    mutationIntent.escrever(cenario.root, cenario.cliente, {
      schema: 1,
      clienteId: cenario.cliente,
      jobId: "authority-intent-ativo",
      expectedGeneration: 5,
      targetGeneration: 6,
      mutationType: "insert",
      previousHash: currentHash,
      targetHash: currentHash,
      fileRevision: "authority-intent-ativo",
      itemCount: 1,
      checkpointSincronizado: false,
      inputHash: mutationIntent.digest("authority-intent-ativo"),
      removalOperation: null,
      removedIdentityHashes: []
    });
    const fences = removalFence.listar(cenario.root, cenario.cliente);
    const resultado = await cenario.controller.provarAuthorityReadinessRemovalFences(
      cenario.cliente,
      fences
    );
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "authority_readiness_mutation_intent_ativo");
    assert.strictEqual(cenario.repo.readinessWrites.length, 0);
  } finally { await destruirCenario(cenario); }
}

async function testarMatrizAuthorityReadinessFailClosed() {
  const casos = [
    {
      nome: "hash_divergente",
      preparar(cenario) {
        const vivaPath = path.join(cenario.root, "clientes", cenario.cliente, "fila-viva.json");
        fs.appendFileSync(vivaPath, " ");
      },
      motivos: ["stat_mismatch"]
    },
    {
      nome: "proof_divergente",
      preparar(cenario) {
        cenario.storage.writeClienteJson(cenario.cliente, fila.FILA_VIVA_PROOF_ARQUIVO, { generation: 999 });
      },
      motivos: ["viva_proof_mismatch"]
    },
    {
      nome: "manifest_divergente",
      preparar(cenario) {
        const manifest = lerJson(cenario, cenario.cliente, "fila-v2-manifest.json");
        cenario.storage.writeClienteJson(cenario.cliente, "fila-v2-manifest.json", {
          ...manifest,
          vivaGeneration: 999
        });
      },
      motivos: ["manifest_mismatch"]
    },
    {
      nome: "db_divergente",
      preparar(cenario) {
        const state = cenario.states.get(cenario.cliente);
        cenario.states.set(cenario.cliente, { ...state, vivaGeneration: 6 });
      },
      motivos: ["manifest_mismatch"]
    },
    {
      nome: "fence_nao_terminal",
      opcoes: { fenceOperation: "remove" },
      motivos: ["authority_readiness_fence_nao_terminal"]
    },
    {
      nome: "generation_incompativel",
      preparar(cenario) {
        removalFence.limparAte(cenario.root, cenario.cliente, 99);
        removalFence.escrever(cenario.root, cenario.cliente, {
          schema: 1,
          clienteId: cenario.cliente,
          jobId: "fence-futura",
          generation: 6,
          operation: "terminal",
          identityHashes: [mutationIntent.digest("fence-futura")],
          createdAt: new Date().toISOString()
        });
      },
      motivos: ["removal_fence_generation_incoerente"]
    },
    {
      nome: "checkpoint_ambiguo",
      preparar(cenario) {
        const state = cenario.states.get(cenario.cliente);
        cenario.states.set(cenario.cliente, {
          ...state,
          pendingCheckpointRevision: "pending-parcial",
          pendingCheckpointTargetGeneration: null
        });
      },
      motivos: ["pending_ambiguo"]
    },
    {
      nome: "authority_metadata_divergente",
      preparar(cenario) {
        const state = cenario.states.get(cenario.cliente);
        cenario.states.set(cenario.cliente, {
          ...state,
          authorityReadyGeneration: state.vivaGeneration,
          authorityReadyRevision: state.revision
        });
      },
      motivos: ["authority_readiness_metadata_divergente"]
    },
    {
      nome: "claim_ativo",
      opcoes: { claimAtivo: true },
      motivos: ["authority_readiness_claim_ativo"]
    },
    {
      nome: "claim_query_falhou",
      opcoes: { claimQueryFalha: true },
      motivos: ["authority_readiness_claim_query_failed"]
    },
    {
      nome: "claim_apareceu_apos_prova",
      opcoes: { claimAtivoAposPrimeiraConsulta: true },
      motivos: ["authority_readiness_claim_ativo"],
      authorityDevePermanecerFalse: true
    },
    {
      nome: "prepare_falhou",
      opcoes: { readinessFalha: true },
      motivos: ["readiness_fixture_falhou"]
    },
    {
      nome: "revalidacao_falhou",
      opcoes: { corromperProofDepoisReadiness: true },
      motivos: ["viva_proof_mismatch"],
      authorityDevePermanecerFalse: true
    }
  ];

  for (const caso of casos) {
    const cenario = await criarCenario(`authority_${caso.nome}`, {
      authorityReady: false,
      aliases: 0,
      ...(caso.opcoes || {})
    });
    try {
      if (caso.preparar) await caso.preparar(cenario);
      const antes = idsViva(cenario, cenario.cliente);
      const resultado = await executarGuard(cenario);
      assert.strictEqual(resultado.ok, false, `${caso.nome}: ${JSON.stringify(resultado)}`);
      assert(caso.motivos.includes(resultado.motivo), `${caso.nome}: ${resultado.motivo}`);
      assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes, caso.nome);
      assert.deepStrictEqual(cenario.mutationTypes, [], caso.nome);
      if (caso.authorityDevePermanecerFalse) {
        assert.strictEqual(cenario.states.get(cenario.cliente).authorityReady, false, caso.nome);
        assert.strictEqual(resultado.workspaceHealthGuardReadiness?.invalidacao?.invalidado, true, caso.nome);
      }
    } finally { await destruirCenario(cenario); }
  }
}

async function testarCorridasAuthorityReadinessFailClosed() {
  let stateMudou = false;
  const stateRace = await criarCenario("authority_state_race", {
    authorityReady: false,
    aliases: 0,
    depoisProbe({ states, cliente }) {
      if (stateMudou) return;
      stateMudou = true;
      const state = states.get(cliente);
      states.set(cliente, { ...state, revision: state.revision + 1 });
    }
  });
  try {
    const resultado = await executarGuard(stateRace);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "authority_readiness_state_changed");
    assert.strictEqual(stateRace.repo.readinessWrites.length, 0);
  } finally { await destruirCenario(stateRace); }

  let fenceMudou = false;
  const fenceRace = await criarCenario("authority_fence_race", {
    authorityReady: false,
    aliases: 0,
    depoisProbe({ root, cliente }) {
      if (fenceMudou) return;
      fenceMudou = true;
      removalFence.escrever(root, cliente, {
        schema: 1,
        clienteId: cliente,
        jobId: "fence-concorrente",
        generation: 5,
        operation: "terminal",
        identityHashes: [mutationIntent.digest("fence-concorrente")],
        createdAt: new Date().toISOString()
      });
    }
  });
  try {
    const resultado = await executarGuard(fenceRace);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "authority_readiness_fence_changed");
    assert.strictEqual(fenceRace.repo.readinessWrites.length, 0);
  } finally { await destruirCenario(fenceRace); }
}

async function testarCorridasDepoisDoPrepareAuthorityReadiness() {
  const casos = [
    {
      nome: "intent_apareceu",
      esperado: "intent_invalid",
      depoisReadiness({ root, cliente }) {
        fs.writeFileSync(mutationIntent.caminho(root, cliente), "{}");
      }
    },
    {
      nome: "fence_mudou",
      esperado: "authority_readiness_fence_changed",
      depoisReadiness({ root, cliente }) {
        removalFence.escrever(root, cliente, {
          schema: 1,
          clienteId: cliente,
          jobId: "fence-pos-readiness",
          generation: 5,
          operation: "terminal",
          identityHashes: [mutationIntent.digest("fence-pos-readiness")],
          createdAt: new Date().toISOString()
        });
      }
    },
    {
      nome: "representante_reapareceu",
      esperado: "removal_fence_viva_not_covered",
      depoisReadiness({ root, cliente, states, storage }) {
        const atual = JSON.parse(fs.readFileSync(path.join(root, "clientes", cliente, "fila-viva.json"), "utf8"));
        const terminal = {
          clienteId: cliente,
          id: "representante-pos-readiness",
          ofertaId: 100,
          produtoId: "MLB-HEALTH-100",
          linkOriginal: "https://produto.exemplo/health-100",
          titulo: "Produto Health Guard",
          preco: 99.9,
          status: "pendente"
        };
        atualizarSnapshotVivaCenario({
          root,
          cliente,
          states,
          storage,
          logger: criarLogger()
        }, [...atual, entrada(terminal, atual.length)], "representante-pos-readiness");
      }
    },
    {
      nome: "generation_mudou",
      esperado: "authority_readiness_state_changed",
      depoisReadiness({ cliente, states }) {
        const atual = states.get(cliente);
        states.set(cliente, {
          ...atual,
          revision: atual.revision + 1,
          vivaGeneration: atual.vivaGeneration + 1,
          dirtyGeneration: atual.dirtyGeneration || atual.durableCheckpointGeneration + 1,
          authorityReady: false,
          authorityReadyGeneration: null,
          authorityReadyRevision: null
        });
      }
    },
    {
      nome: "checkpoint_apareceu",
      esperado: "authority_readiness_state_changed",
      depoisReadiness({ cliente, states }) {
        const atual = states.get(cliente);
        states.set(cliente, {
          ...atual,
          revision: atual.revision + 1,
          pendingCheckpointRevision: "checkpoint-concorrente",
          pendingCheckpointTargetGeneration: atual.vivaGeneration,
          authorityReady: false,
          authorityReadyGeneration: null,
          authorityReadyRevision: null
        });
      }
    }
  ];

  for (const caso of casos) {
    const cenario = await criarCenario(`authority_pos_prepare_${caso.nome}`, {
      authorityReady: false,
      aliases: 0,
      depoisReadiness: caso.depoisReadiness
    });
    try {
      const resultado = await executarGuard(cenario);
      assert.strictEqual(resultado.ok, false, `${caso.nome}: ${JSON.stringify(resultado)}`);
      assert.strictEqual(resultado.motivo, caso.esperado, caso.nome);
      assert.strictEqual(cenario.states.get(cenario.cliente).authorityReady, false, caso.nome);
      assert.deepStrictEqual(cenario.mutationTypes, [], caso.nome);
    } finally { await destruirCenario(cenario); }
  }
}

async function testarMultiplosFencesAuthorityReadiness() {
  const cenario = await criarCenario("authority_multiplos_fences", { authorityReady: false, aliases: 0 });
  try {
    removalFence.escrever(cenario.root, cenario.cliente, {
      schema: 1,
      clienteId: cenario.cliente,
      jobId: "terminal-adicional",
      generation: 5,
      operation: "terminal",
      identityHashes: [mutationIntent.digest("terminal-adicional")],
      createdAt: new Date().toISOString()
    });
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.strictEqual(recovery.checkpointRequired, true);
    assert.strictEqual(cenario.repo.readinessWrites.length, 1);
    await concluirCheckpoint(cenario, recovery);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 0);
  } finally { await destruirCenario(cenario); }
}

async function testarAusenciaFenceNaoPreparaReadiness() {
  const cenario = await criarCenario("authority_sem_fence", {
    authorityReady: false,
    aliases: 0,
    semFence: true
  });
  try {
    const resultado = await executarGuard(cenario);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.checkpointRequired, false);
    assert.strictEqual(cenario.repo.readinessCalls.length, 0);
    assert.strictEqual(cenario.states.get(cenario.cliente).authorityReady, false);
  } finally { await destruirCenario(cenario); }
}

async function testarConcorrenciaAuthorityReadiness() {
  const cenario = await criarCenario("authority_concorrente", { authorityReady: false, aliases: 0 });
  try {
    const resultados = await Promise.all([executarGuard(cenario), executarGuard(cenario)]);
    const sucessos = resultados.filter(resultado => resultado.ok === true);
    const recusados = resultados.filter(resultado => resultado.ok !== true);
    assert.strictEqual(sucessos.length, 1, JSON.stringify(resultados));
    assert.strictEqual(recusados.length, 1, JSON.stringify(resultados));
    assert.strictEqual(sucessos[0].checkpointRequired, true);
    assert.notStrictEqual(recusados[0].checkpointRequired, true,
      "somente o vencedor pode seguir para checkpoint");
    assert(["authority_readiness_state_changed", "revision_stale"].includes(recusados[0].motivo),
      JSON.stringify(recusados[0]));
    assert.strictEqual(cenario.repo.readinessWrites.length, 1);
    await concluirCheckpoint(cenario, sucessos[0]);
    const observador = await executarGuard(cenario);
    assert.strictEqual(observador.ok, true, JSON.stringify(observador));
    assert.strictEqual(observador.checkpointRequired, false);
    assert.strictEqual(removalFence.listar(cenario.root, cenario.cliente).length, 0);
  } finally { await destruirCenario(cenario); }
}

async function confirmarCheckpointSemReconciliar(cenario, recovery) {
  const target = await cenario.controller.capturarTargetCheckpointCoordenado(cenario.cliente, {
    expectedTargetGeneration: recovery.targetGeneration,
    motivo: "authority_restart_test"
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
    motivo: "authority_restart_test",
    publicarCheckpoint: ({ targetGeneration, checkpointRevision }) => cenario.coordinator.publish({
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
  return confirmado;
}

async function testarRestartIdempotenteAuthorityReadiness() {
  const aposPrepare = await criarCenario("authority_restart_prepare", { authorityReady: false, aliases: 0 });
  try {
    const state = aposPrepare.states.get(aposPrepare.cliente);
    const readiness = await aposPrepare.controller.prepararReadinessAutoridadeRecovery(aposPrepare.cliente, {
      expectedRevision: state.revision
    });
    assert.strictEqual(readiness.ready, true);
    fila.resetarWorkspaceHealthGuardParaTeste();
    const recovery = await executarGuard(aposPrepare);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.strictEqual(recovery.checkpointRequired, true);
    await concluirCheckpoint(aposPrepare, recovery);
  } finally { await destruirCenario(aposPrepare); }

  const aposCheckpoint = await criarCenario("authority_restart_checkpoint", { authorityReady: false, aliases: 0 });
  try {
    const recovery = await executarGuard(aposCheckpoint);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    await confirmarCheckpointSemReconciliar(aposCheckpoint, recovery);
    fila.resetarWorkspaceHealthGuardParaTeste();
    const reconciliado = await executarGuard(aposCheckpoint);
    assert.strictEqual(reconciliado.ok, true, JSON.stringify(reconciliado));
    assert.strictEqual(reconciliado.checkpointRequired, false);
    assert.strictEqual(removalFence.listar(aposCheckpoint.root, aposCheckpoint.cliente).length, 0);
    const repetido = await executarGuard(aposCheckpoint);
    assert.strictEqual(repetido.ok, true);
    assert.strictEqual(repetido.checkpointRequired, false);
  } finally { await destruirCenario(aposCheckpoint); }

  const aposFence = await criarCenario("authority_restart_fence", { authorityReady: false, aliases: 0 });
  try {
    const recovery = await executarGuard(aposFence);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    await concluirCheckpoint(aposFence, recovery);
    assert.strictEqual(removalFence.listar(aposFence.root, aposFence.cliente).length, 0);
    fila.resetarWorkspaceHealthGuardParaTeste();
    const antesDeMarcarFilaInicializada = await executarGuard(aposFence);
    assert.strictEqual(antesDeMarcarFilaInicializada.ok, true, JSON.stringify(antesDeMarcarFilaInicializada));
    assert.strictEqual(antesDeMarcarFilaInicializada.checkpointRequired, false);
    assert.strictEqual(aposFence.repo.readinessWrites.length, 1,
      "restart apos reconcile nao repete readiness");
  } finally { await destruirCenario(aposFence); }
}

async function testarDuplicidadePreexistentePreservada() {
  const cenario = await criarCenario("authority_duplicidade", { authorityReady: false, aliases: 0 });
  try {
    const duplicado = entrada({ ...cenario.seguro }, 1);
    atualizarSnapshotVivaCenario(cenario, [entrada(cenario.seguro, 0), duplicado], "authority-duplicate");
    const antes = idsViva(cenario, cenario.cliente);
    assert.strictEqual(antes.length, 2);
    const recovery = await executarGuard(cenario);
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
    assert.deepStrictEqual(cenario.mutationTypes, []);
    await concluirCheckpoint(cenario, recovery);
    assert.deepStrictEqual(idsViva(cenario, cenario.cliente), antes);
  } finally { await destruirCenario(cenario); }
}

async function testarMatrizMultiworkspaceAuthorityReadiness() {
  const seguraA = await criarCenario("authority_workspace_a", { cliente: "user_diego_fixture", authorityReady: false, aliases: 0 });
  const saudavelB = await criarCenario("authority_workspace_b", { cliente: "user_saudavel_b", aliases: 0, semFence: true });
  const divergenteC = await criarCenario("authority_workspace_c", { cliente: "user_hash_c", authorityReady: false, aliases: 0 });
  const intentD = await criarCenario("authority_workspace_d", { cliente: "user_intent_d", authorityReady: false, aliases: 0 });
  try {
    fs.appendFileSync(path.join(divergenteC.root, "clientes", divergenteC.cliente, "fila-viva.json"), " ");
    fs.writeFileSync(mutationIntent.caminho(intentD.root, intentD.cliente), "{invalido");
    const [a, b, c, d] = await Promise.all([
      executarGuard(seguraA),
      executarGuard(saudavelB),
      executarGuard(divergenteC),
      executarGuard(intentD)
    ]);
    assert.strictEqual(a.ok, true, JSON.stringify(a));
    assert.strictEqual(a.checkpointRequired, true);
    assert.strictEqual(b.ok, true, JSON.stringify(b));
    assert.strictEqual(b.workspaceHealthGuardReadiness, undefined);
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.motivo, "stat_mismatch");
    assert.strictEqual(d.ok, false);
    assert.strictEqual(d.motivo, "intent_corrupt");
    assert.strictEqual(seguraA.repo.readinessWrites.length, 1);
    assert.strictEqual(saudavelB.repo.readinessWrites.length, 0);
    assert.strictEqual(divergenteC.repo.readinessWrites.length, 0);
    assert.strictEqual(intentD.repo.readinessWrites.length, 0);
  } finally {
    await Promise.all([seguraA, saudavelB, divergenteC, intentD].map(destruirCenario));
  }
}

async function testarDuasWorkspacesSegurasAuthorityReadiness() {
  const a = await criarCenario("authority_dupla_segura_a", {
    cliente: "user_authority_segura_a",
    authorityReady: false,
    aliases: 0
  });
  const b = await criarCenario("authority_dupla_segura_b", {
    cliente: "user_authority_segura_b",
    authorityReady: false,
    aliases: 0
  });
  try {
    const [ra, rb] = await Promise.all([executarGuard(a), executarGuard(b)]);
    assert.strictEqual(ra.ok, true, JSON.stringify(ra));
    assert.strictEqual(rb.ok, true, JSON.stringify(rb));
    assert.strictEqual(ra.checkpointRequired, true);
    assert.strictEqual(rb.checkpointRequired, true);
    assert.strictEqual(a.repo.readinessWrites.length, 1);
    assert.strictEqual(b.repo.readinessWrites.length, 1);
    assert.strictEqual(a.states.has(b.cliente), false);
    assert.strictEqual(b.states.has(a.cliente), false);
  } finally {
    await Promise.all([a, b].map(destruirCenario));
  }
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

async function benchmarkAuthorityReadiness(totalItens) {
  const tempos = [];
  for (let rodada = 0; rodada < 7; rodada += 1) {
    const cenario = await criarCenario(`authority_bench_${totalItens}_${rodada}`, {
      authorityReady: false,
      aliases: 0
    });
    try {
      const extras = Array.from({ length: Math.max(0, totalItens - 1) }, (_, indice) => entrada({
        clienteId: cenario.cliente,
        id: `authority-bench-${totalItens}-${rodada}-${indice}`,
        ofertaId: 50_000 + indice,
        produtoId: `AUTH-BENCH-${totalItens}-${rodada}-${indice}`,
        titulo: `Produto authority benchmark ${indice}`,
        preco: 30 + indice,
        status: "pendente"
      }, indice + 1));
      atualizarSnapshotVivaCenario(cenario, [entrada(cenario.seguro, 0), ...extras],
        `authority-bench-${totalItens}-${rodada}`);
      const inicio = process.hrtime.bigint();
      const resultado = await executarGuard(cenario);
      tempos.push(Number(process.hrtime.bigint() - inicio) / 1e6);
      assert.strictEqual(resultado.ok, true, JSON.stringify(resultado));
      assert.strictEqual(resultado.checkpointRequired, true);
      assert.strictEqual(cenario.repo.readinessWrites.length, 1);
    } finally { await destruirCenario(cenario); }
  }
  return {
    totalItens,
    authorityP50Ms: percentil(tempos, 0.5),
    authorityP95Ms: percentil(tempos, 0.95)
  };
}

function testarWiringUniversal() {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(source.includes("workspaceHealthGuard: true"));
  assert(source.includes("registrarWorkspaceHealthGuardConcluido"));
  assert(!source.includes("user_g3qkc18m"));
  const inicio = source.indexOf("async function garantirFilaClienteInicializada");
  const reconciliar = source.indexOf("reconciliarIntentMutacaoViva(cliente", inicio);
  const checkpoint = source.indexOf("concluirRecoveryRemovalFencePendente(cliente", reconciliar);
  const carregar = source.indexOf("carregarFila(cliente", checkpoint);
  assert(inicio >= 0 && reconciliar > inicio && checkpoint > reconciliar && carregar > checkpoint,
    "inicializacao preserva reconcile -> checkpoint oficial -> carregar fila");
}

async function main() {
  const rssAntes = process.memoryUsage().rss;
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
  await testarAuthorityNotReadyComRepresentantesPermaneceFailClosed();
  await testarAuthorityNotReadySeguroAutoRecupera();
  await testarWorkspaceSaudavelOciosa();
  await testarRestartEntreRemocaoECheckpoint();
  await testarDuplaChamadaPosRemocao();
  await testarProofEManifestFailClosed();
  await testarIntentCorruptoFailClosed();
  await testarCorridaGenerationFailClosed();
  await testarCorridaHashFailClosed();
  await testarMatrizPuraFailClosed();
  await testarAuthorityReadinessIntentAtivoFailClosed();
  await testarMatrizAuthorityReadinessFailClosed();
  await testarCorridasAuthorityReadinessFailClosed();
  await testarCorridasDepoisDoPrepareAuthorityReadiness();
  await testarMultiplosFencesAuthorityReadiness();
  await testarAusenciaFenceNaoPreparaReadiness();
  await testarConcorrenciaAuthorityReadiness();
  await testarRestartIdempotenteAuthorityReadiness();
  await testarDuplicidadePreexistentePreservada();
  await testarMatrizMultiworkspaceAuthorityReadiness();
  await testarDuasWorkspacesSegurasAuthorityReadiness();
  testarWiringUniversal();
  const benchmarks = [await benchmarkGuard(440), await benchmarkGuard(4400)];
  const authorityBenchmarks = [
    await benchmarkAuthorityReadiness(440),
    await benchmarkAuthorityReadiness(4400)
  ];
  console.log(`workspace-health-guard-benchmark: ${JSON.stringify(benchmarks)}`);
  console.log(`workspace-health-guard-authority-benchmark: ${JSON.stringify(authorityBenchmarks)}`);
  console.log(`workspace-health-guard-memory: ${JSON.stringify({
    rssAntes,
    rssDepois: process.memoryUsage().rss,
    heapUsedDepois: process.memoryUsage().heapUsed
  })}`);
  console.log("workspace-health-guard-self-healing: OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
