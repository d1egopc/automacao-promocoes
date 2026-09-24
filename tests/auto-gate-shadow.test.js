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
    freshReserveObservada: 0,
    availableCapacityObservada: 3,
    radarOperacional: { enabled: true, withinSchedule: true, sourceConfigured: true },
    teleRadarOperacional: { enabled: false, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 },
    observedWorkspaceCount: 2,
    observedWorkspaceScope: "global",
    ...overrides
  };
}

function ofc(workspaces = [
  { workspaceId: "workspace_a", pendentesVivos: 2, idadeMaximaVivaMs: 5000, faixasIdade: { itensAte5Min: 1 }, slots15Min: 2, statusDesconhecido: 0, itensSemTimestamp: 0 },
  { workspaceId: "workspace_b", pendentesVivos: 3, idadeMaximaVivaMs: 10000, faixasIdade: { itensAte5Min: 2 }, slots15Min: 3, statusDesconhecido: 0, itensSemTimestamp: 0 }
]) {
  return {
    fluxoComercial: { ok: true, janelaMinutos: 15, fontes: { eventosComerciais: true }, enviosConfirmadosPorMinuto: 2 },
    gateAbsorcao: { ok: true, janelaMinutos: 15, workspaces }
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
  assert.equal(result.ok, true);
  assert.equal(result.queueDepthObservado, 5);
  assert.equal(result.oldestAgeObservada, 10000);
  assert.equal(result.freshReserveObservada, 3);
  assert.equal(result.availableCapacityObservada, 5);
  assert.equal(result.observedWorkspaceCount, 2);
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
    queueDepthObservado: step, oldestAgeObservada: step * 10000, freshReserveObservada: 1,
    teleRadarOperacional: { enabled: true, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 }
  });
  result = avaliarShadow(pressure(1), {});
  result = avaliarShadow(pressure(2), result.history);
  assert.equal(result.estadoSugerido, "PRESSAO_ALTA");
  result = avaliarShadow(pressure(3), result.history);
  assert.equal(result.decisaoSugerida, "HOLD_RADAR");

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
    assert.equal(logs[0].decisaoSugerida, "MANTER");
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
  await testZeroMutation();
  testExistingGatesUnaffected();
  console.log("auto-gate-shadow: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
