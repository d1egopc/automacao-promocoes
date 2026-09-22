"use strict";

const fs = require("fs");
const path = require("path");
const { validarProvaAfiliacaoWorkspaceShopee } = require("../marketplaces/shopee/afiliacao-workspace");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizar(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function marketplacePermiteLinkResgate(marketplace = "") {
  return normalizar(marketplace) === "shopee";
}

function papelLink(item = {}) {
  if (!item || typeof item !== "object") return "";
  return normalizar(item.papel || item.tipo || "").replace(/^link/, "");
}

function urlFinalOptimus(item = {}) {
  if (!item || typeof item !== "object") return "";
  return texto(
    item.urlOptimus ||
    item.urlAfiliadaWorkspace ||
    item.urlAfiliada ||
    item.afiliado ||
    item.linkAfiliado ||
    ""
  );
}

function hostShopee(url = "") {
  try {
    const host = new URL(texto(url)).hostname.toLowerCase().replace(/^www\./, "");
    return host === "shopee.com.br" || host.endsWith(".shopee.com.br");
  } catch (_) {
    return false;
  }
}

function lerJsonConfiavel(caminho = "") {
  try {
    const dados = JSON.parse(fs.readFileSync(caminho, "utf8"));
    return dados && typeof dados === "object" && !Array.isArray(dados) ? dados : null;
  } catch (_) {
    return null;
  }
}

function credenciaisWorkspaceShopee(workspaceId = "") {
  if (!/^[a-zA-Z0-9_.-]+$/.test(workspaceId) || workspaceId.includes("..")) return null;
  const dataDir = process.env.DATA_DIR || "/data";
  const arquivoCliente = path.join(dataDir, "clientes", workspaceId, "integracoes.json");
  const porCliente = fs.existsSync(arquivoCliente) ? lerJsonConfiavel(arquivoCliente) : null;
  const integracoes = porCliente || lerJsonConfiavel(path.join(dataDir, "integracoes.json"))?.[workspaceId];
  const shopee = integracoes?.shopee;
  return shopee && typeof shopee === "object" ? (shopee.credenciais || shopee) : null;
}

function evidenciaConversaoWorkspace(item = {}, urlFinal = "", workspaceId = "") {
  if (!urlFinal || !workspaceId) return false;
  const prova = item.afiliacaoWorkspace && typeof item.afiliacaoWorkspace === "object"
    ? item.afiliacaoWorkspace
    : (item.conversaoWorkspace && typeof item.conversaoWorkspace === "object" ? item.conversaoWorkspace : null);
  if (!prova) return false;

  const papel = normalizar(prova.papel).replace(/^link/, "");
  const urlProva = texto(prova.urlAfiliadaWorkspace);
  const urlAfiliadaItem = texto(item.urlAfiliadaWorkspace || item.urlAfiliada || item.afiliado || item.linkAfiliado || "");
  const urlOptimus = texto(item.urlOptimus);
  const originalItem = texto(item.urlOriginal || item.original || item.url || item.link || "");
  const originalProva = texto(prova.urlOriginal);
  const afiliadoEsperado = texto(prova.affiliateIdEsperado);
  const afiliadoDetectado = texto(prova.affiliateIdDetectado);
  const credenciais = credenciaisWorkspaceShopee(workspaceId);
  if (!credenciais || !validarProvaAfiliacaoWorkspaceShopee(prova, {
    clienteId: workspaceId,
    credenciais,
    exigirAssinatura: true
  }).valida) return false;

  return item.renderizavel === true &&
    normalizar(item.conversaoStatus) === "convertida" &&
    normalizar(prova.origemConversao) === "workspaceapi" &&
    normalizar(prova.conversaoStatus) === "convertida" &&
    papel === "resgate" &&
    texto(prova.workspaceId) === workspaceId &&
    Boolean(afiliadoEsperado) &&
    afiliadoEsperado === afiliadoDetectado &&
    Boolean(urlProva) &&
    urlProva === urlAfiliadaItem &&
    texto(prova.urlFinalPublicada) === urlFinal &&
    (!urlOptimus || urlOptimus === urlFinal) &&
    urlFinal !== originalItem &&
    urlFinal !== originalProva &&
    (!originalItem || !originalProva || originalItem === originalProva ||
      texto(item.destinoFuncionalOriginal?.url) === originalProva);
}

function linkResgateShopeePublicavel(item = {}, workspaceId = "") {
  if (!item || typeof item !== "object") return false;
  if (!["resgate", "cupom"].includes(papelLink(item))) return false;
  const urlFinal = urlFinalOptimus(item);
  if (!urlFinal) return false;
  const urlOriginal = texto(item.urlOriginal || item.original || item.url || item.link || "");
  if (!hostShopee(urlOriginal) && !hostShopee(urlFinal)) return false;
  const status = normalizar(item.conversaoStatus || item.statusConversao || "");
  if (status && status !== "convertida") return false;
  return evidenciaConversaoWorkspace(item, urlFinal, texto(workspaceId));
}

function filtrarLinksResgatePublicaveis(marketplace = "", links = [], workspaceId = "") {
  if (!marketplacePermiteLinkResgate(marketplace)) return [];
  return (Array.isArray(links) ? links : []).filter(item => linkResgateShopeePublicavel(item, workspaceId));
}

module.exports = {
  marketplacePermiteLinkResgate,
  linkResgateShopeePublicavel,
  filtrarLinksResgatePublicaveis,
  urlFinalOptimus
};
