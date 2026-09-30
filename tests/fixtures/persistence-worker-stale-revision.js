"use strict";

const fs = require("fs");
const path = require("path");
const { parentPort } = require("worker_threads");

let attempts = 0;

function tocarFonteSintetica(job) {
  const fonte = path.join(job.dataDir, "clientes", job.clienteId, "fila-viva.json");
  try {
    const stat = fs.statSync(fonte);
    const mtime = new Date(Math.max(Date.now(), stat.mtimeMs + 1));
    fs.utimesSync(fonte, mtime, mtime);
  } catch {
    // The test still exercises the Worker error contract if the source is absent.
  }
}

parentPort.on("message", job => {
  attempts += 1;
  if (job.clienteId === "workspace-race" && attempts <= 2) {
    tocarFonteSintetica(job);
    setTimeout(() => parentPort.postMessage({
      type: "persistence_error",
      jobId: job.jobId,
      error: {
        code: "STALE_REVISION",
        message: "checkpoint_source_changed_during_prepare"
      }
    }), 5);
    return;
  }
  parentPort.postMessage({
    type: "persistence_result",
    jobId: job.jobId,
    result: { ok: true }
  });
});
