"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { capturaFactualRadarCandidata } =
  require("../modules/radar/capture-clock.candidate");
const { normalizeTelegramUpdate } = require("../modules/teleradar/update-normalizer");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { createRadarIngressAdapter } = require("../modules/teleradar/radar-ingress.adapter");
const { createMemoryTeleradarStore } = require("../modules/teleradar/checkpoint.repository");
const { createHandoffRepository } = require("../modules/teleradar/handoff.repository");
const { registrarEventoBruto } = require("../modules/engine/inbox.service");

test("inbox Engine impede fallback comercial para relogio de processamento", async () => {
  for (const fonte of ["radar", "teleradar", "clonador_grupos"]) {
    const result = await registrarEventoBruto({ fonte, origem: fonte,
      textoOriginal: "Oferta sem timestamp", linksExtraidos: [] });
    assert.deepEqual(result, { ok: false, motivo: "captura_sem_tempo_factual" });
  }
});

test("Radar WhatsApp usa messageTimestamp e rejeita ausência factual", () => {
  const seconds = 1791547200;
  const input = { origemTipo: "whatsapp",
    raw: { messageTimestamp: { toNumber: () => seconds } } };
  assert.equal(capturaFactualRadarCandidata(input),
    new Date(seconds * 1000).toISOString());
  assert.equal(capturaFactualRadarCandidata({ origemTipo: "whatsapp", raw: {} }), "");
});

test("Radar Telegram comum usa date da mensagem, não horário técnico", () => {
  const seconds = 1791547200;
  assert.equal(capturaFactualRadarCandidata({ origemTipo: "telegram",
    raw: { message: { date: seconds } }, capturadaEm: "09/10/2026 12:00" }),
  new Date(seconds * 1000).toISOString());
  assert.equal(capturaFactualRadarCandidata({ origemTipo: "telegram",
    raw: { message: {} }, capturadaEm: new Date().toISOString() }), "");
});

test("TeleRadar mantém capturedAt explícito do envelope", () => {
  const original = "2026-10-09T10:00:00.000Z";
  assert.equal(capturaFactualRadarCandidata({ origemTipo: "telegram",
    fonte: "teleradar", capturadaEm: original, raw: {} }), original);
});

test("TeleRadar nunca transforma receivedAt técnico em capturedAt comercial", async () => {
  const receivedAt = "2026-10-09T10:20:00.000Z";
  const base = { accountId: "1", chatId: "-100", messageId: "5",
    senderId: "2", receivedAt, text: "Oferta https://example.com" };
  const normalized = normalizeTelegramUpdate(base,
    { clock: () => new Date(receivedAt) });
  assert.equal(normalized.message.sourceTimestamp, null);
  const envelope = createEnvelope(normalized.message);
  assert.equal(envelope.receivedAt, receivedAt);
  assert.equal(envelope.capturedAt, "");
  let calls = 0;
  const adapter = createRadarIngressAdapter({ processarMensagemRadar: async () => {
    calls += 1;
    return { radarAccepted: true, radarAck: "RADAR_ACCEPTED", radarEventId: 1 };
  } });
  const rejected = await adapter.accept(envelope);
  assert.deepEqual(rejected, { accepted: false, durable: false,
    retryable: false, code: "captura_sem_tempo_factual" });
  assert.equal(calls, 0);
  const factual = "2026-10-09T10:00:00.000Z";
  const valid = createEnvelope({ ...normalized.message, sourceTimestamp: factual });
  const accepted = await adapter.accept(valid, { capturedAt: receivedAt });
  assert.equal(accepted.accepted, true);
  assert.equal(calls, 1);
});

test("TeleRadar outbox rejeita T0 ausente mesmo com receivedAt disponível", async () => {
  const receivedAt = "2026-10-09T10:20:00.000Z";
  const normalized = normalizeTelegramUpdate({ accountId: "1", chatId: "-100",
    messageId: "6", senderId: "2", receivedAt, text: "Oferta https://example.com" },
  { clock: () => new Date(receivedAt) });
  const envelope = createEnvelope(normalized.message);
  const repository = createHandoffRepository({ store: createMemoryTeleradarStore(),
    context: { clientId: "admin", workspaceId: "workspace_admin", scope: "admin_master",
      feature: "teleradar", accountIdInterno: "telegram-admin-1" } });
  await assert.rejects(repository.persist({ envelope, persistedAt: receivedAt }),
    /TELERADAR_HANDOFF_CAPTURED_AT_INVALID/);
  const factual = "2026-10-09T10:00:00.000Z";
  const persisted = await repository.persist({ envelope: createEnvelope({
    ...normalized.message, sourceTimestamp: factual }), persistedAt: receivedAt });
  assert.equal(persisted.record.capturedAt, factual);
});
