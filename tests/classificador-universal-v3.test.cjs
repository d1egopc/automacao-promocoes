"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fixtures = require("./fixtures/classificador-v3-real-20261027.json");
const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const { classificarCategoriaUniversal } = require("../modules/inteligencia-universal/categoria.service");

for (const item of [...fixtures.real, ...fixtures.controls]) {
  test(`categoria V3: ${item.titulo}`, () => {
    const oferta = { titulo: item.titulo, marketplace: item.marketplace || "mercadolivre" };
    const atual = classificarCategoriaOferta(oferta, item.titulo);
    if (item.categoria) {
      assert.equal(atual, item.categoria);
      assert.equal(classificarCategoriaUniversal({ ...oferta, categoria: "Diversos" }).categoria, item.categoria);
    } else assert.notEqual(atual, item.forbidden);
  });
}
test("natureza factual corrige categoria específica equivocada sem alterar campos comerciais", () => {
  const oferta = { titulo: fixtures.real[5].titulo, categoria: "Automotivo", preco: 11.91,
    cupom: "FIXTURE", linkAfiliado: "https://example.test/workspace-a", clienteId: "workspace-a" };
  const antes = structuredClone(oferta);
  assert.equal(classificarCategoriaUniversal(oferta).categoria, "Pesca e Camping");
  assert.deepEqual(oferta, antes);
  assert.equal(classificarCategoriaUniversal({ titulo: "Produto erótico infantil", categoria: "Roupas e Calçados Infantil" }).categoria, "Diversos");
});
test("identidades conflitantes permanecem incertas e público adulto não herda categoria infantil", () => {
  assert.equal(classificarCategoriaUniversal({titulo:"Kit Isca Artificial + Furadeira Profissional",categoria:"Diversos"}).categoria,"Diversos");
  assert.equal(classificarCategoriaUniversal({titulo:"Calça para adultos",categoria:"Roupas e Calçados Infantil"}).categoria,"Diversos");
});
test("gênero explícito protege vestuário de conflito contextual e finalidade outdoor técnica vence gênero", () => {
  assert.equal(classificarCategoriaOferta({ titulo: "Calça masculina / sensor de presença ORIGINAL" }), "Roupas e Moda Masculina");
  assert.equal(classificarCategoriaUniversal({ titulo: "Calça masculina / sensor de presença ORIGINAL" }).categoria, "Roupas e Moda Masculina");
  assert.equal(classificarCategoriaOferta({ titulo: "Calça feminina ripstop para pesca com proteção UV50" }), "Pesca e Camping");
  assert.equal(classificarCategoriaOferta({ titulo: "Calça casual para pesca" }), "Diversos");
});
