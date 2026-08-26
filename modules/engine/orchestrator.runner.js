let engineOrquestradorRodando = false;
let engineOrquestradorIntervalo = null;

const { executarObservabilidadeOfc } = require("./ofc");
const {
  autoCleanShadowAtivo,
  executarAutoCleanShadowSeguro
} = require("./auto-clean/auto-clean.service");
const {
  criarMedidorEngineMemoryStage,
  registrarPontoEngineMemoryStage,
  resumirJobsPorEtapaEngineMemory
} = require("../telemetria/engine-memory-stage");

function limiteOperacionalSeguro(nomeEnv, padrao, maximo) {
  const configurado = Number(process.env[nomeEnv] || padrao);
  if (!Number.isFinite(configurado) || configurado <= 0) return padrao;
  return Math.max(1, Math.min(Math.floor(configurado), maximo));
}

const LIMITES_PADRAO = {
  processar: limiteOperacionalSeguro("ENGINE_PRE_IMPORTER_BATCH_PROCESSAR", 40, 100),
  validar: limiteOperacionalSeguro("ENGINE_PRE_IMPORTER_BATCH_VALIDAR", 40, 100),
  importar: limiteOperacionalSeguro("ENGINE_PRE_IMPORTER_BATCH_IMPORTAR", 20, 60),
  distribuir: 10
};

function dimensionarLimitePreImporter(limiteBase = 20, totalClientes = 0, maximo = 100) {
  const base = Number(limiteBase || 20);
  const clientes = Math.max(1, Math.floor(Number(totalClientes || 1)));
  const fator = clientes <= 1 ? 1 : Math.min(2.5, 1 + (Math.log2(clientes) / 4));
  const dimensionado = Math.ceil((base * fator) / 5) * 5;
  return Math.max(1, Math.min(dimensionado, maximo));
}

let proximoIdRodadaPerf = 1;
const PERF_BACKGROUND_MIN_MS = Number(process.env.PERF_BACKGROUND_MIN_MS || 200);
const perfBackgroundAtivos = new Map();

function criarRodadaIdPerf() {
  return `engine_${Date.now()}_${proximoIdRodadaPerf++}`;
}

function memoriaPerfResumo() {
  const memoria = process.memoryUsage();
  return {
    heapUsedMb: Math.round(memoria.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memoria.heapTotal / 1024 / 1024),
    rssMb: Math.round(memoria.rss / 1024 / 1024)
  };
}

function logPerfBackground(tag, payload) {
  console.log(`${tag} ${JSON.stringify(payload || {})}`);
}

function iniciarPerfBackground(rotina = "background") {
  const nomeRotina = String(rotina || "background");
  const rodadaId = criarRodadaIdPerf();
  const inicioHr = process.hrtime.bigint();
  const cpuInicio = process.cpuUsage();
  const chamadasAtivas = (perfBackgroundAtivos.get(nomeRotina) || 0) + 1;
  let finalizado = false;
  let inicioLogado = false;

  perfBackgroundAtivos.set(nomeRotina, chamadasAtivas);

  if (chamadasAtivas > 1) {
    logPerfBackground("[PERF BACKGROUND SOBREPOSICAO]", {
      rotina: nomeRotina,
      chamadasAtivas
    });
  }

  const timerInicio = setTimeout(() => {
    if (finalizado) return;
    inicioLogado = true;
    logPerfBackground("[PERF BACKGROUND INICIO]", {
      rotina: nomeRotina,
      rodadaId,
      chamadasAtivas,
      iniciadoEm: new Date().toISOString()
    });
  }, Math.max(1, PERF_BACKGROUND_MIN_MS));
  timerInicio.unref?.();

  return function finalizarPerfBackground(ok = true, extra = {}) {
    if (finalizado) return;
    finalizado = true;
    clearTimeout(timerInicio);
    const atuais = Math.max(0, (perfBackgroundAtivos.get(nomeRotina) || 1) - 1);
    if (atuais > 0) {
      perfBackgroundAtivos.set(nomeRotina, atuais);
    } else {
      perfBackgroundAtivos.delete(nomeRotina);
    }

    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicioHr) / 1e6);
    if (!inicioLogado && duracaoMs < PERF_BACKGROUND_MIN_MS) return;

    const cpu = process.cpuUsage(cpuInicio);
    logPerfBackground("[PERF BACKGROUND FIM]", {
      rotina: nomeRotina,
      rodadaId,
      duracaoMs,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      chamadasAtivas: atuais,
      memoria: memoriaPerfResumo(),
      ok: ok !== false,
      ...extra
    });
  };
}

function resumoItensProcessados(resultado) {
  const dados = resultado?.resultado || resultado || {};
  return {
    processados: Number(dados.processados || dados.processadas || 0),
    diagnosticados: Number(dados.diagnosticados || 0),
    ofertaCriada: Number(dados.ofertaCriada || 0),
    adicionadasFila: Number(dados.adicionadasFila || 0),
    retidas: Number(dados.retidas || dados.retidasV2 || 0),
    erros: Number(dados.erros || 0)
  };
}

function logPerfEtapaEngine({ rodadaId, etapa, inicioMs, itensProcessados = {}, clienteId = "" } = {}) {
  console.log("[PERF EVENT LOOP ETAPA]", {
    rodadaId,
    etapa,
    inicioEm: new Date(inicioMs || Date.now()).toISOString(),
    duracaoMs: Date.now() - (inicioMs || Date.now()),
    itensProcessados,
    clienteId: clienteId || ""
  });
}

function logDiagnosticoOrquestrador(tag, { rodadaId = "", etapa = "", funcao = "", args = {}, inicioMs = null, extra = {} } = {}) {
  const agora = Date.now();
  console.log(tag, {
    rodadaId,
    etapa,
    funcao,
    marketplace: args?.marketplace || "",
    limite: args?.limite || null,
    horario: new Date(agora).toISOString(),
    duracaoMs: inicioMs ? agora - inicioMs : undefined,
    ...extra
  });
}

function chamarFornecedor(fn, fallback) {
  try {
    return typeof fn === "function" ? fn() : fallback;
  } catch {
    return fallback;
  }
}

async function executarEtapa(nome, fn, args = {}, contextoPerf = {}) {
  const inicioEtapaMs = Date.now();
  const funcao = fn?.name || "anonima";
  logDiagnosticoOrquestrador("[ENGINE-ORQUESTRADOR-FUNCAO-INICIO]", {
    rodadaId: contextoPerf.rodadaId || "",
    etapa: nome,
    funcao,
    args,
    inicioMs: inicioEtapaMs
  });
  try {
    const resultado = await fn(args);
    logDiagnosticoOrquestrador("[ENGINE-ORQUESTRADOR-FUNCAO-FIM]", {
      rodadaId: contextoPerf.rodadaId || "",
      etapa: nome,
      funcao,
      args,
      inicioMs: inicioEtapaMs
    });
    logPerfEtapaEngine({
      rodadaId: contextoPerf.rodadaId || "",
      etapa: nome,
      inicioMs: inicioEtapaMs,
      clienteId: args?.clienteId || "",
      itensProcessados: resumoItensProcessados(resultado)
    });
    return { ok: true, nome, resultado };
  } catch (e) {
    logDiagnosticoOrquestrador("[ENGINE-ORQUESTRADOR-FUNCAO-ERRO]", {
      rodadaId: contextoPerf.rodadaId || "",
      etapa: nome,
      funcao,
      args,
      inicioMs: inicioEtapaMs,
      extra: { erro: e.message }
    });
    logPerfEtapaEngine({
      rodadaId: contextoPerf.rodadaId || "",
      etapa: nome,
      inicioMs: inicioEtapaMs,
      clienteId: args?.clienteId || "",
      itensProcessados: { erro: true }
    });
    console.log("[ENGINE-ORQUESTRADOR-ERRO]", {
      etapa: nome,
      erro: e.message
    });
    return { ok: false, nome, erro: e.message };
  }
}

async function executarEtapaRastreada(nome, fn, args = {}, contextoPerf = {}) {
  const inicioMs = Date.now();
  const medidorMemoria = criarMedidorEngineMemoryStage("orchestrator_etapa", {
    rodadaId: contextoPerf.rodadaId || "",
    etapaOrquestrador: nome,
    marketplace: args?.marketplace || "",
    limite: args?.limite || null
  });
  logDiagnosticoOrquestrador("[ENGINE-ORQUESTRADOR-ETAPA-INICIO]", {
    rodadaId: contextoPerf.rodadaId || "",
    etapa: nome,
    funcao: fn?.name || "anonima",
    args,
    inicioMs
  });
  const resultado = await executarEtapa(nome, fn, args, contextoPerf);
  logDiagnosticoOrquestrador("[ENGINE-ORQUESTRADOR-ETAPA-FIM]", {
    rodadaId: contextoPerf.rodadaId || "",
    etapa: nome,
    funcao: fn?.name || "anonima",
    args,
    inicioMs
  });
  medidorMemoria.fim({
    ok: resultado.ok !== false,
    jobsPorEtapa: resumirJobsPorEtapaEngineMemory(resultado)
  });
  return resultado;
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
  const finalizarPerfBackground = iniciarPerfBackground("engine_v2_orquestrador");
  let okPerfBackground = true;
  const inicio = Date.now();
  const rodadaId = criarRodadaIdPerf();
  const medidorRodada = criarMedidorEngineMemoryStage("orchestrator_total", { rodadaId });
  const limitesRodada = { ...LIMITES_PADRAO, ...(limites || {}) };
  const resumo = {
    ok: true,
    rodadaId,
    inicioEm: new Date().toISOString(),
    etapas: {}
  };

  logPerfEtapaEngine({
    rodadaId,
    etapa: "inicio_rodada",
    inicioMs: inicio,
    itensProcessados: { limites: limitesRodada }
  });
  registrarPontoEngineMemoryStage("orchestrator_inicio", {
    rodadaId,
    jobsPorEtapa: {}
  });

  console.log("[ENGINE-ORQUESTRADOR-INICIO]", {
    rodadaId,
    limites: limitesRodada,
    marketplaces: ["mercadolivre", "amazon", "shopee", "awin", "kabum", "magalu"]
  });

  try {
    resumo.etapas.ofc = await executarObservabilidadeOfc({
      rodadaId,
      janelaConsumoMinutos: 15
    });

    if (autoCleanShadowAtivo()) {
      resumo.etapas.autoCleanShadow = await executarEtapaRastreada("auto_clean_shadow", executarAutoCleanShadowSeguro, {
        loteLimite: 100
      }, { rodadaId });
    }

    let inicioFornecedorMs = Date.now();
    const clientesValidosProcessar = chamarFornecedor(getClientesValidos, []);
    logPerfEtapaEngine({
      rodadaId,
      etapa: "buscar_clientes_processar",
      inicioMs: inicioFornecedorMs,
      itensProcessados: { clientes: Array.isArray(clientesValidosProcessar) ? clientesValidosProcessar.length : 0 }
    });

    const limiteProcessar = dimensionarLimitePreImporter(
      limitesRodada.processar,
      Array.isArray(clientesValidosProcessar) ? clientesValidosProcessar.length : 0,
      100
    );

    resumo.etapas.processar = await executarEtapaRastreada("processar", processarJobsPendentesEngine, {
      limite: limiteProcessar,
      clientesValidos: clientesValidosProcessar
    }, { rodadaId });

    inicioFornecedorMs = Date.now();
    const clientesValidosValidar = chamarFornecedor(getClientesValidos, []);
    const integracoesPorCliente = chamarFornecedor(getIntegracoesPorCliente, {});
    const marketplacesAtivosPorCliente = chamarFornecedor(getMarketplacesAtivosPorCliente, {});
    logPerfEtapaEngine({
      rodadaId,
      etapa: "buscar_contexto_validar",
      inicioMs: inicioFornecedorMs,
      itensProcessados: {
        clientes: Array.isArray(clientesValidosValidar) ? clientesValidosValidar.length : 0,
        integracoesClientes: integracoesPorCliente && typeof integracoesPorCliente === "object" ? Object.keys(integracoesPorCliente).length : 0
      }
    });

    const totalClientesValidar = Array.isArray(clientesValidosValidar) ? clientesValidosValidar.length : 0;
    const limiteValidar = dimensionarLimitePreImporter(limitesRodada.validar, totalClientesValidar, 100);
    const limiteImportarPadrao = dimensionarLimitePreImporter(limitesRodada.importar, totalClientesValidar, 60);

    resumo.etapas.validar = await executarEtapaRastreada("validar", validarJobsDiagnosticadosEngine, {
      limite: limiteValidar,
      clientesValidos: clientesValidosValidar,
      integracoesPorCliente,
      marketplacesAtivosPorCliente
    }, { rodadaId });

    inicioFornecedorMs = Date.now();
    const depsImportador = chamarFornecedor(getDepsImportador, {});
    logPerfEtapaEngine({
      rodadaId,
      etapa: "preparar_deps_importador",
      inicioMs: inicioFornecedorMs,
      itensProcessados: { deps: depsImportador && typeof depsImportador === "object" ? Object.keys(depsImportador).length : 0 }
    });

    resumo.etapas.importar = await executarEtapaRastreada("importar_ml", importarJobsProntosEngine, {
      limite: limitesRodada.importarMercadoLivre || limitesRodada.importarMl || limiteImportarPadrao,
      marketplace: "mercadolivre",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarAmazon = await executarEtapaRastreada("importar_amazon", importarJobsProntosEngine, {
      limite: limitesRodada.importarAmazon || limiteImportarPadrao,
      marketplace: "amazon",
      deps: depsImportador
    }, { rodadaId });


    resumo.etapas.importarShopee = await executarEtapaRastreada("importar_shopee", importarJobsProntosEngine, {
      limite: limitesRodada.importarShopee || limiteImportarPadrao,
      marketplace: "shopee",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarAliExpress = await executarEtapaRastreada("importar_aliexpress", importarJobsProntosEngine, {
      limite: limitesRodada.importarAliExpress || limiteImportarPadrao,
      marketplace: "aliexpress",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarAwin = await executarEtapaRastreada("importar_awin", importarJobsProntosEngine, {
      limite: limitesRodada.importarAwin || limiteImportarPadrao,
      marketplace: "awin",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarKabum = await executarEtapaRastreada("importar_kabum", importarJobsProntosEngine, {
      limite: limitesRodada.importarKabum || limiteImportarPadrao,
      marketplace: "kabum",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarMagalu = await executarEtapaRastreada("importar_magalu", importarJobsProntosEngine, {
      limite: limitesRodada.importarMagalu || limiteImportarPadrao,
      marketplace: "magalu",
      deps: depsImportador
    }, { rodadaId });

    inicioFornecedorMs = Date.now();
    const contextoDistribuidor = chamarFornecedor(getContextoDistribuidor, {});
    const depsDistribuidor = chamarFornecedor(getDepsDistribuidor, {});
    logPerfEtapaEngine({
      rodadaId,
      etapa: "preparar_contexto_distribuidor",
      inicioMs: inicioFornecedorMs,
      itensProcessados: {
        clientes: Array.isArray(contextoDistribuidor?.clientesValidos) ? contextoDistribuidor.clientesValidos.length : 0,
        destinosClientes: contextoDistribuidor?.destinosPorCliente && typeof contextoDistribuidor.destinosPorCliente === "object" ? Object.keys(contextoDistribuidor.destinosPorCliente).length : 0,
        deps: depsDistribuidor && typeof depsDistribuidor === "object" ? Object.keys(depsDistribuidor).length : 0
      }
    });

    resumo.etapas.distribuir = await executarEtapaRastreada("distribuir_ml", distribuirOfertasEngine, {
      limite: limitesRodada.distribuir,
      marketplace: "mercadolivre",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirAmazon = await executarEtapaRastreada("distribuir_amazon", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAmazon || limitesRodada.distribuir,
      marketplace: "amazon",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });


    resumo.etapas.distribuirShopee = await executarEtapaRastreada("distribuir_shopee", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirShopee || limitesRodada.distribuir,
      marketplace: "shopee",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirAliExpress = await executarEtapaRastreada("distribuir_aliexpress", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAliExpress || limitesRodada.distribuir,
      marketplace: "aliexpress",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirAwin = await executarEtapaRastreada("distribuir_awin", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAwin || limitesRodada.distribuir,
      marketplace: "awin",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirKabum = await executarEtapaRastreada("distribuir_kabum", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirKabum || limitesRodada.distribuir,
      marketplace: "kabum",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirMagalu = await executarEtapaRastreada("distribuir_magalu", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirMagalu || limitesRodada.distribuir,
      marketplace: "magalu",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.ok = Object.values(resumo.etapas).every(etapa => etapa.ok !== false);
    resumo.duracaoMs = Date.now() - inicio;

    logPerfEtapaEngine({
      rodadaId,
      etapa: "encerramento_rodada",
      inicioMs: inicio,
      itensProcessados: {
        etapas: Object.keys(resumo.etapas).length,
        duracaoMs: resumo.duracaoMs
      }
    });

    console.log("[ENGINE-ORQUESTRADOR-RESUMO]", resumo);
    return resumo;
  } catch (e) {
    okPerfBackground = false;
    logPerfEtapaEngine({
      rodadaId,
      etapa: "erro_rodada",
      inicioMs: inicio,
      itensProcessados: { erro: true }
    });
    console.log("[ENGINE-ORQUESTRADOR-ERRO]", {
      etapa: "rodada",
      erro: e.message
    });
    return { ok: false, erro: e.message };
  } finally {
    engineOrquestradorRodando = false;
    medidorRodada.fim({
      ok: resumo.ok !== false,
      jobsPorEtapa: Object.values(resumo.etapas || {}).reduce((acc, etapa) => {
        const parcial = resumirJobsPorEtapaEngineMemory(etapa);
        for (const [chave, valor] of Object.entries(parcial)) {
          acc[chave] = (acc[chave] || 0) + Number(valor || 0);
        }
        return acc;
      }, {})
    });
    finalizarPerfBackground(okPerfBackground, { engineRodadaId: rodadaId });
  }
}

function iniciarOrquestradorEngine(opcoes = {}) {
  if (engineOrquestradorIntervalo) {
    return { ok: true, jaIniciado: true };
  }

  const intervaloMs = Number(opcoes.intervaloMs || 120000);
  const intervaloFinal = Number.isFinite(intervaloMs) && intervaloMs > 0 ? intervaloMs : 120000;

  console.log("[ENGINE-WORKER-INICIALIZADO]", {
    intervaloMs: intervaloFinal
  });

  engineOrquestradorIntervalo = setInterval(() => {
    console.log("[ENGINE-WORKER-CICLO-INICIO]", {
      intervaloMs: intervaloFinal
    });
    executarRodadaEngineOrquestrador(opcoes).catch((e) => {
      console.log("[ENGINE-WORKER-ERRO]", {
        etapa: "intervalo",
        erro: e.message
      });
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
  executarRodadaEngineOrquestrador,
  dimensionarLimitePreImporter
};
