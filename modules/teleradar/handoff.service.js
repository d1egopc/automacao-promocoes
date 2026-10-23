"use strict";

const { createHandoffRepository, HANDOFF_STATUS } = require("./handoff.repository");

const DEFAULT_BACKOFF_MS = Object.freeze([1000, 5000, 30000, 120000, 300000, 900000]);

function safeCode(value, fallback) {
  return String(value || fallback).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
}

function createHandoffService({
  context,
  store,
  repository = createHandoffRepository({ store, context }),
  radarIngress,
  beforeAttempt = async () => {},
  clock = () => new Date(),
  backoffMs = DEFAULT_BACKOFF_MS,
  leaseMs = 30000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  recoverySpacingMs = 1000,
  logger = {}
} = {}) {
  if (!radarIngress || typeof radarIngress.accept !== "function") throw new Error("TELERADAR_RADAR_INGRESS_REQUIRED");
  if (typeof beforeAttempt !== "function") throw new Error("TELERADAR_BEFORE_ATTEMPT_INVALID");
  const backoff = (Array.isArray(backoffMs) && backoffMs.length ? backoffMs : DEFAULT_BACKOFF_MS)
    .map(value => Math.max(250, Number(value) || 0));
  const timers = new Map();
  let running = false;
  let attemptQueue = Promise.resolve();

  function nowDate() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("TELERADAR_CLOCK_INVALID");
    return date;
  }

  function log(code, record = {}) {
    try {
      logger.info?.({
        code,
        eventId: record.eventId || null,
        status: record.status || null,
        attempts: Number(record.attempts || 0),
        handoffLatencyMs: record.handoffLatencyMs ?? null,
        lastErrorCode: record.lastErrorCode || null
      }, code);
    } catch {}
  }

  function requestCompaction() {
    if (typeof repository.compactTerminals !== "function") return;
    repository.compactTerminals().catch(error => {
      try {
        logger.warn?.({
          code: "TELERADAR_HANDOFF_COMPACTION_FAILED",
          errorCode: safeCode(error?.code || error?.message, "COMPACTION_FAILED")
        }, "TELERADAR_HANDOFF_COMPACTION_FAILED");
      } catch {}
    });
  }

  function clearTimer(eventId) {
    const timer = timers.get(eventId);
    if (!timer) return;
    timers.delete(eventId);
    clearTimeoutFn(timer);
  }

  function retryDelay(attempts) {
    return backoff[Math.min(Math.max(0, Number(attempts || 1) - 1), backoff.length - 1)];
  }

  function schedule(record, minimumDelayMs = 0) {
    if (!running || !record || ![HANDOFF_STATUS.PENDING, HANDOFF_STATUS.DELIVERING].includes(record.status)) return;
    clearTimer(record.eventId);
    const dueAt = Date.parse(record.status === HANDOFF_STATUS.DELIVERING
      ? record.leaseUntil || ""
      : record.nextAttemptAt || "");
    const delay = Math.max(
      Math.max(0, Number(minimumDelayMs) || 0),
      Math.max(0, (Number.isFinite(dueAt) ? dueAt : nowDate().getTime()) - nowDate().getTime())
    );
    const timer = setTimeoutFn(() => {
      timers.delete(record.eventId);
      attempt(record.eventId).catch(() => {});
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
    timers.set(record.eventId, timer);
  }

  async function persistEnvelope(envelope) {
    const result = await repository.persist({ envelope, persistedAt: nowDate() });
    log(result.created ? "TELERADAR_HANDOFF_PERSISTED" : "TELERADAR_HANDOFF_ALREADY_EXISTS", result.record);
    return result;
  }

  async function retry(record, errorCode) {
    const nextAttemptAt = new Date(nowDate().getTime() + retryDelay(record.attempts));
    const pending = await repository.markRetry({ eventId: record.eventId, nextAttemptAt, errorCode });
    log("TELERADAR_HANDOFF_RETRY_SCHEDULED", pending);
    schedule(pending);
    return { accepted: false, pending: true, record: pending };
  }

  async function attemptInternal(eventId) {
    clearTimer(eventId);
    const claimed = await repository.claimAttempt({ eventId, attemptedAt: nowDate(), leaseMs });
    if (!claimed.claimed) return { accepted: false, skipped: true, reason: claimed.reason, record: claimed.record || null };
    const record = claimed.record;
    try {
      await beforeAttempt(record.envelope, record);
      const attempted = record;
      const result = await radarIngress.accept(attempted.envelope, {
        eventId,
        capturedAt: attempted.capturedAt,
        envelopeCreatedAt: attempted.envelopeCreatedAt,
        handoffPersistedAt: attempted.handoffPersistedAt,
        handoffAttemptedAt: attempted.handoffAttemptedAt,
        attempts: attempted.attempts
      });
      if (result?.accepted === true && result?.code === "RADAR_ACCEPTED" && result?.durable === true) {
        const accepted = await repository.markAccepted({ eventId, acceptedAt: nowDate(), receipt: result });
        log("TELERADAR_HANDOFF_RADAR_ACCEPTED", accepted);
        requestCompaction();
        return { accepted: true, record: accepted };
      }
      const errorCode = safeCode(result?.code || result?.reason, "RADAR_INGRESS_NOT_ACKED");
      if (result?.retryable === false) {
        const failed = await repository.markPermanentFailure({ eventId, failedAt: nowDate(), errorCode });
        log("TELERADAR_HANDOFF_PERMANENT_FAILURE", failed);
        requestCompaction();
        return { accepted: false, pending: false, permanent: true, record: failed };
      }
      return retry(record, errorCode);
    } catch (error) {
      return retry(record, safeCode(error?.code || error?.message, "RADAR_INGRESS_EXCEPTION"));
    }
  }

  function attempt(eventId) {
    const current = attemptQueue.catch(() => {}).then(() => attemptInternal(eventId));
    attemptQueue = current;
    return current;
  }

  async function start() {
    if (running) return { running: true };
    running = true;
    if (typeof repository.compactTerminals === "function") await repository.compactTerminals();
    const recoverable = await repository.listRecoverable(nowDate());
    for (let index = 0; index < recoverable.length; index += 1) {
      const record = recoverable[index];
      const dueAt = Date.parse(record.status === HANDOFF_STATUS.DELIVERING
        ? record.leaseUntil || ""
        : record.nextAttemptAt || "");
      if (index === 0 && (!Number.isFinite(dueAt) || dueAt <= nowDate().getTime())) {
        await attempt(record.eventId);
      } else {
        schedule(record, index * Math.max(100, Number(recoverySpacingMs) || 1000));
      }
    }
    return { running: true, recoverable: recoverable.length };
  }

  async function stop() {
    if (!running) return { running: false };
    running = false;
    for (const eventId of [...timers.keys()]) clearTimer(eventId);
    return { running: false };
  }

  return Object.freeze({
    persistEnvelope,
    attempt,
    start,
    stop,
    get: repository.get,
    getObservability: repository.summarize
  });
}

module.exports = {
  DEFAULT_BACKOFF_MS,
  createHandoffService
};
