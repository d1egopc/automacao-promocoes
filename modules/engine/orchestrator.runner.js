let engineOrquestradorRodando = false;
let engineOrquestradorIntervalo = null;

const LIMITES_PADRAO = {
  processar: 30,
  validar: 30,
  importar: 10,
  distribuir: 10
};

function chamarFornecedor(fn, fallback) {
  try {
    return typeof fn === "function" ? fn() : fallback;
  } catch {
    return fallback;
  }
}

async function executarEtapa(nome, fn, args = {}) {
  try {
    const resultado = await fn(args);
    return { ok: true, nome, resultado };
  } catch (e) {
    console.log("[ENGINE-ORQUESTRADOR-ERRO]", {
      etapa: nome,
      erro: e.message
    });
    return { ok: false, nome, erro: e.message };
  }
}

async function executarRodadaEngineOrquestrador(opcoes = {}) {
  const {
    processarJobsPendentesEngine,
    validarJobsDiagnosticadosEngine,
    importarJobsProntosEngine,
    distribuirOfertasEngine,
    getClientesValidos,
    getIntegracoesPorCliente,
    getMarketplacesAtivosPorCliente,
    getContextoDistribuidor,
    getDepsImportador,
    getDepsDistribuidor,
    limites = {}
  } = opcoes;

  if (engineOrquestradorRodando) {
    console.log("[ENGINE-ORQUESTRADOR-PULADO-EM-EXECUCAO]", {
      motivo: "rodada_em_execucao"
    });
    return { ok: true, pulado: true, motivo: "rodada_em_execucao" };
  }

  engineOrquestradorRodando = true;
  const inicio = Date.now();
  const limitesRodada = { ...LIMITES_PADRAO, ...(limites || {}) };
  const resumo = {
    ok: true,
    inicioEm: new Date().toISOString(),
    etapas: {}
  };

  console.log("[ENGINE-ORQUESTRADOR-INICIO]", {
    limites: limitesRodada,
    marketplaces: ["mercadolivre", "amazon", "shopee"]
  });

  try {
    const clientesValidosProcessar = chamarFornecedor(getClientesValidos, []);
    resumo.etapas.processar = await executarEtapa("processar", processarJobsPendentesEngine, {
      limite: limitesRodada.processar,
      clientesValidos: clientesValidosProcessar
    });

    const clientesValidosValidar = chamarFornecedor(getClientesValidos, []);
    resumo.etapas.validar = await executarEtapa("validar", validarJobsDiagnosticadosEngine, {
      limite: limitesRodada.validar,
      clientesValidos: clientesValidosValidar,
      integracoesPorCliente: chamarFornecedor(getIntegracoesPorCliente, {}),
      marketplacesAtivosPorCliente: chamarFornecedor(getMarketplacesAtivosPorCliente, {})
    });

    const depsImportador = chamarFornecedor(getDepsImportador, {});

    resumo.etapas.importar = await executarEtapa("importar_ml", importarJobsProntosEngine, {
      limite: limitesRodada.importar,
      marketplace: "mercadolivre",
      deps: depsImportador
    });

    resumo.etapas.importarAmazon = await executarEtapa("importar_amazon", importarJobsProntosEngine, {
      limite: limitesRodada.importarAmazon || limitesRodada.importar,
      marketplace: "amazon",
      deps: depsImportador
    });


    resumo.etapas.importarShopee = await executarEtapa("importar_shopee", importarJobsProntosEngine, {
      limite: limitesRodada.importarShopee || limitesRodada.importar,
      marketplace: "shopee",
      deps: depsImportador
    });

    const contextoDistribuidor = chamarFornecedor(getContextoDistribuidor, {});
    const depsDistribuidor = chamarFornecedor(getDepsDistribuidor, {});

    resumo.etapas.distribuir = await executarEtapa("distribuir_ml", distribuirOfertasEngine, {
      limite: limitesRodada.distribuir,
      marketplace: "mercadolivre",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    });

    resumo.etapas.distribuirAmazon = await executarEtapa("distribuir_amazon", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAmazon || limitesRodada.distribuir,
      marketplace: "amazon",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    });


    resumo.etapas.distribuirShopee = await executarEtapa("distribuir_shopee", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirShopee || limitesRodada.distribuir,
      marketplace: "shopee",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    });

    resumo.ok = Object.values(resumo.etapas).every(etapa => etapa.ok !== false);
    resumo.duracaoMs = Date.now() - inicio;

    console.log("[ENGINE-ORQUESTRADOR-RESUMO]", resumo);
    return resumo;
  } catch (e) {
    console.log("[ENGINE-ORQUESTRADOR-ERRO]", {
      etapa: "rodada",
      erro: e.message
    });
    return { ok: false, erro: e.message };
  } finally {
    engineOrquestradorRodando = false;
  }
}

function iniciarOrquestradorEngine(opcoes = {}) {
  if (engineOrquestradorIntervalo) {
    return { ok: true, jaIniciado: true };
  }

  const intervaloMs = Number(opcoes.intervaloMs || 120000);
  const intervaloFinal = Number.isFinite(intervaloMs) && intervaloMs > 0 ? intervaloMs : 120000;

  engineOrquestradorIntervalo = setInterval(() => {
    executarRodadaEngineOrquestrador(opcoes).catch((e) => {
      console.log("[ENGINE-ORQUESTRADOR-ERRO]", {
        etapa: "intervalo",
        erro: e.message
      });
    });
  }, intervaloFinal);

  if (typeof engineOrquestradorIntervalo.unref === "function") {
    engineOrquestradorIntervalo.unref();
  }

  return { ok: true, intervaloMs: intervaloFinal };
}

module.exports = {
  iniciarOrquestradorEngine,
  executarRodadaEngineOrquestrador
};
