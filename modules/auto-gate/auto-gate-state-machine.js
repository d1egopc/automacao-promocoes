// Phase 1 only: these are counterfactual recommendations, never commands.
// Evidence/dwell defaults are provisional Shadow settings, not production gates.
const DEFAULT_SHADOW_POLICY = Object.freeze({
  minEvidenceCycles: 2,
  minDwellCycles: 2,
  cooldownCycles: 2,
  allowBoostSuggestion: false
});

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

function normalizarPolitica(policy = {}) {
  return {
    minEvidenceCycles: positiveInteger(policy.minEvidenceCycles, DEFAULT_SHADOW_POLICY.minEvidenceCycles),
    minDwellCycles: positiveInteger(policy.minDwellCycles, DEFAULT_SHADOW_POLICY.minDwellCycles),
    cooldownCycles: positiveInteger(policy.cooldownCycles, DEFAULT_SHADOW_POLICY.cooldownCycles),
    allowBoostSuggestion: policy.allowBoostSuggestion === true
  };
}

function metricasCompletas(metrics) {
  const numbers = ["inputRadar", "inputTeleRadar", "inputTotal", "outputRate", "queueDepthActionable",
    "oldestActionableAge", "freshReserveObservada", "capacityEffectiveKnown", "capacityUnknownWorkspaces", "capacityUnknownSlots"];
  return metrics.ok === true && Array.isArray(metrics.sinaisAusentes) && metrics.sinaisAusentes.length === 0
    && numbers.every(key => typeof metrics[key] === "number" && Number.isFinite(metrics[key]) && metrics[key] >= 0)
    && typeof metrics.capacityEffectiveComplete === "boolean"
    && metrics.capacityEffectiveComplete === (metrics.capacityUnknownWorkspaces === 0)
    && typeof metrics.radarOperacional?.enabled === "boolean"
    && typeof metrics.radarOperacional?.withinSchedule === "boolean"
    && typeof metrics.radarOperacional?.sourceConfigured === "boolean"
    && typeof metrics.teleRadarOperacional?.enabled === "boolean"
    && typeof metrics.teleRadarOperacional?.withinSchedule === "boolean"
    && typeof metrics.teleRadarOperacional?.listenerActive === "boolean"
    && typeof metrics.teleRadarOperacional?.accountAuthorized === "boolean"
    && Number.isSafeInteger(metrics.teleRadarOperacional?.selectedSourceCount)
    && metrics.teleRadarOperacional.selectedSourceCount >= 0;
}

function statusFonte({ tipo, withinSchedule, sourceConfigured = true, accountAuthorized = true, selectedSourceCount = 1, listenerActive = true } = {}) {
  const prerequisitosPendentes = [];
  if (withinSchedule !== true) prerequisitosPendentes.push("fora_da_janela");
  if (tipo === "teleradar" && accountAuthorized !== true) prerequisitosPendentes.push("sessao_indisponivel");
  if (tipo === "teleradar" && selectedSourceCount <= 0) prerequisitosPendentes.push("fonte_nao_selecionada");
  if (tipo === "teleradar" && listenerActive !== true) prerequisitosPendentes.push("listener_inativo");
  const elegivelParaRecomendacao = withinSchedule === true
    && sourceConfigured === true
    && (tipo !== "teleradar" || (accountAuthorized === true && selectedSourceCount > 0));
  const prontoParaExecucao = elegivelParaRecomendacao && (tipo !== "teleradar" || listenerActive === true);
  return {
    elegivelParaRecomendacao,
    prontoParaExecucao,
    autorizadoParaExecucao: false,
    executavelAgora: false,
    prerequisitosPendentes: [...prerequisitosPendentes, "autoridade_manual_nao_inferida"]
  };
}

function enriquecerProposta(proposta, alvo, status = {}) {
  const fonteStatus = alvo ? status[alvo] : null;
  return {
    ...proposta,
    fonteAlvo: alvo || null,
    elegivelParaRecomendacao: fonteStatus?.elegivelParaRecomendacao ?? null,
    prontoParaExecucao: fonteStatus?.prontoParaExecucao ?? null,
    autorizadoParaExecucao: fonteStatus?.autorizadoParaExecucao ?? false,
    executavelAgora: fonteStatus?.executavelAgora ?? false,
    prerequisitosPendentes: fonteStatus?.prerequisitosPendentes || []
  };
}

function propostaBruta(metrics, previous, policy) {
  const radar = metrics.radarOperacional;
  const tele = metrics.teleRadarOperacional;
  const depth = metrics.queueDepthActionable;
  const age = metrics.oldestActionableAge;
  const capacity = metrics.capacityEffectiveKnown;
  const capacityComplete = metrics.capacityEffectiveComplete;
  const status = {
    radar: statusFonte({ tipo: "radar", withinSchedule: radar.withinSchedule, sourceConfigured: radar.sourceConfigured }),
    teleradar: statusFonte({
      tipo: "teleradar",
      withinSchedule: tele.withinSchedule,
      sourceConfigured: tele.selectedSourceCount > 0,
      accountAuthorized: tele.accountAuthorized,
      selectedSourceCount: tele.selectedSourceCount,
      listenerActive: tele.listenerActive
    })
  };
  const radarCapturando = radar.enabled && status.radar.prontoParaExecucao && metrics.inputRadar > 0;
  const teleCapturando = tele.enabled && status.teleradar.prontoParaExecucao && metrics.inputTeleRadar > 0;
  const hold = radarCapturando && (!teleCapturando || metrics.inputRadar >= metrics.inputTeleRadar)
    ? "HOLD_RADAR" : teleCapturando ? "HOLD_TELERADAR" : null;

  if (capacityComplete && capacity === 0 && depth > 0) {
    return enriquecerProposta({ estado: "SATURADO", decisao: hold || "MANTER", motivo: "sem_slots_com_fila_viva" }, null, status);
  }
  if (previous && depth > previous.queueDepthActionable && age > previous.oldestActionableAge
    && metrics.inputTotal > 0) {
    return enriquecerProposta({ estado: "PRESSAO_ALTA", decisao: hold || "MANTER", motivo: "fila_e_idade_crescentes" }, null, status);
  }
  if (!capacityComplete) {
    return enriquecerProposta({ estado: "CAPACIDADE_INCONCLUSIVA", decisao: "MANTER", motivo: "capacidade_inconclusiva" }, null, status);
  }
  if (previous && ["PRESSAO_ALTA", "SATURADO"].includes(previous.estado)
    && depth <= previous.queueDepthActionable && age <= previous.oldestActionableAge) {
    return enriquecerProposta({ estado: "RECUPERACAO", decisao: "MANTER", motivo: "pressao_recuando" }, null, status);
  }
  // Zero queue is an unambiguous low-reserve case. For nonzero queue the
  // five-minute bucket is only a proxy, so it cannot alone open a source.
  if (depth === 0 && metrics.freshReserveObservada === 0 && metrics.outputRate > 0 && capacity > 0) {
    if (policy.allowBoostSuggestion && radar.enabled && tele.enabled && status.radar.elegivelParaRecomendacao && status.teleradar.elegivelParaRecomendacao
      && metrics.inputRadar === 0 && metrics.inputTeleRadar === 0) {
      return enriquecerProposta({ estado: "NECESSIDADE", decisao: "BOOST_TEMPORARIO", motivo: "ambas_fontes_quietas_sem_reserva" }, null, status);
    }
    if (radar.enabled && status.radar.elegivelParaRecomendacao && metrics.inputRadar === 0 && !tele.enabled
      && status.teleradar.prerequisitosPendentes.includes("fora_da_janela")) {
      return enriquecerProposta({ estado: "NECESSIDADE", decisao: "NAO_INTERVIR", motivo: "teleradar_fora_da_janela" }, "teleradar", status);
    }
    if (radar.enabled && status.radar.elegivelParaRecomendacao && metrics.inputRadar === 0 && !tele.enabled) {
      return enriquecerProposta({ estado: "NECESSIDADE", decisao: "ABRIR_TELERADAR", motivo: "radar_quieto_sem_reserva" }, "teleradar", status);
    }
    if (tele.enabled && status.teleradar.elegivelParaRecomendacao && metrics.inputTeleRadar === 0 && !radar.enabled
      && status.radar.elegivelParaRecomendacao) {
      return enriquecerProposta({ estado: "NECESSIDADE", decisao: "ABRIR_RADAR", motivo: "teleradar_quieto_sem_reserva" }, "radar", status);
    }
  }
  return enriquecerProposta({ estado: "NORMAL", decisao: "MANTER", motivo: "sem_pressao_conclusiva" }, null, status);
}

function resultadoComDecisao(proposal, decisao, motivo, history) {
  return {
    estadoSugerido: proposal.estado,
    decisaoSugerida: decisao,
    motivo,
    fonteAlvo: proposal.fonteAlvo,
    elegivelParaRecomendacao: proposal.elegivelParaRecomendacao,
    prontoParaExecucao: proposal.prontoParaExecucao,
    autorizadoParaExecucao: proposal.autorizadoParaExecucao,
    executavelAgora: proposal.executavelAgora,
    prerequisitosPendentes: proposal.prerequisitosPendentes,
    history
  };
}

function avaliarShadow(metrics = {}, previousHistory = {}, policyInput = {}) {
  const policy = normalizarPolitica(policyInput);
  const cycle = (previousHistory.cycle || 0) + 1;
  if (!metricasCompletas(metrics)) {
    return {
      estadoSugerido: "NORMAL",
      decisaoSugerida: "NAO_INTERVIR",
      motivo: "sinais_insuficientes",
      fonteAlvo: null,
      elegivelParaRecomendacao: false,
      prontoParaExecucao: false,
      autorizadoParaExecucao: false,
      executavelAgora: false,
      prerequisitosPendentes: ["sinais_insuficientes"],
      history: { ...previousHistory, cycle, candidate: "", evidenceCycles: 0 }
    };
  }
  const previous = previousHistory.metrics || null;
  const proposal = propostaBruta(metrics, previous, policy);
  const evidenceCycles = previousHistory.candidate === proposal.decisao
    ? (previousHistory.evidenceCycles || 0) + 1 : 1;
  const lastChangeCycle = previousHistory.lastChangeCycle || 0;
  const lastStateCycle = previousHistory.lastStateCycle || 0;
  const baseline = {
    cycle,
    candidate: proposal.decisao,
    evidenceCycles,
    metrics: {
      queueDepthActionable: metrics.queueDepthActionable,
      oldestActionableAge: metrics.oldestActionableAge,
      estado: proposal.estado
    },
    lastDecision: previousHistory.lastDecision || "MANTER",
    lastChangeCycle,
    lastState: previousHistory.lastState || "NORMAL",
    lastStateCycle
  };
  if (proposal.decisao === "MANTER") {
    return resultadoComDecisao(proposal, "MANTER", proposal.motivo, { ...baseline, lastState: proposal.estado, lastStateCycle: cycle });
  }
  if (evidenceCycles < policy.minEvidenceCycles) {
    return resultadoComDecisao(proposal, "MANTER", "evidencia_ainda_nao_sustentada", baseline);
  }
  if (previousHistory.lastDecision !== proposal.decisao && lastChangeCycle > 0
    && cycle - lastChangeCycle < policy.cooldownCycles) {
    return resultadoComDecisao(proposal, "MANTER", "cooldown_shadow", baseline);
  }
  if (previousHistory.lastState && previousHistory.lastState !== proposal.estado
    && lastStateCycle > 0 && cycle - lastStateCycle < policy.minDwellCycles) {
    return resultadoComDecisao(proposal, "MANTER", "permanencia_minima_shadow", baseline);
  }
  return resultadoComDecisao(proposal, proposal.decisao, proposal.motivo, {
    history: {
      ...baseline,
      lastDecision: proposal.decisao,
      lastChangeCycle: previousHistory.lastDecision === proposal.decisao ? lastChangeCycle : cycle,
      lastState: proposal.estado,
      lastStateCycle: previousHistory.lastState === proposal.estado ? lastStateCycle : cycle
    }
  }.history);
}

module.exports = { avaliarShadow, normalizarPolitica, DEFAULT_SHADOW_POLICY };
