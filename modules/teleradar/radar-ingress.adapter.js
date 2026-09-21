"use strict";

let registeredRadarIngress = null;

function registerRadarIngressHandler(handler) {
  if (typeof handler !== "function") throw new Error("TELERADAR_RADAR_HANDLER_INVALID");
  if (registeredRadarIngress && registeredRadarIngress !== handler) throw new Error("TELERADAR_RADAR_HANDLER_ALREADY_REGISTERED");
  registeredRadarIngress = handler;
  return true;
}

function validateEnvelope(envelope = {}) {
  if (envelope.protectedContent === true) throw new Error("TELERADAR_REJEITADO_PROTECTED_CONTENT");
  if (envelope.origem !== "radar"
    || envelope.origemFluxo !== "optimus"
    || envelope.origemTipo !== "telegram"
    || envelope.fonte !== "teleradar"
    || envelope.fonteCaptura !== "teleradar") {
    throw new Error("TELERADAR_HANDOFF_ORIGIN_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(String(envelope.eventId || ""))) throw new Error("TELERADAR_EVENT_ID_INVALID");
}

function contextualLinks(entities = []) {
  return (Array.isArray(entities) ? entities : [])
    .filter(entity => entity?.type === "url" || entity?.type === "text_url")
    .map(entity => String(entity.url || "").trim())
    .filter(Boolean);
}

function permanentRadarRejection(reason = "") {
  return [
    "sem_links",
    "origem_tipo_invalida",
    "grupo_ou_chat_ausente",
    "TELERADAR_HANDOFF_ORIGIN_INVALID",
    "TELERADAR_REJEITADO_PROTECTED_CONTENT"
  ].includes(String(reason));
}

function createRadarIngressAdapter({ processarMensagemRadar } = {}) {
  const explicitHandler = processarMensagemRadar;
  return Object.freeze({
    async accept(envelope, observability = {}) {
      validateEnvelope(envelope);
      const handler = explicitHandler || registeredRadarIngress;
      if (typeof handler !== "function") {
        return { accepted: false, durable: false, retryable: true, code: "RADAR_INGRESS_UNAVAILABLE" };
      }
      const entities = (Array.isArray(envelope.entities) ? envelope.entities : []).map(entity => ({
        type: entity.type,
        occurrence: entity.occurrence,
        offset: entity.offset,
        length: entity.length,
        label: entity.label,
        url: entity.url
      }));
      const result = await handler({
        origemTipo: "telegram",
        sessaoId: "telegram",
        grupoId: envelope.chatId,
        grupoNome: "",
        texto: envelope.text,
        capturadaEm: envelope.capturedAt || envelope.receivedAt,
        raw: {
          key: { id: envelope.messageId, remoteJid: envelope.chatId, fromMe: false },
          teleradar: {
            eventId: envelope.eventId,
            accountId: envelope.accountId,
            chatId: envelope.chatId,
            messageId: envelope.messageId,
            senderId: envelope.senderId,
            textSource: envelope.textSource,
            hasMedia: envelope.hasMedia,
            mediaType: envelope.mediaType,
            entities
          }
        },
        linksCapturados: contextualLinks(entities),
        hashEvento: envelope.eventId,
        fonte: "teleradar",
        fonteCaptura: "teleradar",
        origemAutorizadaInternamente: true,
        aguardarAckEngine: true,
        teleradarHandoff: {
          eventId: envelope.eventId,
          accountId: envelope.accountId,
          chatId: envelope.chatId,
          messageId: envelope.messageId,
          entities,
          capturedAt: observability.capturedAt || envelope.capturedAt || envelope.receivedAt,
          envelopeCreatedAt: observability.envelopeCreatedAt || envelope.envelopeCreatedAt,
          handoffPersistedAt: observability.handoffPersistedAt || null,
          handoffAttemptedAt: observability.handoffAttemptedAt || null,
          attempts: Number(observability.attempts || 0)
        }
      });
      if (result?.radarAccepted === true && result?.radarAck === "RADAR_ACCEPTED" && result?.radarEventId) {
        return {
          accepted: true,
          durable: true,
          retryable: false,
          code: "RADAR_ACCEPTED",
          radarEventId: String(result.radarEventId),
          duplicate: result.radarDuplicate === true
        };
      }
      const reason = String(result?.motivo || result?.radarAck || "RADAR_INGRESS_NOT_ACKED");
      return {
        accepted: false,
        durable: false,
        retryable: !permanentRadarRejection(reason),
        code: reason
      };
    }
  });
}

module.exports = {
  createRadarIngressAdapter,
  registerRadarIngressHandler
};
