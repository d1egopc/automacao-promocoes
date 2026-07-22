let engineOrquestradorRodando = false;
let engineOrquestradorIntervalo = null;

const LIMITES_PADRAO = {
  processar: 30,
  validar: 30,
  importar: 10,
  distribuir: 10
};

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

function chamarFornecedor(fn, fallback) {
  try {
    return typeof fn === "function" ? fn() : fallback;
  } catch {
    return fallback;
  }
}

async function executarEtapa(nome, fn, args = {}, contextoPerf = {}) {
  const inicioEtapaMs = Date.now();
  try {
    const resultado = await fn(args);
    logPerfEtapaEngine({
      rodadaId: contextoPerf.rodadaId || "",
      etapa: nome,
      inicioMs: inicioEtapaMs,
      clienteId: args?.clienteId || "",
      itensProcessados: resumoItensProcessados(resultado)
    });
    return { ok: true, nome, resultado };
  } catch (e) {
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

  console.log("[ENGINE-ORQUESTRADOR-INICIO]", {
    rodadaId,
    limites: limitesRodada,
    marketplaces: ["mercadolivre", "amazon", "shopee", "awin", "kabum"]
  });

  try {
    let inicioFornecedorMs = Date.now();
    const clientesValidosProcessar = chamarFornecedor(getClientesValidos, []);
    logPerfEtapaEngine({
      rodadaId,
      etapa: "buscar_clientes_processar",
      inicioMs: inicioFornecedorMs,
      itensProcessados: { clientes: Array.isArray(clientesValidosProcessar) ? clientesValidosProcessar.length : 0 }
    });

    resumo.etapas.processar = await executarEtapa("processar", processarJobsPendentesEngine, {
      limite: limitesRodada.processar,
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

    resumo.etapas.validar = await executarEtapa("validar", validarJobsDiagnosticadosEngine, {
      limite: limitesRodada.validar,
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

    resumo.etapas.importar = await executarEtapa("importar_ml", importarJobsProntosEngine, {
      limite: limitesRodada.importar,
      marketplace: "mercadolivre",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarAmazon = await executarEtapa("importar_amazon", importarJobsProntosEngine, {
      limite: limitesRodada.importarAmazon || limitesRodada.importar,
      marketplace: "amazon",
      deps: depsImportador
    }, { rodadaId });


    resumo.etapas.importarShopee = await executarEtapa("importar_shopee", importarJobsProntosEngine, {
      limite: limitesRodada.importarShopee || limitesRodada.importar,
      marketplace: "shopee",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarAwin = await executarEtapa("importar_awin", importarJobsProntosEngine, {
      limite: limitesRodada.importarAwin || limitesRodada.importar,
      marketplace: "awin",
      deps: depsImportador
    }, { rodadaId });

    resumo.etapas.importarKabum = await executarEtapa("importar_kabum", importarJobsProntosEngine, {
      limite: limitesRodada.importarKabum || limitesRodada.importar,
      marketplace: "kabum",
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

    resumo.etapas.distribuir = await executarEtapa("distribuir_ml", distribuirOfertasEngine, {
      limite: limitesRodada.distribuir,
      marketplace: "mercadolivre",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });

    resumo.etapas.distribuirAmazon = await executarEtapa("distribuir_amazon", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAmazon || limitesRodada.distribuir,
      marketplace: "amazon",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId });


    resumo.etapas.distribuirShopee = await executarEtapa("distribuir_shopee", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirShopee || limitesRodada.distribuir,
      marketplace: "shopee",
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
    finalizarPerfBackground(okPerfBackground, { engineRodadaId: rodadaId });
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
