"use strict";

const fs = require("fs");
const { getClienteJsonPath, normalizarClienteId, writeClienteJson } = require("../../utils/storage");

const STORAGE_SCHEMA_VERSION = 1;
const CHECKPOINTS_FILE = "teleradar-checkpoints.json";
const mutationQueues = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function validateTeleRadarContext(value = {}) {
  const context = {
    clientId: text(value.clientId || value.clienteId),
    workspaceId: text(value.workspaceId),
    scope: text(value.scope),
    feature: text(value.feature),
    accountIdInterno: text(value.accountIdInterno)
  };
  if (!context.clientId || !context.workspaceId || !context.accountIdInterno) throw new Error("TELERADAR_CONTEXT_INVALID");
  if (context.scope !== "admin_master" || context.feature !== "teleradar") throw new Error("TELERADAR_SCOPE_NOT_ALLOWED");
  normalizarClienteId(context.clientId);
  return Object.freeze(context);
}

function contextParts(context) {
  const valid = validateTeleRadarContext(context);
  return [valid.clientId, valid.workspaceId, valid.scope, valid.feature, valid.accountIdInterno];
}

function scopedKey(kind, context, ...parts) {
  return `${kind}.v1.${Buffer.from(JSON.stringify([...contextParts(context), ...parts.map(text)]), "utf8").toString("base64url")}`;
}

function storageError() {
  const error = new Error("TELERADAR_STORAGE_CORRUPTED");
  error.code = "TELERADAR_STORAGE_CORRUPTED";
  return error;
}

function emptyState() {
  return { schemaVersion: STORAGE_SCHEMA_VERSION, entries: {} };
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw storageError();
  if (value.schemaVersion !== STORAGE_SCHEMA_VERSION) throw storageError();
  if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw storageError();
  return value;
}

function readClienteJsonStrict(clientId, fileName, fallback) {
  const file = getClienteJsonPath(normalizarClienteId(clientId), fileName);
  if (!fs.existsSync(file)) return clone(fallback);
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) throw storageError();
    return JSON.parse(raw);
  } catch {
    throw storageError();
  }
}

function enqueueMutation(key, operation) {
  const previous = mutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutationQueues.set(key, current);
  return current.finally(() => {
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  });
}

function createTeleradarJsonStore({ read = readClienteJsonStrict, write = writeClienteJson } = {}) {
  async function load(context, fileName) {
    try {
      const valid = validateTeleRadarContext(context);
      const state = await read(valid.clientId, fileName, emptyState());
      return clone(validateState(state));
    } catch (error) {
      if (error?.code === "TELERADAR_STORAGE_CORRUPTED") throw error;
      throw storageError();
    }
  }

  return Object.freeze({
    async read(context, fileName) {
      return load(context, fileName);
    },
    async mutate(context, fileName, operation) {
      if (typeof operation !== "function") throw new Error("TELERADAR_STORAGE_MUTATOR_REQUIRED");
      const valid = validateTeleRadarContext(context);
      const queueKey = `${valid.clientId}:${fileName}`;
      return enqueueMutation(queueKey, async () => {
        const state = await load(valid, fileName);
        const result = await operation(state.entries);
        await write(valid.clientId, fileName, state);
        return clone(result);
      });
    }
  });
}

function createMemoryTeleradarStore(seed = {}) {
  const files = new Map(Object.entries(clone(seed)));
  const store = createTeleradarJsonStore({
    read: async (clientId, fileName, fallback) => clone(files.get(`${clientId}:${fileName}`) || fallback),
    write: async (clientId, fileName, value) => { files.set(`${clientId}:${fileName}`, clone(value)); }
  });
  return Object.freeze({ ...store, snapshot: () => clone(Object.fromEntries(files)) });
}

function messageId(value) {
  const id = text(value);
  if (!/^\d+$/.test(id)) throw new Error("TELERADAR_MESSAGE_ID_INVALID");
  return id;
}

function compareMessageIds(left, right) {
  const a = BigInt(messageId(left));
  const b = BigInt(messageId(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function createCheckpointRepository({ store = createTeleradarJsonStore(), context } = {}) {
  const validContext = validateTeleRadarContext(context);

  function key(chatKey) {
    const chat = text(chatKey);
    if (!chat || chat.includes("*")) throw new Error("TELERADAR_CHAT_KEY_INVALID");
    return scopedKey("checkpoint", validContext, chat);
  }

  return Object.freeze({
    async get(chatKey) {
      const state = await store.read(validContext, CHECKPOINTS_FILE);
      return clone(state.entries[key(chatKey)] || null);
    },
    async acceptIfNewer({ chatKey, messageId: rawMessageId, activatedAt, acceptedAt }) {
      const id = messageId(rawMessageId);
      const checkpointKey = key(chatKey);
      return store.mutate(validContext, CHECKPOINTS_FILE, entries => {
        const current = entries[checkpointKey] || null;
        if (current?.lastAcceptedMessageId && compareMessageIds(id, current.lastAcceptedMessageId) <= 0) {
          return { accepted: false, checkpoint: current };
        }
        const checkpoint = {
          accountIdInterno: validContext.accountIdInterno,
          chatKey: text(chatKey),
          activatedAt: text(activatedAt),
          lastAcceptedMessageId: id,
          lastAcceptedAt: text(acceptedAt)
        };
        entries[checkpointKey] = checkpoint;
        return { accepted: true, checkpoint };
      });
    }
  });
}

module.exports = {
  STORAGE_SCHEMA_VERSION,
  CHECKPOINTS_FILE,
  validateTeleRadarContext,
  scopedKey,
  createTeleradarJsonStore,
  createMemoryTeleradarStore,
  createCheckpointRepository,
  compareMessageIds
};
