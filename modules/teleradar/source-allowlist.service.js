"use strict";

const {
  createTeleradarJsonStore,
  scopedKey,
  validateTeleRadarContext
} = require("./checkpoint.repository");

const SOURCES_FILE = "teleradar-sources.json";
const CHAT_TYPES = new Set(["group", "supergroup", "channel"]);

function text(value, max = 0) {
  const result = String(value ?? "").trim();
  return max > 0 ? result.slice(0, max) : result;
}

function chatKey(value) {
  const key = text(value);
  if (!key || key.includes("*")) throw new Error("TELERADAR_CHAT_KEY_INVALID");
  return key;
}

function sanitizeSource(source = {}, { activatedAt, enabled = true } = {}) {
  const key = chatKey(source.chatKey || source.chatId);
  const chatId = text(source.chatId || key);
  if (!/^-?\d+$/.test(chatId)) throw new Error("TELERADAR_CHAT_ID_INVALID");
  const type = text(source.type).toLowerCase();
  return Object.freeze({
    chatKey: key,
    chatId,
    title: text(source.title, 200) || null,
    type: CHAT_TYPES.has(type) ? type : "unknown",
    enabled: enabled === true,
    activatedAt: text(activatedAt) || null,
    protectedContent: source.protectedContent === true
  });
}

function sameContext(record, context) {
  const sourceContext = record?.context;
  return Boolean(sourceContext
    && sourceContext.clientId === context.clientId
    && sourceContext.workspaceId === context.workspaceId
    && sourceContext.scope === context.scope
    && sourceContext.feature === context.feature
    && sourceContext.accountIdInterno === context.accountIdInterno);
}

function createSourceAllowlistService({ store = createTeleradarJsonStore(), context, clock = () => new Date() } = {}) {
  const validContext = validateTeleRadarContext(context);

  function recordKey(key) {
    return scopedKey("source", validContext, chatKey(key));
  }

  async function listSelectedSources() {
    const state = await store.read(validContext, SOURCES_FILE);
    return Object.values(state.entries)
      .filter(record => sameContext(record, validContext) && record.enabled === true)
      .map(record => sanitizeSource(record, { activatedAt: record.activatedAt, enabled: true }))
      .sort((left, right) => left.chatKey.localeCompare(right.chatKey));
  }

  async function getSelectedSource(key) {
    const state = await store.read(validContext, SOURCES_FILE);
    const record = state.entries[recordKey(key)];
    if (!record || !sameContext(record, validContext) || record.enabled !== true) return null;
    return sanitizeSource(record, { activatedAt: record.activatedAt, enabled: true });
  }

  async function replaceSelectedSources(sources = []) {
    if (!Array.isArray(sources)) throw new Error("TELERADAR_SOURCES_INVALID");
    const now = clock().toISOString();
    const normalized = sources.map(source => sanitizeSource(source, { activatedAt: now, enabled: true }));
    const unique = new Set(normalized.map(source => source.chatKey));
    if (unique.size !== normalized.length) throw new Error("TELERADAR_SOURCE_DUPLICATED");

    return store.mutate(validContext, SOURCES_FILE, entries => {
      const existing = Object.values(entries).filter(record => sameContext(record, validContext));
      const existingByChat = new Map(existing.map(record => [record.chatKey, record]));
      for (const [key, record] of Object.entries(entries)) {
        if (sameContext(record, validContext)) delete entries[key];
      }
      const selected = normalized.map(source => {
        const previous = existingByChat.get(source.chatKey);
        const record = {
          ...source,
          activatedAt: previous?.enabled === true ? previous.activatedAt : now,
          context: validContext
        };
        entries[recordKey(source.chatKey)] = record;
        return sanitizeSource(record, { activatedAt: record.activatedAt, enabled: true });
      });
      return selected.sort((left, right) => left.chatKey.localeCompare(right.chatKey));
    });
  }

  return Object.freeze({ listSelectedSources, getSelectedSource, replaceSelectedSources });
}

module.exports = {
  SOURCES_FILE,
  sanitizeSource,
  createSourceAllowlistService
};
