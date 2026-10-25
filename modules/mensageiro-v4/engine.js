"use strict";
const { eventIdentity } = require("../mensageiro-v3/operational-gates");
const {
  createV3HandlerAdapters,
} = require("../mensageiro-v3/handler-adapters");
const { Moderator, body } = require("./moderation");
const { Scope } = require("./scope");
const { reply } = require("./intelligence");
class V4Engine {
  constructor({
    repository,
    enabled = () => false,
    scope = new Scope(),
    credits,
    actionAllowed = () => false,
    contextValid = () => false,
    recoveryDisabled = () => false,
    diagnostics,
    publicResources = async () => ({}),
    maxConcurrent = 4,
    handlers,
  } = {}) {
    this.repository = repository;
    this.enabled = enabled;
    this.scope = scope;
    this.credits = credits;
    this.actionAllowed = actionAllowed;
    this.contextValid = contextValid;
    this.recoveryDisabled = recoveryDisabled;
    this.diagnostics = diagnostics;
    this.publicResources = publicResources;
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.blocked = 0;
    this.workspaceStats = new Map();
    this.moderator = new Moderator();
    this.cooldowns = new Map();
    this.handlers = handlers;
  }
  owns(workspaceId) {
    return this.enabled(workspaceId) === true && this.scope.owns(workspaceId);
  }
  stats(workspaceId) {
    return {
      ...(this.workspaceStats.get(workspaceId) || { inFlight: 0, blocked: 0 }),
    };
  }
  async dispatch({
    workspaceId,
    sessionId,
    card,
    message,
    event,
    sock,
    planAllowed,
  }) {
    const trace = this.diagnostics?.trace(message || event) || (() => {});
    if (
      this.owns(workspaceId) &&
      !this.workspaceStats.has(workspaceId) &&
      this.workspaceStats.size < 1000
    )
      this.workspaceStats.set(workspaceId, { inFlight: 0, blocked: 0 });
    const statistics = this.workspaceStats.get(workspaceId);
    let deleteAttempted = false, deleteResult = "not_attempted";
    const block = (code) => {
      this.blocked++;
      if (statistics) statistics.blocked++;
      return { blocked: true, reason: code, ...(card === "groupManager" ? { deleteAttempted, deleteResult, remoteDeletionConfirmed: false } : {}) };
    };
    if (!this.owns(workspaceId)) return block("runtime_off");
    if (!planAllowed || this.recoveryDisabled()) {
      trace("scope", "plan_blocked");
      return block("plan_blocked");
    }
    if (!this.contextValid(workspaceId, sessionId, sock)) {
      trace("socket", "stale");
      return block("socket_stale");
    }
    if (message?.key?.fromMe === true) {
      trace("scope", "own_message");
      return block("own_message");
    }
    const groupId = message?.key?.remoteJid || event?.id || "";
    if (!groupId || groupId === "status@broadcast")
      return block("destination_missing");
    const target = this.scope.match({ workspaceId, sessionId, groupId, card });
    if (!target) { trace("scope", "unauthorized"); return block("scope_unauthorized"); }
    if (this.active >= this.maxConcurrent) {
      trace("result", "backpressure");
      return block("backpressure");
    }
    this.active++;
    if (statistics) statistics.inFlight++;
    let key = "";
    let claimed = false;
    try {
      const selected = await this.repository.call("select", {
        workspaceId,
        sessionId,
        groupId,
        card,
      });
      if (!selected.profile) {
        trace(
          "profile",
          ({PERFIL_AMBIGUO:"ambiguous",PERFIL_INATIVO:"inactive",SESSAO_INCORRETA:"session_incorrect",CARD_INATIVO:"card_inactive",GRUPO_NAO_AUTORIZADO:"unauthorized"})[selected.reason] || "inactive",
        );
        return block(selected.reason);
      }
      const p = selected.profile;
      if (p.id !== target.profileId) { trace("profile", "unauthorized"); return block("profile_unauthorized"); }
      trace("profile", "selected", p.id);
      trace("scope", "matched", p.id);
      if (p.cards.groupManager.configuration?.v4?.migrationVersion !== 4) {
        trace("profile", "migration_required", p.id);
        return block("migration_required");
      }
      let moderation = null,
        intelligent = null;
      if (card === "groupManager") {
        moderation = this.moderator.evaluate(p, message);
        trace(
          "rule",
          moderation
            ? moderation.uncertain
              ? "uncertain"
              : "violation"
            : "no_match",
          p.id,
          moderation?.id,
        );
        if (
          !moderation ||
          moderation.action === "observe" ||
          moderation.action === "review"
        )
          return {
            deleteAttempted: false, deleteResult: "not_attempted", remoteDeletionConfirmed: false,
            processada: !!moderation,
            bloqueada: false,
            reason: moderation ? "observe_only" : "no_match",
          };
      }
      if (card === "attendance")
        intelligent = reply({
          text: body(message),
          configuration: p.cards.attendance.configuration?.v4,
          resources: await this.publicResources(workspaceId),
          group: groupId.endsWith("@g.us"),
        });
      const eventId = eventIdentity({
        message,
        event: event
          ? {
              ...event,
              participants: (event.participants || []).map((item) =>
                typeof item === "string" ? item : item.id || item.lid || "",
              ),
            }
          : event,
        card,
      });
      if (!eventId) {
        trace("scope", "no_identity", p.id);
        return block("no_identity");
      }
      key = workspaceId + ":" + p.id + ":" + card + ":" + eventId;
      const cooldownKey = JSON.stringify([
        workspaceId,
        p.id,
        sessionId,
        groupId,
      ]);
      if (intelligent && (this.cooldowns.get(cooldownKey) || 0) > Date.now())
        return block("cooldown");
      if (intelligent) {
        for (const [k, until] of this.cooldowns)
          if (until < Date.now()) this.cooldowns.delete(k);
        if (this.cooldowns.size >= 2000 && !this.cooldowns.has(cooldownKey))
          return block("backpressure");
        // Reserve before the next await so concurrent greetings cannot both send.
        this.cooldowns.set(
          cooldownKey,
          Date.now() + intelligent.cooldownSeconds * 1000,
        );
      }
      claimed = await this.repository.call("claim", {
        workspaceId,
        profileId: p.id,
        expectedRevision: p.revision,
        key,
        card,
      });
      if (!claimed) {
        trace("result", "duplicate", p.id);
        return block("claim_exists_or_revision_changed");
      }
      trace("action", "claimed", p.id);
      const revalidate = async () => {
        const current = await this.repository.call("profile", {
          workspaceId,
          profileId: p.id,
        });
        if (
          current.revision !== p.revision || !current.active || !current.cards[card]?.active ||
          !this.scope.match({ workspaceId, sessionId, groupId, card, profileId: current.id }) ||
          !this.actionAllowed(workspaceId) ||
          !this.contextValid(workspaceId, sessionId, sock) ||
          !this.owns(workspaceId) ||
          this.recoveryDisabled()
        )
          throw new Error("context_changed");
      };
      await revalidate();
      let slot = 0;
      const send = async (destination, content, options) => {
        // All adapters share this fence, including notices and private redirects.
        if (destination !== groupId || content?.delete) throw new Error("scope_unauthorized");
        if (!this.credits || ++slot > 8) throw new Error("credit_gate_unavailable");
        return this.credits.send({ workspaceId, sessionId, profileId: p.id, groupId,
          parentKey: key, slot, revalidate, content, options,
          transport: (payload, opts) => this.transport(() => sock.sendMessage(groupId, payload, opts)) });
      };
      const guardedSocket = new Proxy(sock, { get(object, name) {
        if (name === "sendMessage") return send;
        if (name === "sendPresenceUpdate") return async (presence, destination) => {
          if (destination !== groupId) throw new Error("scope_unauthorized");
          await revalidate();
          return object.sendPresenceUpdate?.(presence, destination);
        };
        const value = Reflect.get(object, name);
        return typeof value === "function" ? value.bind(object) : value;
      }});
      let result;
      if (moderation) {
        let permission;
        try {
          permission = await this.moderator.permission(
            sock,
            groupId,
            message.key.participant || message.participant || "",
          );
        } catch {
          permission = { known: false };
        }
        if (!permission.known) {
          trace("permission", "metadata_unavailable", p.id);
          result = { blocked: true, reason: "metadata_unavailable" };
        } else if (
          this.moderator.exempt(
            p.cards.groupManager.configuration || {},
            permission,
            message.key.participant || message.participant || "",
          )
        ) {
          trace("exemption", "exempt", p.id);
          result = { blocked: true, reason: "sender_exempt" };
        } else if (!permission.botAdmin) {
          trace("permission", "not_admin", p.id);
          result = { blocked: true, reason: "bot_not_admin" };
        } else {
          trace("exemption", "not_exempt", p.id);
          trace("permission", "admin", p.id);
          await revalidate();
          deleteAttempted = true; deleteResult = "attempted";
          trace("action", "delete_started", p.id, moderation.id);
          try {
            // No debit for deletion: no new moderation charge policy is inferred.
            await this.transport(() => sock.sendMessage(groupId, { delete: message.key }));
          } catch {
            deleteResult = "error";
            trace("result", "delete_error", p.id, moderation.id);
            result = { processada: true, bloqueada: true, deleteAttempted: true,
              deleteResult: "error", remoteDeletionConfirmed: false };
          }
          if (!result) {
            deleteResult = "local_resolved";
            trace("result", "delete_local_resolved", p.id, moderation.id);
            result = { processada: true, bloqueada: true, deleteAttempted: true,
              deleteResult: "local_resolved", remoteDeletionConfirmed: false,
              transportAccepted: true, deletionConfirmed: false };
            if (moderation.action === "delete_warn") {
              try { await send(groupId, { text: moderation.warning }); }
              catch (error) { trace("result", "notice_failed", p.id, moderation.id);
                result.noticeResult = ["sem_creditos", "plan_blocked"].includes(error.message)
                  ? error.message : "not_confirmed"; }
            }
          }
        }
      } else if (intelligent) {
        trace("action", "reply_started", p.id);
        await revalidate();
        await send(groupId, { text: intelligent.text });
        trace("result", "reply_accepted", p.id);
        result = {
          processada: true,
          transportAccepted: true,
          intent: intelligent.intent,
          deliveryConfirmed: false,
        };
      } else {
        const handlers =
          this.handlers ||
          createV3HandlerAdapters({
            store: {
              reload() {},
              getProfile(w, id) {
                return w === p.workspaceId && id === p.id ? p : null;
              },
            },
          });
        if (typeof handlers[card] !== "function")
          throw new Error("handler_unavailable");
        result = await handlers[card]({
          workspaceId,
          profileId: p.id,
          clienteId: workspaceId,
          sessaoId: sessionId,
          sock: guardedSocket,
          mensagem: message,
          evento: event,
          planoLiberado: true,
        });
      }
      await this.repository.call("complete", {
        workspaceId,
        key,
        status: result?.blocked ? "blocked" : "ambiguous",
      });
      return card === "groupManager" ? { deleteAttempted: false, deleteResult: "not_attempted",
        remoteDeletionConfirmed: false, ...result } : result;
    } catch (error) {
      // No retry after an uncertain claim. Only a correlated factual ACK settles money.
      if (claimed)
        try {
          await this.repository.call("complete", {
            workspaceId,
            key,
            status: "ambiguous",
          });
        } catch {}
      trace("result", "transport_ambiguous");
      return block(
        ["sem_creditos", "plan_blocked", "scope_unauthorized", "credit_gate_unavailable"].includes(error.message)
          ? error.message : error.message === "v4_backpressure" ? "backpressure" : "operation_uncertain",
      );
    } finally {
      this.active--;
      if (statistics) statistics.inFlight--;
    }
  }
  async transport(action) {
    let timer;
    try {
      return await Promise.race([
        action(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("transport_timeout")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
module.exports = { V4Engine };
