"use strict";

const { randomUUID } = require("node:crypto");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");
const { createGerenteObservabilityV2 } = require("../modules/mensageiro/gerente-observability-v2");

const TARGET = Object.freeze({
  workspaceId: "user_k3phmbkf",
  sessionId: "user_k3phmbkf_ClaroTeste",
  groupId: "120363000000000000@g.us"
});
const BATCH_SIZE = 188;
const ROUNDS = 40;

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 0;
}

function stats(values) {
  return {
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    p99Ms: Number(percentile(values, 0.99).toFixed(4))
  };
}

function runBaselineBatch() {
  const perMessage = [];
  const started = performance.now();
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const one = performance.now();
    const groupId = index % 7 === 0 ? TARGET.groupId : `other-${index}@g.us`;
    const isGroup = String(groupId).endsWith("@g.us");
    if (isGroup) void groupId;
    perMessage.push(performance.now() - one);
  }
  return { batchMs: performance.now() - started, perMessage };
}

function runCandidateOffBatch(controller) {
  const perMessage = [];
  const started = performance.now();
  controller.isActiveFor({ workspaceId: TARGET.workspaceId, sessionId: TARGET.sessionId });
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const one = performance.now();
    const groupId = index % 7 === 0 ? TARGET.groupId : `other-${index}@g.us`;
    const isGroup = String(groupId).endsWith("@g.us");
    if (isGroup) void groupId;
    perMessage.push(performance.now() - one);
  }
  return { batchMs: performance.now() - started, perMessage };
}

function runCandidateActiveBatch({ keepController = false } = {}) {
  const perMessage = [];
  const controller = createGerenteObservabilityV2({ validateTarget: () => true });
  controller.start({ ...TARGET, durationMs: 15 * 60 * 1000, maxEvents: 10, runId: randomUUID() });
  const started = performance.now();
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const one = performance.now();
    const groupId = index % 7 === 0 ? TARGET.groupId : `other-${index}@g.us`;
    const eventTrace = controller.beginEvent({
      ...TARGET,
      groupId,
      messageId: `synthetic-message-${index}`
    });
    if (eventTrace) {
      eventTrace("ingress", "received", { result: "ok" });
      eventTrace("session_workspace", "resolved", { result: "ok" });
      eventTrace("group_resolution", "resolved", { result: "ok" });
      eventTrace("socket_guard", "socket_current", { result: "ok" });
      eventTrace("profile_selection", "profile_selected", { profileId: "profile-fixture", result: "ok" });
      eventTrace("card_scope", "profile_selected", { profileId: "profile-fixture", result: "ok" });
      eventTrace("handler_result", "handler_called", { profileId: "profile-fixture", result: "ok" });
      eventTrace("rule_evaluation", "rule_match", { profileId: "profile-fixture", ruleId: "rule-fixture", result: "ok" });
      eventTrace("exemption", "sender_not_exempt", { profileId: "profile-fixture", ruleId: "rule-fixture", result: "ok" });
      eventTrace("bot_admin", "bot_admin", { profileId: "profile-fixture", ruleId: "rule-fixture", result: "ok", durationMs: 2 });
      eventTrace("delete_attempt", "delete_started", { profileId: "profile-fixture", ruleId: "rule-fixture", result: "unknown" });
      eventTrace("delete_result", "delete_succeeded", { profileId: "profile-fixture", ruleId: "rule-fixture", result: "ok", durationMs: 4 });
    }
    perMessage.push(performance.now() - one);
  }
  const batchMs = performance.now() - started;
  const final = controller.status();
  const recordCount = final.recordCount;
  if (!keepController) controller.dispose();
  return {
    batchMs,
    perMessage,
    recordCount,
    bytesBudgeted: final.bytesBudgeted,
    controller: keepController ? controller : null
  };
}

async function yieldToLoop() { await new Promise(resolve => setImmediate(resolve)); }

async function main() {
  const loop = monitorEventLoopDelay({ resolution: 1 });
  loop.enable();
  const baselineBatches = [];
  const offBatches = [];
  const activeBatches = [];
  const baselineMessages = [];
  const offMessages = [];
  const activeMessages = [];
  let records = 0;
  const offController = createGerenteObservabilityV2({ validateTarget: () => true });

  for (let round = 0; round < ROUNDS; round += 1) {
    const baseline = runBaselineBatch();
    baselineBatches.push(baseline.batchMs);
    baselineMessages.push(...baseline.perMessage);
    const off = runCandidateOffBatch(offController);
    offBatches.push(off.batchMs);
    offMessages.push(...off.perMessage);
    const active = runCandidateActiveBatch();
    activeBatches.push(active.batchMs);
    activeMessages.push(...active.perMessage);
    records += active.recordCount;
    await yieldToLoop();
  }
  loop.disable();
  offController.dispose();

  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const sample = runCandidateActiveBatch({ keepController: true });
  if (global.gc) global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  sample.controller.dispose();

  console.log(JSON.stringify({
    runtime: process.version,
    workload: { rounds: ROUNDS, messagesPerBatch: BATCH_SIZE, totalMessages: ROUNDS * BATCH_SIZE },
    baselineNoTrace: { batch: stats(baselineBatches), message: stats(baselineMessages) },
    candidateOff: { batch: stats(offBatches), message: stats(offMessages) },
    candidateActive: { batch: stats(activeBatches), message: stats(activeMessages), avgRecordsPerBatch: records / ROUNDS },
    eventLoopDelayMs: {
      mean: Number((loop.mean / 1e6).toFixed(4)),
      max: Number((loop.max / 1e6).toFixed(4)),
      p95: Number((loop.percentile(95) / 1e6).toFixed(4)),
      p99: Number((loop.percentile(99) / 1e6).toFixed(4))
    },
    memorySample: {
      records: sample.recordCount,
      boundedBufferBytes: sample.bytesBudgeted,
      heapDeltaAfterGcBytes: heapAfter - heapBefore,
      heapDeltaNote: "Noisy single-process heap delta; boundedBufferBytes is the deterministic cap."
    },
    ioOperations: 0,
    note: "Synthetic local benchmark; instrumentation only, not production latency."
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
