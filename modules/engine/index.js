const {
  initEngineDatabase: initEngineDatabaseBase
} = require("./database");

const {
  registrarEventoBruto
} = require("./inbox.service");

const {
  prepararSchemaEventosComerciaisSeguro
} = require("./ofc/commercial-events.service");

const {
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine,
  executarRetencaoJobsPostgres
} = require("./jobs.service");

async function initEngineDatabase() {
  const resultado = await initEngineDatabaseBase();
  const schemaEventosComerciais = await prepararSchemaEventosComerciaisSeguro();
  if (resultado?.ok) await ignorarJobsAdminNaoOperacional();
  return {
    ...resultado,
    observabilidadeComercial: {
      ok: Boolean(schemaEventosComerciais?.ok),
      failSafe: schemaEventosComerciais?.failSafe || false
    }
  };
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
const {
  executarObservabilidadeOfc,
  coletarMetricasOfc,
  criarPlanoShadowOfc
} = require("./ofc");

module.exports = {
  initEngineDatabase,
  registrarEventoBruto,
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine,
  executarRetencaoJobsPostgres,
  consultarEventosEngine,
  consultarJobsEngine,
  consultarOfertasEngine,
  consultarResumoEngine,
  processarJobsPendentesEngine,
  validarJobsDiagnosticadosEngine,
  importarJobsProntosEngine,
  distribuirOfertasEngine,
  executarObservabilidadeOfc,
  coletarMetricasOfc,
  criarPlanoShadowOfc
};
