const {
  buscarJobsPendentes,
  limitarJobs,
  tentarMarcarProcessando,
  marcarJobStatus,
  registrarProcessamento
} = require("./processor.service");
const { processarJobEngine } = require("./processor.steps");
const {
  logEngineProcessadorInicio,
  logEngineProcessadorJob,
  logEngineProcessadorErro,
  logEngineProcessadorFim
} = require("./logger");

async function processarJobsPendentesEngine({ limite = 20, clientesValidos = [] } = {}) {
  const limiteFinal = limitarJobs(limite);
  const resumo = {
    ok: true,
    processados: 0,
    diagnosticados: 0,
    erros: 0
  };

  logEngineProcessadorInicio({ limite: limiteFinal });

  const pendentes = await buscarJobsPendentes(limiteFinal);
  if (!pendentes.ok) {
    logEngineProcessadorErro({ etapa: "buscar_jobs", motivo: pendentes.motivo || "buscar_jobs_falhou", erro: pendentes.erro || "" });
    return {
      ok: false,
      processados: 0,
      diagnosticados: 0,
      erros: 0,
      motivo: pendentes.motivo || "buscar_jobs_falhou",
      erro: pendentes.erro || ""
    };
  }

  for (const job of pendentes.jobs) {
    logEngineProcessadorJob({ jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id });

    const lock = await tentarMarcarProcessando(job.id);
    if (!lock.ok) {
      if (lock.ignorado) continue;
      resumo.erros += 1;
      logEngineProcessadorErro({ jobId: job.id, etapa: "marcar_processando", motivo: lock.motivo || "lock_falhou", erro: lock.erro || "" });
      continue;
    }

    resumo.processados += 1;

    try {
      const resultado = await processarJobEngine(job, { clientesValidos });
      if (resultado.ok && resultado.status === "diagnosticado") {
        resumo.diagnosticados += 1;
      } else {
        resumo.erros += 1;
      }
    } catch (e) {
      resumo.erros += 1;
      logEngineProcessadorErro({ jobId: job.id, etapa: "processar_job", motivo: "erro_inesperado", erro: e.message });
      await registrarProcessamento(job.id, "diagnostico_final", "erro", "erro_inesperado", { erro: e.message });
      await marcarJobStatus(job.id, "erro", "erro_inesperado");
    }
  }

  logEngineProcessadorFim(resumo);
  return resumo;
}

module.exports = {
  processarJobsPendentesEngine
};
