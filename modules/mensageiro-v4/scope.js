"use strict";
const { CARDS } = require("./model");

// An empty/invalid configuration is OFF. No workspace-only or wildcard mode.
class Scope {
  constructor(targets = []) {
    if (!Array.isArray(targets) || targets.length > 10) throw new Error("v4_scope_invalid");
    this.targets = targets.map((t) => {
      if (!t || !/^[\w-]{1,100}$/.test(t.workspaceId || "") ||
          !/^[\w-]{1,150}$/.test(t.sessionId || "") ||
          !/^[\w-]{1,150}$/.test(t.profileId || "") ||
          !/^[a-zA-Z0-9_-]{1,100}@g\.us$/.test(t.groupId || "") ||
          !Array.isArray(t.cards) || !t.cards.length ||
          t.cards.some(c => !CARDS.includes(c) || c === "scheduled") ||
          new Set(t.cards).size !== t.cards.length)
        throw new Error("v4_scope_invalid");
      return Object.freeze({ workspaceId: t.workspaceId, sessionId: t.sessionId,
        profileId: t.profileId, groupId: t.groupId, cards: Object.freeze([...t.cards]) });
    });
    for (const t of this.targets)
      if (this.targets.some(o => o !== t && o.sessionId === t.sessionId &&
          o.groupId === t.groupId)) throw new Error("v4_scope_conflict");
    Object.freeze(this.targets);
  }
  static fromEnvironment(value) {
    try { return new Scope(value ? JSON.parse(value) : []); }
    catch { return new Scope(); } // fail closed; never fall back to workspace flags
  }
  owns(workspaceId) {
    this.canary?.expire();
    return this.targets.some(t => t.workspaceId === workspaceId) ||
      !!(this.canary?.run?.active && this.canary.run.target.workspaceId === workspaceId);
  }
  reserved({ sessionId, groupId, card }) {
    return this.canary?.reserved({ sessionId, groupId, card }) || this.targets.find(t => t.sessionId === sessionId && t.groupId === groupId &&
      (!card || t.cards.includes(card)));
  }
  match(context) {
    if (this.canary?.reserved(context)) return this.canary.target(context);
    const t = this.reserved(context);
    return t && t.workspaceId === context.workspaceId &&
      (!context.profileId || t.profileId === context.profileId) ? t : null;
  }
}
// A configured profile grants authority only inside one asynchronous dispatch.
// No client identifier, permanent wildcard or browser-open requirement.
class ProfileScope extends Scope {
  constructor() {
    super();
    this.universal = true;
    this.context = new (require("node:async_hooks").AsyncLocalStorage)();
    this.sessions = new Set();
    this.ready = false;
  }
  owns(workspaceId) { return /^[\w-]{1,100}$/.test(workspaceId || ""); }
  configure(sessions) {
    if (!Array.isArray(sessions) || sessions.length > 10000) throw new Error("v4_scope_invalid");
    this.sessions = new Set(sessions.map(t => JSON.stringify([t.workspaceId, t.sessionId])));
    this.ready = true;
  }
  configured(workspaceId, sessionId) {
    return this.ready && this.sessions.has(JSON.stringify([workspaceId, sessionId]));
  }
  reserved(c) {
    const t = this.context.getStore();
    return t && t.sessionId === c.sessionId && (t.destinations.includes(c.groupId) || t.aliases.has(c.groupId)) &&
      (!c.card || t.cards.includes(c.card)) ? t : null;
  }
  withTarget(t, action) {
    if (!this.owns(t.workspaceId) || !t.sessionId || !t.profileId || !t.cards?.length ||
        !t.destinations?.length || t.destinations.length > 101 ||
        t.destinations.some(d => !/^[A-Za-z0-9_:-]+@(?:g\.us|s\.whatsapp\.net|lid)$/.test(d)))
      throw new Error("v4_scope_invalid");
    return this.context.run(Object.freeze({ ...t, cards: Object.freeze([...t.cards]),
      destinations: Object.freeze([...t.destinations]), aliases: new Set() }), action);
  }
  authorizeSocketAlias(sock, destination) {
    const t = this.context.getStore();
    if (!t || !/^[A-Za-z0-9_:-]+@s\.whatsapp\.net$/.test(destination) || t.aliases.size >= 100) return false;
    // The existing handler resolves LID and records this mapping on the
    // current socket. No network request or client-provided alias is added.
    if (!t.destinations.some(lid => lid.endsWith("@lid") &&
        sock.__mensageiroLidMap?.[lid]?.lid === lid &&
        sock.__mensageiroLidMap[lid].jid === destination)) return false;
    t.aliases.add(destination);
    return true;
  }
}
module.exports = { Scope, ProfileScope };
