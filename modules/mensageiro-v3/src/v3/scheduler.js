const { buildOccurrenceKey } = require("./store");
const MAX_DUE_LAG_MS = 90_000;

class V3Scheduler {
  constructor({ store, transport, clock = () => Date.now(), logger = () => {}, isWorkspaceMigrated = () => true } = {}) {
    if (!store || !transport || typeof transport.sendMessage !== "function") throw new Error("dependencias_scheduler_obrigatorias");
    this.store = store; this.transport = transport; this.clock = clock; this.logger = logger;
    this.isWorkspaceMigrated = isWorkspaceMigrated; this.running = false;
  }

  async tick() {
    if (this.running) return { ok: true, skipped: "rodada_em_andamento", sent: 0, blocked: 0, ambiguous: 0 };
    this.running = true; const sent = []; const blocked = []; const ambiguous = [];
    try {
      const now = Number(this.clock());
      this.store.reload();
      for (const workspaceId of Object.keys(this.store.snapshot().workspaces)) {
        let migrated = false;
        try { migrated = this.isWorkspaceMigrated(workspaceId) === true; }
        catch (error) {
          blocked.push({ workspaceId, reason: "fence_indisponivel" });
          this.logger({ workspaceId, reason: "fence_indisponivel", error: error?.message || String(error) });
          continue;
        }
        if (!migrated) continue;
        for (const candidate of this.store.effectiveSchedules(workspaceId, now)) {
          this.store.reload();
          const fresh = this.store.getSchedule(workspaceId, candidate.id);
          const profile = fresh && this.store.getProfile(workspaceId, fresh.profileId);
          const reason = this._reason(fresh, profile, now);
          if (reason) { blocked.push({ workspaceId, scheduleId: candidate.id, reason }); this.store.recordDecision(workspaceId, { scheduleId: candidate.id, decision: "blocked", reason }); continue; }
          if (now - Date.parse(fresh.nextRunAt) > MAX_DUE_LAG_MS) {
            const skipped = this.store.skipOverdueOccurrence(workspaceId, fresh.id, {
              occurrenceAt: fresh.nextRunAt, expectedRevision: fresh.revision, now, maxLagMs: MAX_DUE_LAG_MS
            });
            if (skipped.skipped) {
              blocked.push({ workspaceId, scheduleId: fresh.id, reason: "atraso_sem_replay" });
              this.store.recordDecision(workspaceId, { scheduleId: fresh.id, decision: "skipped", reason: "atraso_sem_replay" });
            }
            continue;
          }
          const occurrenceAt = new Date(fresh.nextRunAt).toISOString();
          for (const destination of fresh.destinations) {
            let claimKey = "";
            let claimed = false;
            try {
              if (typeof this.transport.authorizeSend === "function") {
                const authorized = await this.transport.authorizeSend({ workspaceId, profileId: fresh.profileId, destination, schedule: fresh });
                if (authorized !== true) {
                  blocked.push({ workspaceId, scheduleId: fresh.id, destination, reason: "transport_authorization_denied" });
                  this.store.recordDecision(workspaceId, { scheduleId: fresh.id, destination, decision: "blocked", reason: "transport_authorization_denied" });
                  continue;
                }
              }
              // Authorization may be asynchronous. Reload and reject any
              // revision, ownership, destination or activation change.
              this.store.reload();
              const afterAuthorization = this.store.getSchedule(workspaceId, fresh.id);
              const afterAuthorizationProfile = afterAuthorization && this.store.getProfile(workspaceId, afterAuthorization.profileId);
              const authorizationReason = this._reason(afterAuthorization, afterAuthorizationProfile, now);
              if (authorizationReason || afterAuthorization?.revision !== fresh.revision ||
                !Array.isArray(afterAuthorization?.destinations) || !afterAuthorization.destinations.includes(destination)) {
                const decisionReason = authorizationReason || "configuracao_alterada";
                blocked.push({ workspaceId, scheduleId: fresh.id, destination, reason: decisionReason });
                this.store.recordDecision(workspaceId, { scheduleId: fresh.id, destination, decision: "blocked", reason: decisionReason });
                continue;
              }
              // A claim is unique to this scheduled occurrence and destination.
              claimKey = buildOccurrenceKey(workspaceId, afterAuthorization.id, afterAuthorization.revision, occurrenceAt, destination);
              if (!this.store.claimExecution(workspaceId, claimKey, {
                scheduleId: afterAuthorization.id,
                profileId: afterAuthorization.profileId,
                destination,
                occurrenceKey: claimKey,
                occurrenceAt
              })) continue;
              claimed = true;
              // The claim is durable; perform one final fail-closed read before
              // calling the transport.
              this.store.reload();
              const beforeSend = this.store.getSchedule(workspaceId, afterAuthorization.id);
              const beforeSendProfile = beforeSend && this.store.getProfile(workspaceId, beforeSend.profileId);
              const beforeSendReason = this._reason(beforeSend, beforeSendProfile, now);
              if (beforeSendReason || beforeSend?.revision !== afterAuthorization.revision ||
                beforeSendProfile?.revision !== afterAuthorizationProfile?.revision ||
                beforeSendProfile?.sessionId !== afterAuthorizationProfile?.sessionId ||
                !Array.isArray(beforeSend?.destinations) || !beforeSend.destinations.includes(destination)) {
                const decisionReason = beforeSendReason || "configuracao_alterada";
                blocked.push({ workspaceId, scheduleId: afterAuthorization.id, destination, reason: decisionReason });
                this.store.completeExecution(workspaceId, claimKey, { status: "blocked", occurrenceKey: claimKey, reason: decisionReason });
                this.store.recordDecision(workspaceId, { scheduleId: afterAuthorization.id, destination, decision: "blocked", reason: decisionReason });
                this.store.advanceScheduleOccurrence(workspaceId, afterAuthorization.id, { occurrenceAt, expectedRevision: afterAuthorization.revision, now });
                continue;
              }
              const transportResult = await this.transport.sendMessage({ workspaceId, profileId: beforeSend.profileId, sessionId: beforeSendProfile.sessionId, destination, content: beforeSend.content, claimKey });
              const status = transportResult?.ambiguous === true || transportResult?.confirmed === false ? "ambiguous" : "confirmed";
              this.store.completeExecution(workspaceId, claimKey, {
                status,
                occurrenceKey: claimKey,
                transportMessageId: transportResult?.transportMessageId || undefined,
                transportState: transportResult?.transportState || (status === "ambiguous" ? "local_return_without_ack" : "confirmed_by_transport_return")
              });
              if (status === "confirmed") {
                sent.push({ workspaceId, scheduleId: beforeSend.id, destination });
                this.store.recordDecision(workspaceId, { scheduleId: beforeSend.id, destination, decision: "sent" });
              } else {
                ambiguous.push({ workspaceId, scheduleId: beforeSend.id, destination, reason: "transport_ambiguous" });
                this.store.recordDecision(workspaceId, { scheduleId: beforeSend.id, destination, decision: "ambiguous" });
              }
              this.store.advanceScheduleOccurrence(workspaceId, beforeSend.id, { occurrenceAt, expectedRevision: afterAuthorization.revision, now });
            } catch (error) {
              blocked.push({ workspaceId, scheduleId: fresh.id, destination, reason: "transport_error" });
              if (claimed && claimKey) {
                this.store.completeExecution(workspaceId, claimKey, { status: "failed", occurrenceKey: claimKey, reason: "transport_error" });
                this.store.advanceScheduleOccurrence(workspaceId, fresh.id, { occurrenceAt, expectedRevision: fresh.revision, now });
              }
              this.store.recordDecision(workspaceId, { scheduleId: fresh.id, destination, decision: "blocked", reason: "transport_error" });
              this.logger({ error: error?.message || String(error), workspaceId, scheduleId: fresh.id });
            }
          }
        }
      }
      return { ok: true, sent, blocked, ambiguous };
    } finally { this.running = false; }
  }

  _reason(schedule, profile, now) {
    if (!schedule) return "schedule_removed";
    if (schedule.active !== true) return "schedule_inactive";
    if (!profile) return "profile_removed";
    if (profile.active !== true) return "profile_inactive";
    if (profile.cards?.scheduled?.active !== true) return "card_inactive";
    if (!profile.sessionId) return "session_missing";
    if (!Array.isArray(schedule.destinations) || !schedule.destinations.length) return "destination_missing";
    if (schedule.content === null || schedule.content === undefined) return "content_removed";
    if (!schedule.nextRunAt) return "not_due";
    const nextRun = Date.parse(schedule.nextRunAt);
    if (!Number.isFinite(nextRun)) return "next_run_invalido";
    if (nextRun > now) return "not_due";
    return "";
  }
}

module.exports = { V3Scheduler };
