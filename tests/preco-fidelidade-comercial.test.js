const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-preco-fidelidade-"));
process.env.DATA_DIR = dataDir;

const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const { writeClienteJson } = require("../utils/storage");
const {
  carregarOfertaCliente,
  montarLegendaInstagram
} = require("../modules/social/instagram");

function textoMoeda(texto) {
  return String(texto || "").replace(/\u00a0/g, " ");
}

function assertInclui(texto, trecho, mensagem) {
  assert.ok(textoMoeda(texto).includes(trecho), mensagem || `esperado conter ${trecho}`);
}

function assertNaoInclui(texto, trecho, mensagem) {
  assert.ok(!textoMoeda(texto).includes(trecho), mensagem || `esperado nao conter ${trecho}`);
}

const templatePreco = {
  id: "tpl_preco_fidelidade",
  canais: ["whatsapp", "telegram", "social"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "preco_de", ativo: true, ordem: 20 },
    { tipo: "preco_por", ativo: true, ordem: 30 },
    { tipo: "frase_cupom", ativo: true, ordem: 40 },
    { tipo: "cupom", ativo: true, ordem: 50 },
    { tipo: "link", ativo: true, ordem: 60 }
  ]
};

function ofertaBase(sobrescrita = {}) {
  return {
    id: "oferta_teste",
    titulo: "Oferta Teste",
    marketplace: "amazon",
    precoAtual: 100,
    preco: 100,
    precoOriginal: "",
    cupom: "PROMO10",
    linkAfiliado: "https://example.com/oferta",
    inteligenciaUniversalV2: {},
    ...sobrescrita
  };
}

function assertTemplateUniversalUsaPrecoOficial(nome, oferta, precoEsperado, precoProibido) {
  const mensagem = gerarTemplateUniversal(prepararDadosOficiaisTemplate(oferta, { modo: "universal" }));
  assertInclui(mensagem, `Por: *${precoEsperado}*`, `${nome}: Template Universal usa preco atual oficial`);
  if (precoProibido) {
    assertNaoInclui(mensagem, `Por: *${precoProibido}*`, `${nome}: Template Universal nao usa valor efetivo`);
  }
}

function assertTemplatePersonalizadoUsaPrecoOficial(nome, oferta, precoEsperado, precoProibido) {
  const render = renderizarTemplatePersonalizado({
    oferta,
    template: templatePreco,
    canal: "whatsapp"
  });
  assert.strictEqual(render.ok, true, `${nome}: template personalizado renderiza`);
  assertInclui(render.mensagem, `Por: ${precoEsperado}`, `${nome}: personalizado usa preco atual oficial`);
  if (precoProibido) {
    assertNaoInclui(render.mensagem, `Por: ${precoProibido}`, `${nome}: personalizado nao usa valor efetivo`);
  }
}

const amazonCooktop = ofertaBase({
  titulo: "Cooktop Suggar",
  precoAtual: 983.29,
  preco: 983.29,
  valorEfetivo: 933.29,
  valorEfetivoOrigem: "cupom_valor_fixo",
  inteligenciaUniversalV2: {
    valorEfetivo: 933.29,
    valorEfetivoOrigem: "cupom_valor_fixo"
  }
});
assertTemplateUniversalUsaPrecoOficial("Amazon Cooktop", amazonCooktop, "R$ 983,29", "R$ 933,29");
assertTemplatePersonalizadoUsaPrecoOficial("Amazon Cooktop", amazonCooktop, "R$ 983,29", "R$ 933,29");

const amazonPinceis = ofertaBase({
  titulo: "Kit Pinceis",
  precoAtual: 29.61,
  preco: 29.61,
  valorEfetivo: 9.61,
  valorEfetivoOrigem: "cupom_valor_fixo",
  inteligenciaUniversalV2: {
    valorEfetivo: 9.61,
    valorEfetivoOrigem: "cupom_valor_fixo"
  }
});
assertTemplateUniversalUsaPrecoOficial("Amazon Kit Pinceis", amazonPinceis, "R$ 29,61", "R$ 9,61");
assertTemplatePersonalizadoUsaPrecoOficial("Amazon Kit Pinceis", amazonPinceis, "R$ 29,61", "R$ 9,61");

const mercadoLivreDeInvalido = ofertaBase({
  titulo: "Kit 3 Cropped",
  marketplace: "mercadolivre",
  precoOriginal: 3,
  precoAntigo: 3,
  precoAtual: 98.72,
  preco: 98.72
});
const msgMlUniversal = textoMoeda(gerarTemplateUniversal(prepararDadosOficiaisTemplate(mercadoLivreDeInvalido, { modo: "universal" })));
assertInclui(msgMlUniversal, "Por: *R$ 98,72*", "Mercado Livre invalido mostra Por oficial");
assertNaoInclui(msgMlUniversal, "De:", "Mercado Livre invalido nao mostra De menor que Por");
const msgMlPersonalizado = textoMoeda(renderizarTemplatePersonalizado({
  oferta: mercadoLivreDeInvalido,
  template: templatePreco,
  canal: "whatsapp"
}).mensagem);
assertInclui(msgMlPersonalizado, "Por: R$ 98,72", "personalizado invalido mostra Por oficial");
assertNaoInclui(msgMlPersonalizado, "De:", "personalizado invalido nao mostra De menor que Por");

const camisetasHering = ofertaBase({
  titulo: "Kit Camisetas Hering",
  marketplace: "mercadolivre",
  precoAtual: 159,
  preco: 159,
  valorEfetivo: 48,
  valorEfetivoOrigem: "cupom_valor_fixo",
  inteligenciaUniversalV2: {
    valorEfetivo: 48,
    valorEfetivoOrigem: "cupom_valor_fixo"
  }
});
assertTemplateUniversalUsaPrecoOficial("Camisetas Hering", camisetasHering, "R$ 159,00", "R$ 48,00");
assertTemplatePersonalizadoUsaPrecoOficial("Camisetas Hering", camisetasHering, "R$ 159,00", "R$ 48,00");

const precoAntigoValido = ofertaBase({
  titulo: "Preco antigo valido",
  precoOriginal: 109.08,
  precoAntigo: 109.08,
  precoAtual: 88.41,
  preco: 88.41
});
const msgValidoUniversal = textoMoeda(gerarTemplateUniversal(prepararDadosOficiaisTemplate(precoAntigoValido, { modo: "universal" })));
assertInclui(msgValidoUniversal, "De: *R$ 109,08*", "Template Universal preserva De valido");
assertInclui(msgValidoUniversal, "Por: *R$ 88,41*", "Template Universal preserva Por valido");
const msgValidoPersonalizado = textoMoeda(renderizarTemplatePersonalizado({
  oferta: precoAntigoValido,
  template: templatePreco,
  canal: "whatsapp"
}).mensagem);
assertInclui(msgValidoPersonalizado, "De: R$ 109,08", "personalizado preserva De valido");
assertInclui(msgValidoPersonalizado, "Por: R$ 88,41", "personalizado preserva Por valido");

function mensagemPadraoUniversal(oferta) {
  return textoMoeda(gerarTemplateUniversal(prepararDadosOficiaisTemplate(oferta, { modo: "universal" })));
}

function assertPrecoDeUniversal({ nome, oferta, de, por }) {
  const mensagem = mensagemPadraoUniversal(oferta);
  assertInclui(mensagem, `De: *${de}*`, `${nome}: Template Padrao mostra De explicito valido`);
  assertInclui(mensagem, `Por: *${por}*`, `${nome}: Template Padrao preserva Por oficial`);
}

const ofertasPrecoDeUniversal = [
  {
    nome: "Amazon preco_de",
    oferta: ofertaBase({ marketplace: "amazon", precoAtual: 100, preco: 100, preco_de: 150 }),
    de: "R$ 150,00",
    por: "R$ 100,00"
  },
  {
    nome: "Mercado Livre precoOriginal",
    oferta: ofertaBase({ marketplace: "mercadolivre", precoAtual: 210, preco: 210, precoOriginal: 260 }),
    de: "R$ 260,00",
    por: "R$ 210,00"
  },
  {
    nome: "Shopee precoAntigo",
    oferta: ofertaBase({ marketplace: "shopee", precoAtual: 79.9, preco: 79.9, precoAntigo: 119.9 }),
    de: "R$ 119,90",
    por: "R$ 79,90"
  },
  {
    nome: "AliExpress precoDe",
    oferta: ofertaBase({ marketplace: "aliexpress", precoAtual: 55.5, preco: 55.5, precoDe: 88.8 }),
    de: "R$ 88,80",
    por: "R$ 55,50"
  },
  {
    nome: "KaBuM Oferta Universal",
    oferta: ofertaBase({
      marketplace: "kabum",
      precoAtual: 899.9,
      preco: 899.9,
      ofertaUniversal: { comercial: { precoAnterior: 1099.9 } }
    }),
    de: "R$ 1.099,90",
    por: "R$ 899,90"
  },
  {
    nome: "AWIN templateInput",
    oferta: ofertaBase({
      marketplace: "awin",
      precoAtual: 249.9,
      preco: 249.9,
      inteligenciaUniversalV2: { templateInput: { precoOriginal: 349.9 } }
    }),
    de: "R$ 349,90",
    por: "R$ 249,90"
  }
];

for (const caso of ofertasPrecoDeUniversal) {
  assertPrecoDeUniversal(caso);
}

const semPrecoDeUniversal = mensagemPadraoUniversal(ofertaBase({
  marketplace: "shopee",
  precoAtual: 100,
  preco: 100,
  economia: 50,
  descontoPercentual: 33
}));
assertInclui(semPrecoDeUniversal, "Por: *R$ 100,00*", "Template Padrao sem De preserva Por");
assertNaoInclui(semPrecoDeUniversal, "De:", "Template Padrao sem De nao inventa preco anterior");

for (const ofertaInvalida of [
  ofertaBase({ marketplace: "amazon", precoAtual: 100, preco: 100, preco_de: "valor indisponivel" }),
  ofertaBase({ marketplace: "mercadolivre", precoAtual: 100, preco: 100, precoOriginal: 100 }),
  ofertaBase({ marketplace: "aliexpress", precoAtual: 100, preco: 100, precoDe: 80 })
]) {
  const mensagem = mensagemPadraoUniversal(ofertaInvalida);
  assertInclui(mensagem, "Por: *R$ 100,00*", "Template Padrao com De invalido preserva Por");
  assertNaoInclui(mensagem, "De:", "Template Padrao omite De invalido ou menor/igual ao Por");
}

const templateSemPrecoDe = {
  id: "tpl_sem_preco_de",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "preco_de", ativo: false, ordem: 10 },
    { tipo: "preco_por", ativo: true, ordem: 20 }
  ]
};
for (const caso of ofertasPrecoDeUniversal) {
  const render = renderizarTemplatePersonalizado({
    oferta: caso.oferta,
    template: templateSemPrecoDe,
    canal: "whatsapp"
  });
  assert.strictEqual(render.ok, true, `${caso.nome}: personalizado renderiza com De oculto`);
  assertInclui(render.mensagem, `Por: ${caso.por}`, `${caso.nome}: personalizado preserva Por com De oculto`);
  assertNaoInclui(render.mensagem, "De:", `${caso.nome}: personalizado respeita toggle de preco_de`);
}

const dadosPersonalizados = prepararDadosOficiaisTemplate(amazonCooktop, { modo: "personalizado" });
assert.strictEqual(dadosPersonalizados.precoExibido, 983.29, "precoExibido usa preco atual oficial");
assert.strictEqual(dadosPersonalizados.fontePrecoExibido, "preco_atual", "fonte do preco exibido permanece oficial");

const clienteId = "cliente_preco_social";
writeClienteJson(clienteId, "fila.json", [{
  ...amazonCooktop,
  id: "oferta_social_preco",
  clienteId
}]);
const ofertaSocial = carregarOfertaCliente(clienteId, "oferta_social_preco");
assert.strictEqual(ofertaSocial.precoAtual, 983.29, "Social carrega precoAtual oficial, nao valorEfetivo");
const legendaSocial = montarLegendaInstagram(ofertaSocial).legenda;
assertInclui(legendaSocial, "Por: R$ 983,29", "Social legenda usa preco atual oficial");
assertNaoInclui(legendaSocial, "R$ 933,29", "Social legenda nao usa valor efetivo");

console.log("preco-fidelidade-comercial.test.js OK");
