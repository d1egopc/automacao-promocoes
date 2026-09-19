(function publicarLocalWorkerRunner(global) {
  "use strict";
  const INTERVAL_MINUTES = 0.5;
  let executando = false;
  let alarmeRegistrado = false;
  function texto(valor = "") { return String(valor ?? "").trim(); }
  function emitir(nome, dados = {}) {
    try { console.info(`[${nome}]`, JSON.stringify(dados)); } catch (_) {}
  }
  function erroTexto(erro, fallback = "local_worker_falhou") {
    return texto(erro?.message || erro) || fallback;
  }
  async function reportarFailure(task, erro) {
    const motivo = erroTexto(erro);
    emitir("LOCAL-WORKER-FAILURE", { taskId: texto(task?.id), productId: texto(task?.productId), motivo });
    try {
      const resposta = await global.OptimusLocalWorkerClient.failure(task, { leaseToken: task.leaseToken, motivo: motivo.slice(0, 120) });
      emitir("LOCAL-WORKER-FAILURE", { taskId: texto(task?.id), productId: texto(task?.productId), enviado: Boolean(resposta && resposta.ok !== false) });
      return resposta;
    } catch (failureErro) {
      emitir("LOCAL-WORKER-ERRO", { etapa: "failure", taskId: texto(task?.id), productId: texto(task?.productId), motivo: erroTexto(failureErro, "failure_envio_falhou") });
      return null;
    }
  }
  async function processar() {
    if (executando || !global.OptimusLocalWorkerClient) return;
    executando = true;
    let task = null;
    let etapa = "claim";
    try {
      const claimed = await global.OptimusLocalWorkerClient.claim();
      if (claimed?.ok === false) {
        emitir("LOCAL-WORKER-ERRO", { etapa, motivo: erroTexto(claimed?.motivo, "claim_falhou") });
        return;
      }
      task = claimed?.task || null;
      if (!task) return;
      emitir("LOCAL-WORKER-TASK-INICIO", { taskId: texto(task.id), productId: texto(task.productId), marketplace: texto(task.marketplace), capability: texto(task.capability), attempts: task.attempts });
      if (task.marketplace !== "magalu" || task.capability !== global.OptimusLocalWorkerClient.CAPABILITY) throw new Error("task_magalu_capability_invalida");
      etapa = "resolver";
      const slugWorkspace = String(task.technicalSlug || "").trim();
      if (!slugWorkspace) throw new Error("slug_tecnico_magalu_ausente");
      const resultado = await global.OptimusMagaluLocalResolver.resolver({ productId: task.productId, slugWorkspace });
      if (!resultado?.imagemOficialUrl || !resultado?.provaTecnica) throw new Error("magalu_resultado_incompleto");
      emitir("LOCAL-WORKER-MAGALU-RESOLVIDA", { taskId: texto(task.id), productId: texto(task.productId), skuConfirmado: resultado.provaTecnica.skuConfirmado === true, hrefConfirmado: resultado.provaTecnica.hrefConfirmado === true, origem: texto(resultado.provaTecnica.origem || resultado.provaTecnica.source) });
      etapa = "result";
      emitir("LOCAL-WORKER-RESULT-ENVIO", { taskId: texto(task.id), productId: texto(task.productId) });
      const resposta = await global.OptimusLocalWorkerClient.result(task, { leaseToken: task.leaseToken, marketplace: "magalu", productId: task.productId, imagemOficialUrl: resultado.imagemOficialUrl, provaTecnica: resultado.provaTecnica });
      if (!resposta || resposta.ok === false) throw new Error("result_rejeitado");
      emitir("LOCAL-WORKER-RESULT-OK", { taskId: texto(task.id), productId: texto(task.productId) });
    } catch (erro) {
      emitir("LOCAL-WORKER-ERRO", { etapa, taskId: texto(task?.id), productId: texto(task?.productId), motivo: erroTexto(erro) });
      if (task) await reportarFailure(task, erro);
    } finally { executando = false; }
  }
  function iniciar() {
    if (!global.chrome?.alarms || alarmeRegistrado) return;
    try {
      global.chrome.alarms.create("optimus-local-worker-poll", { periodInMinutes: INTERVAL_MINUTES });
      global.chrome.alarms.onAlarm?.addListener(alarm => {
        if (alarm?.name === "optimus-local-worker-poll") return processar().catch(erro => emitir("LOCAL-WORKER-ERRO", { etapa: "alarme", motivo: erroTexto(erro) }));
        return undefined;
      });
      alarmeRegistrado = true;
    } catch (_) {
      // O worker local é opcional; falhas da API de alarmes não escapam ao service worker.
    }
  }
  global.OptimusLocalWorkerRunner = { iniciar, processar, INTERVAL_MINUTES };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusLocalWorkerRunner;
})(typeof globalThis !== "undefined" ? globalThis : self);
