"use strict";

const { createTelegramAccountService } = require("../telegram-account");
const { createCheckpointRepository, createTeleradarJsonStore, compareMessageIds, validateTeleRadarContext } = require("./checkpoint.repository");
const { createDedupeRepository } = require("./dedupe.repository");
const { createEventId, createEnvelope } = require("./envelope.contract");
const { createSourceAllowlistService, sanitizeSource } = require("./source-allowlist.service");
const { normalizeTelegramUpdate } = require("./update-normalizer");
const { createHandoffService } = require("./handoff.service");
const { createRadarIngressAdapter } = require("./radar-ingress.adapter");

function createTeleRadarService({
  context,
  telegramAccountService,
  telegramAccountOptions,
  store = createTeleradarJsonStore(),
  sourceAllowlist,
  checkpoints,
  dedupe,
  handoffService,
  radarIngress = createRadarIngressAdapter(),
  clock = () => new Date(),
  logger = {},
  handoffOptions = {}
} = {}) {
  const validContext = validateTeleRadarContext(context);
  const accountScope = Object.freeze({
    clientId: validContext.clientId,
    workspaceId: validContext.workspaceId,
    scope: validContext.scope,
    feature: validContext.feature
  });
  const accountService = telegramAccountService || createTelegramAccountService(telegramAccountOptions);
  const allowlist = sourceAllowlist || createSourceAllowlistService({ store, context: validContext, clock });
  const checkpointRepository = checkpoints || createCheckpointRepository({ store, context: validContext });
  const dedupeRepository = dedupe || createDedupeRepository({ store, context: validContext });
  const handoff = handoffService || createHandoffService({
    ...handoffOptions,
    context: validContext,
    store,
    radarIngress,
    clock,
    logger,
    beforeAttempt: async (envelope, record) => {
      await dedupeRepository.claim({
        eventId: envelope.eventId,
        accountId: envelope.accountId,
        chatId: envelope.chatId,
        messageId: envelope.messageId,
        claimedAt: record.handoffPersistedAt
      });
      await checkpointRepository.acceptIfNewer({
        chatKey: envelope.chatKey,
        messageId: envelope.messageId,
        activatedAt: envelope.capturedAt,
        acceptedAt: record.handoffPersistedAt
      });
    }
  });

  let running = false;
  let lifecycleState = "stopped";
  let unsubscribe = null;
  let selectedSourceCount = 0;
  let lifecycleQueue = Promise.resolve();
  const counters = {
    accepted: 0,
    rejectedNotSelected: 0,
    rejectedProtected: 0,
    rejectedBeforeActivation: 0,
    rejectedCheckpoint: 0,
    rejectedDuplicate: 0,
    errors: 0
  };
  let lastErrorCode = null;

  function nowIso() {
    const date = clock();
    const normalized = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(normalized.getTime())) throw new Error("TELERADAR_CLOCK_INVALID");
    return normalized.toISOString();
  }

  function safeLog(level, code, metadata = {}) {
    const payload = {
      code,
      accountIdInterno: validContext.accountIdInterno,
      chatKey: metadata.chatKey ? String(metadata.chatKey) : null,
      messageId: metadata.messageId ? String(metadata.messageId) : null
    };
    try { logger[level]?.(payload, code); } catch {}
  }

  function reject(counter, code, metadata) {
    counters[counter] += 1;
    safeLog("info", code, metadata);
    return { accepted: false, reason: code };
  }

  function serializeLifecycle(operation) {
    const current = lifecycleQueue.catch(() => {}).then(operation);
    lifecycleQueue = current;
    return current;
  }

  async function listSelectedSources() {
    const selected = await allowlist.listSelectedSources();
    return Promise.all(selected.map(async source => {
      const checkpoint = await checkpointRepository.get(source.chatKey);
      return Object.freeze({
        ...source,
        lastAcceptedMessageId: checkpoint?.lastAcceptedMessageId || null,
        lastAcceptedAt: checkpoint?.lastAcceptedAt || null
      });
    }));
  }

  async function listAvailableSources() {
    const [available, selected] = await Promise.all([
      accountService.listParticipatingChats({ accountIdInterno: validContext.accountIdInterno, accountScope }),
      allowlist.listSelectedSources()
    ]);
    const selectedByChat = new Map(selected.map(source => [source.chatKey, source]));
    return available.map(source => {
      const selectedSource = selectedByChat.get(String(source.chatKey));
      return sanitizeSource(source, {
        activatedAt: selectedSource?.activatedAt || null,
        enabled: Boolean(selectedSource)
      });
    });
  }

  async function handleUpdate(update) {
    const chatKey = String(update?.chatKey || update?.chatId || "").trim();
    const messageId = update?.messageId === undefined ? null : String(update.messageId);
    const source = chatKey ? await allowlist.getSelectedSource(chatKey) : null;
    if (!source) return reject("rejectedNotSelected", "TELERADAR_REJEITADO_SOURCE_NOT_SELECTED", { chatKey, messageId });

    if (source.protectedContent === true
      || update?.protectedContent === true
      || update?.messageNoForwards === true
      || update?.chatNoForwards === true) {
      return reject("rejectedProtected", "TELERADAR_REJEITADO_PROTECTED_CONTENT", { chatKey, messageId });
    }

    const normalized = normalizeTelegramUpdate(update, { clock });
    if (!normalized.accepted) {
      return reject("rejectedProtected", normalized.reason, normalized.metadata);
    }
    const message = normalized.message;
    const eventAt = new Date(message.sourceTimestamp || message.receivedAt).getTime();
    const activatedAt = new Date(source.activatedAt).getTime();
    if (!Number.isFinite(eventAt) || !Number.isFinite(activatedAt) || eventAt <= activatedAt) {
      return reject("rejectedBeforeActivation", "TELERADAR_REJEITADO_BEFORE_ACTIVATION", message);
    }

    const currentCheckpoint = await checkpointRepository.get(message.chatKey);
    if (currentCheckpoint?.lastAcceptedMessageId
      && compareMessageIds(message.messageId, currentCheckpoint.lastAcceptedMessageId) <= 0) {
      return reject("rejectedCheckpoint", "TELERADAR_REJEITADO_CHECKPOINT", message);
    }

    const eventId = createEventId(message);
    const envelope = createEnvelope({ ...message, envelopeCreatedAt: nowIso() });
    const persisted = await handoff.persistEnvelope(envelope);

    const claim = await dedupeRepository.claim({
      eventId,
      accountId: message.accountId,
      chatId: message.chatId,
      messageId: message.messageId,
      claimedAt: message.receivedAt
    });
    if (!claim.claimed) {
      if (persisted.record?.status === "pending") await handoff.attempt(eventId);
      return reject("rejectedDuplicate", "TELERADAR_REJEITADO_DUPLICATE", message);
    }

    const checkpointResult = await checkpointRepository.acceptIfNewer({
      chatKey: message.chatKey,
      messageId: message.messageId,
      activatedAt: source.activatedAt,
      acceptedAt: message.receivedAt
    });
    if (!checkpointResult.accepted) {
      return reject("rejectedCheckpoint", "TELERADAR_REJEITADO_CHECKPOINT", message);
    }

    const delivery = await handoff.attempt(eventId);
    counters.accepted += 1;
    return {
      accepted: true,
      envelope,
      handoffStatus: delivery.accepted ? "acked" : (delivery.record?.status || "pending")
    };
  }

  async function dispatchUpdate(update) {
    try {
      return await handleUpdate(update);
    } catch (error) {
      counters.errors += 1;
      lastErrorCode = String(error?.code || error?.message || "TELERADAR_UPDATE_FAILED").slice(0, 120);
      safeLog("warn", lastErrorCode, { chatKey: update?.chatKey, messageId: update?.messageId });
      return { accepted: false, reason: lastErrorCode };
    }
  }

  async function bindSelectedSources() {
    if (unsubscribe) {
      const current = unsubscribe;
      unsubscribe = null;
      await current();
    }
    const selected = await allowlist.listSelectedSources();
    selectedSourceCount = selected.length;
    if (!running || !selected.length) {
      lifecycleState = running ? "waiting_sources" : "stopped";
      return;
    }
    unsubscribe = await accountService.subscribeNewMessages({
      accountIdInterno: validContext.accountIdInterno,
      accountScope,
      allowedChatKeys: selected.map(source => source.chatKey),
      onMessage: dispatchUpdate
    });
    lifecycleState = "listening";
  }

  async function replaceSelectedSources(requestedSources = []) {
    return serializeLifecycle(async () => {
      if (!Array.isArray(requestedSources)) throw new Error("TELERADAR_SOURCES_INVALID");
      let selectedInput = [];
      if (requestedSources.length) {
        const available = await listAvailableSources();
        const availableByChat = new Map(available.map(source => [source.chatKey, source]));
        selectedInput = requestedSources.map(item => {
          const key = String(typeof item === "string" ? item : item?.chatKey || "").trim();
          if (!key || key.includes("*")) throw new Error("TELERADAR_CHAT_KEY_INVALID");
          const source = availableByChat.get(key);
          if (!source) throw new Error("TELERADAR_SOURCE_NOT_AVAILABLE");
          return source;
        });
      }
      const selected = await allowlist.replaceSelectedSources(selectedInput);
      if (running) await bindSelectedSources();
      else selectedSourceCount = selected.length;
      return listSelectedSources();
    });
  }

  async function start() {
    return serializeLifecycle(async () => {
      if (running) return getStatus();
      lifecycleState = "starting";
      await handoff.start();
      const restored = await accountService.restore({ accountIdInterno: validContext.accountIdInterno, accountScope });
      if (restored?.authorized !== true) {
        lifecycleState = "blocked";
        throw new Error("TELERADAR_ACCOUNT_NOT_AUTHORIZED");
      }
      running = true;
      await bindSelectedSources();
      return getStatus();
    });
  }

  async function stop() {
    return serializeLifecycle(async () => {
      if (!running) {
        await handoff.stop();
        return getStatus();
      }
      running = false;
      if (unsubscribe) {
        const current = unsubscribe;
        unsubscribe = null;
        await current();
      }
      await accountService.disconnect({ accountIdInterno: validContext.accountIdInterno, accountScope });
      await handoff.stop();
      lifecycleState = "stopped";
      return getStatus();
    });
  }

  function getStatus() {
    return Object.freeze({
      running,
      state: lifecycleState,
      accountIdInterno: validContext.accountIdInterno,
      selectedSourceCount,
      counters: Object.freeze({ ...counters }),
      lastErrorCode
    });
  }

  async function getObservability() {
    if (typeof handoff.getObservability !== "function") {
      return Object.freeze({
        outbox: Object.freeze({ pending: 0, delivering: 0, failedPermanent: 0 }),
        activity: Object.freeze({
          lastCapturedAt: null,
          lastHandoffAt: null,
          lastRadarAcceptedAt: null,
          lastHandoffLatencyMs: null
        })
      });
    }
    const summary = await handoff.getObservability();
    return Object.freeze({
      outbox: Object.freeze({ ...(summary?.outbox || {}) }),
      activity: Object.freeze({ ...(summary?.activity || {}) })
    });
  }

  return Object.freeze({
    listAvailableSources,
    listSelectedSources,
    replaceSelectedSources,
    start,
    stop,
    getStatus,
    getObservability
  });
}

module.exports = { createTeleRadarService };
