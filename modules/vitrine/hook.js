"use strict";

const storage = require("./storage");
const { resolverImagemUniversal } = require("../imagens/resolver-imagem-universal");
const { normalizarCuponsSemanticos } = require("../radar/cupom-semantico");

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

function lista(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor === null || valor === undefined || valor === "") return [];
  return [valor];
}

function coletarCuponsOferta(oferta = {}) {
  const contrato = oferta.contratoComercialFinal && typeof oferta.contratoComercialFinal === "object"
    ? oferta.contratoComercialFinal
    : {};
  const fontesFinais = [
    ...lista(contrato.codigosCupom),
    ...lista(contrato.cupomCodigo)
  ];
  const candidatos = fontesFinais.some(item => texto(item))
    ? fontesFinais
    : [
      ...lista(oferta.codigosCupom),
      ...lista(oferta.cupons),
      ...lista(oferta.cupomCodigo),
      ...lista(oferta.codigoCupom),
      ...lista(oferta.cupom)
    ];

  return normalizarCuponsSemanticos(candidatos).slice(0, 8);
}

function imagemOfertaVitrine(oferta = {}) {
  try {
    const resolvida = resolverImagemUniversal(oferta, { origem: "vitrine_hook" });
    return texto(resolvida.imagem || resolvida.imagemUrl || "");
  } catch {
    return texto(oferta.imagem || oferta.image || oferta.thumbnail || "");
  }
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

function urlAfiliadaConvertidaCandidata(link = {}) {
  if (!link || typeof link !== "object") return "";
  const candidatos = [
    link.urlOptimus,
    link.redirectOptimus,
    link.urlAfiliadaWorkspace,
    link.urlAfiliada,
    link.afiliado,
    link.linkAfiliado,
    link.url,
    link.link
  ];
  for (const candidato of candidatos) {
    const redirectExistente = urlRedirectOptimus(candidato);
    if (redirectExistente) return redirectExistente;
  }
  return texto(
    link.urlAfiliadaWorkspace ||
    link.urlAfiliada ||
    link.afiliado ||
    link.linkAfiliado ||
    link.resolvido ||
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

function criarRedirectOptimusVitrine(urlDestino = "", marketplace = "", workspaceId = "", deps = {}, cache = new Map()) {
  const destino = texto(urlDestino);
  if (!destino) return "";
  const redirectExistente = urlRedirectOptimus(destino);
  if (redirectExistente) return redirectExistente;
  if (cache.has(destino)) return cache.get(destino);
  const criarLink = typeof deps.criarLinkOptimus === "function" ? deps.criarLinkOptimus : null;
  const gerarLink = typeof deps.gerarLinkOptimus === "function" ? deps.gerarLinkOptimus : null;
  if (!criarLink && !gerarLink) return "";

  try {
    const resultado = criarLink
      ? criarLink(destino, marketplace, { clienteId: workspaceId })
      : gerarLink(destino, marketplace, { clienteId: workspaceId });
    const url = typeof resultado === "string"
      ? resultado
      : texto(resultado?.url);
    const redirect = urlRedirectOptimus(url);
    cache.set(destino, redirect);
    return redirect;
  } catch (erro) {
    const logger = deps.logger || console;
    if (typeof logger.warn === "function") {
      logger.warn("[VITRINE-LINK-OPTIMUS-FALHA]", {
        clienteId: workspaceId,
        marketplace,
        motivo: erro?.message || "erro_gerar_redirect"
      });
    }
    cache.set(destino, "");
    return "";
  }
}

function fontesLinksComerciaisVitrine(oferta = {}) {
  const contrato = oferta.contratoComercialFinal && typeof oferta.contratoComercialFinal === "object"
    ? oferta.contratoComercialFinal
    : {};
  const integridade = oferta.metadata?.integridadeComercial && typeof oferta.metadata.integridadeComercial === "object"
    ? oferta.metadata.integridadeComercial
    : {};
  return [
    { campo: "linksApp", links: Array.isArray(contrato.linksApp) ? contrato.linksApp : [] },
    { campo: "linksPc", links: Array.isArray(contrato.linksPc) ? contrato.linksPc : [] },
    { campo: "linksProduto", links: Array.isArray(contrato.linksProduto) ? contrato.linksProduto : [] },
    { campo: "linksResgate", links: Array.isArray(contrato.linksResgate) ? contrato.linksResgate : [] },
    { campo: "linksComerciais", links: Array.isArray(integridade.linksComerciais) ? integridade.linksComerciais : [] },
    { campo: "linksComerciais", links: Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : [] },
    { campo: "linksApp", links: Array.isArray(oferta.linksApp) ? oferta.linksApp : [] },
    { campo: "linksPc", links: Array.isArray(oferta.linksPc) ? oferta.linksPc : [] },
    { campo: "linksProduto", links: Array.isArray(oferta.linksProduto) ? oferta.linksProduto : [] },
    { campo: "linksResgate", links: Array.isArray(oferta.linksResgate) ? oferta.linksResgate : [] }
  ];
}

function enriquecerOfertaComRedirectsVitrine(oferta = {}, workspaceId = "", deps = {}) {
  if (!oferta || typeof oferta !== "object") return oferta;
  const marketplace = texto(oferta.marketplace || oferta.mercado || "");
  const cache = new Map();
  const proxima = { ...oferta };
  const linksPorCampo = {
    linksComerciais: [],
    linksApp: [],
    linksPc: [],
    linksProduto: [],
    linksResgate: []
  };
  const vistos = new Set();

  for (const fonte of fontesLinksComerciaisVitrine(oferta)) {
    for (const [indice, link] of fonte.links.entries()) {
      if (!link || typeof link !== "object" || link.renderizavel === false) continue;
      const destino = urlAfiliadaConvertidaCandidata(link);
      const redirect = criarRedirectOptimusVitrine(destino, marketplace, workspaceId, deps, cache);
      if (!redirect) continue;
      const papel = normalizarPapelLink(link);
      const ordemCaptura = numero(link.ordemCaptura || link.ordem || indice + 1) || indice + 1;
      const chave = `${fonte.campo}:${papel.papel}:${redirect}:${ordemCaptura}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      linksPorCampo[fonte.campo].push({
        ...link,
        tipo: papel.tipo,
        papel: papel.papel,
        label: texto(link.label || link.titulo || papel.label),
        ordemCaptura,
        urlOptimus: redirect,
        redirectOptimus: redirect,
        urlAfiliadaOriginalAntesLinkOptimus: destino,
        renderizavel: true,
        conversaoStatus: texto(link.conversaoStatus || "convertida") || "convertida",
        linkOptimusVitrineAplicado: true
      });
    }
  }

  for (const [campo, links] of Object.entries(linksPorCampo)) {
    if (links.length) proxima[campo] = links;
  }

  if (!coletarLinksComerciaisFinais(proxima).length) {
    const destinoPrincipal = texto(
      oferta.urlOptimus ||
      oferta.urlAfiliadaWorkspace ||
      oferta.urlAfiliada ||
      oferta.afiliado ||
      oferta.linkAfiliado ||
      oferta.linkFinal ||
      oferta.linkProduto ||
      oferta.link ||
      ""
    );
    const redirectPrincipal = criarRedirectOptimusVitrine(destinoPrincipal, marketplace, workspaceId, deps, cache);
    if (redirectPrincipal) {
      proxima.urlOptimus = redirectPrincipal;
      proxima.linkProduto = redirectPrincipal;
    }
  }

  return proxima;
}

function coletarLinksComerciaisFinais(oferta = {}) {
  const contrato = oferta.contratoComercialFinal && typeof oferta.contratoComercialFinal === "object"
    ? oferta.contratoComercialFinal
    : {};
  const integridade = oferta.metadata?.integridadeComercial && typeof oferta.metadata.integridadeComercial === "object"
    ? oferta.metadata.integridadeComercial
    : {};
  const candidatos = [
    ...(Array.isArray(contrato.linksApp) ? contrato.linksApp : []),
    ...(Array.isArray(contrato.linksPc) ? contrato.linksPc : []),
    ...(Array.isArray(contrato.linksProduto) ? contrato.linksProduto : []),
    ...(Array.isArray(contrato.linksResgate) ? contrato.linksResgate : []),
    ...(Array.isArray(integridade.linksComerciais) ? integridade.linksComerciais : []),
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

  if (!links.length) {
    const urlFallback = urlRedirectOptimus(
      oferta.urlOptimus ||
      oferta.linkProduto ||
      oferta.linkFinal ||
      oferta.linkAfiliado ||
      ""
    );
    if (urlFallback) {
      links.push({
        tipo: "produto",
        papel: "link_produto",
        label: "Produto",
        ordemCaptura: 999,
        ocorrenciaId: "",
        urlOptimus: urlFallback,
        renderizavel: true,
        conversaoStatus: "convertida"
      });
    }
  }

  return links.sort((a, b) => a.ordemCaptura - b.ordemCaptura);
}

function montarOfertaVitrine(oferta = {}) {
  const enviadoEm = texto(oferta.enviadoEm || oferta.dataEnvio || "") || new Date().toISOString();
  const cupons = coletarCuponsOferta(oferta);
  return {
    idPublico: texto(oferta.ofertaId || oferta.engineOfertaId || oferta.id || oferta.linkAfiliado || oferta.titulo || ""),
    ofertaId: texto(oferta.ofertaId || oferta.engineOfertaId || oferta.id || ""),
    titulo: texto(oferta.titulo || oferta.nome || ""),
    imagem: imagemOfertaVitrine(oferta),
    marketplace: texto(oferta.marketplace || ""),
    categoria: texto(oferta.categoria || ""),
    preco: oferta.preco ?? oferta.precoAtual ?? "",
    precoAtual: oferta.precoAtual ?? oferta.preco ?? "",
    precoAnterior: oferta.precoAnterior ?? oferta.precoOriginal ?? oferta.precoDe ?? "",
    desconto: texto(oferta.desconto || oferta.percentualDesconto || ""),
    cupom: cupons.length ? cupons.join(" ou ") : texto(oferta.cupom || oferta.codigoCupom || ""),
    cupons,
    beneficios: lista(oferta.beneficios || oferta.beneficioTexto || oferta.beneficio).map(texto).filter(Boolean).slice(0, 6),
    moedas: oferta.moedas || oferta.moedasShopee || oferta.metadata?.radarMirror?.comercial?.condicoesComerciais?.moedas?.valor || "",
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

    const ofertaComRedirects = enriquecerOfertaComRedirectsVitrine(oferta, workspaceId, deps);
    const ofertaVitrine = montarOfertaVitrine(ofertaComRedirects);
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
  enriquecerOfertaComRedirectsVitrine,
  montarOfertaVitrine,
  publicarOfertaConfirmadaVitrine,
  coletarCuponsOferta,
  urlRedirectOptimus
};
