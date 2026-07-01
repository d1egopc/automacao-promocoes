function logEngine(tag, dados = {}) {
  try {
    console.log(tag, dados);
  } catch {
    console.log(tag);
  }
}

function logEngineDbOk(dados = {}) {
  logEngine("[ENGINE-DB-OK]", dados);
}

function logEngineDbErro(dados = {}) {
  logEngine("[ENGINE-DB-ERRO]", dados);
}

function logEngineEventoBrutoSalvo(dados = {}) {
  logEngine("[ENGINE-EVENTO-BRUTO-SALVO]", dados);
}

function logEngineEventoBrutoDuplicado(dados = {}) {
  logEngine("[ENGINE-EVENTO-BRUTO-DUPLICADO]", dados);
}

function logEngineEventoBrutoErro(dados = {}) {
  logEngine("[ENGINE-EVENTO-BRUTO-ERRO]", dados);
}

function logEngineJobClienteCriado(dados = {}) {
  logEngine("[ENGINE-JOB-CLIENTE-CRIADO]", dados);
}

function logEngineJobClienteErro(dados = {}) {
  logEngine("[ENGINE-JOB-CLIENTE-ERRO]", dados);
}

function logEngineAuditoriaConsulta(dados = {}) {
  logEngine("[ENGINE-AUDITORIA-CONSULTA]", dados);
}

function logEngineProcessadorInicio(dados = {}) {
  logEngine("[ENGINE-PROCESSADOR-INICIO]", dados);
}

function logEngineProcessadorJob(dados = {}) {
  logEngine("[ENGINE-PROCESSADOR-JOB]", dados);
}

function logEngineProcessadorEtapa(dados = {}) {
  logEngine("[ENGINE-PROCESSADOR-ETAPA]", dados);
}

function logEngineProcessadorErro(dados = {}) {
  logEngine("[ENGINE-PROCESSADOR-ERRO]", dados);
}

function logEngineProcessadorFim(dados = {}) {
  logEngine("[ENGINE-PROCESSADOR-FIM]", dados);
}

function logEngineImporterInicio(dados = {}) {
  logEngine("[ENGINE-IMPORTER-INICIO]", dados);
}

function logEngineImporterJob(dados = {}) {
  logEngine("[ENGINE-IMPORTER-JOB]", dados);
}

function logEngineImporterAdapter(dados = {}) {
  logEngine("[ENGINE-IMPORTER-ADAPTER]", dados);
}

function logEngineImporterOfertaCriada(dados = {}) {
  logEngine("[ENGINE-IMPORTER-OFERTA-CRIADA]", dados);
}

function logEngineImporterErro(dados = {}) {
  logEngine("[ENGINE-IMPORTER-ERRO]", dados);
}

function logEngineImporterFim(dados = {}) {
  logEngine("[ENGINE-IMPORTER-FIM]", dados);
}
function logEngineDistribuidorInicio(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-INICIO]", dados);
}

function logEngineDistribuidorOferta(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-OFERTA]", dados);
}

function logEngineDistribuidorFila(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-FILA]", dados);
}

function logEngineDistribuidorRetida(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-RETIDA]", dados);
}

function logEngineDistribuidorErro(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-ERRO]", dados);
}

function logEngineDistribuidorFim(dados = {}) {
  logEngine("[ENGINE-DISTRIBUIDOR-FIM]", dados);
}

module.exports = {
  logEngineDbOk,
  logEngineDbErro,
  logEngineEventoBrutoSalvo,
  logEngineEventoBrutoDuplicado,
  logEngineEventoBrutoErro,
  logEngineJobClienteCriado,
  logEngineJobClienteErro,
  logEngineAuditoriaConsulta,
  logEngineProcessadorInicio,
  logEngineProcessadorJob,
  logEngineProcessadorEtapa,
  logEngineProcessadorErro,
  logEngineProcessadorFim,
  logEngineImporterInicio,
  logEngineImporterJob,
  logEngineImporterAdapter,
  logEngineImporterOfertaCriada,
  logEngineImporterErro,
  logEngineImporterFim,
  logEngineDistribuidorInicio,
  logEngineDistribuidorOferta,
  logEngineDistribuidorFila,
  logEngineDistribuidorRetida,
  logEngineDistribuidorErro,
  logEngineDistribuidorFim
};
