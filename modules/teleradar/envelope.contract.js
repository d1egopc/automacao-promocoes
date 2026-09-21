"use strict";

const crypto = require("crypto");

const ENVELOPE_TYPE = "teleradar.message.v1";
const ORIGIN_FIELDS = Object.freeze({
  origem: "radar",
  origemFluxo: "optimus",
  origemTipo: "telegram",
  fonte: "teleradar",
  fonteCaptura: "teleradar"
});

function id(value, field) {
  const result = String(value ?? "").trim();
  if (!/^-?\d+$/.test(result)) throw new Error(`TELERADAR_${field.toUpperCase()}_INVALID`);
  return result;
}

function createEventId({ accountId, chatId, messageId }) {
  const account = id(accountId, "account_id");
  const chat = id(chatId, "chat_id");
  const message = id(messageId, "message_id");
  return crypto.createHash("sha256").update(`teleradar:v1:${account}:${chat}:${message}`, "utf8").digest("hex");
}

function immutableEntities(entities = []) {
  return Object.freeze(entities.map(entity => Object.freeze({
    type: entity.type,
    occurrence: entity.occurrence,
    offset: entity.offset,
    length: entity.length,
    label: entity.label,
    url: entity.url
  })));
}

function createEnvelope(message = {}) {
  if (message.protectedContent === true) throw new Error("TELERADAR_REJEITADO_PROTECTED_CONTENT");
  const accountId = id(message.accountId, "account_id");
  const chatId = id(message.chatId, "chat_id");
  const messageId = id(message.messageId, "message_id");
  const envelope = {
    type: ENVELOPE_TYPE,
    ...ORIGIN_FIELDS,
    eventId: createEventId({ accountId, chatId, messageId }),
    accountId,
    chatId,
    chatKey: String(message.chatKey || chatId),
    messageId,
    senderId: message.senderId === null || message.senderId === undefined ? null : id(message.senderId, "sender_id"),
    receivedAt: String(message.receivedAt),
    capturedAt: String(message.sourceTimestamp || message.receivedAt),
    envelopeCreatedAt: String(message.envelopeCreatedAt || message.receivedAt),
    text: String(message.text || ""),
    textSource: message.textSource === "caption" ? "caption" : "text",
    hasMedia: message.hasMedia === true,
    mediaType: message.mediaType ? String(message.mediaType) : null,
    entities: immutableEntities(message.entities)
  };
  return Object.freeze(envelope);
}

module.exports = {
  ENVELOPE_TYPE,
  ORIGIN_FIELDS,
  createEventId,
  createEnvelope
};
