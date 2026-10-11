"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teleradar-test-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = testDataDir;

const {
  CHECKPOINTS_FILE,
  createMemoryTeleradarStore,
  createTeleradarJsonStore
} = require("../modules/teleradar/checkpoint.repository");
const { createDedupeRepository } = require("../modules/teleradar/dedupe.repository");
const { createEventId } = require("../modules/teleradar/envelope.contract");
const { createTeleRadarService } = require("../modules/teleradar");

const context = Object.freeze({
  clientId: "admin",
  workspaceId: "workspace_admin",
  scope: "admin_master",
  feature: "teleradar",
  accountIdInterno: "telegram-admin-1"
});

function fakeTelegramAccount(chats) {
  let handler = null;
  let allowed = new Set();
  const state = {
    restoreCalls: 0,
    listCalls: 0,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    disconnectCalls: 0,
    allowedSnapshots: []
  };
  return {
    state,
    async restore() {
      state.restoreCalls += 1;
      return { authorized: true, identity: { accountId: "90071992547409931" } };
    },
    async listParticipatingChats() {
      state.listCalls += 1;
      return chats.map(item => ({ ...item }));
    },
    async subscribeNewMessages({ allowedChatKeys, onMessage }) {
      state.subscribeCalls += 1;
      allowed = new Set(allowedChatKeys.map(String));
      state.allowedSnapshots.push([...allowed]);
      handler = onMessage;
      let active = true;
      return async () => {
        if (!active) return;
        active = false;
        state.unsubscribeCalls += 1;
        if (handler === onMessage) handler = null;
      };
    },
    async disconnect() {
      state.disconnectCalls += 1;
      handler = null;
      allowed = new Set();
    },
    async emit(update, { bypassAllowlist = false } = {}) {
      if (!handler) return null;
      if (!bypassAllowlist && !allowed.has(String(update.chatKey || update.chatId))) return null;
      return handler(update);
    }
  };
}

function update({
  accountId = "90071992547409931",
  chatId = "-1001",
  messageId = "90071992547409932",
  senderId = "90071992547409933",
  receivedAt,
  text = "Oferta https://example.com APP",
  entities = [],
  protectedContent = false,
  hasMedia = false,
  mediaType = null
} = {}) {
  return {
    accountId,
    chatId,
    chatKey: chatId,
    messageId,
    senderId,
    receivedAt,
    text,
    textSource: hasMedia ? "caption" : "text",
    hasMedia,
    mediaType,
    protectedContent,
    entities
  };
}

function entityFixture() {
  return [
    { type: "url", telegramType: "MessageEntityUrl", occurrence: 0, offset: 7, length: 19, label: "https://example.com", url: "https://example.com" },
    { type: "text_url", telegramType: "MessageEntityTextUrl", occurrence: 1, offset: 27, length: 3, label: "APP", url: "https://example.com/app" },
    { type: "url", telegramType: "MessageEntityUrl", occurrence: 2, offset: 31, length: 19, label: "https://example.com", url: "https://example.com" }
  ];
}

async function testCoreFlow() {
  let nowMs = Date.parse("2026-09-21T15:00:00.000Z");
  const clock = () => new Date(nowMs);
  const advance = milliseconds => { nowMs += milliseconds; };
  const chats = [
    { chatKey: "-1001", chatId: "-1001", title: "Fonte A", type: "supergroup", protectedContent: false },
    { chatKey: "-1002", chatId: "-1002", title: "Fonte B", type: "channel", protectedContent: false },
    { chatKey: "-1003", chatId: "-1003", title: "Fonte Protegida", type: "group", protectedContent: true }
  ];
  const store = createMemoryTeleradarStore();
  const telegram = fakeTelegramAccount(chats);
  const envelopes = [];
  const logs = [];
  const service = createTeleRadarService({
    context,
    store,
    telegramAccountService: telegram,
    clock,
    radarIngress: {
      accept: async envelope => {
        envelopes.push(envelope);
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: envelopes.length };
      }
    },
    logger: { info: payload => logs.push(payload), warn: payload => logs.push(payload) }
  });

  await service.setMonitoringActive(true);
  const emptyStart = await service.start();
  assert.equal(emptyStart.state, "waiting_sources");
  assert.equal(telegram.state.restoreCalls, 1);
  assert.equal(telegram.state.subscribeCalls, 0);
  await service.start();
  assert.equal(telegram.state.restoreCalls, 1);

  const available = await service.listAvailableSources();
  assert.equal(available.length, 3);
  assert(available.every(source => source.enabled === false));
  assert.deepEqual(Object.keys(available[0]).sort(), ["activatedAt", "chatId", "chatKey", "enabled", "protectedContent", "title", "type"]);
  await assert.rejects(() => service.replaceSelectedSources(["*"]), /CHAT_KEY_INVALID/);
  await assert.rejects(() => service.replaceSelectedSources(["-9999"]), /SOURCE_NOT_AVAILABLE/);

  await service.replaceSelectedSources(["-1001"]);
  assert.equal(telegram.state.subscribeCalls, 1);
  assert.deepEqual(telegram.state.allowedSnapshots.at(-1), ["-1001"]);
  const selectedAtActivation = await service.listSelectedSources();
  assert.equal(selectedAtActivation.length, 1);
  assert.equal(selectedAtActivation[0].lastAcceptedMessageId, null);
  const activatedAtA = selectedAtActivation[0].activatedAt;

  await telegram.emit(update({ chatId: "-1002", messageId: "1", receivedAt: "2026-09-21T15:00:01.000Z" }), { bypassAllowlist: true });
  assert.equal(envelopes.length, 0);
  assert.equal(service.getStatus().counters.rejectedNotSelected, 1);

  await telegram.emit(update({ chatId: "-1001", messageId: "2", receivedAt: "2026-09-21T14:59:59.000Z" }));
  assert.equal(envelopes.length, 0);
  assert.equal(service.getStatus().counters.rejectedBeforeOperationalWindow, 1);

  advance(1000);
  const rich = update({
    chatId: "-1001",
    messageId: "90071992547409932",
    receivedAt: clock().toISOString(),
    text: "Oferta https://example.com APP https://example.com",
    entities: entityFixture(),
    hasMedia: true,
    mediaType: "MessageMediaPhoto"
  });
  await telegram.emit(rich);
  assert.equal(envelopes.length, 1);
  const first = envelopes[0];
  assert.equal(first.type, "teleradar.message.v1");
  assert.equal(first.origem, "radar");
  assert.equal(first.origemFluxo, "optimus");
  assert.equal(first.origemTipo, "telegram");
  assert.equal(first.fonte, "teleradar");
  assert.equal(first.fonteCaptura, "teleradar");
  assert.equal(first.accountId, "90071992547409931");
  assert.equal(first.messageId, "90071992547409932");
  assert.equal(first.hasMedia, true);
  assert.equal(first.mediaType, "MessageMediaPhoto");
  assert.equal(Object.hasOwn(first, "media"), false);
  assert.deepEqual(first.entities.map(item => item.type), ["url", "text_url", "url"]);
  assert.deepEqual(first.entities.map(item => item.occurrence), [0, 1, 2]);
  assert.deepEqual(first.entities.map(item => item.offset), [7, 27, 31]);
  assert.deepEqual(first.entities.map(item => item.length), [19, 3, 19]);
  assert.equal(first.entities[1].label, "APP");
  assert.equal(first.entities[1].url, "https://example.com/app");
  assert.equal(first.entities[0].url, first.entities[2].url);
  const observability = await service.getObservability();
  assert.deepEqual(observability.outbox, { pending: 0, delivering: 0, failedPermanent: 0 });
  assert.equal(observability.activity.lastCapturedAt, first.capturedAt);
  assert(observability.activity.lastHandoffAt);
  assert(observability.activity.lastRadarAcceptedAt);
  assert.equal(typeof observability.activity.lastHandoffLatencyMs, "number");

  const selectedAfterAccept = await service.listSelectedSources();
  assert.equal(selectedAfterAccept[0].activatedAt, activatedAtA);
  assert.equal(selectedAfterAccept[0].lastAcceptedMessageId, "90071992547409932");
  assert.equal(typeof selectedAfterAccept[0].lastAcceptedMessageId, "string");

  await telegram.emit(rich);
  assert.equal(envelopes.length, 1);
  assert.equal(service.getStatus().counters.rejectedCheckpoint, 1);

  advance(1000);
  await telegram.emit(update({
    chatId: "-1001",
    messageId: "90071992547409933",
    receivedAt: clock().toISOString(),
    text: rich.text
  }));
  assert.equal(envelopes.length, 2);
  assert.equal(envelopes[1].text, first.text);
  assert.notEqual(envelopes[1].eventId, first.eventId);

  await service.replaceSelectedSources(["-1001", "-1002"]);
  assert.equal(telegram.state.unsubscribeCalls, 1);
  assert.equal(telegram.state.subscribeCalls, 2);
  advance(1000);
  await telegram.emit(update({
    chatId: "-1002",
    messageId: "90071992547409933",
    receivedAt: clock().toISOString(),
    text: rich.text
  }));
  assert.equal(envelopes.length, 3);
  assert.notEqual(envelopes[2].eventId, envelopes[1].eventId);

  const protectedUpdate = update({
    chatId: "-1001",
    messageId: "90071992547409934",
    receivedAt: clock().toISOString(),
    protectedContent: true
  });
  Object.defineProperty(protectedUpdate, "text", { get() { throw new Error("PROTECTED_TEXT_MUST_NOT_BE_READ"); } });
  Object.defineProperty(protectedUpdate, "entities", { get() { throw new Error("PROTECTED_ENTITIES_MUST_NOT_BE_READ"); } });
  await telegram.emit(protectedUpdate);
  assert.equal(envelopes.length, 3);
  assert.equal(service.getStatus().counters.rejectedProtected, 1);
  assert(!JSON.stringify(store.snapshot()).includes("PROTECTED_TEXT_MUST_NOT_BE_READ"));
  assert(logs.some(item => item.code === "TELERADAR_REJEITADO_PROTECTED_CONTENT"));
  assert(logs.every(item => !Object.hasOwn(item, "text") && !Object.hasOwn(item, "entities")));

  await service.replaceSelectedSources(["-1001", "-1002", "-1003"]);
  await telegram.emit(update({ chatId: "-1003", messageId: "90071992547409935", receivedAt: clock().toISOString() }));
  assert.equal(envelopes.length, 3);
  assert.equal(service.getStatus().counters.rejectedProtected, 2);

  await service.replaceSelectedSources(["-1002"]);
  assert.equal(telegram.state.unsubscribeCalls, 3);
  advance(1000);
  await telegram.emit(update({ chatId: "-1001", messageId: "90071992547409935", receivedAt: clock().toISOString() }), { bypassAllowlist: true });
  assert.equal(envelopes.length, 3);

  await service.replaceSelectedSources([]);
  assert.equal(service.getStatus().state, "waiting_sources");
  assert.equal(service.getStatus().selectedSourceCount, 0);
  assert.equal(telegram.state.unsubscribeCalls, 4);
  const subscriptionsBeforeEmptyEmit = telegram.state.subscribeCalls;
  await telegram.emit(update({ chatId: "-1002", messageId: "90071992547409936", receivedAt: clock().toISOString() }), { bypassAllowlist: true });
  assert.equal(envelopes.length, 3);
  assert.equal(telegram.state.subscribeCalls, subscriptionsBeforeEmptyEmit);

  await service.replaceSelectedSources(["-1001"]);
  advance(1000);
  const restartEvent = update({ chatId: "-1001", messageId: "90071992547409940", receivedAt: clock().toISOString() });
  await telegram.emit(restartEvent);
  assert.equal(envelopes.length, 4);
  await service.stop();
  const unsubscribesAfterStop = telegram.state.unsubscribeCalls;
  await service.stop();
  assert.equal(telegram.state.unsubscribeCalls, unsubscribesAfterStop);
  assert.equal(telegram.state.disconnectCalls, 1);

  const telegramAfterRestart = fakeTelegramAccount(chats);
  const afterRestart = [];
  const restartedService = createTeleRadarService({
    context,
    store,
    telegramAccountService: telegramAfterRestart,
    clock,
    radarIngress: {
      accept: async envelope => {
        afterRestart.push(envelope);
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: afterRestart.length };
      }
    }
  });
  await restartedService.start();
  assert.equal(telegramAfterRestart.state.subscribeCalls, 1);
  assert.deepEqual(telegramAfterRestart.state.allowedSnapshots[0], ["-1001"]);
  await telegramAfterRestart.emit(restartEvent);
  assert.equal(afterRestart.length, 0);
  advance(1000);
  await telegramAfterRestart.emit(update({ chatId: "-1001", messageId: "90071992547409941", receivedAt: clock().toISOString() }));
  assert.equal(afterRestart.length, 1);
  await restartedService.stop();

  // MessageEntityTextUrl: fixture/teste PASS; live ainda nao comprovado (Phase 0.x nao bloqueante).
}

async function testDedupeIdentityAndConcurrency() {
  const store = createMemoryTeleradarStore();
  const repositoryA = createDedupeRepository({ store, context });
  const repositoryB = createDedupeRepository({ store, context });
  const sameTextDifferentMessages = [
    createEventId({ accountId: "100", chatId: "200", messageId: "300" }),
    createEventId({ accountId: "100", chatId: "200", messageId: "301" })
  ];
  const sameMessageDifferentChats = [
    createEventId({ accountId: "100", chatId: "200", messageId: "300" }),
    createEventId({ accountId: "100", chatId: "201", messageId: "300" })
  ];
  const sameChatMessageDifferentAccounts = [
    createEventId({ accountId: "100", chatId: "200", messageId: "300" }),
    createEventId({ accountId: "101", chatId: "200", messageId: "300" })
  ];
  assert.notEqual(...sameTextDifferentMessages);
  assert.notEqual(...sameMessageDifferentChats);
  assert.notEqual(...sameChatMessageDifferentAccounts);
  const expected = crypto.createHash("sha256").update("teleradar:v1:100:200:300", "utf8").digest("hex");
  assert.equal(sameTextDifferentMessages[0], expected);

  const distinctIdentityEvents = [
    { eventId: expected, accountId: "100", chatId: "200", messageId: "300" },
    { eventId: sameTextDifferentMessages[1], accountId: "100", chatId: "200", messageId: "301" },
    { eventId: sameMessageDifferentChats[1], accountId: "100", chatId: "201", messageId: "300" },
    { eventId: sameChatMessageDifferentAccounts[1], accountId: "101", chatId: "200", messageId: "300" }
  ];
  for (const identity of distinctIdentityEvents) {
    const claimed = await repositoryA.claim({ ...identity, claimedAt: "2026-09-21T15:00:00.000Z" });
    assert.equal(claimed.claimed, true);
  }
  assert.equal((await repositoryB.claim({ ...distinctIdentityEvents[0], claimedAt: "2026-09-21T15:00:01.000Z" })).claimed, false);

  const eventId = createEventId({ accountId: "999", chatId: "888", messageId: "777" });
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? repositoryA : repositoryB).claim({
    eventId,
    accountId: "999",
    chatId: "888",
    messageId: "777",
    claimedAt: "2026-09-21T15:00:00.000Z"
  })));
  assert.equal(attempts.filter(item => item.claimed).length, 1);
}

async function testCorruptedStorageFailsClosed() {
  const corruptClientDir = path.join(testDataDir, "clientes", "admin");
  fs.mkdirSync(corruptClientDir, { recursive: true });
  fs.writeFileSync(path.join(corruptClientDir, CHECKPOINTS_FILE), "{\"schemaVersion\":1,\"entries\":", "utf8");
  const store = createTeleradarJsonStore();
  await assert.rejects(() => store.read(context, CHECKPOINTS_FILE), /TELERADAR_STORAGE_CORRUPTED/);
}

async function testStaticBoundaries() {
  const moduleDir = path.join(__dirname, "..", "modules", "teleradar");
  const files = fs.readdirSync(moduleDir).filter(file => file.endsWith(".js"));
  assert.deepEqual(files.sort(), [
    "capture-gate.js",
    "checkpoint.repository.js",
    "dedupe.repository.js",
    "envelope.contract.js",
    "handoff.repository.js",
    "handoff.service.js",
    "index.js",
    "operational-config.repository.js",
    "radar-ingress.adapter.js",
    "source-allowlist.service.js",
    "teleradar.service.js",
    "update-normalizer.js"
  ]);
  const sources = files.map(file => fs.readFileSync(path.join(moduleDir, file), "utf8"));
  const combined = sources.join("\n");
  assert(!combined.includes('require("teleproto")'));
  assert(!combined.includes("client-adapter"));
  assert(!combined.includes("session-vault"));
  assert(!/require\(["'][^"']*\.\.\/(radar|engine|rio)(?:\/|["'])/i.test(combined));
  assert(!/\.getHistory\s*\(|\.catchUp\s*\(|\.iterMessages\s*\(|\.downloadMedia\s*\(|\.sendMessage\s*\(/.test(combined));
  const serviceSource = fs.readFileSync(path.join(moduleDir, "teleradar.service.js"), "utf8");
  assert(serviceSource.includes('require("../telegram-account")'));
}

async function main() {
  await testCoreFlow();
  await testDedupeIdentityAndConcurrency();
  await testCorruptedStorageFailsClosed();
  await testStaticBoundaries();
  console.log("teleradar.test.js OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(testDataDir, { recursive: true, force: true });
});
