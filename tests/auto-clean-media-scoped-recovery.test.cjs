"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMediaPhysical, runMediaPhysicalBatch, RETENTION_MS, OBSERVATION_DELAY_MS } =
  require("../modules/engine/auto-clean/gc-media-physical.service");
const { HOLD_MS } = require("../modules/engine/auto-clean/gc-media-quarantine");

const now = Date.parse("2026-10-30T12:00:00Z");
const old = new Date(now - RETENTION_MS - 1000);

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-scoped-media-"));
  const workspace = "user_safe";
  const dir = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "clientes", workspace), { recursive: true });
  const name = `${"a".repeat(64)}.png`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from("recovery fixture"));
  fs.utimesSync(file, old, old);
  return { dataDir, dir, file, name, target: `identity:${workspace}` };
}

async function withScoped(f) {
  const oldRelease = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE;
  const oldScopes = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES;
  const oldGlobal = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE;
  process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE = "approved";
  process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:user_safe";
  delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE;
  try { await f(); } finally {
    for (const [key, value] of [["OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE", oldRelease],
      ["OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES", oldScopes],
      ["OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE", oldGlobal]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("scoped identity media stages, restores new references and physically frees only after 72h", async () => {
  const f = setup();
  try { await withScoped(async () => {
    let refs = new Map();
    const options = { dataDir: f.dataDir, targetId: f.target, maxScan: 10, execute: true,
      referenceLoader: async () => ({ complete: true, refs, generation: "fixture" }) };
    const first = await runMediaPhysical({ ...options, nowMs: now });
    assert.equal(first.removed, 0);
    const staged = await runMediaPhysical({ ...options, nowMs: now + OBSERVATION_DELAY_MS + 1 });
    assert.equal(staged.quarantined, 1);
    assert.equal(staged.bytesFreed, 0);
    assert.equal(fs.existsSync(f.file), false);
    const recovery = path.join(f.dataDir, ".auto-clean-media-quarantine", "identity", "user_safe");
    assert.equal(fs.readFileSync(path.join(recovery, `${f.name}.bin`), "utf8"), "recovery fixture");
    if (process.platform !== "win32")
      assert.equal(fs.statSync(path.join(recovery, `${f.name}.json`)).mode & 0o077, 0);
    refs = new Map([["a".repeat(64), new Set(["fila"])]]);
    const restored = await runMediaPhysical({ ...options, nowMs: now + OBSERVATION_DELAY_MS + 2 });
    assert.equal(restored.restored, 1);
    assert.equal(fs.readFileSync(f.file, "utf8"), "recovery fixture");
    refs = new Map();
    await runMediaPhysical({ ...options, nowMs: now + OBSERVATION_DELAY_MS + 3 });
    await runMediaPhysical({ ...options, nowMs: now + 2 * OBSERVATION_DELAY_MS + 4 });
    const purged = await runMediaPhysical({ ...options, nowMs: now + 2 * OBSERVATION_DELAY_MS + HOLD_MS + 5 });
    assert.equal(purged.removed, 1);
    assert.equal(purged.bytesFreed, Buffer.byteLength("recovery fixture"));
    assert.equal(fs.existsSync(path.join(recovery, `${f.name}.bin`)), false);
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});

test("no scoped authorization or incomplete references never removes media", async () => {
  const f = setup();
  try { await withScoped(async () => {
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:user_other";
    const blocked = await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target,
      nowMs: now, execute: true, referenceLoader: async () => ({ complete: true, refs: new Map() }) });
    assert.equal(blocked.dryRun, true);
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = f.target;
    const missing = await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target,
      nowMs: now + OBSERVATION_DELAY_MS + 1, execute: true,
      referenceLoader: async () => ({ complete: false, refs: new Map() }) });
    assert.equal(missing.removed, 0);
    assert.equal(missing.quarantined, 0);
    assert.equal(fs.existsSync(f.file), true);
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});

test("batch scans only released workspaces and rejects an empty scope", async () => {
  const f = setup();
  try { await withScoped(async () => {
    const loaded = [];
    const onlySafe = await runMediaPhysicalBatch({ dataDir: f.dataDir, nowMs: now, execute: true,
      referenceLoader: async target => { loaded.push(target.id); return { complete: true, refs: new Map() }; } });
    assert.deepEqual(loaded, [f.target]);
    assert.deepEqual(onlySafe.targets, [f.target]);
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:user_other";
    const empty = await runMediaPhysicalBatch({ dataDir: f.dataDir, nowMs: now + 1, execute: true });
    assert.equal(empty.errors, 1);
    assert.equal(empty.stopReason, "no_scoped_targets_verified");
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});

test("unexpected quarantine content blocks without deleting either file", async () => {
  const f = setup();
  try { await withScoped(async () => {
    const recovery = path.join(f.dataDir, ".auto-clean-media-quarantine", "identity", "user_safe");
    fs.mkdirSync(recovery, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(recovery, 0o700);
    const protectedFile = path.join(recovery, "protected-backup.dump");
    fs.writeFileSync(protectedFile, "protected");
    await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target, nowMs: now, execute: true,
      referenceLoader: async () => ({ complete: true, refs: new Map() }) });
    const result = await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target,
      nowMs: now + OBSERVATION_DELAY_MS + 1, execute: true,
      referenceLoader: async () => ({ complete: true, refs: new Map() }) });
    assert.equal(result.quarantined, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.stopReason, "MEDIA_RECOVERY_UNKNOWN_FILE");
    assert.equal(fs.readFileSync(protectedFile, "utf8"), "protected");
    assert.equal(fs.existsSync(f.file), true);
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});

test("world-readable quarantine refuses scoped media cleanup", async t => {
  if (process.platform === "win32") { t.skip("POSIX permissions only"); return; }
  const f = setup();
  try { await withScoped(async () => {
    const recovery = path.join(f.dataDir, ".auto-clean-media-quarantine", "identity", "user_safe");
    fs.mkdirSync(recovery, { recursive: true, mode: 0o700 });
    fs.chmodSync(recovery, 0o755);
    const result = await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target,
      nowMs: now, execute: true,
      referenceLoader: async () => ({ complete: true, refs: new Map() }) });
    assert.equal(result.stopReason, "MEDIA_RECOVERY_PATH_UNSAFE");
    assert.equal(result.removed, 0);
    assert.equal(fs.existsSync(f.file), true);
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});

test("symlink target directory is rejected before reference lookup or mutation", async t => {
  const f = setup();
  try { await withScoped(async () => {
    const outside = path.join(f.dataDir, "outside");
    fs.mkdirSync(outside);
    fs.rmSync(f.dir, { recursive: true });
    try { fs.symlinkSync(outside, f.dir, "dir"); }
    catch (error) { if (process.platform === "win32") { t.skip("Windows symlink privilege unavailable"); return; } throw error; }
    const result = await runMediaPhysical({ dataDir: f.dataDir, targetId: f.target,
      nowMs: now, execute: true, referenceLoader: async () => { throw Error("must not read"); } });
    assert.equal(result.removed, 0);
    assert.equal(result.quarantined, 0);
    assert.equal(result.stopReason, "media_target_directory_unsafe");
  }); } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
});
