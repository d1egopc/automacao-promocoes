"use strict";

const { parentPort } = require("worker_threads");

parentPort.on("message", job => {
  const stage = () => parentPort.postMessage({
    type: "persistence_progress",
    jobId: job.jobId,
    operation: job.operation,
    stage: "legacy_read_completed",
    elapsedMs: 1,
    stageMs: 1,
    legacyBytes: 17,
    vivaBytes: 0,
    targetGeneration: job.targetGeneration
  });
  stage();
  if (job.checkpointRevision.includes("timeout")) {
    setInterval(stage, 40);
    return;
  }
  if (job.checkpointRevision.includes("crash")) {
    setTimeout(() => process.exit(42), 20);
    return;
  }
  if (job.checkpointRevision.includes("stale")) {
    parentPort.postMessage({
      type: "persistence_progress", jobId: job.jobId,
      operation: job.operation, stage: "prepare_stale",
      staleStage: job.checkpointRevision.includes("read") ? "during_read" : "before_backup",
      elapsedMs: 2, stageMs: 1, targetGeneration: job.targetGeneration
    });
    setTimeout(() => parentPort.postMessage({
      type: "persistence_error", jobId: job.jobId,
      error: { code: "STALE_REVISION", message: "fixture_stale" }
    }), 20);
    return;
  }
  if (job.checkpointRevision.includes("error")) {
    setTimeout(() => parentPort.postMessage({
      type: "persistence_error", jobId: job.jobId,
      error: { code: "CHECKPOINT_WRITE_FAILED", message: "fixture_error" }
    }), 20);
    return;
  }
  setTimeout(() => {
    stage();
    parentPort.postMessage({
      type: "persistence_result", jobId: job.jobId,
      result: { ok: true, operation: job.operation }
    });
  }, 20);
});
