"use strict";

const assert = require("node:assert/strict");
const { classificarTurboComercialCandidato } =
  require("../modules/engine/turbo-classification.candidate");
const { avaliarFrescorPosClassificacaoCandidato } =
  require("../modules/engine/post-classification-freshness.candidate");
const { resolverCadenciaDestino } = require("../modules/engine/cadencia.service");
const { avaliarFrescorPreImporter, montarEntradaFrescorPreImporter } =
  require("../modules/engine/frescor-pre-importer.service");
const { avaliarFrescorComercialOferta } =
  require("../modules/engine/flow-manager/flow-manager.service");

const t0 = "2026-10-09T10:00:00.000Z";
const at = minutes => Date.parse(t0) + minutes * 60000;
const shopeeResgate = {
  marketplace: "shopee",
  metadata: { integridadeComercial: { linksComerciais: [{
    papel: "link_resgate", tipo: "resgate", renderizavel: true,
    urlAfiliadaWorkspace: "https://s.shopee.com.br/fixture-resgate"
  }] } }
};

function checarFrescor(oferta, vivo5, vivo15, tipoFluxo) {
  const entrada = { ...oferta, evento_capturado_em: t0 };
  const cinco = avaliarFrescorPosClassificacaoCandidato(entrada, at(5));
  const quinze = avaliarFrescorPosClassificacaoCandidato(entrada, at(15));
  assert.equal(cinco.ok, vivo5);
  assert.equal(quinze.ok, vivo15);
  assert.equal(cinco.tipoFluxo, tipoFluxo);
  assert.equal(quinze.tipoFluxo, tipoFluxo);
  assert.equal(cinco.capturadoEm, t0);
  assert.equal(quinze.capturadoEm, t0);
}

assert.deepEqual(classificarTurboComercialCandidato(shopeeResgate), {
  turbo: true, tipoFluxo: "cupom_turbo", ancora: "resgate_shopee_valido"
});
checarFrescor(shopeeResgate, true, false, "cupom_turbo");
for (const cupom of ["TECH300", "APP20", "LIVE50", "ABC123", " app-20 "]) {
  const oferta = { marketplace: "amazon", cupom };
  assert.equal(classificarTurboComercialCandidato(oferta).ancora,
    "codigo_alfanumerico_valido", cupom);
  checarFrescor(oferta, true, false, "cupom_turbo");
}
for (const oferta of [
  { marketplace: "amazon", cupom: "123456" },
  { marketplace: "amazon", texto: "Use o cupom APP20 hoje" },
  { marketplace: "amazon", cupom: "Desconto de 20 reais" },
  { marketplace: "amazon", prioridade: 110 },
  { marketplace: "amazon", cupomTipo: "real", prioridade: 110 },
  { marketplace: "amazon", cupom: "APP20", cupomSuspeito: true },
  { ...shopeeResgate, marketplace: "mercadolivre" },
  { marketplace: "shopee", linkResgateCupom: "https://s.shopee.com.br/sem-prova" },
  { marketplace: "shopee", linksComerciais: [{ papel: "link_resgate",
    tipo: "resgate", renderizavel: true,
    urlOriginal: "https://s.shopee.com.br/sem-afiliacao" }] }
]) {
  assert.equal(classificarTurboComercialCandidato(oferta).turbo, false,
    JSON.stringify(oferta));
}
checarFrescor({ marketplace: "amazon", cupomTipo: "real", prioridade: 110 },
  true, true, "oferta_comum");
assert.equal(avaliarFrescorPosClassificacaoCandidato({
  marketplace: "amazon", evento_capturado_em: t0
}, at(20)).ok, true);
assert.equal(avaliarFrescorPosClassificacaoCandidato({
  marketplace: "amazon", evento_capturado_em: t0
}, at(35)).ok, false);
assert.equal(classificarTurboComercialCandidato({ metadata: {
  cupomTurbo: true } }).ancora, "marcador_explicito");
assert.equal(avaliarFrescorPosClassificacaoCandidato({
  origem: "manual_v2", cupom: "TECH300"
}, at(35)).manualV2, true);

const destinoTurbo = { intervaloMinutos: 8, prioridadeCupomAtiva: true };
const matrizCadencia = [
  [{ marketplace: "amazon", cupomReal: true }, false],
  [{ marketplace: "amazon", cupomConfirmado: true }, false],
  [{ marketplace: "amazon", prioridade: 110 }, false],
  [{ marketplace: "amazon", cupom: "APP20" }, true],
  [shopeeResgate, true],
  [{ marketplace: "amazon", cupomTurbo: true }, true]
];
for (const [oferta, turboEsperado] of matrizCadencia) {
  const compartilhada = classificarTurboComercialCandidato(oferta).turbo;
  const cadencia = resolverCadenciaDestino({ destino: destinoTurbo, oferta,
    cupomFastLaneTipo: () => "real_detectado", considerarTurboSemOferta: true });
  assert.equal(compartilhada, turboEsperado, JSON.stringify(oferta));
  assert.equal(cadencia.cupomReal, compartilhada, JSON.stringify(oferta));
  assert.equal(cadencia.turboAplicado, compartilhada, JSON.stringify(oferta));
  assert.equal(cadencia.intervaloEfetivoMin, turboEsperado ? 1.5 : 8);
}

// Every active consumer derives its commercial clock from the same factual
// anchors, including anchors found only in event/job metadata.
for (const [nome, oferta, turboEsperado] of [
  ["APP20", { marketplace: "amazon", cupom: "APP20" }, true],
  ["Shopee rescue", shopeeResgate, true],
  ["explicit marker", { marketplace: "amazon", cupomTurbo: true }, true],
  ["numeric", { marketplace: "amazon", cupom: "123456" }, false],
  ["ordinary text", { marketplace: "amazon", texto: "APP20" }, false],
  ["priority", { marketplace: "amazon", prioridade: 110 }, false],
  ["real coupon", { marketplace: "amazon", cupomReal: true }, false],
  ["confirmed coupon", { marketplace: "amazon", cupomConfirmado: true }, false]
]) {
  const metadata = { ...oferta.metadata, cupom: oferta.cupom,
    cupomTurbo: oferta.cupomTurbo,
    linksComerciais: oferta.linksComerciais };
  const job = { id: 1, evento_id: 2, marketplace: oferta.marketplace,
    evento_capturado_em: t0, metadata };
  const entrada = montarEntradaFrescorPreImporter(job);
  const shared = classificarTurboComercialCandidato(oferta);
  const cadence = resolverCadenciaDestino({ destino: destinoTurbo, oferta,
    cupomFastLaneTipo: () => "real_detectado", considerarTurboSemOferta: true });
  assert.equal(shared.turbo, turboEsperado, nome);
  assert.equal(cadence.turboAplicado, shared.turbo, nome);
  assert.equal(entrada.tipoFluxo, turboEsperado ? "cupom_turbo" : "oferta_comum", nome);
  const cinco = avaliarFrescorPreImporter(job, { agoraMs: at(5) });
  const onze = avaliarFrescorPreImporter(job, { agoraMs: at(11) });
  const quinze = avaliarFrescorPreImporter(job, { agoraMs: at(15) });
  const flow5 = avaliarFrescorComercialOferta({ oferta: {
    ...oferta, capturadoEm: t0 } }, { agoraMs: at(5) });
  const flow11 = avaliarFrescorComercialOferta({ oferta: {
    ...oferta, capturadoEm: t0 } }, { agoraMs: at(11) });
  assert.equal(cinco.expirada, false, nome);
  assert.equal(onze.expirada, turboEsperado, nome);
  assert.equal(quinze.expirada, turboEsperado, nome);
  assert.equal(flow5.tipoFluxo, entrada.tipoFluxo, nome);
  assert.equal(flow11.expirada, turboEsperado, nome);
  assert.equal(flow11.origemComercialMs, Date.parse(t0), nome);
  const guard = avaliarFrescorPosClassificacaoCandidato({
    ...oferta, evento_capturado_em: t0 }, at(11));
  assert.equal(guard.ok, !turboEsperado, nome);
  assert.equal(guard.tipoFluxo, entrada.tipoFluxo, nome);
}
assert.equal(avaliarFrescorPreImporter({ evento_id: 3,
  evento_capturado_em: t0, metadata: { origem: "manual_v2", cupom: "APP20" }
}, { agoraMs: at(35) }).manualV2, true);

console.log(JSON.stringify({ candidate: "turbo_commercial_classification",
  shopeeResgate5: "viva", shopeeResgate15: "bloqueada",
  alpha5: "viva", alpha15: "bloqueada",
  normal20: "viva", normal35: "bloqueada", manualV2: "preservado",
  negativeCases: 9, activeConsumerMatrix: 8,
  turboClassificationDivergences: 0 }));
