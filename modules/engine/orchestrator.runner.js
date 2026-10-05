let engineOrquestradorRodando = false;
let engineOrquestradorIntervalo = null;
let engineOrquestradorRodadaAtual = "";
let engineOrquestradorInicioMs = 0;
let engineOrquestradorOfcAtivo = false;
let engineOrquestradorUltimaRodada = { rodadaId: "", inicioMs: 0, fimMs: 0 };
let engineOrquestradorUltimaOfc = { rodadaId: "", inicioMs: 0, fimMs: 0 };
let clonadorGruposEntradaRodando = false;
let clonadorGruposEntradaIntervalo = null;
let clonadorGruposEntradaOpcoes = null;
let clonadorGruposEntradaWakeAgendado = false;
let clonadorGruposEntradaRerunPendente = false;

const { executarObservabilidadeOfc } = require("./ofc");
const { alterarEtapaEngine } = require("../../utils/painel-latencia");
const { createAutoGateShadow } = require("../auto-gate/auto-gate-shadow.service");
const autoGateShadow = createAutoGateShadow();
const { criarMedidorCiclo } = require("../telemetria/ciclo-observabilidade");
const {
  autoCleanShadowAtivo,
  executarAutoCleanShadowSeguro
} = require("./auto-clean/auto-clean.service");
const {
  criarMedidorEngineMemoryStage,
  registrarPontoEngineMemoryStage,
  resumirJobsPorEtapaEngineMemory
} = require("../telemetria/engine-memory-stage");
const { solenoideGlobal } = require("../solenoide/solenoide.service");

const COLETORES_AUTOMATICOS = Object.freeze([
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "awin",
  "kabum",
  "magalu"
]);

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

function obterEstadoOrquestradorEngine() {
  return {
    ativo: engineOrquestradorRodando === true,
    rodadaId: engineOrquestradorRodadaAtual || "",
    iniciadoEmMs: engineOrquestradorInicioMs || 0,
    ofcAtivo: engineOrquestradorOfcAtivo === true,
    ultimaRodada: { ...engineOrquestradorUltimaRodada },
    ultimaOfc: { ...engineOrquestradorUltimaOfc }
  };
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
  if (String(contextoPerf.rodadaId || "").startsWith("engine_")) alterarEtapaEngine(contextoPerf.rodadaId, nome);
  const inicioMs = Date.now();
  const medidorCiclo = contextoPerf.medidorCiclo;
  const inicioPerf = medidorCiclo?.clock();
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
  if (String(contextoPerf.rodadaId || "").startsWith("engine_")) alterarEtapaEngine(contextoPerf.rodadaId, "entre_etapas");
  if (medidorCiclo) medidorCiclo.registrarEtapa(nome, medidorCiclo.clock() - inicioPerf);
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

async function executarImportacaoComSolenoide({
  nome,
  marketplace,
  limite,
  importarJobsProntosEngine,
  depsImportador,
  decisaoSolenoide,
  solenoide,
  rodadaId,
  medidorCiclo
} = {}) {
  const plano = solenoide.planoColetor(decisaoSolenoide, { marketplace, limite });
  const limiteAplicado = plano.executar ? plano.limite : 0;
  const acao = !plano.executar
    ? "pular_importacao"
    : decisaoSolenoide?.estado === "MODERADO" && decisaoSolenoide?.aplicouMudancas === true
      ? "reduzir_lote"
      : "coleta_normal";
  console.log("[SOLENOID IMPORTADOR]", JSON.stringify({
    rodadaId: String(rodadaId || "").slice(0, 100),
    marketplace: String(marketplace || "").slice(0, 40),
    modo: decisaoSolenoide?.modo || "off",
    estado: decisaoSolenoide?.estado || "ABERTO",
    acao,
    limiteOriginal: plano.limiteOriginal,
    limiteAplicado,
    aplicouMudancas: decisaoSolenoide?.aplicouMudancas === true,
    motivo: String(plano.motivo || "").slice(0, 40)
  }));
  if (!plano.executar) {
    return {
      ok: true,
      nome,
      resultado: {
        ok: true,
        pulado: true,
        motivo: plano.motivo,
        marketplace,
        processados: 0
      }
    };
  }
  return executarEtapaRastreada(nome, importarJobsProntosEngine, {
    limite: plano.limite,
    marketplace,
    deps: depsImportador
  }, { rodadaId, medidorCiclo });
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
    solenoide = solenoideGlobal,
    limites = {}
  } = opcoes;

  if (engineOrquestradorRodando) {
    console.log("[ENGINE-ORQUESTRADOR-PULADO-EM-EXECUCAO]", {
      motivo: "rodada_em_execucao",
      rodadaAnteriorId: engineOrquestradorRodadaAtual,
      idadeRodadaAnteriorMs: Math.max(0, Date.now() - engineOrquestradorInicioMs)
    });
    return { ok: true, pulado: true, motivo: "rodada_em_execucao" };
  }

  engineOrquestradorRodando = true;
  const finalizarPerfBackground = iniciarPerfBackground("engine_v2_orquestrador");
  let okPerfBackground = true;
  const inicio = Date.now();
  const cpuInicioRodadaEngine = process.cpuUsage();
  const rodadaId = criarRodadaIdPerf();
  const medidorCiclo = criarMedidorCiclo();
  engineOrquestradorRodadaAtual = rodadaId;
  engineOrquestradorInicioMs = inicio;
  engineOrquestradorOfcAtivo = false;
  engineOrquestradorUltimaRodada = { rodadaId, inicioMs: inicio, fimMs: 0 };
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
  console.log("[ENGINE-RODADA-INICIO]", JSON.stringify({
    rodadaId,
    iniciadoEm: new Date(inicio).toISOString()
  }));

  try {
    alterarEtapaEngine(rodadaId, "ofc");
    engineOrquestradorOfcAtivo = true;
    engineOrquestradorUltimaOfc = { rodadaId, inicioMs: Date.now(), fimMs: 0 };
    try {
      resumo.etapas.ofc = await medidorCiclo.medir("ofc", () => executarObservabilidadeOfc({
        rodadaId,
        janelaConsumoMinutos: 15
      }));
      // Observability must never delay or fail the commercial Engine cycle.
      void autoGateShadow.observe({
        cicloId: rodadaId,
        ofc: resumo.etapas.ofc,
        getRadarOperational: opcoes.getAutoGateRadarOperational,
        getTeleRadarOperational: opcoes.getAutoGateTeleRadarOperational
      }).catch(() => {});
    } finally {
      engineOrquestradorUltimaOfc = {
        ...engineOrquestradorUltimaOfc,
        fimMs: Date.now()
      };
      engineOrquestradorOfcAtivo = false;
      alterarEtapaEngine(rodadaId, "entre_etapas");
    }

    const decisaoSolenoide = solenoide.avaliar({
      ofc: resumo.etapas.ofc,
      rodadaId,
      coletores: COLETORES_AUTOMATICOS
    });
    if (decisaoSolenoide.modo !== "off") resumo.solenoide = decisaoSolenoide;

    if (autoCleanShadowAtivo()) {
      resumo.etapas.autoCleanShadow = await executarEtapaRastreada("auto_clean_shadow", executarAutoCleanShadowSeguro, {
        loteLimite: 100
      }, { rodadaId, medidorCiclo });
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
    }, { rodadaId, medidorCiclo });

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
    }, { rodadaId, medidorCiclo });

    inicioFornecedorMs = Date.now();
    const depsImportador = chamarFornecedor(getDepsImportador, {});
    logPerfEtapaEngine({
      rodadaId,
      etapa: "preparar_deps_importador",
      inicioMs: inicioFornecedorMs,
      itensProcessados: { deps: depsImportador && typeof depsImportador === "object" ? Object.keys(depsImportador).length : 0 }
    });

    const executarImportacao = (nome, marketplace, limite) => executarImportacaoComSolenoide({
      nome,
      marketplace,
      limite,
      importarJobsProntosEngine,
      depsImportador,
      decisaoSolenoide,
      solenoide,
      rodadaId,
      medidorCiclo
    });

    resumo.etapas.importar = await executarImportacao(
      "importar_ml",
      "mercadolivre",
      limitesRodada.importarMercadoLivre || limitesRodada.importarMl || limiteImportarPadrao
    );
    resumo.etapas.importarAmazon = await executarImportacao(
      "importar_amazon", "amazon", limitesRodada.importarAmazon || limiteImportarPadrao
    );
    resumo.etapas.importarShopee = await executarImportacao(
      "importar_shopee", "shopee", limitesRodada.importarShopee || limiteImportarPadrao
    );
    resumo.etapas.importarAliExpress = await executarImportacao(
      "importar_aliexpress", "aliexpress", limitesRodada.importarAliExpress || limiteImportarPadrao
    );
    resumo.etapas.importarAwin = await executarImportacao(
      "importar_awin", "awin", limitesRodada.importarAwin || limiteImportarPadrao
    );
    resumo.etapas.importarKabum = await executarImportacao(
      "importar_kabum", "kabum", limitesRodada.importarKabum || limiteImportarPadrao
    );
    resumo.etapas.importarMagalu = await executarImportacao(
      "importar_magalu", "magalu", limitesRodada.importarMagalu || limiteImportarPadrao
    );

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
    }, { rodadaId, medidorCiclo });

    resumo.etapas.distribuirAmazon = await executarEtapaRastreada("distribuir_amazon", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAmazon || limitesRodada.distribuir,
      marketplace: "amazon",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });


    resumo.etapas.distribuirShopee = await executarEtapaRastreada("distribuir_shopee", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirShopee || limitesRodada.distribuir,
      marketplace: "shopee",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });

    resumo.etapas.distribuirAliExpress = await executarEtapaRastreada("distribuir_aliexpress", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAliExpress || limitesRodada.distribuir,
      marketplace: "aliexpress",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });

    resumo.etapas.distribuirAwin = await executarEtapaRastreada("distribuir_awin", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirAwin || limitesRodada.distribuir,
      marketplace: "awin",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });

    resumo.etapas.distribuirKabum = await executarEtapaRastreada("distribuir_kabum", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirKabum || limitesRodada.distribuir,
      marketplace: "kabum",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });

    resumo.etapas.distribuirMagalu = await executarEtapaRastreada("distribuir_magalu", distribuirOfertasEngine, {
      limite: limitesRodada.distribuirMagalu || limitesRodada.distribuir,
      marketplace: "magalu",
      contexto: contextoDistribuidor,
      deps: depsDistribuidor
    }, { rodadaId, medidorCiclo });

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
    const cpuRodada = process.cpuUsage(cpuInicioRodadaEngine);
    console.log("[ENGINE-RODADA-FIM]", JSON.stringify({
      rodadaId,
      wallMs: Date.now() - inicio,
      cpuProcessoMs: Math.round((cpuRodada.user + cpuRodada.system) / 1000),
      ok: okPerfBackground !== false
    }));
    try {
      console.log("[ENGINE-CICLO-PERF-SHADOW]", JSON.stringify({ rodadaId, modo: "shadow", aplicouMudancas: false,
        ...medidorCiclo.finalizar() }));
    } catch {}
    engineOrquestradorUltimaRodada = { rodadaId, inicioMs: inicio, fimMs: Date.now() };
    engineOrquestradorRodando = false;
    engineOrquestradorRodadaAtual = "";
    engineOrquestradorInicioMs = 0;
    engineOrquestradorOfcAtivo = false;
    alterarEtapaEngine("", "inativo");
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

function solicitarCicloEntradaClonador({ motivo = "captura_persistida" } = {}) {
  const opcoes = clonadorGruposEntradaOpcoes;
  if (typeof opcoes?.processarEntradasClonador !== "function") {
    return { ok: false, agendado: false, motivo: "worker_clonador_nao_inicializado" };
  }

  if (clonadorGruposEntradaRodando) {
    const jaPendente = clonadorGruposEntradaRerunPendente;
    clonadorGruposEntradaRerunPendente = true;
    if (!jaPendente) {
      console.log("[CLONADOR-GRUPOS-ENTRADA-WAKE-COALESCIDO]", {
        motivo,
        estado: "rodada_em_execucao",
        rerunPendente: true
      });
    }
    return { ok: true, agendado: false, coalescido: true, rerunPendente: true };
  }

  if (clonadorGruposEntradaWakeAgendado) {
    return { ok: true, agendado: false, coalescido: true, rerunPendente: false };
  }

  const setImmediateFn = typeof opcoes.setImmediateFn === "function" ? opcoes.setImmediateFn : setImmediate;
  clonadorGruposEntradaWakeAgendado = true;

  try {
    setImmediateFn(() => {
      clonadorGruposEntradaWakeAgendado = false;
      executarCicloEntradaClonador({ ...opcoes, origemCicloClonador: "wake" }).catch((erro) => {
        console.log("[CLONADOR-GRUPOS-ENTRADA-WAKE-ERRO]", {
          motivo,
          erro: erro.message || "wake_clonador_falhou"
        });
      });
    });
  } catch (erro) {
    clonadorGruposEntradaWakeAgendado = false;
    console.log("[CLONADOR-GRUPOS-ENTRADA-WAKE-ERRO]", {
      motivo,
      erro: erro.message || "wake_clonador_agendamento_falhou"
    });
    return { ok: false, agendado: false, motivo: "wake_clonador_agendamento_falhou" };
  }

  return { ok: true, agendado: true, coalescido: false, rerunPendente: false };
}

async function executarCicloEntradaClonador(opcoes = {}) {
  const { processarEntradasClonador } = opcoes;

  if (typeof processarEntradasClonador !== "function") {
    return { ok: false, motivo: "processar_entradas_clonador_indisponivel" };
  }

  if (clonadorGruposEntradaRodando) {
    console.log("[CLONADOR-GRUPOS-ENTRADA-PULADO-EM-EXECUCAO]", {
      motivo: "rodada_em_execucao"
    });
    return { ok: true, pulado: true, motivo: "rodada_em_execucao" };
  }

  clonadorGruposEntradaRodando = true;
  const rodadaId = `clonador_grupos_entrada_${Date.now()}`;
  let resultadoCiclo = null;

  try {
    resultadoCiclo = await executarEtapaRastreada("clonador_grupos_entrada", processarEntradasClonador, {}, { rodadaId });
    return resultadoCiclo;
  } catch (e) {
    console.log("[CLONADOR-GRUPOS-ENTRADA-ERRO]", {
      etapa: "intervalo",
      erro: e.message
    });
    return { ok: false, nome: "clonador_grupos_entrada", erro: e.message };
  } finally {
    const rerunSolicitado = clonadorGruposEntradaRerunPendente;
    const deveDrenarWake = opcoes.origemCicloClonador === "wake" &&
      resultadoCiclo?.ok === true &&
      Number(resultadoCiclo?.resultado?.processadas || 0) > 0;
    clonadorGruposEntradaRerunPendente = false;
    clonadorGruposEntradaRodando = false;
    if (rerunSolicitado || deveDrenarWake) {
      solicitarCicloEntradaClonador({
        motivo: rerunSolicitado ? "rerun_pendente" : "drenagem_wake"
      });
    }
  }
}

function iniciarCicloEntradaClonador(opcoes = {}) {
  if (clonadorGruposEntradaIntervalo) {
    return { ok: true, jaIniciado: true };
  }

  const intervaloMs = Number(opcoes.intervaloMs || 120000);
  const intervaloFinal = Number.isFinite(intervaloMs) && intervaloMs > 0 ? intervaloMs : 120000;
  const setIntervalFn = typeof opcoes.setIntervalFn === "function" ? opcoes.setIntervalFn : setInterval;
  clonadorGruposEntradaOpcoes = { ...opcoes, intervaloMs: intervaloFinal };

  console.log("[CLONADOR-GRUPOS-ENTRADA-WORKER-INICIALIZADO]", {
    intervaloMs: intervaloFinal
  });

  clonadorGruposEntradaIntervalo = setIntervalFn(() => {
    console.log("[CLONADOR-GRUPOS-ENTRADA-CICLO-INICIO]", {
      intervaloMs: intervaloFinal
    });
    executarCicloEntradaClonador({ ...clonadorGruposEntradaOpcoes, origemCicloClonador: "poll" }).catch((e) => {
      console.log("[CLONADOR-GRUPOS-ENTRADA-WORKER-ERRO]", {
        etapa: "intervalo",
        erro: e.message
      });
    });
  }, intervaloFinal);

  if (typeof clonadorGruposEntradaIntervalo?.unref === "function") {
    clonadorGruposEntradaIntervalo.unref();
  }

  return { ok: true, intervaloMs: intervaloFinal };
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
  iniciarCicloEntradaClonador,
  solicitarCicloEntradaClonador,
  executarRodadaEngineOrquestrador,
  executarCicloEntradaClonador,
  dimensionarLimitePreImporter,
  executarImportacaoComSolenoide,
  obterEstadoOrquestradorEngine
};
