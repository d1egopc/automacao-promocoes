"use strict";
const { eventIdentity, cardActive } = require("../mensageiro-v3/operational-gates");
const {
  createV3HandlerAdapters, buildV3HandlerConfig,
} = require("../mensageiro-v3/handler-adapters");
const { Moderator, body } = require("./moderation");
const { Scope } = require("./scope");
const { reply } = require("./intelligence");
const { executeModule, contactRef } = require("./module-runtime");
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
    canary,
    groupAllowed = () => false,
    participantReady = () => false,
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
    this.canary = canary;
    this.groupAllowed = groupAllowed;
    this.participantReady = participantReady;
    this.admissions = 0;
  }
  async dispatchConfigured(args) {
    const { workspaceId, sessionId, card, message, event, sock } = args;
    if (!this.scope.universal || !this.scope.configured(workspaceId, sessionId)) return { handled: false };
    const blocked = reason => ({ handled: true, result: { blocked: true, reason } });
    if (!args.planAllowed || !this.contextValid(workspaceId, sessionId, sock) || this.recoveryDisabled())
      return blocked("plan_or_socket_blocked");
    // Capture synchronously before the first await: a buffered participant
    // event must not become live just because offline completion races its IO.
    const liveAtIngress = this.participantReady(sock);
    if (!liveAtIngress) return blocked("offline_sync_unproven");
    if (this.admissions >= this.maxConcurrent) return blocked("backpressure");
    this.admissions++;
    try {
      const groupId = message?.key?.remoteJid || event?.id || "";
      const selected = await this.repository.call("select", { workspaceId, sessionId, card, groupId });
      const p = selected.profile;
      if (!p) return blocked(selected.reason || "profile_missing");
      const settings = p.execution;
      if (settings?.version !== 4) return { handled: false };
      if (!Number.isFinite(Date.parse(settings.activatedAt)) || p.sessionId !== sessionId) return blocked("activation_required");
      const group = groupId.endsWith("@g.us");
      if (group && !this.groupAllowed(workspaceId, sessionId, groupId)) return blocked("scope_unauthorized");
      const configured=p.cards[card]?.configuration?.universal;
      if(group && configured && (!p.destinations.includes(groupId) || configured.groups && !configured.groups.includes(groupId))) return blocked("scope_unauthorized");
      if (!group && !["attendance", "faq", "flows", "quickReplies"].includes(card)) return blocked("scope_unauthorized");
      if (message) {
        const raw = message.messageTimestamp;
        const timestamp = Number(raw?.toNumber ? raw.toNumber() : raw);
        if (args.upsertType !== "notify" || !Number.isFinite(timestamp) ||
            timestamp < Math.ceil(Math.max(Date.parse(settings.activatedAt), Number(sock.__optimusMessengerOnlineSince) || 0) / 1000) || timestamp > Date.now() / 1000 + 60)
          return blocked("historical_or_unproven_event");
      } else if (!event || !this.participantReady(sock)) return blocked("offline_sync_unproven");
      const destinations = [groupId];
      if (["welcome", "farewell"].includes(card) && (p.cards[card].configuration?.envio?.destino === "privado" ||
          p.cards[card].configuration?.universal?.destination === "private")) {
        for (const participant of event?.participants || []) {
          const id = typeof participant === "string" ? participant : participant.id || participant.lid;
          if (/^[A-Za-z0-9_:-]+@(?:s\.whatsapp\.net|lid)$/.test(id || "")) destinations.push(id);
        }
      }
      return { handled: true, result: await this.scope.withTarget({ workspaceId, sessionId,
        profileId: p.id, groupId, cards: [card], destinations }, () => this.dispatch({ ...args, selectedProfile: selected })) };
    } catch { return blocked("admission_unavailable"); }
    finally { this.admissions--; }
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
    canaryLease,
    selectedProfile,
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
    const canaryContext = { workspaceId, sessionId, groupId, card, profileId: target.profileId };
    const runtime = this.canary?.reserved(canaryContext);
    if (runtime && !this.canary.valid(canaryLease, canaryContext)) return block("runtime_off");
    if (this.active >= this.maxConcurrent) {
      trace("result", "backpressure");
      return block("backpressure");
    }
    this.active++;
    if (statistics) statistics.inFlight++;
    let key = "";
    let claimed = false;
    try {
      const selected = selectedProfile || await this.repository.call("select", {
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
      if (runtime && canaryLease.run.profileRevision !== undefined && p.revision !== canaryLease.run.profileRevision) {
        this.canary.stop("profile_changed");
        return block("profile_changed");
      }
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
        // Runtime natural traffic is always shadow. No claims, writes, credits
        // or transport. A controlled test also requires exact participant/text,
        // a nonce, fresh notify ingress, and a single deletion budget.
        if (runtime && !this.canary.isTest(canaryLease, message)) {
          let permission;
          try { permission = await this.moderator.permission(sock, groupId,
            message.key.participant || message.participant || ""); }
          catch { permission = { known: false }; }
          if (!this.canary.valid(canaryLease, canaryContext)) return block("runtime_off");
          trace("permission", !permission.known ? "metadata_unavailable" : permission.botAdmin ? "admin" : "not_admin", p.id);
          if (permission.known) trace("exemption", this.moderator.exempt(p.cards.groupManager.configuration || {}, permission,
            message.key.participant || message.participant || "") ? "exempt" : "not_exempt", p.id);
          trace("result", "observed", p.id, moderation?.id);
          return { processada: !!moderation, bloqueada: false, reason: "observation_only",
            simulatedDecision: moderation?.action || "no_match", deleteAttempted: false,
            deleteResult: "not_attempted", remoteDeletionConfirmed: false };
        }
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
      if (card === "attendance" && !p.cards.attendance.configuration?.universal) {
        const config = buildV3HandlerConfig(p).atendimento;
        const service = require("../mensageiro/service");
        const configuredReply = service.encontrarGatilhoAtendimento(body(message), config.gatilhos) ||
          service.encontrarRespostaRapida(body(message), config.respostasRapidas);
        intelligent = configuredReply ? null : reply({
          text: body(message),
          configuration: p.cards.attendance.configuration?.v4,
          resources: await this.publicResources(workspaceId),
          group: groupId.endsWith("@g.us"),
        });
      }
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
        const current = this.scope.universal
          ? (await this.repository.call("authorize", { workspaceId, profileId: p.id,
              sessionId, card, expectedRevision: p.revision }) ? p : null)
          : await this.repository.call("profile", {
          workspaceId,
          profileId: p.id,
        });
        if (
          !current || current.revision !== p.revision || !current.active || !cardActive(current, card) ||
          (this.scope.universal && (current.execution?.version !== 4 ||
            !current.execution.activatedAt ||
            current.sessionId !== sessionId || (groupId.endsWith("@g.us") && !this.groupAllowed(workspaceId, sessionId, groupId)))) ||
          (runtime && !this.canary.valid(canaryLease, canaryContext)) ||
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
      const sentIds = new Set();
      const permittedDestination = destination => this.scope.match({ workspaceId, sessionId,
        groupId: destination, card, profileId: p.id }) || this.scope.authorizeSocketAlias?.(sock, destination);
      const send = async (destination, content, options) => {
        // All adapters share this fence, including notices and private redirects.
        if (!permittedDestination(destination)) throw new Error("scope_unauthorized");
        if (content?.delete) {
          if (!this.scope.universal || !sentIds.has(destination + ":" + content.delete.id)) throw new Error("scope_unauthorized");
          await revalidate();
          return this.transport(() => sock.sendMessage(destination, content, options));
        }
        if (runtime) this.canary.takeNotice(canaryLease, canaryContext, message);
        if (!this.credits || ++slot > 8) throw new Error("credit_gate_unavailable");
        const result = await this.credits.send({ workspaceId, sessionId, profileId: p.id, groupId: destination,
          parentKey: key, slot, revalidate, content, options,
          transport: (payload, opts) => this.transport(() => runtime
            ? this.canary.physical(canaryLease, () => sock.sendMessage(groupId, payload, opts))
            : sock.sendMessage(destination, payload, opts)) });
        if (result?.key?.id) sentIds.add(destination + ":" + result.key.id);
        return result;
      };
      const guardedSocket = new Proxy(sock, { get(object, name) {
        if (name === "sendMessage") return send;
        if (name === "sendPresenceUpdate") return async (presence, destination) => {
          if (!permittedDestination(destination)) throw new Error("scope_unauthorized");
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
        } else if ((p.cards.groupManager.configuration?.universal && permission.admin) || !permission.botAdmin && moderation.action !== "warn") {
          trace("permission", "not_admin", p.id);
          result = { blocked: true, reason: "bot_not_admin" };
        } else if (["warn","warn_ban"].includes(moderation.action)) {
          if(runtime) throw new Error("scope_unauthorized");
          await revalidate();
          const count=await this.repository.call("strike",{workspaceId,profileId:p.id,sessionId,expectedRevision:p.revision,
            contactRef:contactRef(p,sessionId,groupId+":"+(message.key.participant||"")),
            eventRef:require("node:crypto").createHash("sha256").update(message.key.id).digest("hex"),
            ruleId:moderation.id,windowMinutes:moderation.strikeWindowMinutes||60});
          result={processada:true,ruleId:moderation.id,strikes:count.count,banAttempted:false,banResult:"not_attempted"};
          if(moderation.action === "warn_ban" && count.count >= moderation.strikes) {
            // Re-fetch administration immediately before removal. Never remove
            // an admin, owner, bot or participant other than this event sender.
            const fresh=await this.moderator.permission(sock,groupId,message.key.participant||"",true);
            if(!fresh.known||!fresh.botAdmin||fresh.admin||fresh.owner) {result.blocked=true;result.reason="ban_permission_unproven";}
            else {
              await revalidate();
              result.banAttempted=true;
              try { await this.transport(()=>sock.groupParticipantsUpdate(groupId,[message.key.participant],"remove")); result.banResult="local_resolved"; }
              catch {result.banResult="error";}
            }
          } else {
            try {await send(groupId,{text:moderation.warning});result.noticeResult="local_resolved";}
            catch(error) {result.noticeResult=error.message==="sem_creditos"?"sem_creditos":"not_confirmed";}
          }
        } else {
          trace("exemption", "not_exempt", p.id);
          trace("permission", "admin", p.id);
          await revalidate();
          if (runtime) this.canary.takeDelete(canaryLease, canaryContext, message);
          const deleteMessage = () => {
            deleteAttempted = true; deleteResult = "attempted";
            if (runtime) canaryLease.run.deleteUsed = true;
            trace("action", "delete_started", p.id, moderation.id);
            return sock.sendMessage(groupId, { delete: message.key });
          };
          try {
            // No debit for deletion: no new moderation charge policy is inferred.
            await this.transport(() => runtime
              ? this.canary.physical(canaryLease, deleteMessage)
              : deleteMessage());
          } catch {
            deleteResult = deleteAttempted ? "error" : "not_attempted";
            trace("result", "delete_error", p.id, moderation.id);
            result = { processada: true, bloqueada: true, deleteAttempted,
              deleteResult, remoteDeletionConfirmed: false };
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
        const configured = await executeModule({profile:p,card,message,event,sessionId,groupId,
          send,repository:this.repository,revalidate});
        if(configured) result=configured;
        else {
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
      }
      if(moderation && result) result.ruleId=moderation.id;
      await this.repository.call("complete", {
        workspaceId,
        key,
        status: result?.blocked ? "blocked" : "ambiguous",
        result,
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
