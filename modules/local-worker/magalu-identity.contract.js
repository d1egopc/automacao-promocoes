"use strict";

const crypto = require("crypto");

const MAGALU_IDENTITY_CAPABILITY = "magalu_identity_v1";
const MAGALU_IDENTITY_CONTRACT_VERSION = 1;
const MAGALU_IDENTITY_TASK_TYPE = "identidade_oficial";
const MAGALU_IDENTITY_RESULT_TTL_MS = 10 * 60 * 1000;
const MAGALU_IDENTITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CAMINHO_SENSIVEL = /(?:^|\/)(?:token|secret|api[_-]?key|authorization|bearer|password|session|cookie|signature|access[_-]?token)(?:\/|$)/i;

function texto(valor = "") { return String(valor ?? "").trim(); }

function erroContrato(codigo) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  return erro;
}

function sanitizarUrlOneLinkMagalu(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "magazineluiza.onelink.me" ||
      url.username || url.password || url.port || url.search || url.hash) return "";
    if (!/^\/[a-z0-9._~-]{1,120}\/[a-z0-9._~-]{1,160}\/?$/i.test(url.pathname)) return "";
    return `https://magazineluiza.onelink.me${url.pathname}`;
  } catch (_) { return ""; }
}

function hostProdutoMagalu(host = "") {
  const valor = texto(host).toLowerCase().replace(/\.$/, "");
  return valor === "magazineluiza.com.br" || valor.endsWith(".magazineluiza.com.br") ||
    valor === "magazinevoce.com.br" || valor.endsWith(".magazinevoce.com.br") ||
    valor === "magalu.com" || valor.endsWith(".magalu.com");
}

function produtoIdUrlMagalu(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || !hostProdutoMagalu(url.hostname) || url.username || url.password || url.port) return "";
    if (CAMINHO_SENSIVEL.test(decodeURIComponent(url.pathname))) return "";
    const produtoId = texto(url.pathname.match(/\/p\/([^/]+)/i)?.[1]).toLowerCase();
    return /^[a-z0-9-]{5,80}$/.test(produtoId) ? produtoId : "";
  } catch (_) { return ""; }
}

function sanitizarUrlProdutoMagalu(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (!produtoIdUrlMagalu(url.toString())) return "";
    return `https://${url.hostname.toLowerCase()}${url.pathname.slice(0, 512)}`;
  } catch (_) { return ""; }
}

function chaveIdentidadeMagalu(sourceUrl = "") {
  const url = sanitizarUrlOneLinkMagalu(sourceUrl);
  return url ? `url_${crypto.createHash("sha256").update(url).digest("hex").slice(0, 32)}` : "";
}

function validarResultadoMagaluIdentity(payload = {}, opcoes = {}) {
  const sourceUrl = sanitizarUrlOneLinkMagalu(opcoes.sourceUrl);
  const identityKey = chaveIdentidadeMagalu(sourceUrl);
  if (!sourceUrl || !identityKey || texto(opcoes.identityKey) !== identityKey) throw erroContrato("magalu_identity_task_invalida");
  if (texto(payload.capability) !== MAGALU_IDENTITY_CAPABILITY || Number(payload.contractVersion) !== MAGALU_IDENTITY_CONTRACT_VERSION) {
    throw erroContrato("magalu_identity_capability_invalida");
  }
  if (texto(payload.marketplace).toLowerCase() !== "magalu" || payload.identidadeValidada !== true) {
    throw erroContrato("magalu_identity_resultado_invalido");
  }
  if (texto(payload.identityKey) !== identityKey || sanitizarUrlOneLinkMagalu(payload.sourceUrl) !== sourceUrl) {
    throw erroContrato("magalu_identity_origem_divergente");
  }
  const finalUrl = sanitizarUrlProdutoMagalu(payload.finalUrl);
  const canonicalUrl = sanitizarUrlProdutoMagalu(payload.canonicalUrl || payload.finalUrl);
  const observedProductId = produtoIdUrlMagalu(finalUrl);
  if (!finalUrl || !canonicalUrl || !observedProductId || produtoIdUrlMagalu(canonicalUrl) !== observedProductId ||
    texto(payload.observedProductId).toLowerCase() !== observedProductId) {
    throw erroContrato("magalu_identity_produto_nao_confirmado");
  }
  const coletado = new Date(payload.collectedAt);
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const ttlMs = Math.max(60_000, Number(opcoes.ttlMs || MAGALU_IDENTITY_RESULT_TTL_MS));
  if (!Number.isFinite(coletado.getTime()) || coletado.getTime() > agoraMs + 30_000 || agoraMs - coletado.getTime() >= ttlMs) {
    throw erroContrato("magalu_identity_resultado_stale");
  }
  const prova = payload.provaTecnica && typeof payload.provaTecnica === "object" ? payload.provaTecnica : {};
  if (texto(prova.capability) !== MAGALU_IDENTITY_CAPABILITY || Number(prova.contractVersion) !== MAGALU_IDENTITY_CONTRACT_VERSION ||
    texto(prova.source) !== "local_first_party" || texto(prova.provenance) !== "local_worker.magalu_identity_v1" ||
    texto(prova.identityKey) !== identityKey || texto(prova.observedProductId).toLowerCase() !== observedProductId ||
    prova.redirected !== true || sanitizarUrlProdutoMagalu(prova.finalUrl) !== finalUrl) {
    throw erroContrato("magalu_identity_prova_invalida");
  }
  return {
    capability: MAGALU_IDENTITY_CAPABILITY,
    contractVersion: MAGALU_IDENTITY_CONTRACT_VERSION,
    marketplace: "magalu",
    identityKey,
    sourceUrl,
    observedProductId,
    identidadeValidada: true,
    finalUrl,
    canonicalUrl,
    collectedAt: coletado.toISOString(),
    provaTecnica: {
      capability: MAGALU_IDENTITY_CAPABILITY,
      contractVersion: MAGALU_IDENTITY_CONTRACT_VERSION,
      source: "local_first_party",
      provenance: "local_worker.magalu_identity_v1",
      identityKey,
      observedProductId,
      redirected: true,
      finalUrl,
      statusHttp: Number(prova.statusHttp || 0),
      collectedAt: coletado.toISOString()
    }
  };
}

module.exports = {
  MAGALU_IDENTITY_CAPABILITY,
  MAGALU_IDENTITY_CONTRACT_VERSION,
  MAGALU_IDENTITY_TASK_TYPE,
  MAGALU_IDENTITY_RESULT_TTL_MS,
  MAGALU_IDENTITY_CACHE_TTL_MS,
  sanitizarUrlOneLinkMagalu,
  sanitizarUrlProdutoMagalu,
  produtoIdUrlMagalu,
  chaveIdentidadeMagalu,
  validarResultadoMagaluIdentity
};
