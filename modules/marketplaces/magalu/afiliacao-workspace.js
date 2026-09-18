"use strict";

const crypto = require("crypto");
const { linkPertenceLojaMagalu, normalizarSlugLojaMagalu } = require("./magalu-affiliate-link");
const { produtoIdPorUrl } = require("./magalu-parser");

function texto(valor = "") {
  return String(valor || "").trim();
}

function sellerPorUrl(url = "") {
  try {
    const parsed = new URL(texto(url));
    return texto(parsed.searchParams.get("seller_id") || parsed.searchParams.get("sellerId") || parsed.searchParams.get("seller"));
  } catch (_) {
    return "";
  }
}

function segredoServidor() {
  return texto(process.env.JWT_SECRET || process.env.MAGALU_AFFILIATION_PROOF_SECRET);
}

function payload(prova = {}) {
  return JSON.stringify({
    workspaceId: texto(prova.workspaceId), slugLoja: texto(prova.slugLoja), productId: texto(prova.productId),
    seller: texto(prova.seller), urlOriginal: texto(prova.urlOriginal),
    urlAfiliadaWorkspace: texto(prova.urlAfiliadaWorkspace), origemConversao: texto(prova.origemConversao),
    conversaoStatus: texto(prova.conversaoStatus)
  });
}

function assinar(prova = {}) {
  const segredo = segredoServidor();
  return segredo ? crypto.createHmac("sha256", segredo).update(payload(prova), "utf8").digest("hex") : "";
}

function assinaturaValida(prova = {}) {
  const recebida = texto(prova.assinatura);
  const esperada = assinar(prova);
  return Boolean(recebida && esperada && recebida.length === esperada.length && crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada)));
}

function criarProvaAfiliacaoWorkspaceMagalu({ clienteId = "", promoterId = "", productId = "", seller = "", urlOriginal = "", urlAfiliadaWorkspace = "", paginaValidada = false } = {}) {
  const slugLoja = normalizarSlugLojaMagalu(promoterId);
  const urlAfiliada = texto(urlAfiliadaWorkspace);
  const sellerFinal = sellerPorUrl(urlAfiliada);
  const sellerCompativel = !texto(seller) || !sellerFinal || sellerFinal === texto(seller);
  const valida = Boolean(
    texto(clienteId) && slugLoja && texto(productId) && paginaValidada === true && urlAfiliada &&
    linkPertenceLojaMagalu(urlAfiliada, promoterId) && produtoIdPorUrl(urlAfiliada) === texto(productId) && sellerCompativel
  );
  const prova = {
    workspaceId: texto(clienteId), slugLoja, productId: texto(productId), seller: texto(seller),
    urlOriginal: texto(urlOriginal), urlAfiliadaWorkspace: valida ? urlAfiliada : "",
    origemConversao: "workspace_magazinevoce", conversaoStatus: valida ? "convertida" : "falhou",
    motivoConversao: valida ? "pagina_workspace_validada" : "afiliacao_workspace_incompleta"
  };
  return { ...prova, assinatura: assinar(prova) };
}

function validarProvaAfiliacaoWorkspaceMagalu(prova = {}, { clienteId = "", promoterId = "" } = {}) {
  const slugLoja = normalizarSlugLojaMagalu(promoterId);
  const valida = Boolean(
    texto(clienteId) && prova.workspaceId === texto(clienteId) && prova.slugLoja === slugLoja &&
    prova.origemConversao === "workspace_magazinevoce" && prova.conversaoStatus === "convertida" &&
    texto(prova.productId) && texto(prova.urlAfiliadaWorkspace) && linkPertenceLojaMagalu(prova.urlAfiliadaWorkspace, promoterId) &&
    produtoIdPorUrl(prova.urlAfiliadaWorkspace) === texto(prova.productId) && assinaturaValida(prova)
  );
  return { valida, prova: { ...prova, slugLojaEsperado: slugLoja } };
}

function validarOfertaAfiliacaoWorkspaceMagalu(oferta = {}, { clienteId = "", promoterId = "" } = {}) {
  if (texto(oferta.marketplace || oferta.mercado).toLowerCase() !== "magalu") return { ok: true, motivo: "nao_aplicavel" };
  const prova = oferta.metadata?.afiliacaoWorkspace || oferta.afiliacaoWorkspace || {};
  const resultado = validarProvaAfiliacaoWorkspaceMagalu(prova, { clienteId, promoterId });
  return { ok: resultado.valida, motivo: resultado.valida ? "afiliacao_workspace_convertida" : "afiliacao_workspace_incompleta", prova: resultado.prova };
}

module.exports = { criarProvaAfiliacaoWorkspaceMagalu, validarProvaAfiliacaoWorkspaceMagalu, validarOfertaAfiliacaoWorkspaceMagalu };

