const assert = require("assert");
const {
  normalizarNumeroMoeda,
  normalizarPrecoTextoBR,
  centavosMonetarios
} = require("../utils/moeda");

const casos = [
  ["17,99", 17.99],
  ["17.99", 17.99],
  ["17.990", 17.99],
  ["1.799,00", 1799],
  ["R$ 1.799,00", 1799],
  ["R$ 17.990,00", 17990],
  ["3.199,99", 3199.99],
  ["3,199.99", 3199.99],
  ["1.804,04", 1804.04],
  ["1,804.04", 1804.04],
  ["0,90", 0.9],
  [1799, 1799]
];

for (const [entrada, esperado] of casos) {
  assert.strictEqual(normalizarNumeroMoeda(entrada), esperado, `normalizarNumeroMoeda(${entrada})`);
}

assert.strictEqual(normalizarPrecoTextoBR("17.99"), "17,99");
assert.strictEqual(normalizarPrecoTextoBR("1.799,00"), "1.799,00");
assert.strictEqual(centavosMonetarios("17,99"), 1799);

console.log("moeda-normalizacao.test.js OK");
