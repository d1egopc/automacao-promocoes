"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { classificarCategoriaUniversal: classify } = require("../modules/inteligencia-universal/categoria.service");
const copy = require("../modules/copy-inteligente/copy-local-v2.service");
const c3 = require("../modules/copy-inteligente/copy-c3.service");
const tools = "Ferramentas", beauty = "Perfumaria, Farmácia e Beleza";
const rows = [
  ["Alicate para fabricação/reparo de joias", tools],
  ["Alicate para montagem de bijuterias", tools],
  ["Alicate para conserto de joias em aço", tools],
  ["Kit Parafusadeira de Impacto 48 Peças USB", tools],
  ["Parafusadeira recarregável USB marca diferente", tools],
  ["Furadeira profissional USB 12V", tools],
  ["Mouse USB", "Periféricos"],
  ["Hub USB 4 portas", "Periféricos"],
  ["Alicate de cutícula", beauty],
  ["Alicate para unha manicure", beauty],
  ["Brinquedo parafusadeira USB infantil", "Brinquedos e Artigos Infantis"],
  ["Brinquedo bancada ferramentas", "Brinquedos e Artigos Infantis"],
  ["Kit Isca Artificial + Furadeira Profissional", "Diversos"],
  ["Al Noble Ammer 100ml", "Diversos"],
  ["Perfume Al Noble Ameer 100ml Lattafa", beauty],
  ["Perfume Al Noble Ammer 100ml", beauty],
  ["Produto desconhecido 100ml", "Diversos"],
];
for (const [titulo, categoria] of rows) test(`natureza e controles: ${titulo}`, () => {
  const result = classify({ titulo, categoria: "Diversos" });
  assert.equal(result.categoria, categoria);
});
test("copy corrige categoria antiga pela mesma natureza sem mutar dados comerciais", () => {
  for (const titulo of rows.slice(0,6).map(x=>x[0])) {
    const oferta = { titulo, categoria:"Periféricos", clienteId:"fixture-a", precoAtual:99.9, cupom:"FIXTURE", linkAfiliado:"https://example.test/a" };
    const before = structuredClone(oferta);
    assert.equal(copy.resolverFamiliaOfertaCopyLocalV2(oferta).familia,"ferramentas");
    const result = copy.resolverCopyLocalV2({ oferta, destino:{tituloOferta:"ia"}, plano:{recursos:{tituloIa:true}} });
    assert.equal(result.ok,true);
    assert.equal(result.familia,"ferramentas");
    assert.doesNotMatch(result.tituloIa,/rotina digital|perifericos|combina com/i);
    assert.deepEqual(oferta,before);
  }
});
test("copy de baixa confiança é neutra e não inventa finalidade", () => {
  const oferta={titulo:"Produto desconhecido",categoria:"Periféricos",baixaConfianca:true};
  assert.equal(copy.resolverFamiliaOfertaCopyLocalV2(oferta).familia,"oportunidade");
  const result=copy.resolverCopyLocalV2({oferta,destino:{tituloOferta:"ia"},plano:{recursos:{tituloIa:true}}});
  assert.equal(result.ok,true);
  assert.doesNotMatch(result.tituloIa,/digital|periferico|reparo|ferramenta/i);
});
test("produto na copy distingue brinquedo, alicate e parafusadeira",()=>{
  assert.equal(copy.produtoContextualCopyLocalV2("Brinquedo parafusadeira"),"Brinquedo");
  assert.equal(copy.produtoContextualCopyLocalV2("Alicate para joias"),"Alicate");
  assert.equal(copy.produtoContextualCopyLocalV2("Parafusadeira USB"),"Parafusadeira");
});
test("Copy C3 pública reutiliza natureza e conserva os fatos do produto",()=>{
  const oferta={titulo:"Kit Parafusadeira de Impacto 48 Peças USB",tituloFactual:"Kit Parafusadeira de Impacto 48 Peças USB",categoria:"Periféricos",precoAtual:99.9};
  const before=structuredClone(oferta);
  const result=c3.resolverCopyC3({oferta,destino:{tituloOferta:"ia"},plano:{recursos:{tituloIa:true}}});
  assert.equal(result.ok,true);
  assert.equal(result.categoriaOficial,tools);
  assert.doesNotMatch(result.tituloIa,/rotina digital|periferico|combina com/i);
  assert.deepEqual(oferta,before);
});
