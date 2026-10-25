"use strict";
const { createHash } = require("node:crypto");
const official = require("../manual-v2/manual-universal-credit");
const { normalizarAckStatus } = require("../mensageiro-v3/src/v3/baileys-ack-correlator");

// Only operational correlation lives in V3 claims. Money remains exclusively in
// the official Universal balance/ledger and its existing transactional service.
class Credits {
  constructor({ repository, getPool, allowed = () => false, prepare = async () => {},
    makeMessageId = () => require("@whiskeysockets/baileys").generateMessageIDV2(), scope } = {}) {
    Object.assign(this, { repository, getPool, allowed, prepare, makeMessageId, scope });
    this.ackInFlight = 0;
  }
  async send({ workspaceId, sessionId, profileId, groupId, parentKey, slot,
    revalidate, transport, content, options }) {
    if (!(await this.allowed(workspaceId)) || !this.scope.match({ workspaceId, sessionId, groupId, profileId }))
      throw new Error("credit_scope_blocked");
    const operationId = "v4:" + createHash("sha256")
      .update(JSON.stringify([parentKey, slot])).digest("hex");
    const key = operationId;
    const identity = { origin: "mensageiro_v4", workspaceId, operationId, destinationId: groupId };
    const messageId = this.makeMessageId();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(messageId || "")) throw new Error("transport_identity_invalid");
    const created = await this.repository.call("outbound_create", {
      workspaceId, key, parentKey, sessionId, profileId, groupId, identity, messageId,
    });
    if (!created) throw new Error("outbound_duplicate_no_replay");
    let reservation, started = false;
    try {
      await this.prepare(workspaceId);
      reservation = await official.reservarCreditoManualUniversal({ pool: this.getPool(), ...identity });
      if (!reservation.ok) throw new Error(reservation.reason === "sem_creditos" ? "sem_creditos" : "credit_blocked");
      // An earlier hold/settlement never authorizes another physical send.
      if (reservation.duplicate) throw new Error("outbound_duplicate_no_replay");
      await revalidate();
      if (!(await this.allowed(workspaceId))) throw new Error("plan_blocked");
      await this.repository.call("outbound_patch", { workspaceId, key, stage: "send_started" });
      await revalidate();
      if (!(await this.allowed(workspaceId))) throw new Error("plan_blocked");
      started = true;
      // Baileys 6.7.22 supports options.messageId. Persist it before invocation
      // so even a crash/ACK before sendMessage resolves remains correlatable.
      const result = await transport(content, { ...options, messageId });
      if (result?.key?.id !== messageId) throw new Error("transport_identity_changed");
      await this.repository.call("outbound_patch", { workspaceId, key,
        stage: "local_resolved", messageId });
      return result;
    } catch (error) {
      // Only a proven pre-transport failure releases a new hold. An exception
      // after invocation is ambiguous; retain the hold, never resend/refund it.
      if (reservation?.ok && !reservation.duplicate && !started)
        await official.liberarCreditoManualUniversal({ pool: this.getPool(), reserva: identity });
      await this.repository.call("outbound_patch", { workspaceId, key,
        stage: started ? "ambiguous" : "not_sent" });
      throw error;
    }
  }
  async recover() {
    // One bounded settlement pass only. No physical sends, release or replay.
    for (const target of this.scope.targets) {
      const rows = await this.repository.call("outbound_recover", target);
      for (const row of rows) {
        await official.confirmarCreditoManualUniversal({ pool: this.getPool(), reserva: row.identity });
        await this.repository.call("outbound_patch", { workspaceId: target.workspaceId, key: row.key, stage: "settled" });
      }
    }
  }
  async observe({ sessionId, updates = [] }) {
    const targets = this.scope.targets.filter(t => t.sessionId === sessionId);
    if (!targets.length) return { observed: 0 };
    if (this.ackInFlight >= 4 || updates.length > 64) throw new Error("v4_ack_backpressure");
    this.ackInFlight++;
    let observed = 0;
    try {
      for (const item of updates) {
        const messageId = item?.key?.id;
        const status = normalizarAckStatus(item?.update?.status);
        // A transport return / pending / server acceptance is not delivery.
        if (!messageId || !["delivery_ack", "read", "played"].includes(status) ||
            item.key.fromMe !== true) continue;
        const groupId = item.key.remoteJid;
        const target = targets.find(t => t.groupId === groupId);
        if (!target) continue;
        const workspaceId = target.workspaceId;
        const rows = await this.repository.call("outbound_ack", {
          workspaceId, sessionId, groupId, profileId: target.profileId, messageId, ack: status,
        });
        for (const row of rows) {
          // ACK persisted before idempotent financial settlement. A repeated
          // ACK after process restart safely completes a previously pending debit.
          await official.confirmarCreditoManualUniversal({ pool: this.getPool(), reserva: row.identity });
          await this.repository.call("outbound_patch", { workspaceId, key: row.key, stage: "settled" });
          observed++;
        }
      }
      return { observed };
    } finally { this.ackInFlight--; }
  }
}
module.exports = { Credits };
