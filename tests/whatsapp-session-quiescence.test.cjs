"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  STATES,
  createSessionQuiescenceRegistry,
  waitForSocketClose
} = require("../modules/whatsapp/session-quiescence.service");

const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const quiescenceSource = fs.readFileSync(path.join(__dirname, "..", "modules/whatsapp/session-quiescence.service.js"), "utf8");

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function authStoreManifest(rootDir) {
  const root = path.resolve(rootDir);
  const entries = [];
  function visit(current, relative = "") {
    const stat = fs.lstatSync(current);
    assert.equal(stat.isSymbolicLink(), false, `auth fixture must not contain symlinks: ${relative}`);
    const type = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other";
    assert.notEqual(type, "other", `unsupported auth fixture entry: ${relative}`);
    const entry = {
      relative,
      type,
      mode: stat.mode & 0o777,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs)
    };
    if (type === "file") entry.sha256 = hashFile(current);
    entries.push(entry);
    if (type === "dir") {
      for (const child of fs.readdirSync(current).sort()) {
        const childRelative = relative ? path.join(relative, child) : child;
        visit(path.join(current, child), childRelative);
      }
    }
  }
  visit(root);
  return entries;
}

function copyAuthFixture(sourceDir, destinationDir, onAfterFirstFile) {
  const source = path.resolve(sourceDir);
  const destination = path.resolve(destinationDir);
  assert.notEqual(source, destination);
  assert.equal(fs.existsSync(destination), false, "snapshot destination must be new");
  const before = authStoreManifest(source);
  let copiedFiles = 0;
  for (const entry of before) {
    const sourcePath = path.join(source, entry.relative);
    const destinationPath = path.join(destination, entry.relative);
    if (entry.type === "dir") {
      fs.mkdirSync(destinationPath, { recursive: true, mode: entry.mode });
      fs.chmodSync(destinationPath, entry.mode);
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destinationPath, entry.mode);
    fs.utimesSync(destinationPath, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
    copiedFiles += 1;
    if (copiedFiles === 1) onAfterFirstFile?.();
  }
  for (const entry of before.filter(item => item.type === "dir").sort((a, b) => b.relative.length - a.relative.length)) {
    const destinationPath = path.join(destination, entry.relative);
    fs.chmodSync(destinationPath, entry.mode);
    fs.utimesSync(destinationPath, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
  }
  const after = authStoreManifest(source);
  assert.deepEqual(after, before, "source auth store changed during snapshot");
  const copied = authStoreManifest(destination);
  assert.deepEqual(copied, before, "snapshot tree differs from source manifest");
  return { files: copiedFiles, manifest: copied };
}

function snapshotCaller({ registry, sessionId, epoch, sourceDir, destinationDir, onAfterFirstFile }) {
  registry.assertSnapshotAllowed(sessionId, epoch);
  return copyAuthFixture(sourceDir, destinationDir, onAfterFirstFile);
}

async function main() {
  const closeEmitter = new EventEmitter();
  const closeResult = await waitForSocketClose({
    ev: closeEmitter,
    end: () => closeEmitter.emit("connection.update", { connection: "close" })
  }, { timeoutMs: 50 });
  assert.deepEqual(closeResult, { closed: true, reason: "connection_update_close" });
  await assert.rejects(
    () => waitForSocketClose({ ev: new EventEmitter(), end() {} }, { timeoutMs: 2 }),
    /socket_close_not_confirmed/
  );

  const registry = createSessionQuiescenceRegistry();
  const claro = registry.trackerFor("admin_Radar Zap Claro");
  const other = registry.trackerFor("workspace_outro");

  // Disposable multi-file auth store: no real creds, tokens, cookies or sockets.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-quiescence-auth-"));
  const authSource = path.join(fixtureRoot, "auth_source");
  const authSnapshot = path.join(fixtureRoot, "auth_snapshot");
  const authRestore = path.join(fixtureRoot, "auth_restore");
  fs.mkdirSync(path.join(authSource, "keys"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(authSource, "creds.json"), JSON.stringify({ fixture: true, session: "synthetic" }));
  fs.writeFileSync(path.join(authSource, "keys", "session-1"), "synthetic-session-key");
  fs.writeFileSync(path.join(authSource, "keys", "pre-key-1"), "synthetic-pre-key");
  fs.chmodSync(path.join(authSource, "creds.json"), 0o600);
  fs.chmodSync(path.join(authSource, "keys", "session-1"), 0o600);
  fs.chmodSync(path.join(authSource, "keys", "pre-key-1"), 0o600);
  const snapshotSession = registry.trackerFor("workspace_snapshot");
  const initialSnapshotEpoch = snapshotSession.status().epoch;
  assert.throws(
    () => snapshotCaller({ registry, sessionId: "workspace_snapshot", epoch: initialSnapshotEpoch, sourceDir: authSource, destinationDir: authSnapshot }),
    /snapshot_not_allowed/
  );
  const snapshotRequest = registry.request("workspace_snapshot");
  assert.throws(
    () => snapshotCaller({ registry, sessionId: "workspace_snapshot", epoch: snapshotRequest.epoch, sourceDir: authSource, destinationDir: authSnapshot }),
    /snapshot_not_allowed/
  );
  assert.equal(snapshotSession.beginDrain({ closed: true }).ok, true);
  assert.throws(
    () => snapshotCaller({ registry, sessionId: "workspace_snapshot", epoch: snapshotRequest.epoch, sourceDir: authSource, destinationDir: authSnapshot }),
    /snapshot_not_allowed/
  );
  const snapshotDrain = await snapshotSession.waitForDrain({ timeoutMs: 250, quietWindowMs: 2 });
  assert.equal(snapshotDrain.ok, true);
  const snapshotResult = snapshotCaller({
    registry,
    sessionId: "workspace_snapshot",
    epoch: snapshotRequest.epoch,
    sourceDir: authSource,
    destinationDir: authSnapshot
  });
  assert.equal(snapshotResult.files, 3);
  assert.deepEqual(authStoreManifest(authSnapshot), authStoreManifest(authSource));
  copyAuthFixture(authSnapshot, authRestore);
  assert.deepEqual(authStoreManifest(authRestore), authStoreManifest(authSnapshot));

  const failedCopyDir = path.join(fixtureRoot, "auth_failed_copy");
  assert.throws(
    () => snapshotCaller({
      registry,
      sessionId: "workspace_snapshot",
      epoch: snapshotRequest.epoch,
      sourceDir: authSource,
      destinationDir: failedCopyDir,
      onAfterFirstFile: () => fs.appendFileSync(path.join(authSource, "keys", "session-1"), "late-writer")
    }),
    /source auth store changed during snapshot/
  );
  assert.equal(snapshotSession.status().state, STATES.QUIESCED, "copy failure must not auto-resume the session");
  assert.equal(registry.resume("workspace_snapshot", snapshotRequest.epoch).ok, true);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });

  // A pending Signal write must drain before QUIESCED is granted.
  let finishPending;
  const pendingWrite = claro.run("keys.set", () => new Promise(resolve => { finishPending = resolve; }));
  const requested = registry.request("admin_Radar Zap Claro");
  assert.equal(requested.ok, true);
  assert.equal(registry.isQuiescing("admin_Radar Zap Claro"), true);
  assert.equal(registry.isQuiescing("workspace_outro"), false, "quiescence must be session-local");
  assert.equal(claro.status().state, STATES.REQUESTED);
  assert.equal(await claro.run("keys.set", async () => "write-during-close"), "write-during-close");
  assert.equal(claro.status().blockedWrites, 0, "writes emitted while the socket is closing must not be rejected");
  finishPending();
  await pendingWrite;
  assert.equal(claro.beginDrain({ closed: true }).ok, true);
  const drained = await claro.waitForDrain({ timeoutMs: 250, quietWindowMs: 2 });
  assert.equal(drained.ok, true, "pending auth write must drain before snapshot authorization");
  assert.equal(drained.state, STATES.QUIESCED);
  assert.doesNotThrow(() => claro.assertSnapshotAllowed(requested.epoch));

  // A write attempted after the pause is rejected and makes the gate fail closed.
  await assert.rejects(
    () => claro.run("creds.update", async () => undefined),
    error => error.code === "auth_write_blocked_quiescing"
  );
  assert.equal(claro.status().blockedWrites, 1);
  assert.equal(claro.status().state, STATES.FAILED, "a write after QUIESCED must fail closed immediately");
  assert.throws(() => claro.assertSnapshotAllowed(requested.epoch), /snapshot_not_allowed/);
  assert.equal(registry.resume("admin_Radar Zap Claro", requested.epoch).ok, false, "failed quiescence cannot resume silently");

  // A clean second session can pause, snapshot-authorize and resume independently.
  const isolated = registry.trackerFor("admin_Radar Zap Vivo");
  const cleanRequest = registry.request("admin_Radar Zap Vivo");
  assert.equal(isolated.beginDrain({ closed: true }).ok, true);
  const cleanDrain = await isolated.waitForDrain({ timeoutMs: 100, quietWindowMs: 1 });
  assert.equal(cleanDrain.ok, true);
  assert.doesNotThrow(() => isolated.assertSnapshotAllowed(cleanRequest.epoch));
  assert.deepEqual(registry.resume("admin_Radar Zap Vivo", cleanRequest.epoch), {
    ok: true,
    state: STATES.ACTIVE,
    epoch: cleanRequest.epoch
  });
  assert.equal(await other.run("keys.set", async () => "other-session-ok"), "other-session-ok");

  const callbackTracker = registry.trackerFor("workspace_callback");
  const releaseCallback = registry.enter("workspace_callback", "messages.upsert");
  const callbackRequest = registry.request("workspace_callback");
  assert.equal(callbackTracker.beginDrain({ closed: true }).ok, true);
  const callbackDrain = callbackTracker.waitForDrain({ timeoutMs: 250, quietWindowMs: 1 });
  releaseCallback();
  assert.equal((await callbackDrain).ok, true, "in-flight ingress callback must drain before QUIESCED");
  assert.doesNotThrow(() => callbackTracker.assertSnapshotAllowed(callbackRequest.epoch));

  // The public local orchestration path ends only the target socket and grants
  // snapshot authorization after the same drain/quiet-window proof.
  const orchestrated = registry.trackerFor("workspace_orchestrated");
  let socketEnded = false;
  const orchestratedResult = await registry.quiesce("workspace_orchestrated", {
    endSocket: async () => { socketEnded = true; return { closed: true }; },
    timeoutMs: 100,
    quietWindowMs: 1
  });
  assert.equal(orchestratedResult.ok, true);
  assert.equal(socketEnded, true);
  assert.equal(orchestratedResult.state, STATES.QUIESCED);
  assert.doesNotThrow(() => registry.assertSnapshotAllowed("workspace_orchestrated", orchestratedResult.epoch));
  assert.equal(registry.resume("workspace_orchestrated", orchestratedResult.epoch).ok, true);

  const copyFailure = await registry.quiesce("workspace_copy_failure", {
    endSocket: async () => ({ closed: true }),
    timeoutMs: 100,
    quietWindowMs: 1
  });
  assert.equal(copyFailure.ok, true);
  assert.doesNotThrow(() => registry.assertSnapshotAllowed("workspace_copy_failure", copyFailure.epoch));
  try {
    throw new Error("snapshot_copy_failed");
  } catch {
    // A copy failure does not mutate the auth tracker; explicit resume is safe
    // because the quiescence proof already completed and no writes were seen.
    assert.equal(registry.resume("workspace_copy_failure", copyFailure.epoch).ok, true);
  }

  const operationFailure = await registry.quiesce("workspace_quiesce_error", {
    endSocket: async () => { throw new Error("socket_close_failed"); },
    timeoutMs: 100,
    quietWindowMs: 1
  });
  assert.equal(operationFailure.ok, false);
  assert.equal(operationFailure.state, STATES.FAILED);
  assert.throws(
    () => registry.assertSnapshotAllowed("workspace_quiesce_error", operationFailure.epoch),
    /snapshot_not_allowed/
  );
  assert.equal(registry.recover("workspace_quiesce_error", operationFailure.epoch).ok, true);
  assert.equal(registry.status("workspace_quiesce_error").state, STATES.ACTIVE);

  // Both exposed auth write paths are covered: creds.update and Signal keys.set.
  const wrappedTracker = registry.trackerFor("workspace_wrapped");
  const calls = [];
  const wrapped = wrappedTracker.wrapAuthState({
    state: {
      creds: {},
      keys: {
        get: async () => ({ ok: true }),
        set: async () => { calls.push("keys.set"); }
      }
    },
    saveCreds: async () => { calls.push("creds.update"); }
  });
  await wrapped.saveCreds();
  await wrapped.state.keys.set({ session: { value: true } });
  assert.deepEqual(calls, ["creds.update", "keys.set"]);
  assert.equal(wrappedTracker.status().pending, 0);

  // Snapshot failure is terminal until an explicit, safe recovery path is chosen.
  const snapshotFailure = registry.trackerFor("workspace_snapshot_failure");
  const terminalSnapshotRequest = registry.request("workspace_snapshot_failure");
  assert.equal(snapshotFailure.fail("snapshot_copy_failed").reason, "snapshot_copy_failed");
  assert.throws(() => snapshotFailure.assertSnapshotAllowed(terminalSnapshotRequest.epoch), /snapshot_not_allowed/);

  // Runtime integration guards lifecycle/reconnect and never logs out for quiescence.
  assert.ok(indexSource.includes("whatsappQuiescence.wrapAuthState(id, authState)"));
  assert.ok(indexSource.includes('whatsappQuiescence.enter(id, "messages.upsert")'));
  assert.ok(indexSource.includes("whatsappQuiescence.isQuiescing(sessaoId)"));
  assert.ok(indexSource.includes("whatsappQuiescence.isQuiescing(id)"));
  assert.ok(indexSource.includes("quiescerSessaoWhatsAppParaSnapshot"));
  assert.ok(indexSource.includes("waitForSocketClose"));
  assert.ok(indexSource.includes("socket?.ev?.removeAllListeners?.()"));
  assert.ok(quiescenceSource.includes("socket_close_not_confirmed"));
  assert.ok(indexSource.includes("autorizarSnapshotAuthSessao"));
  assert.ok(indexSource.includes("liberarSessaoWhatsAppAposSnapshot"));
  assert.ok(indexSource.includes("recuperarSessaoWhatsAppAposFalhaQuiescencia"));
  assert.ok(indexSource.includes("reconnectEpochScheduled"));
  assert.ok(indexSource.includes("stale_reconnect_backoff"));
  assert.ok(indexSource.includes("quiescenceEpochAtStart"));
  assert.ok(!indexSource.includes("whatsappQuiescence.quiesce(sessaoId, { logout:"));

  console.log("whatsapp-session-quiescence.test.cjs OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
