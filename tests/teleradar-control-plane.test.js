"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const express = require("express");

const { createTelegramTeleRadarControlPlane } = require("../modules/teleradar-control-plane/control-plane.service");
const { createTelegramTeleRadarAdminRoutes, sanitizeResponse } = require("../modules/teleradar-control-plane/routes");
const { createTelegramAccountClient } = require("../modules/telegram-account/client-adapter");

const admin = Object.freeze({ id: "admin-1", papel: "admin_master" });

function fakeTimers() {
  const active = new Set();
  return {
    active,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      active.add(timer);
      return timer;
    },
    clearTimeoutFn(timer) { active.delete(timer); }
  };
}

function fakeAccountService(order, options = {}) {
  const state = {
    configured: true,
    exists: false,
    connected: false,
    authorized: false,
    identity: null,
    cancelCalls: 0,
    removeCalls: 0,
    restoreCalls: 0,
    restoreError: null,
    sessionPresent: false,
    remoteLogoutCalls: 0,
    receivedScopes: []
  };
  function remember(input) { state.receivedScopes.push(input.accountScope); }
  return {
    state,
    async getConfigurationStatus(input) { remember(input); return { configured: state.configured }; },
    async getStatus(input) {
      remember(input);
      return {
        exists: state.exists,
        connected: state.connected,
        authorized: state.authorized,
        connectionState: state.exists ? (state.connected ? "authorized" : "disconnected") : "not_configured",
        identity: state.identity
      };
    },
    async provision(input) { remember(input); state.exists = true; return { ok: true }; },
    async requestLoginCode(input) {
      remember(input);
      if (typeof options.requestLoginCode === "function") return options.requestLoginCode(input);
      state.connected = true;
      return { phone: "+55******1234", codeType: "app", codeLength: 5, timeout: 60, phoneCodeHash: "NAO_PODE_VAZAR" };
    },
    async signInWithCode(input) {
      remember(input);
      if (input.code === "00000") { const error = new Error("PHONE_CODE_INVALID"); error.code = "PHONE_CODE_INVALID"; throw error; }
      if (input.code === "22222") { const error = new Error("telegram_2fa_required"); error.code = "telegram_2fa_required"; throw error; }
      state.exists = true;
      state.connected = true;
      state.authorized = true;
      state.sessionPresent = true;
      state.identity = { accountId: "5938935622", displayName: "Conta Teste", username: "teste", phone: "+551199991234" };
      return state.identity;
    },
    async signInWithPassword(input) {
      remember(input);
      if (input.password === "invalida") { const error = new Error("PASSWORD_HASH_INVALID"); error.code = "PASSWORD_HASH_INVALID"; throw error; }
      state.authorized = true;
      state.connected = true;
      state.sessionPresent = true;
      state.identity = { accountId: "5938935622", displayName: "Conta Teste", username: "teste", maskedPhone: "+55******1234" };
      return state.identity;
    },
    async cancelAuthentication(input) { remember(input); state.cancelCalls += 1; return { ok: true }; },
    async restore(input) {
      remember(input);
      state.restoreCalls += 1;
      if (state.restoreError) throw state.restoreError;
      state.connected = state.authorized;
      return { authorized: state.authorized, identity: state.identity };
    },
    async remove(input) {
      remember(input);
      if (!state.exists) throw new Error("telegram_account_nao_encontrada");
      state.removeCalls += 1;
      order.push("remove-account");
      state.exists = false;
      state.connected = false;
      state.authorized = false;
      state.identity = null;
      state.sessionPresent = false;
      return { ok: true };
    }
  };
}

function fakeTeleRadarFactory(order) {
  const instances = [];
  const available = [
    { chatKey: "-1001", chatId: "-1001", title: "Grupo A", type: "supergroup", protectedContent: false },
    { chatKey: "-2002", chatId: "-2002", title: "Canal B", type: "channel", protectedContent: true }
  ];
  const factory = ({ context }) => {
    let selected = [];
    let running = false;
    let state = "stopped";
    let startCalls = 0;
    let stopCalls = 0;
    let availableCalls = 0;
    const counters = { accepted: 7, rejectedProtected: 2, errors: 1 };
    const service = {
      context,
      async listAvailableSources() {
        availableCalls += 1;
        return available.map(source => ({ ...source, enabled: selected.some(item => item.chatKey === source.chatKey) }));
      },
      async listSelectedSources() { return selected.map(item => ({ ...item })); },
      async replaceSelectedSources(requested) {
        const canonical = requested.map(item => {
          const found = available.find(source => source.chatKey === String(item.chatKey));
          if (!found) throw new Error("TELERADAR_SOURCE_NOT_AVAILABLE");
          return { ...found, enabled: true, activatedAt: "2026-09-21T20:00:00.000Z" };
        });
        selected = canonical;
        if (running) state = selected.length ? "listening" : "waiting_sources";
        return selected.map(item => ({ ...item }));
      },
      async start() {
        if (!running) startCalls += 1;
        running = true;
        state = selected.length ? "listening" : "waiting_sources";
        return service.getStatus();
      },
      async stop() {
        if (running) stopCalls += 1;
        order.push("stop-teleradar");
        running = false;
        state = "stopped";
        return service.getStatus();
      },
      getStatus() {
        return { running, state, selectedSourceCount: selected.length, counters, lastErrorCode: "TRANSIENT_SAMPLE" };
      },
      async getObservability() {
        return {
          outbox: { pending: 3, delivering: 1, failedPermanent: 2 },
          activity: {
            lastCapturedAt: "2026-09-21T20:00:00.000Z",
            lastHandoffAt: "2026-09-21T20:00:00.100Z",
            lastRadarAcceptedAt: "2026-09-21T20:00:00.420Z",
            lastHandoffLatencyMs: 420
          }
        };
      },
      stats() { return { startCalls, stopCalls, availableCalls }; }
    };
    instances.push(service);
    return service;
  };
  factory.instances = instances;
  return factory;
}

function createFixture(options = {}) {
  const order = [];
  const logs = [];
  const timers = fakeTimers();
  const accountService = fakeAccountService(order, options);
  const teleRadarServiceFactory = fakeTeleRadarFactory(order);
  let id = 0;
  const service = createTelegramTeleRadarControlPlane({
    accountService,
    teleRadarServiceFactory,
    authFlowTtlMs: 120000,
    idFactory: () => `flow-${++id}`,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    logger: {
      info: (...args) => logs.push({ level: "info", args }),
      warn: (...args) => logs.push({ level: "warn", args }),
      error: (...args) => logs.push({ level: "error", args })
    }
  });
  return { order, logs, timers, accountService, teleRadarServiceFactory, service };
}

function adapterWithAuthFailure({ connectError = null, sendCodeError = null } = {}) {
  return createTelegramAccountClient({
    apiId: 17349,
    apiHash: "test-only",
    accountScope: { clientId: "admin-1", workspaceId: "admin-1", scope: "admin_master", feature: "teleradar" },
    transportClient: {
      async connect() {
        if (connectError) throw connectError;
      },
      async disconnect() {},
      async sendCode() {
        if (sendCodeError) throw sendCodeError;
        return { phoneCodeHash: "transient-only" };
      }
    }
  });
}

function authStartErrorLog(logs) {
  return logs.find(item => item.level === "error" && item.args[0] === "[TELEGRAM-ACCOUNT-AUTH-START-ERRO]");
}

async function testAuthStartRpcMappingAndSanitizedObservability() {
  const phone = "+551199991234";

  const rpcPhoneError = Object.assign(new Error("rpc rejected"), { errorMessage: "PHONE_NUMBER_INVALID" });
  const rpcPhoneFixture = createFixture({ requestLoginCode: async () => { throw rpcPhoneError; } });
  const rpcPhoneResponse = await request(createApp(rpcPhoneFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(rpcPhoneResponse.status, 400);
  assert.deepEqual(rpcPhoneResponse.body, { ok: false, error: "TELEGRAM_PHONE_INVALID" });

  const messagePhoneError = new Error("PHONE_NUMBER_INVALID");
  const messagePhoneFixture = createFixture({ requestLoginCode: async () => { throw messagePhoneError; } });
  const messagePhoneResponse = await request(createApp(messagePhoneFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(messagePhoneResponse.status, 400);
  assert.deepEqual(messagePhoneResponse.body, { ok: false, error: "TELEGRAM_PHONE_INVALID" });

  const immediateFixture = createFixture({
    requestLoginCode: async () => ({
      authorizedImmediately: true,
      identity: { accountId: "1001", maskedPhone: "*********9999", authorized: true }
    })
  });
  const immediateResponse = await request(createApp(immediateFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(immediateResponse.status, 200);
  assert.deepEqual(immediateResponse.body, {
    ok: true,
    state: "authorized",
    identity: { accountId: "1001", displayName: null, username: null, maskedPhone: "*********9999" }
  });
  assert.equal(Object.hasOwn(immediateResponse.body, "authFlowId"), false);

  const secrets = [phone, "API_HASH_SECRETO", "JWT_SECRETO", "CODIGO_12345", "2FA_SECRETA", "STRING_SESSION_SECRETA"];
  const unknownRpcError = Object.assign(new Error(`falha ${secrets.join(" ")}`), {
    errorMessage: "SOME_INTERNAL_RPC_FAILURE"
  });
  const unknownFixture = createFixture({ requestLoginCode: async () => { throw unknownRpcError; } });
  const unknownResponse = await request(createApp(unknownFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(unknownResponse.status, 502);
  assert.deepEqual(unknownResponse.body, { ok: false, error: "TELEGRAM_OPERATION_FAILED" });
  assert.equal(unknownResponse.raw.includes("SOME_INTERNAL_RPC_FAILURE"), false);
  const unknownLog = authStartErrorLog(unknownFixture.logs);
  assert(unknownLog);
  assert.deepEqual(unknownLog.args[1], {
    stage: "unknown",
    errorName: "Error",
    rpcCode: "SOME_INTERNAL_RPC_FAILURE",
    publicCode: "TELEGRAM_OPERATION_FAILED",
    phonePresent: true,
    phoneStructurallyValid: true
  });
  const serializedUnknownLog = JSON.stringify(unknownFixture.logs);
  for (const secret of secrets) assert.equal(serializedUnknownLog.includes(secret), false);

  const connectError = Object.assign(new Error("connection failed"), { errorMessage: "NETWORK_CONNECTION_FAILED" });
  const connectAdapter = adapterWithAuthFailure({ connectError });
  const connectFixture = createFixture({
    requestLoginCode: ({ phone: inputPhone }) => connectAdapter.requestLoginCode({ phone: inputPhone })
  });
  const connectResponse = await request(createApp(connectFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(connectResponse.status, 502);
  assert.equal(authStartErrorLog(connectFixture.logs).args[1].stage, "connect");
  assert.equal(connectError.telegramAuthStage, "connect");

  const sendCodeError = Object.assign(new Error("send failed"), { errorMessage: "SOME_SEND_CODE_FAILURE" });
  const sendCodeAdapter = adapterWithAuthFailure({ sendCodeError });
  const sendCodeFixture = createFixture({
    requestLoginCode: ({ phone: inputPhone }) => sendCodeAdapter.requestLoginCode({ phone: inputPhone })
  });
  const sendCodeResponse = await request(createApp(sendCodeFixture.service), "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone }
  });
  assert.equal(sendCodeResponse.status, 502);
  assert.equal(authStartErrorLog(sendCodeFixture.logs).args[1].stage, "send_code");
  assert.equal(sendCodeError.telegramAuthStage, "send_code");
}

function createApp(service) {
  const app = express();
  app.use(express.json());
  const requireAdmin = (req, res, next) => {
    const role = req.get("x-test-role");
    if (!role) return res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    if (role !== "admin_master") return res.status(403).json({ ok: false, error: "ADMIN_MASTER_REQUIRED" });
    req.usuario = admin;
    return next();
  };
  const noLimit = (_req, _res, next) => next();
  app.use("/admin", createTelegramTeleRadarAdminRoutes({
    service,
    requireAdmin,
    authStartLimiter: noLimit,
    authStepLimiter: noLimit
  }));
  return app;
}

async function request(app, method, url, { role, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({
        hostname: "127.0.0.1",
        port: server.address().port,
        path: url,
        method,
        headers: {
          ...(role ? { "x-test-role": role } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {})
        }
      }, res => {
        let text = "";
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null, raw: text });
        });
      });
      req.on("error", error => { server.close(); reject(error); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function run() {
  assert.deepEqual(sanitizeResponse({
    api_hash: "a", apiHash: "b", session: "c", sessionString: "d", authKey: "e",
    phoneCodeHash: "f", code: "g", password: "h", phone: "i", maskedPhone: "***1234",
    safe: { value: true }
  }), { maskedPhone: "***1234", safe: { value: true } });

  await testAuthStartRpcMappingAndSanitizedObservability();

  const fixture = createFixture();
  const app = createApp(fixture.service);

  assert.equal((await request(app, "GET", "/admin/telegram-account/status")).status, 401);
  assert.equal((await request(app, "GET", "/admin/telegram-account/status", { role: "cliente" })).status, 403);

  const emptyStatus = await request(app, "GET", "/admin/telegram-account/status", { role: "admin_master" });
  assert.equal(emptyStatus.status, 200);
  assert.deepEqual(emptyStatus.body, {
    ok: true, configured: true, exists: false, connected: false, authorized: false,
    connectionState: "not_configured", identity: null
  });

  const invalidPhone = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "telefone-invalido" }
  });
  assert.equal(invalidPhone.status, 400);
  assert.equal(invalidPhone.body.error, "TELEGRAM_PHONE_INVALID");
  assert.equal(invalidPhone.raw.includes("telefone-invalido"), false);

  const start = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234", apiHash: "NAO_USAR", workspaceId: "ataque" }
  });
  assert.equal(start.status, 200);
  assert.equal(start.body.state, "code_required");
  assert.match(start.body.authFlowId, /^flow-\d+$/);
  assert.equal(start.body.maskedPhone, "+55******1234");
  assert.equal(start.raw.includes("NAO_PODE_VAZAR"), false);
  assert.equal(start.raw.includes("NAO_USAR"), false);
  assert.equal(start.raw.includes("+551199991234"), false);

  const invalid = await request(app, "POST", "/admin/telegram-account/auth/code", {
    role: "admin_master", body: { authFlowId: start.body.authFlowId, code: "00000" }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "TELEGRAM_CODE_INVALID");
  assert.equal(invalid.raw.includes("00000"), false);

  const validStart = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234" }
  });
  const valid = await request(app, "POST", "/admin/telegram-account/auth/code", {
    role: "admin_master", body: { authFlowId: validStart.body.authFlowId, code: "12345" }
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.state, "authorized");
  assert.equal(JSON.stringify(valid.body).includes("+551199991234"), false);

  const twoFaStart = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234" }
  });
  const twoFaRequired = await request(app, "POST", "/admin/telegram-account/auth/code", {
    role: "admin_master", body: { authFlowId: twoFaStart.body.authFlowId, code: "22222" }
  });
  assert.equal(twoFaRequired.body.state, "2fa_required");
  const twoFaInvalid = await request(app, "POST", "/admin/telegram-account/auth/2fa", {
    role: "admin_master", body: { authFlowId: twoFaStart.body.authFlowId, password: "invalida" }
  });
  assert.equal(twoFaInvalid.status, 400);
  assert.equal(twoFaInvalid.body.error, "TELEGRAM_2FA_INVALID");

  const twoFaStart2 = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234" }
  });
  await request(app, "POST", "/admin/telegram-account/auth/code", {
    role: "admin_master", body: { authFlowId: twoFaStart2.body.authFlowId, code: "22222" }
  });
  const twoFaValid = await request(app, "POST", "/admin/telegram-account/auth/2fa", {
    role: "admin_master", body: { authFlowId: twoFaStart2.body.authFlowId, password: "segredo-local" }
  });
  assert.equal(twoFaValid.status, 200);
  assert.equal(twoFaValid.body.state, "authorized");
  assert.equal(twoFaValid.raw.includes("segredo-local"), false);

  const cancelStart = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234" }
  });
  const cancelled = await request(app, "POST", "/admin/telegram-account/auth/cancel", {
    role: "admin_master", body: { authFlowId: cancelStart.body.authFlowId }
  });
  assert.deepEqual(cancelled.body, { ok: true, cancelled: true });
  assert.equal(fixture.accountService.state.cancelCalls, 1);

  const expireStart = await request(app, "POST", "/admin/telegram-account/auth/start", {
    role: "admin_master", body: { phone: "+551199991234" }
  });
  const timer = [...fixture.timers.active][0];
  timer.callback();
  const expired = await request(app, "POST", "/admin/telegram-account/auth/code", {
    role: "admin_master", body: { authFlowId: expireStart.body.authFlowId, code: "12345" }
  });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "TELEGRAM_AUTH_FLOW_EXPIRED");

  fixture.accountService.state.exists = true;
  fixture.accountService.state.connected = true;
  fixture.accountService.state.authorized = true;
  const available = await request(app, "GET", "/admin/teleradar/sources/available", { role: "admin_master" });
  assert.equal(available.status, 200);
  assert.equal(available.body.data.length, 2);
  assert.deepEqual(Object.keys(available.body.data[0]).sort(), [
    "activatedAt", "chatId", "chatKey", "lastAcceptedAt", "lastAcceptedMessageId",
    "protectedContent", "selected", "title", "type"
  ]);
  const emptySourcesHttp = await request(app, "GET", "/admin/teleradar/sources", { role: "admin_master" });
  assert.deepEqual(emptySourcesHttp.body, { ok: true, data: [] });
  const selectedHttp = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: ["-1001"], title: "nao-confiar" }
  });
  assert.equal(selectedHttp.body.data[0].title, "Grupo A");
  assert.equal(selectedHttp.body.data[0].selected, true);
  const clearedHttp = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: [] }
  });
  assert.deepEqual(clearedHttp.body, { ok: true, data: [] });

  const directAvailable = await fixture.service.listAvailableSources(admin);
  assert.equal(directAvailable.length, 2);
  assert.deepEqual(Object.keys(directAvailable[0]).sort(), [
    "activatedAt", "chatId", "chatKey", "lastAcceptedAt", "lastAcceptedMessageId",
    "protectedContent", "selected", "title", "type"
  ]);
  assert.equal(directAvailable[1].protectedContent, true);

  assert.deepEqual(await fixture.service.listSelectedSources(admin), []);
  const waiting = await fixture.service.startTeleRadar(admin);
  assert.equal(waiting.state, "waiting_sources");
  assert.equal(waiting.running, true);
  assert.equal(waiting.listenerActive, undefined);
  const runtime = fixture.teleRadarServiceFactory.instances[0];
  await fixture.service.startTeleRadar(admin);
  assert.equal(runtime.stats().startCalls, 1);

  const selected = await fixture.service.replaceSelectedSources(admin, { chatKeys: ["-1001"] });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].chatKey, "-1001");
  await assert.rejects(
    fixture.service.replaceSelectedSources(admin, { chatKeys: ["-9999"] }),
    error => error.code === "TELERADAR_SOURCE_INVALID"
  );
  await assert.rejects(
    fixture.service.replaceSelectedSources(admin, { chatKeys: ["*"] }),
    error => error.code === "TELERADAR_SOURCE_INVALID"
  );
  await fixture.service.replaceSelectedSources(admin, { chatKeys: [] });
  assert.deepEqual(await fixture.service.listSelectedSources(admin), []);

  await fixture.service.stopTeleRadar(admin);
  await fixture.service.stopTeleRadar(admin);
  assert.equal(runtime.stats().stopCalls, 1);

  await fixture.service.replaceSelectedSources(admin, { chatKeys: ["-1001"] });
  await fixture.service.startTeleRadar(admin);
  const status = await fixture.service.getTeleRadarStatus(admin);
  assert.equal(status.outbox.pending, 3);
  assert.equal(status.outbox.delivering, 1);
  assert.equal(status.outbox.failedPermanent, 2);
  assert.equal(status.activity.lastHandoffLatencyMs, 420);
  assert.equal(status.counters.accepted, 7);
  assert.equal(JSON.stringify(status).includes("payload"), false);

  fixture.accountService.state.connected = false;
  fixture.accountService.state.restoreError = new Error("telegram_account_nao_conectada");
  const restoreCallsBeforeEmpty = fixture.accountService.state.restoreCalls;
  const availableCallsBeforeEmpty = runtime.stats().availableCalls;
  const offlineClear = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: [] }
  });
  assert.deepEqual(offlineClear.body, { ok: true, data: [] });
  assert.equal(fixture.accountService.state.restoreCalls, restoreCallsBeforeEmpty);
  assert.equal(runtime.stats().availableCalls, availableCallsBeforeEmpty);
  assert.deepEqual(await fixture.service.listSelectedSources(admin), []);
  assert.equal(runtime.getStatus().state, "waiting_sources");
  assert.equal(runtime.getStatus().running, true);

  fixture.accountService.state.authorized = false;
  const unauthorizedClear = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: [] }
  });
  assert.deepEqual(unauthorizedClear.body, { ok: true, data: [] });
  const unauthorizedNonEmpty = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: ["-1001"] }
  });
  assert.equal(unauthorizedNonEmpty.status, 409);
  assert.equal(unauthorizedNonEmpty.body.error, "TELEGRAM_ACCOUNT_NOT_AUTHORIZED");

  fixture.accountService.state.authorized = true;
  fixture.accountService.state.connected = false;
  const offlineNonEmpty = await request(app, "PUT", "/admin/teleradar/sources", {
    role: "admin_master", body: { chatKeys: ["-1001"] }
  });
  assert.equal(offlineNonEmpty.status, 409);
  assert.equal(offlineNonEmpty.body.error, "TELEGRAM_ACCOUNT_NOT_CONNECTED");
  fixture.accountService.state.restoreError = null;
  fixture.accountService.state.connected = true;

  fixture.order.length = 0;
  const removed = await request(app, "DELETE", "/admin/telegram-account", { role: "admin_master" });
  assert.deepEqual(removed.body, { ok: true, removed: true, alreadyAbsent: false, remoteLogout: false });
  assert.deepEqual(fixture.order.slice(-2), ["stop-teleradar", "remove-account"]);
  assert.equal(runtime.getStatus().running, false);
  assert.equal(fixture.accountService.state.exists, false);
  assert.equal(fixture.accountService.state.sessionPresent, false);
  assert.equal(fixture.accountService.state.remoteLogoutCalls, 0);
  const removedAgain = await request(app, "DELETE", "/admin/telegram-account", { role: "admin_master" });
  assert.deepEqual(removedAgain.body, { ok: true, removed: true, alreadyAbsent: true, remoteLogout: false });
  assert.equal(fixture.accountService.state.removeCalls, 1);
  assert.equal(fixture.accountService.state.exists, false);
  assert.equal(fixture.accountService.state.sessionPresent, false);
  assert.equal(fixture.accountService.state.remoteLogoutCalls, 0);

  for (const scope of fixture.accountService.state.receivedScopes) {
    assert.deepEqual(scope, { clientId: "admin-1", workspaceId: "admin-1", scope: "admin_master", feature: "teleradar" });
  }

  const routesSource = fs.readFileSync(path.join(__dirname, "..", "modules", "teleradar-control-plane", "routes.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "modules", "teleradar-control-plane", "control-plane.service.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.equal(/require\(["']teleproto["']\)/.test(routesSource + serviceSource), false);
  assert.equal(/client-adapter|session-vault|handoff\.repository|checkpoint\.repository|dedupe\.repository/.test(routesSource + serviceSource), false);
  assert.equal(/fila|executor|importer|processarMensagemRadar|registrarEventoBrutoEngineRadar/.test(routesSource + serviceSource), false);
  assert.equal(/outbox\/(retry|ack|delete)|eventId\s*=/.test(routesSource), false);
  assert.match(indexSource, /app\.use\("\/admin", createTelegramTeleRadarAdminRoutes\(\{\s*requireAdmin: exigirAdminMasterEstrito/);

  console.log("PASS tests/teleradar-control-plane.test.js");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
