"use strict";
const fs = require("node:fs"), {workerData} = require("node:worker_threads");
const read = fs.readFileSync, signal = new Int32Array(workerData.barrier);
fs.readFileSync = function(fd, ...args) {
  if (typeof fd !== "number") return read.call(this,fd,...args);
  const opened = fs.fstatSync(fd,{bigint:true});
  Atomics.store(signal,0,1); Atomics.notify(signal,0);
  if (Atomics.wait(signal,0,1,10000) === "timed-out") throw new Error("proof_barrier_timeout");
  const result = read.call(this,fd,...args);
  Atomics.store(signal,1,result === workerData.original ? 1 : 0);
  Atomics.store(signal,2,fs.fstatSync(fd,{bigint:true}).ino === opened.ino ? 1 : 0);
  return result;
};
require("../../modules/engine/ofc/workspace-worker");
