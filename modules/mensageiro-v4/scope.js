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
  owns(workspaceId) { return this.targets.some(t => t.workspaceId === workspaceId); }
  reserved({ sessionId, groupId, card }) {
    return this.targets.find(t => t.sessionId === sessionId && t.groupId === groupId &&
      (!card || t.cards.includes(card)));
  }
  match(context) {
    const t = this.reserved(context);
    return t && t.workspaceId === context.workspaceId &&
      (!context.profileId || t.profileId === context.profileId) ? t : null;
  }
}
module.exports = { Scope };
