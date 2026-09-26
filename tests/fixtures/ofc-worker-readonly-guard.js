"use strict";
// Test-only capability traps: production worker must not load SQL or call filesystem writers.
const Module = require("node:module"), fs = require("node:fs");
const load = Module._load;
if (require("node:worker_threads").workerData?.revisionFault) {
  const originalStat = fs.fstatSync; let calls = 0;
  fs.fstatSync = function(...args) {
    if (++calls === 2) { const e = new Error("uncertain revision"); e.code = "EIO"; throw e; }
    return originalStat.apply(this,args);
  };
}
Module._load = function(name,...rest) {
  if (name === "pg" || /absorption-gate\.repository|drainage-metrics\.repository/.test(name)) throw new Error("test_worker_database_forbidden");
  return load.call(this,name,...rest);
};
for (const name of ["writeFileSync","appendFileSync","renameSync","unlinkSync","mkdirSync","rmSync","truncateSync","writeSync"]) {
  fs[name] = () => { throw new Error("test_worker_write_forbidden:" + name); };
}
require("../../modules/engine/ofc/workspace-worker");
