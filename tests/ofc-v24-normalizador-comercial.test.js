"use strict";

const assert = require("assert");
const {
  analisarPrecoComercial,
  normalizarDadosComerciais,
  normalizarParcelamento
} = require("../modules/ofc-v2/normalizador-comercial");

function assertPreco(valor, esperado) {
  const resultado = normalizarDadosComerciais({ marketplace: "mercadolivre", precoAtual: valor, origem: "teste" });
  assert.strictEqual(resultado.precoAtual, esperado, `precoAtual para ${valor}`);
  assert.strictEqual(resultado.precoConfiavel, true, `precoConfiavel para ${valor}`);
}

assertPreco("R$ 59,90", 59.9);
assertPreco("R$59,90", 59.9);
assertPreco("59,90", 59.9);
assertPreco("59.90", 59.9);
assertPreco("R$ 1.299,90", 1299.9);
assertPreco("1.299,90", 1299.9);
assertPreco("1299.90", 1299.9);
assertPreco("1299", 1299);

const parcelamentoComoPreco = normalizarDadosComerciais({
  marketplace: "amazon",
  precoAtual: "12x de R$ 108,32",
  origem: "teste"
});
assert.strictEqual(parcelamentoComoPreco.precoAtual, null);
assert.strictEqual(parcelamentoComoPreco.precoConfiavel, false);
assert.match(parcelamentoComoPreco.avisoPreco, /preco_atual_parece_parcela/);

const parcelamento = normalizarParcelamento("12x de R$ 108,32 sem juros");
assert.strictEqual(parcelamento.quantidadeParcelas, 12);
assert.strictEqual(parcelamento.valorParcela, 108.32);
assert.strictEqual(parcelamento.semJuros, true);

const dePor = normalizarDadosComerciais({
  marketplace: "mercadolivre",
  precoAtual: "de R$ 1.499,90 por R$ 1.299,90",
  origem: "texto_radar"
});
assert.strictEqual(dePor.precoAtual, 1299.9);
assert.strictEqual(dePor.precoAnterior, 1499.9);
assert.strictEqual(dePor.descontoPercentual, 13.33);

const cupomFixo = normalizarDadosComerciais({
  marketplace: "kabum",
  precoAtual: "R$ 989,00",
  valorCupom: "cupom de R$ 100",
  origem: "adapter"
});
assert.strictEqual(cupomFixo.valorCupom, 100);
assert.strictEqual(cupomFixo.precoComCupom, 889);

const cupomPercentual = normalizarDadosComerciais({
  marketplace: "shopee",
  precoAtual: "R$ 100,00",
  valorCupom: "cupom de 10%",
  origem: "radar"
});
assert.strictEqual(cupomPercentual.valorCupom, null);
assert.strictEqual(cupomPercentual.precoComCupom, null);
assert.match(cupomPercentual.avisoPreco, /cupom_percentual_sem_regra_completa/);

for (const invalido of [
  "preco entre R$ 80 e R$ 159",
  "frete de R$ 19,90",
  "20% OFF",
  "1.500 vendidos"
]) {
  const resultado = analisarPrecoComercial(invalido, { campo: "preco_atual" });
  assert.strictEqual(resultado.ok, false, invalido);
}

const moedaEstrangeira = normalizarDadosComerciais({
  marketplace: "aliexpress",
  precoAtual: "19.99",
  moeda: "USD",
  origem: "api"
});
assert.strictEqual(moedaEstrangeira.precoAtual, 19.99);
assert.strictEqual(moedaEstrangeira.precoConfiavel, false);
assert.match(moedaEstrangeira.avisoPreco, /moeda_nao_convertida/);

for (const marketplace of ["Mercado Livre", "Shopee", "Amazon", "AliExpress", "KaBuM", "AWIN"]) {
  const resultado = normalizarDadosComerciais({ marketplace, precoAtual: "R$ 59,90", origem: "teste" });
  assert.strictEqual(resultado.moeda, "BRL");
  assert.strictEqual(resultado.precoAtual, 59.9);
  assert.strictEqual(resultado.precoConfiavel, true);
}

console.log("ofc-v24-normalizador-comercial.test.js ok");
