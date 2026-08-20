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
    return cupomFastLaneTipo(oferta, agoraMs) === "real_detectado";
  }
  return Boolean(
    oferta.cupomReal === true ||
    oferta.cupomConfirmado === true ||
    oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    oferta.tipoFluxo === "cupom_turbo" ||
    oferta.tipoOperacional === "cupom_turbo"
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
  resolverCadenciaDestino
};
