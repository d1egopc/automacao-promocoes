"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const {
  createV3BaileysAckCorrelator,
  normalizarAckStatus,
  messageIdOf
} = require("../modules/mensageiro-v3/src/v3/baileys-ack-correlator");

// Keep disposable ACK state outside the checkout so Guardiao can verify a
// clean source tree after the integrated tests. This is never production data.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mensageiro-v3-ack-"));
const filePath = path.join(root, "state.json");
const store = new V3Store({ filePath });
const workspaceId = "workspace-ack";
const claimKey = "claim-ack-1";
store.createProfile({ workspaceId, sessionId: "session-a", name: "Perfil ACK" });
store.claimExecution(workspaceId, claimKey, {
  profileId: "profile-a",
  sessionId: "session-a",
  destination: "group-a",
  occurrenceKey: "occurrence-a"
});

assert.equal(normalizarAckStatus(2), "server_ack");
assert.equal(normalizarAckStatus(3), "delivery_ack");
assert.equal(normalizarAckStatus(4), "read");
assert.equal(normalizarAckStatus(99), "unknown");
assert.equal(messageIdOf({ key: { id: "msg-a" } }), "msg-a");

const correlator = createV3BaileysAckCorrelator({ store, clock: () => Date.parse("2026-10-21T12:00:00Z") });
assert.deepEqual(correlator.register({
  workspaceId,
  profileId: "profile-a",
  claimKey,
  sessionId: "session-a",
  messageId: "msg-a"
}).ok, true);

const ignored = correlator.observe({ sessionId: "session-b", updates: [{ key: { id: "msg-a" }, update: { status: 3 } }] });
assert.equal(ignored.observed, 0, "ACK de outra sessão não pode cruzar a correlação");

const observed = correlator.observe({ sessionId: "session-a", updates: [{ key: { id: "msg-a" }, update: { status: 3 } }] });
assert.equal(observed.observed, 1);
assert.deepEqual(observed.results, [{ messageId: "msg-a", status: "delivery_ack" }]);
assert.equal(store.snapshot().workspaces[workspaceId].claims[claimKey].status, "claimed", "ACK não inventa terminalização da execução");
assert.equal(store.snapshot().workspaces[workspaceId].claims[claimKey].transportAckStatus, "delivery_ack");

const restarted = new V3Store({ filePath });
assert.equal(restarted.snapshot().workspaces[workspaceId].claims[claimKey].transportMessageId, "msg-a");
assert.equal(restarted.snapshot().workspaces[workspaceId].claims[claimKey].transportAckStatus, "delivery_ack");

console.log("mensageiro-v3-baileys-ack.test.cjs OK");
