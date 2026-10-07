"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { criarControladorFilaOperacionalV2 } = require("../modules/fila/fila-operacional-v2");
const {
  FLAG_EXECUTOR,
  FLAG_CANARY,
  FLAG_GLOBAL,
  resolverEscopo,
  executarPreflightExecutor
} = require("../modules/fila/executor-generation-authority");

const workspaceDiego = "user_pss60lus";
const workspaceWolf = "user_b2oogwwl";
const workspaceForaCanary = "user_zbbk3fdr";
const canary = `${workspaceDiego}, ${workspaceWolf}`;

function envExecutor({ enabled = "1", clients = canary, global = "mtime" } = {}) {
  return {
    [FLAG_EXECUTOR]: enabled,
    [FLAG_CANARY]: clients,
    [FLAG_GLOBAL]: global,
    FILA_V2_OPERACIONAL_ROLLOUT: "canary",
    FILA_V2_OPERACIONAL_CANARY_CLIENTES: canary
  };
}

async function runBoundary({
  workspace = workspaceDiego,
  env = envExecutor(),
  normalExecutorCycle = true,
  dirtyLocal = false,
  operational = true,
  decision = {
    autoridadeSolicitada: "generation",
    autoridadeUsada: "generation",
    generationConclusiva: true,
    maisNova: true,
    fallbackMtime: false,
    motivo: "generation_viva_mais_nova"
  },
  fastResult = { ok: true, filaClienteHotState: [], pendentes: 0 },
  readiness = { ok: true, ready: true, motivo: "authority_readiness_ready" },
  prepareError = null,
  afterPrepare = null,
  throwLogger = false
} = {}) {
  const calls = { prepare: 0, reconcile: 0, fastPath: 0, legacy: 0 };
  const observed = [];
  let reconcileEnv;
  const result = await executarPreflightExecutor({
    clienteId: workspace,
    env,
    cicloNormalExecutor: normalExecutorCycle,
    dirtyLocal,
    deveUsarFilaV2: () => operational,
    prepararReadiness: async () => {
      calls.prepare += 1;
      if (prepareError) throw prepareError;
      if (typeof afterPrepare === "function") await afterPrepare();
      return { ...readiness };
    },
    reconciliar: async ({ env: receivedEnv }) => {
      calls.reconcile += 1;
      reconcileEnv = receivedEnv;
      return { ...decision };
    },
    aplicarFastPath: async () => {
      calls.fastPath += 1;
      return { ...fastResult };
    },
    carregarLegado: async () => {
      calls.legacy += 1;
    },
    avaliarFallbackMtime: (fastPath, previousDecision) => ({
      ...previousDecision,
      autoridadeUsada: "mtime",
      generationConclusiva: false,
      fallbackMtime: true,
      motivo: fastPath?.motivo || "fast_path_viva_indisponivel"
    }),
    logger: payload => {
      if (throwLogger) throw new Error("logger_failure_must_be_ignored");
      observed.push(payload);
    }
  });
  return { calls, env, reconcileEnv, observed, result };
}

function criarControladorReadinessTeste(env = envExecutor()) {
  const workspace = workspaceDiego;
  const manifestoPath = path.posix.join("/virtual", workspace, "fila-v2-manifest.json");
  const manifesto = JSON.stringify({
    manifestVersion: 2,
    vivaGeneration: 1,
    durableCheckpointGeneration: 1,
    dirtyGeneration: null
  });
  const calls = { prepare: 0, path: 0, read: 0 };
  const controlador = criarControladorFilaOperacionalV2({
    env,
    getClienteJsonPath: (clienteId, arquivo) => {
      calls.path += 1;
      assert.strictEqual(clienteId, workspace);
      assert.strictEqual(arquivo, "fila-v2-manifest.json");
      return manifestoPath;
    },
    fs: {
      existsSync: file => file === manifestoPath,
      readFileSync: file => {
        calls.read += 1;
        assert.strictEqual(file, manifestoPath);
        return manifesto;
      },
      statSync: () => ({ size: Buffer.byteLength(manifesto), mtimeMs: 1 })
    },
    manifestStateRepository: {
      async prepararReadinessAutoridade(clienteId, dados) {
        calls.prepare += 1;
        assert.strictEqual(clienteId, workspace);
        const leitura = dados.lerManifesto();
        assert.strictEqual(leitura.ok, true);
        assert.strictEqual(leitura.bytes, Buffer.byteLength(manifesto));
        assert.strictEqual(leitura.manifesto.vivaGeneration, 1);
        return { ok: true, ready: true, motivo: "authority_readiness_ready" };
      }
    }
  });
  return { controlador, calls };
}

async function runControllerBoundary({
  env = envExecutor(),
  workspace = workspaceDiego,
  dirtyLocal = false,
  cicloNormalExecutor = true,
  generationConclusiva = true
} = {}) {
  const { controlador, calls } = criarControladorReadinessTeste(env);
  const seam = { reconcile: 0, fast: 0, legacy: 0 };
  const result = await executarPreflightExecutor({
    clienteId: workspace,
    env,
    cicloNormalExecutor,
    dirtyLocal,
    deveUsarFilaV2: clienteId => controlador.deveUsarFilaV2Operacional(clienteId),
    prepararReadiness: ({ clienteId }) => controlador.prepararReadinessAutoridadeRecovery(clienteId),
    reconciliar: async ({ env: selectedEnv }) => {
      seam.reconcile += 1;
      assert.strictEqual(selectedEnv[FLAG_GLOBAL],
        env[FLAG_EXECUTOR] === "1" && workspace === workspaceDiego && cicloNormalExecutor
          ? "generation" : "mtime");
      return {
        autoridadeUsada: generationConclusiva ? "generation" : "mtime",
        generationConclusiva,
        fallbackMtime: !generationConclusiva,
        motivo: generationConclusiva ? "generation_viva_mais_nova" : "authority_not_ready"
      };
    },
    aplicarFastPath: async () => {
      seam.fast += 1;
      return { ok: true, filaClienteHotState: [], pendentes: 0 };
    },
    carregarLegado: async () => { seam.legacy += 1; }
  });
  return { calls, seam, result };
}

function assertObservation(observation, expected = {}) {
  assert(observation, "evento de observabilidade deve existir");
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(observation[key], value, `observação.${key}`);
  }
  assert.strictEqual(typeof observation.timestamp, "string");
  assert.deepStrictEqual(
    Object.keys(observation).sort(),
    [
      "executorAuthority",
      "fallbackMtime",
      "generationConclusiva",
      "globalAuthority",
      "motivo",
      "readinessAttempted",
      "readinessMotivo",
      "readinessMs",
      "readinessReady",
      "selected",
      "timestamp",
      "workspace"
    ].sort(),
    "evento compacto não deve conter dados de oferta/comerciais"
  );
  assert.strictEqual(typeof observation.readinessAttempted, "boolean");
  assert.strictEqual(typeof observation.readinessReady, "boolean");
  assert.strictEqual(typeof observation.readinessMotivo, "string");
  assert.strictEqual(typeof observation.readinessMs, "number");
}

async function main() {
  {
    const { controlador, calls } = criarControladorReadinessTeste();
    assert.strictEqual(typeof controlador.prepararReadinessAutoridadeRecovery, "function");
    const readiness = await controlador.prepararReadinessAutoridadeRecovery(workspaceDiego);
    assert.strictEqual(readiness.ready, true);
    assert.deepStrictEqual(calls, { prepare: 1, path: 1, read: 1 });
  }

  {
    const run = await runControllerBoundary();
    assert.deepStrictEqual({
      prepare: run.calls.prepare,
      reconcile: run.seam.reconcile,
      fast: run.seam.fast,
      legacy: run.seam.legacy
    }, { prepare: 1, reconcile: 1, fast: 1, legacy: 0 });
    assert.strictEqual(run.result.fastPathExecutor, true);
  }

  {
    const run = await runControllerBoundary({ generationConclusiva: false });
    assert.deepStrictEqual({
      prepare: run.calls.prepare,
      reconcile: run.seam.reconcile,
      fast: run.seam.fast,
      legacy: run.seam.legacy
    }, { prepare: 1, reconcile: 1, fast: 0, legacy: 1 });
  }

  for (const opcoes of [
    { env: envExecutor({ enabled: "0" }), generationConclusiva: false },
    { workspace: workspaceForaCanary, generationConclusiva: false },
    { dirtyLocal: true }
  ]) {
    const run = await runControllerBoundary(opcoes);
    assert.strictEqual(run.calls.prepare, 0, "readiness só executa no Executor canário limpo");
  }

  for (const contexto of ["Radar", "expiração", "pulo rápido"]) {
    const run = await runControllerBoundary({ cicloNormalExecutor: false, generationConclusiva: false });
    assert.strictEqual(run.calls.prepare, 0, `${contexto}: sem sync readiness`);
  }

  {
    const currentEnv = envExecutor({ enabled: "0" });
    const run = await runBoundary({ env: currentEnv, decision: {
      autoridadeSolicitada: "mtime",
      autoridadeUsada: "mtime",
      generationConclusiva: false,
      fallbackMtime: false,
      maisNova: true,
      motivo: "authority_mtime"
    } });
    assert.strictEqual(run.reconcileEnv, currentEnv, "flag OFF mantém exatamente o env global");
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "mtime");
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 1, fastPath: 0, legacy: 1 });
    assert.strictEqual(run.observed.length, 0, "flag OFF não deve adicionar ruído de log");
  }

  {
    const currentEnv = envExecutor();
    delete currentEnv[FLAG_EXECUTOR];
    delete currentEnv[FLAG_GLOBAL];
    const resolved = resolverEscopo({
      clienteId: workspaceDiego,
      env: currentEnv,
      cicloNormalExecutor: true,
      deveUsarFilaV2: () => true
    });
    assert.strictEqual(resolved.globalAuthority, "mtime", "flag global ausente continua significando mtime");
    assert.strictEqual(resolved.selected, false, "flag dedicada ausente fica OFF");
    assert.strictEqual(resolved.env, currentEnv, "sem seleção não criar env override");
    const run = await runBoundary({ env: currentEnv, decision: {
      autoridadeSolicitada: "mtime",
      autoridadeUsada: "mtime",
      generationConclusiva: false,
      fallbackMtime: false,
      maisNova: true,
      motivo: "authority_mtime"
    } });
    assert.strictEqual(run.reconcileEnv, currentEnv, "flag ausente deve permanecer OFF e preservar env global");
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 1, fastPath: 0, legacy: 1 });
    assert.strictEqual(run.observed.length, 0);
  }

  {
    const run = await runBoundary({
      workspace: workspaceForaCanary,
      decision: {
        autoridadeSolicitada: "mtime",
        autoridadeUsada: "mtime",
        generationConclusiva: false,
        fallbackMtime: true,
        maisNova: true,
        motivo: "off_canary_fallback_mtime"
      }
    });
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "mtime", "workspace fora do canário não recebe override");
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 1, fastPath: 0, legacy: 1 });
    assert.strictEqual(run.observed.length, 0, "workspace fora do canário dedicado não gera evento do canário");
  }

  {
    const run = await runBoundary({
      operational: false,
      decision: {
        autoridadeSolicitada: "mtime",
        autoridadeUsada: "mtime",
        generationConclusiva: false,
        fallbackMtime: true,
        maisNova: true,
        motivo: "off_canary_fallback_mtime"
      }
    });
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "mtime", "V2 operacional inelegível não recebe override");
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 1, fastPath: 0, legacy: 1 });
    assertObservation(run.observed[0], {
      selected: false,
      motivo: "off_canary_fallback_mtime",
      readinessAttempted: false,
      readinessReady: false,
      readinessMotivo: "nao_solicitada"
    });
  }

  for (const [workspace, maisNova, motivo] of [
    [workspaceDiego, true, "generation_viva_mais_nova"],
    [workspaceWolf, false, "generation_legado_cobre_viva"]
  ]) {
    const run = await runBoundary({ workspace, decision: {
      autoridadeSolicitada: "generation",
      autoridadeUsada: "generation",
      generationConclusiva: true,
      maisNova,
      fallbackMtime: false,
      motivo
    } });
    assert.notStrictEqual(run.reconcileEnv, run.env, "override deve ser uma cópia de env, sem mutar o global");
    assert.strictEqual(run.env[FLAG_GLOBAL], "mtime", "env global não pode ser modificado");
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "generation");
    assert.deepStrictEqual(run.calls, { prepare: 1, reconcile: 1, fastPath: 1, legacy: 0 });
    assert.strictEqual(run.result.fastPathExecutor, true);
    assertObservation(run.observed[0], {
      workspace,
      selected: true,
      motivo: "generation_conclusiva_fast_path",
      globalAuthority: "mtime",
      executorAuthority: "generation",
      generationConclusiva: true,
      fallbackMtime: false,
      readinessAttempted: true,
      readinessReady: true,
      readinessMotivo: "authority_readiness_ready"
    });
  }

  {
    const run = await runBoundary({ dirtyLocal: true });
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 0, fastPath: 0, legacy: 1 }, "dirty local não prepara readiness nem consulta generation/Viva");
    assert.strictEqual(run.result.motivo, "dirty_local");
    assertObservation(run.observed[0], {
      selected: true,
      motivo: "dirty_local",
      executorAuthority: "not_requested",
      generationConclusiva: false,
      readinessAttempted: false,
      readinessReady: false
    });
  }

  const inconclusive = [
    "db_indisponivel",
    "authority_not_ready",
    "pending_ambiguo",
    "viva_proof_mismatch",
    "stat_mismatch",
    "manifest_mismatch",
    "generation_invalida"
  ];
  for (const motivo of inconclusive) {
    const run = await runBoundary({
      decision: {
        autoridadeSolicitada: "generation",
        autoridadeUsada: "mtime",
        generationConclusiva: false,
        fallbackMtime: true,
        maisNova: true,
        motivo
      }
    });
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "generation", `${motivo}: autoridade dedicada solicitada`);
    assert.deepStrictEqual(run.calls, { prepare: 1, reconcile: 1, fastPath: 0, legacy: 1 }, `${motivo}: um único fallback legado`);
    assert.strictEqual(run.result.decision.motivo, motivo);
    assertObservation(run.observed[0], {
      selected: true,
      motivo,
      executorAuthority: "generation",
      generationConclusiva: false,
      fallbackMtime: true,
      readinessAttempted: true,
      readinessReady: true
    });
  }

  for (const motivo of [
    "revision_stale",
    "manifest_indisponivel",
    "manifest_invalido",
    "manifest_write_falhou",
    "repository_readiness_indisponivel"
  ]) {
    const run = await runBoundary({
      readiness: { ok: motivo !== "repository_readiness_indisponivel", ready: false, motivo }
    });
    assert.deepStrictEqual(
      run.calls,
      { prepare: 1, reconcile: 0, fastPath: 0, legacy: 1 },
      `${motivo}: prepare inconclusivo não avalia generation e faz um legado`
    );
    assert.strictEqual(run.result.motivo, motivo);
    assertObservation(run.observed[0], {
      selected: true,
      motivo,
      readinessAttempted: true,
      readinessReady: false,
      readinessMotivo: motivo,
      generationConclusiva: false,
      fallbackMtime: true
    });
  }

  {
    const run = await runBoundary({ prepareError: new Error("db_unavailable") });
    assert.deepStrictEqual(run.calls, { prepare: 1, reconcile: 0, fastPath: 0, legacy: 1 });
    assert.strictEqual(run.result.motivo, "readiness_exception");
    assertObservation(run.observed[0], {
      selected: true,
      readinessAttempted: true,
      readinessReady: false,
      readinessMotivo: "readiness_exception"
    });
  }

  {
    const raceDecision = {
      autoridadeSolicitada: "generation",
      autoridadeUsada: "generation",
      generationConclusiva: true,
      maisNova: true,
      fallbackMtime: false,
      motivo: "generation_viva_mais_nova"
    };
    const run = await runBoundary({
      decision: raceDecision,
      afterPrepare: () => {
        raceDecision.autoridadeUsada = "mtime";
        raceDecision.generationConclusiva = false;
        raceDecision.fallbackMtime = true;
        raceDecision.motivo = "authority_not_ready";
      }
    });
    assert.deepStrictEqual(run.calls, { prepare: 1, reconcile: 1, fastPath: 0, legacy: 1 });
    assert.strictEqual(run.result.decision.motivo, "authority_not_ready");
    assertObservation(run.observed[0], {
      selected: true,
      motivo: "authority_not_ready",
      readinessAttempted: true,
      readinessReady: true,
      generationConclusiva: false
    });
  }

  for (const contexto of ["Radar", "expiração", "pulo rápido"]) {
    const run = await runBoundary({
      normalExecutorCycle: false,
      decision: {
        autoridadeSolicitada: "mtime",
        autoridadeUsada: "mtime",
        generationConclusiva: false,
        fallbackMtime: false,
        maisNova: true,
        motivo: "authority_mtime"
      }
    });
    assert.strictEqual(run.reconcileEnv, run.env, `${contexto}: env global permanece intacto`);
    assert.strictEqual(run.reconcileEnv[FLAG_GLOBAL], "mtime", `${contexto}: autoridade continua mtime`);
    assert.deepStrictEqual(run.calls, { prepare: 0, reconcile: 1, fastPath: 0, legacy: 1 }, `${contexto}: fallback legado preservado`);
    assertObservation(run.observed[0], {
      selected: false,
      motivo: "authority_mtime",
      executorAuthority: "mtime",
      readinessAttempted: false
    });
  }

  {
    const run = await runBoundary({ throwLogger: true });
    assert.strictEqual(run.result.fastPathExecutor, true, "falha de observabilidade não pode afetar fast path");
    assert.deepStrictEqual(run.calls, { prepare: 1, reconcile: 1, fastPath: 1, legacy: 0 });
  }

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.strictEqual(
    (indexSource.match(/executorGenerationAuthority:\s*true/g) || []).length,
    1,
    "marcador dedicado deve existir somente no ciclo normal do Executor"
  );
  assert(indexSource.includes("prepararReadinessAutoridadeRecovery(workspace)"), "ciclo Executor deve injetar readiness síncrona");
  const radarStart = indexSource.indexOf("reconciliarFilaV2ParaLeituraCliente(clienteId, \"radar\")");
  assert(radarStart >= 0, "chamada Radar deve continuar presente");
  const expiryStart = indexSource.indexOf("function validarFonteClienteHotStateExpiracaoV2");
  const expiryEnd = indexSource.indexOf("const filaInteligenteUltimoAbastecimento", expiryStart);
  assert(expiryStart >= 0 && expiryEnd > expiryStart, "fronteira factual de expiração deve ser localizável");
  const expirySource = indexSource.slice(expiryStart, expiryEnd);
  assert(!expirySource.includes("executorGenerationAuthority"), "expiração não recebe override dedicado");
  assert(!expirySource.includes("reconciliacaoLeituraFilaV2"), "expiração não deve reinterpretar reconciliação bruta");
  const quickStart = indexSource.indexOf("async function reconciliarPuloRapidoFilaV2");
  const quickEnd = indexSource.indexOf("async function rodarProcessadorFilaGlobal", quickStart);
  const quickSource = indexSource.slice(quickStart, quickEnd);
  assert(quickSource.includes("process.env.FILA_V2_RECOVERY_AUTORIDADE"), "pulo rápido permanece atrelado à flag global");
  assert(!quickSource.includes("executorGenerationAuthority"), "pulo rápido não recebe override dedicado");
  assert(quickSource.includes("reconciliarFilaV2ParaLeituraCliente(cliente, \"executor\")"), "pulo rápido conserva a chamada antiga sem marcador");
  assert(indexSource.slice(radarStart, radarStart + 100).includes("reconciliarFilaV2ParaLeituraCliente(clienteId, \"radar\")"));

  console.log("executor generation authority ok");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
