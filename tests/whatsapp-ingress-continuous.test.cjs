"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createIngressBoundaryObservation,
  CONTINUOUS_TARGETS,
  MAX_CONTINUOUS_GENERATIONS,
  MAX_CONTINUOUS_MESSAGES,
  MAX_GROUP_ROWS
} = require("../modules/whatsapp/ingress-boundary-observation");

function socket() {
  const ev = new EventEmitter();
  ev.isBuffering = () => false;
  const ws = new EventEmitter();
  return { ev, ws, __optimusListeners: { "messages.upsert": { emissor: ev, handler: () => {} } } };
}

function message(id, group, fromMe = false) {
  return { key: { id, remoteJid: group, fromMe }, message: { conversation: "PRIVATE MESSAGE BODY MUST NEVER BE STORED" } };
}

test("continuous observer is OFF until explicitly started and exposes only the fixed targets", () => {
  const observer = createIngressBoundaryObservation();
  assert.equal(observer.status().state, "off");
  assert.deepEqual(CONTINUOUS_TARGETS.map(({ workspaceId, sessionId }) => [workspaceId, sessionId]), [
    ["admin", "admin_Zoiao Claro"], ["user_k3phmbkf", "user_k3phmbkf_ServCel"]
  ]);
  assert.ok(MAX_CONTINUOUS_GENERATIONS > 0 && MAX_CONTINUOUS_MESSAGES > 0 && MAX_GROUP_ROWS > 0);
  observer.startContinuous();
  assert.equal(observer.status().coverageState, "DEGRADED_JOURNAL", "no persistent sink must never look fully covered");
  observer.stop("test_complete");
});

test("journal startup is reported separately until persistent coverage is ready", async () => {
  let resolveOpen;
  let available = false;
  const journal = {
    open: () => new Promise(resolve => { resolveOpen = resolve; }),
    status: () => ({ available, failed: false, dropped: 0, queued: 0, bytes: 0, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }),
    append: () => true,
    close: async () => {}
  };
  const observer = createIngressBoundaryObservation({ journal });
  observer.startContinuous();
  await Promise.resolve();
  assert.equal(observer.status().coverageState, "STARTING_JOURNAL");
  available = true;
  resolveOpen(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(observer.status().coverageState, "WAITING_FOR_SOCKET");
  observer.stop("test_complete");
});

test("continuous stages correlate notify/append, fromMe, Radar and Messenger without raw identifiers", () => {
  const persisted = [];
  const journal = { open: async () => true, append: value => { persisted.push(value); return true; }, status: () => ({ available: true, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }) };
  const observer = createIngressBoundaryObservation({ journal });
  assert.equal(observer.startContinuous().ok, true);
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: "admin", sessionId: "admin_Zoiao Claro", generation: 1, sock }), true);
  const handler = ({ messages, type }) => {
    observer.mark("callback", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, messages, upsertType: type });
    for (const item of messages) {
      observer.mark("listener", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item });
      observer.mark("radar", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item });
      observer.mark("result", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item, decision: "accepted", reason: "accepted" });
      observer.mark("mensageiro_gerente", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item, decision: "ignored", reason: "ignored" });
    }
  };
  sock.ev.on("messages.upsert", handler);
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("msg-a", "120363408782037034@g.us", false)] });
  sock.ev.emit("messages.upsert", { type: "append", messages: [message("msg-b", "120363408782037034@g.us", true)] });

  const status = observer.status();
  assert.equal(status.state, "active");
  assert.equal(status.mode, "continuous");
  assert.equal(status.expiresAt, null);
  assert.equal(status.generations[0].counters.callbackCalls, 2);
  assert.equal(status.generations[0].counters.radarEntries, 2);
  assert.equal(status.generations[0].counters.mensageiroGerenteCalls, 2);
  assert.equal(status.groupStats[0].counts.upsertNotify, 1);
  assert.equal(status.groupStats[0].counts.upsertAppend, 1);
  assert.equal(status.groupStats[0].counts.fromMeFalse, 1);
  assert.equal(status.groupStats[0].counts.fromMeTrue, 1);
  assert.equal(status.messages.length, 2);
  assert.ok(status.messages.every(row => /^[a-f0-9]{16}$/.test(row.messageRef) && !JSON.stringify(row).includes("120363")));
  const serialized = JSON.stringify({ status, persisted });
  for (const forbidden of ["120363408782037034@g.us", "admin_Zoiao Claro", "msg-a", "PRIVATE MESSAGE BODY"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.ok(persisted.some(row => row.stage === "radar_result" && row.decision === "accepted"));
  assert.ok(persisted.some(row => row.stage === "mensageiro_gerente" && row.decision === "ignored"));
  assert.equal(status.groupStats[0].sessionRef, persisted.find(row => row.stage === "callback").sessionRef);
  assert.equal(status.groupStats[0].groupRef, status.scope[0].groups.find(ref => ref === status.groupStats[0].groupRef));
  observer.stop("test_complete");
  assert.equal(observer.status().state, "stopped");
});

test("target scope fails closed across tenants, sessions and non-group JIDs", () => {
  const observer = createIngressBoundaryObservation();
  observer.startContinuous();
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: "other", sessionId: "admin_Zoiao Claro", generation: 1, sock }), false);
  assert.equal(observer.trackSocket({ workspaceId: "admin", sessionId: "admin_other", generation: 1, sock }), false);
  assert.equal(observer.trackSocket({ workspaceId: "user_k3phmbkf", sessionId: "user_k3phmbkf_ServCel", generation: 1, sock }), true);
  const before = observer.status().generations[0].counters.emitAttempts;
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("private", "15551234567@s.whatsapp.net")] });
  assert.equal(observer.status().generations[0].counters.emitAttempts, before + 1);
  assert.equal(observer.status().messages.length, 0);
  observer.stop("test_complete");
});

test("socket replacement detaches old wrappers and continuous observation has no five-minute expiry", () => {
  let now = 1000;
  const observer = createIngressBoundaryObservation({ now: () => now });
  observer.startContinuous();
  const first = socket();
  const originalEmit = first.ev.emit;
  observer.trackSocket({ workspaceId: "admin", sessionId: "admin_Zoiao Claro", generation: 1, sock: first });
  first.ev.on("messages.upsert", ({ messages, type }) => observer.mark("callback", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock: first, emitter: first.ev, messages, upsertType: type }));
  const second = socket();
  observer.trackSocket({ workspaceId: "admin", sessionId: "admin_Zoiao Claro", generation: 2, sock: second });
  assert.equal(first.ev.emit, originalEmit);
  now += 60 * 60 * 1000;
  second.ev.emit("messages.upsert", { type: "notify", messages: [message("after-hour", "120363429821085702@g.us")] });
  const status = observer.status();
  assert.equal(status.state, "active");
  assert.equal(status.generations.length, 1);
  assert.equal(status.generations[0].generation, 2);
  assert.equal(status.finishedGenerations[0].generation, 1);
  observer.stop("test_complete");
});
