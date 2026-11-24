"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { approvedRelease, createDeployment } = require("./deployment.cjs");
const { auditWorkspace } = require("./audit.cjs");
const { request } = require("./entry.cjs");

const id = digit => "sha256:" + digit.repeat(64);
const artifact = digit => ({ digest: id(digit), imageId: id(digit), ref: "fixture/backend@" + id(digit) });
const release = { id: "fixture", base: artifact("a"), candidate: artifact("b") };
const epoch = "2026-11-24T13:54:00.000Z";

function setup() {
  let journal = null;
  const writes = [];
  const data = { state: "OPEN", generation: 3, owner: null, image: release.base.digest, claimed: 0,
    sendStarted: 0, originalAck: "provider-confirmed", ambiguous: ["unchanged"], fail: null };
  const host = {
    preflight: () => ({ baseline: {}, originalOverride: "old", candidateOverride: "new" }),
    recoveryPreflight: () => {},
    health(target) { assert.equal(data.image, target.digest); },
    switchImage(op, target) {
      assert.equal(data.state, "DRAINED");
      data.image = target.digest;
      if (data.fail === "switch") throw new Error("switch_failed");
    },
    fence(action, op) {
      if (action === "drain") {
        assert.equal(op.generation, data.generation);
        data.state = "DRAINING"; data.generation++; data.owner = "maintenance:" + op.id;
        if (data.fail === "ssh") throw new Error("connection_lost");
      }
      if (action === "confirm") {
        assert.equal(data.state, "DRAINING");
        assert.equal(data.claimed + data.sendStarted, 0);
        data.state = "DRAINED";
      }
      if (action === "release") {
        assert.equal(data.state, "DRAINED");
        data.state = "OPEN";
        if (data.fail === "release") throw new Error("connection_lost");
      }
      return { ...data, ok: true, epoch, fenceEpoch: epoch };
    }
  };
  const client = createDeployment({
    host, journal: { read: () => journal, write: op => { journal = op; writes.push(op.phase); } },
    audit: () => {}, wait: async () => { data.claimed = 0; data.sendStarted = 0; }
  });
  return { client, data, operation: () => journal, writes };
}

test("the two SSH grammars reject role confusion and shell arguments", () => {
  assert.deepEqual(request("jobs alpha 15 5", "audit"), { action: "jobs", workspace: "alpha", minutes: 15, limit: 5 });
  assert.throws(() => request("deploy fixture", "audit"), /command_denied/);
  assert.throws(() => request("jobs alpha 15 5", "deploy"), /command_denied/);
  for (const input of ["deploy ../fixture", "deploy fixture;id", "deploy fixture\nstatus", "deploy fixture --force"]) {
    assert.throws(() => request(input, "deploy"), /command_denied/);
  }
});

test("signature binds the exact digest and required Golden result", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const record = { ...release, version: 1, purpose: "maintenance-lab", profile: "guardian-reviewed",
    sourceSha: "c".repeat(40), baseSha: "d".repeat(40), runtimeFiles: ["index.js"],
    approvedAt: epoch, expiresAt: "2026-11-25T13:54:00.000Z",
    gates: { sourceSha: "c".repeat(40), baseDigest: release.base.digest,
      candidateDigest: release.candidate.digest, runId: "123", runtimeDiffVerified: true,
      results: { golden: "pass", test: "pass" } } };
  const policy = { purpose: "maintenance-lab", profile: "guardian-reviewed", requiredChecks: ["golden", "test"] };
  const envelope = value => {
    const bytes = Buffer.from(JSON.stringify(value));
    return { payload: bytes.toString("base64"), signature: sign(null, bytes, privateKey).toString("base64") };
  };
  const now = Date.parse(epoch) + 1;
  assert.equal(approvedRelease(envelope(record), publicKey, "fixture", policy, now).candidate.digest, id("b"));
  assert.throws(() => approvedRelease({ ...envelope(record), payload: envelope({ ...record,
    candidate: artifact("e") }).payload }, publicKey, "fixture", policy, now), /invalid_signature/);
  assert.throws(() => approvedRelease(envelope({ ...record, gates: { ...record.gates, results: { test: "pass" } } }),
    publicKey, "fixture", policy, now), /required_checks_not_approved/);
  assert.throws(() => approvedRelease(envelope(record), publicKey, "fixture", policy,
    Date.parse(record.expiresAt)), /invalid_release/);
});

test("audit fails before SQL for unauthorized workspace and strips unknown log values", async () => {
  const sql = [];
  const params = { scopes: ["alpha"], salt: "fixture", action: "logs", workspace: "alpha", minutes: 10, limit: 2,
    pool: { connect: async () => ({ release() {}, async query(statement, values) {
      sql.push([statement, values]);
      return { rows: [{ id: "7", motivo: "https://example.invalid/path?token=secret",
        etapa: "importador", status: "erro", criado_em: new Date(epoch) }] };
    } }) } };
  await assert.rejects(auditWorkspace({ ...params, workspace: "beta" }), /workspace_denied/);
  assert.equal(sql.length, 0);
  const evidence = await auditWorkspace(params);
  assert.equal(evidence.rows[0].motivo, "other");
  assert.equal(evidence.rows[0].etapa, "importador");
  assert.notEqual(evidence.workspace, "alpha");
  assert.equal(sql[0][0], "BEGIN READ ONLY");
  assert.deepEqual(sql[2][1], ["alpha", 10, 2]);
});

test("concurrent deploy is rejected while active send drains and ACK history survives", async () => {
  const { client, data, writes } = setup();
  data.sendStarted = 1;
  const first = client.deploy(release);
  await assert.rejects(client.deploy(release), /recovery_required/);
  assert.equal((await first).phase, "open");
  assert.deepEqual(writes, ["drain_pending", "switch_pending", "release_pending", "open"]);
  assert.equal(data.originalAck, "provider-confirmed");
  assert.deepEqual(data.ambiguous, ["unchanged"]);
});

test("uncertain SSH loss after drain resumes by operation ID without a second drain", async () => {
  const { client, data, operation } = setup();
  data.fail = "ssh";
  await assert.rejects(client.deploy(release), /connection_lost/);
  const op = operation();
  data.fail = null;
  assert.equal((await client.recover(op.id)).phase, "rolled_back");
  assert.equal(data.generation, 4);
  assert.equal(data.state, "OPEN");
});

test("switch failure keeps DRAINED and recovery restores only the baseline", async () => {
  const { client, data, operation } = setup();
  data.fail = "switch";
  await assert.rejects(client.deploy(release), /switch_failed/);
  assert.equal(data.state, "DRAINED");
  data.fail = null;
  assert.equal((await client.recover(operation().id)).phase, "rolled_back");
  assert.equal(data.image, release.base.digest);
  assert.equal(data.originalAck, "provider-confirmed");
});

test("a lost response after release is reconciled without rollback or a new drain", async () => {
  const { client, data, operation } = setup();
  data.fail = "release";
  await assert.rejects(client.deploy(release), /connection_lost/);
  assert.equal(operation().phase, "release_pending");
  assert.equal((await client.recover(operation().id)).phase, "open");
  assert.equal(data.image, release.candidate.digest);
  assert.equal(data.generation, 4);
});

test("a changed fence owner fails closed during recovery", async () => {
  const { client, data, operation } = setup();
  data.fail = "switch";
  await assert.rejects(client.deploy(release), /switch_failed/);
  data.owner = "some-other-operator";
  await assert.rejects(client.recover(operation().id), /fence_ownership_or_epoch_changed/);
  assert.equal(data.state, "DRAINED");
});
