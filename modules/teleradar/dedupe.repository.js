"use strict";

const {
  createTeleradarJsonStore,
  scopedKey,
  validateTeleRadarContext
} = require("./checkpoint.repository");

const DEDUPE_FILE = "teleradar-dedupe.json";

function text(value) {
  return String(value ?? "").trim();
}

function createDedupeRepository({ store = createTeleradarJsonStore(), context } = {}) {
  const validContext = validateTeleRadarContext(context);

  function key(eventId) {
    const id = text(eventId);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("TELERADAR_EVENT_ID_INVALID");
    return scopedKey("dedupe", validContext, id);
  }

  return Object.freeze({
    async has(eventId) {
      const state = await store.read(validContext, DEDUPE_FILE);
      return Boolean(state.entries[key(eventId)]);
    },
    async claim({ eventId, accountId, chatId, messageId, claimedAt }) {
      const dedupeKey = key(eventId);
      return store.mutate(validContext, DEDUPE_FILE, entries => {
        if (entries[dedupeKey]) return { claimed: false };
        entries[dedupeKey] = {
          eventId: text(eventId),
          accountId: text(accountId),
          chatId: text(chatId),
          messageId: text(messageId),
          claimedAt: text(claimedAt)
        };
        return { claimed: true };
      });
    }
  });
}

module.exports = {
  DEDUPE_FILE,
  createDedupeRepository
};
