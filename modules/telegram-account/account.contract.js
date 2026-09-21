"use strict";

const API_ID_MAX = 2147483647;
const CHAT_TYPES = Object.freeze(["group", "supergroup", "channel"]);

function texto(valor) {
  return String(valor ?? "").trim();
}

function idString(valor, campo = "id") {
  if (valor === null || valor === undefined || valor === "") return null;
  const resultado = texto(valor);
  if (!resultado || !/^-?\d+$/.test(resultado)) throw new Error(`${campo}_invalido`);
  return resultado;
}

function parseApiId(valor) {
  const bruto = texto(valor);
  if (!/^\d+$/.test(bruto)) throw new Error("api_id_invalido");
  const apiId = Number(bruto);
  if (!Number.isSafeInteger(apiId) || apiId < 1 || apiId > API_ID_MAX) {
    throw new Error("api_id_invalido");
  }
  return apiId;
}

function validarAccountScope(scope = {}) {
  const fonte = scope && typeof scope === "object" ? scope : {};
  const clientId = texto(fonte.clientId || fonte.clienteId);
  const workspaceId = texto(fonte.workspaceId);
  const scopeName = texto(fonte.scope);
  const feature = texto(fonte.feature);
  if (!clientId || !workspaceId || !scopeName || !feature) {
    throw new Error("account_scope_incompleto");
  }
  return Object.freeze({ clientId, workspaceId, scope: scopeName, feature });
}

function normalizarAccountMetadata(metadata = {}) {
  const fonte = metadata && typeof metadata === "object" ? metadata : {};
  return {
    label: texto(fonte.label).slice(0, 120) || null,
    description: texto(fonte.description).slice(0, 240) || null,
    admin: fonte.admin === true
  };
}

function normalizarIdentity(identity = {}, { accountIdInterno = null, connectionState = "unknown", authorized = false } = {}) {
  const phone = texto(identity.phone);
  const maskedPhone = phone
    ? phone.length <= 4
      ? "*".repeat(phone.length)
      : `${phone.slice(0, -4).replace(/\d/g, "*")}${phone.slice(-4)}`
    : null;
  return Object.freeze({
    accountId: idString(identity.id || identity.accountId, "accountId") || accountIdInterno,
    displayName: texto([identity.firstName, identity.lastName].filter(Boolean).join(" ")) || null,
    username: texto(identity.username) || null,
    maskedPhone,
    connectionState,
    authorized: Boolean(authorized)
  });
}

function entityTypeCanonical(entity) {
  const tipo = texto(entity?.className || entity?.telegramType || entity?.type || entity?.constructor?.name).toLowerCase();
  if (tipo.includes("texturl")) return "text_url";
  if (tipo.endsWith("url")) return "url";
  return tipo.replace(/^messageentity/, "") || "unknown";
}

function normalizarEntity(entity, text, occurrence = 0) {
  const offset = Number(entity?.offset || 0);
  const length = Number(entity?.length || 0);
  const label = String(text || "").slice(offset, offset + length);
  const type = entityTypeCanonical(entity);
  return Object.freeze({
    type,
    telegramType: texto(entity?.className || entity?.telegramType || entity?.type || entity?.constructor?.name) || null,
    occurrence,
    offset,
    length,
    label,
    url: type === "text_url" ? texto(entity?.url) || null : type === "url" ? label : null
  });
}

function normalizarEntities(text, entities = []) {
  return Object.freeze((Array.isArray(entities) ? entities : []).map((entity, index) => normalizarEntity(entity, text, index)));
}

function normalizarChat(chat = {}) {
  const chatId = idString(chat.chatId || chat.id, "chatId");
  return Object.freeze({
    chatKey: texto(chat.chatKey || chatId) || null,
    chatId,
    title: texto(chat.title) || null,
    type: CHAT_TYPES.includes(texto(chat.type)) ? texto(chat.type) : "unknown",
    protectedContent: Boolean(chat.protectedContent || chat.noforwards)
  });
}

function normalizarMessage(message = {}) {
  const chatId = idString(message.chatId || message.chatKey, "chatId");
  const senderId = message.senderId === null || message.senderId === undefined ? null : idString(message.senderId, "senderId");
  const accountId = message.accountId === null || message.accountId === undefined ? null : idString(message.accountId, "accountId");
  const outgoing = Boolean(message.outgoing || message.isOutgoing || (senderId && accountId && senderId === accountId));
  const protectedContent = Boolean(message.protectedContent || message.messageNoForwards || message.chatNoForwards);
  const metadata = {
    accountId,
    chatId,
    chatKey: texto(message.chatKey || chatId) || null,
    messageId: idString(message.messageId || message.id, "messageId"),
    senderId,
    outgoing,
    isOutgoing: outgoing,
    incomingExternal: !outgoing,
    hasMedia: Boolean(message.hasMedia),
    mediaType: texto(message.mediaType) || null,
    protectedContent,
    messageNoForwards: Boolean(message.messageNoForwards),
    chatNoForwards: Boolean(message.chatNoForwards)
  };
  if (protectedContent) return Object.freeze(metadata);
  const text = String(message.text || "");
  return Object.freeze({
    ...metadata,
    text,
    textSource: message.textSource === "caption" ? "caption" : "text",
    entities: normalizarEntities(text, message.entities)
  });
}

module.exports = {
  API_ID_MAX,
  CHAT_TYPES,
  parseApiId,
  validarAccountScope,
  normalizarAccountMetadata,
  idString,
  normalizarIdentity,
  normalizarEntity,
  normalizarEntities,
  normalizarChat,
  normalizarMessage
};
