"use strict";

const storage = require("./storage");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function mesmoWorkspace(clienteId = "", oferta = {}) {
  const donoOferta = texto(oferta.clienteId || oferta.workspaceId || "");
  return !donoOferta || String(donoOferta) === String(clienteId);
}

function numero(valor = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function normalizarPapelLink(link = {}) {
  const bruto = texto(link.papel || link.tipo || "").toLowerCase();
  if (["app", "link_app"].includes(bruto)) return { tipo: "app", papel: "link_app", label: "APP" };
  if (["pc", "link_pc"].includes(bruto)) return { tipo: "pc", papel: "link_pc", label: "PC" };
  if (["resgate", "cupom", "link_resgate"].includes(bruto)) {
    return { tipo: "resgate", papel: "link_resgate", label: "Resgatar cupom" };
  }
  if (["produto", "link_produto"].includes(bruto)) return { tipo: "produto", papel: "link_produto", label: "Produto" };
  return { tipo: bruto || "produto", papel: bruto || "link_produto", label: texto(link.label || link.titulo || "") };
}

function urlCandidata(link = {}) {
  return texto(
    link.urlOptimus ||
    link.redirectOptimus ||
    link.urlAfiliadaWorkspace ||
    link.urlAfiliada ||
    link.afiliado ||
    link.linkAfiliado ||
    link.url ||
    link.link ||
    ""
  );
}

function urlRedirectOptimus(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "go.optimuspromo.com.br") return "";
    if (!url.pathname.startsWith("/r/")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function linkRenderizavel(link = {}) {
  if (!link || typeof link !== "object") return false;
  if (link.renderizavel === false) return false;
  if (texto(link.conversaoStatus).toLowerCase() === "falhou") return false;
  return Boolean(urlRedirectOptimus(urlCandidata(link)));
}

function coletarLinksComerciaisFinais(oferta = {}) {
  const contrato = oferta.contratoComercialFinal && typeof oferta.contratoComercialFinal === "object"
    ? oferta.contratoComercialFinal
    : {};
  const candidatos = [
    ...(Array.isArray(contrato.linksApp) ? contrato.linksApp : []),
    ...(Array.isArray(contrato.linksPc) ? contrato.linksPc : []),
    ...(Array.isArray(contrato.linksProduto) ? contrato.linksProduto : []),
    ...(Array.isArray(contrato.linksResgate) ? contrato.linksResgate : []),
    ...(Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : []),
    ...(Array.isArray(oferta.linksApp) ? oferta.linksApp : []),
    ...(Array.isArray(oferta.linksPc) ? oferta.linksPc : []),
    ...(Array.isArray(oferta.linksProduto) ? oferta.linksProduto : []),
    ...(Array.isArray(oferta.linksResgate) ? oferta.linksResgate : [])
  ];
  const vistos = new Set();
  const links = [];

  for (const [indice, link] of candidatos.entries()) {
    if (!linkRenderizavel(link)) continue;
    const url = urlRedirectOptimus(urlCandidata(link));
    const papel = normalizarPapelLink(link);
    const ocorrenciaId = texto(link.ocorrenciaId || link.idOcorrencia || "");
    const chave = `${papel.papel}:${url}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    links.push({
      tipo: papel.tipo,
      papel: papel.papel,
      label: papel.label,
      ordemCaptura: numero(link.ordemCaptura || link.ordem || indice + 1) || indice + 1,
      ocorrenciaId,
      urlOptimus: url,
      renderizavel: true,
      conversaoStatus: texto(link.conversaoStatus || "convertida") || "convertida"
    });
  }

  return links.sort((a, b) => a.ordemCaptura - b.ordemCaptura);
}

function montarOfertaVitrine(oferta = {}) {
  const enviadoEm = texto(oferta.enviadoEm || oferta.dataEnvio || "") || new Date().toISOString();
  return {
    idPublico: texto(oferta.ofertaId || oferta.engineOfertaId || oferta.id || oferta.linkAfiliado || oferta.titulo || ""),
    ofertaId: texto(oferta.ofertaId || oferta.engineOfertaId || oferta.id || ""),
    titulo: texto(oferta.titulo || oferta.nome || ""),
    imagem: texto(oferta.imagem || oferta.image || oferta.thumbnail || ""),
    marketplace: texto(oferta.marketplace || ""),
    categoria: texto(oferta.categoria || ""),
    preco: oferta.preco ?? oferta.precoAtual ?? "",
    precoAtual: oferta.precoAtual ?? oferta.preco ?? "",
    precoAnterior: oferta.precoAnterior ?? oferta.precoOriginal ?? oferta.precoDe ?? "",
    desconto: texto(oferta.desconto || oferta.percentualDesconto || ""),
    cupom: texto(oferta.cupom || oferta.codigoCupom || ""),
    enviadoEm,
    ultimoEnvioEm: enviadoEm,
    linksComerciais: coletarLinksComerciaisFinais(oferta)
  };
}

function logFalha(logger = console, clienteId = "", oferta = {}, erro = null) {
  const payload = {
    clienteId,
    ofertaId: texto(oferta.ofertaId || oferta.engineOfertaId || oferta.id || ""),
    marketplace: texto(oferta.marketplace || ""),
    titulo: texto(oferta.titulo || oferta.nome || "").slice(0, 120),
    erro: erro?.message || "vitrine_hook_falhou"
  };

  if (typeof logger.warn === "function") {
    logger.warn("[VITRINE-HOOK-FALHA]", payload);
  } else if (typeof logger.log === "function") {
    logger.log("[VITRINE-HOOK-FALHA]", payload);
  }
}

function publicarOfertaConfirmadaVitrine({ clienteId = "", oferta = {}, destinosEnviados = 0, deps = {} } = {}) {
  const workspaceId = texto(clienteId || oferta.clienteId || "admin");
  const logger = deps.logger || console;

  try {
    if (!workspaceId) return { ok: false, motivo: "workspace_invalido" };
    if (!oferta || typeof oferta !== "object") return { ok: false, motivo: "oferta_invalida" };
    if (!mesmoWorkspace(workspaceId, oferta)) return { ok: false, motivo: "workspace_divergente" };
    if (numero(destinosEnviados) <= 0) return { ok: false, motivo: "sem_envio_confirmado" };
    if (texto(oferta.status).toLowerCase() && texto(oferta.status).toLowerCase() !== "enviado") {
      return { ok: false, motivo: "status_nao_enviado" };
    }

    const temRecurso = typeof deps.clienteTemRecurso === "function"
      ? deps.clienteTemRecurso(workspaceId, "vitrine")
      : false;
    if (temRecurso !== true) return { ok: false, motivo: "recurso_indisponivel" };

    const vitrine = storage.lerVitrineWorkspace(workspaceId, deps);
    if (vitrine.config?.ativa !== true) return { ok: false, motivo: "vitrine_inativa" };

    const ofertaVitrine = montarOfertaVitrine(oferta);
    const resultado = storage.upsertOfertaVitrine(workspaceId, ofertaVitrine, deps);
    return {
      ok: resultado.ok === true,
      motivo: resultado.motivo || "publicada",
      oferta: resultado.oferta || null
    };
  } catch (erro) {
    logFalha(logger, workspaceId, oferta, erro);
    return { ok: false, motivo: "vitrine_hook_falhou", erro: erro?.message || "erro" };
  }
}

module.exports = {
  coletarLinksComerciaisFinais,
  montarOfertaVitrine,
  publicarOfertaConfirmadaVitrine,
  urlRedirectOptimus
};
