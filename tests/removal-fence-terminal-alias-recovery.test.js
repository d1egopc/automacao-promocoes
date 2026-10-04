"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fila = require("../modules/fila/fila-operacional-v2");
const removalFence = require("../modules/fila/viva-removal-fence");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const quiet = { log() {}, warn() {} };

function criarStorage(root) {
  return {
    getClienteJsonPath(cliente, nome) {
      return path.join(root, "clientes", cliente, nome);
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

function criarRepositorio(cliente, inicial) {
  const states = new Map([[cliente, inicial]]);
  return {
    states,
    async lerStateObservacional(id) {
      return { ok: true, state: states.get(id) };
    },
    async registrarMutacaoDuravel(id, dados) {
      const antes = states.get(id);
      const nextGeneration = Number(antes.vivaGeneration) + 1;
      const escrita = await dados.escreverArquivo({
        state: antes,
        nextGeneration,
        fileRevision: dados.fileRevision
      });
      if (escrita?.ok !== true) {
        return { ok: false, motivo: escrita?.motivo || "writer_failed", state: antes };
      }
      const depois = {
        ...antes,
        revision: Number(antes.revision) + 1,
        vivaGeneration: nextGeneration,
        dirtyGeneration: antes.dirtyGeneration || Number(antes.durableCheckpointGeneration) + 1,
        vivaFileProof: escrita.vivaFileProof,
        authorityReady: false
      };
      states.set(id, depois);
      return { ok: true, state: depois };
    },
    async capturarTargetCheckpoint(id, dados) {
      const antes = states.get(id);
      const checkpointRevision = dados.checkpointRevision || "checkpoint-alias-recovery";
      const depois = {
        ...antes,
        authorityReady: false,
        pendingCheckpointRevision: checkpointRevision,
        pendingCheckpointTargetGeneration: antes.vivaGeneration,
        pendingCheckpointStartedAt: new Date(2000).toISOString()
      };
      states.set(id, depois);
      return {
        ok: true,
        clienteId: id,
        checkpointRevision,
        targetGeneration: antes.vivaGeneration,
        state: depois
      };
    },
    async confirmarCheckpointDuravel(id, dados) {
      const antes = states.get(id);
      const publicado = await dados.publicarCheckpoint({
        clienteId: id,
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
        pendingCheckpointRevision: null,
        pendingCheckpointTargetGeneration: null,
        pendingCheckpointStartedAt: null,
        authorityReady: false
      };
      states.set(id, depois);
      return { ok: true, state: depois, legacyFileProof: publicado.legacyFileProof };
    }
  };
}

function idsViva(root, cliente) {
  const file = path.join(root, "clientes", cliente, "fila-viva.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).map(entrada => entrada.id).sort();
}

function lerJson(root, cliente, nome) {
  return JSON.parse(fs.readFileSync(path.join(root, "clientes", cliente, nome), "utf8"));
}

function linhasHistorico(root, cliente) {
  const dir = path.join(root, "clientes", cliente, "fila-historico-incremental");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(nome => nome.endsWith(".jsonl"))
    .flatMap(nome => fs.readFileSync(path.join(dir, nome), "utf8").trim().split("\n").filter(Boolean));
}

async function concluirCheckpointRemovalFence({ cliente, controller, coordinator, root }) {
  const bloqueadoSemTarget = await controller.reconciliarIntentMutacaoViva(cliente, {
    recoveryRemovalFenceCheckpoint: true
  });
  assert.strictEqual(bloqueadoSemTarget.ok, false, JSON.stringify(bloqueadoSemTarget));
  assert.strictEqual(bloqueadoSemTarget.motivo, "authority_not_ready");
  assert.strictEqual(bloqueadoSemTarget.failClosed, true);

  const target = await controller.capturarTargetCheckpointCoordenado(cliente, {
    expectedTargetGeneration: lerJson(root, cliente, fila.FILA_VIVA_PROOF_ARQUIVO).generation,
    motivo: "checkpoint_workspace_nova"
  });
  assert.strictEqual(target.ok, true, JSON.stringify(target));
  const recovery = await controller.reconciliarIntentMutacaoViva(cliente, {
    recoveryRemovalFenceCheckpoint: true
  });
  assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
  assert.strictEqual(recovery.checkpointRequired, true);
  const prepared = await coordinator.prepare({
    clienteId: cliente,
    checkpointRevision: target.checkpointRevision,
    targetGeneration: target.targetGeneration,
    expectedVivaHash: recovery.expectedVivaHash,
    dataDir: root,
    persistenceMode: "worker"
  });
  assert.strictEqual(prepared.ok, true, JSON.stringify(prepared));
  const confirmado = await controller.confirmarCheckpointCoordenado(cliente, {
    targetGeneration: target.targetGeneration,
    checkpointRevision: target.checkpointRevision,
    motivo: "checkpoint_workspace_nova",
    publicarCheckpoint: ({ targetGeneration, checkpointRevision }) => coordinator.publish({
      clienteId: cliente,
      checkpointRevision,
      targetGeneration,
      dataDir: root,
      tempIdentity: prepared.tempIdentity,
      expectedSourceRevisions: prepared.sourceRevisions,
      persistenceMode: "worker"
    })
  });
  assert.strictEqual(confirmado.ok, true, JSON.stringify(confirmado));

  const restart = await controller.reconciliarIntentMutacaoViva(cliente, {
    recoveryRemovalFenceCheckpoint: true
  });
  assert.strictEqual(restart.ok, true, JSON.stringify(restart));
  assert.strictEqual(restart.checkpointRequired, false);
  assert.strictEqual(removalFence.listar(root, cliente).length, 0);
  return restart;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-terminal-alias-recovery-"));
  const cliente = "user_john_fixture";
  const outroCliente = "user_outro_workspace";
  const storage = criarStorage(root);
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global",
    FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_RECOVERY_AUTORIDADE: "generation"
  };
  const comum = {
    clienteId: cliente,
    produtoId: "MLB-PRODUTO-COMUM",
    linkOriginal: "https://produto.exemplo/item-comum",
    titulo: "Produto compartilhado",
    preco: 99.9,
    status: "pendente"
  };
  const alvo = { ...comum, id: "engine_83135", ofertaId: 83135 };
  const aliasTituloPreco = {
    clienteId: cliente,
    id: "engine_83120",
    ofertaId: 83120,
    titulo: comum.titulo,
    preco: comum.preco,
    status: "pendente"
  };
  const aliasLink = {
    clienteId: cliente,
    id: "engine_83130",
    ofertaId: 83130,
    linkOriginal: comum.linkOriginal,
    titulo: comum.titulo,
    preco: comum.preco,
    status: "pendente"
  };
  const seguro = {
    clienteId: cliente,
    id: "item-seguro",
    ofertaId: 90000,
    titulo: "Item independente",
    preco: 10,
    status: "pendente"
  };
  const outro = { ...alvo, clienteId: outroCliente };
  let coordinator;
  try {
    const entradas = [alvo, aliasTituloPreco, aliasLink, seguro].map((item, posicaoLegada) => ({
      id: item.id,
      item,
      bucket: "viva",
      status: item.status,
      posicaoLegada
    }));
    storage.writeClienteJson(cliente, "fila.json", [alvo, aliasTituloPreco, aliasLink, seguro]);
    storage.writeClienteJson(cliente, "fila-viva.json", entradas);
    storage.writeClienteJson(outroCliente, "fila.json", [outro]);
    storage.writeClienteJson(outroCliente, "fila-viva.json", [{
      id: outro.id,
      item: outro,
      bucket: "viva",
      status: outro.status,
      posicaoLegada: 0
    }]);
    const proof = fila.publicarProofFilaViva(cliente, {
      generation: 1,
      fileRevision: "baseline-alias"
    }, { ...storage, logger: quiet });
    assert.strictEqual(proof.ok, true);
    const estadoInicial = {
      revision: 1,
      vivaGeneration: 1,
      durableCheckpointGeneration: 0,
      dirtyGeneration: 1,
      vivaFileProof: proof.proof,
      legacyFileProof: null,
      authorityReady: true,
      authorityReadyGeneration: 1,
      authorityReadyRevision: 1,
      pendingCheckpointRevision: null,
      pendingCheckpointTargetGeneration: null,
      pendingCheckpointStartedAt: null
    };
    const repo = criarRepositorio(cliente, estadoInicial);
    storage.writeClienteJson(cliente, "fila-v2-manifest.json", {
      version: 2,
      manifestVersion: 2,
      clienteId: cliente,
      vivaGeneration: 1,
      durableCheckpointGeneration: 0,
      dirtyGeneration: 1,
      vivaFileProof: proof.proof
    });
    coordinator = criarCoordenadorPersistencia({ env, logger: quiet });
    const controller = fila.criarControladorFilaOperacionalV2({
      ...storage,
      env,
      manifestStateRepository: repo,
      logger: quiet,
      modoPersistenciaViva: () => "worker",
      agendarMutacaoViva: payload => coordinator.mutateViva({ ...payload, dataDir: root }),
      agendarProbeViva: payload => coordinator.probeVivaSnapshot({ ...payload, dataDir: root })
    });

    const terminal = {
      ...alvo,
      status: "expirado",
      expiradoEm: new Date(1000).toISOString()
    };
    const mutacao = await controller.atualizarItemFilaVivaCoordenado(cliente, terminal, {
      agora: 1000,
      exigirMutacao: true
    });
    assert.strictEqual(mutacao.ok, true, JSON.stringify(mutacao));
    assert.strictEqual(removalFence.listar(root, cliente).length, 1);
    assert.deepStrictEqual(idsViva(root, cliente), [seguro.id]);
    assert.strictEqual(lerJson(root, cliente, fila.FILA_VIVA_PROOF_ARQUIVO).generation, 2);
    assert.strictEqual(repo.states.get(cliente).vivaGeneration, 2);
    assert.strictEqual(repo.states.get(cliente).durableCheckpointGeneration, 0);
    assert.strictEqual(repo.states.get(cliente).authorityReady, false);
    assert.deepStrictEqual(idsViva(root, outroCliente), [outro.id]);
    assert.strictEqual(linhasHistorico(root, cliente).length, 1);

    const targetInterrompido = await controller.capturarTargetCheckpointCoordenado(cliente, {
      expectedTargetGeneration: 2,
      motivo: "checkpoint_interrompido_antes_do_restart"
    });
    assert.strictEqual(targetInterrompido.ok, true);

    const recovery = await controller.reconciliarIntentMutacaoViva(cliente, {
      recoveryRemovalFenceCheckpoint: true
    });
    assert.strictEqual(recovery.ok, true, JSON.stringify(recovery));
    assert.deepStrictEqual(idsViva(root, cliente), [seguro.id]);
    assert.strictEqual(recovery.checkpointRequired, true);
    assert.strictEqual(recovery.targetGeneration, 2);

    const target = targetInterrompido;
    const prepared = await coordinator.prepare({
      clienteId: cliente,
      checkpointRevision: target.checkpointRevision,
      targetGeneration: target.targetGeneration,
      expectedVivaHash: recovery.expectedVivaHash,
      dataDir: root,
      persistenceMode: "worker"
    });
    assert.strictEqual(prepared.ok, true, JSON.stringify(prepared));
    const confirmado = await controller.confirmarCheckpointCoordenado(cliente, {
      targetGeneration: target.targetGeneration,
      checkpointRevision: target.checkpointRevision,
      motivo: "recovery_terminal_alias",
      publicarCheckpoint: ({ targetGeneration, checkpointRevision }) => coordinator.publish({
        clienteId: cliente,
        checkpointRevision,
        targetGeneration,
        dataDir: root,
        tempIdentity: prepared.tempIdentity,
        expectedSourceRevisions: prepared.sourceRevisions,
        persistenceMode: "worker"
      })
    });
    assert.strictEqual(confirmado.ok, true, JSON.stringify(confirmado));
    const final = await controller.reconciliarIntentMutacaoViva(cliente, {
      recoveryRemovalFenceCheckpoint: true
    });
    assert.strictEqual(final.ok, true, JSON.stringify(final));
    assert.strictEqual(final.checkpointRequired, false);
    assert.strictEqual(removalFence.listar(root, cliente).length, 0);
    assert.deepStrictEqual(idsViva(root, cliente), [seguro.id]);
    assert.deepStrictEqual(lerJson(root, cliente, "fila.json").map(item => item.id), [seguro.id]);
    assert.strictEqual(linhasHistorico(root, cliente).length, 1);
    assert.strictEqual(repo.states.get(cliente).durableCheckpointGeneration, 2);

    const replay = await controller.reconciliarIntentMutacaoViva(cliente, {
      recoveryRemovalFenceCheckpoint: true
    });
    assert.strictEqual(replay.ok, true, JSON.stringify(replay));
    assert.strictEqual(replay.checkpointRequired, false);
    assert.strictEqual(removalFence.listar(root, cliente).length, 0);
    assert.deepStrictEqual(idsViva(root, cliente), [seguro.id]);
    assert.deepStrictEqual(lerJson(root, cliente, "fila.json").map(item => item.id), [seguro.id]);
    assert.strictEqual(linhasHistorico(root, cliente).length, 1);

    const clienteNovo = "user_workspace_nova_saudavel";
    storage.writeClienteJson(clienteNovo, "fila.json", []);
    storage.writeClienteJson(clienteNovo, "fila-viva.json", []);
    const proofInicialNovo = fila.publicarProofFilaViva(clienteNovo, {
      generation: 0,
      fileRevision: "workspace-nova-inicial"
    }, { ...storage, logger: quiet });
    assert.strictEqual(proofInicialNovo.ok, true);
    const estadoNovo = {
      revision: 0,
      vivaGeneration: 0,
      durableCheckpointGeneration: 0,
      dirtyGeneration: null,
      vivaFileProof: proofInicialNovo.proof,
      legacyFileProof: null,
      authorityReady: true,
      authorityReadyGeneration: 0,
      authorityReadyRevision: 0,
      pendingCheckpointRevision: null,
      pendingCheckpointTargetGeneration: null,
      pendingCheckpointStartedAt: null
    };
    repo.states.set(clienteNovo, estadoNovo);
    storage.writeClienteJson(clienteNovo, "fila-v2-manifest.json", {
      version: 2,
      manifestVersion: 2,
      clienteId: clienteNovo,
      vivaGeneration: 0,
      durableCheckpointGeneration: 0,
      dirtyGeneration: null,
      vivaFileProof: proofInicialNovo.proof
    });

    const inicializacaoNova = await controller.reconciliarIntentMutacaoViva(clienteNovo, {
      recoveryRemovalFenceCheckpoint: true
    });
    assert.strictEqual(inicializacaoNova.ok, true, JSON.stringify(inicializacaoNova));
    assert.strictEqual(inicializacaoNova.checkpointRequired, false);

    const primeira = {
      clienteId: clienteNovo,
      id: "primeira-oferta",
      ofertaId: 100001,
      produtoId: "MLB-WORKSPACE-NOVA-1",
      linkOriginal: "https://produto.exemplo/workspace-nova-1",
      titulo: "Primeira oferta workspace nova",
      preco: 49.9,
      status: "pendente"
    };
    const insercaoPrimeira = await controller.inserirItemFilaVivaCoordenado(clienteNovo, primeira, {
      agora: 2000
    });
    assert.strictEqual(insercaoPrimeira.ok, true, JSON.stringify(insercaoPrimeira));

    const aliasesPrimeira = [
      { ...primeira, id: "primeira-alias-link", ofertaId: 100002, produtoId: "" },
      { clienteId: clienteNovo, id: "primeira-alias-titulo", ofertaId: 100003,
        titulo: primeira.titulo, preco: primeira.preco, status: "pendente" }
    ];
    const vivaPrimeira = lerJson(root, clienteNovo, "fila-viva.json");
    storage.writeClienteJson(clienteNovo, "fila-viva.json", [
      ...vivaPrimeira,
      ...aliasesPrimeira.map((item, indice) => ({
        id: item.id,
        item,
        bucket: "viva",
        status: item.status,
        posicaoLegada: vivaPrimeira.length + indice
      }))
    ]);
    const proofComAliases = fila.publicarProofFilaViva(clienteNovo, {
      generation: 1,
      fileRevision: "workspace-nova-aliases"
    }, { ...storage, logger: quiet });
    assert.strictEqual(proofComAliases.ok, true);
    repo.states.set(clienteNovo, {
      ...repo.states.get(clienteNovo),
      vivaFileProof: proofComAliases.proof
    });
    storage.writeClienteJson(clienteNovo, "fila-v2-manifest.json", {
      version: 2,
      manifestVersion: 2,
      clienteId: clienteNovo,
      vivaGeneration: 1,
      durableCheckpointGeneration: 0,
      dirtyGeneration: 1,
      vivaFileProof: proofComAliases.proof
    });

    const primeiroProcessando = await controller.atualizarItemFilaVivaCoordenado(clienteNovo, {
      ...primeira,
      status: "processando"
    }, { agora: 2001, exigirMutacao: true });
    assert.strictEqual(primeiroProcessando.ok, true, JSON.stringify(primeiroProcessando));
    const primeiroEnviado = await controller.atualizarItemFilaVivaCoordenado(clienteNovo, {
      ...primeira,
      status: "enviado",
      enviadoEm: new Date(2002).toISOString(),
      providerMessageId: "msg-primeira"
    }, { agora: 2002, exigirMutacao: true });
    assert.strictEqual(primeiroEnviado.ok, true, JSON.stringify(primeiroEnviado));
    assert.strictEqual(lerJson(root, clienteNovo, "fila-viva.json")[0].item.status, "enviado");
    const primeiroTerminal = await controller.atualizarItemFilaVivaCoordenado(clienteNovo, {
      ...primeira,
      status: "enviado",
      enviadoEm: new Date(2002).toISOString(),
      providerMessageId: "msg-primeira"
    }, { agora: 7_203_000, exigirMutacao: true });
    assert.strictEqual(primeiroTerminal.ok, true, JSON.stringify(primeiroTerminal));
    assert.deepStrictEqual(idsViva(root, clienteNovo), []);
    assert.strictEqual(linhasHistorico(root, clienteNovo).length, 1);
    assert.strictEqual(removalFence.listar(root, clienteNovo).length, 1);
    await concluirCheckpointRemovalFence({ cliente: clienteNovo, controller, coordinator, root });

    const segunda = {
      clienteId: clienteNovo,
      id: "segunda-oferta",
      ofertaId: 100004,
      produtoId: "MLB-WORKSPACE-NOVA-2",
      linkOriginal: "https://produto.exemplo/workspace-nova-2",
      titulo: "Segunda oferta workspace nova",
      preco: 59.9,
      status: "pendente"
    };
    const insercaoSegunda = await controller.inserirItemFilaVivaCoordenado(clienteNovo, segunda, {
      agora: 3000
    });
    assert.strictEqual(insercaoSegunda.ok, true, JSON.stringify(insercaoSegunda));
    assert.deepStrictEqual(idsViva(root, clienteNovo), [segunda.id]);
    const segundoEnviado = await controller.atualizarItemFilaVivaCoordenado(clienteNovo, {
      ...segunda,
      status: "enviado",
      enviadoEm: new Date(3001).toISOString(),
      providerMessageId: "msg-segunda"
    }, { agora: 3001, exigirMutacao: true });
    assert.strictEqual(segundoEnviado.ok, true, JSON.stringify(segundoEnviado));
    assert.strictEqual(lerJson(root, clienteNovo, "fila-viva.json")[0].item.status, "enviado");
    const segundoTerminal = await controller.atualizarItemFilaVivaCoordenado(clienteNovo, {
      ...segunda,
      status: "enviado",
      enviadoEm: new Date(3001).toISOString(),
      providerMessageId: "msg-segunda"
    }, { agora: 7_204_000, exigirMutacao: true });
    assert.strictEqual(segundoTerminal.ok, true, JSON.stringify(segundoTerminal));
    assert.deepStrictEqual(idsViva(root, clienteNovo), []);
    assert.strictEqual(linhasHistorico(root, clienteNovo).length, 2);
    await concluirCheckpointRemovalFence({ cliente: clienteNovo, controller, coordinator, root });
    assert.deepStrictEqual(lerJson(root, clienteNovo, "fila.json"), []);
    assert.strictEqual(linhasHistorico(root, clienteNovo).length, 2);
    assert.deepStrictEqual(idsViva(root, outroCliente), [outro.id]);
    console.log("removal-fence-terminal-alias-recovery: OK");
  } finally {
    if (coordinator) await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
