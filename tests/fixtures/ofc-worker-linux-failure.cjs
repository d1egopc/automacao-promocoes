"use strict";
const {parentPort,workerData} = require("node:worker_threads");
parentPort.on("message",()=> {
  if(workerData.mode === "crash") throw new Error("intentional_linux_worker_crash");
  if(workerData.mode === "exit") process.exit(0);
  if(workerData.mode === "invalid") parentPort.postMessage({ok:true,result:{}});
  // timeout/terminate: deliberately no response; the client must settle safely.
});
