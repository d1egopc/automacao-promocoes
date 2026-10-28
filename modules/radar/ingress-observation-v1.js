"use strict";

const crypto = require("node:crypto");

const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_EVENTS = 10;
const RETENTION_MS = 15 * 60 * 1000;
const MAX_STAGES_PER_EVENT = 16;
const STAGES = new Set([
  "upsert_callback",
  "listener_gate",
  "radar_gate",
  "url_extraction",
  "marketplace_classification",
  "radar_decision",
  "engine_event"
]);
const MARKETPLACES = new Set([
  "amazon", "aliexpress", "awin", "kabum", "magalu", "mercadolivre",
  "shopee", "unknown"
]);
const REASONS = new Set([
  "from_me", "not_group", "group_not_monitored", "stale_message",
  "wrong_upsert_type", "no_links", "marketplace_unidentified",
  "duplicate", "accepted", "ignored", "rejected", "consumer_error",
  "engine_error", "engine_not_awaited", "other", "radar_monitoramento_inativo",
  "fora_do_horario_monitoramento", "sessao_whatsapp_nao_monitorada",
  "grupo_whatsapp_nao_monitorado", "whatsapp_upsert_historico",
  "whatsapp_timestamp_ausente", "radar_ativacao_invalida",
  "whatsapp_mensagem_anterior_ativacao", "whatsapp_mensagem_anterior_janela",
  "remotejid_ausente", "origem_tipo_invalida", "grupo_ou_chat_ausente",
  "mensagem_nao_monitoravel", "captura_sem_tempo_factual", "tamanho_maximo_atingido",
  "buffer_recovery_suppressed", "usuario_inativo"
]);

function createRadarIngressObservation({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  secret = crypto.randomBytes(32),
  maxDurationMs = MAX_DURATION_MS,
  maxEvents = MAX_EVENTS,
  retentionMs = RETENTION_MS
} = {}) {
  let run = null;
  let target = null;
  let timer = null;
  let retentionTimer = null;
  const objectIds = new WeakMap();
  let nextObjectId = 0;

  const hash = (kind, value) => crypto.createHmac("sha256", secret)
    .update(`${kind}:${String(value || "")}`)
    .digest("hex")
    .slice(0, 16);

  function opaqueObjectId(kind, value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return "";
    if (!objectIds.has(value)) objectIds.set(value, `${kind}_${++nextObjectId}`);
    return hash(kind, objectIds.get(value));
  }

  function validBoundedValue(value, allowed) {
    const normalized = String(value || "").trim().toLowerCase();
    return allowed.has(normalized) ? normalized : "other";
  }

  function eventFingerprint(message = {}) {
    const directId = String(message?.key?.id || "").trim();
    if (directId) return hash("message", directId);
    const key = message?.key || {};
    const stamp = String(message?.messageTimestamp || message?.timestamp || "");
    const types = Object.keys(message?.message || {}).sort().join(",");
    return hash("message-fallback", `${key.remoteJid || ""}:${stamp}:${types}:${key.fromMe === true}`);
  }

  function clearTarget() {
    target = null;
  }

  function finish(reason) {
    if (!run || run.state !== "active") return status();
    run.state = reason === "expired" ? "expired" : "stopped";
    run.stopReason = reason;
    run.finishedAt = now();
    if (timer) clearTimer(timer);
    timer = null;
    clearTarget();
    const finishedAt = run.finishedAt;
    retentionTimer = setTimer(() => {
      if (run?.finishedAt === finishedAt && run.state !== "active") {
        run = null;
        clearTarget();
      }
      retentionTimer = null;
    }, retentionMs);
    retentionTimer?.unref?.();
    return status();
  }

  function expireIfNeeded() {
    if (run?.state === "active" && now() >= run.expiresAt) finish("expired");
    if (run && run.state !== "active" && now() - run.finishedAt >= retentionMs) {
      run = null;
      clearTarget();
      if (retentionTimer) clearTimer(retentionTimer);
      retentionTimer = null;
    }
  }

  function status() {
    expireIfNeeded();
    if (!run) return { state: "off", events: 0, records: [], counters: {} };
    return {
      state: run.state,
      startedAt: run.startedAt,
      expiresAt: run.expiresAt,
      finishedAt: run.finishedAt || null,
      stopReason: run.stopReason || "",
      sampleStatus: run.records.length ? "AMOSTRA_OBSERVADA" : (run.state === "active" ? "AGUARDANDO_AMOSTRA" : "SEM_AMOSTRA"),
      events: run.records.length,
      scope: { workspaceHash: run.workspaceHash, sessionHash: run.sessionHash, groupHash: run.groupHash },
      binding: run.binding ? { ...run.binding } : null,
      counters: { ...run.counters },
      records: run.records.map(record => ({
        eventHash: record.eventHash,
        groupHash: record.groupHash,
        socketHash: record.socketHash,
        emitterHash: record.emitterHash,
        generation: record.generation,
        observedAt: record.observedAt,
        workspaceHash: record.workspaceHash,
        fromMe: record.fromMe,
        upsertType: record.upsertType,
        generationMatch: record.generationMatch,
        stages: record.stages.map(stage => ({ ...stage }))
      }))
    };
  }

  function start({ workspaceId, sessionId, groupId, sock, generation, scopeValidated = false, listenerRegistered = false } = {}) {
    expireIfNeeded();
    if (run?.state === "active") return { ok: false, reason: "observation_already_active" };
    if (run && now() - run.finishedAt < retentionMs) return { ok: false, reason: "report_retention_active" };
    if (scopeValidated !== true || listenerRegistered !== true || !workspaceId || !sessionId || !groupId || !sock ||
        !Number.isFinite(Number(generation)) || Number(generation) < 1) {
      return { ok: false, reason: "target_scope_not_validated" };
    }

    const startedAt = now();
    const durationMs = Math.min(MAX_DURATION_MS, Math.max(1, Number(maxDurationMs) || MAX_DURATION_MS));
    const eventLimit = Math.min(MAX_EVENTS, Math.max(1, Number(maxEvents) || MAX_EVENTS));
    const scope = {
      workspaceId: String(workspaceId),
      sessionId: String(sessionId),
      groupId: String(groupId),
      sock,
      emitter: sock.ev,
      generation: Number(generation)
    };
    target = scope;
    run = {
      state: "active",
      startedAt,
      expiresAt: startedAt + durationMs,
      finishedAt: 0,
      stopReason: "",
      workspaceHash: hash("workspace", scope.workspaceId),
      sessionHash: hash("session", scope.sessionId),
      groupHash: hash("group", scope.groupId),
      binding: {
        socketHash: opaqueObjectId("socket", sock),
        emitterHash: opaqueObjectId("emitter", sock.ev),
        generation: scope.generation,
        listenerRegistered: true,
        attachmentVerified: null
      },
      maxEvents: eventLimit,
      accepting: true,
      counters: {
        wrapperCalls: 0,
        callbackCalls: 0,
        targetMessages: 0,
        nonTargetMessages: 0,
        nonTargetGroups: 0,
        nonGroupMessages: 0,
        alternateTargetCandidates: 0,
        staleSocket: 0,
        staleGeneration: 0,
        workspaceMismatch: 0,
        invalidBatch: 0,
        batchesEmpty: 0,
        observerErrors: 0
      },
      records: [],
      recordByEventHash: new Map()
    };
    timer = setTimer(() => finish("expired"), durationMs);
    timer?.unref?.();
    return { ok: true, state: "active", expiresAt: run.expiresAt, maxEvents: eventLimit, scope: status().scope };
  }

  function observeWrapper({ sessionId, sock, emitter, emitterCurrent, callbackCurrent, generation } = {}) {
    expireIfNeeded();
    if (!target || run?.state !== "active" || String(sessionId || "") !== target.sessionId) return false;
    run.counters.wrapperCalls += 1;
    const socketMatch = sock === target.sock;
    const emitterMatch = emitter === target.emitter;
    if (!socketMatch || !emitterMatch || emitterCurrent !== true || callbackCurrent !== true) run.counters.staleSocket += 1;
    if (Number(generation) !== target.generation) run.counters.staleGeneration += 1;
    run.binding = {
      socketHash: opaqueObjectId("socket", sock),
      emitterHash: opaqueObjectId("emitter", emitter),
      generation: Number(generation) || 0,
      socketMatch,
      emitterMatch,
      emitterCurrent: emitterCurrent === true,
      callbackCurrent: callbackCurrent === true,
      attachmentVerified: null
    };
    return true;
  }

  function isActiveFor({ workspaceId, sessionId, groupId, sock } = {}) {
    if (!target || run?.state !== "active") return false;
    expireIfNeeded();
    return Boolean(target && run?.state === "active" &&
      String(workspaceId || "") === target.workspaceId &&
      String(sessionId || "") === target.sessionId &&
      String(groupId || "").trim() === target.groupId &&
      sock === target.sock);
  }

  function observeUpsert({ workspaceId, sessionId, sock, emitter, current, generation, messages, type } = {}) {
    expireIfNeeded();
    if (!target || run?.state !== "active" || String(sessionId || "") !== target.sessionId) return null;
    run.counters.callbackCalls += 1;
    if (String(workspaceId || "") !== target.workspaceId) run.counters.workspaceMismatch += 1;
    const socketMatch = sock === target.sock;
    const emitterMatch = emitter === target.emitter;
    if (!socketMatch || !emitterMatch || current !== true) run.counters.staleSocket += 1;
    const generationMatch = Number(generation) === target.generation;
    if (!generationMatch) run.counters.staleGeneration += 1;
    run.binding = {
      socketHash: opaqueObjectId("socket", sock),
      emitterHash: opaqueObjectId("emitter", emitter),
      generation: Number(generation) || 0,
      socketMatch,
      emitterMatch,
      current: current === true,
      capturedWorkspaceHash: hash("workspace", workspaceId),
      generationMatch,
      attachmentVerified: null
    };

    if (!Array.isArray(messages)) {
      run.counters.invalidBatch += 1;
      return null;
    }
    if (!messages.length) {
      run.counters.batchesEmpty += 1;
      return null;
    }

    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      if (String(workspaceId || "") !== target.workspaceId || sock !== target.sock || current !== true || !generationMatch) continue;
      const groupId = String(message?.key?.remoteJid || "").trim();
      if (groupId !== target.groupId) {
        run.counters.nonTargetMessages += 1;
        if (groupId.endsWith("@g.us")) run.counters.nonTargetGroups += 1;
        else run.counters.nonGroupMessages += 1;
        if (String(message?.key?.remoteJidAlt || "").trim() === target.groupId) run.counters.alternateTargetCandidates += 1;
        continue;
      }
      if (!run.accepting) continue;

      const eventHash = eventFingerprint(message);
      if (run.recordByEventHash.has(eventHash)) continue;
      const record = {
        eventHash,
        groupHash: run.groupHash,
        socketHash: opaqueObjectId("socket", sock),
        emitterHash: opaqueObjectId("emitter", emitter),
        generation: Number(generation) || 0,
        observedAt: now(),
        workspaceHash: hash("workspace", workspaceId),
        fromMe: typeof message?.key?.fromMe === "boolean" ? message.key.fromMe : null,
        upsertType: ["notify", "append", "replace", "read", "issue"].includes(String(type || "").toLowerCase())
          ? String(type).toLowerCase()
          : "other",
        generationMatch,
        stages: [{ stage: "upsert_callback", decision: "received", reason: "", urlCount: null, marketplace: "unknown" }]
      };
      run.records.push(record);
      run.recordByEventHash.set(eventHash, record);
      run.counters.targetMessages += 1;
      if (run.records.length >= run.maxEvents) run.accepting = false;
    }
    return null;
  }

  function recordStage({ workspaceId, sessionId, sock, message, stage, decision, reason, urls, marketplace, generation, engineExpected, engineResult, eventId } = {}) {
    expireIfNeeded();
    if (!run || !STAGES.has(stage)) return false;

    const eventHash = eventFingerprint(message);
    const record = run.recordByEventHash.get(eventHash);
    if (!record) return false;
    if (hash("workspace", workspaceId) !== run.workspaceHash || hash("session", sessionId) !== run.sessionHash ||
        hash("group", String(message?.key?.remoteJid || "").trim()) !== record.groupHash ||
        opaqueObjectId("socket", sock) !== record.socketHash) return false;
    if (record.stages.length >= MAX_STAGES_PER_EVENT) return false;
    const safeUrls = Array.isArray(urls) ? urls.slice(0, 10).filter(value => typeof value === "string" && value.trim()) : [];
    record.stages.push({
      stage,
      observedAt: now(),
      eventId: stage === "engine_event" && /^[1-9]\d{0,19}$/.test(String(eventId || "")) ? String(eventId) : undefined,
      decision: ["received", "accepted", "ignored", "rejected", "error", "resolved", "pending", "duplicate"].includes(decision) ? decision : "unknown",
      reason: validBoundedValue(reason, REASONS),
      urlCount: Array.isArray(urls) ? Math.min(urls.length, 10) : null,
      urlHashes: safeUrls.map(url => hash("url", url)).slice(0, 10),
      marketplace: validBoundedValue(marketplace, MARKETPLACES),
      generationMatch: Number(generation) === record.generation,
      engineExpected: stage === "radar_decision" ? engineExpected === true : undefined,
      engineResult: ["created", "duplicate", "failed", "not_awaited", "unknown"].includes(engineResult) ? engineResult : ""
    });

    const eventoConcluido = item => {
      const radarDecision = item.stages.find(entry => entry.stage === "radar_decision");
      return Boolean(radarDecision) && (radarDecision.engineExpected !== true ||
        item.stages.some(entry => entry.stage === "engine_event"));
    };
    if (!run.accepting && run.records.every(eventoConcluido)) {
      finish("event_limit");
    }
    return true;
  }

  function stop(reason = "manual") {
    expireIfNeeded();
    return finish(reason === "manual" ? "manual" : "stopped");
  }

  return {
    start,
    status,
    stop,
    isActiveFor,
    observeWrapper,
    observeUpsert,
    recordStage,
    limits: () => ({ maxDurationMs: MAX_DURATION_MS, maxEvents: MAX_EVENTS, retentionMs: RETENTION_MS })
  };
}

module.exports = { createRadarIngressObservation, MAX_DURATION_MS, MAX_EVENTS, RETENTION_MS };
