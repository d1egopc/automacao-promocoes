"use strict";
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { body } = require("./moderation");

// Process-local, one tuple, no automatic reactivation after restart. The same
// gate owns admission to V3 and V4, including unresolved physical transports.
class Canary {
  constructor({ clock = () => performance.now(), authorizeTarget = () => false } = {}) {
    this.clock = clock;
    this.secret = crypto.randomBytes(32);
    this.run = null;
    this.legacy = new Map();
    this.ingressRuns = new WeakMap();
    this.timer = null;
    this.stopDiagnostic = () => {};
    this.authorizeTarget = authorizeTarget;
  }
  hash(value) {
    return crypto.createHmac("sha256", this.secret).update(String(value)).digest("hex");
  }
  same(t, c) {
    return t && t.sessionId === c.sessionId && t.groupId === c.groupId &&
      (!c.card || c.card === "groupManager");
  }
  expire() {
    if (this.run?.active && this.clock() >= this.run.deadline) this.stop("expired");
  }
  reserved(c) {
    this.expire();
    const observed = c.message && this.ingressRuns.get(c.message);
    if (observed && this.same(observed.target, c)) return observed.target;
    const r = this.run;
    return r && (r.active || r.inFlight || r.transports || (c.message && r.ingress.has(c.message))) &&
      this.same(r.target, c) ? r.target : null;
  }
  target(c) {
    this.expire();
    const r = this.run;
    return r?.active && this.same(r.target, c) && r.target.workspaceId === c.workspaceId &&
      (!c.profileId || r.target.profileId === c.profileId) ? r.target : null;
  }
  start({ target, mode, durationMs = 900000, maxEvents = 10 }) {
    this.expire();
    if (this.run?.active || this.run?.inFlight || this.run?.transports) throw new Error("canary_busy");
    if (this.legacy.has(JSON.stringify([target.sessionId, target.groupId]))) throw new Error("legacy_busy");
    if (!["observation", "controlled_test"].includes(mode) ||
        !Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 900000 ||
        !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10)
      throw new Error("limites_invalidos");
    // Validate the complete tuple independently, without accepting extra cards.
    const { Scope } = require("./scope");
    const validated = new Scope([{ ...target, cards: ["groupManager"] }]).targets[0];
    if (!this.authorizeTarget(validated)) throw new Error("alvo_nao_autorizado");
    this.run = { id: crypto.randomUUID(), target: validated, active: true, mode,
      deadline: this.clock() + durationMs, maxEvents, events: new Set(),
      inFlight: 0, transports: 0, deleteUsed: false, deleteReserved: false, noticeUsed: false, armed: null,
      challenge: mode === "controlled_test" ? crypto.randomBytes(16).toString("hex") : null,
      reason: "active", ingress: new WeakMap() };
    const r = this.run;
    this.timer = setTimeout(() => { if (this.run === r) this.stop("expired"); }, durationMs);
    this.timer.unref?.();
    return this.status(target.workspaceId);
  }
  arm({ workspaceId, runId, participantId, text, authorization, sendNotice = false }) {
    this.expire();
    const r = this.run;
    if (!r?.active || r.target.workspaceId !== workspaceId || r.id !== runId ||
        r.mode !== "controlled_test" || r.armed || r.events.size ||
        authorization !== "single_test_delete" ||
        !/^[a-zA-Z0-9_:.-]{1,100}@(s\.whatsapp\.net|lid)$/.test(participantId || "") ||
        typeof text !== "string" || text.length > 2000 ||
        !text.includes(r.challenge) || typeof sendNotice !== "boolean")
      throw new Error("test_authorization_invalid");
    // Exact synthetic text + one participant + unpredictable challenge. Never
    // store/log text or a raw participant ID; never select the first natural URL.
    r.armed = { sender: this.hash(participantId), text: this.hash(text), sendNotice };
    return this.status(workspaceId);
  }
  ingress({ sessionId, capturedWorkspaceId, current, messages = [], type }) {
    if (!this.run?.active) return; // OFF: no clock/hash/allocations.
    this.expire();
    const r = this.run;
    if (!r?.active || r.target.sessionId !== sessionId) return;
    for (const m of messages) {
      if (m?.key?.remoteJid !== r.target.groupId) continue;
      if (!m.key.id) continue;
      const h = this.hash(m.key.id);
      if (!r.events.has(h) && r.events.size >= r.maxEvents) { this.stop("event_limit"); break; }
      r.events.add(h);
      r.ingress.set(m, { current: current === true, type,
        workspace: capturedWorkspaceId === r.target.workspaceId });
      this.ingressRuns.set(m, r);
      // Reaching the bound ends permission immediately, even before dispatch.
      if (r.events.size >= r.maxEvents) { this.stop("event_limit"); break; }
    }
  }
  stop(reason = "manual") {
    const r = this.run;
    if (r?.active) {
      r.active = false; r.reason = reason; r.armed = null;
      clearTimeout(this.timer);
      try { this.stopDiagnostic(r.target.workspaceId); } catch { /* Permission is already OFF. */ }
    }
  }
  status(workspaceId) {
    this.expire();
    const r = this.run;
    if (!r || r.target.workspaceId !== workspaceId) return { state: "off", draining: false };
    return { state: r.active ? "active" : "off", draining: !!(r.inFlight || r.transports),
      runId: r.id, mode: r.mode, reason: r.reason, events: r.events.size,
      deletionAttempts: r.deleteUsed ? 1 : 0, armed: !!r.armed,
      targetHash: this.hash(JSON.stringify(r.target)).slice(0, 16),
      ...(r.active && r.challenge && !r.armed ? { testChallenge: r.challenge } : {}) };
  }
  valid(lease, context) {
    this.expire();
    return !!lease && lease.run === this.run && lease.run.active &&
      !!this.target(context) && context.profileId === lease.run.target.profileId;
  }
  isTest(lease, message) {
    const r = lease?.run, a = r?.armed, entry = r?.ingress.get(message);
    return !!a && !!entry?.current && entry.workspace && entry.type === "notify" &&
      message?.key?.fromMe === false && !!message.key.id &&
      this.hash(message.key.participant || "") === a.sender && this.hash(body(message)) === a.text &&
      (!r.testEvent || r.testEvent === this.hash(message.key.id));
  }
  takeDelete(lease, context, message) {
    const r = lease?.run;
    if (!this.valid(lease, context) || !this.isTest(lease, message) || r.deleteReserved) throw new Error("canary_action_blocked");
    r.deleteReserved = true; r.testEvent = this.hash(message.key.id);
  }
  takeNotice(lease, context, message) {
    const r = lease?.run;
    if (!this.valid(lease, context) || !this.isTest(lease, message) || !r.deleteUsed ||
        !r.armed?.sendNotice || r.noticeUsed) throw new Error("canary_action_blocked");
    r.noticeUsed = true;
  }
  physical(lease, action) {
    // Count the underlying promise, not a timeout wrapper. Expiry cannot undo a
    // transport already called; legacy stays fenced until that promise settles.
    const r = lease.run;
    this.expire();
    if (r !== this.run || !r.active) throw new Error("canary_action_blocked");
    r.transports++;
    return Promise.resolve().then(() => {
      this.expire();
      if (r !== this.run || !r.active) throw new Error("canary_action_blocked");
      return action();
    }).finally(() => { r.transports--; });
  }
  async route(context, legacy, dispatch) {
    const reserved = this.reserved(context), r = this.run;
    if (reserved) {
      const observed = context.message && this.ingressRuns.get(context.message);
      if (observed && observed !== r) return { blocked: true, reason: "canary_closed_event" };
      if (!r.active) return { blocked: true, reason: "canary_draining" };
      const lease = { run: r };
      const testEvent = this.isTest(lease, context.message);
      if (testEvent && r.testInFlight) return { blocked: true, reason: "canary_test_busy" };
      if (testEvent) { r.testEvent ||= this.hash(context.message.key.id); r.testInFlight = true; }
      r.inFlight++;
      try { return await dispatch(lease); }
      finally {
        r.inFlight--;
        if (testEvent) r.testInFlight = false;
        if (testEvent && r.deleteReserved) this.stop("test_complete");
      }
    }
    if (context.card !== "groupManager") return legacy();
    const key = JSON.stringify([context.sessionId, context.groupId]);
    this.legacy.set(key, (this.legacy.get(key) || 0) + 1);
    try { return await legacy(); }
    finally {
      const count = this.legacy.get(key) - 1;
      if (count) this.legacy.set(key, count); else this.legacy.delete(key);
    }
  }
}
module.exports = { Canary };
