"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMediaPhysical, RETENTION_MS, OBSERVATION_DELAY_MS } =
  require("../modules/engine/auto-clean/gc-media-physical.service");

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-bookkeeping-"));
  const workspace = "user_bookkeeping";
  const dir = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "clientes", workspace), { recursive: true });
  const name = `${"a".repeat(64)}.png`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from("bookkeeping fixture"));
  const old = new Date(NOW - RETENTION_MS - 1000);
  fs.utimesSync(file, old, old);
  return { dataDir, workspace, dir, file, name, target: `identity:${workspace}` };
}

test("quarantined candidates are not reintroduced by a stale state snapshot", async () => {
  const f = fixture();
  const referenceLoader = async () => ({ complete: true, refs: new Map(), generation: "fixture" });
  const options = { dataDir: f.dataDir, targetId: f.target, execute: true, maxScan: 16,
    referenceLoader, nowMs: NOW };
  const oldRelease = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE;
  const oldScopes = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES;
  try {
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE = "approved";
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = f.target;
    await runMediaPhysical(options);
    const staged = await runMediaPhysical({ ...options, nowMs: NOW + OBSERVATION_DELAY_MS + 1 });
    assert.equal(staged.quarantined, 1);
    assert.equal(fs.existsSync(f.file), false);

    const stateFile = path.join(f.dataDir, "auto-clean-media-physical-state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    state.candidates[`${f.target}/${f.name}`] = {
      firstSeenAt: NOW,
      fingerprint: "0:0:1:1",
      size: 1
    };
    fs.writeFileSync(stateFile, JSON.stringify(state));

    const reconciled = await runMediaPhysical({ ...options, execute: false,
      nowMs: NOW + OBSERVATION_DELAY_MS + 2 });
    assert.equal(reconciled.quarantined, 0);
    assert.ok(reconciled.staleCandidatesPruned >= 1);
    const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(Object.keys(after.candidates).some(id => id === `${f.target}/${f.name}`), false);
    assert.equal(fs.existsSync(f.file), false);
    assert.equal(fs.existsSync(path.join(f.dataDir, ".auto-clean-media-quarantine", "identity", f.workspace, `${f.name}.bin`)), true);
  } finally {
    if (oldRelease === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE = oldRelease;
    if (oldScopes === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = oldScopes;
    fs.rmSync(f.dataDir, { recursive: true, force: true });
  }
});
