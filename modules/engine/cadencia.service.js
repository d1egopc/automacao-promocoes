"use strict";

const MODO_CADENCIA_LEGADO = "legado";
const MODO_CADENCIA_V2 = "cadencia_v2";

const CONTRATOS_CADENCIA = Object.freeze({
  [MODO_CADENCIA_LEGADO]: Object.freeze({
    modo: MODO_CADENCIA_LEGADO,
    normalMinimoMin: null,
    turboCupomMin: 3,
    aplicaMinimoNormal: false,
    ativo: false
  }),
  [MODO_CADENCIA_V2]: Object.freeze({
    modo: MODO_CADENCIA_V2,
    normalMinimoMin: 2.5,
    turboCupomMin: 1.5,
    aplicaMinimoNormal: true,
    ativo: true
  })
});

function numeroIntervaloValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function textoNormalizado(valor = "") {
  return String(valor || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function objetoSeguro(valor = {}) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return valor;
}

function arraySeguro(valor = []) {
  return Array.isArray(valor) ? valor : [];
}

function urlValidaCadencia(valor = "") {
  const textoUrl = String(valor || "").trim();
  if (!textoUrl) return false;
  try {
    const url = new URL(textoUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function papelResgateCadencia(valor = "") {
  const papel = textoNormalizado(valor).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return papel === "link_resgate" || papel === "resgate";
}

function tipoResgateCadencia(valor = "") {
  const tipo = textoNormalizado(valor).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return tipo === "resgate";
}

function linkResgateShopeeRenderizavelCadencia(item = {}) {
  const link = objetoSeguro(item);
  if (!link || !Object.keys(link).length) return false;

  const papelResgate = papelResgateCadencia(link.papel || link.papelLink || link.role || "");
  const tipoResgate = tipoResgateCadencia(link.tipo || link.tipoLink || "");
  if (!papelResgate || !tipoResgate) return false;

  const statusConversao = textoNormalizado(link.conversaoStatus || link.statusConversao || link.status || "");
  const renderizavel = link.renderizavel === true || link.seguro === true || statusConversao === "convertida";
  if (!renderizavel) return false;

  return [
    link.urlAfiliadaWorkspace,
    link.urlAfiliada,
    link.urlOptimus,
    link.renderizarUrl,
    link.urlFinal,
    link.url,
    link.urlOriginal,
    link.original
  ].some(urlValidaCadencia);
}

function linksResgateShopeeCadencia(oferta = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  const integridadeComercial = objetoSeguro(metadata.integridadeComercial);
  const contratoComercialFinal = objetoSeguro(oferta.contratoComercialFinal);

  return [
    ...arraySeguro(oferta.linksComerciais),
    ...arraySeguro(oferta.linksResgate),
    ...arraySeguro(metadata.linksComerciais),
    ...arraySeguro(metadata.linksResgate),
    ...arraySeguro(integridadeComercial.linksComerciais),
    ...arraySeguro(contratoComercialFinal.linksComerciais),
    ...arraySeguro(contratoComercialFinal.linksResgate)
  ];
}

function linkResgateShopeeValidoParaCadencia(oferta = {}) {
  if (textoNormalizado(oferta.marketplace) !== "shopee") return false;

  return linksResgateShopeeCadencia(oferta).some(linkResgateShopeeRenderizavelCadencia);
}

function modoCadenciaAtivo(configGlobal = {}, configCliente = {}) {
  const candidato = textoNormalizado(
    configCliente.modoCadencia ||
    configCliente.cadenciaModo ||
    configGlobal.modoCadencia ||
    configGlobal.cadenciaModo ||
    ""
  );
  if (candidato === MODO_CADENCIA_LEGADO && CONTRATOS_CADENCIA[MODO_CADENCIA_LEGADO].ativo === true) {
    return MODO_CADENCIA_LEGADO;
  }
  if (candidato === MODO_CADENCIA_V2 && CONTRATOS_CADENCIA[MODO_CADENCIA_V2].ativo === true) {
    return MODO_CADENCIA_V2;
  }
  return CONTRATOS_CADENCIA[MODO_CADENCIA_V2].ativo === true
    ? MODO_CADENCIA_V2
    : MODO_CADENCIA_LEGADO;
}

function contratoCadenciaAtual(configGlobal = {}, configCliente = {}) {
  return CONTRATOS_CADENCIA[modoCadenciaAtivo(configGlobal, configCliente)] || CONTRATOS_CADENCIA[MODO_CADENCIA_LEGADO];
}

function resolverIntervaloConfiguradoCadencia(destino = {}, configCliente = {}, configGlobal = {}) {
  return (
    numeroIntervaloValido(destino.intervaloMinutos) ||
    numeroIntervaloValido(destino.intervalo) ||
    numeroIntervaloValido(destino.intervaloEnvioMinutos) ||
    numeroIntervaloValido(destino.intervaloConfiguradoMinutos) ||
    numeroIntervaloValido(configCliente.intervaloMinutos) ||
    numeroIntervaloValido(configCliente.intervaloEnvioMinutos) ||
    numeroIntervaloValido(configGlobal.intervaloEnvioMinutos) ||
    5
  );
}

function destinoAceitaTurboCupom(destino = {}) {
  return Boolean(
    destino.prioridadeCupomAtiva === true ||
    destino.cupomTurbo === true ||
    destino.cupom_turbo === true ||
    destino.turboCupom === true ||
    destino.turbo === true ||
    textoNormalizado(destino.modoEnvio || destino.modo) === "cupomturbo"
  );
}

function cupomFastLaneReal(oferta = {}, cupomFastLaneTipo = null, agoraMs = Date.now()) {
  if (typeof cupomFastLaneTipo === "function") {
    return cupomFastLaneTipo(oferta, agoraMs) === "real_detectado" || linkResgateShopeeValidoParaCadencia(oferta);
  }
  return Boolean(
    oferta.cupomReal === true ||
    oferta.cupomConfirmado === true ||
    oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    oferta.tipoFluxo === "cupom_turbo" ||
    oferta.tipoOperacional === "cupom_turbo" ||
    linkResgateShopeeValidoParaCadencia(oferta)
  );
}

function resolverCadenciaDestino({
  destino = {},
  configCliente = {},
  configGlobal = {},
  oferta = {},
  cupomFastLaneTipo = null,
  considerarTurboSemOferta = false,
  agoraMs = Date.now()
} = {}) {
  const contrato = contratoCadenciaAtual(configGlobal, configCliente);
  const intervaloConfiguradoMin = resolverIntervaloConfiguradoCadencia(destino, configCliente, configGlobal);
  const turboElegivel = destinoAceitaTurboCupom(destino);
  const cupomReal = considerarTurboSemOferta ? turboElegivel : cupomFastLaneReal(oferta, cupomFastLaneTipo, agoraMs);
  const turboAplicado = turboElegivel && cupomReal;
  const intervaloNormalMin = contrato.aplicaMinimoNormal && Number.isFinite(contrato.normalMinimoMin)
    ? Math.max(intervaloConfiguradoMin, contrato.normalMinimoMin)
    : intervaloConfiguradoMin;
  const intervaloEfetivoMin = turboAplicado ? contrato.turboCupomMin : intervaloNormalMin;

  return {
    modo: contrato.modo,
    contratoFuturoDisponivel: true,
    intervaloConfiguradoMin,
    intervaloNormalMin,
    intervaloEfetivoMin,
    intervaloTurboMin: turboAplicado ? contrato.turboCupomMin : null,
    turboElegivel,
    turboAplicado,
    cupomReal,
    normalMinimoMin: contrato.normalMinimoMin,
    motivo: turboAplicado ? "cupom_turbo" : "intervalo_configurado"
  };
}

module.exports = {
  MODO_CADENCIA_LEGADO,
  MODO_CADENCIA_V2,
  CONTRATOS_CADENCIA,
  numeroIntervaloValido,
  resolverIntervaloConfiguradoCadencia,
  destinoAceitaTurboCupom,
  linkResgateShopeeValidoParaCadencia,
  resolverCadenciaDestino
};
