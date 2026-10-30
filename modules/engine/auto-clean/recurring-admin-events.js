"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RELEASE = "OPTIMUS_AUTO_CLEAN_RAW_ADMIN_RELEASE";
const SCOPE = "engine_eventos_brutos:admin";
const LOCK_ID = 902260737; // shared with the existing raw-event stage
const RETENTION_HOURS = 168;
const RECOVERY_MS = 72 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ROW_BYTES = 64 * 1024;
const MAX_ARCHIVES = 512;
const DIRECTORY = "recurring-eventos-brutos-admin";
const SHA = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = code => { const e = new Error(code); e.code = code; throw e; };

async function safeDirectory(dataDir, fsApi = fs.promises) {
  const root = path.resolve(dataDir);
  const parent = path.join(root, "auto-clean");
  const directory = path.join(parent, DIRECTORY);
  for (const item of [root, parent, directory]) {
    try { await fsApi.mkdir(item, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await fsApi.lstat(item);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("AUTO_CLEAN_RECOVERY_PATH_UNSAFE");
    if (item === directory && process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      fail("AUTO_CLEAN_RECOVERY_PERMISSION_UNSAFE");
  }
  return directory;
}

function validArchive(value, name) {
  return value?.version === 1 && value.table === "engine_eventos_brutos" && value.workspace === "admin" &&
    Number.isSafeInteger(value.id) && value.id > 0 && Number(value.row?.id) === value.id &&
    Number.isSafeInteger(value.expiresAtMs) &&
    value.rowHash === SHA(JSON.stringify(value.row)) &&
    name === `event-${value.id}-${value.rowHash}.json`;
}

async function inventory(directory, nowMs, fsApi = fs.promises) {
  const names = await fsApi.readdir(directory);
  if (names.length > MAX_ARCHIVES) fail("AUTO_CLEAN_RECOVERY_CAPACITY_EXCEEDED");
  let bytes = 0;
  let activeCount = 0;
  for (const name of names) {
    if (/^\.event-[1-9]\d*-[a-f0-9]{64}\.json\.\d+\.[a-f0-9]{8}\.tmp$/.test(name)) {
      const tempStat = await fsApi.lstat(path.join(directory, name));
      if (!tempStat.isFile() || tempStat.isSymbolicLink() || tempStat.size > MAX_ROW_BYTES + 1024)
        fail("AUTO_CLEAN_RECOVERY_FILE_UNSAFE");
      if (nowMs - tempStat.mtimeMs >= RECOVERY_MS) await fsApi.unlink(path.join(directory, name));
      else fail("AUTO_CLEAN_RECOVERY_PENDING_TEMP");
      continue;
    }
    if (!/^event-[1-9]\d*-[a-f0-9]{64}\.json$/.test(name)) fail("AUTO_CLEAN_RECOVERY_UNKNOWN_FILE");
    const file = path.join(directory, name);
    const stat = await fsApi.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ROW_BYTES + 1024) fail("AUTO_CLEAN_RECOVERY_FILE_UNSAFE");
    const value = JSON.parse(await fsApi.readFile(file, "utf8"));
    if (!validArchive(value, name)) fail("AUTO_CLEAN_RECOVERY_CORRUPT");
    if (value.expiresAtMs <= nowMs) {
      await fsApi.unlink(file); // only an expired, verified archive in this private directory
    } else { bytes += stat.size; activeCount += 1; }
  }
  if (bytes > MAX_ARCHIVE_BYTES) fail("AUTO_CLEAN_RECOVERY_CAPACITY_EXCEEDED");
  return { bytes, count: activeCount };
}

async function archiveRow(directory, row, nowMs, fsApi = fs.promises) {
  const payload = { version: 1, table: "engine_eventos_brutos", workspace: "admin", id: Number(row.id),
    archivedAtMs: nowMs, expiresAtMs: nowMs + RECOVERY_MS, row,
    rowHash: SHA(JSON.stringify(row)) };
  const name = `event-${payload.id}-${payload.rowHash}.json`;
  const content = JSON.stringify(payload);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_ROW_BYTES) fail("AUTO_CLEAN_RECOVERY_ROW_TOO_LARGE");
  const file = path.join(directory, name);
  try {
    const stat = await fsApi.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("AUTO_CLEAN_RECOVERY_FILE_UNSAFE");
    const prior = JSON.parse(await fsApi.readFile(file, "utf8"));
    if (!validArchive(prior, name)) fail("AUTO_CLEAN_RECOVERY_CORRUPT");
    return { file, bytes: Buffer.byteLength(JSON.stringify(prior)), hash: payload.rowHash };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temp = path.join(directory, `.${name}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const handle = await fsApi.open(temp, "wx", 0o600);
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
  await fsApi.rename(temp, file);
  if (process.platform !== "win32") {
    const dirHandle = await fsApi.open(directory, "r");
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  }
  const saved = JSON.parse(await fsApi.readFile(file, "utf8"));
  if (!validArchive(saved, name)) fail("AUTO_CLEAN_RECOVERY_VERIFY_FAILED");
  return { file, bytes, hash: payload.rowHash };
}

const referenceTables = Object.freeze([
  ["engine_jobs_cliente", "evento_id"], ["engine_links", "evento_id"],
  ["engine_ofertas", "evento_id"], ["engine_radar_replay_intents_candidate", "evento_id"],
  ["engine_universal_one_shot_trigger", "bound_event_id"], ["engine_universal_queue_items", "evento_id"]
]);
const noReferences = referenceTables.map(([table, column]) =>
  `NOT EXISTS (SELECT 1 FROM ${table} r WHERE r.${column}=e.id)`).join(" AND ");
const eligible = `e.criado_em IS NOT NULL AND e.criado_em < NOW() - INTERVAL '${RETENTION_HOURS} hours' AND
  e.origem_tipo='whatsapp' AND e.metadata->'radarMirror'->'origem'->>'clienteId'='admin' AND ${noReferences}`;

async function checkReferenceSchema(client) {
  const result = await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND column_name IN ('evento_id','event_id','bound_event_id','source_event_id')
    ORDER BY table_name,column_name`);
  const actual = result.rows.map(row => `${row.table_name}.${row.column_name}`);
  const expected = referenceTables.map(([table, column]) => `${table}.${column}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("AUTO_CLEAN_REFERENCE_SCHEMA_CHANGED");
  const triggers = await client.query(`SELECT tgname FROM pg_trigger
    WHERE tgrelid='engine_eventos_brutos'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
    ORDER BY tgname`);
  if (JSON.stringify(triggers.rows.map(row => row.tgname)) !==
      JSON.stringify(["engine_radar_pending_event_guard_candidate_trigger"]))
    fail("AUTO_CLEAN_TRIGGER_SCHEMA_CHANGED");
}

async function run({ pool, dataDir = "/data", nowMs = Date.now(), fsApi = fs.promises } = {}) {
  if (process.env[RELEASE] !== "approved" || process.env.OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE === "approved" ||
      process.env.OPTIMUS_AUTO_CLEAN_RECURRING_SCOPE !== SCOPE ||
      process.env.OPTIMUS_AUTO_CLEAN_RECURRING_MODE !== "execute") {
    return { ok: false, removed: 0, reason: "AUTO_CLEAN_ORIGIN_NOT_RELEASED" };
  }
  if (!pool) return { ok: false, removed: 0, reason: "AUTO_CLEAN_DB_UNAVAILABLE" };
  let client;
  try {
    const directory = await safeDirectory(dataDir, fsApi);
    const archive = await inventory(directory, nowMs, fsApi);
    if (archive.count >= MAX_ARCHIVES || archive.bytes >= MAX_ARCHIVE_BYTES - MAX_ROW_BYTES)
      fail("AUTO_CLEAN_RECOVERY_CAPACITY_EXCEEDED");
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='500ms'");
    await client.query("SET LOCAL statement_timeout='8000ms'");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [LOCK_ID]);
    if (lock.rows[0]?.locked !== true) fail("AUTO_CLEAN_ORIGIN_BUSY");
    await checkReferenceSchema(client);
    const candidate = await client.query(`SELECT e.* FROM engine_eventos_brutos e WHERE ${eligible}
      ORDER BY e.criado_em ASC,e.id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (candidate.rowCount === 0) { await client.query("COMMIT"); return { ok: true, removed: 0, reason: "NO_ELIGIBLE_ROWS" }; }
    const row = candidate.rows[0];
    const recovery = await archiveRow(directory, row, nowMs, fsApi);
    if (process.env[RELEASE] !== "approved" || process.env.OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE === "approved" ||
        process.env.OPTIMUS_AUTO_CLEAN_RECURRING_SCOPE !== SCOPE ||
        process.env.OPTIMUS_AUTO_CLEAN_RECURRING_MODE !== "execute") fail("AUTO_CLEAN_ORIGIN_RELEASE_REVOKED");
    const deleted = await client.query(`DELETE FROM engine_eventos_brutos e WHERE e.id=$1 AND ${eligible}
      RETURNING e.id,pg_column_size(e.*)::bigint AS bytes`, [row.id]);
    if (deleted.rowCount !== 1 || Number(deleted.rows[0].id) !== Number(row.id)) fail("AUTO_CLEAN_DELETE_RECHECK_FAILED");
    await client.query("COMMIT");
    return { ok: true, removed: 1, logicalBytesReleased: Number(deleted.rows[0].bytes || 0),
      recoveryBytes: recovery.bytes, recoveryHours: 72, origin: SCOPE };
  } catch (error) {
    if (client) try { await client.query("ROLLBACK"); } catch {}
    return { ok: false, removed: 0, reason: error.code || "AUTO_CLEAN_ORIGIN_FAILED" };
  } finally { client?.release(); }
}

module.exports = { run, RELEASE, SCOPE, RETENTION_HOURS, RECOVERY_MS, MAX_ARCHIVE_BYTES,
  MAX_ROW_BYTES, MAX_ARCHIVES, DIRECTORY, safeDirectory, inventory, archiveRow, validArchive,
  checkReferenceSchema, referenceTables };
