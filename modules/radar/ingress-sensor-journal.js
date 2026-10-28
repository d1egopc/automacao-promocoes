"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { constants } = require("node:fs");
const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024, MAX_LINES = 600, MAX_QUEUE = 600;
const KINDS = new Set(["start", "stage", "alert", "stop"]);
const STAGES = new Set(["upsert_callback", "listener_gate", "radar_gate", "url_extraction", "marketplace_classification", "radar_decision", "engine_event", "observation"]);
const REASONS = new Set(["from_me", "not_group", "group_not_monitored", "stale_message", "wrong_upsert_type", "no_links", "marketplace_unidentified", "duplicate", "accepted", "ignored", "rejected", "consumer_error", "engine_error", "engine_not_awaited", "other", "radar_monitoramento_inativo", "fora_do_horario_monitoramento", "sessao_whatsapp_nao_monitorada", "grupo_whatsapp_nao_monitorado", "whatsapp_upsert_historico", "whatsapp_timestamp_ausente", "radar_ativacao_invalida", "whatsapp_mensagem_anterior_ativacao", "whatsapp_mensagem_anterior_janela", "remotejid_ausente", "origem_tipo_invalida", "grupo_ou_chat_ausente", "mensagem_nao_monitoravel", "captura_sem_tempo_factual", "tamanho_maximo_atingido", "buffer_recovery_suppressed", "usuario_inativo", "stage_timeout", "expired", "event_limit", "scan_limit", "manual", "journal_error", "SEM_AMOSTRA"]);
function sanitize(value = {}) {
  if (!KINDS.has(value.kind)) return null;
  const out = { kind: value.kind, at: Number.isSafeInteger(value.at) ? value.at : 0 };
  for (const key of ["runRef", "eventRef", "sessionRef", "groupRef", "workspaceRef"])
    if (/^[a-f0-9]{16}$/.test(value[key] || "")) out[key] = value[key];
  if (STAGES.has(value.stage)) out.stage = value.stage;
  if (["received", "accepted", "ignored", "rejected", "error", "resolved", "pending", "duplicate", "unknown"].includes(value.decision)) out.decision = value.decision;
  if (["created", "duplicate", "failed", "not_awaited", "unknown"].includes(value.engineResult)) out.engineResult = value.engineResult;
  if (["notify", "append", "replace", "read", "issue", "other"].includes(value.upsertType)) out.upsertType = value.upsertType;
  if (typeof value.fromMe === "boolean") out.fromMe = value.fromMe;
  if (REASONS.has(value.reason) || ["workspace_mismatch", "coverage_incomplete"].includes(value.reason)) out.reason = value.reason;
  if (/^[1-9]\d{0,19}$/.test(String(value.eventId || ""))) out.eventId = String(value.eventId);
  for (const key of ["magalu", "controls", "inspected", "expiresAt", "workspaceMismatch", "classificationTruncated", "generation"])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) out[key] = value[key];
  return out;
}
function createSensorJournal({ directory, now = Date.now, log = value => console.log("[RADAR-GARIMPEI-ADMIN]", JSON.stringify(value)), setTimer = setTimeout } = {}) {
  const filename = path.join(directory, "sensor-v1.jsonl");
  let handle = null, queue = [], bytes = 0, lines = 0, failed = false, draining = false, retentionTimer;
  let errorHandler = () => {}, pending = Promise.resolve();
  function fail() { failed = true; queue = []; errorHandler(); }
  async function read() {
    // Reading never changes the capture deadline.
    await pending;
    const reader = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let data;
    try {
      const stat = await reader.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES || (await fs.lstat(filename)).isSymbolicLink()) throw Error("invalid_journal");
      data = await reader.readFile("utf8");
      if (Buffer.byteLength(data) > MAX_BYTES) throw Error("invalid_journal");
    } finally { await reader.close(); }
    const incompleteTail = Boolean(data && !data.endsWith("\n"));
    const rows = (incompleteTail ? data.slice(0, data.lastIndexOf("\n") + 1) : data).trim().split("\n");
    if (rows.length > MAX_LINES) throw Error("invalid_journal");
    const records = rows.filter(Boolean).map(line => sanitize(JSON.parse(line))).filter(Boolean);
    const startedAt = records.find(record => record.kind === "start")?.at;
    if (!startedAt || now() - startedAt >= RETENTION_MS) {
      return { state: "retention_expired", records: [] };
    }
    return { state: "archived", incompleteTail, records };
  }
  async function open() {
    if (handle || failed) return false;
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      // Never overwrite an existing run or auto-resume after restart.
      handle = await fs.open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      retentionTimer = setTimer(() => { close().then(() => fs.unlink(filename)).catch(() => {}); }, RETENTION_MS);
      retentionTimer?.unref?.();
      return true;
    } catch { return false; }
  }
  async function drain() {
    try {
      while (queue.length && !failed) {
        const item = queue.shift(), line = JSON.stringify(item) + "\n";
        const size = Buffer.byteLength(line);
        if (size > 2048 || bytes + size > MAX_BYTES || ++lines > MAX_LINES) { fail(); break; }
        bytes += size;
        await handle.writeFile(line);
        // Diagnostic durability is independent of ACK/financial authority.
        await handle.sync();
        if (item.kind === "alert") { try { log(item); } catch { /* durable alert remains in journal */ } }
      }
    } catch { fail(); }
    finally { draining = false; }
  }
  function append(value) {
    if (!handle || failed) return false;
    const item = sanitize(value);
    if (!item || queue.length >= MAX_QUEUE) { fail(); return false; }
    queue.push(item);
    if (!draining) {
      draining = true;
      pending = new Promise(resolve => setImmediate(() => drain().finally(resolve)));
    }
    return true;
  }
  async function close() { await pending; if (handle) { const h = handle; handle = null; await h.close(); } }
  return { open, append, read, close, flush: () => pending, onError: fn => { errorHandler = fn; },
    status: () => ({ available: Boolean(handle) && !failed, failed, bytes, lines, queue: queue.length, retentionMs: RETENTION_MS }) };
}
module.exports = { createSensorJournal, sanitize, RETENTION_MS, MAX_BYTES, MAX_LINES, MAX_QUEUE };
