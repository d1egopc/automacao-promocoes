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
  expirarJobPreImporterSeNecessario,
  resumirSelecaoFrescorPreImporter
} = require("./frescor-pre-importer.service");
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

  for (const job of diagnosticados.jobs) {
    logEngineProcessadorJob({ modo: "validacao", jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id });

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

      const claim = await tentarMarcarValidando(job.id);
      if (!claim.ok || !claim.claimed) {
        resumo.claimsPerdidos += 1;
        continue;
      }

      resumo.processados += 1;
      const resultado = await validarJobDiagnosticadoEngine(job, {
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
      logEngineProcessadorErro({ modo: "validacao", jobId: job.id, etapa: "validar_job", motivo: "erro_validacao", erro: e.message });
      const transicao = await marcarJobStatus(job.id, "erro_validacao", "erro_validacao", {
        statusEsperado: "validando"
      });
      if (transicao.ok) {
        resumo.erro_validacao += 1;
        await registrarProcessamento(job.id, "validacao_final", "erro", "erro_validacao", {
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
