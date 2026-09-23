"use strict";

const assert = require("node:assert/strict");
const { evaluateTeleRadarCaptureGate } = require("../modules/teleradar/capture-gate");
const { createMemoryTeleradarStore } = require("../modules/teleradar/checkpoint.repository");
const { createOperationalConfigRepository } = require("../modules/teleradar/operational-config.repository");
const { HANDOFFS_FILE } = require("../modules/teleradar/handoff.repository");
const { createTeleRadarService } = require("../modules/teleradar");

const context = Object.freeze({
  clientId: "admin",
  workspaceId: "admin",
  scope: "admin_master",
  feature: "teleradar",
  accountIdInterno: "admin-master-teleradar"
});

function gate(config, instant, sourceSelected = true, selectedSourceCount = 1) {
  return evaluateTeleRadarCaptureGate({
    config,
    sourceSelected,
    selectedSourceCount,
    now: new Date(instant)
  });
}

function fakeTelegram() {
  let handler = null;
  return {
    state: { disconnectCalls: 0 },
    async restore() { return { authorized: true }; },
    async listParticipatingChats() {
      return [{ chatKey: "-1001", chatId: "-1001", title: "Fonte", type: "channel", protectedContent: false }];
    },
    async subscribeNewMessages({ onMessage }) { handler = onMessage; return async () => { handler = null; }; },
    async disconnect() { this.state.disconnectCalls += 1; handler = null; },
    async emit(update) { return handler ? handler(update) : null; }
  };
}

function message(messageId, telegramTimestamp) {
  return {
    accountId: "10",
    chatId: "-1001",
    chatKey: "-1001",
    messageId: String(messageId),
    senderId: "20",
    telegramTimestamp,
    text: "Oferta https://example.com",
    textSource: "text",
    hasMedia: false,
    protectedContent: false,
    entities: [{ type: "url", occurrence: 0, offset: 7, length: 19, label: "https://example.com", url: "https://example.com" }]
  };
}

async function run() {
  const on = { monitoramentoAtivo: true, horarioInicio: "08:00", horarioFim: "00:50", monitoramentoAtivadoEm: null };
  assert.equal(gate({ ...on, monitoramentoAtivo: false }, "2026-09-22T12:00:00Z").reason, "monitoramento_desligado");
  assert.equal(gate({ ...on, monitoramentoAtivo: false }, "2026-09-23T10:59:00Z").reason, "monitoramento_desligado");
  for (const instant of ["2026-09-22T11:00:00Z", "2026-09-23T02:59:00Z", "2026-09-23T03:00:00Z", "2026-09-23T03:50:00Z"]) {
    assert.equal(gate(on, instant).allowed, true, instant);
  }
  for (const instant of ["2026-09-23T03:51:00Z", "2026-09-23T10:59:00Z"]) {
    assert.equal(gate(on, instant).reason, "fora_da_janela", instant);
  }

  const configurableWindows = [
    { start: "08:35", end: "23:55", atStart: "2026-09-22T11:35:00Z", atEnd: "2026-09-23T02:55:00Z", afterEnd: "2026-09-23T02:56:00Z" },
    { start: "07:00", end: "00:50", atStart: "2026-09-22T10:00:00Z", atEnd: "2026-09-23T03:50:00Z", afterEnd: "2026-09-23T03:51:00Z" },
    { start: "07:00", end: "01:00", atStart: "2026-09-22T10:00:00Z", atEnd: "2026-09-23T04:00:00Z", afterEnd: "2026-09-23T04:01:00Z" },
    { start: "07:00", end: "02:00", atStart: "2026-09-22T10:00:00Z", atEnd: "2026-09-23T05:00:00Z", afterEnd: "2026-09-23T05:01:00Z" },
    { start: "10:00", end: "18:00", atStart: "2026-09-22T13:00:00Z", atEnd: "2026-09-22T21:00:00Z", afterEnd: "2026-09-22T21:01:00Z" },
    { start: "00:00", end: "23:59", atStart: "2026-09-22T03:00:00Z", atEnd: "2026-09-23T02:59:00Z", afterEnd: null }
  ];
  for (const window of configurableWindows) {
    const config = { ...on, horarioInicio: window.start, horarioFim: window.end };
    assert.equal(gate(config, window.atStart).allowed, true, `início inclusivo ${window.start}-${window.end}`);
    assert.equal(gate(config, window.atEnd).allowed, true, `fim inclusivo ${window.start}-${window.end}`);
    if (window.afterEnd) {
      assert.equal(gate(config, window.afterEnd).allowed, false, `após o fim ${window.start}-${window.end}`);
    }
  }

  const campaignWindow = { ...on, horarioInicio: "07:00", horarioFim: "02:00" };
  assert.equal(gate(campaignWindow, "2026-09-22T09:59:00Z").allowed, false, "06:59 bloqueado");
  assert.equal(gate(campaignWindow, "2026-09-22T10:00:00Z").allowed, true, "07:00 permitido");
  assert.equal(gate(campaignWindow, "2026-09-23T02:59:00Z").allowed, true, "23:59 permitido");
  assert.equal(gate(campaignWindow, "2026-09-23T03:00:00Z").allowed, true, "00:00 permitido");
  assert.equal(gate(campaignWindow, "2026-09-23T04:59:00Z").allowed, true, "01:59 permitido");
  assert.equal(gate(campaignWindow, "2026-09-23T05:00:00Z").allowed, true, "02:00 permitido e inclusivo");
  assert.equal(gate(campaignWindow, "2026-09-23T05:01:00Z").allowed, false, "02:01 bloqueado");

  const almostAllDay = { ...on, horarioInicio: "00:00", horarioFim: "23:59" };
  for (const instant of ["2026-09-22T03:00:00Z", "2026-09-22T15:00:00Z", "2026-09-23T02:59:00Z"]) {
    assert.equal(gate(almostAllDay, instant).allowed, true, `janela 00:00-23:59: ${instant}`);
  }
  const gateCases = [
    { config: { ...on, monitoramentoAtivo: false }, instant: "2026-09-22T12:00:00Z", selected: true, count: 1, allowed: false, reason: "monitoramento_desligado" },
    { config: on, instant: "2026-09-22T09:00:00Z", selected: true, count: 1, allowed: false, reason: "fora_da_janela" },
    { config: on, instant: "2026-09-22T12:00:00Z", selected: false, count: 0, allowed: false, reason: "aguardando_fontes" },
    { config: on, instant: "2026-09-22T12:00:00Z", selected: false, count: 2, allowed: false, reason: "fonte_nao_selecionada" },
    { config: on, instant: "2026-09-22T09:00:00Z", selected: false, count: 0, allowed: false, reason: "fora_da_janela" },
    { config: on, instant: "2026-09-22T12:00:00Z", selected: true, count: 1, allowed: true, reason: "permitido" }
  ];
  for (const item of gateCases) {
    const result = gate(item.config, item.instant, item.selected, item.count);
    assert.equal(result.allowed, item.allowed, `${item.reason} at ${item.instant}`);
    assert.equal(result.reason, item.reason, `${item.reason} precedence`);
  }

  const morningWindow = {
    ...on,
    horarioInicio: "07:00",
    horarioFim: "02:00",
    monitoramentoAtivadoEm: "2026-09-21T10:00:00.000Z"
  };
  assert.equal(evaluateTeleRadarCaptureGate({
    config: morningWindow,
    sourceSelected: true,
    selectedSourceCount: 1,
    now: new Date("2026-09-22T10:05:00Z"),
    sourceTimestamp: "2026-09-22T09:59:00Z",
    requireNewMessage: true
  }).reason, "mensagem_anterior_janela", "update atrasado antes do início diário é barrado ao abrir a janela");
  assert.equal(evaluateTeleRadarCaptureGate({
    config: morningWindow,
    sourceSelected: true,
    selectedSourceCount: 1,
    now: new Date("2026-09-22T10:05:00Z"),
    sourceTimestamp: "2026-09-22T10:01:00Z",
    requireNewMessage: true
  }).allowed, true, "mensagem nova dentro da janela passa");
  assert.equal(evaluateTeleRadarCaptureGate({
    config: morningWindow,
    sourceSelected: true,
    selectedSourceCount: 1,
    now: new Date("2026-09-23T11:35:00Z"),
    sourceTimestamp: "2026-09-23T02:54:00Z",
    requireNewMessage: true
  }).reason, "mensagem_anterior_janela", "mensagem da janela diária anterior não renasce no dia seguinte");
  assert.equal(evaluateTeleRadarCaptureGate({
    config: morningWindow,
    sourceSelected: true,
    selectedSourceCount: 1,
    now: new Date("2026-09-23T04:00:00Z"),
    sourceTimestamp: "2026-09-23T02:59:00Z",
    requireNewMessage: true
  }).allowed, true, "mensagem da noite anterior pertence à janela cruzando meia-noite ainda aberta");

  let nowMs = Date.parse("2026-09-22T12:00:00Z");
  const clock = () => new Date(nowMs);
  const store = createMemoryTeleradarStore();
  const configA = createOperationalConfigRepository({ store, context, clock });
  assert.deepEqual(await configA.get(), {
    monitoramentoAtivo: false,
    horarioInicio: "00:00",
    horarioFim: "23:59",
    monitoramentoAtivadoEm: null,
    updatedAt: null
  });
  await configA.setSchedule({ horarioInicio: "08:00", horarioFim: "00:50" });
  assert.equal((await configA.get()).monitoramentoAtivo, false, "salvar horário não liga o monitoramento");
  await configA.setMonitoringActive(true);
  assert.deepEqual(
    { inicio: (await configA.get()).horarioInicio, fim: (await configA.get()).horarioFim },
    { inicio: "08:00", fim: "00:50" },
    "toggle não altera o horário"
  );
  const configB = createOperationalConfigRepository({ store, context, clock });
  assert.equal((await configB.get()).monitoramentoAtivo, true, "restart preserva ON");
  await configB.setMonitoringActive(false);
  const configC = createOperationalConfigRepository({ store, context, clock });
  assert.equal((await configC.get()).monitoramentoAtivo, false, "false persistido sobrevive ao restart");
  assert.equal((await configC.get()).horarioFim, "00:50");
  await configC.setSchedule({ horarioInicio: "07:00", horarioFim: "02:00" });
  const configD = createOperationalConfigRepository({ store, context, clock });
  assert.deepEqual(
    { inicio: (await configD.get()).horarioInicio, fim: (await configD.get()).horarioFim },
    { inicio: "07:00", fim: "02:00" },
    "restart preserva exatamente a janela livremente configurada"
  );
  for (const window of configurableWindows) {
    await configD.setSchedule({ horarioInicio: window.start, horarioFim: window.end });
    assert.deepEqual(
      { inicio: (await configD.get()).horarioInicio, fim: (await configD.get()).horarioFim },
      { inicio: window.start, fim: window.end },
      `persistência literal ${window.start}-${window.end}`
    );
  }

  const runtimeStore = createMemoryTeleradarStore();
  const telegram = fakeTelegram();
  const accepted = [];
  const service = createTeleRadarService({
    context,
    store: runtimeStore,
    clock,
    telegramAccountService: telegram,
    radarIngress: {
      async accept(envelope) {
        accepted.push(envelope.messageId);
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: envelope.messageId };
      }
    }
  });
  await service.replaceSelectedSources(["-1001"]);
  await service.start();
  await telegram.emit(message("1", "2026-09-22T12:00:00Z"));
  assert.deepEqual(accepted, [], "mensagem durante OFF não entra na outbox");
  assert.equal((await service.listSelectedSources()).length, 1, "OFF não remove fontes");
  assert.equal(telegram.state.disconnectCalls, 0, "OFF operacional não desconecta a conta");

  nowMs += 1000;
  await service.setMonitoringActive(true);
  await telegram.emit(message("2", "2026-09-22T12:00:00Z"));
  assert.deepEqual(accepted, [], "mensagem do período OFF não reaparece após reativação");
  nowMs += 1000;
  await telegram.emit(message("3", new Date(nowMs).toISOString()));
  assert.deepEqual(accepted, ["3"], "mensagem nova após reativação é aceita");

  await service.setCaptureSchedule({ horarioInicio: "13:00", horarioFim: "14:00" });
  nowMs = Date.parse("2026-09-22T12:30:00Z"); // 09:30 em São Paulo: fora da nova janela
  await telegram.emit(message("4", new Date(nowMs).toISOString()));
  assert.deepEqual(accepted, ["3"], "mensagem fora do horário não entra na outbox");
  await service.setCaptureSchedule({ horarioInicio: "00:00", horarioFim: "23:59" });
  nowMs = Date.parse("2026-09-22T12:31:00Z");
  await telegram.emit(message("5", "2026-09-22T12:30:00Z"));
  assert.deepEqual(accepted, ["3"], "mensagem do período fechado não reaparece após ampliar o horário");
  nowMs += 1000;
  await telegram.emit(message("6", new Date(nowMs).toISOString()));
  assert.deepEqual(accepted, ["3", "6"]);
  await service.stop();

  const pendingStore = createMemoryTeleradarStore();
  const telegramPending = fakeTelegram();
  const timers = [];
  let deliveryFails = true;
  const pending = createTeleRadarService({
    context,
    store: pendingStore,
    clock,
    telegramAccountService: telegramPending,
    radarIngress: {
      async accept(envelope) {
        if (deliveryFails) throw new Error("transient");
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: envelope.messageId };
      }
    },
    handoffOptions: {
      setTimeoutFn(callback) { const timer = { callback, unref() {} }; timers.push(timer); return timer; },
      clearTimeoutFn() {}
    }
  });
  await pending.replaceSelectedSources(["-1001"]);
  await pending.start();
  await pending.setCaptureSchedule({ horarioInicio: "00:00", horarioFim: "23:59" });
  await pending.setMonitoringActive(true);
  nowMs += 1000;
  await telegramPending.emit(message("10", new Date(nowMs).toISOString()));
  let records = Object.values((await pendingStore.read(context, HANDOFFS_FILE)).entries);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "pending");
  await pending.setMonitoringActive(false);
  deliveryFails = false;
  nowMs += 1000;
  timers.at(-1).callback();
  await new Promise(resolve => setImmediate(resolve));
  records = Object.values((await pendingStore.read(context, HANDOFFS_FILE)).entries);
  assert.equal(records[0].status, "acked", "outbox aceita antes do OFF continua entregando");
  nowMs += 1000;
  await telegramPending.emit(message("11", new Date(nowMs).toISOString()));
  records = Object.values((await pendingStore.read(context, HANDOFFS_FILE)).entries);
  assert.equal(records.length, 1, "mensagem posterior ao OFF não entra na outbox");
  assert.equal(records[0].status, "acked", "outbox aceita antes do OFF não é corrompida");
  assert.ok(timers.length >= 1);
  await pending.stop();

  console.log("PASS tests/teleradar-operational-control.test.js");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
