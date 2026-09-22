"use strict";

const { createTelegramAccountClient } = require("./client-adapter");
const { parseApiId, validarAccountScope, normalizarAccountMetadata } = require("./account.contract");
const { criarRepositorioContasTelegram, accountKey } = require("./account.repository");
const { createTelegramSessionVault } = require("./session-vault");

const AUTH_TRANSIENT_TTL_MS = 2 * 60 * 1000;

function maskedPhone(phone) {
  const value = String(phone || "");
  if (!value) return null;
  return value.length <= 4 ? "*".repeat(value.length) : `${value.slice(0, -4).replace(/./g, "*")}${value.slice(-4)}`;
}

function publicIdentity(identity = {}) {
  if (!identity || typeof identity !== "object") return null;
  const accountId = String(identity.accountId || identity.id || "").trim() || null;
  const displayName = String(identity.displayName || [identity.firstName, identity.lastName].filter(Boolean).join(" ") || "").trim() || null;
  const username = String(identity.username || "").trim() || null;
  const phone = String(identity.maskedPhone || identity.phone || "").trim();
  return Object.freeze({
    accountId,
    displayName,
    username,
    maskedPhone: phone.includes("*") ? phone : maskedPhone(phone)
  });
}

function createTelegramAccountService({
  repository = criarRepositorioContasTelegram(),
  vault = createTelegramSessionVault(),
  adapterFactory = createTelegramAccountClient,
  resolveApiCredentials,
  logger = {},
  authTransientTtlMs = AUTH_TRANSIENT_TTL_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const transient = new Map();
  const clients = new Map();

  function key(accountId, scope) {
    return accountKey(accountId, scope);
  }

  function clearTransient(itemKey) {
    const auth = transient.get(itemKey);
    if (!auth) return false;
    if (auth.timer) clearTimeoutFn(auth.timer);
    auth.phone = "";
    auth.phoneCodeHash = "";
    transient.delete(itemKey);
    return true;
  }

  async function cleanupClient(itemKey, explicitClient = null) {
    const client = explicitClient || clients.get(itemKey);
    clearTransient(itemKey);
    clients.delete(itemKey);
    if (!client) return;
    try {
      await client.disconnect();
    } catch {
      try { logger.warn?.({ code: "telegram_disconnect_failed" }, "telegram_disconnect_failed"); } catch {}
    }
  }

  function scheduleTransientCleanup(itemKey) {
    const ttl = Number(authTransientTtlMs);
    if (!Number.isFinite(ttl) || ttl < 1) throw new Error("telegram_auth_transient_ttl_invalido");
    const timer = setTimeoutFn(() => cleanupClient(itemKey), ttl);
    if (timer && typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function setTransient(itemKey, values = {}) {
    clearTransient(itemKey);
    const auth = {
      phase: values.phase || "code",
      phone: String(values.phone || ""),
      phoneCodeHash: String(values.phoneCodeHash || ""),
      timer: null
    };
    transient.set(itemKey, auth);
    auth.timer = scheduleTransientCleanup(itemKey);
    return auth;
  }

  async function accountRecord(accountId, accountScope) {
    const scope = validarAccountScope(accountScope);
    const record = await repository.getAccount(accountId, scope);
    if (!record) throw new Error("telegram_account_nao_encontrada");
    return { scope, record };
  }

  async function credentials(record, scope) {
    if (typeof resolveApiCredentials !== "function") throw new Error("telegram_api_credentials_resolver_ausente");
    const result = await resolveApiCredentials({ accountIdInterno: record.accountIdInterno, accountScope: scope });
    const apiId = parseApiId(result?.apiId);
    const apiHash = String(result?.apiHash || "").trim();
    if (!apiHash) throw new Error("telegram_api_credentials_invalidas");
    if (typeof vault.assertMasterKey === "function") vault.assertMasterKey();
    return { apiId, apiHash };
  }

  async function buildClient(record, scope, sessionString = "") {
    const creds = await credentials(record, scope);
    return adapterFactory({
      ...creds,
      sessionString,
      accountScope: scope,
      logger,
      onSessionChanged: async (updatedSession) => {
        await repository.saveEncryptedSession(record.accountIdInterno, scope, vault.encrypt(updatedSession));
      },
      onConnectionState: async (connectionState) => {
        const atual = await repository.getAccount(record.accountIdInterno, scope);
        await repository.upsertAccount({ ...(atual || record), accountScope: scope, connectionState, updatedAt: new Date().toISOString() });
      }
    });
  }

  async function finalizeAuthorized({ itemKey, record, scope, identity }) {
    if (!identity || identity.authorized !== true) throw new Error("telegram_authorization_unverified");
    clearTransient(itemKey);
    await repository.upsertAccount({
      ...record,
      accountScope: scope,
      authorized: true,
      connectionState: "authorized",
      identity,
      updatedAt: new Date().toISOString()
    });
    return identity;
  }

  async function provision({ accountIdInterno, accountScope, metadata = {} }) {
    const scope = validarAccountScope(accountScope);
    if (!String(accountIdInterno || "").trim()) throw new Error("telegram_account_id_interno_ausente");
    const existing = await repository.getAccount(accountIdInterno, scope);
    if (existing) return existing;
    const record = {
      accountIdInterno: String(accountIdInterno),
      accountScope: scope,
      connectionState: "provisioned",
      authorized: false,
      metadata: normalizarAccountMetadata(metadata),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return repository.upsertAccount(record);
  }

  async function getConfigurationStatus({ accountIdInterno, accountScope }) {
    try {
      const scope = validarAccountScope(accountScope);
      const record = { accountIdInterno: String(accountIdInterno || "").trim() };
      if (!record.accountIdInterno) throw new Error("telegram_account_id_interno_ausente");
      await credentials(record, scope);
      return Object.freeze({ configured: true });
    } catch {
      return Object.freeze({ configured: false });
    }
  }

  async function getStatus({ accountIdInterno, accountScope }) {
    const scope = validarAccountScope(accountScope);
    const accountId = String(accountIdInterno || "").trim();
    if (!accountId) throw new Error("telegram_account_id_interno_ausente");
    const record = await repository.getAccount(accountId, scope);
    if (!record) {
      return Object.freeze({
        exists: false,
        connected: false,
        authorized: false,
        connectionState: "not_configured",
        identity: null
      });
    }
    const connected = clients.has(key(accountId, scope));
    return Object.freeze({
      exists: true,
      connected,
      authorized: record.authorized === true,
      connectionState: connected ? String(record.connectionState || "connected") : "disconnected",
      identity: publicIdentity(record.identity)
    });
  }

  async function requestLoginCode({ accountIdInterno, accountScope, phone }) {
    const { scope, record } = await accountRecord(accountIdInterno, accountScope);
    const itemKey = key(accountIdInterno, scope);
    await cleanupClient(itemKey);
    const client = await buildClient(record, scope, "");
    clients.set(itemKey, client);
    try {
      const result = await client.requestLoginCode({ phone });
      if (result?.authorizedImmediately === true) {
        const identity = await finalizeAuthorized({ itemKey, record, scope, identity: result.identity });
        return Object.freeze({ authorizedImmediately: true, identity: publicIdentity(identity) });
      }
      setTransient(itemKey, {
        phase: "code",
        phone: String(phone),
        phoneCodeHash: String(result.phoneCodeHash || "")
      });
      return Object.freeze({
        codeType: result.codeType || null,
        codeLength: result.codeLength ?? null,
        timeout: result.timeout ?? null,
        phone: maskedPhone(phone)
      });
    } catch (error) {
      await cleanupClient(itemKey, client);
      throw error;
    }
  }

  async function signInWithCode({ accountIdInterno, accountScope, code }) {
    const { scope, record } = await accountRecord(accountIdInterno, accountScope);
    const itemKey = key(accountIdInterno, scope);
    const auth = transient.get(itemKey);
    if (!auth || auth.phase !== "code") throw new Error("telegram_auth_transient_ausente");
    const client = clients.get(itemKey) || await buildClient(record, scope, "");
    let codeValue = String(code || "");
    try {
      const identity = await client.signInWithCode({ phone: auth.phone, phoneCodeHash: auth.phoneCodeHash, code: codeValue });
      return finalizeAuthorized({ itemKey, record, scope, identity });
    } catch (error) {
      clearTransient(itemKey);
      if (error?.code === "telegram_2fa_required") setTransient(itemKey, { phase: "password" });
      else await cleanupClient(itemKey, client);
      throw error;
    } finally {
      codeValue = "";
      code = undefined;
    }
  }

  async function signInWithPassword({ accountIdInterno, accountScope, password }) {
    const { scope, record } = await accountRecord(accountIdInterno, accountScope);
    const itemKey = key(accountIdInterno, scope);
    const client = clients.get(itemKey);
    const auth = transient.get(itemKey);
    if (!client || !auth || auth.phase !== "password") throw new Error("telegram_auth_2fa_nao_solicitada");
    let passwordValue = String(password || "");
    try {
      const identity = await client.signInWithPassword({ password: passwordValue });
      return finalizeAuthorized({ itemKey, record, scope, identity });
    } catch (error) {
      await cleanupClient(itemKey, client);
      throw error;
    } finally {
      passwordValue = "";
      password = undefined;
    }
  }

  async function restore({ accountIdInterno, accountScope }) {
    const { scope, record } = await accountRecord(accountIdInterno, accountScope);
    const envelope = await repository.getEncryptedSession(record.accountIdInterno, scope);
    if (!envelope) throw new Error("telegram_session_nao_encontrada");
    const itemKey = key(accountIdInterno, scope);
    await cleanupClient(itemKey);
    const client = await buildClient(record, scope, vault.decrypt(envelope));
    try {
      await client.connect();
      const authorized = await client.isAuthorized();
      const identity = authorized ? await client.getIdentity() : null;
      clients.set(itemKey, client);
      await repository.upsertAccount({ ...record, accountScope: scope, authorized, connectionState: authorized ? "authorized" : "connected", identity, updatedAt: new Date().toISOString() });
      return Object.freeze({ identity, authorized });
    } catch (error) {
      await cleanupClient(itemKey, client);
      throw error;
    }
  }

  async function disconnect({ accountIdInterno, accountScope }) {
    const { scope, record } = await accountRecord(accountIdInterno, accountScope);
    const itemKey = key(accountIdInterno, scope);
    await cleanupClient(itemKey);
    await repository.upsertAccount({
      ...record,
      accountScope: scope,
      connectionState: "disconnected",
      updatedAt: new Date().toISOString()
    });
    return { ok: true };
  }

  async function cancelAuthentication({ accountIdInterno, accountScope }) {
    const { scope } = await accountRecord(accountIdInterno, accountScope);
    await cleanupClient(key(accountIdInterno, scope));
    return { ok: true };
  }

  async function connectedClient(accountIdInterno, accountScope) {
    const { scope } = await accountRecord(accountIdInterno, accountScope);
    const client = clients.get(key(accountIdInterno, scope));
    if (!client) throw new Error("telegram_account_nao_conectada");
    return client;
  }

  async function listParticipatingChats({ accountIdInterno, accountScope }) {
    return (await connectedClient(accountIdInterno, accountScope)).listParticipatingChats();
  }

  async function subscribeNewMessages({ accountIdInterno, accountScope, allowedChatKeys, onMessage }) {
    return (await connectedClient(accountIdInterno, accountScope)).subscribeNewMessages({ allowedChatKeys, onMessage });
  }

  async function remove({ accountIdInterno, accountScope }) {
    const { scope } = await accountRecord(accountIdInterno, accountScope);
    await disconnect({ accountIdInterno, accountScope: scope });
    await repository.removeAccount(accountIdInterno, scope);
    return { ok: true };
  }

  return Object.freeze({
    provision,
    getConfigurationStatus,
    getStatus,
    requestLoginCode,
    signInWithCode,
    signInWithPassword,
    restore,
    disconnect,
    cancelAuthentication,
    listParticipatingChats,
    subscribeNewMessages,
    remove
  });
}

module.exports = { AUTH_TRANSIENT_TTL_MS, createTelegramAccountService };
