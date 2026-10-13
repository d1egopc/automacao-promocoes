(function publishBulkListRunner(global) {
  "use strict";
  const SESSION_KEY = "optimus.selection.batch.v1";
  const MAX_ITEMS = 30;
  const DEFAULT_CONCURRENCY = 2;

  async function run(options = {}) {
    const items = Array.isArray(options.items) ? options.items.slice(0, MAX_ITEMS) : [];
    const processItem = options.processItem;
    if (typeof processItem !== "function") throw new Error("selection_processor_required");
    const concurrency = Math.max(1, Math.min(3, Number(options.concurrency || DEFAULT_CONCURRENCY), items.length || 1));
    const summary = { added: 0, existing: 0, errors: 0, completed: 0, total: items.length };
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++;
        let result = "error";
        try { result = await processItem(items[index], index); } catch { result = "error"; }
        if (result === "added") summary.added += 1;
        else if (result === "existing") summary.existing += 1;
        else summary.errors += 1;
        summary.completed += 1;
        await options.onProgress?.({ ...summary });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return summary;
  }

  const api = Object.freeze({ run, SESSION_KEY, MAX_ITEMS, DEFAULT_CONCURRENCY });
  global.OptimusCaptureBulkListRunner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
