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
  logEngineProcessadorFim
};
