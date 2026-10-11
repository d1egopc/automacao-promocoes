"use strict";

const { normalizarCodigoCupomSemantico } = require("../radar/cupom-semantico");
const { linkResgateShopeeValidoParaCadencia } = require("./cadencia.service");

function objeto(valor) {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) return valor;
  if (typeof valor === "string") {
    try { return objeto(JSON.parse(valor)); } catch (_) {}
  }
  return {};
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function marcadorTurboExplicito(oferta, fontes) {
  return [oferta, ...fontes].some(fonte => fonte.cupomTurbo === true ||
    fonte.cupom_turbo === true ||
    [fonte.tipoFluxo, fonte.tipo_fluxo, fonte.tipoOperacional,
      fonte.tipo_operacional].some(tipo =>
      String(tipo || "").trim().toLowerCase() === "cupom_turbo"));
}

function codigoAlfanumericoValido(fontes) {
  if (fontes.some(fonte => fonte.cupomSuspeito === true ||
      fonte.cupomMonetarioIncompativel === true)) return false;
  const valores = fontes.flatMap(fonte => [fonte.cupom, fonte.codigoCupom,
    fonte.codigo_cupom]);
  return valores.some(valor => {
    const codigo = normalizarCodigoCupomSemantico(valor);
    return codigo.length <= 30 && /[A-Z]/.test(codigo) && /[0-9]/.test(codigo);
  });
}

function resgateShopeeValido(oferta, fontes) {
  const linksComerciais = fontes.flatMap(fonte => {
    const integridade = objeto(fonte.integridadeComercial);
    const integridadeV24 = objeto(objeto(fonte.ofcV24).integridadeComercial);
    const contratoFinal = objeto(fonte.contratoComercialFinal);
    return [...lista(fonte.linksComerciais), ...lista(fonte.linksResgate),
      ...lista(integridade.linksComerciais), ...lista(integridadeV24.linksComerciais),
      ...lista(contratoFinal.linksComerciais), ...lista(contratoFinal.linksResgate)];
  });
  return linkResgateShopeeValidoParaCadencia({
    marketplace: oferta.marketplace || fontes.map(fonte => fonte.marketplace).find(Boolean),
    linksComerciais
  });
}

function classificarTurboComercialCandidato(oferta = {}) {
  const metadata = objeto(oferta.metadata);
  const jobMetadata = objeto(oferta.job_metadata);
  const eventoMetadata = objeto(oferta.evento_metadata);
  const fontes = [oferta, metadata, jobMetadata, eventoMetadata,
    objeto(jobMetadata.metadataEvento), objeto(metadata.metadataEvento)];
  let ancora = "";
  if (marcadorTurboExplicito(oferta, fontes)) ancora = "marcador_explicito";
  else if (resgateShopeeValido(oferta, fontes)) ancora = "resgate_shopee_valido";
  else if (codigoAlfanumericoValido(fontes)) ancora = "codigo_alfanumerico_valido";
  return {
    turbo: Boolean(ancora),
    tipoFluxo: ancora ? "cupom_turbo" : "oferta_comum",
    ancora
  };
}

module.exports = { classificarTurboComercialCandidato };
