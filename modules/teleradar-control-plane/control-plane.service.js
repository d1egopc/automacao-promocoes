"use strict";

const crypto = require("crypto");
const { AUTH_TRANSIENT_TTL_MS, createTelegramAccountService } = require("../telegram-account");
const { createTeleRadarService } = require("../teleradar");

const ACCOUNT_ID_INTERNO = "admin-master-teleradar";
const ACCOUNT_SCOPE = "admin_master";
const FEATURE = "teleradar";

function controlPlaneError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function errorText(error) {
  return [error?.errorMessage, error?.code, error?.name, error?.message]
    .map(value => String(value || ""))
    .join(" ")
    .toLowerCase();
}

function mapOperationError(error) {
  if (error?.code && error?.statusCode) return error;
  const text = errorText(error);
  if (text.includes("phone_number_invalid")) return controlPlaneError("TELEGRAM_PHONE_INVALID", 400);
  if (text.includes("flood") || text.includes("wait")) return controlPlaneError("TELEGRAM_FLOOD_WAIT", 429);
  if (text.includes("phone_code_invalid") || text.includes("phone_code_expired") || text.includes("code_invalid")) {
    return controlPlaneError("TELEGRAM_CODE_INVALID", 400);
  }
  if (text.includes("password_hash_invalid") || text.includes("password_invalid")) {
    return controlPlaneError("TELEGRAM_2FA_INVALID", 400);
  }
  if (text.includes("auth_transient_ausente") || text.includes("auth_2fa_nao_solicitada")) {
    return controlPlaneError("TELEGRAM_AUTH_FLOW_EXPIRED", 410);
  }
  if (text.includes("account_nao_conectada") || text.includes("session_nao_encontrada")) {
    return controlPlaneError("TELEGRAM_ACCOUNT_NOT_CONNECTED", 409);
  }
  if (text.includes("source_not_available") || text.includes("chat_key_invalid") || text.includes("sources_invalid")) {
    return controlPlaneError("TELERADAR_SOURCE_INVALID", 400);
  }
  if (text.includes("api_credentials") || text.includes("api_id") || text.includes("master_key")) {
    return controlPlaneError("TELEGRAM_NOT_CONFIGURED", 503);
  }
  if (text.includes("sign_up") || text.includes("registration")) {
    return controlPlaneError("TELEGRAM_REGISTRATION_REQUIRED", 409);
  }
  return controlPlaneError("TELEGRAM_OPERATION_FAILED", 502);
}

function maskPhone(phone) {
  const value = String(phone || "").trim();
  if (!value) return null;
  const suffix = value.slice(-4);
  return `${"*".repeat(Math.max(0, value.length - 4))}${suffix}`;
}

function sanitizeIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  const phone = String(identity.maskedPhone || identity.phone || "").trim();
  return Object.freeze({
    accountId: String(identity.accountId || identity.id || "").trim() || null,
    displayName: String(identity.displayName || "").trim() || null,
    username: String(identity.username || "").trim() || null,
    maskedPhone: phone ? (phone.includes("*") ? phone : maskPhone(phone)) : null
  });
}

function sanitizeSource(source) {
  return Object.freeze({
    chatKey: String(source?.chatKey || ""),
    chatId: String(source?.chatId || source?.chatKey || ""),
    title: String(source?.title || ""),
    type: String(source?.type || "unknown"),
    selected: source?.enabled === true || source?.selected === true,
    protectedContent: source?.protectedContent === true,
    activatedAt: source?.activatedAt || null,
    lastAcceptedMessageId: source?.lastAcceptedMessageId ? String(source.lastAcceptedMessageId) : null,
    lastAcceptedAt: source?.lastAcceptedAt || null
  });
}

function createTelegramTeleRadarControlPlane({
  accountService: injectedAccountService,
  accountServiceFactory = createTelegramAccountService,
  teleRadarServiceFactory = createTeleRadarService,
  env = process.env,
  clock = () => new Date(),
  authFlowTtlMs = AUTH_TRANSIENT_TTL_MS,
  idFactory = () => crypto.randomUUID(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = {}
} = {}) {
  let accountService = injectedAccountService || null;
  const runtimes = new Map();
  const authFlows = new Map();
  const authTtl = Number(authFlowTtlMs);
  if (!Number.isFinite(authTtl) || authTtl < 1) throw new Error("AUTH_FLOW_CONFIGURATION_INVALID");

  function nowIso() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw controlPlaneError("CONTROL_PLANE_CLOCK_INVALID", 500);
    return date.toISOString();
  }

  function requireAdminActor(actor) {
    if (String(actor?.papel || actor?.role || "").toLowerCase() !== "admin_master") {
      throw controlPlaneError("ADMIN_MASTER_REQUIRED", 403);
    }
    const identity = String(actor?.id || actor?.clienteId || actor?.clientId || "").trim();
    if (!identity) throw controlPlaneError("ADMIN_MASTER_IDENTITY_REQUIRED", 403);
    return Object.freeze({
      clientId: identity,
      workspaceId: identity,
      scope: ACCOUNT_SCOPE,
      feature: FEATURE,
      accountIdInterno: ACCOUNT_ID_INTERNO
    });
  }

  function scopeFrom(context) {
    return Object.freeze({
      clientId: context.clientId,
      workspaceId: context.workspaceId,
      scope: context.scope,
      feature: context.feature
    });
  }

  function contextKey(context) {
    return JSON.stringify([
      context.clientId,
      context.workspaceId,
      context.scope,
      context.feature,
      context.accountIdInterno
    ]);
  }

  function getAccountService() {
    if (!accountService) {
      accountService = accountServiceFactory({
        resolveApiCredentials: async () => ({
          apiId: env.TELEGRAM_ACCOUNT_API_ID,
          apiHash: env.TELEGRAM_ACCOUNT_API_HASH
        }),
        logger
      });
    }
    return accountService;
  }

  function getRuntime(context) {
    const key = contextKey(context);
    let runtime = runtimes.get(key);
    if (!runtime) {
      const service = teleRadarServiceFactory({
        context,
        telegramAccountService: getAccountService(),
        logger
      });
      runtime = { service, enabled: false };
      runtimes.set(key, runtime);
    }
    return runtime;
  }

  function safeLog(level, code, metadata = {}) {
    const allowed = {
      code,
      accountIdInterno: ACCOUNT_ID_INTERNO,
      state: metadata.state || null,
      chatKey: metadata.chatKey ? String(metadata.chatKey) : null,
      eventId: metadata.eventId ? String(metadata.eventId) : null,
      handoffLatencyMs: Number.isFinite(metadata.handoffLatencyMs) ? metadata.handoffLatencyMs : null
    };
    try { logger[level]?.(allowed, code); } catch {}
  }

  function safeErrorName(value, fallback = null) {
    const candidate = String(value || "").trim();
    if (!candidate || candidate.length > 80 || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(candidate)) return fallback;
    return candidate;
  }

  function safeErrorCode(value, fallback = null) {
    const candidate = String(value || "").trim();
    if (!candidate || candidate.length > 120 || !/^[A-Z][A-Z0-9_]*$/.test(candidate)) return fallback;
    return candidate;
  }

  function authErrorStage(error, fallback = "unknown") {
    const allowed = new Set(["validation", "configuration", "provision", "runtime_stop", "connect", "send_code", "unknown"]);
    const candidate = String(error?.telegramAuthStage || fallback || "unknown");
    return allowed.has(candidate) ? candidate : "unknown";
  }

  function logAuthStartError(error, mappedError, stage, phonePresent, phoneStructurallyValid) {
    const entry = {
      stage: authErrorStage(error, stage),
      errorName: safeErrorName(error?.name, "Error"),
      rpcCode: safeErrorCode(error?.errorMessage) || safeErrorCode(error?.code),
      publicCode: safeErrorCode(mappedError?.code, "TELEGRAM_OPERATION_FAILED"),
      phonePresent: phonePresent === true,
      phoneStructurallyValid: phoneStructurallyValid === true
    };
    try { logger.error?.("[TELEGRAM-ACCOUNT-AUTH-START-ERRO]", entry); } catch {}
  }

  function clearFlow(flowId) {
    const flow = authFlows.get(flowId);
    if (!flow) return false;
    if (flow.timer) clearTimeoutFn(flow.timer);
    flow.maskedPhone = null;
    authFlows.delete(flowId);
    return true;
  }

  function clearContextFlows(context) {
    const key = contextKey(context);
    for (const [flowId, flow] of authFlows.entries()) {
      if (flow.contextKey === key) clearFlow(flowId);
    }
  }

  function createFlow(context, phase, maskedPhoneValue = null) {
    clearContextFlows(context);
    const authFlowId = String(idFactory());
    if (!authFlowId) throw controlPlaneError("AUTH_FLOW_CONFIGURATION_INVALID", 500);
    const flow = {
      authFlowId,
      contextKey: contextKey(context),
      phase,
      maskedPhone: maskedPhoneValue,
      createdAt: nowIso(),
      timer: null
    };
    authFlows.set(authFlowId, flow);
    flow.timer = setTimeoutFn(() => {
      if (!clearFlow(authFlowId)) return;
      getAccountService().cancelAuthentication({
        accountIdInterno: context.accountIdInterno,
        accountScope: scopeFrom(context)
      }).catch(() => safeLog("warn", "TELEGRAM_AUTH_FLOW_EXPIRED", { state: "expired" }));
    }, authTtl);
    if (flow.timer && typeof flow.timer.unref === "function") flow.timer.unref();
    return flow;
  }

  function requireFlow(context, authFlowId, phase) {
    const id = String(authFlowId || "").trim();
    const flow = authFlows.get(id);
    if (!flow || flow.contextKey !== contextKey(context) || (phase && flow.phase !== phase)) {
      throw controlPlaneError("TELEGRAM_AUTH_FLOW_EXPIRED", 410);
    }
    return flow;
  }

  async function getTelegramStatus(actor) {
    const context = requireAdminActor(actor);
    const service = getAccountService();
    const accountScope = scopeFrom(context);
    const [configuration, status] = await Promise.all([
      service.getConfigurationStatus({ accountIdInterno: context.accountIdInterno, accountScope }),
      service.getStatus({ accountIdInterno: context.accountIdInterno, accountScope })
    ]);
    return Object.freeze({
      configured: configuration.configured === true,
      exists: status.exists === true,
      connected: status.connected === true,
      authorized: status.authorized === true,
      connectionState: String(status.connectionState || "unknown"),
      identity: sanitizeIdentity(status.identity)
    });
  }

  async function authStart(actor, { phone } = {}) {
    const context = requireAdminActor(actor);
    let phoneValue = String(phone || "").trim();
    const service = getAccountService();
    const accountScope = scopeFrom(context);
    let stage = "validation";
    const phonePresent = Boolean(phoneValue);
    const phoneStructurallyValid = /^\+[1-9]\d{7,14}$/.test(phoneValue);
    try {
      if (!phoneStructurallyValid) throw controlPlaneError("TELEGRAM_PHONE_INVALID", 400);
      stage = "configuration";
      const configuration = await service.getConfigurationStatus({ accountIdInterno: context.accountIdInterno, accountScope });
      if (configuration.configured !== true) throw controlPlaneError("TELEGRAM_NOT_CONFIGURED", 503);
      stage = "provision";
      await service.provision({
        accountIdInterno: context.accountIdInterno,
        accountScope,
        metadata: { purpose: FEATURE }
      });
      const runtime = runtimes.get(contextKey(context));
      stage = "runtime_stop";
      if (runtime?.service?.getStatus?.().running === true) await runtime.service.stop();
      clearContextFlows(context);
      stage = "unknown";
      const result = await service.requestLoginCode({
        accountIdInterno: context.accountIdInterno,
        accountScope,
        phone: phoneValue
      });
      const flow = createFlow(context, "code", result?.phone || maskPhone(phoneValue));
      safeLog("info", "TELEGRAM_AUTH_CODE_REQUESTED", { state: "code_required" });
      return Object.freeze({
        authFlowId: flow.authFlowId,
        state: "code_required",
        maskedPhone: flow.maskedPhone,
        codeType: result?.codeType || null,
        codeLength: result?.codeLength ?? null,
        timeout: result?.timeout ?? null
      });
    } catch (error) {
      const mappedError = mapOperationError(error);
      logAuthStartError(error, mappedError, stage, phonePresent, phoneStructurallyValid);
      throw mappedError;
    } finally {
      phoneValue = "";
      phone = undefined;
    }
  }

  async function authCode(actor, { authFlowId, code } = {}) {
    const context = requireAdminActor(actor);
    const flow = requireFlow(context, authFlowId, "code");
    let codeValue = String(code || "").trim();
    try {
      if (!codeValue) throw controlPlaneError("TELEGRAM_CODE_INVALID", 400);
      const identity = await getAccountService().signInWithCode({
        accountIdInterno: context.accountIdInterno,
        accountScope: scopeFrom(context),
        code: codeValue
      });
      clearFlow(flow.authFlowId);
      return Object.freeze({ state: "authorized", identity: sanitizeIdentity(identity) });
    } catch (error) {
      if (String(error?.code || error?.message || "").includes("telegram_2fa_required")) {
        flow.phase = "password";
        flow.maskedPhone = null;
        return Object.freeze({ authFlowId: flow.authFlowId, state: "2fa_required" });
      }
      clearFlow(flow.authFlowId);
      throw mapOperationError(error);
    } finally {
      codeValue = "";
      code = undefined;
    }
  }

  async function auth2fa(actor, { authFlowId, password } = {}) {
    const context = requireAdminActor(actor);
    const flow = requireFlow(context, authFlowId, "password");
    let passwordValue = String(password || "");
    try {
      if (!passwordValue) throw controlPlaneError("TELEGRAM_2FA_INVALID", 400);
      const identity = await getAccountService().signInWithPassword({
        accountIdInterno: context.accountIdInterno,
        accountScope: scopeFrom(context),
        password: passwordValue
      });
      clearFlow(flow.authFlowId);
      return Object.freeze({ state: "authorized", identity: sanitizeIdentity(identity) });
    } catch (error) {
      clearFlow(flow.authFlowId);
      throw mapOperationError(error);
    } finally {
      passwordValue = "";
      password = undefined;
    }
  }

  async function authCancel(actor, { authFlowId } = {}) {
    const context = requireAdminActor(actor);
    const flow = requireFlow(context, authFlowId);
    try {
      await getAccountService().cancelAuthentication({
        accountIdInterno: context.accountIdInterno,
        accountScope: scopeFrom(context)
      });
    } catch (error) {
      if (!errorText(error).includes("account_nao_encontrada")) throw mapOperationError(error);
    } finally {
      clearFlow(flow.authFlowId);
    }
    return Object.freeze({ cancelled: true });
  }

  async function ensureConnected(context) {
    const service = getAccountService();
    const accountScope = scopeFrom(context);
    let status = await service.getStatus({ accountIdInterno: context.accountIdInterno, accountScope });
    if (status.authorized !== true) throw controlPlaneError("TELEGRAM_ACCOUNT_NOT_AUTHORIZED", 409);
    if (status.connected !== true) {
      const restored = await service.restore({ accountIdInterno: context.accountIdInterno, accountScope });
      if (restored?.authorized !== true) throw controlPlaneError("TELEGRAM_ACCOUNT_NOT_AUTHORIZED", 409);
      status = await service.getStatus({ accountIdInterno: context.accountIdInterno, accountScope });
    }
    return status;
  }

  async function ensureAuthorized(context) {
    const status = await getAccountService().getStatus({
      accountIdInterno: context.accountIdInterno,
      accountScope: scopeFrom(context)
    });
    if (status.authorized !== true) throw controlPlaneError("TELEGRAM_ACCOUNT_NOT_AUTHORIZED", 409);
    return status;
  }

  async function removeAccount(actor) {
    const context = requireAdminActor(actor);
    const runtime = runtimes.get(contextKey(context));
    try {
      if (runtime) {
        await runtime.service.stop();
        runtime.enabled = false;
      }
      clearContextFlows(context);
      const service = getAccountService();
      const accountScope = scopeFrom(context);
      const status = await service.getStatus({
        accountIdInterno: context.accountIdInterno,
        accountScope
      });
      if (status.exists !== true) {
        runtimes.delete(contextKey(context));
        return Object.freeze({ removed: true, alreadyAbsent: true, remoteLogout: false });
      }
      await service.remove({
        accountIdInterno: context.accountIdInterno,
        accountScope
      });
      runtimes.delete(contextKey(context));
      return Object.freeze({ removed: true, alreadyAbsent: false, remoteLogout: false });
    } catch (error) {
      throw mapOperationError(error);
    }
  }

  async function listAvailableSources(actor) {
    const context = requireAdminActor(actor);
    await ensureConnected(context);
    try {
      return (await getRuntime(context).service.listAvailableSources()).map(sanitizeSource);
    } catch (error) {
      throw mapOperationError(error);
    }
  }

  async function listSelectedSources(actor) {
    const context = requireAdminActor(actor);
    return (await getRuntime(context).service.listSelectedSources()).map(sanitizeSource);
  }

  async function replaceSelectedSources(actor, { chatKeys } = {}) {
    const context = requireAdminActor(actor);
    if (!Array.isArray(chatKeys)) throw controlPlaneError("TELERADAR_SOURCES_INVALID", 400);
    try {
      if (chatKeys.length > 0) await ensureConnected(context);
      const selected = await getRuntime(context).service.replaceSelectedSources(
        chatKeys.map(chatKey => ({ chatKey: String(chatKey || "").trim() }))
      );
      return selected.map(sanitizeSource);
    } catch (error) {
      throw mapOperationError(error);
    }
  }

  async function startTeleRadar(actor) {
    const context = requireAdminActor(actor);
    await ensureAuthorized(context);
    const runtime = getRuntime(context);
    try {
      const status = await runtime.service.start();
      runtime.enabled = true;
      safeLog("info", "TELERADAR_STARTED", { state: status.state });
      return Object.freeze({ enabled: true, ...status });
    } catch (error) {
      throw mapOperationError(error);
    }
  }

  async function stopTeleRadar(actor) {
    const context = requireAdminActor(actor);
    const runtime = getRuntime(context);
    try {
      const status = await runtime.service.stop();
      runtime.enabled = false;
      safeLog("info", "TELERADAR_STOPPED", { state: status.state });
      return Object.freeze({ enabled: false, ...status });
    } catch (error) {
      throw mapOperationError(error);
    }
  }

  async function getTeleRadarStatus(actor) {
    const context = requireAdminActor(actor);
    const runtime = getRuntime(context);
    const [account, selectedSources, observability] = await Promise.all([
      getTelegramStatus(actor),
      runtime.service.listSelectedSources(),
      runtime.service.getObservability()
    ]);
    const status = runtime.service.getStatus();
    return Object.freeze({
      enabled: runtime.enabled,
      running: status.running === true,
      state: String(status.state || "unknown"),
      listenerActive: status.state === "listening",
      selectedSourceCount: selectedSources.length,
      account: Object.freeze({
        configured: account.configured,
        connected: account.connected,
        authorized: account.authorized,
        displayName: account.identity?.displayName || null,
        username: account.identity?.username || null,
        maskedPhone: account.identity?.maskedPhone || null
      }),
      sources: Object.freeze({ selected: selectedSources.length, available: null }),
      runtime: Object.freeze({ listenerActive: status.state === "listening" }),
      counters: Object.freeze({ ...(status.counters || {}) }),
      lastErrorCode: status.lastErrorCode || null,
      outbox: Object.freeze({ ...(observability?.outbox || {}) }),
      activity: Object.freeze({ ...(observability?.activity || {}) })
    });
  }

  return Object.freeze({
    getTelegramStatus,
    authStart,
    authCode,
    auth2fa,
    authCancel,
    removeAccount,
    listAvailableSources,
    listSelectedSources,
    replaceSelectedSources,
    startTeleRadar,
    stopTeleRadar,
    getTeleRadarStatus
  });
}

module.exports = {
  ACCOUNT_ID_INTERNO,
  ACCOUNT_SCOPE,
  FEATURE,
  createTelegramTeleRadarControlPlane,
  mapOperationError
};
