(function publicarLocalWorkerRunner(global) {
  "use strict";
  const INTERVAL_MINUTES = 0.5;
  let executando = false;
  let alarmeRegistrado = false;
  async function processar() {
    if (executando || !global.OptimusLocalWorkerClient) return;
    executando = true;
    try {
      const claimed = await global.OptimusLocalWorkerClient.claim(); const task = claimed?.task;
      if (!task || task.marketplace !== "magalu" || task.capability !== global.OptimusLocalWorkerClient.CAPABILITY) return;
      try {
        const slugWorkspace = String(task.technicalSlug || "").trim();
        if (!slugWorkspace) throw new Error("slug_tecnico_magalu_ausente");
        const resultado = await global.OptimusMagaluLocalResolver.resolver({ productId: task.productId, slugWorkspace });
        await global.OptimusLocalWorkerClient.result(task, { leaseToken: task.leaseToken, marketplace: "magalu", productId: task.productId, imagemOficialUrl: resultado.imagemOficialUrl, provaTecnica: resultado.provaTecnica });
      } catch (erro) {
        await global.OptimusLocalWorkerClient.failure(task, { leaseToken: task.leaseToken, motivo: String(erro?.message || "magalu_worker_falhou").slice(0, 120) });
      }
    } catch (_) {
      // O worker permanece silencioso e tenta novamente no próximo alarme.
    } finally { executando = false; }
  }
  function iniciar() {
    if (!global.chrome?.alarms || alarmeRegistrado) return;
    try {
      global.chrome.alarms.create("optimus-local-worker-poll", { periodInMinutes: INTERVAL_MINUTES });
      global.chrome.alarms.onAlarm?.addListener(alarm => {
        if (alarm?.name === "optimus-local-worker-poll") void processar();
      });
      alarmeRegistrado = true;
    } catch (_) {
      // O worker local é opcional; falhas da API de alarmes não escapam ao service worker.
    }
  }
  global.OptimusLocalWorkerRunner = { iniciar, processar, INTERVAL_MINUTES };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusLocalWorkerRunner;
})(typeof globalThis !== "undefined" ? globalThis : self);
