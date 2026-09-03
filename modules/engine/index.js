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
  prepararSchemaFinanceiro
} = require("../financeiro/financeiro.repository");

const {
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine,
  executarRetencaoJobsPostgres
} = require("./jobs.service");

function resumoSchemaFinanceiro(resultado = {}) {
  return {
    ok: Boolean(resultado?.ok),
    tabelas: resultado?.tabelas || "",
    motivo: resultado?.motivo || "",
    failSafe: resultado?.failSafe || false,
    pulado: resultado?.pulado || false
  };
}

async function prepararSchemaFinanceiroSeguro(preparar = prepararSchemaFinanceiro) {
  try {
    const resultado = await preparar();
    if (!resultado?.ok) {
      console.log("[FINANCEIRO-SCHEMA-ERRO]", JSON.stringify({
        motivo: resultado?.motivo || "schema_financeiro_falhou",
        erro: String(resultado?.erro || "").slice(0, 180)
      }));
      return {
        ...resultado,
        ok: false,
        failSafe: true
      };
    }

    console.log("[FINANCEIRO-SCHEMA-OK]", JSON.stringify({
      tabelas: resultado.tabelas || "financeiro_v1"
    }));
    return resultado;
  } catch (e) {
    console.log("[FINANCEIRO-SCHEMA-ERRO]", JSON.stringify({
      motivo: "schema_financeiro_exception",
      erro: String(e?.message || "erro_desconhecido").slice(0, 180)
    }));
    return {
      ok: false,
      motivo: "schema_financeiro_exception",
      erro: e?.message || "",
      failSafe: true
    };
  }
}

async function initEngineDatabase(opcoes = {}) {
  const initBase = opcoes.initEngineDatabaseBase || initEngineDatabaseBase;
  const prepararEventosComerciais = opcoes.prepararSchemaEventosComerciaisSeguro || prepararSchemaEventosComerciaisSeguro;
  const prepararFinanceiro = opcoes.prepararSchemaFinanceiro || prepararSchemaFinanceiro;
  const ignorarJobsAdmin = opcoes.ignorarJobsAdminNaoOperacional || ignorarJobsAdminNaoOperacional;

  const resultado = await initBase();
  const schemaEventosComerciais = await prepararEventosComerciais();
  const schemaFinanceiro = resultado?.ok
    ? await prepararSchemaFinanceiroSeguro(prepararFinanceiro)
    : {
        ok: false,
        motivo: resultado?.motivo || "engine_schema_indisponivel",
        pulado: true,
        failSafe: false
      };

  if (resultado?.ok) await ignorarJobsAdmin();
  return {
    ...resultado,
    observabilidadeComercial: {
      ok: Boolean(schemaEventosComerciais?.ok),
      failSafe: schemaEventosComerciais?.failSafe || false
    },
    financeiro: resumoSchemaFinanceiro(schemaFinanceiro)
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
