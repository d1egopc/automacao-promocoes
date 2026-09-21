"use strict";

const fs = require("fs");
const { getClienteJsonPath, writeClienteJson, normalizarClienteId } = require("../../utils/storage");

const RECORDS_FILE = "telegram-account-records.json";
const SESSIONS_FILE = "telegram-account-sessions.json";
const KEY_VERSION = "ta1";
const mutationQueues = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function scopeParts(scope = {}) {
  const clientId = String(scope?.clientId || scope?.clienteId || "").trim();
  const workspaceId = String(scope?.workspaceId || "").trim();
  const scopeName = String(scope?.scope || "").trim();
  const feature = String(scope?.feature || "").trim();
  if (!clientId || !workspaceId || !scopeName || !feature) throw new Error("telegram_account_key_invalida");
  return [clientId, workspaceId, scopeName, feature];
}

function encodeKey(parts) {
  return `${KEY_VERSION}.${Buffer.from(JSON.stringify(parts), "utf8").toString("base64url")}`;
}

function accountKey(accountId, scope) {
  const id = String(accountId || "").trim();
  if (!id) throw new Error("telegram_account_key_invalida");
  return encodeKey([...scopeParts(scope), id]);
}

function sameScope(record, scope) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  try {
    const expected = scopeParts(scope);
    const actual = scopeParts(record.accountScope);
    return actual.every((value, index) => value === expected[index]);
  } catch {
    return false;
  }
}

function storageError(cause) {
  if (cause?.code === "telegram_account_storage_corrompido") return cause;
  const error = new Error("telegram_account_storage_corrompido");
  error.code = "telegram_account_storage_corrompido";
  return error;
}

function readClienteJsonStrict(clienteId, arquivo, fallback = {}) {
  const file = getClienteJsonPath(normalizarClienteId(clienteId), arquivo);
  if (!fs.existsSync(file)) return clone(fallback);
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) throw new SyntaxError("empty_json");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("json_object_required");
    return parsed;
  } catch (error) {
    throw storageError(error);
  }
}

function enqueueMutation(queueKey, operation) {
  const previous = mutationQueues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutationQueues.set(queueKey, current);
  return current.finally(() => {
    if (mutationQueues.get(queueKey) === current) mutationQueues.delete(queueKey);
  });
}

function criarRepositorioMemoriaContasTelegram() {
  const records = new Map();
  const sessions = new Map();
  return {
    async upsertAccount(record) {
      const key = accountKey(record.accountIdInterno, record.accountScope);
      records.set(key, clone({ ...records.get(key), ...record, accountKey: key }));
      return clone(records.get(key));
    },
    async getAccount(accountId, scope) { return clone(records.get(accountKey(accountId, scope)) || null); },
    async listAccounts(scope) {
      scopeParts(scope);
      return clone([...records.values()].filter(item => sameScope(item, scope)));
    },
    async saveEncryptedSession(accountId, scope, envelope) {
      const key = accountKey(accountId, scope);
      sessions.set(key, clone(envelope));
      return { ok: true };
    },
    async getEncryptedSession(accountId, scope) { return clone(sessions.get(accountKey(accountId, scope)) || null); },
    async removeAccount(accountId, scope) {
      const key = accountKey(accountId, scope);
      sessions.delete(key);
      return records.delete(key);
    }
  };
}

function criarRepositorioContasTelegram({ read = readClienteJsonStrict, write = writeClienteJson } = {}) {
  function cliente(scope) {
    return normalizarClienteId(scopeParts(scope)[0]);
  }
  async function ler(arquivo, scope, fallback) {
    try {
      const dados = await read(cliente(scope), arquivo, clone(fallback));
      if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new TypeError("json_object_required");
      return clone(dados);
    } catch (error) {
      throw storageError(error);
    }
  }
  async function gravar(arquivo, scope, dados) {
    await write(cliente(scope), arquivo, clone(dados));
  }
  function mutate(scope, operation) {
    return enqueueMutation(cliente(scope), operation);
  }
  return {
    async upsertAccount(record) {
      const scope = record.accountScope;
      return mutate(scope, async () => {
        const dados = await ler(RECORDS_FILE, scope, {});
        const key = accountKey(record.accountIdInterno, scope);
        dados[key] = { ...dados[key], ...record, accountKey: key };
        await gravar(RECORDS_FILE, scope, dados);
        return clone(dados[key]);
      });
    },
    async getAccount(accountId, scope) {
      const dados = await ler(RECORDS_FILE, scope, {});
      return clone(dados[accountKey(accountId, scope)] || null);
    },
    async listAccounts(scope) {
      scopeParts(scope);
      const dados = await ler(RECORDS_FILE, scope, {});
      return clone(Object.values(dados).filter(item => sameScope(item, scope)));
    },
    async saveEncryptedSession(accountId, scope, envelope) {
      return mutate(scope, async () => {
        const dados = await ler(SESSIONS_FILE, scope, {});
        dados[accountKey(accountId, scope)] = clone(envelope);
        await gravar(SESSIONS_FILE, scope, dados);
        return { ok: true };
      });
    },
    async getEncryptedSession(accountId, scope) {
      const dados = await ler(SESSIONS_FILE, scope, {});
      return clone(dados[accountKey(accountId, scope)] || null);
    },
    async removeAccount(accountId, scope) {
      return mutate(scope, async () => {
        const key = accountKey(accountId, scope);
        const records = await ler(RECORDS_FILE, scope, {});
        const sessions = await ler(SESSIONS_FILE, scope, {});
        const had = Boolean(records[key] || sessions[key]);
        delete records[key];
        delete sessions[key];
        await gravar(RECORDS_FILE, scope, records);
        await gravar(SESSIONS_FILE, scope, sessions);
        return had;
      });
    }
  };
}

module.exports = {
  RECORDS_FILE,
  SESSIONS_FILE,
  KEY_VERSION,
  accountKey,
  readClienteJsonStrict,
  criarRepositorioMemoriaContasTelegram,
  criarRepositorioContasTelegram
};
