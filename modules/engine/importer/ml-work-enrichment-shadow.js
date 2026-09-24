"use strict";

const crypto = require("crypto");
const {
  ML_IDENTITY_CAPABILITY,
  validarResultadoMlIdentity
} = require("../../local-worker/ml-identity.contract");

const ML_WORK_LOCAL_OPERATION_TIMEOUT_MS = 250;
const ML_WORK_ENRICHMENT_ACTIVE_FLAG = "ML_WORK_ENRICHMENT_ACTIVE";

function texto(valor = "") { return String(valor ?? "").trim(); }

function hashCurto(valor = "") {
  const conteudo = texto(valor);
  return conteudo ? crypto.createHash("sha256").update(conteudo).digest("hex").slice(0, 16) : "";
}

function hostSeguro(valor = "") {
  try { return new URL(texto(valor)).hostname.toLowerCase(); } catch (_) { return ""; }
}

function redigirSegredosMotivo(valor = "") {
  const conteudo = texto(valor);
  if (/https?:\/\//i.test(conteudo)) return "url_redigida";
  if (/^\??[a-z0-9_.~-]+=[^\s]*$/i.test(conteudo)
    || /(?:^|[^a-z0-9_.~-])\?[a-z0-9_.~-]+=/i.test(conteudo)
    || /(?:^|[^a-z0-9_.~-])[a-z0-9_.~-]+=[^&\s]+&[a-z0-9_.~-]+=/i.test(conteudo)) {
    return "query_redigida";
  }
  if (/\bbearer\b(?:\s|$)/i.test(conteudo)) return "credencial_redigida";
  if (/\b(?:access_token|refresh_token|id_token|client_secret|authorization|set-cookie|cookie|api_key|apikey|password|passwd|secret|token)\b\s*(?:=|:|\s)/i.test(conteudo)) {
    return "credencial_redigida";
  }
  return conteudo;
}

function motivoSeguro(erro, fallback = "ml_identity_indisponivel") {
  return redigirSegredosMotivo(erro?.codigo || erro?.motivo || erro?.message || fallback)
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 120) || fallback;
}

function valorBooleanoAtivo(valor) {
  return ["1", "true", "yes", "on"].includes(texto(valor).toLowerCase());
}

function mlWorkEnrichmentAtivo({ deps = {}, env = process.env } = {}) {
  if (typeof deps.mlWorkEnrichmentAtivo === "function") {
    try { return deps.mlWorkEnrichmentAtivo() === true; } catch (_) { return false; }
  }
  if (typeof deps.mlWorkEnrichmentAtivo === "boolean") return deps.mlWorkEnrichmentAtivo;
  return valorBooleanoAtivo(env?.[ML_WORK_ENRICHMENT_ACTIVE_FLAG]);
}

function provaIdentidadeSanitizada(resultado = {}) {
  const prova = resultado?.provaTecnica && typeof resultado.provaTecnica === "object"
    ? resultado.provaTecnica
    : {};
  return {
    capability: ML_IDENTITY_CAPABILITY,
    contractVersion: Number(resultado.contractVersion || prova.contractVersion || 0),
    source: texto(prova.source),
    provenance: texto(prova.provenance),
    expectedMlb: texto(resultado.expectedMlb || prova.expectedMlb),
    observedMlb: texto(resultado.observedMlb || prova.observedMlb),
    sameProductObject: prova.sameProductObject === true,
    origemTitulo: texto(resultado.origemTitulo || prova.origemTitulo),
    origemImagem: texto(resultado.origemImagem || prova.origemImagem),
    variationId: texto(resultado.variationId || prova.variationId),
    collectedAt: texto(resultado.collectedAt || prova.collectedAt)
  };
}

function prepararMlWorkEnrichmentAtivo({
  consulta = {},
  expectedMlb = "",
  marketplace = "",
  ativo = false,
  agoraMs = Date.now(),
  tituloValido
} = {}) {
  const base = {
    ativo: ativo === true,
    expectedMlbPresente: /^MLB\d+$/i.test(texto(expectedMlb)),
    expectedMlbHash: hashCurto(texto(expectedMlb).toUpperCase()),
    cacheHit: consulta?.cacheHit === true,
    identidadeValidada: false,
    tituloWork: "",
    imagemWork: "",
    tituloWorkAplicado: false,
    imagemWorkAplicada: false,
    fallbackTitulo: "ml_atual",
    fallbackImagem: "ml_atual",
    motivoFallback: "",
    provaTecnica: null,
    duracaoMs: Math.max(0, Number(consulta?.duracaoMs || 0))
  };
  if (texto(marketplace).toLowerCase().replace(/[^a-z]/g, "") !== "mercadolivre") {
    return { ...base, motivoFallback: "marketplace_nao_ml" };
  }
  if (!base.ativo) return { ...base, motivoFallback: "flag_desabilitada" };
  if (!base.expectedMlbPresente) return { ...base, motivoFallback: "expected_mlb_ausente" };
  if (consulta?.identidadeValidada !== true || consulta?.cacheHit !== true || !consulta?.resultado) {
    return {
      ...base,
      motivoFallback: motivoSeguro({ message: consulta?.motivoRejeicao }, "cache_identity_indisponivel")
    };
  }

  let resultado;
  try {
    resultado = validarResultadoMlIdentity(consulta.resultado, { expectedMlb, agoraMs, ttlMs: 24 * 60 * 60 * 1000 });
  } catch (erro) {
    return { ...base, motivoFallback: motivoSeguro(erro, "ml_identity_invalida") };
  }

  const tituloWork = texto(resultado.tituloOficial);
  const imagemWork = texto(resultado.imagemOficial);
  const tituloAceito = tituloWork && (typeof tituloValido !== "function" || tituloValido(tituloWork, "mercadolivre") === true);
  const identidadeValidada = true;
  const motivoFallback = tituloWork && !tituloAceito
    ? "titulo_work_rejeitado_filtro"
    : (!tituloWork && !imagemWork ? "ml_identity_sem_identidade_factual" : "");

  return {
    ...base,
    identidadeValidada,
    tituloWork: tituloAceito ? tituloWork : "",
    imagemWork,
    fallbackTitulo: tituloAceito ? "work_validado" : "ml_atual",
    fallbackImagem: imagemWork ? "work_validado" : "ml_atual",
    motivoFallback,
    provaTecnica: provaIdentidadeSanitizada(resultado)
  };
}

function aplicarImagemMlWorkCanonica(imagemCanonicaFinal = {}, promocao = {}) {
  if (!promocao?.imagemWork) return imagemCanonicaFinal;
  promocao.imagemWorkAplicada = true;
  return {
    ...imagemCanonicaFinal,
    imagem: promocao.imagemWork,
    imagemCanonicaDuravel: promocao.imagemWork,
    imagemOrigem: "local_worker.ml_identity_v1",
    imagemStatus: "local_worker_ml_identity",
    produtoId: promocao.provaTecnica?.expectedMlb || imagemCanonicaFinal.produtoId || "",
    motivo: "cache_local_worker_ml_identity",
    cacheHit: true,
    localWorkerIdentityProof: promocao.provaTecnica
  };
}

function aplicarTituloMlWork({ oferta = {}, metadataFinal = {}, promocao = {} } = {}) {
  if (!promocao?.tituloWork) return { oferta, metadataFinal, aplicado: false };
  const titulo = promocao.tituloWork;
  promocao.tituloWorkAplicado = true;
  return {
    aplicado: true,
    oferta: {
      ...oferta,
      titulo,
      nome: titulo,
      tituloFactual: titulo,
      tituloOrigem: "local_worker.ml_identity_v1"
    },
    metadataFinal: {
      ...metadataFinal,
      produto: {
        ...(metadataFinal?.produto && typeof metadataFinal.produto === "object" ? metadataFinal.produto : {}),
        titulo,
        tituloFactual: titulo,
        tituloOrigem: "local_worker.ml_identity_v1"
      },
      autoridadeFactual: {
        ...(metadataFinal?.autoridadeFactual && typeof metadataFinal.autoridadeFactual === "object" ? metadataFinal.autoridadeFactual : {}),
        titulo,
        tituloOrigem: "local_worker.ml_identity_v1"
      }
    }
  };
}

function montarTelemetriaMlWorkAtivo({ promocao = {}, categoriaAntes = "", categoriaDepois = "" } = {}) {
  return {
    version: 1,
    capability: ML_IDENTITY_CAPABILITY,
    ativo: promocao.ativo === true,
    expectedMlbPresente: promocao.expectedMlbPresente === true,
    expectedMlbHash: texto(promocao.expectedMlbHash),
    cacheHit: promocao.cacheHit === true,
    identidadeValidada: promocao.identidadeValidada === true,
    tituloWorkAplicado: promocao.tituloWorkAplicado === true,
    imagemWorkAplicada: promocao.imagemWorkAplicada === true,
    categoriaAntes: texto(categoriaAntes),
    categoriaDepois: texto(categoriaDepois),
    categoriaMudou: Boolean(texto(categoriaDepois) && texto(categoriaDepois) !== texto(categoriaAntes)),
    fallbackTitulo: texto(promocao.fallbackTitulo || "ml_atual"),
    fallbackImagem: texto(promocao.fallbackImagem || "ml_atual"),
    motivoFallback: motivoSeguro({ motivo: promocao.motivoFallback }, ""),
    comercialAlterado: false,
    linksAlterados: false,
    duracaoMs: Math.max(0, Number(promocao.duracaoMs || 0))
  };
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
  mlWorkEnrichmentAtivo,
  prepararMlWorkEnrichmentAtivo,
  aplicarImagemMlWorkCanonica,
  aplicarTituloMlWork,
  montarTelemetriaMlWorkAtivo,
  executarOperacaoLocalComTimeout,
  ML_WORK_LOCAL_OPERATION_TIMEOUT_MS,
  ML_WORK_ENRICHMENT_ACTIVE_FLAG,
  hashCurto,
  hostSeguro
};
