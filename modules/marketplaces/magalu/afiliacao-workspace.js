"use strict";

const crypto = require("crypto");
const {
  linkPertenceLojaMagalu,
  normalizarSlugLojaMagalu,
  slugsLojaMagalu,
  construirUrlsDeterministicasWorkspaceMagalu
} = require("./magalu-affiliate-link");
const { produtoIdPorUrl } = require("./magalu-parser");

const PROOF_TYPE_PAGE_VALIDATED = "page_validated";
const PROOF_TYPE_DETERMINISTIC_WORKSPACE = "deterministic_workspace";

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
    conversaoStatus: texto(prova.conversaoStatus), proofType: texto(prova.proofType),
    paginaValidada: prova.paginaValidada === true, aliasLoja: texto(prova.aliasLoja),
    papelLink: texto(prova.papelLink), urlConstruidaPor: texto(prova.urlConstruidaPor)
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

function aliasPorUrl(url = "") {
  try {
    return texto(new URL(texto(url)).pathname.split("/").filter(Boolean)[0]).toLowerCase();
  } catch (_) {
    return "";
  }
}

function semTrackingEstrangeiro(url = "") {
  try {
    const parsed = new URL(texto(url));
    return !parsed.searchParams.has("promoter_id") && !parsed.searchParams.has("partner_id");
  } catch (_) {
    return false;
  }
}

function urlDeterministicaExata({ urlOriginal = "", urlAfiliadaWorkspace = "", promoterId = "", productId = "" } = {}) {
  const originalId = produtoIdPorUrl(urlOriginal);
  const afiliadaId = produtoIdPorUrl(urlAfiliadaWorkspace);
  if (!originalId || originalId !== texto(productId) || afiliadaId !== texto(productId)) return false;
  return construirUrlsDeterministicasWorkspaceMagalu(urlOriginal, promoterId)
    .some(item => item.url === texto(urlAfiliadaWorkspace));
}

function criarProvaAfiliacaoWorkspaceMagalu({
  clienteId = "", promoterId = "", productId = "", seller = "", urlOriginal = "",
  urlAfiliadaWorkspace = "", paginaValidada = false, proofType = "", papelLink = "",
  urlConstruidaPor = ""
} = {}) {
  const slugLoja = normalizarSlugLojaMagalu(promoterId);
  const urlAfiliada = texto(urlAfiliadaWorkspace);
  const tipoProva = texto(proofType) || (paginaValidada === true ? PROOF_TYPE_PAGE_VALIDATED : "");
  const aliasLoja = aliasPorUrl(urlAfiliada);
  const sellerFinal = sellerPorUrl(urlAfiliada);
  const sellerCompativel = !texto(seller) || !sellerFinal || sellerFinal === texto(seller);
  const baseValida = Boolean(
    texto(clienteId) && slugLoja && texto(productId) && urlAfiliada &&
    produtoIdPorUrl(urlOriginal) === texto(productId) && semTrackingEstrangeiro(urlAfiliada) &&
    linkPertenceLojaMagalu(urlAfiliada, promoterId) && produtoIdPorUrl(urlAfiliada) === texto(productId) && sellerCompativel
  );
  const paginaComprovada = tipoProva === PROOF_TYPE_PAGE_VALIDATED && paginaValidada === true;
  const deterministicaComprovada = Boolean(
    tipoProva === PROOF_TYPE_DETERMINISTIC_WORKSPACE && paginaValidada === false &&
    texto(urlConstruidaPor) === "magalu_deterministic_builder_v1" &&
    urlDeterministicaExata({ urlOriginal, urlAfiliadaWorkspace: urlAfiliada, promoterId, productId })
  );
  const valida = Boolean(
    baseValida && (paginaComprovada || deterministicaComprovada)
  );
  const prova = {
    workspaceId: texto(clienteId), slugLoja, productId: texto(productId), seller: texto(seller),
    urlOriginal: texto(urlOriginal), urlAfiliadaWorkspace: valida ? urlAfiliada : "",
    origemConversao: tipoProva === PROOF_TYPE_DETERMINISTIC_WORKSPACE
      ? "workspace_magazinevoce_deterministic"
      : "workspace_magazinevoce_page",
    conversaoStatus: valida ? "convertida" : "falhou",
    motivoConversao: valida
      ? (tipoProva === PROOF_TYPE_DETERMINISTIC_WORKSPACE ? "url_workspace_deterministica" : "pagina_workspace_validada")
      : "afiliacao_workspace_incompleta",
    proofType: tipoProva,
    paginaValidada: paginaValidada === true,
    aliasLoja,
    papelLink: texto(papelLink),
    urlConstruidaPor: tipoProva === PROOF_TYPE_DETERMINISTIC_WORKSPACE ? texto(urlConstruidaPor) : ""
  };
  return { ...prova, assinatura: assinar(prova) };
}

function validarProvaAfiliacaoWorkspaceMagalu(prova = {}, { clienteId = "", promoterId = "", papelLink = "" } = {}) {
  const slugLoja = normalizarSlugLojaMagalu(promoterId);
  const tipoProva = texto(prova.proofType);
  const tipoValido = tipoProva === PROOF_TYPE_PAGE_VALIDATED || tipoProva === PROOF_TYPE_DETERMINISTIC_WORKSPACE;
  const origemValida = tipoProva === PROOF_TYPE_PAGE_VALIDATED
    ? prova.origemConversao === "workspace_magazinevoce_page" && prova.paginaValidada === true
    : prova.origemConversao === "workspace_magazinevoce_deterministic" && prova.paginaValidada === false;
  const aliasValido = slugsLojaMagalu(promoterId).includes(texto(prova.aliasLoja).toLowerCase()) &&
    aliasPorUrl(prova.urlAfiliadaWorkspace) === texto(prova.aliasLoja).toLowerCase();
  const papelValido = !texto(papelLink) || texto(prova.papelLink) === texto(papelLink);
  const deterministicaValida = tipoProva !== PROOF_TYPE_DETERMINISTIC_WORKSPACE || (
    prova.urlConstruidaPor === "magalu_deterministic_builder_v1" &&
    urlDeterministicaExata({
      urlOriginal: prova.urlOriginal,
      urlAfiliadaWorkspace: prova.urlAfiliadaWorkspace,
      promoterId,
      productId: prova.productId
    })
  );
  const valida = Boolean(
    tipoValido && origemValida && aliasValido && papelValido && deterministicaValida &&
    texto(clienteId) && prova.workspaceId === texto(clienteId) && prova.slugLoja === slugLoja &&
    prova.conversaoStatus === "convertida" &&
    texto(prova.productId) && produtoIdPorUrl(prova.urlOriginal) === texto(prova.productId) &&
    texto(prova.urlAfiliadaWorkspace) && semTrackingEstrangeiro(prova.urlAfiliadaWorkspace) &&
    linkPertenceLojaMagalu(prova.urlAfiliadaWorkspace, promoterId) &&
    produtoIdPorUrl(prova.urlAfiliadaWorkspace) === texto(prova.productId) && assinaturaValida(prova)
  );
  return { valida, prova: { ...prova, slugLojaEsperado: slugLoja, proofTypeDetectado: tipoProva } };
}

function validarOfertaAfiliacaoWorkspaceMagalu(oferta = {}, { clienteId = "", promoterId = "" } = {}) {
  if (texto(oferta.marketplace || oferta.mercado).toLowerCase() !== "magalu") return { ok: true, motivo: "nao_aplicavel" };
  const prova = oferta.metadata?.afiliacaoWorkspace || oferta.afiliacaoWorkspace || {};
  const papelLink = texto(oferta.metadata?.papelLinkEscolhido || oferta.papelLink || "");
  const resultado = validarProvaAfiliacaoWorkspaceMagalu(prova, { clienteId, promoterId, papelLink });
  return { ok: resultado.valida, motivo: resultado.valida ? "afiliacao_workspace_convertida" : "afiliacao_workspace_incompleta", prova: resultado.prova };
}

module.exports = {
  PROOF_TYPE_PAGE_VALIDATED,
  PROOF_TYPE_DETERMINISTIC_WORKSPACE,
  criarProvaAfiliacaoWorkspaceMagalu,
  validarProvaAfiliacaoWorkspaceMagalu,
  validarOfertaAfiliacaoWorkspaceMagalu
};
