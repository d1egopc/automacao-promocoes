"use strict";
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const STAGES = new Set([
  "ingress",
  "socket",
  "workspace",
  "profile",
  "scope",
  "rule",
  "exemption",
  "permission",
  "action",
  "result",
]);
const CODES = new Set([
  "received",
  "current",
  "stale",
  "matched",
  "workspace_mismatch",
  "selected",
  "inactive",
  "session_incorrect",
  "card_inactive",
  "migration_required",
  "ambiguous",
  "unauthorized",
  "scope_changed",
  "no_match",
  "uncertain",
  "violation",
  "exempt",
  "not_exempt",
  "admin",
  "not_admin",
  "metadata_unavailable",
  "delete_started",
  "transport_accepted",
  "transport_failed",
  "transport_ambiguous",
  "notice_failed",
  "reply_started",
  "reply_accepted",
  "own_message",
  "backpressure",
  "handler_unavailable",
  "claimed",
  "duplicate",
  "plan_blocked",
  "runtime_off",
  "timeout",
  "no_identity",
  "observed",
  "delete_error",
  "delete_local_resolved",
]);
class Diagnostics {
  constructor({
    ownsSession,
    authorizeTarget = () => false,
    clock = () => performance.now(),
    secret = crypto.randomBytes(32),
    onStop = () => {},
    getCurrentSocket = () => null,
  } = {}) {
    this.ownsSession = ownsSession;
    this.authorizeTarget = authorizeTarget;
    this.clock = clock;
    this.secret = secret;
    this.run = null;
    this.traces = new WeakMap();
    this.timer = null;
    this.onStop = onStop;
    this.getCurrentSocket = getCurrentSocket;
    this.identities = new WeakMap();
    this.identitySerial = 0;
  }
  hash(value) {
    return value
      ? crypto
          .createHmac("sha256", this.secret)
          .update(String(value))
          .digest("hex")
          .slice(0, 16)
      : "";
  }
  expire() {
    if (this.run?.active && this.clock() >= this.run.deadline)
      this.stop(this.run.workspaceId);
    if (this.run && !this.run.active && this.clock() >= this.run.purgeAt)
      this.run = null;
  }
  opaque(object) {
    if (!object || !["object", "function"].includes(typeof object)) return null;
    if (!this.identities.has(object)) this.identities.set(object, this.hash("binding:" + (++this.identitySerial)));
    return this.identities.get(object);
  }
  binding(run) {
    // Only the authenticated run's target is inspected; no emitter mutation,
    // event-buffer flush, listener registration, contents or participant IDs.
    try {
      const sock = this.getCurrentSocket(run.sessionId);
      if (!sock) return { available: false };
      const entry = sock.__optimusListeners?.["messages.upsert"];
      const emitter = sock.ev;
      let buffering = null, attached = null;
      if (typeof emitter?.isBuffering === "function") {
        try { buffering = emitter.isBuffering() === true; } catch {}
      }
      if (entry && typeof emitter?.listeners === "function") {
        try { attached = emitter.listeners("messages.upsert").includes(entry.handler); } catch {}
      }
      return { available: true, socketId: this.opaque(sock), emitterId: this.opaque(emitter),
        registeredEmitterId: this.opaque(entry?.emissor), callbackId: this.opaque(entry?.handler),
        generation: Number.isInteger(sock.__optimusSocketGeracao) ? sock.__optimusSocketGeracao : null,
        registryPresent: !!entry, registryEmitterMatches: entry ? entry.emissor === emitter : null,
        attachmentVerified: attached, buffering };
    } catch { return { available: false, lookupFailed: true }; }
  }
  increment(run, key) {
    if (Object.hasOwn(run.counters, key)) run.counters[key] = Math.min(1000000, run.counters[key] + 1);
  }
  observeListener({ sessionId, sock, emitter, emitterCurrent, callbackCurrent, generation }) {
    if (!this.run?.active || this.run.sessionId !== sessionId) return;
    this.expire();
    const r = this.run;
    if (!r?.active) return;
    this.increment(r, "wrapperCalls");
    if (!emitterCurrent) this.increment(r, "rejectedEmitter");
    if (!callbackCurrent) this.increment(r, "rejectedCallback");
    r.lastWrapper = { socketId: this.opaque(sock), emitterId: this.opaque(emitter),
      generation: Number.isInteger(generation) ? generation : null,
      emitterCurrent: emitterCurrent === true, callbackCurrent: callbackCurrent === true };
  }
  start({
    workspaceId,
    sessionId,
    groupId,
    durationMs = 900000,
    maxEvents = 10,
  }) {
    this.expire();
    if (this.run) throw new Error("diagnostico_existente");
    if (
      !groupId?.endsWith("@g.us") ||
      !this.ownsSession(workspaceId, sessionId) ||
      !this.authorizeTarget({ workspaceId, sessionId, groupId })
    )
      throw new Error("alvo_nao_autorizado");
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 1000 ||
      durationMs > 900000 ||
      !Number.isInteger(maxEvents) ||
      maxEvents < 1 ||
      maxEvents > 10
    )
      throw new Error("limites_invalidos");
    this.run = {
      id: crypto.randomUUID(),
      workspaceId,
      sessionId,
      groupId,
      active: true,
      deadline: this.clock() + durationMs,
      maxEvents,
      events: new Set(),
      coverage: { matchingMessages: 0, keylessMessages: 0, firstObservedAt: null, lastObservedAt: null },
      records: [],
      purgeAt: Infinity,
      counters: Object.fromEntries(["wrapperCalls", "rejectedEmitter", "rejectedCallback",
        "observerCalls", "observerErrors", "authorizationRejected", "invalidBatch",
        "batchesEmpty", "messagesSeen", "nonTargetMessages", "alternateTargetMatches",
        "normalizedTargetMatches", "workspaceMismatch", "staleSocket"].map(key => [key, 0])),
      lastWrapper: null,
      lastCallback: null,
    };
    this.run.bindingAtStart = this.binding(this.run);
    this.timer = setTimeout(() => this.stop(workspaceId), durationMs);
    this.timer.unref?.();
    return this.status(workspaceId);
  }
  stop(workspaceId) {
    if (this.run?.workspaceId === workspaceId && this.run.active) {
      const ended = this.run;
      ended.active = false;
      ended.bindingAtStop = this.binding(ended);
      ended.purgeAt = this.clock() + 300000;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.run === ended) this.run = null;
      }, 300000);
      this.timer.unref?.();
      try { this.onStop(workspaceId); } catch { /* Diagnostic failures never enable actions. */ }
    }
    return this.status(workspaceId, false);
  }
  status(workspaceId, expire = true) {
    if (expire) this.expire();
    const r = this.run;
    return !r || r.workspaceId !== workspaceId
      ? { state: "off", records: [], events: 0 }
      : {
          state: r.active ? "active" : "finished",
          runId: r.id,
          events: r.events.size,
          coverage: { ...r.coverage, ingress: r.coverage.matchingMessages ? "observed_at_original_callback" : "not_observed_at_original_callback",
            limitation: "No evidence about encrypted packets or events before messages.upsert" },
          records: r.records.slice(),
          retentionAfterStopMs: 300000,
          ingressProbe: { counters: { ...r.counters }, bindingAtStart: r.bindingAtStart,
            bindingCurrent: r.active ? this.binding(r) : r.bindingAtStop,
            lastWrapper: r.lastWrapper, lastCallback: r.lastCallback,
            limitation: "Registry presence is not proof of attachment when emitter introspection is unavailable; other destinations are aggregate counts only" },
        };
  }
  record(eventHash, stage, code, profileId = "", ruleId = "", extra = {}) {
    this.expire();
    const r = this.run;
    if (
      !r?.active ||
      !r.events.has(eventHash) ||
      !STAGES.has(stage) ||
      !CODES.has(code) ||
      r.records.length >= 120
    )
      return;
    r.records.push({
      timestamp: new Date().toISOString(),
      eventHash,
      sessionHash: this.hash(r.sessionId),
      groupHash: this.hash(r.groupId),
      profileHash: this.hash(profileId),
      ruleHash: this.hash(ruleId),
      stage,
      code,
      ...(typeof extra.fromMe === "boolean" ? { fromMe: extra.fromMe } : {}),
      ...(Number.isInteger(extra.generation)
        ? { generation: extra.generation }
        : {}),
        ...(extra.type
        ? {
              type: ["notify", "append", "participants"].includes(extra.type)
              ? extra.type
              : "other",
          }
        : {}),
    });
  }
  observe({
    sessionId,
    capturedWorkspaceId,
    sock,
    current,
    generation,
    messages = [],
    type,
    probe = true,
  }) {
    // OFF costs one null/boolean check; no clock/hash/IO and no extra listener.
    if (!this.run?.active) return;
    if (this.run.sessionId !== sessionId) return; // never count another session
    const observedRun = this.run;
    try {
    this.expire();
    const r = this.run;
    if (!r?.active) return;
    if (probe) {
      this.increment(r, "observerCalls");
      r.lastCallback = { socketId: this.opaque(sock), emitterId: this.opaque(sock?.ev),
        generation: Number.isInteger(generation) ? generation : null, current: current === true };
      if (capturedWorkspaceId !== r.workspaceId) this.increment(r, "workspaceMismatch");
      if (current === false) this.increment(r, "staleSocket");
    }
    if (!this.ownsSession(r.workspaceId, sessionId) ||
        !this.authorizeTarget({ workspaceId: r.workspaceId, sessionId, groupId: r.groupId })) {
      if (probe) this.increment(r, "authorizationRejected");
      this.stop(r.workspaceId);
      return;
    }
    if (!Array.isArray(messages)) { if (probe) this.increment(r, "invalidBatch"); return; }
    if (probe && !messages.length) this.increment(r, "batchesEmpty");
    for (const message of messages) {
      if (probe) this.increment(r, "messagesSeen");
      if (message?.key?.remoteJid !== r.groupId) {
        if (probe) {
          this.increment(r, "nonTargetMessages");
          if (message?.key?.remoteJidAlt === r.groupId) this.increment(r, "alternateTargetMatches");
          const jid = message?.key?.remoteJid;
          if (typeof jid === "string" && jid.trim().toLowerCase() === r.groupId.toLowerCase()) this.increment(r, "normalizedTargetMatches");
        }
        continue;
      }
      r.coverage.matchingMessages++;
      r.coverage.lastObservedAt = new Date().toISOString();
      r.coverage.firstObservedAt ||= r.coverage.lastObservedAt;
      if (!message.key.id) { r.coverage.keylessMessages++; continue; }
      const eventHash = this.hash(message.key.id);
      if (!r.events.has(eventHash) && r.events.size >= r.maxEvents) continue;
      r.events.add(eventHash);
      this.record(eventHash, "ingress", "received", "", "", {
        fromMe: message.key.fromMe === true,
        generation,
        type,
      });
      this.record(
        eventHash,
        "workspace",
        capturedWorkspaceId === r.workspaceId
          ? "matched"
          : "workspace_mismatch",
      );
      this.record(eventHash, "socket", current ? "current" : "stale");
      this.traces.set(message, (stage, code, profileId, ruleId) => {
        if (this.run === r && r.active)
          this.record(eventHash, stage, code, profileId, ruleId);
      });
    }
    } catch { if (probe) this.increment(observedRun, "observerErrors"); }
  }
  trace(message) {
    return message && typeof message === "object"
      ? this.traces.get(message)
      : null;
  }
  observeParticipants(context) {
    if(!this.run?.active)return;
    const event=context.event;
    if(!event?.id||!Array.isArray(event.participants)||!event.participants.length)return;
    const identity=this.hash(JSON.stringify([event.id,event.action,event.timestamp||"",event.participants]));
    const marker={key:{id:identity,remoteJid:event.id}};
    this.observe({...context,messages:[marker],type:"participants",probe:false});
    const callback=this.trace(marker);
    if(callback)this.traces.set(event,callback);
  }
}
module.exports = { Diagnostics };
