"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { constants } = require("node:fs");
const { sanitizarTraceRef } = require("../telemetria/trace-ref");

const PREFIX = "radar-whatsapp-ingress-slot-";
const SLOT_COUNT = 4;
const MAX_BYTES = 2 * 1024 * 1024;
const SLOT_BYTES = MAX_BYTES / SLOT_COUNT;
const MAX_QUEUE = 1024;
const MAX_RECORD_BYTES = 2048;
const RETENTION_MS = 72 * 60 * 60 * 1000;
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, slot) => `${PREFIX}${slot}.jsonl`);
const KINDS = new Set(["stage", "counter", "buffer", "bootstrap", "listener"]);
const STAGES = new Set([
  "ws_frame", "message_node", "emit_attempt", "emit_completed", "buffered",
  "listener_registered", "listener_removed", "listener_gate", "wrapper", "callback", "listener",
  "radar", "radar_result", "mensageiro_gerente", "mensageiro_comando",
  "mensageiro_atendimento", "engine", "offline_batch", "offline_attribute",
  "offline_task", "sync_state", "buffer_state", "counter_snapshot"
]);
const REASONS = new Set([
  "from_me", "not_group", "accepted", "ignored", "rejected", "other", "consumer_error", "engine_error",
  "socket_stale", "user_inactive", "buffer_recovery_suppressed", "wrong_upsert_type", "workspace_mismatch",
  "radar_monitoramento_inativo", "fora_do_horario_monitoramento", "sessao_whatsapp_nao_monitorada",
  "grupo_whatsapp_nao_monitorado", "whatsapp_upsert_historico", "whatsapp_timestamp_ausente",
  "radar_ativacao_invalida", "whatsapp_mensagem_anterior_ativacao", "whatsapp_mensagem_anterior_janela",
  "remotejid_ausente", "origem_tipo_invalida", "grupo_ou_chat_ausente", "captura_sem_tempo_factual",
  "tamanho_maximo_atingido", "usuario_inativo", "offline_completion", "history_sync_skipped",
  "app_state_sync_complete", "history_sync_disabled", "initial_sync_timeout", "deferred_work_complete",
  "servcel_initial_timeout_recovery", "unspecified", "unknown"
]);
const UPDATES = new Set(["notify", "append", "replace", "read", "other"]);
const OFFLINE_ATTRIBUTES = new Set(["absent", "0", "1", "other"]);
const SYNC_STATES = new Set(["Connecting", "AwaitingInitialSync", "Syncing", "Online"]);
const OPERATIONS = new Set([
  "preview_received", "request_started", "request_sent", "request_send_failed", "completion_signal",
  "connection_failure", "cb_offline_received", "queued", "started", "completed", "failed", "buffer_requested",
  "flush_requested", "flush_completed", "work_started", "work_completed", "socket_current",
  "socket_replaced", "listener_registered", "listener_removed"
]);

function sanitizeRecord(value = {}) {
  if (!value || typeof value !== "object" || !KINDS.has(value.kind) || !STAGES.has(value.stage)) return null;
  const out = { kind: value.kind, at: Number.isSafeInteger(value.at) && value.at > 0 ? value.at : Date.now(), stage: value.stage };
  for (const key of ["workspaceRef", "sessionRef", "groupRef", "eventRef"])
    if (/^[a-f0-9]{16}$/.test(value[key] || "")) out[key] = value[key];
  const traceRef = sanitizarTraceRef(value.traceRef);
  if (traceRef) out.traceRef = traceRef;
  if (Number.isSafeInteger(value.generation) && value.generation > 0) out.generation = value.generation;
  if (UPDATES.has(value.upsertType)) out.upsertType = value.upsertType;
  if (typeof value.fromMe === "boolean") out.fromMe = value.fromMe;
  if (REASONS.has(value.reason)) out.reason = value.reason;
  if (["received", "accepted", "ignored", "rejected", "error", "pending", "unknown"].includes(value.decision)) out.decision = value.decision;
  if (Number.isSafeInteger(value.count) && value.count >= 0) out.count = Math.min(value.count, 1000000);
  for (const key of ["buffering", "explicitHold"])
    if (typeof value[key] === "boolean") out[key] = value[key];
  if (Number.isSafeInteger(value.pendingWorks) && value.pendingWorks >= 0) out.pendingWorks = Math.min(value.pendingWorks, 1000000);
  if (OFFLINE_ATTRIBUTES.has(value.offlineAttribute)) out.offlineAttribute = value.offlineAttribute;
  if (SYNC_STATES.has(value.syncState)) out.syncState = value.syncState;
  if (OPERATIONS.has(value.operation)) out.operation = value.operation;
  return out;
}

function createIngressObservationJournal({ directory, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, schedule = setImmediate } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("journal_directory_required");
  let handle = null, currentSlot = -1, queue = [], draining = false, failed = false, closed = false;
  let dropped = 0, rotatedLines = 0, rotatedSlots = 0, lines = 0, totalBytes = 0, retentionTimer = null, pending = Promise.resolve(), initialized = false, initializing = null;
  const slots = new Map();
  const filename = slot => path.join(directory, SLOTS[slot]);
  const noFollow = constants.O_NOFOLLOW || 0;

  async function inspectDirectory() {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("journal_directory_invalid");
    if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("journal_directory_owner_invalid");
    if (process.platform !== "win32" && await fs.realpath(directory) !== path.resolve(directory)) throw new Error("journal_directory_symlinked");
  }
  async function readSlot(slot) {
    const file = filename(slot), before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > SLOT_BYTES || process.platform !== "win32" && (before.mode & 0o077) !== 0) throw new Error("journal_slot_invalid");
    const reader = await fs.open(file, constants.O_RDONLY | noFollow);
    try {
      const stat = await reader.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > SLOT_BYTES || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("journal_slot_invalid");
      const text = await reader.readFile("utf8");
      if (Buffer.byteLength(text) !== stat.size || (text && !text.endsWith("\n"))) throw new Error("journal_slot_truncated");
      const rows = text.split("\n").filter(Boolean);
      const records = rows.map(line => sanitizeRecord(JSON.parse(line)));
      if (records.some(record => !record)) throw new Error("journal_record_invalid");
      return { slot, filename: file, size: stat.size, mtimeMs: stat.mtimeMs, lines: records.length, firstAt: records[0]?.at || 0 };
    } finally { await reader.close(); }
  }
  async function scanSlots() {
    await inspectDirectory();
    const found = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      try { found.push(await readSlot(slot)); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (found.reduce((sum, item) => sum + item.size, 0) > MAX_BYTES) throw new Error("journal_limit_invalid");
    return found;
  }
  async function removeSlot(slot) {
    const item = slots.get(slot);
    if (!item) return;
    if (handle && currentSlot === slot) { const old = handle; handle = null; currentSlot = -1; await old.close(); }
    await fs.unlink(item.filename);
    totalBytes = Math.max(0, totalBytes - item.size);
    lines = Math.max(0, lines - item.lines);
    slots.delete(slot);
  }
  function scheduleRetention() {
    if (retentionTimer) clearTimer(retentionTimer);
    retentionTimer = null;
    if (!slots.size || closed || failed) return;
    const deadlines = [...slots.values()].filter(item => item.firstAt > 0).map(item => item.firstAt + RETENTION_MS);
    if (!deadlines.length) return;
    const nextAt = Math.min(...deadlines);
    retentionTimer = setTimer(() => {
      retentionTimer = null;
      expireOldSlots().then(() => scheduleRetention()).catch(() => { failed = true; });
    }, Math.max(1000, nextAt - now()));
    retentionTimer?.unref?.();
  }
  async function expireOldSlots() {
    for (const [slot, item] of [...slots]) if (item.firstAt > 0 && now() - item.firstAt >= RETENTION_MS) await removeSlot(slot);
  }
  async function createSlot(slot) {
    await inspectDirectory();
    const file = filename(slot);
    try { await fs.lstat(file); return false; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const opened = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_WRONLY | noFollow, 0o600);
    const stat = await opened.stat();
    if (!stat.isFile() || stat.nlink !== 1 || process.platform !== "win32" && (stat.mode & 0o077) !== 0) { await opened.close(); await fs.unlink(file).catch(() => {}); throw new Error("journal_slot_invalid"); }
    if (handle) { const old = handle; handle = null; await old.close(); }
    handle = opened; currentSlot = slot;
    slots.set(slot, { slot, filename: file, size: 0, mtimeMs: now(), lines: 0, firstAt: 0 });
    return true;
  }
  async function openExisting(item) {
    const opened = await fs.open(item.filename, constants.O_APPEND | constants.O_WRONLY | noFollow);
    const stat = await opened.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== item.size || stat.size > SLOT_BYTES || process.platform !== "win32" && (stat.mode & 0o077) !== 0) { await opened.close(); throw new Error("journal_slot_changed"); }
    if (handle) { const old = handle; handle = null; await old.close(); }
    handle = opened; currentSlot = item.slot;
  }
  async function chooseCurrent() {
    await expireOldSlots();
    if (handle) return true;
    const preferred = [...slots.values()].filter(item => item.size < SLOT_BYTES).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (preferred) { await openExisting(preferred); return true; }
    for (let slot = 0; slot < SLOT_COUNT; slot++) if (!slots.has(slot) && await createSlot(slot)) return true;
    return false;
  }
  async function initialize() {
    if (initialized) return;
    if (initializing) return initializing;
    initializing = (async () => {
      const existing = await scanSlots();
      for (const item of existing) slots.set(item.slot, item);
      totalBytes = existing.reduce((sum, item) => sum + item.size, 0);
      lines = existing.reduce((sum, item) => sum + item.lines, 0);
      await expireOldSlots();
      initialized = true;
      await chooseCurrent();
      scheduleRetention();
    })().finally(() => { initializing = null; });
    return initializing;
  }
  async function rotate() {
    await expireOldSlots();
    for (let slot = 0; slot < SLOT_COUNT; slot++) if (!slots.has(slot)) return createSlot(slot);
    const oldest = [...slots.values()].sort((a, b) => (a.firstAt || 0) - (b.firstAt || 0) || a.mtimeMs - b.mtimeMs)[0];
    if (!oldest) return false;
    rotatedLines += oldest.lines;
    rotatedSlots++;
    await removeSlot(oldest.slot);
    return createSlot(oldest.slot);
  }
  async function drain() {
    try {
      if (!initialized) await initialize();
      while (queue.length && !failed && !closed) {
        if (!await chooseCurrent()) { queue.shift(); dropped++; continue; }
        const item = queue[0], line = JSON.stringify(item) + "\n", size = Buffer.byteLength(line);
        if (size > MAX_RECORD_BYTES) { queue.shift(); dropped++; continue; }
        const slot = slots.get(currentSlot);
        if (!slot || slot.size + size > SLOT_BYTES) {
          if (!await rotate()) { queue.shift(); dropped++; continue; }
          continue;
        }
        const batch = [], batchItems = [];
        let batchBytes = 0;
        while (queue.length && batch.length < 128) {
          const next = queue[0], encoded = JSON.stringify(next) + "\n", nextBytes = Buffer.byteLength(encoded);
          if (nextBytes > MAX_RECORD_BYTES) { queue.shift(); dropped++; continue; }
          if (slot.size + batchBytes + nextBytes > SLOT_BYTES) break;
          queue.shift(); batch.push(encoded); batchItems.push(next); batchBytes += nextBytes;
        }
        if (!batch.length) continue;
        await handle.writeFile(batch.join(""), "utf8");
        await handle.sync();
        slot.size += batchBytes; slot.lines += batch.length; slot.mtimeMs = now();
        if (!slot.firstAt) slot.firstAt = batchItems[0].at;
        totalBytes += batchBytes; lines += batch.length;
        scheduleRetention();
      }
    } catch { failed = true; queue = []; }
    finally { draining = false; }
  }
  function append(value) {
    if (failed || closed) return false;
    const item = sanitizeRecord(value);
    if (!item || queue.length >= MAX_QUEUE) { dropped++; return false; }
    queue.push(item);
    if (!draining) {
      draining = true;
      pending = new Promise(resolve => schedule(() => drain().finally(resolve)));
    }
    return true;
  }
  async function open() {
    if (failed || closed) return false;
    try { await initialize(); return Boolean(handle) || slots.size < SLOT_COUNT; }
    catch { failed = true; return false; }
  }
  async function read(limit = 1000) {
    await pending;
    const found = await scanSlots();
    const cutoff = now() - RETENTION_MS, records = [];
    for (const item of found.sort((a, b) => a.firstAt - b.firstAt)) {
      const content = await fs.open(item.filename, constants.O_RDONLY | noFollow);
      try {
        const stat = await content.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > SLOT_BYTES || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("journal_slot_invalid");
        const text = await content.readFile("utf8");
        if (Buffer.byteLength(text) !== stat.size || (text && !text.endsWith("\n"))) throw new Error("journal_slot_truncated");
        for (const line of text.split("\n").filter(Boolean)) {
          const record = sanitizeRecord(JSON.parse(line));
          if (record && record.at >= cutoff) records.push(record);
        }
      } finally { await content.close(); }
    }
    records.sort((a, b) => a.at - b.at);
    return { state: "available", records: records.slice(-Math.max(1, Math.min(5000, limit))), dropped, rotatedLines, rotatedSlots,
      bytes: found.reduce((sum, item) => sum + item.size, 0), maxBytes: MAX_BYTES, retentionMs: RETENTION_MS };
  }
  async function close() {
    closed = true;
    if (retentionTimer) clearTimer(retentionTimer);
    retentionTimer = null;
    await pending;
    if (handle) { const old = handle; handle = null; currentSlot = -1; await old.close(); }
  }
  return Object.freeze({ open, append, read, close, flush: () => pending,
    status: () => ({ available: Boolean(handle) && !failed && !closed, failed, bytes: totalBytes, lines, queued: queue.length, dropped, rotatedLines, rotatedSlots,
      maxBytes: MAX_BYTES, retentionMs: RETENTION_MS, continuous: true }) });
}

module.exports = { createIngressObservationJournal, sanitizeRecord, MAX_BYTES, SLOT_BYTES, SLOT_COUNT, MAX_QUEUE, RETENTION_MS };
