"use strict";

const { performance } = require("node:perf_hooks");
const { EventEmitter } = require("node:events");
const { createIngressBoundaryObservation } = require("../modules/whatsapp/ingress-boundary-observation");

const N = 5000;
const workspaceId = "benchmark-workspace";
const sessionId = "benchmark-session";
const groupId = "120363408782037034@g.us";
const packet = { type: "notify", messages: [{ key: { id: "benchmark-id", remoteJid: groupId, fromMe: false } }] };

function fixture(observer) {
  const ev = new EventEmitter();
  ev.isBuffering = () => false;
  const sock = { ev, ws: new EventEmitter(), __optimusListeners: { "messages.upsert": { emissor: ev, handler: () => {} } } };
  if (observer) observer.trackSocket({ workspaceId, sessionId, generation: 1, sock });
  ev.on("messages.upsert", ({ messages, type }) => {
    observer?.mark("callback", { workspaceId, sessionId, sock, emitter: ev, messages, upsertType: type });
    for (const message of messages) {
      observer?.mark("listener", { workspaceId, sessionId, sock, emitter: ev, message });
      observer?.mark("radar", { workspaceId, sessionId, sock, emitter: ev, message });
      observer?.mark("mensageiro_gerente", { workspaceId, sessionId, sock, emitter: ev, message, decision: "ignored", reason: "ignored" });
    }
  });
  return ev;
}

function run() {
  const off = createIngressBoundaryObservation();
  const offEmitter = fixture(off);
  const offStart = performance.now();
  for (let i = 0; i < N; i++) offEmitter.emit("messages.upsert", packet);
  const offMs = performance.now() - offStart;

  const journal = { append: () => true, status: () => ({ available: true, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }) };
  const continuous = createIngressBoundaryObservation({ journal, resolveContinuousScope: ({ workspaceId: w, sessionId: s }) =>
    w === workspaceId && s === sessionId ? { verified: true, groupIds: [groupId] } : { verified: false, groupIds: [] } });
  continuous.startContinuous();
  const activeEmitter = fixture(continuous);
  const activeStart = performance.now();
  for (let i = 0; i < N; i++) activeEmitter.emit("messages.upsert", packet);
  const activeMs = performance.now() - activeStart;
  const status = continuous.status();
  continuous.stop("benchmark_complete");
  console.log(JSON.stringify({
    events: N, offMs: Number(offMs.toFixed(3)), continuousMs: Number(activeMs.toFixed(3)),
    overheadPercent: Number(((activeMs / Math.max(offMs, 0.001) - 1) * 100).toFixed(2)),
    retainedMessageRefs: status.messages.length, groupRows: status.groupStats.length,
    note: "Local CPU-only microbenchmark; journal append is a no-I/O sink. Filesystem batching/capacity are covered by the journal test."
  }));
}

run();
