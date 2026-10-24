"use strict";

const crypto = require("node:crypto");

const ALLOWED_WORKSPACE_ID = "user_k3phmbkf";
const MAX_DURATION_MS = 15 * 60 * 1000;
const MAX_EVENTS = 10;
const MAX_RECORDS = 120;
const RECORD_BUDGET_BYTES = 512;
const MAX_BUFFER_BYTES = MAX_RECORDS * RECORD_BUDGET_BYTES;
const FINAL_READ_WINDOW_MS = 60 * 1000;

const STAGES = new Set([
  "ingress", "socket_guard", "session_workspace", "group_resolution",
  "profile_selection", "card_scope", "rule_evaluation", "exemption",
  "bot_admin", "delete_attempt", "delete_result", "handler_result"
]);

const CODES = new Set([
  "received", "socket_current", "socket_stale", "resolved", "not_resolved",
  "profile_selected", "profile_inactive", "session_incorrect", "card_inactive",
  "group_unauthorized", "profile_ambiguous", "plan_blocked", "transport_blocked",
  "handler_called", "handler_unavailable", "claim_exists", "rule_match",
  "no_rule_match", "sender_exempt", "sender_not_exempt", "metadata_unavailable",
  "bot_admin", "bot_not_admin", "delete_started", "delete_succeeded",
  "delete_failed", "handler_returned", "handler_failed", "user_inactive",
  "from_me", "message_key_incomplete", "manager_inactive", "rules_empty",
  "profile_not_resolved", "user_inactive", "manager_dispatch_started",
  "manager_dispatch_completed", "unknown"
]);

const RESULTS = new Set(["ok", "blocked", "unknown", "not_applicable"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactString(value, maxLength = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
}

function createGerenteObservabilityV2({
  validateTarget,
  clock = () => Date.now(),
  monotonicClock = () => Number(process.hrtime.bigint() / 1_000_000n),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  randomBytes = crypto.randomBytes
} = {}) {
  let active = null;
  let finalized = null;

  function wipeFinalized() {
    if (finalized?.cleanupTimer) clearTimer(finalized.cleanupTimer);
    finalized = null;
  }

  function snapshot(run, state = "active") {
    return {
      runId: run.runId,
      state,
      startedAt: run.startedAt,
      expiresAt: run.expiresAt,
      eventCount: run.eventCount,
      recordCount: run.records.length,
      bytesBudgeted: run.bytesBudgeted,
      stopReason: run.stopReason || ""
    };
  }

  function finish(reason) {
    if (!active) return;
    const run = active;
    active = null;
    if (run.expiryTimer) clearTimer(run.expiryTimer);
    if (run.hmacKey) run.hmacKey.fill(0);
    run.target = null;
    run.hmacKey = null;
    run.stopReason = String(reason || "stopped");
    finalized = {
      ...snapshot(run, "finished"),
      records: run.records,
      cleanupTimer: null,
      purgeAtMonotonic: Number(monotonicClock()) + FINAL_READ_WINDOW_MS
    };
    finalized.cleanupTimer = setTimer(() => { wipeFinalized(); }, FINAL_READ_WINDOW_MS);
    finalized.cleanupTimer?.unref?.();
  }

  function expireIfDue() {
    const now = Number(monotonicClock());
    if (active && now >= active.deadlineMonotonic) finish("time_limit");
    if (finalized && now >= finalized.purgeAtMonotonic) wipeFinalized();
  }

  function hmac(run, value) {
    return crypto.createHmac("sha256", run.hmacKey).update(String(value)).digest("hex").slice(0, 16);
  }

  function start(input = {}) {
    expireIfDue();
    if (active) return { ok: false, code: "diagnostic_already_active" };
    if (finalized) return { ok: false, code: "previous_result_pending" };
    if (typeof validateTarget !== "function") return { ok: false, code: "target_validator_unavailable" };

    const allowedKeys = new Set(["workspaceId", "sessionId", "groupId", "durationMs", "maxEvents", "runId"]);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowedKeys.has(key))) {
      return { ok: false, code: "invalid_request" };
    }

    const workspaceId = input.workspaceId;
    const sessionId = input.sessionId;
    const groupId = input.groupId;
    const durationMs = Number(input.durationMs);
    const maxEvents = Number(input.maxEvents);
    const runId = input.runId;
    if (workspaceId !== ALLOWED_WORKSPACE_ID || !exactString(sessionId) || !exactString(groupId) ||
      !groupId.endsWith("@g.us") || !Number.isInteger(durationMs) || durationMs < 1000 || durationMs > MAX_DURATION_MS ||
      !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS || !UUID_V4.test(String(runId || ""))) {
      return { ok: false, code: "invalid_target_or_limits" };
    }

    let targetAllowed = false;
    try { targetAllowed = validateTarget({ workspaceId, sessionId, groupId }) === true; } catch { targetAllowed = false; }
    if (!targetAllowed) return { ok: false, code: "target_not_in_v3_scope" };

    const wallNow = Number(clock());
    const monotonicNow = Number(monotonicClock());
    const run = {
      runId,
      target: { workspaceId, sessionId, groupId },
      hmacKey: randomBytes(32),
      startedAt: new Date(wallNow).toISOString(),
      expiresAt: new Date(wallNow + durationMs).toISOString(),
      deadlineMonotonic: monotonicNow + durationMs,
      maxEvents,
      eventCount: 0,
      records: [],
      bytesBudgeted: 0,
      stopReason: "",
      expiryTimer: null
    };
    run.expiryTimer = setTimer(() => finish("time_limit"), durationMs);
    run.expiryTimer?.unref?.();
    active = run;
    return { ok: true, ...snapshot(run) };
  }

  function beginEvent({ workspaceId, sessionId, groupId, messageId = "" } = {}) {
    expireIfDue();
    const run = active;
    if (!run || !run.target || run.eventCount >= run.maxEvents) {
      if (run && run.eventCount >= run.maxEvents) finish("event_limit");
      return null;
    }
    if (workspaceId !== run.target.workspaceId || sessionId !== run.target.sessionId || groupId !== run.target.groupId) return null;

    run.eventCount += 1;
    const eventKey = exactString(messageId, 512) ? messageId : `${run.runId}:${run.eventCount}`;
    const identity = {
      eventHash: hmac(run, eventKey),
      workspaceHash: hmac(run, workspaceId),
      sessionHash: hmac(run, sessionId),
      groupHash: hmac(run, groupId)
    };

    return (stage, code, details = {}) => {
      try {
        expireIfDue();
        if (active !== run || !STAGES.has(stage) || !CODES.has(code) || run.records.length >= MAX_RECORDS) {
          if (active === run && run.records.length >= MAX_RECORDS) finish("record_limit");
          return false;
        }
        const result = RESULTS.has(details.result) ? details.result : "unknown";
        const durationMs = Number.isFinite(details.durationMs)
          ? Math.max(0, Math.min(600000, Math.round(details.durationMs)))
          : null;
        const record = {
          timestamp: new Date(Number(clock())).toISOString(),
          runId: run.runId,
          ...identity,
          profileHash: details.profileId ? hmac(run, details.profileId) : "",
          ruleHash: details.ruleId ? hmac(run, details.ruleId) : "",
          stage,
          code,
          result,
          durationMs
        };
        run.records.push(record);
        run.bytesBudgeted += RECORD_BUDGET_BYTES;
        if (run.bytesBudgeted > MAX_BUFFER_BYTES) finish("memory_limit");
        return true;
      } catch {
        return false;
      }
    };
  }

  function isActiveFor({ workspaceId, sessionId } = {}) {
    if (!active) return false;
    expireIfDue();
    return Boolean(active?.target && workspaceId === active.target.workspaceId && sessionId === active.target.sessionId);
  }

  function status(runId = "") {
    expireIfDue();
    if (active && (!runId || runId === active.runId)) return snapshot(active);
    if (finalized && (!runId || runId === finalized.runId)) {
      const { records: _records, cleanupTimer: _cleanupTimer, purgeAtMonotonic: _purgeAt, ...summary } = finalized;
      return summary;
    }
    return { state: "off", runId: "", eventCount: 0, recordCount: 0, bytesBudgeted: 0, stopReason: "" };
  }

  function readEvents(runId = "") {
    expireIfDue();
    const run = active && (!runId || runId === active.runId) ? active : null;
    const completed = finalized && (!runId || runId === finalized.runId) ? finalized : null;
    const records = run?.records || completed?.records || [];
    return records.map(record => ({ ...record }));
  }

  function stop(runId) {
    expireIfDue();
    if (!active || runId !== active.runId) return { ok: false, code: "run_not_active" };
    finish("admin_stop");
    return { ok: true, status: status(runId), events: readEvents(runId) };
  }

  function dispose() {
    if (active?.expiryTimer) clearTimer(active.expiryTimer);
    if (active?.hmacKey) active.hmacKey.fill(0);
    active = null;
    wipeFinalized();
  }

  return Object.freeze({ start, beginEvent, isActiveFor, status, readEvents, stop, dispose });
}

module.exports = {
  ALLOWED_WORKSPACE_ID,
  MAX_DURATION_MS,
  MAX_EVENTS,
  MAX_RECORDS,
  MAX_BUFFER_BYTES,
  STAGES,
  CODES,
  createGerenteObservabilityV2
};
