"use strict";
// Test-only preload: pause after opening the descriptor and before reading it.
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const original = fs.readFileSync, close = fs.closeSync;
const signal = new Int32Array(workerData.barrier);
fs.readFileSync = function(file, ...args) {
  if (typeof file === "number" && workerData.stage !== "afterClose") {
    Atomics.store(signal, 0, 1); Atomics.notify(signal, 0);
    if (Atomics.wait(signal, 0, 1, 5000) === "timed-out") throw new Error("test_barrier_timeout");
  }
  return original.call(this, file, ...args);
};
fs.closeSync = function(fd) {
  const result = close.call(this, fd);
  if (workerData.stage === "afterClose") {
    Atomics.store(signal, 0, 1); Atomics.notify(signal, 0);
    if (Atomics.wait(signal, 0, 1, 5000) === "timed-out") throw new Error("test_barrier_timeout");
  }
  return result;
};
require("../../modules/engine/ofc/workspace-worker");
