"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const {
  createSessionQuiescenceRegistry
} = require("../modules/whatsapp/session-quiescence.service");
const {
  TARGET_SESSION_ID,
  createSessionQuiescenceAdminCaller
} = require("../modules/whatsapp/session-quiescence-admin-caller");

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "quiescence-admin-caller-"));
  const authRoot = path.join(root, "auth");
  const snapshotRoot = path.join(root, "snapshots");
  await fsp.mkdir(path.join(authRoot, "keys"), { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(authRoot, "creds.json"), "synthetic-creds", { mode: 0o600 });
  await fsp.writeFile(path.join(authRoot, "keys", "session-1"), "synthetic-key", { mode: 0o600 });
  return { root, authRoot, snapshotRoot };
}

function adminReq(overrides = {}) {
  return {
    socket: { remoteAddress: "127.0.0.1" },
    usuario: { papel: "admin_master" },
    body: {},
    query: {},
    ...overrides
  };
}

async function buildCaller(options = {}) {
  const registry = options.registry || createSessionQuiescenceRegistry({ sleepImpl: async () => {} });
  const calls = { starts: 0, pauses: 0, resumes: 0, recovers: 0 };
  const caller = createSessionQuiescenceAdminCaller({
    registry,
    authRoot: options.authRoot,
    snapshotRoot: options.snapshotRoot,
    quiesceSession: async id => {
      calls.pauses += 1;
      return registry.quiesce(id, { endSocket: async () => ({ closed: true }), quietWindowMs: 0 });
    },
    resumeSession: (id, epoch) => {
      calls.resumes += 1;
      return registry.resume(id, epoch);
    },
    recoverSession: (id, epoch) => {
      calls.recovers += 1;
      return registry.recover(id, epoch);
    },
    startSession: async () => { calls.starts += 1; },
    fsApi: options.fsApi,
    logger: () => {}
  });
  return { caller, registry, calls };
}

(async () => {
  const indexSource = await fsp.readFile(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexSource.includes("session-quiescence-admin-caller"));
  assert.ok(indexSource.includes("/admin/whatsapp/claro-quiescence/status"));
  assert.ok(indexSource.includes("/admin/whatsapp/claro-quiescence/pause"));
  assert.ok(indexSource.includes("/admin/whatsapp/claro-quiescence/snapshot"));
  assert.ok(indexSource.includes("/admin/whatsapp/claro-quiescence/resume"));
  assert.ok(indexSource.includes("/admin/whatsapp/claro-quiescence/recover"));
  assert.ok(indexSource.includes("exigirAdminMasterEstrito, exigirLoopbackQuiescenciaClaro"));
  assert.ok(!indexSource.includes("/admin/whatsapp/claro-quiescence/:sessaoId"));

  const f = await fixture();
  try {
    const { caller, registry, calls } = await buildCaller(f);

    assert.deepStrictEqual(caller.authorizeRequest(adminReq({ socket: { remoteAddress: "10.0.0.8" } })), { ok: false, reason: "loopback_required" });
    assert.deepStrictEqual(caller.authorizeRequest(adminReq({ headers: { "x-forwarded-for": "203.0.113.9" } })), { ok: false, reason: "forwarded_client_not_loopback" });
    assert.strictEqual(caller.authorizeRequest(adminReq({ headers: { "x-forwarded-for": "127.0.0.1" } })).ok, true);
    assert.deepStrictEqual(caller.authorizeRequest(adminReq({ usuario: { papel: "admin" } })), { ok: false, reason: "admin_master_required" });
    assert.deepStrictEqual(caller.authorizeRequest(adminReq({ body: { sessaoId: "other" } })), { ok: false, reason: "session_target_fixed" });
    assert.strictEqual(caller.authorizeRequest(adminReq()).ok, true);

    const before = await caller.snapshot(0);
    assert.strictEqual(before.ok, false);
    assert.strictEqual(before.reason, "snapshot_requires_quiesced");

    const paused = await caller.pause();
    assert.strictEqual(paused.ok, true);
    assert.strictEqual(paused.targetSessionId, TARGET_SESSION_ID);
    assert.strictEqual(paused.state, "quiesced");
    const epoch = paused.epoch;
    assert.strictEqual(registry.status("other-session").state, "active");
    assert.strictEqual((await caller.pause()).alreadyQuiesced, true);

    assert.strictEqual((await caller.snapshot(epoch + 1)).reason, "epoch_mismatch");
    const snapshot = await caller.snapshot(epoch);
    assert.strictEqual(snapshot.ok, true);
    assert.ok(/^snapshot-/.test(snapshot.snapshotId));
    assert.ok(/^[a-f0-9]{64}$/.test(snapshot.manifestSha256));
    assert.strictEqual(snapshot.fileCount, 2);
    const snapshotDir = path.join(f.snapshotRoot, snapshot.snapshotId);
    assert.strictEqual((await fsp.stat(snapshotDir)).isDirectory(), true);
    const manifestBytes = await fsp.readFile(path.join(snapshotDir, "MANIFEST.json"));
    assert.strictEqual(crypto.createHash("sha256").update(manifestBytes).digest("hex"), snapshot.manifestSha256);
    if (process.platform !== "win32") {
      assert.strictEqual((await fsp.stat(snapshotDir)).mode & 0o777, 0o700);
      assert.strictEqual((await fsp.stat(path.join(snapshotDir, "MANIFEST.json"))).mode & 0o777, 0o600);
    }

    const replay = await caller.snapshot(epoch);
    assert.strictEqual(replay.alreadySnapshotted, true);
    const resumed = await caller.resume(epoch);
    assert.strictEqual(resumed.ok, true);
    assert.strictEqual(calls.starts, 1);
    assert.strictEqual(calls.pauses, 1);
    assert.strictEqual(caller.status().state, "active");

    const f2 = await fixture();
    try {
      let mutated = false;
      const fsApi = { ...fsp, copyFile: async (...args) => {
        const result = await fsp.copyFile(...args);
        if (!mutated) {
          mutated = true;
          await fsp.writeFile(path.join(f2.authRoot, "late-write"), "unexpected", { mode: 0o600 });
        }
        return result;
      } };
      const originalSnapshotRegistry = createSessionQuiescenceRegistry({ sleepImpl: async () => {} });
      const originalSnapshot = createSessionQuiescenceAdminCaller({
        registry: originalSnapshotRegistry,
        authRoot: f2.authRoot,
        snapshotRoot: f2.snapshotRoot,
        fsApi,
        quiesceSession: async id => originalSnapshotRegistry.quiesce(id, { endSocket: async () => ({ closed: true }), quietWindowMs: 0 }),
        resumeSession: (id, epoch) => originalSnapshotRegistry.resume(id, epoch),
        recoverSession: (id, epoch) => originalSnapshotRegistry.recover(id, epoch),
        startSession: async () => {}
      });
      const failedPause = await originalSnapshot.pause();
      const failedSnapshot = await originalSnapshot.snapshot(failedPause.epoch);
      assert.strictEqual(failedSnapshot.ok, false);
      assert.strictEqual(originalSnapshot.status().state, "failed");
      assert.strictEqual((await originalSnapshot.resume(failedPause.epoch)).ok, false);
      assert.strictEqual((await originalSnapshot.recover(failedPause.epoch)).ok, true);
    } finally {
      await fsp.rm(f2.root, { recursive: true, force: true });
    }

    const f4 = await fixture();
    try {
      const failedStartRegistry = createSessionQuiescenceRegistry({ sleepImpl: async () => {} });
      const failedStartCaller = createSessionQuiescenceAdminCaller({
        registry: failedStartRegistry,
        authRoot: f4.authRoot,
        snapshotRoot: f4.snapshotRoot,
        quiesceSession: async id => failedStartRegistry.quiesce(id, { endSocket: async () => ({ closed: true }), quietWindowMs: 0 }),
        resumeSession: (id, epoch) => failedStartRegistry.resume(id, epoch),
        recoverSession: (id, epoch) => failedStartRegistry.recover(id, epoch),
        startSession: async () => null
      });
      const failedStartPause = await failedStartCaller.pause();
      await failedStartCaller.snapshot(failedStartPause.epoch);
      const failedStartResume = await failedStartCaller.resume(failedStartPause.epoch);
      assert.strictEqual(failedStartResume.ok, false);
      assert.strictEqual(failedStartResume.reason, "resume_start_failed");
      assert.strictEqual(failedStartCaller.status().state, "failed");
    } finally {
      await fsp.rm(f4.root, { recursive: true, force: true });
    }

    const f3 = await fixture();
    try {
      const delayed = createSessionQuiescenceRegistry({ sleepImpl: async () => new Promise(resolve => setTimeout(resolve, 5)) });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let callsPause = 0;
      const concurrent = createSessionQuiescenceAdminCaller({
        registry: delayed,
        authRoot: f3.authRoot,
        snapshotRoot: f3.snapshotRoot,
        quiesceSession: async id => { callsPause += 1; await gate; return delayed.quiesce(id, { endSocket: async () => ({ closed: true }), quietWindowMs: 0 }); },
        resumeSession: (id, epoch) => delayed.resume(id, epoch),
        recoverSession: (id, epoch) => delayed.recover(id, epoch),
        startSession: async () => {}
      });
      const first = concurrent.pause();
      const second = await concurrent.pause();
      assert.strictEqual(second.reason, "pause_in_progress");
      release();
      const firstResult = await first;
      assert.strictEqual(firstResult.ok, true);
      assert.strictEqual(callsPause, 1);
    } finally {
      await fsp.rm(f3.root, { recursive: true, force: true });
    }
  } finally {
    await fsp.rm(f.root, { recursive: true, force: true });
  }

  console.log("whatsapp-session-quiescence-admin-caller.test.cjs OK");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
