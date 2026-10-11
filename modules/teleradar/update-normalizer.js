"use strict";

const ENTITY_TYPES = new Set(["url", "text_url"]);

function id(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const result = String(value ?? "").trim();
  if (!/^-?\d+$/.test(result)) throw new Error(`TELERADAR_${field.toUpperCase()}_INVALID`);
  return result;
}

function iso(value, field) {
  if (value === null || value === undefined || value === "") return null;
  let candidate = value;
  if (typeof candidate === "number" && candidate > 0 && candidate < 1e12) candidate *= 1000;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new Error(`TELERADAR_${field.toUpperCase()}_INVALID`);
  return date.toISOString();
}

function canonicalEntityType(entity = {}) {
  const raw = String(entity.type || entity.telegramType || entity.className || "").toLowerCase().replace(/[^a-z_]/g, "");
  if (raw.includes("texturl") || raw === "text_url") return "text_url";
  if (raw.endsWith("url")) return "url";
  return "unknown";
}

function normalizeEntities(text, entities = []) {
  if (!Array.isArray(entities)) return Object.freeze([]);
  const normalized = [];
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index] || {};
    const type = canonicalEntityType(entity);
    if (!ENTITY_TYPES.has(type)) continue;
    const offset = Number(entity.offset);
    const length = Number(entity.length);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) {
      throw new Error("TELERADAR_ENTITY_RANGE_INVALID");
    }
    const label = entity.label === null || entity.label === undefined
      ? String(text).slice(offset, offset + length)
      : String(entity.label);
    const url = type === "text_url" ? String(entity.url || "").trim() : String(entity.url || label).trim();
    if (!url) throw new Error("TELERADAR_ENTITY_URL_INVALID");
    normalized.push(Object.freeze({
      type,
      occurrence: Number.isInteger(Number(entity.occurrence)) ? Number(entity.occurrence) : index,
      offset,
      length,
      label,
      url
    }));
  }
  return Object.freeze(normalized);
}

function normalizeTelegramUpdate(update = {}, { clock = () => new Date() } = {}) {
  const accountId = id(update.accountId, "account_id");
  const chatId = id(update.chatId || update.chatKey, "chat_id");
  const chatKey = String(update.chatKey || chatId).trim();
  const messageId = id(update.messageId, "message_id");
  const senderId = id(update.senderId, "sender_id", { nullable: true });
  const protectedContent = update.protectedContent === true || update.messageNoForwards === true || update.chatNoForwards === true;
  if (protectedContent) {
    return Object.freeze({
      accepted: false,
      reason: "TELERADAR_REJEITADO_PROTECTED_CONTENT",
      metadata: Object.freeze({ accountId, chatId, chatKey, messageId, senderId, protectedContent: true })
    });
  }

  const observedAt = iso(clock(), "received_at");
  const rawSourceTimestamp = update.telegramTimestamp ?? update.messageDate ?? update.date ?? update.receivedAt ?? null;
  const sourceTimestamp = iso(rawSourceTimestamp, "source_timestamp");
  const text = String(update.text || "");
  return Object.freeze({
    accepted: true,
    message: Object.freeze({
      accountId,
      chatId,
      chatKey,
      messageId,
      senderId,
      receivedAt: observedAt,
      sourceTimestamp,
      text,
      textSource: update.textSource === "caption" ? "caption" : "text",
      hasMedia: update.hasMedia === true,
      mediaType: update.mediaType ? String(update.mediaType) : null,
      protectedContent: false,
      entities: normalizeEntities(text, update.entities)
    })
  });
}

module.exports = {
  ENTITY_TYPES,
  canonicalEntityType,
  normalizeEntities,
  normalizeTelegramUpdate
};
