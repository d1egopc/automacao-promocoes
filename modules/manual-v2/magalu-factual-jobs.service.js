"use strict";

const {
  detectarMarketplaceManualV2,
  importarUrlManualV2
} = require("./manual-import.adapters");
const {
  produtoIdPorUrl
} = require("../marketplaces/magalu/magalu-parser");
const {
  chaveCacheFactualMagalu
} = require("../marketplaces/magalu/magalu-factual-resolver");

const JOB_HARD_TIMEOUT_MS = 75 * 1000;
const JOB_TTL_CONCLUIDO_MS = 10 * 60 * 1000;
const JOB_TTL_ERRO_MS = 10 * 60 * 1000;
const JOB_TTL_EXPIRADO_MS = 5 * 60 * 1000;
const METRICAS_JANELA_MAX = 200;
const POLLING_TIMEOUT_MS = 60 * 1000;
const POLLING_INTERVAL_MS = 1500;
const POLITICA_MANUAL_ASSINCRONA = Object.freeze({
  timeoutMs: 5000,
  retries: 2,
  retryDelayMs: 250
});

const jobs = new Map();
const jobsEmAndamento = new Map();
const metricasRecentes = [];

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function agoraMs(deps = {}) {
  return Date.parse(agoraIso(deps)) || Date.now();
}

function memoriaMb() {
  const uso = typeof process.memoryUsage === "function" ? process.memoryUsage() : {};
  return Number(((uso.rss || 0) / 1024 / 1024).toFixed(2));
}

function idJob(deps = {}) {
  if (typeof deps.idFactory === "function") return texto(deps.idFactory());
  return `manual_v2_magalu_factual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function integracaoPromoterId(clienteId = "", importOptions = {}) {
  if (typeof importOptions.getIntegracaoCliente !== "function") return "";
  const integracao = importOptions.getIntegracaoCliente(clienteId, "magalu");
  return texto(integracao?.credenciais?.promoterId || integracao?.promoterId);
}

function chaveJob({ clienteId = "", urlOriginal = "", importOptions = {} } = {}) {
  const promoterId = integracaoPromoterId(clienteId, importOptions);
  const chaveFactual = chaveCacheFactualMagalu({ urlOriginal, promoterId });
  const produtoId = produtoIdPorUrl(urlOriginal);
  if (!produtoId) return "";
  return [clienteId, chaveFactual || produtoId].map(texto).join("|");
}

function hardTimeoutMs(deps = {}) {
  const temOverrideTeste = Object.prototype.hasOwnProperty.call(deps, "hardTimeoutMs");
  const numero = Number(temOverrideTeste ? deps.hardTimeoutMs : process.env.MAGALU_MANUAL_JOB_HARD_TIMEOUT_MS);
  if (!Number.isFinite(numero) || numero <= 0) return JOB_HARD_TIMEOUT_MS;
  if (temOverrideTeste) return Math.floor(numero);
  return Math.max(1000, Math.floor(numero));
}

function ttlStatusMs(status = "") {
  if (status === "concluido") return JOB_TTL_CONCLUIDO_MS;
  if (status === "expirado") return JOB_TTL_EXPIRADO_MS;
  return JOB_TTL_ERRO_MS;
}

function finalizarJobExpirado(job = {}, deps = {}, inicioMs = Date.now(), memoriaInicio = memoriaMb()) {
  if (!job || job.status !== "processando") return false;
  const memoriaFim = memoriaMb();
  job.status = "expirado";
  job.erro = "magalu_resolucao_expirada";
  job.motivo = "magalu_resolucao_expirada";
  job.oferta = null;
  job.atualizadoEm = agoraIso(deps);
  job.finalizadoEm = job.atualizadoEm;
  job.medidas = {
    ...(job.medidas || {}),
    duracaoMs: Date.now() - inicioMs,
    memoriaRssInicioMb: memoriaInicio,
    memoriaRssFimMb: memoriaFim,
    memoriaDeltaMb: Number((memoriaFim - memoriaInicio).toFixed(2)),
    fontes: Number(job.medidas?.fontes || 0),
    tentativas: Number(job.medidas?.tentativas || 0),
    exigiriaBrowser: true,
    hardTimeoutMs: hardTimeoutMs(deps)
  };
  jobsEmAndamento.delete(job.chave);
  registrarMetricas(job);
  return true;
}

function limparJobsAntigos(deps = {}) {
  const agora = agoraMs(deps);
  for (const [id, job] of jobs.entries()) {
    const criadoMs = Date.parse(job.criadoEm || "");
    const atualizadoMs = Date.parse(job.atualizadoEm || job.criadoEm || "");
    if (job.status === "processando" && Number.isFinite(criadoMs) && agora - criadoMs > hardTimeoutMs(deps)) {
      finalizarJobExpirado(job, deps, criadoMs, Number(job.medidas?.memoriaRssInicioMb || memoriaMb()));
      continue;
    }

    if (job.status !== "processando" && Number.isFinite(atualizadoMs) && agora - atualizadoMs > ttlStatusMs(job.status)) {
      jobs.delete(id);
    }
  }
}

function interfaceResolucao(status = "processando") {
  return {
    estado: status,
    polling: status === "processando",
    intervaloMs: POLLING_INTERVAL_MS,
    timeoutMs: POLLING_TIMEOUT_MS
  };
}

function fontesTentativas(oferta = {}) {
  const tentativas = Array.isArray(oferta?.fonteImportacao?.tentativas)
    ? oferta.fonteImportacao.tentativas
    : [];
  return {
    fontes: [...new Set(tentativas.map(item => texto(item.fonte)).filter(Boolean))],
    tentativas: tentativas.length
  };
}

function avisosOferta(oferta = {}) {
  return Array.isArray(oferta?.fonteImportacao?.avisos) ? oferta.fonteImportacao.avisos.map(texto).filter(Boolean) : [];
}

function exigeBrowserFuturo(oferta = {}, erro = "") {
  const avisos = avisosOferta(oferta);
  return [
    "magalu_http_403",
    "magalu_captcha_detectado",
    "magalu_timeout",
    "magalu_fetch_falhou",
    "magalu_factual_resolver_sem_fonte_segura"
  ].some(aviso => avisos.includes(aviso) || texto(erro).includes(aviso));
}

function registrarMetricas(job = {}) {
  const medidas = job.medidas || {};
  if (job.metricaRegistrada) return;
  job.metricaRegistrada = true;
  metricasRecentes.push({
    status: job.status,
    sucessoHttp: job.status === "concluido" && Boolean(job.oferta?.fonteImportacao?.camposConfiaveis?.length),
    duracaoMs: Number(medidas.duracaoMs || 0),
    fontes: Number(medidas.fontes || 0),
    tentativas: Number(medidas.tentativas || 0),
    exigiriaBrowser: medidas.exigiriaBrowser === true
  });
  while (metricasRecentes.length > METRICAS_JANELA_MAX) metricasRecentes.shift();
}

function metricasImportacaoMagaluManualV2() {
  const total = metricasRecentes.length;
  const concluidos = metricasRecentes.filter(item => item.status === "concluido").length;
  const erros = metricasRecentes.filter(item => item.status === "erro").length;
  const expirados = metricasRecentes.filter(item => item.status === "expirado").length;
  const sucessoHttp = metricasRecentes.filter(item => item.sucessoHttp).length;
  const tempoTotalMs = metricasRecentes.reduce((soma, item) => soma + item.duracaoMs, 0);
  const fontesTotal = metricasRecentes.reduce((soma, item) => soma + item.fontes, 0);
  const tentativasTotal = metricasRecentes.reduce((soma, item) => soma + item.tentativas, 0);
  return {
    total,
    janelaMaxima: METRICAS_JANELA_MAX,
    concluidos,
    erros,
    expirados,
    taxaSucessoHttp: total ? Number((sucessoHttp / total).toFixed(4)) : 0,
    tempoMedioMs: total ? Math.round(tempoTotalMs / total) : 0,
    mediaFontes: total ? Number((fontesTotal / total).toFixed(2)) : 0,
    mediaTentativas: total ? Number((tentativasTotal / total).toFixed(2)) : 0,
    exigiriamBrowser: metricasRecentes.filter(item => item.exigiriaBrowser).length
  };
}

function payloadJob(job = {}) {
  return {
    ok: job.status === "concluido",
    jobId: job.id,
    clienteId: job.clienteId,
    marketplace: "magalu",
    produtoId: job.produtoId,
    status: job.status,
    criadoEm: job.criadoEm,
    atualizadoEm: job.atualizadoEm,
    finalizadoEm: job.finalizadoEm || "",
    erro: job.erro || "",
    motivo: job.motivo || "",
    deduplicado: job.deduplicado === true,
    interfaceResolucao: interfaceResolucao(job.status),
    medidas: job.medidas || {},
    oferta: job.status === "concluido" ? job.oferta : null
  };
}

function importarManualComPolitica({ importarManual, urlOriginal, importOptions, clienteId }) {
  return importarManual(urlOriginal, {
    ...importOptions,
    parserOptions: {
      ...POLITICA_MANUAL_ASSINCRONA,
      ...(importOptions.parserOptions || {})
    },
    clienteId
  });
}

async function executarImportacao(job, { importarManual, urlOriginal, importOptions, inicioMs, memoriaInicio }) {
  try {
    const oferta = await importarManualComPolitica({
      importarManual,
      urlOriginal,
      importOptions,
      clienteId: job.clienteId
    });
    const resumo = fontesTentativas(oferta);
    const memoriaFim = memoriaMb();
    const status = (!oferta || oferta.ok === false) ? "erro" : "concluido";
    return {
      status,
      erro: status === "erro" ? (oferta?.erro || oferta?.motivo || "manual_v2_magalu_importacao_falhou") : "",
      motivo: status === "erro" ? (oferta?.erro || oferta?.motivo || "manual_v2_magalu_importacao_falhou") : "",
      oferta: status === "concluido" ? oferta : null,
      medidas: {
        duracaoMs: Date.now() - inicioMs,
        memoriaRssInicioMb: memoriaInicio,
        memoriaRssFimMb: memoriaFim,
        memoriaDeltaMb: Number((memoriaFim - memoriaInicio).toFixed(2)),
        fontes: resumo.fontes.length,
        tentativas: resumo.tentativas,
        exigiriaBrowser: exigeBrowserFuturo(oferta, "")
      }
    };
  } catch (e) {
    const memoriaFim = memoriaMb();
    return {
      status: "erro",
      erro: "manual_v2_magalu_job_falhou",
      motivo: e.message || "manual_v2_magalu_job_falhou",
      oferta: null,
      medidas: {
        duracaoMs: Date.now() - inicioMs,
        memoriaRssInicioMb: memoriaInicio,
        memoriaRssFimMb: memoriaFim,
        memoriaDeltaMb: Number((memoriaFim - memoriaInicio).toFixed(2)),
        fontes: 0,
        tentativas: 0,
        exigiriaBrowser: exigeBrowserFuturo({}, e.message)
      }
    };
  }
}

async function executarJob(job, { importarManual, urlOriginal, importOptions, deps }) {
  const inicioMs = Date.now();
  const memoriaInicio = memoriaMb();
  let timer = null;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ status: "expirado" }), hardTimeoutMs(deps));
    });
    const resultado = await Promise.race([
      executarImportacao(job, { importarManual, urlOriginal, importOptions, inicioMs, memoriaInicio }),
      timeout
    ]);

    if (resultado.status === "expirado") {
      finalizarJobExpirado(job, deps, inicioMs, memoriaInicio);
      return;
    }

    if (job.status !== "processando") return;
    job.status = resultado.status;
    job.erro = resultado.erro;
    job.motivo = resultado.motivo;
    job.oferta = resultado.oferta;
    job.medidas = resultado.medidas;
  } catch (e) {
    if (job.status === "processando") {
      const memoriaFim = memoriaMb();
      job.status = "erro";
      job.erro = "manual_v2_magalu_job_falhou";
      job.motivo = e.message || "manual_v2_magalu_job_falhou";
      job.medidas = {
        duracaoMs: Date.now() - inicioMs,
        memoriaRssInicioMb: memoriaInicio,
        memoriaRssFimMb: memoriaFim,
        memoriaDeltaMb: Number((memoriaFim - memoriaInicio).toFixed(2)),
        fontes: 0,
        tentativas: 0,
        exigiriaBrowser: exigeBrowserFuturo({}, e.message)
      };
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (job.status === "processando") finalizarJobExpirado(job, deps, inicioMs, memoriaInicio);
    if (!job.finalizadoEm) {
      job.atualizadoEm = agoraIso(deps);
      job.finalizadoEm = job.atualizadoEm;
    }
    jobsEmAndamento.delete(job.chave);
    registrarMetricas(job);
  }
}

function iniciarImportacaoMagaluManualV2Async({ clienteId = "", urlOriginal = "", importOptions = {}, importarManual = importarUrlManualV2 } = {}, deps = {}) {
  limparJobsAntigos(deps);
  const deteccao = detectarMarketplaceManualV2(urlOriginal);
  if (!deteccao.ok || deteccao.marketplace !== "magalu") {
    return { assinc: false, deteccao };
  }

  const produtoId = produtoIdPorUrl(deteccao.url);
  if (!produtoId) {
    return { assinc: false, deteccao };
  }

  const chave = chaveJob({ clienteId, urlOriginal: deteccao.url, importOptions });
  const existente = jobsEmAndamento.get(chave);
  if (existente && jobs.has(existente)) {
    const jobExistente = jobs.get(existente);
    jobExistente.deduplicado = true;
    jobExistente.atualizadoEm = agoraIso(deps);
    return { assinc: true, job: payloadJob(jobExistente) };
  }

  const job = {
    id: idJob(deps),
    chave,
    clienteId,
    produtoId,
    status: "processando",
    criadoEm: agoraIso(deps),
    atualizadoEm: agoraIso(deps),
    finalizadoEm: "",
    erro: "",
    motivo: "",
    medidas: {
      duracaoMs: 0,
      memoriaRssInicioMb: memoriaMb(),
      memoriaRssFimMb: 0,
      memoriaDeltaMb: 0,
      fontes: 0,
      tentativas: 0,
      exigiriaBrowser: false
    },
    metricaRegistrada: false,
    oferta: null
  };

  jobs.set(job.id, job);
  jobsEmAndamento.set(chave, job.id);
  Promise.resolve().then(() => executarJob(job, {
    importarManual,
    urlOriginal: deteccao.url,
    importOptions,
    deps
  }));

  return { assinc: true, job: payloadJob(job) };
}

function buscarImportacaoMagaluManualV2(jobId = "", clienteId = "") {
  limparJobsAntigos();
  const job = jobs.get(texto(jobId));
  if (!job || job.clienteId !== clienteId) return null;
  return payloadJob(job);
}

function resetImportacoesMagaluManualV2() {
  jobs.clear();
  jobsEmAndamento.clear();
  metricasRecentes.splice(0, metricasRecentes.length);
}

module.exports = {
  iniciarImportacaoMagaluManualV2Async,
  buscarImportacaoMagaluManualV2,
  metricasImportacaoMagaluManualV2,
  resetImportacoesMagaluManualV2
};
