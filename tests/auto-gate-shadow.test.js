"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { consultarEntradasRadar } = require("../modules/auto-gate/auto-gate-metrics.repository");
const { coletarMetricasShadow } = require("../modules/auto-gate/auto-gate-metrics.service");
const { avaliarShadow } = require("../modules/auto-gate/auto-gate-state-machine");
const { createAutoGateShadow, shadowPolicyFromEnv } = require("../modules/auto-gate/auto-gate-shadow.service");
const { montarTelemetria } = require("../modules/auto-gate/auto-gate-telemetry");
const { criarGateAbsorcaoShadowOfc } = require("../modules/engine/ofc/absorption-gate.service");
const { avaliarJanela, avaliarGateCapturaRadarWhatsapp } = require("../modules/radar/whatsapp-capture-gate");
const { evaluateTeleRadarCaptureGate } = require("../modules/teleradar/capture-gate");

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

function metrics(overrides = {}) {
  return {
    ok: true,
    sinaisAusentes: [],
    confiancaDosSinais: "provisoria_shadow",
    observedAtMs: NOW,
    inputRadar: 0,
    inputTeleRadar: 0,
    inputTotal: 0,
    outputRate: 2,
    queueDepthObservado: 0,
    oldestAgeObservada: 0,
    queueDepthRaw: 0,
    queueDepthActionable: 0,
    oldestAgeRaw: 0,
    oldestActionableAge: 0,
    oldestHistoricalAge: 0,
    capacityTheoretical: 3,
    capacityEffective: 3,
    capacityEffectiveKnown: 3,
    capacityEffectiveComplete: true,
    capacityUnknownWorkspaces: 0,
    capacityUnknownSlots: 0,
    expiredAliveCount: 0,
    freshReserveObservada: 0,
    availableCapacityObservada: 3,
    radarOperacional: { enabled: true, withinSchedule: true, sourceConfigured: true },
    teleRadarOperacional: { enabled: false, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 },
    observedWorkspaceCount: 2,
    observedWorkspaceScope: "global",
    latencias: { ofcSnapshotMs: 1, consultaSqlMs: 2, radarOperationalMs: 3, teleRadarOperationalMs: 4, agregacaoMs: 5 },
    ...overrides
  };
}

function ofc(workspaces = [
  { workspaceId: "workspace_a", fonteFilaValida: true, topologiaOperacionalPotencial: true, pressaoEsteiraViva: 2, pendentesVivos: 2, idadeMaximaVivaMs: 5000, queueDepthRaw: 2, queueDepthActionable: 2, oldestAgeRaw: 5000, oldestActionableAge: 5000, oldestHistoricalAge: 0, expiredAliveCount: 0, expiredProcessingCount: 0, expiredPendingCount: 0, capacityTheoretical: 2, capacityEffective: 0, faixasIdade: { itensAte5Min: 1 }, slots15Min: 2, destinosAptos: 1, integracoesAptas: 1, statusDesconhecido: 0, itensSemTimestamp: 0 },
  { workspaceId: "workspace_b", fonteFilaValida: true, topologiaOperacionalPotencial: true, pressaoEsteiraViva: 3, pendentesVivos: 3, idadeMaximaVivaMs: 10000, queueDepthRaw: 3, queueDepthActionable: 3, oldestAgeRaw: 10000, oldestActionableAge: 10000, oldestHistoricalAge: 0, expiredAliveCount: 0, expiredProcessingCount: 0, expiredPendingCount: 0, capacityTheoretical: 3, capacityEffective: 0, faixasIdade: { itensAte5Min: 2 }, slots15Min: 3, destinosAptos: 1, integracoesAptas: 1, statusDesconhecido: 0, itensSemTimestamp: 0 }
], gateOverrides = {}) {
  return {
    fluxoComercial: { ok: true, janelaMinutos: 15, fontes: { eventosComerciais: true }, enviosConfirmadosPorMinuto: 2 },
    gateAbsorcao: {
      ok: true,
      snapshotCompleto: true,
      collectedAtMs: NOW,
      fontesInvalidasCount: 0,
      fontesInvalidasTotais: 0,
      fontesInvalidasRelevantes: 0,
      fontesInvalidasIrrelevantes: 0,
      duracaoMs: 12,
      janelaMinutos: 15,
      workspaces: workspaces.map(workspace => ({
        capacityEffectiveKnown: workspace.capacityEffective,
        capacityEffectiveComplete: true,
        capacityUnknownWorkspaces: 0,
        capacityUnknownSlots: 0,
        ...workspace
      })),
      ...gateOverrides
    }
  };
}

async function testSourceQuery() {
  let sql = "";
  const result = await consultarEntradasRadar({
    now: NOW,
    query: async (statement, values) => {
      sql = statement;
      assert.deepEqual(values, [15]);
      return { ok: true, resultado: { rows: [
        { origem_tipo: "whatsapp", fonte: "radar", total: 15 },
        { origem_tipo: "telegram", fonte: "teleradar", total: 30 }
      ] } };
    }
  });
  assert.equal(result.inputRadar, 1);
  assert.equal(result.inputTeleRadar, 2);
  assert.match(sql, /COUNT\(\*\)/);
  assert.match(sql, /criado_em >= NOW\(\)/);
  assert.doesNotMatch(sql, /texto_original|links_extraidos|metadata/);
}

async function testMetrics() {
  const input = { ok: true, janelaMinutos: 15, inputRadar: 1, inputTeleRadar: 2, inputTotal: 3, collectedAtMs: NOW };
  const providers = {
    ofc: ofc(),
    consultarEntradas: async () => input,
    getRadarOperational: async () => ({ enabled: true, withinSchedule: true, sourceConfigured: true }),
    getTeleRadarOperational: async () => ({ enabled: false, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }),
    now: NOW
  };
  const result = await coletarMetricasShadow(providers);
  assert.equal(result.ok, true, result.sinaisAusentes.join(","));
  assert.equal(result.queueDepthObservado, 5);
  assert.equal(result.oldestAgeObservada, 10000);
  assert.equal(result.freshReserveObservada, 3);
  assert.equal(result.availableCapacityObservada, 5);
  assert.equal(result.queueDepthActionable, 5);
  assert.equal(result.oldestActionableAge, 10000);
  assert.equal(result.capacityTheoretical, 5);
  assert.equal(result.capacityEffective, 0);
  assert.equal(result.capacityEffectiveKnown, 0);
  assert.equal(result.capacityEffectiveComplete, true);
  assert.equal(result.observedWorkspaceCount, 2);
  assert.equal(result.cadastralWorkspaceCount, 2);
  assert.equal(result.excludedWorkspaceCount, 0);
  assert.equal(result.latencias.ofcSnapshotMs, 12);
  assert.equal((await coletarMetricasShadow({ ...providers, observedWorkspaceIds: ["workspace_b"] })).sinaisAusentes.includes("escopo_workspace_parcial"), true);
  const stale = await coletarMetricasShadow({ ...providers, consultarEntradas: async () => ({ ...input, collectedAtMs: NOW - 6 * 60 * 1000 }) });
  assert.equal(stale.ok, false);
  assert.ok(stale.sinaisAusentes.includes("entrada_engine_obsoleta"));
  const inconsistent = await coletarMetricasShadow({ ...providers, consultarEntradas: async () => ({ ...input, inputTotal: 4 }) });
  assert.ok(inconsistent.sinaisAusentes.includes("entrada_engine_inconsistente"));
  const radarUnconfigured = await coletarMetricasShadow({
    ...providers,
    getRadarOperational: async () => ({ enabled: true, withinSchedule: true, sourceConfigured: false })
  });
  assert.equal(radarUnconfigured.radarOperacional.sourceConfigured, false);
  const radarUnknown = await coletarMetricasShadow({
    ...providers,
    getRadarOperational: async () => ({ enabled: true, withinSchedule: true })
  });
  assert.ok(radarUnknown.sinaisAusentes.includes("radar_operacional_indisponivel"));
  const missing = await coletarMetricasShadow({ ...providers, ofc: {} });
  assert.equal(missing.ok, false);
  assert.equal(avaliarShadow(missing).decisaoSugerida, "NAO_INTERVIR");

  const empty = { workspaceId: "empty", fonteFilaValida: true, topologiaOperacionalPotencial: false, pressaoEsteiraViva: 0, pendentesVivos: 0, idadeMaximaVivaMs: null,
    queueDepthRaw: 0, queueDepthActionable: 0, oldestAgeRaw: 0, oldestActionableAge: 0, oldestHistoricalAge: 0,
    expiredAliveCount: 0, expiredProcessingCount: 0, expiredPendingCount: 0, capacityTheoretical: 0, capacityEffective: 0,
    faixasIdade: { itensAte5Min: 0 }, slots15Min: 0, destinosAptos: 0, integracoesAptas: 0,
    statusDesconhecido: 0, itensSemTimestamp: 0 };
  const pressureClosed = { ...empty, workspaceId: "pressure", topologiaOperacionalPotencial: true, pressaoEsteiraViva: 2, pendentesVivos: 2,
    queueDepthRaw: 2, oldestAgeRaw: 1000, idadeMaximaVivaMs: 1000, faixasIdade: { itensAte5Min: 2 } };
  const capacity = { ...empty, workspaceId: "capacity", topologiaOperacionalPotencial: true, slots15Min: 4, capacityTheoretical: 4, capacityEffective: 4, destinosAptos: 1, integracoesAptas: 1 };
  capacity.plano = "nao_deve_influenciar";
  capacity.creditos = 0;
  const operational = await coletarMetricasShadow({ ...providers, ofc: ofc([empty, pressureClosed, capacity]) });
  assert.equal(operational.ok, true);
  assert.equal(operational.cadastralWorkspaceCount, 3);
  assert.equal(operational.observedWorkspaceCount, 2);
  assert.equal(operational.excludedWorkspaceCount, 1);
  assert.equal(operational.queueDepthObservado, 2, "pressao participa mesmo com destino fechado");
  assert.equal(operational.availableCapacityObservada, 4, "capacidade operacional participa");
  assert.equal(operational.queueDepthActionable, 0, "fila sem destino aberto nao pressiona Auto Gate");
  assert.equal(operational.capacityEffective, 4);

  const known20 = { ...capacity, workspaceId: "known20", slots15Min: 20,
    capacityTheoretical: 20, capacityEffective: 20 };
  const unknown10 = { ...capacity, workspaceId: "unknown10", slots15Min: 10,
    capacityTheoretical: 10, capacityEffective: 0, capacityEffectiveKnown: 0,
    capacityEffectiveComplete: false, capacityUnknownWorkspaces: 1, capacityUnknownSlots: 10 };
  const mixedCapacity = await coletarMetricasShadow({ ...providers, ofc: ofc([known20, unknown10]) });
  assert.equal(mixedCapacity.ok, true);
  assert.equal(mixedCapacity.capacityEffectiveKnown, 20);
  assert.equal(mixedCapacity.capacityUnknownSlots, 10);
  assert.equal(mixedCapacity.capacityUnknownWorkspaces, 1);
  assert.equal(mixedCapacity.capacityEffectiveComplete, false);
  assert.equal(avaliarShadow(mixedCapacity, {}).estadoSugerido, "CAPACIDADE_INCONCLUSIVA");
  const unknownPressure = { ...unknown10, workspaceId: "unknown_pressure", pressaoEsteiraViva: 1,
    queueDepthRaw: 1, queueDepthActionable: 1, idadeMaximaVivaMs: 1000,
    oldestActionableAge: 1000, oldestAgeRaw: 1000, faixasIdade: { itensAte5Min: 1 } };
  const onlyUnknown = await coletarMetricasShadow({ ...providers, ofc: ofc([unknownPressure]) });
  assert.equal(onlyUnknown.ok, true);
  assert.equal(onlyUnknown.capacityEffectiveKnown, 0);
  assert.equal(onlyUnknown.capacityEffectiveComplete, false);
  assert.equal(avaliarShadow(onlyUnknown, {}).estadoSugerido, "CAPACIDADE_INCONCLUSIVA");
  const noCompleteness = await coletarMetricasShadow({ ...providers,
    ofc: ofc([{ ...capacity, capacityEffectiveComplete: undefined }]) });
  assert.equal(noCompleteness.ok, false);
  assert.ok(noCompleteness.sinaisAusentes.includes("fila_observada_invalida"));
  assert.equal(avaliarShadow(noCompleteness, {}).decisaoSugerida, "NAO_INTERVIR");

  const invalidDead = { ...empty, workspaceId: "dead", fonteFilaValida: false };
  const irrelevantInvalid = await coletarMetricasShadow({
    ...providers,
    ofc: ofc([invalidDead], {
      snapshotCompleto: true,
      fontesInvalidasCount: 0,
      fontesInvalidasTotais: 1,
      fontesInvalidasRelevantes: 0,
      fontesInvalidasIrrelevantes: 1
    })
  });
  assert.equal(irrelevantInvalid.ok, true);
  assert.equal(irrelevantInvalid.observedWorkspaceCount, 0);
  assert.equal(irrelevantInvalid.excludedWorkspaceCount, 1);
  assert.equal(irrelevantInvalid.sinaisAusentes.includes("fila_observada_incompleta"), false);

  const invalidPotential = { ...empty, workspaceId: "potential", fonteFilaValida: false,
    topologiaOperacionalPotencial: true };
  const relevantInvalid = await coletarMetricasShadow({
    ...providers,
    ofc: ofc([invalidPotential], {
      snapshotCompleto: false,
      fontesInvalidasCount: 1,
      fontesInvalidasTotais: 1,
      fontesInvalidasRelevantes: 1,
      fontesInvalidasIrrelevantes: 0
    })
  });
  assert.equal(relevantInvalid.ok, false);
  assert.ok(relevantInvalid.sinaisAusentes.includes("fila_observada_incompleta"));
  assert.equal(avaliarShadow(relevantInvalid).decisaoSugerida, "NAO_INTERVIR");

  const unknown = { ...empty, workspaceId: "unknown", statusDesconhecido: 1 };
  const incomplete = await coletarMetricasShadow({ ...providers, ofc: ofc([empty, unknown]) });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.sinaisAusentes.includes("fila_observada_incompleta"));
  assert.equal(avaliarShadow(incomplete).decisaoSugerida, "NAO_INTERVIR");

  const staleSnapshot = await coletarMetricasShadow({
    ...providers,
    ofc: { ...ofc([capacity]), gateAbsorcao: { ...ofc([capacity]).gateAbsorcao, collectedAtMs: NOW - 6 * 60 * 1000 } }
  });
  assert.equal(staleSnapshot.ok, false);
  assert.ok(staleSnapshot.sinaisAusentes.includes("fila_observada_obsoleta"));

  const partialSnapshot = await coletarMetricasShadow({
    ...providers,
    ofc: { ...ofc([capacity]), gateAbsorcao: { ...ofc([capacity]).gateAbsorcao, snapshotCompleto: false } }
  });
  assert.equal(partialSnapshot.ok, false);
  assert.ok(partialSnapshot.sinaisAusentes.includes("fila_observada_incompleta"));

  const invalidWorkspace = { ...capacity, pressaoEsteiraViva: undefined };
  const invalidOperational = await coletarMetricasShadow({ ...providers, ofc: ofc([invalidWorkspace]) });
  assert.equal(invalidOperational.ok, false);
  assert.ok(invalidOperational.sinaisAusentes.includes("workspace_elegibilidade_indeterminada"));
  assert.equal(avaliarShadow(invalidOperational).decisaoSugerida, "NAO_INTERVIR");

  const source = fs.readFileSync(path.join(__dirname, "..", "modules", "auto-gate", "auto-gate-metrics.service.js"), "utf8");
  assert.doesNotMatch(source, /readClienteJson|fila\.json/, "Auto Gate deve reutilizar o snapshot OFC sem reler fila integral");
}

function testDecisions() {
  assert.deepEqual(shadowPolicyFromEnv({ AUTO_GATE_SHADOW_EVIDENCE_CYCLES: "3", AUTO_GATE_SHADOW_BOOST_EXPERIMENTAL: "true" }), {
    minEvidenceCycles: 3, minDwellCycles: 2, cooldownCycles: 2, allowBoostSuggestion: true
  });
  let history = {};
  let result = avaliarShadow(metrics(), history);
  assert.equal(result.decisaoSugerida, "MANTER");
  result = avaliarShadow(metrics(), result.history);
  assert.equal(result.decisaoSugerida, "ABRIR_TELERADAR");
  assert.equal(result.fonteAlvo, "teleradar");
  assert.equal(result.elegivelParaRecomendacao, true);
  assert.equal(result.prontoParaExecucao, true);
  assert.equal(result.autorizadoParaExecucao, false);
  assert.equal(result.executavelAgora, false);
  assert.ok(result.prerequisitosPendentes.includes("autoridade_manual_nao_inferida"));

  const listenerInactive = metrics({
    teleRadarOperacional: { enabled: false, withinSchedule: true, listenerActive: false, accountAuthorized: true, selectedSourceCount: 1 }
  });
  let inactive = avaliarShadow(listenerInactive, {});
  inactive = avaliarShadow(listenerInactive, inactive.history);
  assert.equal(inactive.estadoSugerido, "NECESSIDADE");
  assert.equal(inactive.decisaoSugerida, "ABRIR_TELERADAR");
  assert.equal(inactive.elegivelParaRecomendacao, true);
  assert.equal(inactive.prontoParaExecucao, false);
  assert.equal(inactive.executavelAgora, false);
  assert.ok(inactive.prerequisitosPendentes.includes("listener_inativo"));
  assert.ok(inactive.prerequisitosPendentes.includes("autoridade_manual_nao_inferida"));
  const inactiveTelemetry = montarTelemetria({ cicloId: "cycle_inactive", metrics: listenerInactive, result: inactive });
  assert.equal(inactiveTelemetry.elegivelParaRecomendacao, true);
  assert.equal(inactiveTelemetry.prontoParaExecucao, false);
  assert.equal(inactiveTelemetry.autorizadoParaExecucao, false);
  assert.equal(inactiveTelemetry.executavelAgora, false);
  assert.ok(inactiveTelemetry.prerequisitosPendentes.includes("listener_inativo"));

  const outsideWindow = metrics({
    teleRadarOperacional: { enabled: false, withinSchedule: false, listenerActive: false, accountAuthorized: true, selectedSourceCount: 1 }
  });
  let outside = avaliarShadow(outsideWindow, {});
  outside = avaliarShadow(outsideWindow, outside.history);
  assert.equal(outside.estadoSugerido, "NECESSIDADE");
  assert.equal(outside.decisaoSugerida, "NAO_INTERVIR");
  assert.equal(outside.executavelAgora, false);
  assert.ok(outside.prerequisitosPendentes.includes("fora_da_janela"));

  const teleQuiet = metrics({
    radarOperacional: { enabled: false, withinSchedule: true, sourceConfigured: true },
    teleRadarOperacional: { enabled: true, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }
  });
  result = avaliarShadow(teleQuiet, {});
  assert.equal(avaliarShadow(teleQuiet, result.history).decisaoSugerida, "ABRIR_RADAR");

  const pressure = step => metrics({ inputRadar: 3, inputTeleRadar: 1, inputTotal: 4,
    queueDepthObservado: step, oldestAgeObservada: 80 * 60 * 60 * 1000,
    queueDepthActionable: step, oldestActionableAge: step * 10000, freshReserveObservada: 1,
    teleRadarOperacional: { enabled: true, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }
  });
  result = avaliarShadow(pressure(1), {});
  result = avaliarShadow(pressure(2), result.history);
  assert.equal(result.estadoSugerido, "PRESSAO_ALTA");
  result = avaliarShadow(pressure(3), result.history);
  assert.equal(result.decisaoSugerida, "HOLD_RADAR");

  const historical = step => metrics({ inputRadar: 3, inputTeleRadar: 1, inputTotal: 4,
    queueDepthRaw: 500 + step, queueDepthObservado: step, oldestAgeRaw: (80 + step) * 60 * 60 * 1000,
    oldestAgeObservada: (80 + step) * 60 * 60 * 1000,
    queueDepthActionable: 5, oldestActionableAge: 12 * 60 * 1000, oldestHistoricalAge: (80 + step) * 60 * 60 * 1000,
    freshReserveObservada: 1, capacityEffective: 3,
    teleRadarOperacional: { enabled: true, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }
  });
  let historicalResult = avaliarShadow(historical(1), {});
  historicalResult = avaliarShadow(historical(2), historicalResult.history);
  historicalResult = avaliarShadow(historical(3), historicalResult.history);
  assert.notEqual(historicalResult.decisaoSugerida, "HOLD_RADAR", "idade historica crescente nao causa HOLD");
  assert.equal(historicalResult.history.metrics.oldestActionableAge, 12 * 60 * 1000);
  assert.equal(avaliarShadow(metrics({ queueDepthRaw: 500, oldestAgeRaw: 80 * 60 * 60 * 1000,
    oldestAgeObservada: 80 * 60 * 60 * 1000, oldestHistoricalAge: 80 * 60 * 60 * 1000 }), {}).history.metrics.oldestActionableAge, 0);

  const inconclusive = metrics({ inputRadar: 3, inputTotal: 3, queueDepthActionable: 5,
    oldestActionableAge: 12 * 60 * 1000, capacityEffective: 0, capacityEffectiveKnown: 0,
    capacityEffectiveComplete: false, capacityUnknownWorkspaces: 1, capacityUnknownSlots: 10 });
  const inconclusiveResult = avaliarShadow(inconclusive, {});
  assert.equal(inconclusiveResult.estadoSugerido, "CAPACIDADE_INCONCLUSIVA");
  assert.equal(inconclusiveResult.decisaoSugerida, "MANTER");
  assert.notEqual(inconclusiveResult.estadoSugerido, "SATURADO");
  const inconclusiveTelemetry = montarTelemetria({ cicloId: "credito_inconclusivo", metrics: inconclusive,
    result: inconclusiveResult });
  assert.equal(inconclusiveTelemetry.capacityEffectiveKnown, 0);
  assert.equal(inconclusiveTelemetry.capacityEffectiveComplete, false);
  assert.equal(inconclusiveTelemetry.capacityUnknownSlots, 10);
  assert.equal(inconclusiveTelemetry.autorizadoParaExecucao, false);
  let independentPressure = avaliarShadow({ ...inconclusive, queueDepthActionable: 1, oldestActionableAge: 1000 }, {});
  independentPressure = avaliarShadow({ ...inconclusive, queueDepthActionable: 2, oldestActionableAge: 2000 }, independentPressure.history);
  assert.equal(independentPressure.estadoSugerido, "PRESSAO_ALTA");
  independentPressure = avaliarShadow({ ...inconclusive, queueDepthActionable: 3, oldestActionableAge: 3000 }, independentPressure.history);
  assert.equal(independentPressure.decisaoSugerida, "HOLD_RADAR");

  const boost = metrics({
    teleRadarOperacional: { enabled: true, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }
  });
  assert.notEqual(avaliarShadow(boost, {}).decisaoSugerida, "BOOST_TEMPORARIO");
  result = avaliarShadow(boost, {}, { allowBoostSuggestion: true });
  assert.equal(avaliarShadow(boost, result.history, { allowBoostSuggestion: true }).decisaoSugerida, "BOOST_TEMPORARIO");

  result = avaliarShadow(metrics(), {});
  assert.equal(result.decisaoSugerida, "MANTER");
  const switchImmediately = avaliarShadow(teleQuiet, result.history);
  assert.equal(switchImmediately.decisaoSugerida, "MANTER");
  assert.equal(switchImmediately.motivo, "evidencia_ainda_nao_sustentada");
  const noRadarSource = metrics({ radarOperacional: { enabled: true, withinSchedule: true, sourceConfigured: false } });
  assert.equal(avaliarShadow(noRadarSource, {}).decisaoSugerida, "MANTER");
  let openTele = avaliarShadow(metrics(), {});
  openTele = avaliarShadow(metrics(), openTele.history);
  assert.equal(openTele.decisaoSugerida, "ABRIR_TELERADAR");
  assert.equal(avaliarShadow(teleQuiet, openTele.history).decisaoSugerida, "MANTER", "no immediate reverse suggestion");
  assert.equal(avaliarShadow({ ...metrics(), ok: false, sinaisAusentes: ["entrada_engine_obsoleta"] }).decisaoSugerida, "NAO_INTERVIR");
  assert.equal(avaliarShadow(metrics({ outputRate: null })).decisaoSugerida, "NAO_INTERVIR");
}

async function testIntegratedHistoricalQueue() {
  const destino = { id: "destino_integrado", ativo: true, tipo: "telegram", botToken: "token",
    chatId: "123", horarioInicio: "00:00", horarioFim: "23:59", intervaloMinutos: 2 };
  const coletarCiclo = async (horasHistoricas, creditos = 20) => {
    const itens = [
      ...Array.from({ length: 500 }, (_, i) => ({ id: `historico_${i}`, status: "processando",
        criadoEm: new Date(NOW - horasHistoricas * 60 * 60 * 1000).toISOString() })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `acionavel_${i}`, status: "pendente",
        criadoEm: new Date(NOW - (12 - i) * 60 * 1000).toISOString() }))
    ];
    const gateAbsorcao = await criarGateAbsorcaoShadowOfc({
      janelaMinutos: 15, agoraMs: NOW, clock: () => NOW,
      usuarios: [{ id: "integrado", creditos }],
      listarClientesAtivos: () => ["integrado"],
      configsPorCliente: { integrado: { automacaoAtiva: true } },
      destinosPorCliente: { integrado: [destino] },
      readFilaSnapshot: () => ({ ok: true, itens, collectedAtMs: NOW }),
      consultarEventosAbsorcao: async () => ({ ok: true, janelaMinutos: 15, porWorkspace: [] })
    });
    assert.equal(gateAbsorcao.ok, true);
    return coletarMetricasShadow({
      ofc: { fluxoComercial: ofc().fluxoComercial, gateAbsorcao },
      consultarEntradas: async () => ({ ok: true, janelaMinutos: 15, inputRadar: 3,
        inputTeleRadar: 0, inputTotal: 3, collectedAtMs: NOW }),
      getRadarOperational: async () => ({ enabled: true, withinSchedule: true, sourceConfigured: true }),
      getTeleRadarOperational: async () => ({ enabled: false, withinSchedule: true,
        listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }),
      now: NOW, clock: () => NOW
    });
  };
  const first = await coletarCiclo(80);
  assert.equal(first.ok, true, first.sinaisAusentes.join(","));
  assert.equal(first.queueDepthRaw, 505);
  assert.equal(first.queueDepthActionable, 5);
  assert.equal(first.oldestAgeRaw, 80 * 60 * 60 * 1000);
  assert.equal(first.oldestActionableAge, 12 * 60 * 1000);
  assert.equal(first.capacityEffectiveComplete, true);
  const semSaldo = await coletarCiclo(80, null);
  assert.equal(semSaldo.ok, true);
  assert.equal(semSaldo.queueDepthActionable, 5);
  assert.equal(semSaldo.capacityEffectiveKnown, 0);
  assert.equal(semSaldo.capacityEffectiveComplete, false);
  assert.equal(semSaldo.capacityUnknownWorkspaces, 1);
  assert.equal(avaliarShadow(semSaldo, {}).estadoSugerido, "CAPACIDADE_INCONCLUSIVA");
  let result = avaliarShadow(first, {});
  for (const horas of [81, 82]) {
    const next = await coletarCiclo(horas);
    assert.equal(next.queueDepthActionable, 5);
    assert.equal(next.oldestActionableAge, 12 * 60 * 1000);
    assert.equal(next.oldestAgeRaw, horas * 60 * 60 * 1000);
    result = avaliarShadow(next, result.history);
    assert.notEqual(result.decisaoSugerida, "HOLD_RADAR");
  }
}

async function testZeroMutation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-gate-shadow-"));
  const radarFile = path.join(dir, "radar-config.json");
  const teleFile = path.join(dir, "teleradar-operational-config.json");
  const originalRadar = '{"monitoramentoAtivo":false,"monitoramentoAtivadoEm":"old","monitoramento":{"horaInicial":"07:00","horaFinal":"02:00"}}';
  const originalTele = '{"monitoramentoAtivo":false,"monitoramentoAtivadoEm":"old","horarioInicio":"07:00","horarioFim":"02:00"}';
  fs.writeFileSync(radarFile, originalRadar);
  fs.writeFileSync(teleFile, originalTele);
  let operations = 0;
  const forbidden = { start() { operations++; }, stop() { operations++; }, setMonitoringActive() { operations++; }, setSchedule() { operations++; }, send() { operations++; } };
  const logs = [];
  const service = createAutoGateShadow({
    collectMetrics: async () => metrics(),
    log: item => logs.push(item),
    clock: () => NOW
  });
  try {
    await service.observe({ cicloId: "cycle_1", ofc: ofc(), getRadarOperational: () => ({ enabled: false, withinSchedule: true }), getTeleRadarOperational: () => ({ enabled: false, withinSchedule: true }), forbidden });
    await service.observe({ cicloId: "cycle_1", forbidden });
    assert.equal(logs.length, 1, "duplicate cycle does not run twice");
    assert.equal(operations, 0);
    assert.equal(fs.readFileSync(radarFile, "utf8"), originalRadar);
    assert.equal(fs.readFileSync(teleFile, "utf8"), originalTele);
    assert.equal(logs[0].aplicouMudancas, false);
    assert.equal(logs[0].queueDepthActionable, 0);
    assert.equal(logs[0].oldestActionableAge, 0);
    assert.equal(logs[0].capacityEffective, 3);
    assert.equal(logs[0].capacityEffectiveKnown, 3);
    assert.equal(logs[0].capacityEffectiveComplete, true);
    assert.equal(logs[0].autoridadeManualNaoInferida, true);
    assert.equal(logs[0].decisaoSugerida, "MANTER");
    for (const campo of ["latenciaOfcSnapshotMs", "latenciaConsultaSqlMs", "latenciaRadarOperationalMs",
      "latenciaTeleRadarOperationalMs", "latenciaAgregacaoMs", "latenciaMaquinaEstadosMs", "duracaoCalculoMs"]) {
      assert.equal(typeof logs[0][campo], "number", `${campo} deve ser emitido`);
    }
    assert.doesNotMatch(JSON.stringify(logs[0]), /api_hash|phoneCodeHash|StringSession|https?:\/\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testExistingGatesUnaffected() {
  const radarConfig = { monitoramentoAtivo: true, monitoramento: { horaInicial: "07:00", horaFinal: "02:00" } };
  assert.equal(avaliarJanela(radarConfig, new Date("2026-09-23T04:00:00Z")).dentroJanela, true); // 01:00 Sao Paulo
  assert.equal(avaliarJanela(radarConfig, new Date("2026-09-23T09:59:00Z")).dentroJanela, false); // 06:59
  const oldMessage = avaliarGateCapturaRadarWhatsapp({
    config: { ...radarConfig, monitoramentoAtivadoEm: "2026-09-23T11:00:00.000Z" },
    agora: new Date("2026-09-23T12:00:00.000Z"),
    mensagemTimestamp: Math.floor(Date.parse("2026-09-23T10:00:00.000Z") / 1000),
    upsertType: "notify", exigirMensagemNova: true,
    idsSessao: () => [{ gruposMonitorados: [{ ativo: true }] }],
    grupoMonitorado: () => true
  });
  assert.equal(oldMessage.ok, false);
  const teleConfig = { monitoramentoAtivo: true, horarioInicio: "07:00", horarioFim: "02:00", monitoramentoAtivadoEm: "2026-09-23T11:00:00.000Z" };
  const teleOld = evaluateTeleRadarCaptureGate({
    config: teleConfig, sourceSelected: true, selectedSourceCount: 1,
    now: new Date("2026-09-23T12:00:00.000Z"),
    sourceTimestamp: "2026-09-23T10:00:00.000Z", requireNewMessage: true
  });
  assert.equal(teleOld.allowed, false);
}

(async () => {
  await testSourceQuery();
  await testMetrics();
  testDecisions();
  await testIntegratedHistoricalQueue();
  await testZeroMutation();
  testExistingGatesUnaffected();
  console.log("auto-gate-shadow: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
