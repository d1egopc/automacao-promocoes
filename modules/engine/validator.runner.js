const {
  buscarJobsDiagnosticados,
  validarJobDiagnosticadoEngine
} = require("./validator.service");
const {
  limitarJobs,
  marcarJobStatus,
  registrarProcessamento
} = require("./processor.service");
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
    erro_validacao: 0
  };

  logEngineProcessadorInicio({ modo: "validacao", limite: limiteFinal });

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

  for (const job of diagnosticados.jobs) {
    resumo.processados += 1;
    logEngineProcessadorJob({ modo: "validacao", jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id });

    try {
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
      resumo.erro_validacao += 1;
      logEngineProcessadorErro({ modo: "validacao", jobId: job.id, etapa: "validar_job", motivo: "erro_validacao", erro: e.message });
      await registrarProcessamento(job.id, "validacao_final", "erro", "erro_validacao", {
        fase: "validacao",
        erro: e.message
      });
      await marcarJobStatus(job.id, "erro_validacao", "erro_validacao");
    }
  }

  logEngineProcessadorFim({ modo: "validacao", ...resumo });
  return resumo;
}

module.exports = {
  validarJobsDiagnosticadosEngine
};