"use strict";

const CAMPOS_CTA_ESCALARES = [
  "linkAfiliado",
  "linkFinal",
  "link",
  "urlAfiliada",
  "urlOptimus"
];

const CAMPOS_CTA_ESTRUTURADOS = [
  "linksComerciais",
  "linksProduto",
  "linksResgate",
  "linksApp",
  "linksPc"
];

const CAMPOS_LINK_PERMITIDOS = [
  "tipo",
  "papel",
  "label",
  "titulo",
  "ordemCaptura",
  "ordem",
  "ocorrenciaId",
  "idOcorrencia",
  "urlOptimus",
  "redirectOptimus",
  "urlAfiliadaWorkspace",
  "urlAfiliada",
  "afiliado",
  "linkAfiliado",
  "url",
  "link",
  "renderizavel",
  "conversaoStatus",
  "motivoConversao"
];

const CAMPOS_URL_LINK = [
  "urlOptimus",
  "redirectOptimus",
  "urlAfiliadaWorkspace",
  "urlAfiliada",
  "afiliado",
  "linkAfiliado",
  "url",
  "link"
];

function normalizarTexto(valor) {
  return String(valor || "").trim();
}

function urlOptimusPublica(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return "";
  try {
    const url = new URL(texto);
    if (
      url.protocol === "https:" &&
      url.hostname === "go.optimuspromo.com.br" &&
      url.pathname.startsWith("/r/")
    ) {
      return url.toString();
    }
  } catch (_) {
    return "";
  }
  return "";
}

function urlsCtaVitrineOferta(oferta = {}) {
  const urls = [];
  if (!oferta || typeof oferta !== "object") return urls;

  for (const campo of CAMPOS_CTA_ESCALARES) {
    const url = urlOptimusPublica(oferta[campo]);
    if (url) urls.push(url);
  }

  for (const campo of CAMPOS_CTA_ESTRUTURADOS) {
    const lista = oferta[campo];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      for (const campoUrl of CAMPOS_URL_LINK) {
        const url = urlOptimusPublica(item[campoUrl]);
        if (url) urls.push(url);
      }
    }
  }

  return [...new Set(urls)];
}

function copiarLinkEstruturadoSeguro(item) {
  if (!item || typeof item !== "object") return null;
  const copia = {};
  for (const campo of CAMPOS_LINK_PERMITIDOS) {
    if (item[campo] !== undefined) copia[campo] = item[campo];
  }
  return Object.keys(copia).length > 0 ? copia : null;
}

function copiarListaEstruturadaSegura(lista) {
  if (!Array.isArray(lista)) return undefined;
  const filtrada = lista
    .map(copiarLinkEstruturadoSeguro)
    .filter(Boolean);
  return filtrada.length > 0 ? filtrada : undefined;
}

function extrairCamposCtaEnvioVitrine(oferta = {}) {
  const campos = {};
  if (!oferta || typeof oferta !== "object") return campos;

  for (const campo of CAMPOS_CTA_ESCALARES) {
    if (oferta[campo] !== undefined && oferta[campo] !== null) {
      campos[campo] = oferta[campo];
    }
  }

  for (const campo of CAMPOS_CTA_ESTRUTURADOS) {
    const lista = copiarListaEstruturadaSegura(oferta[campo]);
    if (lista) campos[campo] = lista;
  }

  return campos;
}

function assinaturaCtaVitrine(oferta = {}) {
  return urlsCtaVitrineOferta(oferta).sort().join("|");
}

function capturarOfertaComercialConfirmadaVitrine(atual, ofertaEnviada, contexto = {}) {
  const assinatura = assinaturaCtaVitrine(ofertaEnviada);
  if (!assinatura) return atual || null;

  if (!atual) {
    return {
      oferta: ofertaEnviada,
      assinatura,
      destinoId: contexto.destinoId || "",
      destinoTipo: contexto.destinoTipo || "",
      capturadaEm: contexto.capturadaEm || new Date().toISOString()
    };
  }

  if (
    atual.assinatura &&
    atual.assinatura !== assinatura &&
    typeof contexto.logger?.warn === "function"
  ) {
    contexto.logger.warn("[VITRINE-HANDOFF-CTA-DIVERGENTE]", {
      clienteId: contexto.clienteId || "",
      ofertaId: contexto.ofertaId || "",
      marketplace: contexto.marketplace || "",
      destinoPreservado: atual.destinoId || "",
      destinoDivergente: contexto.destinoId || "",
      destinoTipoDivergente: contexto.destinoTipo || ""
    });
  }

  return atual;
}

function montarOfertaParaVitrinePosEnvio(ofertaFinalizada, capturaComercial, contexto = {}) {
  const base = ofertaFinalizada && typeof ofertaFinalizada === "object" ? { ...ofertaFinalizada } : {};
  const ofertaEnviada =
    capturaComercial && capturaComercial.oferta
      ? capturaComercial.oferta
      : capturaComercial;
  const cta = assinaturaCtaVitrine(ofertaEnviada)
    ? extrairCamposCtaEnvioVitrine(ofertaEnviada)
    : {};

  const ofertaParaVitrine = {
    ...base,
    ...cta
  };

  if (base.status !== undefined) ofertaParaVitrine.status = base.status;
  if (base.enviadoEm !== undefined) ofertaParaVitrine.enviadoEm = base.enviadoEm;
  if (base.dataEnvio !== undefined) ofertaParaVitrine.dataEnvio = base.dataEnvio;
  if (base.destinosEnviados !== undefined) ofertaParaVitrine.destinosEnviados = base.destinosEnviados;
  if (contexto.destinosEnviados !== undefined) {
    ofertaParaVitrine.totalDestinosEnviados = contexto.destinosEnviados;
  }

  return ofertaParaVitrine;
}

module.exports = {
  capturarOfertaComercialConfirmadaVitrine,
  extrairCamposCtaEnvioVitrine,
  montarOfertaParaVitrinePosEnvio,
  urlOptimusPublica,
  urlsCtaVitrineOferta
};
