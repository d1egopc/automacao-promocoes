"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
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
  throwLogger = false
} = {}) {
  const calls = { reconcile: 0, fastPath: 0, legacy: 0 };
  const observed = [];
  let reconcileEnv;
  const result = await executarPreflightExecutor({
    clienteId: workspace,
    env,
    cicloNormalExecutor: normalExecutorCycle,
    dirtyLocal,
    deveUsarFilaV2: () => operational,
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
      "selected",
      "timestamp",
      "workspace"
    ].sort(),
    "evento compacto não deve conter dados de oferta/comerciais"
  );
}

async function main() {
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 });
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 });
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 });
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 });
    assertObservation(run.observed[0], { selected: false, motivo: "off_canary_fallback_mtime" });
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 1, legacy: 0 });
    assert.strictEqual(run.result.fastPathExecutor, true);
    assertObservation(run.observed[0], {
      workspace,
      selected: true,
      motivo: "generation_conclusiva_fast_path",
      globalAuthority: "mtime",
      executorAuthority: "generation",
      generationConclusiva: true,
      fallbackMtime: false
    });
  }

  {
    const run = await runBoundary({ dirtyLocal: true });
    assert.deepStrictEqual(run.calls, { reconcile: 0, fastPath: 0, legacy: 1 }, "dirty local não consulta generation nem Viva");
    assert.strictEqual(run.result.motivo, "dirty_local");
    assertObservation(run.observed[0], {
      selected: true,
      motivo: "dirty_local",
      executorAuthority: "not_requested",
      generationConclusiva: false
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 }, `${motivo}: um único fallback legado`);
    assert.strictEqual(run.result.decision.motivo, motivo);
    assertObservation(run.observed[0], {
      selected: true,
      motivo,
      executorAuthority: "generation",
      generationConclusiva: false,
      fallbackMtime: true
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
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 0, legacy: 1 }, `${contexto}: fallback legado preservado`);
    assertObservation(run.observed[0], { selected: false, motivo: "authority_mtime", executorAuthority: "mtime" });
  }

  {
    const run = await runBoundary({ throwLogger: true });
    assert.strictEqual(run.result.fastPathExecutor, true, "falha de observabilidade não pode afetar fast path");
    assert.deepStrictEqual(run.calls, { reconcile: 1, fastPath: 1, legacy: 0 });
  }

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.strictEqual(
    (indexSource.match(/executorGenerationAuthority:\s*true/g) || []).length,
    1,
    "marcador dedicado deve existir somente no ciclo normal do Executor"
  );
  const radarStart = indexSource.indexOf("reconciliarFilaV2ParaLeituraCliente(clienteId, \"radar\")");
  assert(radarStart >= 0, "chamada Radar deve continuar presente");
  const expiryStart = indexSource.indexOf("async function candidatosExpiracaoSelecaoFilaV2");
  const expiryEnd = indexSource.indexOf("async function ", expiryStart + 20);
  assert(expiryStart >= 0 && expiryEnd > expiryStart, "função de seleção por expiração deve ser localizável");
  const expirySource = indexSource.slice(expiryStart, expiryEnd);
  assert(!expirySource.includes("executorGenerationAuthority"), "expiração não recebe override dedicado");
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
