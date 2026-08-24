const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  CONTRATOS_CADENCIA,
  MODO_CADENCIA_LEGADO,
  MODO_CADENCIA_V2,
  destinoAceitaTurboCupom,
  linkResgateShopeeValidoParaCadencia,
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

const shopeeResgateValido = {
  marketplace: "shopee",
  tipoCupom: "provavel",
  beneficioExtra: "Resgate o cupom antes de finalizar.",
  linksComerciais: [
    {
      papel: "link_resgate",
      tipo: "resgate",
      renderizavel: true,
      conversaoStatus: "convertida",
      urlOptimus: "https://go.optimuspromo.com.br/r/resgate-shopee"
    }
  ]
};

assert.strictEqual(linkResgateShopeeValidoParaCadencia(shopeeResgateValido), true);

const turboShopeeResgate = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
  oferta: shopeeResgateValido,
  cupomFastLaneTipo: () => "provavel"
});
assert.strictEqual(turboShopeeResgate.intervaloEfetivoMin, 1.5);
assert.strictEqual(turboShopeeResgate.intervaloTurboMin, 1.5);
assert.strictEqual(turboShopeeResgate.turboAplicado, true);
assert.strictEqual(turboShopeeResgate.cupomReal, true);

const shopeeResgateSemTurboDestino = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: false },
  oferta: shopeeResgateValido,
  cupomFastLaneTipo: () => "provavel"
});
assert.strictEqual(shopeeResgateSemTurboDestino.intervaloEfetivoMin, 8);
assert.strictEqual(shopeeResgateSemTurboDestino.turboAplicado, false);

const shopeeSegundoLinkProduto = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
  oferta: {
    marketplace: "shopee",
    linksComerciais: [
      { papel: "link_produto", tipo: "produto", renderizavel: true, conversaoStatus: "convertida", urlOptimus: "https://go.optimuspromo.com.br/r/produto" },
      { papel: "link_produto", tipo: "produto", renderizavel: true, conversaoStatus: "convertida", urlOptimus: "https://go.optimuspromo.com.br/r/produto-extra" }
    ]
  },
  cupomFastLaneTipo: () => ""
});
assert.strictEqual(shopeeSegundoLinkProduto.intervaloEfetivoMin, 8);
assert.strictEqual(shopeeSegundoLinkProduto.turboAplicado, false);

const shopeeSemResgate = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
  oferta: { marketplace: "shopee", linksComerciais: [] },
  cupomFastLaneTipo: () => ""
});
assert.strictEqual(shopeeSemResgate.intervaloEfetivoMin, 8);
assert.strictEqual(shopeeSemResgate.turboAplicado, false);

const shopeeResgateTopLevelSemLinkEstruturado = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
  oferta: {
    marketplace: "shopee",
    linkResgateCupom: "https://s.shopee.com.br/resgate",
    resgateShopeeSemantico: true,
    linkResgateRenderizavel: true
  },
  cupomFastLaneTipo: () => "provavel"
});
assert.strictEqual(shopeeResgateTopLevelSemLinkEstruturado.intervaloEfetivoMin, 8);
assert.strictEqual(shopeeResgateTopLevelSemLinkEstruturado.turboAplicado, false);

const cupomProvavelComum = resolverCadenciaDestino({
  destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
  oferta: { marketplace: "amazon", tipoCupom: "provavel", beneficioExtra: "Cupom provavel" },
  cupomFastLaneTipo: () => "provavel"
});
assert.strictEqual(cupomProvavelComum.intervaloEfetivoMin, 8);
assert.strictEqual(cupomProvavelComum.turboAplicado, false);

for (const marketplace of ["mercadolivre", "amazon", "aliexpress", "awin"]) {
  const resultado = resolverCadenciaDestino({
    destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
    oferta: { ...shopeeResgateValido, marketplace },
    cupomFastLaneTipo: () => "provavel"
  });
  assert.strictEqual(resultado.intervaloEfetivoMin, 8, `${marketplace} nao deve receber Turbo por link_resgate Shopee`);
  assert.strictEqual(resultado.turboAplicado, false);
}

const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.ok(indexSource.includes("function cupomFastLaneTipo"), "rank global deve continuar no index.js");
assert.ok(!indexSource.includes("linkResgateShopeeValidoParaCadencia"), "predicado de resgate Shopee nao pode alterar rank global da fila");

const gateSemOferta = resolverCadenciaDestino({
  destino: { intervaloMinutos: 5, cupomTurbo: true },
  considerarTurboSemOferta: true
});
assert.strictEqual(gateSemOferta.intervaloEfetivoMin, 1.5);
assert.strictEqual(gateSemOferta.turboAplicado, true);

console.log("cadencia-v2-autoridade.test.js OK");
