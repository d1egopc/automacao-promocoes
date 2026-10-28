"use strict";

const crypto = require("node:crypto");

const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_EVENTS = 10;
const RETENTION_MS = 15 * 60 * 1000;
const MAX_STAGES_PER_EVENT = 16;
const SENSOR_DURATION_MS = 24 * 60 * 60 * 1000;
const SENSOR_MAX_EVENTS = 32, SENSOR_MAX_INSPECTED = 10000;
// Reads only bounded user-visible text, never participants/contextInfo/credentials.
function containsMagaluOneLink(message = {}, onTruncated = () => {}) {
  const stack = [{ value: message.message, depth: 0 }];
  let remaining = 128 * 1024, nodes = 0;
  while (stack.length && ++nodes <= 32 && remaining > 0) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (depth > 6) { onTruncated(); continue; }
    for (const key of ["conversation", "text", "caption"]) {
      if (typeof value[key] !== "string") continue;
      const text = value[key].slice(0, remaining); remaining -= text.length;
      for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
        try {
          const url = new URL(match[0]);
          if (!url.username && !url.password && !url.port && url.hostname.toLowerCase() === "magazineluiza.onelink.me") return true;
        } catch { /* malformed text is not a commercial decision */ }
      }
    }
    for (const key of ["message", "extendedTextMessage", "imageMessage", "videoMessage", "documentMessage", "ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage"])
      if (value[key]) stack.push({ value: value[key], depth: depth + 1 });
  }
  if (remaining <= 0 || stack.length) onTruncated();
  return false;
}
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
  "buffer_recovery_suppressed", "usuario_inativo", "workspace_mismatch"
]);

function createRadarIngressObservation({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  secret = crypto.randomBytes(32),
  maxDurationMs = MAX_DURATION_MS,
  maxEvents = MAX_EVENTS,
  retentionMs = RETENTION_MS,
  sensorEnabled = false,
  journal = null,
  onSensorStopped = () => {}
} = {}) {
  let run = null;
  let target = null;
  let timer = null;
  let retentionTimer = null;
  const alertTimers = new Map();
  let sensorStarting = false;
  journal?.onError?.(() => { if (run?.state === "active" && run.sensor) finish("journal_error"); });
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

  function journalEntry(kind, record, stage = {}) {
    if (!run?.sensor) return;
    journal.append({ kind, at: now(), runRef: run.runRef, eventRef: record?.eventHash,
      sessionRef: run.sessionHash, groupRef: run.groupHash, workspaceRef: record?.workspaceHash || run.workspaceHash,
      stage: stage.stage, reason: stage.reason, eventId: stage.eventId,
      decision: stage.decision, engineResult: stage.engineResult,
      upsertType: record?.upsertType, fromMe: record?.fromMe, generation: record?.generation,
      magalu: run.records.length, controls: run.controls, inspected: run.inspected,
      workspaceMismatch: run.counters.workspaceMismatch, classificationTruncated: run.classificationTruncated, expiresAt: run.expiresAt });
  }
  function alertRecord(record, fallback = "stage_timeout") {
    if (record.alerted) return;
    record.alerted = true;
    if (alertTimers.has(record.eventHash)) clearTimer(alertTimers.get(record.eventHash));
    alertTimers.delete(record.eventHash);
    const last = record.stages[record.stages.length - 1];
    journalEntry("alert", record, { ...last, reason: ["rejected", "ignored", "error"].includes(last.decision) ? last.reason :
      (last.stage === "engine_event" ? last.reason : fallback) });
  }

  function finish(reason) {
    if (!run || run.state !== "active") return status();
    run.state = reason === "expired" ? "expired" : "stopped";
    run.stopReason = reason;
    run.finishedAt = now();
    if (run.sensor) {
      for (const record of run.records) alertRecord(record, reason);
      journalEntry("stop", null, { stage: "observation", reason: run.records.length ? reason :
        (run.classificationTruncated ? "coverage_incomplete" : "SEM_AMOSTRA") });
      try { onSensorStopped(); } catch { /* diagnostics only */ }
    }
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
      sampleStatus: run.records.length ? "AMOSTRA_OBSERVADA" : (run.state === "active" ? "AGUARDANDO_AMOSTRA" :
        (run.sensor && run.classificationTruncated ? "COBERTURA_INCOMPLETA" : "SEM_AMOSTRA")),
      events: run.records.length,
      scope: { workspaceHash: run.workspaceHash, sessionHash: run.sessionHash, groupHash: run.groupHash },
      binding: run.binding ? { ...run.binding } : null,
      ...(run.sensor ? { profile: "sensor24h", runRef: run.runRef, controls: run.controls,
        inspected: run.inspected, classificationTruncated: run.classificationTruncated, journal: journal.status() } : {}),
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

  function start({ workspaceId, sessionId, groupId, sock, generation, scopeValidated = false, listenerRegistered = false, sensor = false } = {}) {
    expireIfNeeded();
    if (run?.state === "active") return { ok: false, reason: "observation_already_active" };
    if (run && now() - run.finishedAt < retentionMs) return { ok: false, reason: "report_retention_active" };
    if (sensor && ((typeof sensorEnabled === "function" ? sensorEnabled() : sensorEnabled) !== true || !journal?.status().available)) return { ok: false, reason: "sensor_disabled_or_journal_unavailable" };
    if (scopeValidated !== true || listenerRegistered !== true || !workspaceId || !sessionId || !groupId || !sock ||
        !Number.isFinite(Number(generation)) || Number(generation) < 1) {
      return { ok: false, reason: "target_scope_not_validated" };
    }

    const startedAt = now();
    const durationMs = sensor ? SENSOR_DURATION_MS : Math.min(MAX_DURATION_MS, Math.max(1, Number(maxDurationMs) || MAX_DURATION_MS));
    const eventLimit = sensor ? SENSOR_MAX_EVENTS : Math.min(MAX_EVENTS, Math.max(1, Number(maxEvents) || MAX_EVENTS));
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
      sensor, runRef: crypto.randomBytes(8).toString("hex"), controls: 0, inspected: 0, classificationTruncated: 0,
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
    journalEntry("start", null, { stage: "observation" });
    return { ok: true, state: "active", startedAt, expiresAt: run.expiresAt, maxEvents: eventLimit,
      ...(sensor ? { profile: "sensor24h", runRef: run.runRef, maxInspected: SENSOR_MAX_INSPECTED } : {}), scope: status().scope };
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
      (run.sensor || String(workspaceId || "") === target.workspaceId) &&
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
      if ((!run.sensor && String(workspaceId || "") !== target.workspaceId) || sock !== target.sock || emitter !== target.emitter || current !== true || !generationMatch) continue;
      const groupId = String(message?.key?.remoteJid || "").trim();
      if (groupId !== target.groupId) {
        run.counters.nonTargetMessages += 1;
        if (groupId.endsWith("@g.us")) run.counters.nonTargetGroups += 1;
        else run.counters.nonGroupMessages += 1;
        if (String(message?.key?.remoteJidAlt || "").trim() === target.groupId) run.counters.alternateTargetCandidates += 1;
        continue;
      }
      if (!run.accepting) continue;
      if (run.sensor) {
        if (run.inspected >= SENSOR_MAX_INSPECTED) { finish("scan_limit"); break; }
        run.inspected += 1;
        if (!containsMagaluOneLink(message, () => { run.classificationTruncated += 1; })) {
          run.controls += 1;
          if (run.inspected >= SENSOR_MAX_INSPECTED) { finish("scan_limit"); break; }
          continue;
        }
      }

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
        stages: [{ stage: "upsert_callback", decision: "received", reason: String(workspaceId || "") !== target.workspaceId ? "workspace_mismatch" : "", urlCount: null, marketplace: "unknown" }]
      };
      run.records.push(record);
      run.recordByEventHash.set(eventHash, record);
      run.counters.targetMessages += 1;
      if (run.sensor) {
        journalEntry("stage", record, record.stages[0]);
        const deadline = setTimer(() => {
          alertRecord(record);
          if (!run.accepting && run.records.every(item => item.alerted)) finish("event_limit");
        }, 30000);
        deadline?.unref?.(); alertTimers.set(eventHash, deadline);
      }
      if (run.records.length >= run.maxEvents) run.accepting = false;
      if (run.sensor && run.inspected >= SENSOR_MAX_INSPECTED) { finish("scan_limit"); break; }
    }
    return null;
  }

  function recordStage({ workspaceId, sessionId, sock, message, stage, decision, reason, urls, marketplace, generation, engineExpected, engineResult, eventId } = {}) {
    expireIfNeeded();
    if (!run || !STAGES.has(stage)) return false;

    const eventHash = eventFingerprint(message);
    const record = run.recordByEventHash.get(eventHash);
    if (!record) return false;
    if (hash("workspace", workspaceId) !== (run.sensor ? record.workspaceHash : run.workspaceHash) || hash("session", sessionId) !== run.sessionHash ||
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
    if (run.sensor) {
      const last = record.stages[record.stages.length - 1];
      journalEntry("stage", record, last);
      if (stage === "engine_event" || stage === "listener_gate" ||
          (stage === "radar_decision" && engineExpected !== true)) alertRecord(record);
      if (!run.accepting && run.state === "active" && run.records.every(item => item.alerted)) finish("event_limit");
    }

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
    startSensor: async options => {
      if ((typeof sensorEnabled === "function" ? sensorEnabled() : sensorEnabled) !== true || !journal) return { ok: false, reason: "sensor_flag_off" };
      if (run || sensorStarting) return { ok: false, reason: "sensor_already_used_or_observation_exists" };
      sensorStarting = true;
      try {
        if (!await journal.open()) return { ok: false, reason: "sensor_journal_unavailable" };
        const result = start({ ...options, sensor: true });
        if (result.ok) await journal.flush?.();
        if (result.ok && journal.status().failed) return { ok: false, reason: "sensor_journal_failed" };
        if (!result.ok) await journal.close();
        return result;
      } finally { sensorStarting = false; }
    },
    archive: async () => ({ observation: status(), ...(journal ? await journal.read() : { state: "sensor_flag_off", records: [] }) }),
    status,
    stop,
    isActiveFor,
    observeWrapper,
    observeUpsert,
    recordStage,
    limits: () => ({ maxDurationMs: MAX_DURATION_MS, maxEvents: MAX_EVENTS, retentionMs: RETENTION_MS })
  };
}

module.exports = { createRadarIngressObservation, containsMagaluOneLink, MAX_DURATION_MS, MAX_EVENTS, RETENTION_MS,
  SENSOR_DURATION_MS, SENSOR_MAX_EVENTS, SENSOR_MAX_INSPECTED };
