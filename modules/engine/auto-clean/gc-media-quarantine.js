"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOLD_MS = 72 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 2048;
const MAX_BYTES = 8 * 1024 * 1024 * 1024;
const SHA = data => crypto.createHash("sha256").update(data).digest("hex");
const fingerprint = stat => `${Number(stat.dev || 0)}:${Number(stat.ino || 0)}:${Number(stat.size || 0)}:${Math.trunc(Number(stat.mtimeMs || 0))}`;
const fail = code => { const error = new Error(code); error.code = code; throw error; };

async function syncDirectory(dir, io) {
  if (process.platform === "win32") return;
  const handle = await io.open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

function safeTarget(target) {
  if (!/^(identity|social):[A-Za-z0-9_-]+$/.test(target?.id || "") ||
      target.id !== `${target.kind}:${target.workspace}`) fail("MEDIA_RECOVERY_TARGET_INVALID");
}

async function safeDirectory(dataDir, target, io = fs.promises) {
  safeTarget(target);
  const root = path.resolve(dataDir);
  const privateRoot = path.join(root, ".auto-clean-media-quarantine");
  const parts = [root, privateRoot, path.join(privateRoot, target.kind),
    path.join(privateRoot, target.kind, target.workspace)];
  for (const dir of parts) {
    try { await io.mkdir(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await io.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.platform !== "win32" && dir !== root && (stat.mode & 0o077) !== 0))
      fail("MEDIA_RECOVERY_PATH_UNSAFE");
  }
  return parts.at(-1);
}

function validManifest(meta, target, name) {
  return meta?.version === 1 && meta.target === target.id && meta.name === name &&
    Number.isSafeInteger(meta.size) && meta.size > 0 && meta.size <= MAX_FILE_BYTES &&
    Number.isSafeInteger(meta.archivedAtMs) && Number.isSafeInteger(meta.expiresAtMs) &&
    meta.expiresAtMs === meta.archivedAtMs + HOLD_MS && /^[a-f0-9]{64}$/.test(meta.sha256 || "");
}

async function inventory(dir, io = fs.promises) {
  const names = await io.readdir(dir);
  if (names.length > MAX_FILES * 2) fail("MEDIA_RECOVERY_CAPACITY_EXCEEDED");
  let files = 0, bytes = 0;
  const present = new Set(names);
  const manifests = [];
  for (const name of names) {
    if (!name.endsWith(".json") && !name.endsWith(".bin")) fail("MEDIA_RECOVERY_UNKNOWN_FILE");
    const stat = await io.lstat(path.join(dir, name));
    if (!stat.isFile() || stat.isSymbolicLink()) fail("MEDIA_RECOVERY_FILE_UNSAFE");
    if (name.endsWith(".bin")) {
      if (!present.has(`${name.slice(0, -4)}.json`)) fail("MEDIA_RECOVERY_ORPHAN_PAYLOAD");
      files++; bytes += stat.size;
    } else manifests.push({ name, mtimeMs: stat.mtimeMs });
  }
  if (files > MAX_FILES || bytes > MAX_BYTES) fail("MEDIA_RECOVERY_CAPACITY_EXCEEDED");
  manifests.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  return { files, bytes, names, manifests };
}

async function stage({ dataDir, target, item, nowMs = Date.now(), io = fs.promises }) {
  if (!item || path.dirname(path.resolve(item.file)) !== path.resolve(target.dir) ||
      !/^[A-Za-z0-9_.-]+$/.test(path.basename(item.file))) fail("MEDIA_RECOVERY_SOURCE_UNSAFE");
  const dir = await safeDirectory(dataDir, target, io);
  const current = await inventory(dir, io);
  const stat = await io.lstat(item.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES ||
      stat.size !== item.size || fingerprint(stat) !== item.fingerprint ||
      current.files >= MAX_FILES || current.bytes + stat.size > MAX_BYTES)
    fail("MEDIA_RECOVERY_CAPACITY_OR_SOURCE_CHANGED");
  const name = path.basename(item.file);
  const payload = path.join(dir, `${name}.bin`);
  const manifest = path.join(dir, `${name}.json`);
  if (current.names.includes(`${name}.bin`) || current.names.includes(`${name}.json`))
    fail("MEDIA_RECOVERY_NAME_OCCUPIED");
  const bytes = await io.readFile(item.file);
  const afterRead = await io.lstat(item.file);
  if (bytes.length !== stat.size || fingerprint(afterRead) !== item.fingerprint)
    fail("MEDIA_RECOVERY_SOURCE_CHANGED");
  const meta = { version: 1, target: target.id, name, size: stat.size, sha256: SHA(bytes),
    archivedAtMs: nowMs, expiresAtMs: nowMs + HOLD_MS };
  const handle = await io.open(manifest, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(meta)); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dir, io);
  await io.rename(item.file, payload);
  await syncDirectory(target.dir, io);
  await syncDirectory(dir, io);
  const saved = await io.lstat(payload);
  if (!saved.isFile() || saved.isSymbolicLink() || saved.size !== stat.size ||
      SHA(await io.readFile(payload)) !== meta.sha256) fail("MEDIA_RECOVERY_VERIFY_FAILED");
  return { bytes: stat.size };
}

async function sweep({ dataDir, target, loadRefs, nowMs = Date.now(), max = 8, io = fs.promises }) {
  const dir = await safeDirectory(dataDir, target, io);
  const current = await inventory(dir, io);
  const result = { removed: 0, bytesFreed: 0, restored: 0, blocked: 0 };
  for (const { name: manifestName } of current.manifests.slice(0, Math.max(1, Math.min(max, 32)))) {
    const name = manifestName.slice(0, -5);
    const manifest = path.join(dir, manifestName);
    const meta = JSON.parse(await io.readFile(manifest, "utf8"));
    if (!validManifest(meta, target, name)) fail("MEDIA_RECOVERY_MANIFEST_INVALID");
    const payload = path.join(dir, `${name}.bin`);
    let stat;
    try { stat = await io.lstat(payload); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const original = path.join(target.dir, name);
    if (!stat) {
      // A crash before the rename leaves the original in place. Missing both
      // copies is never evidence that the file was safely purged.
      const source = await io.lstat(original).catch(() => null);
      if (!source?.isFile() || source.isSymbolicLink() || source.size !== meta.size ||
          SHA(await io.readFile(original)) !== meta.sha256)
        fail("MEDIA_RECOVERY_INCOMPLETE");
      await io.unlink(manifest);
      await syncDirectory(dir, io);
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== meta.size) fail("MEDIA_RECOVERY_CORRUPT");
    const references = await loadRefs();
    if (references?.complete !== true || !(references.refs instanceof Map)) fail("MEDIA_RECOVERY_REFERENCE_INCOMPLETE");
    const key = target.kind === "identity" ? name.slice(0, -4).toLowerCase() : `social:${target.workspace}/${name}`;
    if (references.refs.has(key)) {
      if (SHA(await io.readFile(payload)) !== meta.sha256) fail("MEDIA_RECOVERY_CORRUPT");
      try { await io.lstat(original); fail("MEDIA_RECOVERY_RESTORE_COLLISION"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await io.rename(payload, original);
      await io.unlink(manifest);
      await syncDirectory(target.dir, io);
      await syncDirectory(dir, io);
      result.restored++;
    } else if (meta.expiresAtMs <= nowMs) {
      if (SHA(await io.readFile(payload)) !== meta.sha256) fail("MEDIA_RECOVERY_CORRUPT");
      await io.unlink(payload);
      await io.unlink(manifest);
      await syncDirectory(dir, io);
      result.removed++;
      result.bytesFreed += meta.size;
    } else result.blocked++;
  }
  return result;
}

module.exports = { HOLD_MS, MAX_FILE_BYTES, MAX_FILES, MAX_BYTES, safeDirectory, inventory, stage, sweep };
