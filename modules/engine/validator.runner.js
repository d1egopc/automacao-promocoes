const {
  buscarJobsDiagnosticados,
  tentarMarcarValidando,
  recuperarJobsValidandoStale,
  validarJobDiagnosticadoEngine
} = require("./validator.service");
const {
  limitarJobs,
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
} = require("./validator-fairness.service");
const {
  logEngineProcessadorInicio,
  logEngineProcessadorJob,
  logEngineProcessadorErro,
  logEngineProcessadorFim
} = require("./logger");

async function validarJobsDiagnosticadosEngine({ limite = 20, clientesValidos = [], integracoesPorCliente = {}, marketplacesAtivosPorCliente = {} } = {}) {
  const limiteFinal = limitarJobs(limite);
  const resumo = {
    ok: true,
    processados: 0,
    pronto_para_importar: 0,
    integracao_ausente: 0,
    cliente_invalido: 0,
    marketplace_bloqueado: 0,
    erro_validacao: 0,
    frescosSelecionados: 0,
    expiradosPreImporter: 0,
    expiradosCandidatosPreImporter: 0,
    idadeMediaJobsSelecionadosMs: 0,
    recuperadosValidandoStale: 0,
    claimsPerdidos: 0
  };

  logEngineProcessadorInicio({ modo: "validacao", limite: limiteFinal });

  const recovery = await recuperarJobsValidandoStale(limiteFinal);
  if (!recovery.ok) {
    logEngineProcessadorErro({ etapa: "recuperar_validando_stale", motivo: recovery.motivo || "recovery_validacao_falhou", erro: recovery.erro || "" });
    return {
      ...resumo,
      ok: false,
      motivo: recovery.motivo || "recovery_validacao_falhou",
      erro: recovery.erro || ""
    };
  }
  resumo.recuperadosValidandoStale = recovery.recuperados;

  const diagnosticados = await buscarJobsDiagnosticados(limiteFinal);
  if (!diagnosticados.ok) {
    logEngineProcessadorErro({ etapa: "buscar_diagnosticados", motivo: diagnosticados.motivo || "buscar_jobs_falhou", erro: diagnosticados.erro || "" });
    return {
      ...resumo,
      ok: false,
      motivo: diagnosticados.motivo || "buscar_jobs_falhou",
      erro: diagnosticados.erro || ""
    };
  }

  const metricasSelecao = resumirSelecaoFrescorPreImporter(diagnosticados.jobs);
  resumo.frescosSelecionados = metricasSelecao.frescosSelecionados;
  resumo.expiradosCandidatosPreImporter = metricasSelecao.expiradosCandidatos;
  resumo.idadeMediaJobsSelecionadosMs = metricasSelecao.idadeMediaJobsSelecionadosMs;

  const baselineComIndice = diagnosticados.jobs.map((job, indiceBaseline) => ({ ...job, indiceBaseline }));
  const indiceBaselinePorId = new Map(baselineComIndice.map(job => [Number(job.id), job.indiceBaseline]));
  const candidatosElegiveis = (diagnosticados.candidatePool || [])
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
    logEngineProcessadorJob({ modo: "validacao", jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id });
    let jobConfirmado = job;

    try {
      const frescorPreImporter = await expirarJobPreImporterSeNecessario(job, {
        registrarProcessamento,
        marcarJobStatus,
        statusEsperado: "diagnosticado"
      });
      if (frescorPreImporter.expirou) {
        resumo.expiradosPreImporter += 1;
        continue;
      }

      const grupo = gruposFairness.get(chaveGrupo(job));
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
          if (!jobConfirmado) {
            resumo.claimsPerdidos += 1;
            continue;
          }
        }
      }

      if (!grupo || !gruposReivindicados.get(grupo.chave)?.ok) {
        const claim = await tentarMarcarValidando(job.id);
        if (!claim.ok || !claim.claimed) {
          resumo.claimsPerdidos += 1;
          continue;
        }
      }

      resumo.processados += 1;
      const resultado = await validarJobDiagnosticadoEngine(jobConfirmado, {
        clientesValidos,
        integracoesPorCliente,
        marketplacesAtivosPorCliente
      });

      if (Object.prototype.hasOwnProperty.call(resumo, resultado.status)) {
        resumo[resultado.status] += 1;
      } else {
        resumo.erro_validacao += 1;
      }
    } catch (e) {
      logEngineProcessadorErro({ modo: "validacao", jobId: jobConfirmado.id, etapa: "validar_job", motivo: "erro_validacao", erro: e.message });
      const transicao = await marcarJobStatus(jobConfirmado.id, "erro_validacao", "erro_validacao", {
        statusEsperado: "validando"
      });
      if (transicao.ok) {
        resumo.erro_validacao += 1;
        await registrarProcessamento(jobConfirmado.id, "validacao_final", "erro", "erro_validacao", {
          fase: "validacao",
          erro: e.message
        });
      } else {
        resumo.claimsPerdidos += 1;
      }
    }
  }

  logEngineProcessadorFim({ modo: "validacao", ...resumo });
  return resumo;
}

module.exports = {
  validarJobsDiagnosticadosEngine
};
