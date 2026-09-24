"use strict";

const crypto = require("crypto");
const {
  ML_IDENTITY_CAPABILITY,
  validarResultadoMlIdentity
} = require("../../local-worker/ml-identity.contract");

const ML_WORK_LOCAL_OPERATION_TIMEOUT_MS = 250;

function texto(valor = "") { return String(valor ?? "").trim(); }

function hashCurto(valor = "") {
  const conteudo = texto(valor);
  return conteudo ? crypto.createHash("sha256").update(conteudo).digest("hex").slice(0, 16) : "";
}

function hostSeguro(valor = "") {
  try { return new URL(texto(valor)).hostname.toLowerCase(); } catch (_) { return ""; }
}

function motivoSeguro(erro, fallback = "ml_identity_indisponivel") {
  return texto(erro?.codigo || erro?.motivo || erro?.message || fallback)
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 120) || fallback;
}

async function executarOperacaoLocalComTimeout(operacao, timeoutMs = ML_WORK_LOCAL_OPERATION_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operacao),
      new Promise((_, rejeitar) => {
        timer = setTimeout(() => {
          const falha = new Error("ml_identity_operacao_local_timeout");
          falha.codigo = "ml_identity_operacao_local_timeout";
          rejeitar(falha);
        }, Math.max(1, Number(timeoutMs) || ML_WORK_LOCAL_OPERATION_TIMEOUT_MS));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function consultarMlWorkIdentityBestEffort({ marketplace = "", expectedMlb = "", sourceUrl = "", deps = {}, agoraMs = Date.now() } = {}) {
  const inicio = Date.now();
  const base = {
    capability: ML_IDENTITY_CAPABILITY,
    observado: false,
    identidadeValidada: false,
    cacheHit: false,
    taskCriada: false,
    taskId: null,
    motivoRejeicao: "",
    resultado: null,
    duracaoMs: 0
  };
  if (texto(marketplace).toLowerCase().replace(/[^a-z]/g, "") !== "mercadolivre") {
    return { ...base, motivoRejeicao: "marketplace_nao_ml", duracaoMs: Date.now() - inicio };
  }
  if (!/^MLB\d+$/i.test(texto(expectedMlb))) {
    return { ...base, motivoRejeicao: "expected_mlb_ausente", duracaoMs: Date.now() - inicio };
  }

  let resultado = null;
  if (typeof deps.obterIdentidadeMercadoLivreLocalWorker === "function") {
    try {
      const cache = await executarOperacaoLocalComTimeout(
        () => deps.obterIdentidadeMercadoLivreLocalWorker({ productId: texto(expectedMlb).toUpperCase() })
      );
      if (cache) {
        base.observado = true;
        resultado = validarResultadoMlIdentity(cache.result || cache, {
          expectedMlb,
          agoraMs,
          ttlMs: 24 * 60 * 60 * 1000
        });
      }
    } catch (erroCache) {
      base.motivoRejeicao = motivoSeguro(erroCache, "cache_identity_invalido");
    }
  }

  if (resultado) {
    return {
      ...base,
      observado: true,
      identidadeValidada: true,
      cacheHit: true,
      resultado,
      motivoRejeicao: "",
      duracaoMs: Date.now() - inicio
    };
  }

  if (typeof deps.garantirIdentidadeMercadoLivreLocalWorker === "function") {
    try {
      const task = await executarOperacaoLocalComTimeout(() => deps.garantirIdentidadeMercadoLivreLocalWorker({
        productId: texto(expectedMlb).toUpperCase(),
        sourceUrl: texto(sourceUrl)
      }));
      base.taskCriada = task?.ok === true && task?.criada === true;
      base.taskId = task?.task?.id || null;
      if (task?.ok !== true && !base.motivoRejeicao) base.motivoRejeicao = motivoSeguro(task, "task_identity_nao_criada");
    } catch (erroTask) {
      if (!base.motivoRejeicao) base.motivoRejeicao = motivoSeguro(erroTask, "task_identity_falhou");
    }
  } else if (!base.motivoRejeicao) {
    base.motivoRejeicao = "dependencia_identity_indisponivel";
  }

  return { ...base, duracaoMs: Date.now() - inicio };
}

function montarMlWorkEnrichmentShadow({ consulta = {}, oferta = {}, metadataFinal = {}, job = {}, reclassificarCategoria } = {}) {
  const atual = {
    titulo: texto(oferta.titulo || oferta.nome),
    imagem: texto(oferta.imagem),
    categoria: texto(oferta.categoria)
  };
  const work = consulta?.identidadeValidada === true ? consulta.resultado : null;
  const tituloWork = texto(work?.tituloOficial);
  const imagemWork = texto(work?.imagemOficial);
  const tituloHipotetico = tituloWork || atual.titulo;
  const imagemHipotetica = imagemWork || atual.imagem;
  let categoriaHipotetica = atual.categoria;
  let motivoShadow = texto(consulta?.motivoRejeicao);
  if (tituloWork && typeof reclassificarCategoria === "function") {
    try {
      const ofertaClone = { ...oferta, titulo: tituloWork, nome: tituloWork };
      const metadataClone = {
        ...metadataFinal,
        produto: {
          ...(metadataFinal?.produto && typeof metadataFinal.produto === "object" ? metadataFinal.produto : {}),
          titulo: tituloWork,
          tituloFactual: tituloWork
        }
      };
      const resultadoCategoria = reclassificarCategoria(ofertaClone, metadataClone, job) || {};
      categoriaHipotetica = texto(resultadoCategoria?.oferta?.categoria || atual.categoria);
    } catch (erroCategoria) {
      categoriaHipotetica = atual.categoria;
      motivoShadow = motivoSeguro(erroCategoria, "categoria_shadow_falhou");
    }
  }

  const fallbackQueSeriaUsado = consulta?.identidadeValidada === true
    ? (tituloWork || imagemWork ? "work_validado" : "ml_atual")
    : "ml_atual";
  const comparacao = {
    tituloAtual: atual.titulo,
    tituloWork,
    tituloHipoteticoEscolhido: tituloHipotetico,
    imagemAtual: atual.imagem,
    imagemWork,
    imagemHipoteticaEscolhida: imagemHipotetica,
    categoriaAtual: atual.categoria,
    categoriaHipoteticaRecalculada: categoriaHipotetica,
    identidadeValidada: consulta?.identidadeValidada === true,
    cacheHit: consulta?.cacheHit === true,
    fallbackQueSeriaUsado,
    motivoRejeicao: motivoShadow,
    comercialAlterado: false,
    linksAlterados: false
  };
  const telemetria = {
    version: 1,
    capability: ML_IDENTITY_CAPABILITY,
    observado: consulta?.observado === true,
    identidadeValidada: comparacao.identidadeValidada,
    cacheHit: comparacao.cacheHit,
    taskCriada: consulta?.taskCriada === true,
    tituloAtualPresente: Boolean(atual.titulo),
    tituloWorkPresente: Boolean(tituloWork),
    tituloAtualHash: hashCurto(atual.titulo),
    tituloWorkHash: hashCurto(tituloWork),
    tituloMudaria: Boolean(tituloWork && tituloWork !== atual.titulo),
    imagemAtualPresente: Boolean(atual.imagem),
    imagemWorkPresente: Boolean(imagemWork),
    imagemAtualHost: hostSeguro(atual.imagem),
    imagemWorkHost: hostSeguro(imagemWork),
    imagemMudaria: Boolean(imagemWork && imagemWork !== atual.imagem),
    categoriaAtual: atual.categoria,
    categoriaHipotetica: categoriaHipotetica,
    categoriaMudaria: Boolean(categoriaHipotetica && categoriaHipotetica !== atual.categoria),
    fallbackQueSeriaUsado,
    motivoRejeicao: motivoShadow,
    comercialAlterado: false,
    linksAlterados: false,
    duracaoMs: Math.max(0, Number(consulta?.duracaoMs || 0))
  };
  return { comparacao, telemetria };
}

module.exports = {
  consultarMlWorkIdentityBestEffort,
  montarMlWorkEnrichmentShadow,
  executarOperacaoLocalComTimeout,
  ML_WORK_LOCAL_OPERATION_TIMEOUT_MS,
  hashCurto,
  hostSeguro
};
