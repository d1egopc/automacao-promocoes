const { coletarMetricasShadow, parseObservedWorkspaceIds } = require("./auto-gate-metrics.service");
const { avaliarShadow, DEFAULT_SHADOW_POLICY } = require("./auto-gate-state-machine");
const { montarTelemetria, logarTelemetria } = require("./auto-gate-telemetry");
const { criarMedidorCiclo, comMedidorCiclo } = require("../telemetria/ciclo-observabilidade");

function shadowPolicyFromEnv(env = process.env) {
  return {
    minEvidenceCycles: Number(env.AUTO_GATE_SHADOW_EVIDENCE_CYCLES || DEFAULT_SHADOW_POLICY.minEvidenceCycles),
    minDwellCycles: Number(env.AUTO_GATE_SHADOW_DWELL_CYCLES || DEFAULT_SHADOW_POLICY.minDwellCycles),
    cooldownCycles: Number(env.AUTO_GATE_SHADOW_COOLDOWN_CYCLES || DEFAULT_SHADOW_POLICY.cooldownCycles),
    allowBoostSuggestion: env.AUTO_GATE_SHADOW_BOOST_EXPERIMENTAL === "true"
  };
}

function createAutoGateShadow({
  collectMetrics = coletarMetricasShadow,
  evaluate = avaliarShadow,
  log = logarTelemetria,
  clock = Date.now,
  policy = shadowPolicyFromEnv(),
  observedWorkspaceIds = parseObservedWorkspaceIds(process.env.AUTO_GATE_SHADOW_WORKSPACES)
} = {}) {
  let running = false;
  let history = {};
  let lastCycleId = "";
  return Object.freeze({
    async observe({ cicloId = "", ofc = {}, getRadarOperational, getTeleRadarOperational } = {}) {
      if (running || cicloId === lastCycleId) {
        return { ok: true, skipped: true, reason: "shadow_cycle_duplicate" };
      }
      running = true;
      const startedAt = clock();
      const medidor = criarMedidorCiclo();
      const previousCycleId = lastCycleId;
      try {
        const metrics = await medidor.medir("coletaMetricas", () => collectMetrics({
          ofc,
          getRadarOperational,
          getTeleRadarOperational,
          observedWorkspaceIds,
          now: startedAt,
          clock
        }));
        const machineStartedAt = clock();
        const machinePerfStartedAt = medidor.clock();
        const result = evaluate(metrics, history, policy);
        medidor.registrarEtapa("maquinaEstados", medidor.clock() - machinePerfStartedAt);
        const maquinaEstadosMs = Math.max(0, clock() - machineStartedAt);
        history = result.history;
        lastCycleId = cicloId;
        const telemetry = montarTelemetria({
          cicloId,
          metrics,
          result,
          previousCycleId,
          maquinaEstadosMs,
          duracaoCalculoMs: Math.max(0, clock() - startedAt)
        });
        comMedidorCiclo(medidor, () => log(telemetry));
        return { ok: true, mode: "shadow", appliedChanges: false, telemetry };
      } catch {
        const telemetry = montarTelemetria({
          cicloId,
          metrics: { observedAtMs: startedAt, sinaisAusentes: ["coleta_shadow_falhou"], confiancaDosSinais: "insuficiente" },
          result: { estadoSugerido: "NORMAL", decisaoSugerida: "NAO_INTERVIR", motivo: "sinais_insuficientes" },
          previousCycleId,
          maquinaEstadosMs: null,
          duracaoCalculoMs: Math.max(0, clock() - startedAt)
        });
        lastCycleId = cicloId;
        comMedidorCiclo(medidor, () => log(telemetry));
        return { ok: false, mode: "shadow", appliedChanges: false, telemetry };
      } finally {
        // Independente do ciclo comercial; nao passa a aguardar observe().
        try { console.log("[AUTO-GATE-CICLO-PERF-SHADOW]", JSON.stringify({ cicloId, modo: "shadow",
          aplicouMudancas: false, ...medidor.finalizar() })); } catch {}
        running = false;
      }
    }
  });
}

module.exports = { createAutoGateShadow, shadowPolicyFromEnv };
