const {
  initEngineDatabase: initEngineDatabaseBase
} = require("./database");

const {
  registrarEventoBruto
} = require("./inbox.service");

const {
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine
} = require("./jobs.service");

async function initEngineDatabase() {
  const resultado = await initEngineDatabaseBase();
  if (resultado?.ok) await ignorarJobsAdminNaoOperacional();
  return resultado;
}

const {
  consultarEventosEngine,
  consultarJobsEngine,
  consultarOfertasEngine,
  consultarResumoEngine
} = require("./audit.service");

const {
  processarJobsPendentesEngine
} = require("./processor.runner");

const {
  validarJobsDiagnosticadosEngine
} = require("./validator.runner");

const {
  importarJobsProntosEngine
} = require("./importer/importer.runner");
const {
  distribuirOfertasEngine
} = require("./distributor");

module.exports = {
  initEngineDatabase,
  registrarEventoBruto,
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine,
  consultarEventosEngine,
  consultarJobsEngine,
  consultarOfertasEngine,
  consultarResumoEngine,
  processarJobsPendentesEngine,
  validarJobsDiagnosticadosEngine,
  importarJobsProntosEngine,
  distribuirOfertasEngine
};
