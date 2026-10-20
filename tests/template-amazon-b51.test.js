const assert = require("assert");

const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { resolverContratoComercialFinal } = require("../modules/templates-clientes/contrato-comercial-final");

const LINK_AFILIADO = "https://www.amazon.com.br/dp/B09SJT773X?tag=d1egopcoff-20";
const BENEFICIO = "R$ 66,93 OFF no cupom/pagina";

const ofertaHorús = {
  titulo: "Pré Treino Hórus Max Titanium 300g",
  marketplace: "Amazon",
  textoOriginal: [
    "Pré Treino Hórus Max Titanium 300g",
    "Por R$ 53,54",
    "2x de R$ 33,47",
    "Cupom: BEMESTAR",
    BENEFICIO
  ].join("\n"),
  precoAtual: 53.54,
  parcelamento: {
    quantidade: 2,
    valorParcela: 33.47,
    semJuros: false,
    confianca: "alta",
    evidencia: "2x de R$ 33,47"
  },
  cupom: "BEMESTAR",
  avisoCupom: BENEFICIO,
  beneficioExtra: BENEFICIO,
  beneficioDetectado: BENEFICIO,
  beneficios: [{ tipo: "desconto", valor: BENEFICIO }],
  condicoes: [{ tipo: "beneficio", valor: BENEFICIO }],
  observacoes: [{ texto: BENEFICIO }],
  linkAfiliado: LINK_AFILIADO
};

const contrato = resolverContratoComercialFinal(ofertaHorús).contratoComercialFinal;
assert.strictEqual(contrato.precoPor, 53.54, "preço vem da evidência do Radar");
assert.strictEqual(contrato.cupomCodigo, "BEMESTAR", "cupom confirmado é preservado");
assert.strictEqual(contrato.beneficio, BENEFICIO, "benefício textual é preservado uma única vez");
assert.strictEqual(contrato.parcelamento, "2x de R$ 33,47", "parcelamento usa a evidência textual explícita");

const mensagemUniversal = gerarTemplateUniversal(ofertaHorús);
assert.ok(mensagemUniversal.includes("R$ 53,54"), "preço final é renderizado");
assert.ok(mensagemUniversal.includes("2x de R$ 33,47"), "parcelamento comprovado é renderizado");
assert.ok(mensagemUniversal.includes("Cupom: *BEMESTAR*"), "código do cupom é renderizado");
assert.strictEqual(mensagemUniversal.split(BENEFICIO).length - 1, 1, "benefício não duplica no Template Universal");
assert.strictEqual(mensagemUniversal.split("[object Object]").length - 1, 0, "objetos não vazam para o texto comercial");
assert.ok(mensagemUniversal.includes(LINK_AFILIADO), "link afiliado da própria oferta é preservado");

const mensagemPersonalizada = renderizarTemplatePersonalizado({
  oferta: ofertaHorús,
  template: {
    id: "tpl-amazon-b51",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "parcelamento", ativo: true, ordem: 30 },
      { tipo: "cupom", ativo: true, ordem: 40 },
      { tipo: "beneficio", ativo: true, ordem: 50 },
      { tipo: "beneficio", ativo: true, ordem: 60 },
      { tipo: "link", ativo: true, ordem: 70 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(mensagemPersonalizada.ok, true, "renderer personalizado continua disponível");
assert.strictEqual(mensagemPersonalizada.mensagem.split(BENEFICIO).length - 1, 1, "benefício duplicado entre blocos é removido");
assert.strictEqual(mensagemPersonalizada.mensagem.split("[object Object]").length - 1, 0, "renderer personalizado não emite objeto");
assert.ok(mensagemPersonalizada.mensagem.includes(LINK_AFILIADO), "renderer personalizado mantém o link afiliado");

const parcelamentoSemOrigem = resolverContratoComercialFinal({
  ...ofertaHorús,
  textoOriginal: "Pré Treino Hórus Max Titanium 300g\nPor R$ 53,54\nCupom: BEMESTAR",
  parcelamento: {
    quantidade: 2,
    valorParcela: 33.47,
    confianca: "alta",
    evidencia: "2x de R$ 33,47"
  }
}).contratoComercialFinal;
assert.strictEqual(parcelamentoSemOrigem.parcelamento, "", "parcelamento estruturado sem evidência do Radar é omitido");

console.log("template-amazon-b51.test.js ok");
