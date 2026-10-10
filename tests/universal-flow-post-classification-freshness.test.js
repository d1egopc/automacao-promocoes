"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { createRadarIngressAdapter } =
  require("../modules/teleradar/radar-ingress.adapter");
const { avaliarFrescorHandoffTeleRadar } =
  require("../modules/radar/ingress-frescor-retry.candidate");
const { normalizarEventoBruto } = require("../modules/engine/normalizers");
const { avaliarFrescorPreImporter } =
  require("../modules/engine/frescor-pre-importer.service");
const { avaliarFrescorPosClassificacaoCandidato } =
  require("../modules/engine/post-classification-freshness.candidate");

const base = Date.parse("2026-10-09T12:00:00.000Z");
const iso = minutes => new Date(base - minutes * 60000).toISOString();
const assess = (minutes, metadata = {}) => avaliarFrescorPreImporter({
  evento_capturado_em: iso(minutes), evento_origem: "radar",
  evento_metadata: {}, metadata
}, { agoraMs: base });

test("classificação posterior usa captura original para Normal, Turbo e Manual", () => {
  assert.equal(assess(20).expirada, false);
  assert.equal(assess(35).expirada, true);
  assert.equal(assess(5, { cupomTurbo: true }).expirada, false);
  const preClassification = assess(15);
  assert.equal(preClassification.expirada, false);
  const afterClassification = assess(15, { cupomTurbo: true });
  assert.equal(afterClassification.expirada, true);
  assert.equal(afterClassification.origemComercialMs, base - 15 * 60000);
  assert.equal(assess(180, { manualV2: true }).expirada, false);
  const offer = minutes => ({ evento_capturado_em: iso(minutes),
    origem: "radar", job_metadata: {} });
  assert.equal(avaliarFrescorPosClassificacaoCandidato(offer(20), base).ok, true);
  assert.equal(avaliarFrescorPosClassificacaoCandidato(offer(35), base).ok, false);
  assert.equal(avaliarFrescorPosClassificacaoCandidato({ ...offer(5),
    metadata: { cupomTurbo: true } }, base).ok, true);
  assert.equal(avaliarFrescorPosClassificacaoCandidato({ ...offer(15),
    metadata: { cupomTurbo: true } }, base).ok, false);
  assert.equal(avaliarFrescorPosClassificacaoCandidato({ origem: "manual_v2",
    evento_capturado_em: iso(180) }, base).ok, true);
  assert.equal(avaliarFrescorPosClassificacaoCandidato({ origem: "radar" }, base).ok,
    false);
});

test("TeleRadar transporta capturedAt sem inventar Turbo ou renovar no retry", async () => {
  const capturedAt = iso(15);
  const envelope = createEnvelope({ accountId: "90071992547409931",
    chatId: "-100123", chatKey: "-100123", messageId: "150",
    senderId: "90071992547409932", receivedAt: capturedAt,
    sourceTimestamp: capturedAt, envelopeCreatedAt: iso(14),
    text: "Oferta https://example.com", textSource: "text",
    hasMedia: false, mediaType: null, protectedContent: false,
    entities: [{ type: "url", occurrence: 0, offset: 7, length: 19,
      label: "https://example.com", url: "https://example.com" }] });
  let handoff;
  const adapter = createRadarIngressAdapter({
    processarMensagemRadar: async data => {
      handoff = data;
      return { radarAccepted: true, radarAck: "RADAR_ACCEPTED", radarEventId: "1" };
    }
  });
  const accepted = await adapter.accept(envelope, { capturedAt });
  assert.equal(accepted.durable, true);
  assert.equal(handoff.capturadaEm, capturedAt);
  assert.equal(handoff.teleradarHandoff.capturedAt, capturedAt);
  const event = normalizarEventoBruto({ origem: "radar", origemTipo: "telegram",
    capturadoEm: handoff.capturadaEm, textoOriginal: handoff.texto });
  assert.equal(new Date(event.capturadoEm).toISOString(), capturedAt);
  const normal = avaliarFrescorHandoffTeleRadar({ fonte: "teleradar",
    capturadoEm: capturedAt, metadata: {} }, base);
  assert.equal(normal.ok, true);
  const classified = avaliarFrescorPreImporter({
    evento_capturado_em: event.capturadoEm,
    metadata: { cupomTurbo: true }
  }, { agoraMs: base });
  assert.equal(classified.expirada, true);
  assert.equal(classified.origemComercialMs, Date.parse(capturedAt));
  const retry = avaliarFrescorHandoffTeleRadar({ fonte: "teleradar",
    capturadoEm: capturedAt, metadata: { cupomTurbo: true } }, base + 60000);
  assert.equal(retry.ok, false);
  assert.equal(retry.capturadoEm, capturedAt);
});
