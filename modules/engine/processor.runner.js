const {
  buscarJobsPendentes,
  limitarJobs,
  tentarMarcarProcessando,
  marcarJobStatus,
  registrarProcessamento
} = require("./processor.service");
const {
  avaliarFrescorPreImporter,
  expirarJobPreImporterSeNecessario,
  resumirSelecaoFrescorPreImporter
} = require("./frescor-pre-importer.service");
const {
  chaveGrupo,
  montarGruposFairness,
  headsProtegidas,
  reivindicarGrupoFairness
} = require("./processor-fairness.service");
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
    erros: 0,
    frescosSelecionados: 0,
    expiradosPreImporter: 0,
    expiradosCandidatosPreImporter: 0,
    idadeMediaJobsSelecionadosMs: 0
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

  const metricasSelecao = resumirSelecaoFrescorPreImporter(pendentes.jobs);
  resumo.frescosSelecionados = metricasSelecao.frescosSelecionados;
  resumo.expiradosCandidatosPreImporter = metricasSelecao.expiradosCandidatos;
  resumo.idadeMediaJobsSelecionadosMs = metricasSelecao.idadeMediaJobsSelecionadosMs;

  const baselineComIndice = pendentes.jobs.map((job, indiceBaseline) => ({ ...job, indiceBaseline }));
  const indiceBaselinePorId = new Map(baselineComIndice.map(job => [Number(job.id), job.indiceBaseline]));
  const candidatosElegiveis = (pendentes.candidatePool || [])
    // Nao e um ranking novo: reaplica o mesmo gate comercial que o runner
    // ja executa antes do claim dos jobs do baseline. Isso evita promover uma
    // head turbo ja expirada apenas porque ela veio do candidate pool.
    .filter(job => !avaliarFrescorPreImporter(job).expirada)
    .map(job => ({ ...job, indiceBaseline: indiceBaselinePorId.get(Number(job.id)) }));
  const gruposFairness = new Map(
    montarGruposFairness(
      baselineComIndice.filter(job => job.lane_vazao_pre_importer !== "expirada"),
      candidatosElegiveis
    )
      .filter(grupo => headsProtegidas(grupo).size === 2)
      .map(grupo => [grupo.chave, grupo])
  );
  const gruposReivindicados = new Map();
  const confirmadosPorPosicao = new Map();

  for (const job of baselineComIndice) {
    const frescorPreImporter = await expirarJobPreImporterSeNecessario(job, {
      registrarProcessamento,
      marcarJobStatus,
      statusEsperado: "pendente"
    });
    if (frescorPreImporter.expirou) {
      resumo.expiradosPreImporter += 1;
      continue;
    }

    const grupo = gruposFairness.get(chaveGrupo(job));
    let jobConfirmado = job;
    if (grupo) {
      if (!gruposReivindicados.has(grupo.chave)) {
        const resultadoFairness = await reivindicarGrupoFairness(grupo);
        gruposReivindicados.set(grupo.chave, resultadoFairness);
        if (resultadoFairness.ok) {
          for (const confirmado of resultadoFairness.confirmados) {
            confirmadosPorPosicao.set(Number(confirmado.posicao), confirmado.job);
          }
        }
      }
      const resultadoFairness = gruposReivindicados.get(grupo.chave);
      if (resultadoFairness?.ok) {
        jobConfirmado = confirmadosPorPosicao.get(Number(job.indiceBaseline));
        if (!jobConfirmado) continue;
      }
    }

    if (!grupo || !gruposReivindicados.get(grupo.chave)?.ok) {
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
    }

    console.log("[ENGINE-WORKER-JOB-PROCESSANDO]", {
      jobId: jobConfirmado.id,
      eventoId: jobConfirmado.evento_id,
      clienteId: jobConfirmado.cliente_id,
      marketplace: jobConfirmado.marketplace || jobConfirmado.marketplace_detectado || "",
      status: jobConfirmado.status
    });
    logEngineProcessadorJob({
      jobId: jobConfirmado.id,
      eventoId: jobConfirmado.evento_id,
      clienteId: jobConfirmado.cliente_id
    });

    resumo.processados += 1;

    try {
      const resultado = await processarJobEngine(jobConfirmado, { clientesValidos, avaliarWorkspaceParaEngine });
      if (resultado.ok && resultado.status === "diagnosticado") {
        resumo.diagnosticados += 1;
      } else {
        resumo.erros += 1;
        logEngineProcessadorJobErro(jobConfirmado, resultado);
      }
    } catch (e) {
      resumo.erros += 1;
      logEngineProcessadorJobErro(jobConfirmado, {
        etapa: "processar_job",
        motivo: "erro_inesperado",
        erro: e.message,
        stack: e.stack || ""
      });
      console.log("[ENGINE-WORKER-ERRO]", {
        etapa: "processar_job",
        jobId: jobConfirmado.id,
        motivo: "erro_inesperado",
        erro: e.message
      });
      logEngineProcessadorErro({ jobId: jobConfirmado.id, etapa: "processar_job", motivo: "erro_inesperado", erro: e.message });
      await registrarProcessamento(jobConfirmado.id, "diagnostico_final", "erro", "erro_inesperado", { erro: e.message });
      await marcarJobStatus(jobConfirmado.id, "erro", "erro_inesperado", { statusEsperado: "processando" });
    }
  }

  logEngineProcessadorFim(resumo);
  return resumo;
}

module.exports = {
  processarJobsPendentesEngine
};
