"use strict";

// Test-only barrier: pause before the Worker's first revision read so the
// parent can change the file after capturing expected and before result.before.
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const originalStat = fs.statSync;
const signal = new Int32Array(workerData.barrier);
let first = true;

fs.statSync = function (...args) {
  if (first) {
    first = false;
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
    if (Atomics.wait(signal, 0, 1, 5000) === "timed-out") {
      throw new Error("test_barrier_timeout");
    }
  }
  return originalStat.apply(this, args);
};

require("../../modules/engine/ofc/workspace-worker");
