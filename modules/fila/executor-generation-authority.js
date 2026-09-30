"use strict";

const FLAG_EXECUTOR = "FILA_V2_EXECUTOR_GENERATION_AUTHORITY";
const FLAG_CANARY = "FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES";
const FLAG_GLOBAL = "FILA_V2_RECOVERY_AUTORIDADE";

function autoridadeGlobal(env = process.env) {
  return String(env?.[FLAG_GLOBAL] || "mtime").trim().toLowerCase() === "generation"
    ? "generation"
    : "mtime";
}

function clientesCanary(env = process.env) {
  return new Set(
    String(env?.[FLAG_CANARY] || "")
      .split(",")
      .map(cliente => cliente.trim())
      .filter(Boolean)
  );
}

function resolverEscopo({
  clienteId,
  env = process.env,
  cicloNormalExecutor = false,
  deveUsarFilaV2 = () => false
} = {}) {
  const cliente = String(clienteId || "admin").trim();
  const globalAuthority = autoridadeGlobal(env);
  let selected = false;
  let motivo = "fora_ciclo_executor_normal";

  if (cicloNormalExecutor !== true) {
    motivo = "fora_ciclo_executor_normal";
  } else if (String(env?.[FLAG_EXECUTOR] || "0").trim() !== "1") {
    motivo = "flag_executor_desligada";
  } else if (!clientesCanary(env).has(cliente)) {
    motivo = "workspace_fora_canario_executor";
  } else {
    let operacional = false;
    try {
      operacional = deveUsarFilaV2(cliente) === true;
    } catch {
      operacional = false;
    }
    if (operacional) {
      selected = true;
      motivo = "executor_generation_canary";
    } else {
      motivo = "fila_v2_operacional_off";
    }
  }

  const effectiveEnv = selected
    ? { ...env, [FLAG_GLOBAL]: "generation" }
    : env;

  return {
    clienteId: cliente,
    selected,
    motivo,
    globalAuthority,
    executorAuthority: selected ? "generation" : globalAuthority,
    env: effectiveEnv
  };
}

function emitirObservacao(logger, dados) {
  try {
    if (typeof logger === "function") logger(dados);
  } catch {
    // Observabilidade nunca altera a decisão nem o fallback.
  }
}

async function executarPreflightExecutor({
  clienteId,
  env = process.env,
  cicloNormalExecutor = false,
  dirtyLocal = false,
  deveUsarFilaV2,
  reconciliar,
  aplicarFastPath,
  carregarLegado,
  avaliarFallbackMtime,
  aoInconclusivo,
  logger
} = {}) {
  if (typeof reconciliar !== "function" || typeof aplicarFastPath !== "function" || typeof carregarLegado !== "function") {
    throw new TypeError("Executor preflight requer reconcile, fastPath e legacyLoader");
  }

  const escopo = resolverEscopo({
    clienteId,
    env,
    cicloNormalExecutor,
    deveUsarFilaV2
  });
  const observarCanario = (
    String(env?.[FLAG_EXECUTOR] || "0").trim() === "1" &&
    clientesCanary(env).has(escopo.clienteId)
  );
  const observar = dados => {
    if (observarCanario) emitirObservacao(logger, dados);
  };
  const observado = {
    workspace: escopo.clienteId,
    selected: escopo.selected,
    motivo: dirtyLocal === true ? "dirty_local" : escopo.motivo,
    globalAuthority: escopo.globalAuthority,
    executorAuthority: dirtyLocal === true ? "not_requested" : escopo.executorAuthority,
    generationConclusiva: false,
    fallbackMtime: false,
    timestamp: new Date().toISOString()
  };

  if (dirtyLocal === true) {
    await carregarLegado();
    observar(observado);
    return { decision: null, fastPathExecutor: false, legacyLoaded: true, motivo: "dirty_local" };
  }

  let decision = await reconciliar({
    clienteId: escopo.clienteId,
    env: escopo.env,
    selected: escopo.selected
  });

  if (decision?.generationConclusiva === true) {
    const fastPath = await aplicarFastPath(decision);
    if (fastPath?.ok === true) {
      observado.motivo = "generation_conclusiva_fast_path";
      observado.generationConclusiva = true;
      observado.fallbackMtime = decision.fallbackMtime === true;
      observar(observado);
      return { decision, fastPath, fastPathExecutor: true, legacyLoaded: false };
    }

    if (typeof avaliarFallbackMtime === "function") {
      decision = await avaliarFallbackMtime(fastPath, decision);
    }
    observado.motivo = fastPath?.motivo || decision?.motivo || "fast_path_viva_indisponivel";
  } else {
    if (typeof aoInconclusivo === "function") {
      try {
        aoInconclusivo(decision);
      } catch {
        // O logger operacional de fallback também não pode impedir o legado.
      }
    }
    observado.motivo = decision?.motivo || "generation_inconclusiva";
  }

  observado.generationConclusiva = decision?.generationConclusiva === true;
  observado.fallbackMtime = decision?.fallbackMtime === true;
  await carregarLegado();
  observar(observado);
  return { decision, fastPathExecutor: false, legacyLoaded: true };
}

module.exports = {
  FLAG_EXECUTOR,
  FLAG_CANARY,
  FLAG_GLOBAL,
  autoridadeGlobal,
  clientesCanary,
  resolverEscopo,
  executarPreflightExecutor
};
