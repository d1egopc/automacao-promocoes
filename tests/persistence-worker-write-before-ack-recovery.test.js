"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fila = require("../modules/fila/fila-operacional-v2");
const mutationIntent = require("../modules/fila/viva-mutation-intent");
const removalFence = require("../modules/fila/viva-removal-fence");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const quiet = { log() {} };

function probe(coordinator, root) {
  return payload => coordinator.probeVivaSnapshot({ ...payload, dataDir: root });
}

function files(root, cliente) {
  const dir = path.join(root, "clientes", cliente);
  return {
    dir,
    viva: path.join(dir, "fila-viva.json"),
    legado: path.join(dir, "fila.json"),
    proof: path.join(dir, fila.FILA_VIVA_PROOF_ARQUIVO),
    manifest: path.join(dir, "fila-v2-manifest.json"),
    historico: path.join(dir, "fila-historico-incremental")
  };
}

function storage(root) {
  return {
    getClienteJsonPath(cliente, nome) { return path.join(root, "clientes", cliente, nome); },
    writeClienteJson(cliente, nome, valor) {
      const file = path.join(root, "clientes", cliente, nome);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(valor, null, 2));
      fs.renameSync(tmp, file);
      return true;
    }
  };
}

function repository(cliente, state) {
  const states = new Map([[cliente, state]]);
  return {
    states,
    async lerStateObservacional(id) {
      return { ok: true, state: states.get(id) };
    },
    async prepararReadinessAutoridade(id) {
      const state = states.get(id);
      states.set(id, { ...state, authorityReady: true, authorityReadyGeneration: state.vivaGeneration,
        authorityReadyRevision: state.revision });
      return { ok: true, ready: true, state: states.get(id) };
    },
    async registrarMutacaoDuravel(id, dados) {
      const before = states.get(id);
      const nextGeneration = before.vivaGeneration + 1;
      const escrita = await dados.escreverArquivo({ state: before, nextGeneration, fileRevision: dados.fileRevision });
      if (escrita?.ok !== true) return { ok: false, motivo: escrita?.motivo || "writer_failed", state: before };
      if (escrita.idempotente === true && escrita.terminalHistorico === true) {
        return { ok: true, idempotente: true, terminalHistorico: true, state: before };
      }
      const after = {
        ...before,
        revision: before.revision + 1,
        vivaGeneration: nextGeneration,
        durableCheckpointGeneration: dados.checkpointSincronizado && escrita.legacyFileProof
          ? nextGeneration : before.durableCheckpointGeneration,
        dirtyGeneration: dados.checkpointSincronizado && escrita.legacyFileProof
          ? null : before.dirtyGeneration,
        vivaFileProof: escrita.vivaFileProof,
        legacyFileProof: escrita.legacyFileProof || before.legacyFileProof || null,
        authorityReady: false
      };
      states.set(id, after);
      return { ok: true, state: after };
    },
    async confirmarCheckpointDuravel(id, dados) {
      const before = states.get(id);
      const published = await dados.publicarCheckpoint({
        clienteId: id, state: before, targetGeneration: dados.targetGeneration,
        checkpointRevision: dados.checkpointRevision
      });
      if (published?.ok !== true || published.legacyFileProof?.generation !== dados.targetGeneration) {
        return { ok: false, motivo: "checkpoint_proof_missing" };
      }
      const after = { ...before, revision: before.revision + 1,
        durableCheckpointGeneration: dados.targetGeneration,
        dirtyGeneration: null, legacyFileProof: published.legacyFileProof };
      states.set(id, after);
      return { ok: true, state: after, legacyFileProof: published.legacyFileProof };
    },
    async avaliarAutoridadeRecovery(id, dados) {
      const current = states.get(id);
      const validation = await dados.validarEstadoFisico({ clienteId: id, state: current });
      if (validation?.ok !== true) {
        return { ok: true, conclusiva: false, motivo: validation.motivo, state: current, validacao: validation };
      }
      return { ok: true, conclusiva: true, maisNova: current.vivaGeneration > current.durableCheckpointGeneration, state: current };
    }
  };
}

function stateOnDisk(f, repo, cliente) {
  const viva = JSON.parse(fs.readFileSync(f.viva, "utf8"));
  const proof = JSON.parse(fs.readFileSync(f.proof, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(f.manifest, "utf8"));
  return {
    ids: viva.map(entry => `${entry.id}:${entry.item.status}`).sort(),
    proofGeneration: proof.generation,
    dbGeneration: repo.states.get(cliente).vivaGeneration,
    dbDurableGeneration: repo.states.get(cliente).durableCheckpointGeneration,
    manifestGeneration: manifest.vivaGeneration,
    manifestDurableGeneration: manifest.durableCheckpointGeneration,
    historyLines: fs.existsSync(f.historico)
      ? fs.readdirSync(f.historico).filter(name => name.endsWith(".jsonl"))
        .reduce((count, name) => count + fs.readFileSync(path.join(f.historico, name), "utf8").trim().split("\n").filter(Boolean).length, 0)
      : 0
  };
}

function crashWorker(root, workspace, phase) {
  const file = path.join(root, "crash-after-viva-rename.js");
  const workerPath = require.resolve("../modules/fila/persistence-worker");
  const target = files(root, workspace).viva;
  fs.writeFileSync(file, `
    const fs = require("fs");
    const original = fs.renameSync;
    fs.renameSync = function(from, to) {
      if (to === ${JSON.stringify(target)} && ${JSON.stringify(phase)} === "before") process.exit(77);
      const result = original.apply(this, arguments);
      if (to === ${JSON.stringify(target)} && ${JSON.stringify(phase)} === "after") process.exit(77);
      if (String(to).includes("fila-viva-removal-fences") && ${JSON.stringify(phase)} === "after_fence") process.exit(77);
      return result;
    };
    require(${JSON.stringify(workerPath)});
  `);
  return file;
}

async function trial(operation, phase, mtimeOrder, iteration) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-before-ack-"));
  const cliente = `fault_${operation}_${phase}_${mtimeOrder}_${iteration}`;
  const f = files(root, cliente);
  const store = storage(root);
  const env = {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global",
    FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_RECOVERY_AUTORIDADE: "generation",
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "5000"
  };
  const base = { id: "item-a", clienteId: cliente, status: "pendente", preco: 100 };
  const inserted = { id: "item-b", clienteId: cliente, status: "pendente", preco: 200 };
  const intent = operation === "insert" ? inserted : operation === "update"
    ? { ...base, status: "processando", preco: 90 }
    : operation === "terminal" ? { ...base, status: "expirado", expiradoEm: new Date(1000).toISOString() } : base;
  const method = operation === "insert" ? "inserirItemFilaVivaCoordenado"
    : operation === "remove" ? "removerItemFilaVivaCoordenado" : "atualizarItemFilaVivaCoordenado";
  let crashed;
  let normal;
  try {
    store.writeClienteJson(cliente, "fila.json", [base]);
    store.writeClienteJson(cliente, "fila-viva.json", [{ id: base.id, item: base, bucket: "viva", status: base.status, posicaoLegada: 0 }]);
    const baselineProof = fila.publicarProofFilaViva(cliente, { generation: 1, fileRevision: "base-revision" }, { ...store, logger: quiet });
    assert.strictEqual(baselineProof.ok, true);
    const initialState = {
      revision: 1, vivaGeneration: 1, durableCheckpointGeneration: 0, dirtyGeneration: 1,
      vivaFileProof: baselineProof.proof, legacyFileProof: null, authorityReady: true,
      authorityReadyGeneration: 1, authorityReadyRevision: 1,
      pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null
    };
    const repo = repository(cliente, initialState);
    store.writeClienteJson(cliente, "fila-v2-manifest.json", {
      version: 2, manifestVersion: 2, clienteId: cliente, vivaGeneration: 1,
      durableCheckpointGeneration: 0, dirtyGeneration: 1, vivaFileProof: baselineProof.proof
    });
    const before = stateOnDisk(f, repo, cliente);
    crashed = criarCoordenadorPersistencia({ env, workerPath: crashWorker(root, cliente, phase), logger: quiet });
    const controller = fila.criarControladorFilaOperacionalV2({
      ...store, env, manifestStateRepository: repo, logger: quiet,
      modoPersistenciaViva: () => "worker",
      agendarMutacaoViva: payload => crashed.mutateViva({ ...payload, dataDir: root })
    });
    const failed = await controller[method](cliente, intent, { agora: 1000 });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.motivo, "worker_exit");
    const afterCrash = stateOnDisk(f, repo, cliente);
    assert.strictEqual(afterCrash.proofGeneration, 1);
    assert.strictEqual(afterCrash.dbGeneration, 1);
    assert.strictEqual(afterCrash.manifestGeneration, 1);
    if (phase !== "before") {
      if (operation === "insert") assert(afterCrash.ids.includes("item-b:pendente"));
      if (operation === "update") assert(afterCrash.ids.includes("item-a:processando"));
      if (operation === "remove" || operation === "terminal") assert(!afterCrash.ids.some(id => id.startsWith("item-a:")));
    } else {
      assert.deepStrictEqual(afterCrash.ids, before.ids);
    }
    if (operation === "terminal") assert.strictEqual(afterCrash.historyLines, 1);
    if (operation === "remove" || operation === "terminal") {
      assert.strictEqual(removalFence.listar(root, cliente).length, phase === "after_fence" ? 1 : 0);
    }
    await crashed.shutdown();
    crashed = null;
    normal = criarCoordenadorPersistencia({ env, logger: quiet });
    const probeDireto = await normal.probeVivaSnapshot({ clienteId: cliente,
      checkpointRevision: "viva-recovery-probe-01", dataDir: root,
      previousHash: mutationIntent.digest(fs.readFileSync(f.viva)),
      persistenceMode: "worker" });
    assert.strictEqual(probeDireto.ok, true);
    assert.strictEqual(probeDireto.matchPrevious, true);
    assert(probeDireto.workerThreadId > 0);
    assert(JSON.stringify(probeDireto).length < 500);

    const vivaTime = fs.statSync(f.viva).mtimeMs;
    if (mtimeOrder === "legacy_newer") {
      fs.utimesSync(f.legado, new Date(vivaTime + 2000), new Date(vivaTime + 2000));
    } else {
      fs.utimesSync(f.legado, new Date(vivaTime - 2000), new Date(vivaTime - 2000));
    }
    const checkpointCovered = operation === "update" && phase === "after" &&
      mtimeOrder === "viva_newer" && iteration === 1;
    if (checkpointCovered) {
      store.writeClienteJson(cliente, "fila.json", [intent]);
      const pending = mutationIntent.ler(root, cliente);
      const legacyProof = fila.publicarProofFilaLegada(cliente, {
        generation: 2, fileRevision: pending.intent.fileRevision
      }, { ...store, logger: quiet });
      assert.strictEqual(legacyProof.ok, true);
    }
    const recoveryDeps = {
      ...store, env, manifestStateRepository: repo, logger: quiet,
      agendarProbeViva: probe(normal, root)
    };
    const intentRecovery = phase === "before"
      ? await fila.reconciliarIntentMutacaoViva(cliente, recoveryDeps) : null;
    if (phase === "before") assert.strictEqual(intentRecovery.publicado, false);
    const recovery = await fila.reconciliarFilaV2ParaLeitura(cliente, { contexto: "restart_fault_injection" }, recoveryDeps);
    const legacyItems = JSON.parse(fs.readFileSync(f.legado, "utf8"));
    const vivaRead = fila.lerFilaVivaParaMerge(cliente, { ...store, agora: 1000 });
    const merged = recovery.maisNova
      ? fila.mesclarFilaLegadaComViva(cliente, legacyItems, vivaRead.entradas, {
          agora: 1000, removalFenceDataDir: root,
          removedIdentityHashes: recovery.recoveryIntent?.removedIdentityHashes || []
        }).filaCliente
      : legacyItems;
    const afterRecovery = { ...stateOnDisk(f, repo, cliente), decision: recovery.autoridadeUsada,
      reason: recovery.motivo, maisNova: recovery.maisNova, memoryIds: merged.map(item => `${item.id}:${item.status}`).sort() };
    if (phase !== "before") {
      assert.strictEqual(recovery.autoridadeUsada, "intent");
      assert.strictEqual(recovery.motivo, "intent_target_committed");
    } else {
      assert.notStrictEqual(recovery.autoridadeUsada, "intent");
    }
    assert.strictEqual(recovery.maisNova, true);
    const recoveredGeneration = phase !== "before" ? 2 : 1;
    assert.strictEqual(afterRecovery.proofGeneration, recoveredGeneration);
    assert.strictEqual(afterRecovery.dbGeneration, recoveredGeneration);
    assert.strictEqual(afterRecovery.manifestGeneration, recoveredGeneration);
    if (checkpointCovered) {
      assert.strictEqual(afterRecovery.dbDurableGeneration, 2);
      assert.strictEqual(afterRecovery.manifestDurableGeneration, 2);
    }
    if (operation === "insert") {
      assert.strictEqual(afterRecovery.memoryIds.includes("item-b:pendente"), phase !== "before");
    }
    if (operation === "update") {
      assert.strictEqual(afterRecovery.memoryIds.includes("item-a:processando"), phase !== "before");
    }
    if (operation === "remove" || operation === "terminal") {
      assert.strictEqual(afterRecovery.memoryIds.includes("item-a:pendente"), phase === "before");
    }
    let secondReadResurrected = false;
    if (phase !== "before" && (operation === "remove" || operation === "terminal")) {
      assert.strictEqual(mutationIntent.ler(root, cliente).exists, false);
      assert.strictEqual(removalFence.listar(root, cliente).length, 1);
      for (let leitura = 2; leitura <= 3; leitura++) {
        const nextRead = await fila.reconciliarFilaV2ParaLeitura(cliente,
          { contexto: `read_${leitura}_after_intent_cleanup` }, recoveryDeps);
        assert.strictEqual(nextRead.ok, true);
        const mergedAgain = fila.mesclarFilaLegadaComViva(cliente, legacyItems, vivaRead.entradas,
          { agora: 1000, removalFenceDataDir: root }).filaCliente;
        secondReadResurrected = mergedAgain.some(item => item.id === "item-a" && item.status === "pendente");
        assert.strictEqual(secondReadResurrected, false, "fence deve impedir ressurreicao em leituras posteriores");
      }
    }

    const retryController = fila.criarControladorFilaOperacionalV2({
      ...store, env, manifestStateRepository: repo, logger: quiet,
      modoPersistenciaViva: () => "worker",
      agendarProbeViva: probe(normal, root),
      agendarMutacaoViva: payload => normal.mutateViva({ ...payload, dataDir: root })
    });
    const retry = await retryController[method](cliente, intent, { agora: 1000 });
    const afterRetry = stateOnDisk(f, repo, cliente);
    assert.strictEqual(retry.ok, true);
    assert.strictEqual(afterRetry.proofGeneration, afterRetry.dbGeneration);
    assert.strictEqual(afterRetry.manifestGeneration, afterRetry.dbGeneration);
    if (operation === "terminal" && phase !== "before") {
      assert.strictEqual(afterRetry.dbGeneration, 2, "retry terminal nao cria geracao sem snapshot");
    }
    if (operation === "insert") assert.strictEqual(afterRetry.ids.filter(id => id.startsWith("item-b:")).length, 1);
    if (operation === "update") assert(afterRetry.ids.includes("item-a:processando"));
    if (operation === "remove" || operation === "terminal") assert.strictEqual(afterRetry.ids.length, 0);
    if (phase !== "before" && (operation === "remove" || operation === "terminal")) {
      assert.strictEqual(removalFence.listar(root, cliente).length, 1);
    }
    if (operation === "terminal") assert.strictEqual(afterRetry.historyLines, 1);
    return { operation, phase, mtimeOrder, iteration, before, afterCrash, afterRecovery,
      secondReadResurrected,
      retry: { ok: retry.ok, motivo: retry.motivo, idempotente: retry.idempotente === true }, afterRetry };
  } finally {
    if (crashed) await crashed.shutdown();
    if (normal) await normal.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function postAckBoundary(phase, corruption = "", operation = "insert") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `viva-${phase}-${corruption}-`));
  const cliente = `boundary_${operation}_${phase}${corruption ? `_${corruption}` : ""}`;
  const f = files(root, cliente);
  const store = storage(root);
  const env = { ...process.env, DATA_DIR: root, FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global", FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_RECOVERY_AUTORIDADE: "generation" };
  const base = { id: "item-a", clienteId: cliente, status: "pendente" };
  const inserted = { id: "item-b", clienteId: cliente, status: "pendente" };
  const terminal = { ...base, status: "expirado", expiradoEm: new Date(1000).toISOString() };
  const item = operation === "insert" ? inserted : operation === "terminal" ? terminal : base;
  const method = operation === "insert" ? "inserirItemFilaVivaCoordenado" :
    operation === "remove" ? "removerItemFilaVivaCoordenado" : "atualizarItemFilaVivaCoordenado";
  let coordinator;
  const originalUnlink = fs.unlinkSync;
  try {
    store.writeClienteJson(cliente, "fila.json", [base]);
    store.writeClienteJson(cliente, "fila-viva.json", [{ id: base.id, item: base, bucket: "viva",
      status: base.status, posicaoLegada: 0 }]);
    const baseline = fila.publicarProofFilaViva(cliente, { generation: 1, fileRevision: "base-revision" },
      { ...store, logger: quiet });
    assert.strictEqual(baseline.ok, true);
    const repo = repository(cliente, { revision: 1, vivaGeneration: 1,
      durableCheckpointGeneration: 0, dirtyGeneration: 1, vivaFileProof: baseline.proof,
      authorityReady: true, authorityReadyGeneration: 1, authorityReadyRevision: 1,
      pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null });
    store.writeClienteJson(cliente, "fila-v2-manifest.json", { version: 2, manifestVersion: 2,
      clienteId: cliente, vivaGeneration: 1, durableCheckpointGeneration: 0,
      dirtyGeneration: 1, vivaFileProof: baseline.proof });
    const mainStore = {
      ...store,
      writeClienteJson(id, name, value) {
        if ((phase === "after_ack" && id === cliente && name === fila.FILA_VIVA_PROOF_ARQUIVO) ||
            (phase === "after_proof" && name === "fila-v2-manifest.json")) {
          throw new Error(`injected_${phase}`);
        }
        return store.writeClienteJson(id, name, value);
      }
    };
    if (phase === "after_db") {
      fs.unlinkSync = function(file) {
        if (file === mutationIntent.caminho(root, cliente)) throw new Error("injected_before_intent_cleanup");
        return originalUnlink.apply(this, arguments);
      };
    }
    coordinator = criarCoordenadorPersistencia({ env, logger: quiet });
    const controller = fila.criarControladorFilaOperacionalV2({ ...mainStore, env,
      manifestStateRepository: repo, logger: quiet, modoPersistenciaViva: () => "worker",
      agendarProbeViva: probe(coordinator, root),
      agendarMutacaoViva: payload => coordinator.mutateViva({ ...payload, dataDir: root }) });
    const result = await controller[method](cliente, item, { agora: 1000 });
    fs.unlinkSync = originalUnlink;
    assert.strictEqual(result.ok, phase === "after_db");
    const crashed = stateOnDisk(f, repo, cliente);
    assert.strictEqual(crashed.dbGeneration, phase === "after_db" ? 2 : 1);
    assert.strictEqual(crashed.proofGeneration, phase === "after_ack" ? 1 : 2);
    assert.strictEqual(crashed.manifestGeneration, phase === "after_db" ? 2 : 1);
    assert.strictEqual(mutationIntent.ler(root, cliente).exists, true);
    if (operation !== "insert") assert.strictEqual(removalFence.listar(root, cliente).length, 1);
    let otherState = null;
    if (corruption === "two_lanes") {
      const other = `${cliente}_other`;
      const otherBase = { id: "other-a", clienteId: other, status: "pendente" };
      store.writeClienteJson(other, "fila.json", [otherBase]);
      store.writeClienteJson(other, "fila-viva.json", [
        { id: "other-a", item: otherBase, bucket: "viva", status: "pendente", posicaoLegada: 0 }
      ]);
      const otherProof = fila.publicarProofFilaViva(other,
        { generation: 1, fileRevision: "base-revision" }, { ...store, logger: quiet });
      repo.states.set(other, { revision: 1, vivaGeneration: 1,
        durableCheckpointGeneration: 0, dirtyGeneration: 1, vivaFileProof: otherProof.proof,
        authorityReady: true, authorityReadyGeneration: 1, authorityReadyRevision: 1,
        pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null });
      store.writeClienteJson(other, "fila-v2-manifest.json", { version: 2, manifestVersion: 2,
        clienteId: other, vivaGeneration: 1, durableCheckpointGeneration: 0,
        dirtyGeneration: 1, vivaFileProof: otherProof.proof });
      const otherResult = await controller.inserirItemFilaVivaCoordenado(other,
        { id: "other-b", clienteId: other, status: "pendente" }, { agora: 1000 });
      assert.strictEqual(otherResult.ok, true);
      otherState = stateOnDisk(files(root, other), repo, other);
      assert.strictEqual(otherState.dbGeneration, 2);
      assert.strictEqual(otherState.proofGeneration, 2);
    }
    if (corruption === "corrupt_intent") fs.writeFileSync(mutationIntent.caminho(root, cliente), "{");
    if (corruption === "incomplete_intent") fs.writeFileSync(mutationIntent.caminho(root, cliente), "{\"schema\":1}");
    if (corruption === "missing_removal_identity") {
      const pending = mutationIntent.ler(root, cliente).intent;
      fs.writeFileSync(mutationIntent.caminho(root, cliente), JSON.stringify({
        ...pending, removedIdentityHashes: []
      }));
    }
    if (corruption === "unknown_snapshot") store.writeClienteJson(cliente, "fila-viva.json", [
      { id: "foreign", item: { id: "foreign", clienteId: cliente, status: "pendente" },
        bucket: "viva", status: "pendente", posicaoLegada: 0 }
    ]);
    const recovered = await fila.reconciliarIntentMutacaoViva(cliente, { ...store, env,
      manifestStateRepository: repo, logger: quiet, agendarProbeViva: probe(coordinator, root) });
    if (["corrupt_intent", "incomplete_intent", "missing_removal_identity", "unknown_snapshot"].includes(corruption)) {
      assert.strictEqual(recovered.ok, false);
      assert.strictEqual(recovered.failClosed, true);
      assert.strictEqual(recovered.motivo, corruption === "corrupt_intent" ? "intent_corrupt" :
        ["incomplete_intent", "missing_removal_identity"].includes(corruption)
          ? "intent_invalid" : "intent_snapshot_unknown");
      const leitura = await fila.reconciliarFilaV2ParaLeitura(cliente, { contexto: "fail_closed" }, {
        ...store, env, manifestStateRepository: repo, logger: quiet,
        agendarProbeViva: probe(coordinator, root)
      });
      assert.strictEqual(leitura.failClosed, true);
      assert.strictEqual(leitura.autoridadeUsada, "intent");
      assert.strictEqual(repo.states.get(cliente).vivaGeneration, 1);
      return { phase, corruption, crashed, motivo: recovered.motivo };
    }
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.publicado, true);
    assert.strictEqual(mutationIntent.ler(root, cliente).exists, false);
    const final = stateOnDisk(f, repo, cliente);
    assert.strictEqual(final.proofGeneration, 2);
    assert.strictEqual(final.dbGeneration, 2);
    assert.strictEqual(final.manifestGeneration, 2);
    assert.strictEqual(final.ids.filter(id => id.startsWith("item-b:")).length,
      operation === "insert" ? 1 : 0);
    if (operation !== "insert") {
      assert.strictEqual(final.ids.length, 0);
      assert.strictEqual(final.historyLines, operation === "terminal" ? 1 : 0);
      assert.strictEqual(removalFence.listar(root, cliente).length, 1);
      const merged = fila.mesclarFilaLegadaComViva(cliente, [base], [],
        { agora: 1000, removalFenceDataDir: root }).filaCliente;
      assert.strictEqual(merged.length, 0);
    }
    return { operation, phase, crashed, recovered: final, ...(otherState ? { otherState } : {}) };
  } finally {
    fs.unlinkSync = originalUnlink;
    if (coordinator) await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function firstSnapshot(phase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `viva-first-${phase}-`));
  const cliente = `first_${phase}`;
  const f = files(root, cliente);
  const store = storage(root);
  const env = { ...process.env, DATA_DIR: root, FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global", FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_V2_RECOVERY_AUTORIDADE: "generation" };
  const repo = repository(cliente, { revision: 0, vivaGeneration: 0,
    durableCheckpointGeneration: 0, dirtyGeneration: null, vivaFileProof: null,
    authorityReady: true, authorityReadyGeneration: 0, authorityReadyRevision: 0,
    pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null });
  let coordinator;
  let recoveryCoordinator;
  try {
    store.writeClienteJson(cliente, "fila.json", []);
    store.writeClienteJson(cliente, "fila-v2-manifest.json", { version: 2, manifestVersion: 2,
      clienteId: cliente, vivaGeneration: 0, durableCheckpointGeneration: 0,
      dirtyGeneration: null, vivaFileProof: null });
    coordinator = criarCoordenadorPersistencia({ env, workerPath: crashWorker(root, cliente, phase), logger: quiet });
    const controller = fila.criarControladorFilaOperacionalV2({ ...store, env,
      manifestStateRepository: repo, logger: quiet, modoPersistenciaViva: () => "worker",
      agendarProbeViva: probe(coordinator, root),
      agendarMutacaoViva: payload => coordinator.mutateViva({ ...payload, dataDir: root }) });
    const result = await controller.inserirItemFilaVivaCoordenado(cliente,
      { id: "first-item", clienteId: cliente, status: "pendente" }, { agora: 1000 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(fs.existsSync(f.viva), phase === "after");
    await coordinator.shutdown();
    coordinator = null;
    recoveryCoordinator = criarCoordenadorPersistencia({ env, logger: quiet });
    const recovered = await fila.reconciliarIntentMutacaoViva(cliente, { ...store, env,
      manifestStateRepository: repo, logger: quiet,
      agendarProbeViva: probe(recoveryCoordinator, root) });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.publicado, phase === "after");
    assert.strictEqual(repo.states.get(cliente).vivaGeneration, phase === "after" ? 1 : 0);
    assert.strictEqual(mutationIntent.ler(root, cliente).exists, false);
    return { phase, generation: repo.states.get(cliente).vivaGeneration };
  } finally {
    if (coordinator) await coordinator.shutdown();
    if (recoveryCoordinator) await recoveryCoordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function checkpointAfterRemoval(operation, cleanupInterrupted = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `viva-fence-checkpoint-${operation}-`));
  const cliente = `checkpoint_${operation}`;
  const f = files(root, cliente);
  const store = storage(root);
  const env = { ...process.env, DATA_DIR: root, FILA_PERSISTENCE_WORKER: "1",
    FILA_VIVA_MUTATION_WORKER_ROLLOUT: "global", FILA_V2_OPERACIONAL_ROLLOUT: "global" };
  const base = { id: "item-a", clienteId: cliente, status: "pendente" };
  const legacyOnly = { id: "legit-only", clienteId: cliente, status: "pendente" };
  const terminal = { ...base, status: "expirado", expiradoEm: new Date(1000).toISOString() };
  const repo = repository(cliente, { revision: 1, vivaGeneration: 1,
    durableCheckpointGeneration: 0, dirtyGeneration: 1, authorityReady: true,
    authorityReadyGeneration: 1, authorityReadyRevision: 1 });
  let coordinator;
  const originalUnlink = fs.unlinkSync;
  try {
    store.writeClienteJson(cliente, "fila.json", [base, legacyOnly]);
    store.writeClienteJson(cliente, "fila-viva.json", [
      { id: base.id, item: base, bucket: "viva", status: base.status, posicaoLegada: 0 }
    ]);
    const proof = fila.publicarProofFilaViva(cliente, { generation: 1, fileRevision: "base-revision" },
      { ...store, logger: quiet });
    assert.strictEqual(proof.ok, true);
    repo.states.set(cliente, { ...repo.states.get(cliente), vivaFileProof: proof.proof });
    store.writeClienteJson(cliente, "fila-v2-manifest.json", { version: 2, manifestVersion: 2,
      clienteId: cliente, vivaGeneration: 1, durableCheckpointGeneration: 0,
      dirtyGeneration: 1, vivaFileProof: proof.proof });
    coordinator = criarCoordenadorPersistencia({ env, logger: quiet });
    const controller = fila.criarControladorFilaOperacionalV2({ ...store, env,
      manifestStateRepository: repo, logger: quiet, modoPersistenciaViva: () => "worker",
      agendarMutacaoViva: payload => coordinator.mutateViva({ ...payload, dataDir: root }) });
    const method = operation === "remove" ? "removerItemFilaVivaCoordenado" : "atualizarItemFilaVivaCoordenado";
    const removed = await controller[method](cliente, operation === "remove" ? base : terminal,
      { agora: 1000, publicarLegacyProof: true });
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(removed.legacyFileProofOk, true);
    assert.strictEqual(repo.states.get(cliente).vivaGeneration, 2);
    assert.strictEqual(repo.states.get(cliente).durableCheckpointGeneration, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.legado, "utf8")).map(item => item.id),
      ["item-a", "legit-only"]);
    assert.strictEqual(removalFence.listar(root, cliente).length, 1);
    assert.strictEqual(mutationIntent.ler(root, cliente).exists, false);
    const other = `${cliente}_other`;
    assert.strictEqual(removalFence.listar(root, other).length, 0);
    assert.deepStrictEqual(fila.mesclarFilaLegadaComViva(other,
      [{ id: base.id, clienteId: other, status: "pendente" }], [],
      { agora: 1000, removalFenceDataDir: root }).filaCliente.map(item => item.id), [base.id]);
    store.writeClienteJson(other, "fila.json", [{ id: base.id, clienteId: other, status: "pendente" }]);
    store.writeClienteJson(other, "fila-viva.json", []);
    const outroCheckpoint = await coordinator.prepare({ clienteId: other,
      checkpointRevision: "checkpoint-other", targetGeneration: 2,
      dataDir: root, nowMs: 1000, persistenceMode: "worker" });
    assert.strictEqual(outroCheckpoint.ok, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outroCheckpoint.tempPath, "utf8")).map(item => item.id),
      [base.id]);
    const vivaEntries = JSON.parse(fs.readFileSync(f.viva, "utf8"));
    for (let read = 1; read <= 3; read++) {
      const merged = fila.mesclarFilaLegadaComViva(cliente, [base, legacyOnly], vivaEntries,
        { agora: 1000, removalFenceDataDir: root }).filaCliente;
      assert.deepStrictEqual(merged.map(item => item.id), ["legit-only"]);
    }
    assert.strictEqual(operation === "terminal" ? stateOnDisk(f, repo, cliente).historyLines : 0,
      operation === "terminal" ? 1 : 0);

    let prepared = await coordinator.prepare({ clienteId: cliente, checkpointRevision: "checkpoint-2",
      targetGeneration: 2, dataDir: root, nowMs: 1000, persistenceMode: "worker" });
    assert.strictEqual(prepared.ok, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(prepared.tempPath, "utf8")).map(item => item.id),
      ["legit-only"]);
    fs.writeFileSync(prepared.tempPath, JSON.stringify([base, legacyOnly]));
    const rejeitado = await fila.confirmarCheckpointCoordenado(cliente, {
      targetGeneration: 2, checkpointRevision: "checkpoint-2",
      publicarCheckpoint: () => coordinator.publish({ clienteId: cliente,
        checkpointRevision: "checkpoint-2", targetGeneration: 2, dataDir: root,
        persistenceMode: "worker", expectedSourceRevisions: prepared.sourceRevisions })
    }, { ...store, env, manifestStateRepository: repo, logger: quiet });
    assert.strictEqual(rejeitado.ok, false);
    assert.strictEqual(rejeitado.motivo, "checkpoint_proof_missing");
    assert.strictEqual(repo.states.get(cliente).durableCheckpointGeneration, 0);
    prepared = await coordinator.prepare({ clienteId: cliente, checkpointRevision: "checkpoint-2",
      targetGeneration: 2, dataDir: root, nowMs: 1000, persistenceMode: "worker" });
    assert.strictEqual(prepared.ok, true);
    assert.strictEqual(removalFence.listar(root, cliente).length, 1);
    if (cleanupInterrupted) fs.unlinkSync = function(file) {
      if (String(file).includes(removalFence.DIRECTORY)) throw new Error("injected_cleanup_interruption");
      return originalUnlink.apply(this, arguments);
    };
    const confirmed = await fila.confirmarCheckpointCoordenado(cliente, {
      targetGeneration: 2, checkpointRevision: "checkpoint-2", motivo: "test_removal_fence",
      publicarCheckpoint: async ({ targetGeneration, checkpointRevision }) => coordinator.publish({
        clienteId: cliente, dataDir: root, targetGeneration, checkpointRevision,
        tempIdentity: prepared.tempIdentity, expectedSourceRevisions: prepared.sourceRevisions,
        persistenceMode: "worker"
      })
    }, { ...store, env, manifestStateRepository: repo, logger: quiet });
    fs.unlinkSync = originalUnlink;
    assert.strictEqual(confirmed.ok, true);
    assert.strictEqual(repo.states.get(cliente).durableCheckpointGeneration, 2);
    if (cleanupInterrupted) {
      assert.strictEqual(removalFence.listar(root, cliente).length, 1);
      const legacyProofPath = path.join(f.dir, fila.FILA_LEGADA_PROOF_ARQUIVO);
      const originalProof = fs.readFileSync(legacyProofPath, "utf8");
      fs.writeFileSync(legacyProofPath, "{");
      const withoutProof = await fila.reconciliarIntentMutacaoViva(cliente,
        { ...store, env, manifestStateRepository: repo, logger: quiet,
          agendarProbeViva: probe(coordinator, root) });
      assert.strictEqual(withoutProof.ok, true);
      assert.strictEqual(removalFence.listar(root, cliente).length, 1);
      fs.writeFileSync(legacyProofPath, originalProof);
      const afterRestart = await fila.reconciliarIntentMutacaoViva(cliente,
        { ...store, env, manifestStateRepository: repo, logger: quiet,
          agendarProbeViva: probe(coordinator, root) });
      assert.strictEqual(afterRestart.ok, true);
    }
    assert.strictEqual(removalFence.listar(root, cliente).length, 0);
    const checkpointLegacy = JSON.parse(fs.readFileSync(f.legado, "utf8"));
    assert.deepStrictEqual(checkpointLegacy.map(item => item.id), ["legit-only"]);
    const proofLegado = JSON.parse(fs.readFileSync(path.join(f.dir, fila.FILA_LEGADA_PROOF_ARQUIVO), "utf8"));
    const statLegado = fs.statSync(f.legado);
    assert.strictEqual(proofLegado.generation, 2);
    assert.strictEqual(proofLegado.size, statLegado.size);
    assert.strictEqual(proofLegado.mtimeMs, statLegado.mtimeMs);
    const afterCleanup = fila.mesclarFilaLegadaComViva(cliente, checkpointLegacy, vivaEntries,
      { agora: 1000, removalFenceDataDir: root }).filaCliente;
    assert.deepStrictEqual(afterCleanup.map(item => item.id), ["legit-only"]);
    const retry = await controller[method](cliente, operation === "remove" ? base : terminal, { agora: 1000 });
    assert.strictEqual(retry.ok, true);
    assert.strictEqual(stateOnDisk(f, repo, cliente).historyLines, operation === "terminal" ? 1 : 0);
    return { operation, cleanupInterrupted, generation: repo.states.get(cliente).vivaGeneration,
      durableCheckpointGeneration: repo.states.get(cliente).durableCheckpointGeneration,
      fenceAfterCheckpoint: removalFence.listar(root, cliente).length,
      legacyIds: checkpointLegacy.map(item => item.id), retryIdempotent: retry.idempotente === true };
  } finally {
    fs.unlinkSync = originalUnlink;
    if (coordinator) await coordinator.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function invalidFenceFailsClosed() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-fence-corrupt-"));
  const cliente = "corrupt_fence";
  const store = storage(root);
  const env = { ...process.env, DATA_DIR: root };
  const repo = repository(cliente, { vivaGeneration: 2 });
  try {
    const fence = { schema: 1, clienteId: cliente, jobId: "job-1", generation: 2,
      operation: "remove", identityHashes: [mutationIntent.digest("id:item-a")],
      createdAt: new Date().toISOString() };
    removalFence.escrever(root, cliente, fence);
    fs.writeFileSync(removalFence.caminho(root, cliente, "job-1"), "{");
    const corrupt = await fila.reconciliarIntentMutacaoViva(cliente,
      { ...store, env, manifestStateRepository: repo, logger: quiet });
    assert.strictEqual(corrupt.failClosed, true);
    assert.strictEqual(corrupt.motivo, "removal_fence_invalid");
    fs.writeFileSync(removalFence.caminho(root, cliente, "job-1"), JSON.stringify({ schema: 1 }));
    const incomplete = await fila.reconciliarIntentMutacaoViva(cliente,
      { ...store, env, manifestStateRepository: repo, logger: quiet });
    assert.strictEqual(incomplete.failClosed, true);
    fs.writeFileSync(removalFence.caminho(root, cliente, "job-1"), JSON.stringify({ ...fence, generation: 3 }));
    const future = await fila.reconciliarIntentMutacaoViva(cliente,
      { ...store, env, manifestStateRepository: repo, logger: quiet });
    assert.strictEqual(future.failClosed, true);
    assert.strictEqual(future.motivo, "removal_fence_generation_incoerente");
    return { corrupt: corrupt.motivo, incomplete: incomplete.motivo, future: future.motivo };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  for (const operation of ["insert", "update", "remove", "terminal"]) {
    for (const phase of ["before", "after", ...(operation === "remove" || operation === "terminal" ? ["after_fence"] : [])]) {
      for (const mtimeOrder of ["viva_newer", "legacy_newer"]) {
        for (let iteration = 1; iteration <= 2; iteration++) {
          console.log("write-before-ack-recovery", JSON.stringify(await trial(operation, phase, mtimeOrder, iteration)));
        }
      }
    }
  }
  for (const phase of ["after_ack", "after_proof", "after_db"]) {
    console.log("post-ack-boundary", JSON.stringify(await postAckBoundary(phase)));
    for (const operation of ["remove", "terminal"]) {
      console.log("post-ack-removal-boundary", JSON.stringify(await postAckBoundary(phase, "", operation)));
    }
  }
  for (const corruption of ["corrupt_intent", "incomplete_intent", "unknown_snapshot"]) {
    console.log("fail-closed", JSON.stringify(await postAckBoundary("after_ack", corruption)));
  }
  console.log("fail-closed-removal-intent", JSON.stringify(
    await postAckBoundary("after_ack", "missing_removal_identity", "remove")));
  console.log("two-lanes", JSON.stringify(await postAckBoundary("after_ack", "two_lanes")));
  for (const phase of ["before", "after"]) {
    console.log("first-snapshot", JSON.stringify(await firstSnapshot(phase)));
  }
  for (const operation of ["remove", "terminal"]) {
    console.log("removal-fence-checkpoint", JSON.stringify(await checkpointAfterRemoval(operation)));
  }
  console.log("removal-fence-cleanup-recovery", JSON.stringify(await checkpointAfterRemoval("remove", true)));
  console.log("removal-fence-fail-closed", JSON.stringify(await invalidFenceFailsClosed()));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
