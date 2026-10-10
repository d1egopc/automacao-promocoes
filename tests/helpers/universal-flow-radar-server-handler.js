"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { capturaFactualRadarCandidata } =
  require("../../modules/radar/capture-clock.candidate");

function criarHandlerRadarServidor(registrarEngine) {
  const source = fs.readFileSync(path.join(__dirname,"..","..","index.js"),"utf8");
  const start = source.indexOf("async function processarMensagemRadar({");
  const end = source.indexOf("registerRadarIngressHandler(processarMensagemRadar);",start);
  assert(start >= 0 && end > start);
  const noop = () => {};
  const deps = {
    capturaFactualRadarCandidata,
    normalizarTexto: value => String(value || "").toLowerCase(),
    textoRadarId: value => String(value || ""),
    avaliarCapturaRadarWhatsappAtual: () => ({ok:true}),
    coberturaRadar: {flagAtiva:()=>false,registrar:noop,
      extrairMensagemId:()=>"",criarCoberturaTraceId:()=>""},
    fidelidadeObs: {flagAtiva:()=>false,registrarTrace:noop,
      registrarSnapshot:noop,registrarLinks:noop,registrarImagem:noop,
      registrarPreco:noop,registrarCupom:noop},
    obterClienteIdAdminMaster: () => "admin",
    carregarRadarConfigAdminMaster: () => ({}),
    origemOfertaEstaMonitoradaRadar: () => ({ok:true}),
    logOptimus: noop, logRadarRejeitado: noop,
    logRadarBloqueadoMonitoramento: noop, logDebug:noop,
    extrairLinksRadar: () => [], urlAuxiliarNoTexto: () => false,
    detectarMarketplaceRadarLink: () => "amazon",
    extrairEvidenciasRadarLocal: () => null,
    resumirExtratorLocalParaLog: () => ({}),
    resumirExtratorComercialParaLog: () => ({}),
    radarCupomMensagem: () => ({}),
    analisarBeneficiosMensagemRadar: () => ({linksResgate:[]}),
    textoComercialSemRodape: value => value,
    criarRadarMirror: input => ({midia:{},produto:{},preco:{},cupom:{},
      links:{},capturadaEm:input.capturadaEm}),
    aplicarMidiaMaterializadaRadarMirror: value => value,
    resumirRadarMirrorLog: () => ({}),
    mergeRadarMirrorMetadata: () => ({}),
    linkEngineV2Radar: () => false,
    registrarEventoBrutoEngineRadar: registrarEngine,
    marketplaceResumoRadarDoLink: () => "amazon",
    registrarRadarMarketplaceEvento: noop,
    console: {log:noop},
    process: {env:{}},
    Date
  };
  return new Function(...Object.keys(deps),
    `${source.slice(start,end)}\nreturn processarMensagemRadar;`)(
    ...Object.values(deps));
}

module.exports = { criarHandlerRadarServidor };
