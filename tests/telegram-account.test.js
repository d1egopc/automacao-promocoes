"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-account-test-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = testDataDir;
const { Api } = require("teleproto");
const { signInUser } = require("teleproto/client/auth");
const publicApi = require("../modules/telegram-account");
const {
  parseApiId,
  validarAccountScope,
  normalizarAccountMetadata,
  normalizarEntities,
  normalizarMessage,
  normalizarChat
} = require("../modules/telegram-account/account.contract");
const {
  MASTER_KEY_ENV,
  encryptSession,
  decryptSession,
  createTelegramSessionVault
} = require("../modules/telegram-account/session-vault");
const {
  accountKey,
  criarRepositorioMemoriaContasTelegram,
  criarRepositorioContasTelegram,
  SESSIONS_FILE
} = require("../modules/telegram-account/account.repository");
const { createTelegramAccountClient, normalizeIncomingMessage } = require("../modules/telegram-account/client-adapter");
const { createTelegramAccountService } = require("../modules/telegram-account/account.service");

const scope = validarAccountScope({ clientId: "client_teste", workspaceId: "workspace_teste", scope: "admin_master", feature: "teleradar" });

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function withMasterKey(value, operation) {
  const existed = Object.prototype.hasOwnProperty.call(process.env, MASTER_KEY_ENV);
  const previous = process.env[MASTER_KEY_ENV];
  if (value === undefined) delete process.env[MASTER_KEY_ENV];
  else process.env[MASTER_KEY_ENV] = value;
  try {
    return await operation();
  } finally {
    if (existed) process.env[MASTER_KEY_ENV] = previous;
    else delete process.env[MASTER_KEY_ENV];
  }
}

function tamperBase64(value) {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

function fakeSignInClient({ successfulSignInAttempt }) {
  let attempts = 0;
  return {
    get attempts() { return attempts; },
    async sendCode() { return { phoneCodeHash: "transient-only", isCodeViaApp: false }; },
    async invoke(request) {
      if (request instanceof Api.auth.SignIn) {
        attempts += 1;
        if (attempts === successfulSignInAttempt) return new Api.auth.Authorization({ user: new Api.User({ id: 123, firstName: "Contract" }) });
        const error = new Error("PHONE_CODE_INVALID");
        error.errorMessage = "PHONE_CODE_INVALID";
        throw error;
      }
      throw new Error(`RPC_INESPERADO:${request.className}`);
    }
  };
}

async function testOnErrorContractTeleproto() {
  const truthyClient = fakeSignInClient({ successfulSignInAttempt: Number.POSITIVE_INFINITY });
  let truthyCalls = 0;
  await assert.rejects(() => signInUser(truthyClient, { apiId: 17349, apiHash: "test-only" }, {
    phoneNumber: "5511999999999", phoneCode: async () => "12345",
    onError: async () => { truthyCalls += 1; return true; }
  }), /AUTH_USER_CANCEL/);
  assert.equal(truthyClient.attempts, 1);
  assert.equal(truthyCalls, 1);

  const falsyClient = fakeSignInClient({ successfulSignInAttempt: 2 });
  let falsyCalls = 0;
  const user = await signInUser(falsyClient, { apiId: 17349, apiHash: "test-only" }, {
    phoneNumber: "5511999999999", phoneCode: async () => "12345",
    onError: async () => { falsyCalls += 1; return false; }
  });
  assert.equal(user.id.toString(), "123");
  assert.equal(falsyClient.attempts, 2);
  assert.equal(falsyCalls, 1);
}

async function testContractsAndEntities() {
  assert.equal(parseApiId("2147483647"), 2147483647);
  assert.throws(() => parseApiId("2147483648"), /api_id_invalido/);
  assert.throws(() => parseApiId("17349api"), /api_id_invalido/);
  assert.throws(() => validarAccountScope({ clientId: "client", scope: "admin_master", feature: "teleradar" }), /account_scope_incompleto/);
  assert.deepEqual(normalizarAccountMetadata({ label: "admin", apiHash: "must-not-persist", sessionString: "must-not-persist" }), { label: "admin", description: null, admin: false });
  assert.deepEqual(normalizarChat({ id: 9007199254740993n, type: "group", title: "Grupo" }), {
    chatKey: "9007199254740993", chatId: "9007199254740993", title: "Grupo", type: "group", protectedContent: false
  });

  const text = "Produto 😀 https://example.com APP";
  const entities = normalizarEntities(text, [
    new Api.MessageEntityUrl({ offset: 11, length: 19 }),
    new Api.MessageEntityTextUrl({ offset: 31, length: 3, url: "https://example.com/app" })
  ]);
  assert.deepEqual(entities.map(item => item.type), ["url", "text_url"]);
  assert.deepEqual(entities.map(item => item.occurrence), [0, 1]);
  assert.equal(entities[1].url, "https://example.com/app");
  assert.equal(entities[1].label, "APP");
  assert.equal(entities[1].offset, 31);
  assert.equal(entities[1].length, 3);

  const own = normalizarMessage({ accountId: "9007199254740993", chatId: "-4880096992", messageId: "3377", senderId: "9007199254740993", outgoing: true, text: "Oi" });
  const external = normalizarMessage({ accountId: "9007199254740993", chatId: "-4880096992", messageId: "3378", senderId: "9007199254740994", text: "Legenda", textSource: "caption", hasMedia: true, mediaType: "MessageMediaPhoto", entities });
  assert.equal(own.incomingExternal, false);
  assert.equal(external.incomingExternal, true);
  assert.equal(external.chatId, "-4880096992");
  assert.equal(external.entities[1].type, "text_url");

  const protectedMessage = normalizarMessage({
    accountId: "9007199254740993", chatId: "-4880096992", messageId: "3379", senderId: "9007199254740994",
    text: "SEGREDO", textSource: "caption", hasMedia: true, mediaType: "MessageMediaPhoto", entities,
    protectedContent: true, chatNoForwards: true
  });
  assert.equal(protectedMessage.protectedContent, true);
  assert.equal(protectedMessage.hasMedia, true);
  assert.equal(protectedMessage.mediaType, "MessageMediaPhoto");
  assert.equal(Object.hasOwn(protectedMessage, "text"), false);
  assert.equal(Object.hasOwn(protectedMessage, "textSource"), false);
  assert.equal(Object.hasOwn(protectedMessage, "entities"), false);

  const protectedRaw = { id: 3380, senderId: 2, noforwards: true, media: { className: "MessageMediaPhoto" } };
  Object.defineProperty(protectedRaw, "message", { get() { throw new Error("protected_text_accessed"); } });
  Object.defineProperty(protectedRaw, "entities", { get() { throw new Error("protected_entities_accessed"); } });
  const redacted = normalizeIncomingMessage({ chatId: "-4880096992", message: protectedRaw }, "1", { noforwards: false });
  assert.equal(redacted.protectedContent, true);
  assert.equal(Object.hasOwn(redacted, "text"), false);
  assert.equal(Object.hasOwn(redacted, "entities"), false);

  // Fixture/teste PASS != live ainda nao comprovado para MessageEntityTextUrl em legenda com midia.
}

async function testVault() {
  const masterKey = "local-test-master-key-which-is-at-least-32-bytes";
  await withMasterKey(masterKey, async () => {
    const first = encryptSession("1A_SESSION_ONLY_IN_MEMORY");
    const second = encryptSession("1A_SESSION_ONLY_IN_MEMORY");
    assert.equal(decryptSession(first), "1A_SESSION_ONLY_IN_MEMORY");
    assert(!JSON.stringify(first).includes("1A_SESSION_ONLY_IN_MEMORY"));
    assert.notEqual(first.iv, second.iv);
    assert.throws(() => decryptSession({ ...first, ciphertext: tamperBase64(first.ciphertext) }), /decryption_failed/);
    assert.throws(() => decryptSession({ ...first, version: 2 }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, iv: "!!!!" }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, iv: Buffer.alloc(11).toString("base64") }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, authTag: Buffer.alloc(15).toString("base64") }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, ciphertext: "" }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, ciphertext: "YWJjZA===" }), /envelope_invalido/);
    assert.throws(() => decryptSession({ ...first, ciphertext: Buffer.alloc(1024 * 1024 + 1).toString("base64") }), /envelope_invalido/);
    assert.equal(createTelegramSessionVault().assertMasterKey(), true);
  });
  await withMasterKey(undefined, async () => {
    assert.throws(() => createTelegramSessionVault().assertMasterKey(), /master_key_ausente/);
  });
  await withMasterKey("base64:nao-e-base64", async () => {
    assert.throws(() => createTelegramSessionVault().assertMasterKey(), /master_key_invalida/);
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "modules", "telegram-account", "session-vault.js"), "utf8");
  assert(!source.includes("envName"));
  assert(!source.includes("options.env"));
}

function persistedIo(delayMs = 0) {
  const state = new Map();
  const ioKey = (client, file) => `${client}/${file}`;
  return {
    state,
    async read(client, file, fallback) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const value = state.get(ioKey(client, file));
      return value === undefined ? clone(fallback) : clone(value);
    },
    async write(client, file, value) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      state.set(ioKey(client, file), clone(value));
    }
  };
}

async function testRepositoryIsolationAndConcurrency() {
  const workspaceA = validarAccountScope({ clientId: "client_shared", workspaceId: "workspace_a", scope: "admin_master", feature: "teleradar" });
  const workspaceB = validarAccountScope({ clientId: "client_shared", workspaceId: "workspace_b", scope: "admin_master", feature: "teleradar" });
  const otherFeature = validarAccountScope({ clientId: "client_shared", workspaceId: "workspace_a", scope: "admin_master", feature: "other_feature" });
  const otherScope = validarAccountScope({ clientId: "client_shared", workspaceId: "workspace_a", scope: "workspace", feature: "teleradar" });
  assert.notEqual(
    accountKey("id", { clientId: "client_shared", workspaceId: "workspace_a", scope: "admin:master", feature: "tele:radar" }),
    accountKey("id", { clientId: "client_shared", workspaceId: "workspace_a", scope: "admin", feature: "master:tele:radar" })
  );

  const io = persistedIo();
  const repository = criarRepositorioContasTelegram({ read: io.read, write: io.write });
  await repository.upsertAccount({ accountIdInterno: "a", accountScope: workspaceA });
  await repository.upsertAccount({ accountIdInterno: "b", accountScope: workspaceB });
  await repository.upsertAccount({ accountIdInterno: "feature", accountScope: otherFeature });
  await repository.upsertAccount({ accountIdInterno: "scope", accountScope: otherScope });
  assert.deepEqual((await repository.listAccounts(workspaceA)).map(item => item.accountIdInterno), ["a"]);
  assert.deepEqual((await repository.listAccounts(workspaceB)).map(item => item.accountIdInterno), ["b"]);
  assert.deepEqual((await repository.listAccounts(otherFeature)).map(item => item.accountIdInterno), ["feature"]);
  assert.deepEqual((await repository.listAccounts(otherScope)).map(item => item.accountIdInterno), ["scope"]);

  const concurrentIo = persistedIo(1);
  const repoA = criarRepositorioContasTelegram({ read: concurrentIo.read, write: concurrentIo.write });
  const repoB = criarRepositorioContasTelegram({ read: concurrentIo.read, write: concurrentIo.write });
  const concurrentScope = validarAccountScope({ clientId: "client_concurrent", workspaceId: "workspace_concurrent", scope: "admin_master", feature: "teleradar" });
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? repoA : repoB).upsertAccount({ accountIdInterno: `account-${index}`, accountScope: concurrentScope })));
  assert.equal((await repoA.listAccounts(concurrentScope)).length, 20);

  const memoryRepository = criarRepositorioMemoriaContasTelegram();
  await memoryRepository.upsertAccount({ accountIdInterno: "memory-a", accountScope: workspaceA });
  await memoryRepository.upsertAccount({ accountIdInterno: "memory-b", accountScope: workspaceB });
  assert.deepEqual((await memoryRepository.listAccounts(workspaceA)).map(item => item.accountIdInterno), ["memory-a"]);

  const corruptRepository = criarRepositorioContasTelegram({
    read: async () => { throw new SyntaxError("unexpected_token_without_payload"); },
    write: async () => {}
  });
  await assert.rejects(() => corruptRepository.getAccount("a", workspaceA), /telegram_account_storage_corrompido/);
  const malformedRepository = criarRepositorioContasTelegram({ read: async () => [], write: async () => {} });
  await assert.rejects(() => malformedRepository.listAccounts(workspaceA), /telegram_account_storage_corrompido/);

  const corruptScope = validarAccountScope({ clientId: "client_corrupt", workspaceId: "workspace_corrupt", scope: "admin_master", feature: "teleradar" });
  const corruptDir = path.join(testDataDir, "clientes", "client_corrupt");
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, "telegram-account-records.json"), "{\"broken\":", "utf8");
  await assert.rejects(() => criarRepositorioContasTelegram().listAccounts(corruptScope), /telegram_account_storage_corrompido/);

  const envelope = { version: 1, algorithm: "aes-256-gcm", keyVersion: 1, iv: "aXYtaXYtaXYtaXYt", authTag: "YXV0aHRhZ2F1dGh0YWdhdQ==", ciphertext: "Y2lwaGVydGV4dA==" };
  await repository.saveEncryptedSession("a", workspaceA, envelope);
  await repository.saveEncryptedSession("a", workspaceB, { ...envelope, ciphertext: "d29ya3NwYWNlLWItY2lwaGVydGV4dA==" });
  assert.equal((await repository.getEncryptedSession("a", workspaceA)).ciphertext, envelope.ciphertext);
  assert.equal((await repository.getEncryptedSession("a", workspaceB)).ciphertext, "d29ya3NwYWNlLWItY2lwaGVydGV4dA==");
  const serializedSessions = [...io.state.entries()].find(([key]) => key.endsWith(`/${SESSIONS_FILE}`))[1];
  assert(!JSON.stringify(serializedSessions).includes("StringSession"));
}

function fakeTransport(options = {}) {
  const handlers = [];
  const state = {
    connectCalls: 0,
    disconnectCalls: 0,
    sendCodeCalls: 0,
    passwordAttempts: 0,
    addCalls: 0,
    removeCalls: 0
  };
  const client = {
    state,
    api: { updates: { getState: async () => ({}) } },
    async connect() { state.connectCalls += 1; },
    async disconnect() { state.disconnectCalls += 1; },
    async getMe() { return new Api.User({ id: 1001, firstName: "Conta", phone: "5511999999999" }); },
    async sendCode() {
      state.sendCodeCalls += 1;
      if (options.sendCodeError) throw options.sendCodeError;
      return { phoneCodeHash: "HASH_INTERNO", type: { className: "SentCodeTypeApp", length: 5 }, timeout: 60 };
    },
    async invoke() { return new Api.auth.Authorization({ user: new Api.User({ id: 1001, firstName: "Conta" }) }); },
    async signInWithPassword(_credentials, callbacks) {
      state.passwordAttempts += 1;
      if (!options.simulateAuthError) return new Api.User({ id: 1001, firstName: "Conta" });
      const error = new Error("PASSWORD_HASH_INVALID");
      error.errorMessage = "PASSWORD_HASH_INVALID";
      const abort = await callbacks.onError(error);
      if (abort) throw Object.assign(new Error("AUTH_USER_CANCEL"), { code: "AUTH_USER_CANCEL" });
      state.passwordAttempts += 1;
      return new Api.User({ id: 1001, firstName: "Conta" });
    },
    addEventHandler(handler, event) { state.addCalls += 1; handlers.push({ handler, event }); },
    removeEventHandler(handler) {
      state.removeCalls += 1;
      const index = handlers.findIndex(item => item.handler === handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    async emit(update) {
      for (const item of [...handlers]) await item.handler(update);
    },
    async *iterDialogs() {}
  };
  return client;
}

function adapterFor(transport, options = {}) {
  return createTelegramAccountClient({
    apiId: 17349,
    apiHash: "API_HASH_INTERNO",
    sessionStore: { save: () => "STRING_SESSION_INTERNA" },
    transportClient: transport,
    accountScope: scope,
    ...options
  });
}

function updateMessage({ chatId, senderId = 2002, outgoing = false, protectedMessage = false, protectedChat = false } = {}) {
  return {
    chatId,
    message: {
      id: 77,
      senderId,
      out: outgoing,
      message: "Oferta https://example.com APP",
      entities: [new Api.MessageEntityUrl({ offset: 7, length: 19 })],
      media: { className: "MessageMediaPhoto" },
      noforwards: protectedMessage,
      async getChat() { return { noforwards: protectedChat }; }
    }
  };
}

async function testAdapterListenerLifecycleAndFlood() {
  const denyTransport = fakeTransport();
  const denyAdapter = adapterFor(denyTransport);
  let deniedCallbacks = 0;
  await denyAdapter.subscribeNewMessages({ onMessage: async () => { deniedCallbacks += 1; } });
  await denyAdapter.subscribeNewMessages({ allowedChatKeys: [], onMessage: async () => { deniedCallbacks += 1; } });
  assert.equal(denyTransport.state.addCalls, 0);
  await denyTransport.emit(updateMessage({ chatId: "-1001" }));
  assert.equal(deniedCallbacks, 0);

  const transport = fakeTransport();
  const adapter = adapterFor(transport);
  const received = [];
  const unsubscribe = await adapter.subscribeNewMessages({ allowedChatKeys: ["-1001"], onMessage: async message => received.push(message) });
  assert.equal(transport.state.addCalls, 1);
  await adapter.connect();
  await adapter.connect();
  assert.equal(transport.state.addCalls, 1);
  await transport.emit(updateMessage({ chatId: "-2002" }));
  await transport.emit(updateMessage({ chatId: "-1001", senderId: 1001, outgoing: true }));
  assert.equal(received.length, 0);
  await transport.emit(updateMessage({ chatId: "-1001" }));
  assert.equal(received.length, 1);
  assert.equal(received[0].chatId, "-1001");
  assert.equal(received[0].incomingExternal, true);
  await transport.emit(updateMessage({ chatId: "-1001", protectedMessage: true }));
  await transport.emit(updateMessage({ chatId: "-1001", protectedChat: true }));
  assert.equal(received.length, 3);
  for (const item of received.slice(1)) {
    assert.equal(item.protectedContent, true);
    assert.equal(Object.hasOwn(item, "text"), false);
    assert.equal(Object.hasOwn(item, "entities"), false);
  }
  await unsubscribe();
  assert.equal(transport.state.removeCalls, 1);
  await adapter.disconnect();
  assert.equal(transport.state.removeCalls, 1);

  const duplicateTransport = fakeTransport();
  const duplicateAdapter = adapterFor(duplicateTransport);
  await duplicateAdapter.subscribeNewMessages({ allowedChatKeys: ["-1001"], onMessage: async () => {} });
  await duplicateAdapter.connect();
  await duplicateAdapter.connect();
  assert.equal(duplicateTransport.state.addCalls, 1);
  await duplicateAdapter.disconnect();
  assert.equal(duplicateTransport.state.removeCalls, 1);
  await duplicateAdapter.connect();
  assert.equal(duplicateTransport.state.addCalls, 1);

  const flood = Object.assign(new Error("FLOOD_WAIT_60"), { errorMessage: "FLOOD_WAIT", seconds: 60 });
  const floodTransport = fakeTransport({ sendCodeError: flood });
  const states = [];
  const floodAdapter = adapterFor(floodTransport, { onConnectionState: value => states.push(value) });
  await assert.rejects(() => floodAdapter.requestLoginCode({ phone: "5511999999999" }), /FLOOD_WAIT_60/);
  assert.equal(floodTransport.state.sendCodeCalls, 1);
  assert(states.includes("flood_wait"));
}

async function testAdapterOnErrorPath() {
  const logs = [];
  const truthyTransport = fakeTransport({ simulateAuthError: true });
  const truthyAdapter = adapterFor(truthyTransport, {
    logger: { warn: (...args) => logs.push(args) },
    onAuthError: async () => true
  });
  await assert.rejects(() => truthyAdapter.signInWithPassword({ password: "SENHA_2FA_SECRETA" }), /AUTH_USER_CANCEL/);
  assert.equal(truthyTransport.state.passwordAttempts, 1);

  const falsyTransport = fakeTransport({ simulateAuthError: true });
  const falsyAdapter = adapterFor(falsyTransport, { onAuthError: async () => false });
  const identity = await falsyAdapter.signInWithPassword({ password: "SENHA_2FA_SECRETA" });
  assert.equal(identity.accountId, "1001");
  assert.equal(falsyTransport.state.passwordAttempts, 2);
  assert(!JSON.stringify(logs).includes("SENHA_2FA_SECRETA"));
  assert(!JSON.stringify(logs).includes("API_HASH_INTERNO"));
}

function fakeTimers() {
  const scheduled = [];
  return {
    scheduled,
    setTimeoutFn(callback) {
      const handle = { callback, cleared: false, unref() {} };
      scheduled.push(handle);
      return handle;
    },
    clearTimeoutFn(handle) { if (handle) handle.cleared = true; }
  };
}

async function serviceScenario({ codeError = null, passwordError = null, requestError = null } = {}) {
  const repository = criarRepositorioMemoriaContasTelegram();
  const timers = fakeTimers();
  const logs = [];
  const adapterState = { disconnectCalls: 0, codeInputs: [], passwordInputs: [] };
  const adapterFactory = options => ({
    async disconnect() { adapterState.disconnectCalls += 1; },
    async requestLoginCode({ phone }) {
      if (requestError) throw requestError;
      return { phoneCodeHash: "PHONE_CODE_HASH_SECRETO", codeType: "SentCodeTypeApp", codeLength: 5, timeout: 60, phone: String(phone) };
    },
    async signInWithCode(input) {
      adapterState.codeInputs.push(clone(input));
      if (codeError) throw codeError;
      await options.onSessionChanged("STRING_SESSION_SECRETA");
      return { accountId: "1001", maskedPhone: "*********9999", authorized: true };
    },
    async signInWithPassword(input) {
      adapterState.passwordInputs.push(clone(input));
      if (passwordError) throw passwordError;
      await options.onSessionChanged("STRING_SESSION_SECRETA");
      return { accountId: "1001", maskedPhone: "*********9999", authorized: true };
    },
    async connect() {},
    async isAuthorized() { return true; },
    async getIdentity() { return { accountId: "1001", maskedPhone: "*********9999", authorized: true }; },
    async listParticipatingChats() { return []; },
    async subscribeNewMessages() { return async () => {}; }
  });
  const service = createTelegramAccountService({
    repository,
    vault: { encrypt: value => ({ ciphertext: `encrypted:${value.length}` }), decrypt: () => "STRING_SESSION_INTERNA" },
    adapterFactory,
    resolveApiCredentials: async () => ({ apiId: 17349, apiHash: "API_HASH_SECRETO" }),
    logger: { warn: (...args) => logs.push(args) },
    authTransientTtlMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });
  await service.provision({ accountIdInterno: "account-1", accountScope: scope, metadata: { label: "Teste" } });
  return { service, repository, timers, logs, adapterState };
}

async function testServiceSecretLifecycleAndPublicBoundary() {
  const phone = "5511999999999";
  const code = "12345";
  const password = "SENHA_2FA_SECRETA";

  const success = await serviceScenario();
  const publicCodeResult = await success.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  assert.equal(Object.hasOwn(publicCodeResult, "phoneCodeHash"), false);
  assert(!JSON.stringify(publicCodeResult).includes(phone));
  await success.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code });
  await assert.rejects(() => success.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /transient_ausente/);

  const failed = await serviceScenario({ codeError: new Error("PHONE_CODE_INVALID") });
  await failed.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await assert.rejects(() => failed.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /PHONE_CODE_INVALID/);
  await assert.rejects(() => failed.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /transient_ausente/);
  assert.equal(failed.adapterState.disconnectCalls, 1);

  const canceled = await serviceScenario();
  await canceled.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await canceled.service.cancelAuthentication({ accountIdInterno: "account-1", accountScope: scope });
  await assert.rejects(() => canceled.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /transient_ausente/);
  assert.equal(canceled.adapterState.disconnectCalls, 1);

  const timedOut = await serviceScenario();
  await timedOut.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await timedOut.timers.scheduled.at(-1).callback();
  await assert.rejects(() => timedOut.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /transient_ausente/);
  assert.equal(timedOut.adapterState.disconnectCalls, 1);

  const disconnected = await serviceScenario();
  await disconnected.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await disconnected.service.disconnect({ accountIdInterno: "account-1", accountScope: scope });
  await assert.rejects(() => disconnected.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /transient_ausente/);
  assert.equal(disconnected.adapterState.disconnectCalls, 1);

  const requestFailed = await serviceScenario({ requestError: new Error("SEND_CODE_FAILED") });
  await assert.rejects(() => requestFailed.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone }), /SEND_CODE_FAILED/);
  assert.equal(requestFailed.adapterState.disconnectCalls, 1);

  const needs2fa = Object.assign(new Error("telegram_2fa_required"), { code: "telegram_2fa_required" });
  const twoFactor = await serviceScenario({ codeError: needs2fa });
  await twoFactor.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await assert.rejects(() => twoFactor.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /telegram_2fa_required/);
  await twoFactor.service.signInWithPassword({ accountIdInterno: "account-1", accountScope: scope, password });
  assert.equal(twoFactor.adapterState.disconnectCalls, 0);

  const twoFactorTimedOut = await serviceScenario({ codeError: needs2fa });
  await twoFactorTimedOut.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await assert.rejects(() => twoFactorTimedOut.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /telegram_2fa_required/);
  await twoFactorTimedOut.timers.scheduled.at(-1).callback();
  await assert.rejects(() => twoFactorTimedOut.service.signInWithPassword({ accountIdInterno: "account-1", accountScope: scope, password }), /2fa_nao_solicitada/);
  assert.equal(twoFactorTimedOut.adapterState.disconnectCalls, 1);

  const passwordFailed = await serviceScenario({ codeError: needs2fa, passwordError: new Error("PASSWORD_HASH_INVALID") });
  await passwordFailed.service.requestLoginCode({ accountIdInterno: "account-1", accountScope: scope, phone });
  await assert.rejects(() => passwordFailed.service.signInWithCode({ accountIdInterno: "account-1", accountScope: scope, code }), /telegram_2fa_required/);
  await assert.rejects(() => passwordFailed.service.signInWithPassword({ accountIdInterno: "account-1", accountScope: scope, password }), /PASSWORD_HASH_INVALID/);
  assert.equal(passwordFailed.adapterState.disconnectCalls, 1);

  await success.repository.saveEncryptedSession("account-1", scope, { ciphertext: "encrypted" });
  const restored = await success.service.restore({ accountIdInterno: "account-1", accountScope: scope });
  assert.deepEqual(Object.keys(restored).sort(), ["authorized", "identity"]);
  assert.equal(Object.hasOwn(restored, "client"), false);
  assert.deepEqual(await success.service.getConfigurationStatus({ accountIdInterno: "account-1", accountScope: scope }), { configured: true });
  const publicStatus = await success.service.getStatus({ accountIdInterno: "account-1", accountScope: scope });
  assert.deepEqual(Object.keys(publicStatus).sort(), ["authorized", "connected", "connectionState", "exists", "identity"]);
  assert.equal(Object.hasOwn(publicStatus, "session"), false);

  assert.deepEqual(Object.keys(publicApi), ["AUTH_TRANSIENT_TTL_MS", "createTelegramAccountService"]);
  assert.equal(Object.hasOwn(success.service, "exportSession"), false);
  const publicSurface = JSON.stringify({ exports: Object.keys(publicApi), service: Object.keys(success.service), result: publicCodeResult, restored });
  for (const secret of ["phoneCodeHash", "apiHash", "sessionString", "exportSession", phone, code, password, "STRING_SESSION_SECRETA", "API_HASH_SECRETO"]) {
    assert(!publicSurface.includes(secret));
  }
  assert(!JSON.stringify(success.logs).includes(phone));
  assert(!JSON.stringify(success.logs).includes(code));
  assert(!JSON.stringify(success.logs).includes(password));
}

async function testStaticBoundary() {
  const moduleDir = path.join(__dirname, "..", "modules", "telegram-account");
  const adapterSource = fs.readFileSync(path.join(moduleDir, "client-adapter.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(moduleDir, "account.service.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(moduleDir, "index.js"), "utf8");
  assert(!/\.sendMessage\s*\(|\.reply\s*\(|\.forwardMessages?\s*\(|\.react\s*\(|\.joinChannel\s*\(|\.importChatInvite\s*\(|\.iterMessages\s*\(|\.getMessages\s*\(|\.catchUp\s*\(/.test(adapterSource));
  const productionFiles = ["account.contract.js", "account.repository.js", "account.service.js", "session-vault.js", "index.js"];
  for (const file of productionFiles) {
    assert(!fs.readFileSync(path.join(moduleDir, file), "utf8").includes("require(\"teleproto\")"));
  }
  assert(adapterSource.includes('require("teleproto")'));
  assert(!adapterSource.includes("function exportSession"));
  assert(!indexSource.includes("client-adapter"));
  assert(!indexSource.includes("session-vault"));
  assert(!serviceSource.includes("logger.info"));
  assert(!serviceSource.includes("logger.error"));
}

async function main() {
  await testContractsAndEntities();
  await testVault();
  await testRepositoryIsolationAndConcurrency();
  await testAdapterListenerLifecycleAndFlood();
  await testAdapterOnErrorPath();
  await testServiceSecretLifecycleAndPublicBoundary();
  await testOnErrorContractTeleproto();
  await testStaticBoundary();
  console.log("telegram-account.test.js OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(testDataDir, { recursive: true, force: true });
});
