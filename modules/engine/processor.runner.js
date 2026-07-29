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

function logEngineProcessadorJobErro(job = {}, erroJob = {}) {
  console.log("[ENGINE-PROCESSADOR-JOB-ERRO]", {
    jobId: job.id || erroJob.jobId || "",
    eventoId: job.evento_id || job.eventoId || erroJob.eventoId || "",
    clienteId: job.cliente_id || job.clienteId || erroJob.clienteId || "",
    etapa: erroJob.etapa || "processar_job",
    motivo: erroJob.motivo || "erro_processamento",
    erro: erroJob.erro || "",
    stack: erroJob.stack || ""
  });
}

// DEPRECATED — compatibilidade temporaria.
// Origem legada: Processor recebe clientesValidos como lista de ids.
// Destino oficial: Processor receber Workspaces avaliados pelo WorkspaceRegistry.
// Consumidor atual: orquestrador Engine V2 e rota /engine/processar-pendentes.
// Remover na Fase: 3, mantendo cliente_id apenas na persistencia fisica do banco.
async function processarJobsPendentesEngine({ limite = 20, clientesValidos = [], avaliarWorkspaceParaEngine = null } = {}) {
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
    console.log("[ENGINE-WORKER-ERRO]", {
      etapa: "buscar_jobs_pendentes",
      motivo: pendentes.motivo || "buscar_jobs_falhou",
      erro: pendentes.erro || ""
    });
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

  console.log("[ENGINE-WORKER-JOBS-ENCONTRADOS]", {
    statusBuscado: "pendente",
    total: pendentes.jobs.length,
    limite: limiteFinal
  });

  for (const job of pendentes.jobs) {
    console.log("[ENGINE-WORKER-JOB-PROCESSANDO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id,
      marketplace: job.marketplace || job.marketplace_detectado || "",
      status: job.status
    });
    logEngineProcessadorJob({ jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id });

    const lock = await tentarMarcarProcessando(job.id);
    if (!lock.ok) {
      if (lock.ignorado) continue;
      resumo.erros += 1;
      console.log("[ENGINE-WORKER-ERRO]", {
        etapa: "marcar_processando",
        jobId: job.id,
        motivo: lock.motivo || "lock_falhou",
        erro: lock.erro || ""
      });
      logEngineProcessadorErro({ jobId: job.id, etapa: "marcar_processando", motivo: lock.motivo || "lock_falhou", erro: lock.erro || "" });
      continue;
    }

    resumo.processados += 1;

    try {
      const resultado = await processarJobEngine(job, { clientesValidos, avaliarWorkspaceParaEngine });
      if (resultado.ok && resultado.status === "diagnosticado") {
        resumo.diagnosticados += 1;
      } else {
        resumo.erros += 1;
        logEngineProcessadorJobErro(job, resultado);
      }
    } catch (e) {
      resumo.erros += 1;
      logEngineProcessadorJobErro(job, {
        etapa: "processar_job",
        motivo: "erro_inesperado",
        erro: e.message,
        stack: e.stack || ""
      });
      console.log("[ENGINE-WORKER-ERRO]", {
        etapa: "processar_job",
        jobId: job.id,
        motivo: "erro_inesperado",
        erro: e.message
      });
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
