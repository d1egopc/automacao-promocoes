"use strict";
const { Worker } = require("node:worker_threads");
const path = require("node:path");

// The existing V3 authority and lock remain authoritative. All its synchronous
// reads, copies and transactions run in this bounded worker, never in ingress.
class V4Repository {
  constructor({ filePath, maxPending = 16, timeoutMs = 10000 } = {}) {
    if (!path.isAbsolute(filePath || ""))
      throw new Error("filePath_absoluto_obrigatorio");
    this.filePath = filePath;
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.serial = 0;
    this.failed = false;
    this.worker = null;
  }
  start() {
    if (this.worker) return;
    this.worker = new Worker(path.join(__dirname, "store-worker.js"), {
      workerData: { filePath: this.filePath },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    this.worker.on("message", (message) => {
      const item = this.pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(message.id);
      if (message.error)
        item.reject(
          Object.assign(new Error(message.error), { code: message.error }),
        );
      else item.resolve(message.value);
    });
    const failed = () => {
      this.failed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("v4_worker_indisponivel"));
      }
      this.pending.clear();
    };
    this.worker.on("error", failed);
    this.worker.on("exit", failed);
  }
  call(operation, args = {}) {
    if (this.failed) return Promise.reject(new Error("v4_worker_indisponivel"));
    if (this.pending.size >= this.maxPending)
      return Promise.reject(new Error("v4_backpressure"));
    this.start();
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // No retry/termination of an uncertain transaction. Stop admitting work.
        this.failed = true;
        this.pending.delete(id);
        reject(new Error("v4_operacao_incerta_sem_retry"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, operation, args });
    });
  }
  async close() {
    if (this.pending.size) throw new Error("v4_operacao_em_andamento");
    if (this.worker) await this.worker.terminate();
  }
}
module.exports = { V4Repository };
