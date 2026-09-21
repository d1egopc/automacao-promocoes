"use strict";

const {
  createTeleradarJsonStore,
  scopedKey,
  validateTeleRadarContext
} = require("./checkpoint.repository");

const HANDOFFS_FILE = "teleradar-handoffs.json";
const HANDOFF_STATUS = Object.freeze({
  PENDING: "pending",
  DELIVERING: "delivering",
  ACKED: "acked",
  FAILED_PERMANENT: "failed_permanent"
});

function text(value) {
  return String(value ?? "").trim();
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`TELERADAR_HANDOFF_${field.toUpperCase()}_INVALID`);
  return date.toISOString();
}

function validateEnvelope(envelope = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("TELERADAR_HANDOFF_ENVELOPE_INVALID");
  }
  if (envelope.protectedContent === true) throw new Error("TELERADAR_REJEITADO_PROTECTED_CONTENT");
  const eventId = text(envelope.eventId);
  if (!/^[a-f0-9]{64}$/.test(eventId)) throw new Error("TELERADAR_EVENT_ID_INVALID");
  if (envelope.origem !== "radar"
    || envelope.origemFluxo !== "optimus"
    || envelope.origemTipo !== "telegram"
    || envelope.fonte !== "teleradar"
    || envelope.fonteCaptura !== "teleradar") {
    throw new Error("TELERADAR_HANDOFF_ORIGIN_INVALID");
  }
  return eventId;
}

function createHandoffRepository({ store = createTeleradarJsonStore(), context } = {}) {
  const validContext = validateTeleRadarContext(context);

  function key(eventId) {
    const id = text(eventId);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("TELERADAR_EVENT_ID_INVALID");
    return scopedKey("handoff", validContext, id);
  }

  return Object.freeze({
    async persist({ envelope, persistedAt }) {
      const eventId = validateEnvelope(envelope);
      const when = iso(persistedAt, "persisted_at");
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const handoffKey = key(eventId);
        if (entries[handoffKey]) return { created: false, record: entries[handoffKey] };
        const record = {
          eventId,
          status: HANDOFF_STATUS.PENDING,
          envelope,
          capturedAt: iso(envelope.capturedAt || envelope.receivedAt, "captured_at"),
          envelopeCreatedAt: iso(envelope.envelopeCreatedAt || envelope.receivedAt, "envelope_created_at"),
          handoffPersistedAt: when,
          handoffAttemptedAt: null,
          radarAcceptedAt: null,
          handoffLatencyMs: null,
          attempts: 0,
          nextAttemptAt: when,
          leaseUntil: null,
          lastErrorCode: null,
          radarReceipt: null
        };
        entries[handoffKey] = record;
        return { created: true, record };
      });
    },

    async get(eventId) {
      const state = await store.read(validContext, HANDOFFS_FILE);
      return state.entries[key(eventId)] || null;
    },

    async listRecoverable(now) {
      iso(now, "now");
      const state = await store.read(validContext, HANDOFFS_FILE);
      return Object.values(state.entries).filter(record =>
        record.status === HANDOFF_STATUS.PENDING || record.status === HANDOFF_STATUS.DELIVERING
      );
    },

    async claimAttempt({ eventId, attemptedAt, leaseMs }) {
      const when = iso(attemptedAt, "attempted_at");
      const nowMs = Date.parse(when);
      const leaseDuration = Math.max(1000, Number(leaseMs) || 30000);
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const record = entries[key(eventId)];
        if (!record) return { claimed: false, reason: "handoff_not_found" };
        if ([HANDOFF_STATUS.ACKED, HANDOFF_STATUS.FAILED_PERMANENT].includes(record.status)) {
          return { claimed: false, reason: record.status, record };
        }
        const nextMs = Date.parse(record.nextAttemptAt || "");
        if (record.status === HANDOFF_STATUS.PENDING && Number.isFinite(nextMs) && nextMs > nowMs) {
          return { claimed: false, reason: "backoff", record };
        }
        const currentLeaseMs = Date.parse(record.leaseUntil || "");
        if (record.status === HANDOFF_STATUS.DELIVERING && Number.isFinite(currentLeaseMs) && currentLeaseMs > nowMs) {
          return { claimed: false, reason: "leased", record };
        }
        record.status = HANDOFF_STATUS.DELIVERING;
        record.attempts = Number(record.attempts || 0) + 1;
        record.leaseUntil = new Date(nowMs + leaseDuration).toISOString();
        entries[key(eventId)] = record;
        return { claimed: true, record };
      });
    },

    async markAttempted({ eventId, attemptedAt }) {
      const when = iso(attemptedAt, "attempted_at");
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const record = entries[key(eventId)];
        if (!record) throw new Error("TELERADAR_HANDOFF_NOT_FOUND");
        record.handoffAttemptedAt = when;
        entries[key(eventId)] = record;
        return record;
      });
    },

    async markRetry({ eventId, nextAttemptAt, errorCode }) {
      const when = iso(nextAttemptAt, "next_attempt_at");
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const record = entries[key(eventId)];
        if (!record) throw new Error("TELERADAR_HANDOFF_NOT_FOUND");
        record.status = HANDOFF_STATUS.PENDING;
        record.nextAttemptAt = when;
        record.leaseUntil = null;
        record.lastErrorCode = text(errorCode).slice(0, 120) || "RADAR_INGRESS_FAILED";
        entries[key(eventId)] = record;
        return record;
      });
    },

    async markAccepted({ eventId, acceptedAt, receipt }) {
      const when = iso(acceptedAt, "accepted_at");
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const record = entries[key(eventId)];
        if (!record) throw new Error("TELERADAR_HANDOFF_NOT_FOUND");
        record.status = HANDOFF_STATUS.ACKED;
        record.radarAcceptedAt = when;
        record.handoffLatencyMs = Math.max(0, Date.parse(when) - Date.parse(record.capturedAt));
        record.nextAttemptAt = null;
        record.leaseUntil = null;
        record.lastErrorCode = null;
        record.radarReceipt = receipt && typeof receipt === "object" ? {
          code: "RADAR_ACCEPTED",
          radarEventId: receipt.radarEventId === undefined || receipt.radarEventId === null
            ? null
            : String(receipt.radarEventId),
          duplicate: receipt.duplicate === true
        } : { code: "RADAR_ACCEPTED", radarEventId: null, duplicate: false };
        entries[key(eventId)] = record;
        return record;
      });
    },

    async markPermanentFailure({ eventId, failedAt, errorCode }) {
      const when = iso(failedAt, "failed_at");
      return store.mutate(validContext, HANDOFFS_FILE, entries => {
        const record = entries[key(eventId)];
        if (!record) throw new Error("TELERADAR_HANDOFF_NOT_FOUND");
        record.status = HANDOFF_STATUS.FAILED_PERMANENT;
        record.failedAt = when;
        record.nextAttemptAt = null;
        record.leaseUntil = null;
        record.lastErrorCode = text(errorCode).slice(0, 120) || "RADAR_INGRESS_REJECTED";
        entries[key(eventId)] = record;
        return record;
      });
    }
  });
}

module.exports = {
  HANDOFFS_FILE,
  HANDOFF_STATUS,
  createHandoffRepository
};
