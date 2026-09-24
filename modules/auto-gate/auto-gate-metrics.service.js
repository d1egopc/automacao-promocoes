const { consultarEntradasRadar } = require("./auto-gate-metrics.repository");

function numeroFinito(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseObservedWorkspaceIds(value = "") {
  return [...new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean))].slice(0, 100);
}

async function coletarMetricasShadow({
  ofc = {},
  getRadarOperational,
  getTeleRadarOperational,
  consultarEntradas = consultarEntradasRadar,
  observedWorkspaceIds = [],
  now = Date.now(),
  maxSignalAgeMs = 5 * 60 * 1000
} = {}) {
  const missing = [];
  const [sourceResult, radarResult, teleResult] = await Promise.allSettled([
    consultarEntradas({ janelaMinutos: 15, now }),
    typeof getRadarOperational === "function" ? getRadarOperational() : Promise.reject(new Error("missing")),
    typeof getTeleRadarOperational === "function" ? getTeleRadarOperational() : Promise.reject(new Error("missing"))
  ]);
  const source = sourceResult.status === "fulfilled" ? sourceResult.value : null;
  const radar = radarResult.status === "fulfilled" ? radarResult.value : null;
  const teleRadar = teleResult.status === "fulfilled" ? teleResult.value : null;
  const commercial = ofc?.fluxoComercial;
  const absorption = ofc?.gateAbsorcao;

  if (source?.ok !== true) missing.push(source?.motivo || "entrada_engine_indisponivel");
  if (source?.ok === true && (!Number.isFinite(source.collectedAtMs)
    || source.collectedAtMs > now + 1000 || now - source.collectedAtMs > maxSignalAgeMs)) {
    missing.push("entrada_engine_obsoleta");
  }
  for (const key of ["inputRadar", "inputTeleRadar", "inputTotal"]) {
    if (numeroFinito(source?.[key]) === null) missing.push(`${key}_invalido`);
  }
  if (source?.ok === true && Number.isFinite(source.inputRadar) && Number.isFinite(source.inputTeleRadar)
    && Number.isFinite(source.inputTotal)
    && Math.abs(source.inputTotal - source.inputRadar - source.inputTeleRadar) > 0.001) {
    missing.push("entrada_engine_inconsistente");
  }
  if (commercial?.ok !== true || commercial?.fontes?.eventosComerciais !== true) missing.push("saida_comercial_indisponivel");
  const outputRate = numeroFinito(commercial?.enviosConfirmadosPorMinuto);
  if (outputRate === null) missing.push("saida_comercial_invalida");
  if (absorption?.ok !== true || !Array.isArray(absorption.workspaces)) missing.push("fila_observada_indisponivel");
  if (source?.janelaMinutos !== 15 || commercial?.janelaMinutos !== 15 || absorption?.janelaMinutos !== 15) {
    missing.push("janelas_observacao_inconsistentes");
  }
  if (!radar || typeof radar.enabled !== "boolean" || typeof radar.withinSchedule !== "boolean"
    || typeof radar.sourceConfigured !== "boolean") missing.push("radar_operacional_indisponivel");
  if (!teleRadar || typeof teleRadar.enabled !== "boolean" || typeof teleRadar.withinSchedule !== "boolean"
    || typeof teleRadar.listenerActive !== "boolean" || typeof teleRadar.accountAuthorized !== "boolean"
    || numeroFinito(teleRadar.selectedSourceCount) === null) missing.push("teleradar_operacional_indisponivel");

  const observedIds = new Set(observedWorkspaceIds);
  const allWorkspaces = absorption?.ok === true ? absorption.workspaces : [];
  const workspaces = observedIds.size
    ? allWorkspaces.filter(item => observedIds.has(String(item.workspaceId || "")))
    : allWorkspaces;
  if (workspaces.length === 0) missing.push("workspaces_observados_ausentes");
  if (observedIds.size && workspaces.length !== observedIds.size) missing.push("workspace_observado_nao_encontrado");

  let queueDepth = 0;
  let oldestAgeMs = 0;
  let freshReserveProxy = 0;
  let availableCapacity = 0;
  for (const workspace of workspaces) {
    const depth = numeroFinito(workspace.pendentesVivos);
    const age = numeroFinito(workspace.idadeMaximaVivaMs);
    const fresh = numeroFinito(workspace.faixasIdade?.itensAte5Min);
    const slots = numeroFinito(workspace.slots15Min);
    if (depth === null || (depth > 0 && age === null) || fresh === null || slots === null
      || numeroFinito(workspace.statusDesconhecido) === null || numeroFinito(workspace.itensSemTimestamp) === null) {
      missing.push("fila_observada_invalida");
      continue;
    }
    if (workspace.statusDesconhecido > 0 || workspace.itensSemTimestamp > 0) missing.push("fila_observada_incompleta");
    queueDepth += depth;
    oldestAgeMs = Math.max(oldestAgeMs, age || 0);
    freshReserveProxy += fresh;
    availableCapacity += slots;
  }
  // Source events are global; a selected workspace subset is for calibration,
  // never a basis for a source-global intervention suggestion.
  if (observedIds.size) missing.push("escopo_workspace_parcial");

  return {
    ok: missing.length === 0,
    sinaisAusentes: [...new Set(missing)].sort(),
    confiancaDosSinais: missing.length ? "insuficiente" : "provisoria_shadow",
    signalCollectedAtMs: source?.collectedAtMs ?? null,
    inputRadar: numeroFinito(source?.inputRadar),
    inputTeleRadar: numeroFinito(source?.inputTeleRadar),
    inputTotal: numeroFinito(source?.inputTotal),
    outputRate,
    outputUnit: "envios_confirmados_por_destino_por_minuto",
    queueDepthObservado: absorption?.ok === true ? queueDepth : null,
    oldestAgeObservada: absorption?.ok === true ? oldestAgeMs : null,
    freshReserveObservada: absorption?.ok === true ? freshReserveProxy : null,
    freshReserveQuality: "proxy_itens_vivos_ate_5_min_sem_prova_de_elegibilidade",
    availableCapacityObservada: absorption?.ok === true ? availableCapacity : null,
    radarOperacional: radar ? {
      enabled: radar.enabled === true,
      withinSchedule: radar.withinSchedule === true,
      sourceConfigured: radar.sourceConfigured === true
    } : null,
    teleRadarOperacional: teleRadar ? {
      enabled: teleRadar.enabled === true,
      withinSchedule: teleRadar.withinSchedule === true,
      listenerActive: teleRadar.listenerActive === true,
      accountAuthorized: teleRadar.accountAuthorized === true,
      selectedSourceCount: numeroFinito(teleRadar.selectedSourceCount)
    } : null,
    observedWorkspaceCount: workspaces.length,
    observedWorkspaceScope: observedIds.size ? "subset_calibracao" : "global",
    windowMinutes: source?.janelaMinutos ?? 15,
    observedAtMs: now
  };
}

module.exports = { coletarMetricasShadow, parseObservedWorkspaceIds };
