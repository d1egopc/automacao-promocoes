"use strict";

const ML_IDENTITY_CAPABILITY = "ml_identity_v1";
const ML_IDENTITY_CONTRACT_VERSION = 1;
const ML_IDENTITY_RESULT_TTL_MS = 10 * 60 * 1000;
const ML_IDENTITY_TITLE_ORIGINS = new Set(["jsonld.name"]);
const ML_IDENTITY_IMAGE_ORIGINS = new Set(["jsonld.image"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarMlb(valor = "") {
  const match = texto(valor).match(/\bMLB-?(\d+)\b/i);
  return match ? `MLB${match[1]}` : "";
}

function hostMercadoLivre(host = "") {
  const valor = texto(host).toLowerCase().replace(/\.$/, "");
  return valor === "mercadolivre.com.br"
    || valor.endsWith(".mercadolivre.com.br")
    || valor === "mercadolibre.com"
    || valor.endsWith(".mercadolibre.com");
}

function sanitizarUrlMercadoLivre(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || !hostMercadoLivre(url.hostname)) return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function urlMercadoLivreCompativel(valor = "", expectedMlb = "", { exigirMlb = true } = {}) {
  const url = sanitizarUrlMercadoLivre(valor);
  if (!url) return false;
  const observado = normalizarMlb(url);
  return exigirMlb ? Boolean(observado && observado === normalizarMlb(expectedMlb)) : (!observado || observado === normalizarMlb(expectedMlb));
}

function sanitizarUrlMlstatic(valor = "") {
  try {
    const url = new URL(texto(valor));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:"
      || !(host === "mlstatic.com" || host.endsWith(".mlstatic.com"))
      || url.pathname === "/") return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function urlMlstaticValida(valor = "") {
  return Boolean(sanitizarUrlMlstatic(valor));
}

function tituloFactualMercadoLivreValido(valor = "") {
  const titulo = texto(valor).replace(/\s+/g, " ");
  if (titulo.length < 8 || titulo.length > 240 || titulo.split(/\s+/).length < 2) return false;
  const normalizado = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/^(?:mercado\s*livre|produto|anuncio|oferta|promocao|confira|compre\s+agora)\b/.test(normalizado)) return false;
  if (/\b(?:vendido\s+por|loja\s+oficial|varias\s+cores\s+disponiveis|compre\s+agora|confira\s+agora|oferta\s+imperdivel|just\s+a\s+moment|access\s+denied|captcha|verifique\s+se\s+voce\s+e\s+um\s+robo)\b/.test(normalizado)) return false;
  return /[\p{L}\p{N}]/u.test(titulo);
}

function erroContrato(motivo) {
  const erro = new Error(motivo);
  erro.codigo = motivo;
  return erro;
}

function validarResultadoMlIdentity(payload = {}, opcoes = {}) {
  const expectedMlb = normalizarMlb(opcoes.expectedMlb || payload.expectedMlb);
  const observedMlb = normalizarMlb(payload.observedMlb || payload.productIdObserved);
  const prova = payload.provaTecnica && typeof payload.provaTecnica === "object" ? payload.provaTecnica : {};
  const agoraMs = Number.isFinite(Number(opcoes.agoraMs)) ? Number(opcoes.agoraMs) : Date.now();
  const ttlMs = Math.max(1, Number(opcoes.ttlMs || ML_IDENTITY_RESULT_TTL_MS));
  const collectedAt = new Date(payload.collectedAt || payload.checkedAt || prova.collectedAt || prova.checkedAt);

  if (!expectedMlb) throw erroContrato("ml_identity_expected_mlb_invalido");
  if (texto(payload.marketplace).toLowerCase() !== "mercadolivre") throw erroContrato("ml_identity_marketplace_invalido");
  if (!observedMlb || observedMlb !== expectedMlb) throw erroContrato("ml_identity_mlb_divergente");
  if (payload.identidadeValidada !== true) throw erroContrato("ml_identity_nao_validada");
  if (texto(payload.capability || prova.capability) !== ML_IDENTITY_CAPABILITY) throw erroContrato("ml_identity_capability_invalida");
  if (Number(payload.contractVersion || prova.contractVersion) !== ML_IDENTITY_CONTRACT_VERSION) throw erroContrato("ml_identity_versao_invalida");
  if (texto(prova.provenance) !== "local_worker.ml_identity_v1" || texto(prova.source) !== "local_first_party") throw erroContrato("ml_identity_proveniencia_invalida");
  if (normalizarMlb(prova.expectedMlb) !== expectedMlb || normalizarMlb(prova.observedMlb) !== expectedMlb || prova.sameProductObject !== true) throw erroContrato("ml_identity_prova_produto_invalida");
  if (!Number.isFinite(collectedAt.getTime()) || collectedAt.getTime() > agoraMs + 30_000 || agoraMs - collectedAt.getTime() >= ttlMs) throw erroContrato("ml_identity_resultado_stale");

  const finalUrl = sanitizarUrlMercadoLivre(payload.finalUrl || prova.finalUrl);
  if (!finalUrl || !urlMercadoLivreCompativel(finalUrl, expectedMlb)) throw erroContrato("ml_identity_final_url_invalida");
  const canonicalInformada = texto(payload.canonicalUrl || prova.canonicalUrl);
  const canonicalUrl = canonicalInformada ? sanitizarUrlMercadoLivre(canonicalInformada) : "";
  if (canonicalInformada && (!canonicalUrl || !urlMercadoLivreCompativel(canonicalUrl, expectedMlb, { exigirMlb: false }))) throw erroContrato("ml_identity_canonical_invalida");

  const tituloInformado = texto(payload.tituloOficial).replace(/\s+/g, " ");
  const tituloOficial = tituloFactualMercadoLivreValido(tituloInformado) ? tituloInformado : "";
  const imagemInformada = texto(payload.imagemOficial || payload.imagemOficialUrl);
  const imagemOficial = sanitizarUrlMlstatic(imagemInformada);
  const origemTitulo = texto(payload.origemTitulo || prova.origemTitulo);
  const origemImagem = texto(payload.origemImagem || prova.origemImagem);
  if (tituloInformado && !tituloOficial) throw erroContrato("ml_identity_titulo_nao_factual");
  if (imagemInformada && !imagemOficial) throw erroContrato("ml_identity_imagem_host_invalido");
  if (tituloOficial && !ML_IDENTITY_TITLE_ORIGINS.has(origemTitulo)) throw erroContrato("ml_identity_origem_titulo_invalida");
  if (imagemOficial && !ML_IDENTITY_IMAGE_ORIGINS.has(origemImagem)) throw erroContrato("ml_identity_origem_imagem_invalida");
  if (!tituloOficial && !imagemOficial) throw erroContrato("ml_identity_sem_identidade_factual");

  const variationId = /^\d{1,30}$/.test(texto(payload.variationId || prova.variationId))
    ? texto(payload.variationId || prova.variationId)
    : "";

  return {
    capability: ML_IDENTITY_CAPABILITY,
    contractVersion: ML_IDENTITY_CONTRACT_VERSION,
    marketplace: "mercadolivre",
    expectedMlb,
    observedMlb,
    identidadeValidada: true,
    identidadeTipo: "mlb",
    tituloOficial,
    imagemOficial,
    origemTitulo: tituloOficial ? origemTitulo : "",
    origemImagem: imagemOficial ? origemImagem : "",
    finalUrl,
    canonicalUrl,
    variationId,
    collectedAt: collectedAt.toISOString(),
    provaTecnica: {
      capability: ML_IDENTITY_CAPABILITY,
      contractVersion: ML_IDENTITY_CONTRACT_VERSION,
      source: "local_first_party",
      provenance: "local_worker.ml_identity_v1",
      expectedMlb,
      observedMlb,
      sameProductObject: true,
      identidadeTipo: "mlb",
      origemTitulo: tituloOficial ? origemTitulo : "",
      origemImagem: imagemOficial ? origemImagem : "",
      finalUrl,
      canonicalUrl,
      variationId,
      collectedAt: collectedAt.toISOString()
    }
  };
}

module.exports = {
  ML_IDENTITY_CAPABILITY,
  ML_IDENTITY_CONTRACT_VERSION,
  ML_IDENTITY_RESULT_TTL_MS,
  normalizarMlb,
  sanitizarUrlMercadoLivre,
  urlMercadoLivreCompativel,
  sanitizarUrlMlstatic,
  urlMlstaticValida,
  tituloFactualMercadoLivreValido,
  validarResultadoMlIdentity
};
