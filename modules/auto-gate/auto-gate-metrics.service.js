const { consultarEntradasRadar } = require("./auto-gate-metrics.repository");

function numeroFinito(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseObservedWorkspaceIds(value = "") {
  return [...new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean))].slice(0, 100);
}

function duracaoMs(clock, inicio) {
  return Math.max(0, Number(clock()) - Number(inicio));
}

async function medirProvider(provider, clock) {
  const inicio = clock();
  try {
    return { status: "fulfilled", value: await provider(), duracaoMs: duracaoMs(clock, inicio) };
  } catch (reason) {
    return { status: "rejected", reason, duracaoMs: duracaoMs(clock, inicio) };
  }
}

function avaliarElegibilidadeOperacional(workspace = {}) {
  if (typeof workspace.fonteFilaValida !== "boolean") {
    return { valido: false, elegivel: false, motivo: "validade_fonte_fila_ausente" };
  }
  if (typeof workspace.topologiaOperacionalPotencial !== "boolean") {
    return { valido: false, elegivel: false, motivo: "topologia_operacional_ausente" };
  }
  const pressao = numeroFinito(workspace.pressaoEsteiraViva);
  const slots = numeroFinito(workspace.slots15Min);
  const destinosAptos = numeroFinito(workspace.destinosAptos);
  const integracoesAptas = numeroFinito(workspace.integracoesAptas);
  const statusDesconhecido = numeroFinito(workspace.statusDesconhecido);
  const itensSemTimestamp = numeroFinito(workspace.itensSemTimestamp);
  const valores = { pressao, slots, destinosAptos, integracoesAptas, statusDesconhecido, itensSemTimestamp };
  if (Object.values(valores).some(valor => valor === null)) {
    return { valido: false, elegivel: false, motivo: "snapshot_operacional_invalido", ...valores };
  }
  if (workspace.fonteFilaValida === false) {
    if (workspace.topologiaOperacionalPotencial === false) {
      return {
        valido: true,
        elegivel: false,
        motivo: "fonte_fila_invalida_sem_topologia_operacional",
        participaPorPressao: false,
        participaPorCapacidade: false,
        participaPorIncerteza: false,
        fonteFilaValida: false,
        ...valores
      };
    }
    return {
      valido: true,
      elegivel: true,
      motivo: "fonte_fila_invalida",
      participaPorPressao: false,
      participaPorCapacidade: false,
      participaPorIncerteza: true,
      fonteFilaValida: false,
      ...valores
    };
  }
  const participaPorPressao = pressao > 0;
  const participaPorCapacidade = slots > 0 && destinosAptos > 0 && integracoesAptas > 0;
  // An unknown/live-timestamp anomaly cannot be discarded as an inactive workspace:
  // it remains in scope so the global decision fails closed.
  const participaPorIncerteza = statusDesconhecido > 0 || itensSemTimestamp > 0;
  return {
    valido: true,
    elegivel: participaPorPressao || participaPorCapacidade || participaPorIncerteza,
    motivo: participaPorPressao ? "pressao_viva"
      : participaPorCapacidade ? "capacidade_operacional"
        : participaPorIncerteza ? "snapshot_incompleto" : "sem_pressao_ou_capacidade",
    participaPorPressao,
    participaPorCapacidade,
    participaPorIncerteza,
    fonteFilaValida: true,
    ...valores
  };
}

async function coletarMetricasShadow({
  ofc = {},
  getRadarOperational,
  getTeleRadarOperational,
  consultarEntradas = consultarEntradasRadar,
  observedWorkspaceIds = [],
  now = Date.now(),
  maxSignalAgeMs = 5 * 60 * 1000,
  clock = Date.now
} = {}) {
  const missing = [];
  const [sourceResult, radarResult, teleResult] = await Promise.all([
    medirProvider(() => consultarEntradas({ janelaMinutos: 15, now }), clock),
    medirProvider(() => typeof getRadarOperational === "function" ? getRadarOperational() : Promise.reject(new Error("missing")), clock),
    medirProvider(() => typeof getTeleRadarOperational === "function" ? getTeleRadarOperational() : Promise.reject(new Error("missing")), clock)
  ]);
  const aggregationStartedAt = clock();
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
  if (absorption?.ok === true && absorption.snapshotCompleto !== true) missing.push("fila_observada_incompleta");
  const fontesInvalidasCount = numeroFinito(absorption?.fontesInvalidasCount);
  const fontesInvalidasTotais = numeroFinito(absorption?.fontesInvalidasTotais);
  const fontesInvalidasRelevantes = numeroFinito(absorption?.fontesInvalidasRelevantes);
  const fontesInvalidasIrrelevantes = numeroFinito(absorption?.fontesInvalidasIrrelevantes);
  if (absorption?.ok === true && fontesInvalidasCount === null) missing.push("validade_fontes_fila_indisponivel");
  if (absorption?.ok === true && fontesInvalidasRelevantes === null) missing.push("validade_fontes_relevantes_indisponivel");
  if (absorption?.ok === true && fontesInvalidasRelevantes > 0) missing.push("fila_observada_incompleta");
  if (absorption?.ok === true && absorption.snapshotCompleto === true && fontesInvalidasRelevantes !== 0) {
    missing.push("fila_observada_inconsistente");
  }
  if (absorption?.ok === true && fontesInvalidasTotais !== null && fontesInvalidasRelevantes !== null
    && fontesInvalidasIrrelevantes !== null
    && fontesInvalidasTotais !== fontesInvalidasRelevantes + fontesInvalidasIrrelevantes) {
    missing.push("contagem_fontes_invalidas_inconsistente");
  }
  if (absorption?.ok === true && (!Number.isFinite(absorption.collectedAtMs)
    || absorption.collectedAtMs > now + 1000 || now - absorption.collectedAtMs > maxSignalAgeMs)) {
    missing.push("fila_observada_obsoleta");
  }
  if (source?.janelaMinutos !== 15 || commercial?.janelaMinutos !== 15 || absorption?.janelaMinutos !== 15) {
    missing.push("janelas_observacao_inconsistentes");
  }
  if (!radar || typeof radar.enabled !== "boolean" || typeof radar.withinSchedule !== "boolean"
    || typeof radar.sourceConfigured !== "boolean") missing.push("radar_operacional_indisponivel");
  if (!teleRadar || typeof teleRadar.enabled !== "boolean" || typeof teleRadar.withinSchedule !== "boolean"
    || typeof teleRadar.listenerActive !== "boolean" || typeof teleRadar.accountAuthorized !== "boolean"
    || numeroFinito(teleRadar.selectedSourceCount) === null) missing.push("teleradar_operacional_indisponivel");

  const observedIds = new Set(observedWorkspaceIds);
  const allWorkspaces = absorption?.ok === true && Array.isArray(absorption.workspaces) ? absorption.workspaces : [];
  const cadastralWorkspaces = observedIds.size
    ? allWorkspaces.filter(item => observedIds.has(String(item.workspaceId || "")))
    : allWorkspaces;
  if (observedIds.size && cadastralWorkspaces.length !== observedIds.size) missing.push("workspace_observado_nao_encontrado");

  const workspaces = [];
  for (const workspace of cadastralWorkspaces) {
    const elegibilidade = avaliarElegibilidadeOperacional(workspace);
    if (!elegibilidade.valido) {
      missing.push("workspace_elegibilidade_indeterminada");
      continue;
    }
    if (elegibilidade.elegivel) workspaces.push({ workspace, elegibilidade });
  }

  let queueDepth = 0;
  let oldestAgeMs = 0;
  let freshReserveProxy = 0;
  let availableCapacity = 0;
  let queueDepthRaw = 0;
  let queueDepthActionable = 0;
  let oldestAgeRaw = 0;
  let oldestActionableAge = 0;
  let oldestHistoricalAge = 0;
  let capacityTheoretical = 0;
  let capacityEffective = 0;
  let capacityEffectiveKnown = 0;
  let capacityUnknownWorkspaces = 0;
  let capacityUnknownSlots = 0;
  let expiredAliveCount = 0;
  let expiredProcessingCount = 0;
  let expiredPendingCount = 0;
  for (const workspace of cadastralWorkspaces) {
    const raw = numeroFinito(workspace.queueDepthRaw);
    const rawAge = numeroFinito(workspace.oldestAgeRaw);
    const historicalAge = numeroFinito(workspace.oldestHistoricalAge);
    const expired = numeroFinito(workspace.expiredAliveCount);
    const expiredProcessing = numeroFinito(workspace.expiredProcessingCount);
    const expiredPending = numeroFinito(workspace.expiredPendingCount);
    if ([raw, rawAge, historicalAge, expired, expiredProcessing, expiredPending].includes(null)) {
      missing.push("telemetria_fila_historica_invalida");
      continue;
    }
    queueDepthRaw += raw;
    oldestAgeRaw = Math.max(oldestAgeRaw, rawAge);
    oldestHistoricalAge = Math.max(oldestHistoricalAge, historicalAge);
    expiredAliveCount += expired;
    expiredProcessingCount += expiredProcessing;
    expiredPendingCount += expiredPending;
  }
  for (const item of workspaces) {
    const { workspace, elegibilidade } = item;
    const depth = elegibilidade.pressao;
    const age = numeroFinito(workspace.idadeMaximaVivaMs);
    const fresh = numeroFinito(workspace.faixasIdade?.itensAte5Min);
    const slots = numeroFinito(workspace.slots15Min);
    const actionable = numeroFinito(workspace.queueDepthActionable);
    const actionableAge = numeroFinito(workspace.oldestActionableAge);
    const theoretical = numeroFinito(workspace.capacityTheoretical);
    const effective = numeroFinito(workspace.capacityEffective);
    const effectiveKnown = numeroFinito(workspace.capacityEffectiveKnown);
    const unknownWorkspaces = numeroFinito(workspace.capacityUnknownWorkspaces);
    const unknownSlots = numeroFinito(workspace.capacityUnknownSlots);
    if (depth === null || (depth > 0 && age === null) || fresh === null || slots === null
      || actionable === null || actionableAge === null || theoretical === null || effective === null
      || effectiveKnown === null || unknownWorkspaces === null || unknownSlots === null
      || typeof workspace.capacityEffectiveComplete !== "boolean"
      || actionable > depth || (actionable === 0 && actionableAge !== 0)
      || effective > theoretical || theoretical !== slots || effective !== effectiveKnown
      || !Number.isInteger(unknownWorkspaces) || unknownWorkspaces > 1
      || unknownSlots > theoretical || (unknownWorkspaces === 0) !== (unknownSlots === 0)
      || workspace.capacityEffectiveComplete !== (unknownWorkspaces === 0)
      || numeroFinito(workspace.statusDesconhecido) === null || numeroFinito(workspace.itensSemTimestamp) === null) {
      missing.push("fila_observada_invalida");
      continue;
    }
    if (workspace.statusDesconhecido > 0 || workspace.itensSemTimestamp > 0) missing.push("fila_observada_incompleta");
    if (workspace.fonteFilaValida !== true) missing.push("fila_observada_incompleta");
    queueDepth += depth;
    oldestAgeMs = Math.max(oldestAgeMs, age || 0);
    freshReserveProxy += fresh;
    availableCapacity += slots;
    queueDepthActionable += actionable;
    oldestActionableAge = Math.max(oldestActionableAge, actionableAge);
    capacityTheoretical += theoretical;
    capacityEffective += effective;
    capacityEffectiveKnown += effectiveKnown;
    capacityUnknownWorkspaces += unknownWorkspaces;
    capacityUnknownSlots += unknownSlots;
  }
  // Source events are global; a selected workspace subset is for calibration,
  // never a basis for a source-global intervention suggestion.
  if (observedIds.size) missing.push("escopo_workspace_parcial");

  const result = {
    ok: missing.length === 0,
    sinaisAusentes: [...new Set(missing)].sort(),
    confiancaDosSinais: missing.length ? "insuficiente"
      : capacityUnknownWorkspaces > 0 ? "provisoria_shadow_capacidade_inconclusiva" : "provisoria_shadow",
    signalCollectedAtMs: source?.collectedAtMs ?? null,
    inputRadar: numeroFinito(source?.inputRadar),
    inputTeleRadar: numeroFinito(source?.inputTeleRadar),
    inputTotal: numeroFinito(source?.inputTotal),
    outputRate,
    // Observacoes paralelas nao entram em missing, policy ou maquina de estados.
    drenagemObservacional: ofc.drenagem || null,
    outputUnit: "envios_confirmados_por_destino_por_minuto",
    queueDepthObservado: absorption?.ok === true ? queueDepth : null,
    oldestAgeObservada: absorption?.ok === true ? oldestAgeMs : null,
    queueDepthRaw: absorption?.ok === true ? queueDepthRaw : null,
    queueDepthActionable: absorption?.ok === true ? queueDepthActionable : null,
    oldestAgeRaw: absorption?.ok === true ? oldestAgeRaw : null,
    oldestActionableAge: absorption?.ok === true ? oldestActionableAge : null,
    oldestHistoricalAge: absorption?.ok === true ? oldestHistoricalAge : null,
    capacityTheoretical: absorption?.ok === true ? capacityTheoretical : null,
    capacityEffective: absorption?.ok === true ? capacityEffective : null,
    capacityEffectiveKnown: absorption?.ok === true ? capacityEffectiveKnown : null,
    capacityEffectiveComplete: absorption?.ok === true ? capacityUnknownWorkspaces === 0 : null,
    capacityUnknownWorkspaces: absorption?.ok === true ? capacityUnknownWorkspaces : null,
    capacityUnknownSlots: absorption?.ok === true ? capacityUnknownSlots : null,
    expiredAliveCount: absorption?.ok === true ? expiredAliveCount : null,
    expiredProcessingCount: absorption?.ok === true ? expiredProcessingCount : null,
    expiredPendingCount: absorption?.ok === true ? expiredPendingCount : null,
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
    cadastralWorkspaceCount: cadastralWorkspaces.length,
    excludedWorkspaceCount: cadastralWorkspaces.length - workspaces.length,
    snapshotCompleto: absorption?.snapshotCompleto === true,
    fontesInvalidasCount,
    fontesInvalidasTotais,
    fontesInvalidasRelevantes,
    fontesInvalidasIrrelevantes,
    observedWorkspaceScope: observedIds.size ? "subset_calibracao" : "global",
    windowMinutes: source?.janelaMinutos ?? 15,
    observedAtMs: now,
    latencias: {
      ofcSnapshotMs: numeroFinito(absorption?.duracaoMs),
      consultaSqlMs: numeroFinito(sourceResult.duracaoMs),
      radarOperationalMs: numeroFinito(radarResult.duracaoMs),
      teleRadarOperationalMs: numeroFinito(teleResult.duracaoMs),
      agregacaoMs: null
    }
  };
  result.latencias.agregacaoMs = duracaoMs(clock, aggregationStartedAt);
  return result;
}

module.exports = { coletarMetricasShadow, parseObservedWorkspaceIds, avaliarElegibilidadeOperacional };
