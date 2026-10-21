"use strict";

// Baileys exposes outbound confirmations through messages.update.  The
// transport return value only proves that the local socket accepted the
// request; it is never promoted to a WhatsApp delivery confirmation here.
const ACK_STATUS = Object.freeze({
  0: "error",
  1: "pending",
  2: "server_ack",
  3: "delivery_ack",
  4: "read",
  5: "played"
});

const OBSERVABLE_STATUSES = new Set(Object.values(ACK_STATUS));

function normalizarAckStatus(value) {
  if (typeof value === "number" && Object.prototype.hasOwnProperty.call(ACK_STATUS, value)) {
    return ACK_STATUS[value];
  }
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "unknown";
  if (OBSERVABLE_STATUSES.has(text)) return text;
  return "unknown";
}

function messageIdOf(value) {
  const key = value?.key || value;
  const id = key?.id || key?.stanzaId || value?.messageId;
  return String(id || "").trim();
}

function correlationKey(sessionId, messageId) {
  return `${String(sessionId || "").trim()}\u0000${String(messageId || "").trim()}`;
}

function createV3BaileysAckCorrelator({ store, clock = () => Date.now(), logger = () => {}, retentionMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!store || typeof store.recordTransportAck !== "function") throw new Error("store_ack_obrigatorio");
  const pending = new Map();

  function register({ workspaceId, profileId, claimKey, sessionId, messageId, sentAt } = {}) {
    const workspace = String(workspaceId || "").trim();
    const claim = String(claimKey || "").trim();
    const session = String(sessionId || "").trim();
    const message = String(messageId || "").trim();
    if (!workspace || !claim || !session || !message) return { ok: false, reason: "correlacao_ack_incompleta" };
    const key = correlationKey(session, message);
    pending.set(key, {
      workspaceId: workspace,
      profileId: String(profileId || "").trim(),
      claimKey: claim,
      sessionId: session,
      messageId: message,
      sentAt: Number.isFinite(Number(sentAt)) ? Number(sentAt) : Number(clock())
    });
    return { ok: true, correlationKey: key, messageId: message };
  }

  function observe({ sessionId, updates = [] } = {}) {
    const session = String(sessionId || "").trim();
    const list = Array.isArray(updates) ? updates : [];
    let observed = 0;
    const results = [];
    for (const item of list) {
      const message = messageIdOf(item);
      if (!session || !message) continue;
      const key = correlationKey(session, message);
      const correlation = pending.get(key);
      if (!correlation) continue;
      const status = normalizarAckStatus(item?.update?.status ?? item?.status);
      const at = new Date(Number(clock())).toISOString();
      try {
        const result = store.recordTransportAck(correlation.workspaceId, correlation.claimKey, {
          transportMessageId: correlation.messageId,
          transportAckStatus: status,
          transportAckObservedAt: at
        });
        if (result?.ok === true) {
          observed += 1;
          results.push({ messageId: correlation.messageId, status });
          if (status !== "pending" && status !== "unknown") pending.delete(key);
        }
      } catch (error) {
        logger({ event: "mensageiro_v3_ack_persist_error", workspaceId: correlation.workspaceId, claimKey: correlation.claimKey, status, error: error?.message || String(error) });
      }
    }
    return { ok: true, observed, results };
  }

  function prune(now = Number(clock())) {
    const cutoff = Number(now) - Number(retentionMs);
    let removed = 0;
    for (const [key, value] of pending) {
      if (Number(value.sentAt) <= cutoff) { pending.delete(key); removed += 1; }
    }
    return { removed, pending: pending.size };
  }

  return Object.freeze({
    register,
    observe,
    prune,
    snapshot: () => [...pending.values()].map(item => ({ ...item }))
  });
}

module.exports = { ACK_STATUS, normalizarAckStatus, messageIdOf, createV3BaileysAckCorrelator };
