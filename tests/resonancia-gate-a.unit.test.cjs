"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  coberturaDeMensagem,
  sanitizarTraceRef,
  extrairTraceRef,
} = require("../modules/telemetria/trace-ref");
const { sanitizeRecord } = require("../modules/whatsapp/ingress-observation-journal");
const { createIngressBoundaryObservation } = require("../modules/whatsapp/ingress-boundary-observation");

test("traceRef is deterministic, opaque and compatible with coverage IDs", () => {
  const messageId = "BAE5A1D2";
  const coverage = coberturaDeMensagem(messageId);
  const fromMessage = sanitizarTraceRef("", { messageId });
  const fromCoverage = sanitizarTraceRef(coverage);
  assert.match(fromMessage, /^tr_[a-f0-9]{24}$/);
  assert.equal(fromMessage, fromCoverage);
  assert.equal(extrairTraceRef({ metadata: { coberturaTraceId: coverage } }), fromMessage);
  assert.equal(fromMessage.includes(messageId), false);
  assert.equal(fromMessage.includes(coverage), false);
});

test("journal accepts only sanitized traceRef and retains no private fields", () => {
  const record = sanitizeRecord({
    kind: "stage",
    stage: "callback",
    at: Date.now(),
    workspaceRef: "0123456789abcdef",
    sessionRef: "fedcba9876543210",
    groupRef: "0011223344556677",
    eventRef: "8899aabbccddeeff",
    traceRef: "cov_0123456789abcdef",
    messageId: "PRIVATE_MESSAGE_ID",
    content: "PRIVATE_CONTENT",
  });
  assert.ok(record);
  assert.match(record.traceRef, /^tr_[a-f0-9]{24}$/);
  assert.equal("messageId" in record, false);
  assert.equal("content" in record, false);
});

test("continuous ingress journal correlates callback and Radar stages with the same opaque traceRef", () => {
  const rows = [];
  const groupId = "120363408782037034@g.us";
  const observation = createIngressBoundaryObservation({
    journal: { append: row => rows.push(row), status: () => ({ available: true, maxBytes: 1, retentionMs: 1 }) },
    resolveContinuousScope: () => ({ verified: true, groupIds: [groupId] }),
  });
  const sock = { ev: new EventEmitter() };
  assert.equal(observation.startContinuous().ok, true);
  assert.equal(observation.trackSocket({ workspaceId: "workspace_a", sessionId: "session_a", sock, generation: 1 }), true);
  const message = { key: { id: "message-a", remoteJid: groupId, fromMe: false } };
  observation.mark("callback", { workspaceId: "workspace_a", sessionId: "session_a", sock, messages: [message], upsertType: "notify" });
  observation.mark("radar", { workspaceId: "workspace_a", sessionId: "session_a", sock, message });
  const traceRefs = rows.map(row => row.traceRef).filter(Boolean);
  assert.ok(traceRefs.length >= 2);
  assert.equal(new Set(traceRefs).size, 1);
  assert.match(traceRefs[0], /^tr_[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(rows).includes("message-a"), false);
  observation.stop();
});
