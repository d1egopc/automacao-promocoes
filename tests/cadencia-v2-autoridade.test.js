const assert = require("assert");

const {
  CONTRATOS_CADENCIA,
  MODO_CADENCIA_LEGADO,
  MODO_CADENCIA_V2,
  destinoAceitaTurboCupom,
  resolverCadenciaDestino,
  resolverIntervaloConfiguradoCadencia
} = require("../modules/engine/cadencia.service");

assert.strictEqual(CONTRATOS_CADENCIA[MODO_CADENCIA_LEGADO].turboCupomMin, 3);
assert.strictEqual(CONTRATOS_CADENCIA[MODO_CADENCIA_LEGADO].ativo, false);
assert.strictEqual(CONTRATOS_CADENCIA[MODO_CADENCIA_V2].normalMinimoMin, 2.5);
assert.strictEqual(CONTRATOS_CADENCIA[MODO_CADENCIA_V2].turboCupomMin, 1.5);
assert.strictEqual(CONTRATOS_CADENCIA[MODO_CADENCIA_V2].ativo, true);

assert.strictEqual(resolverIntervaloConfiguradoCadencia({ intervaloMinutos: 4 }, {}, {}), 4);
assert.strictEqual(resolverIntervaloConfiguradoCadencia({ intervalo: 6 }, {}, {}), 6);
assert.strictEqual(resolverIntervaloConfiguradoCadencia({}, { intervaloMinutos: 7 }, {}), 7);
assert.strictEqual(resolverIntervaloConfiguradoCadencia({}, { intervaloEnvioMinutos: 8 }, {}), 8);
assert.strictEqual(resolverIntervaloConfiguradoCadencia({}, {}, { intervaloEnvioMinutos: 9 }), 9);
assert.strictEqual(resolverIntervaloConfiguradoCadencia({}, {}, { intervaloEnvioMinutos: 0 }), 5);

assert.strictEqual(destinoAceitaTurboCupom({ prioridadeCupomAtiva: true }), true);
assert.strictEqual(destinoAceitaTurboCupom({ cupomTurbo: true }), true);
assert.strictEqual(destinoAceitaTurboCupom({ modoEnvio: "cupomTurbo" }), true);
assert.strictEqual(destinoAceitaTurboCupom({}), false);

const comum = resolverCadenciaDestino({
  destino: { intervaloMinutos: 4, prioridadeCupomAtiva: true },
  oferta: {},
  cupomFastLaneTipo: () => ""
});
assert.strictEqual(comum.modo, "cadencia_v2");
assert.strictEqual(comum.intervaloConfiguradoMin, 4);
assert.strictEqual(comum.intervaloEfetivoMin, 4);
assert.strictEqual(comum.turboAplicado, false);

const normalComPiso = resolverCadenciaDestino({
  destino: { intervaloMinutos: 1, prioridadeCupomAtiva: false },
  oferta: {}
});
assert.strictEqual(normalComPiso.intervaloConfiguradoMin, 1);
assert.strictEqual(normalComPiso.intervaloEfetivoMin, 2.5);

const turbo = resolverCadenciaDestino({
  destino: { intervaloMinutos: 4, prioridadeCupomAtiva: true },
  oferta: { cupom: "PROMO" },
  cupomFastLaneTipo: () => "real_detectado"
});
assert.strictEqual(turbo.modo, "cadencia_v2");
assert.strictEqual(turbo.intervaloConfiguradoMin, 4);
assert.strictEqual(turbo.intervaloEfetivoMin, 1.5);
assert.strictEqual(turbo.intervaloTurboMin, 1.5);
assert.strictEqual(turbo.turboAplicado, true);

const gateSemOferta = resolverCadenciaDestino({
  destino: { intervaloMinutos: 5, cupomTurbo: true },
  considerarTurboSemOferta: true
});
assert.strictEqual(gateSemOferta.intervaloEfetivoMin, 1.5);
assert.strictEqual(gateSemOferta.turboAplicado, true);

console.log("cadencia-v2-autoridade.test.js OK");
