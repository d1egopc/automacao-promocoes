const { medirSerializacaoExistente } = require("../telemetria/ciclo-observabilidade");

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeCode(value) {
  const code = String(value || "");
  return /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : "indisponivel";
}

function montarTelemetria({ cicloId, metrics = {}, result = {}, previousCycleId = "", maquinaEstadosMs = null, duracaoCalculoMs = 0 } = {}) {
  return {
    timestamp: new Date(metrics.observedAtMs || Date.now()).toISOString(),
    cicloId: safeCode(cicloId),
    cicloAnteriorId: previousCycleId ? safeCode(previousCycleId) : null,
    modo: "shadow",
    aplicouMudancas: false,
    recomendacaoContraFactual: true,
    autoridadeManualNaoInferida: true,
    estadoSugerido: safeCode(result.estadoSugerido),
    decisaoSugerida: safeCode(result.decisaoSugerida),
    motivo: safeCode(result.motivo),
    fonteAlvo: result.fonteAlvo === "radar" || result.fonteAlvo === "teleradar" ? result.fonteAlvo : null,
    elegivelParaRecomendacao: result.elegivelParaRecomendacao === true,
    prontoParaExecucao: result.prontoParaExecucao === true,
    autorizadoParaExecucao: result.autorizadoParaExecucao === true,
    executavelAgora: result.executavelAgora === true,
    prerequisitosPendentes: Array.isArray(result.prerequisitosPendentes)
      ? result.prerequisitosPendentes.map(safeCode).slice(0, 10) : [],
    confiancaDosSinais: safeCode(metrics.confiancaDosSinais),
    inputRadar: safeNumber(metrics.inputRadar),
    inputTeleRadar: safeNumber(metrics.inputTeleRadar),
    inputTotal: safeNumber(metrics.inputTotal),
    inputUnit: "eventos_engine_aceitos_por_minuto",
    outputRate: safeNumber(metrics.outputRate),
    drenagemObservacional: metrics.drenagemObservacional || null,
    outputUnit: "envios_confirmados_por_destino_por_minuto",
    queueDepthObservado: safeNumber(metrics.queueDepthObservado),
    oldestAgeObservada: safeNumber(metrics.oldestAgeObservada),
    queueDepthRaw: safeNumber(metrics.queueDepthRaw),
    queueDepthActionable: safeNumber(metrics.queueDepthActionable),
    oldestAgeRaw: safeNumber(metrics.oldestAgeRaw),
    oldestActionableAge: safeNumber(metrics.oldestActionableAge),
    oldestHistoricalAge: safeNumber(metrics.oldestHistoricalAge),
    capacityTheoretical: safeNumber(metrics.capacityTheoretical),
    capacityEffective: safeNumber(metrics.capacityEffective),
    capacityEffectiveKnown: safeNumber(metrics.capacityEffectiveKnown),
    capacityEffectiveComplete: typeof metrics.capacityEffectiveComplete === "boolean"
      ? metrics.capacityEffectiveComplete : null,
    capacityUnknownWorkspaces: safeNumber(metrics.capacityUnknownWorkspaces),
    capacityUnknownSlots: safeNumber(metrics.capacityUnknownSlots),
    expiredAliveCount: safeNumber(metrics.expiredAliveCount),
    expiredProcessingCount: safeNumber(metrics.expiredProcessingCount),
    expiredPendingCount: safeNumber(metrics.expiredPendingCount),
    freshReserveObservada: safeNumber(metrics.freshReserveObservada),
    freshReserveQuality: "proxy_itens_vivos_ate_5_min",
    availableCapacityObservada: safeNumber(metrics.availableCapacityObservada),
    availableCapacityUnit: "slots_15_minutos",
    radarOperacional: metrics.radarOperacional ? {
      enabled: metrics.radarOperacional.enabled === true,
      withinSchedule: metrics.radarOperacional.withinSchedule === true,
      sourceConfigured: metrics.radarOperacional.sourceConfigured === true
    } : null,
    teleRadarOperacional: metrics.teleRadarOperacional ? {
      enabled: metrics.teleRadarOperacional.enabled === true,
      withinSchedule: metrics.teleRadarOperacional.withinSchedule === true,
      listenerActive: metrics.teleRadarOperacional.listenerActive === true,
      accountAuthorized: metrics.teleRadarOperacional.accountAuthorized === true,
      selectedSourceCount: safeNumber(metrics.teleRadarOperacional.selectedSourceCount)
    } : null,
    observedWorkspaceCount: safeNumber(metrics.observedWorkspaceCount),
    cadastralWorkspaceCount: safeNumber(metrics.cadastralWorkspaceCount),
    excludedWorkspaceCount: safeNumber(metrics.excludedWorkspaceCount),
    snapshotCompleto: metrics.snapshotCompleto === true,
    fontesInvalidasCount: safeNumber(metrics.fontesInvalidasCount),
    fontesInvalidasTotais: safeNumber(metrics.fontesInvalidasTotais),
    fontesInvalidasRelevantes: safeNumber(metrics.fontesInvalidasRelevantes),
    fontesInvalidasIrrelevantes: safeNumber(metrics.fontesInvalidasIrrelevantes),
    observedWorkspaceScope: metrics.observedWorkspaceScope === "global" ? "global" : "subset_calibracao",
    sinaisAusentes: Array.isArray(metrics.sinaisAusentes) ? metrics.sinaisAusentes.map(safeCode).slice(0, 20) : [],
    latenciaOfcSnapshotMs: safeNumber(metrics.latencias?.ofcSnapshotMs),
    latenciaConsultaSqlMs: safeNumber(metrics.latencias?.consultaSqlMs),
    latenciaRadarOperationalMs: safeNumber(metrics.latencias?.radarOperationalMs),
    latenciaTeleRadarOperationalMs: safeNumber(metrics.latencias?.teleRadarOperationalMs),
    latenciaAgregacaoMs: safeNumber(metrics.latencias?.agregacaoMs),
    latenciaMaquinaEstadosMs: safeNumber(maquinaEstadosMs),
    duracaoCalculoMs: safeNumber(duracaoCalculoMs)
  };
}

function logarTelemetria(payload, logger = console) {
  logger.log("[AUTO_GATE_SHADOW]", medirSerializacaoExistente(payload));
}

module.exports = { montarTelemetria, logarTelemetria };
