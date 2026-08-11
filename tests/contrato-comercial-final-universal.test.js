const assert = require("assert");

const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const {
  resolverContratoComercialFinal
} = require("../modules/templates-clientes/contrato-comercial-final");
const {
  extrairLinksRadar
} = require("../utils/radar-cupom-mensagem");

function normalizar(texto) {
  return String(texto || "").replace(/\u00a0/g, " ");
}

function assertContem(texto, trecho, msg) {
  assert.ok(normalizar(texto).includes(trecho), msg || `deveria conter ${trecho}`);
}

function assertNaoContem(texto, trecho, msg) {
  assert.ok(!normalizar(texto).includes(trecho), msg || `nao deveria conter ${trecho}`);
}

function contarOcorrencias(texto, trecho) {
  return normalizar(texto).split(trecho).length - 1;
}

function linksFixture() {
  return [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, urlOptimus: "https://go.optimus/produto-1" },
    { tipo: "produto", papel: "link_produto", ordemCaptura: 2, urlOptimus: "https://go.optimus/produto-2" },
    { tipo: "resgate", papel: "link_resgate", ordemCaptura: 3, urlOptimus: "https://go.optimus/resgate" },
    { tipo: "app", papel: "link_app", ordemCaptura: 4, urlOptimus: "https://go.optimus/app" },
    { tipo: "pc", papel: "link_pc", ordemCaptura: 5, urlOptimus: "https://go.optimus/pc" }
  ];
}

const casoA = {
  titulo: "Caso A Pix como condicao do Por",
  marketplace: "Mercado Livre",
  textoComercialOriginal: "De R$ 259 por R$ 145 no Pix",
  precoOriginal: 259,
  precoAtual: 145,
  precoPix: "De R$ 259 por R$ 145 no Pix",
  linkAfiliado: "https://meli.la/a"
};
const contratoA = resolverContratoComercialFinal(casoA).contratoComercialFinal;
assert.strictEqual(contratoA.precoDe, 259);
assert.strictEqual(contratoA.precoPor, 145);
assert.strictEqual(contratoA.condicaoPrecoPor, "pix");
assert.strictEqual(contratoA.precoPixDistinto, null);
const msgA = gerarTemplateUniversal(casoA);
assertContem(msgA, "De: *R$ 259,00*");
assertContem(msgA, "Por: *R$ 145,00 no Pix*");
assertNaoContem(msgA, "Pix:", "Caso A nao cria linha Pix separada");

const msgB = gerarTemplateUniversal({
  titulo: "Caso B Pix distinto",
  marketplace: "Amazon",
  precoAtual: 159,
  precoPix: "R$ 145,00 no Pix",
  linkAfiliado: "https://amzn.to/b"
});
assertContem(msgB, "Por: *R$ 159,00*");
assertContem(msgB, "Pix: *R$ 145,00 no Pix*");

const msgC = gerarTemplateUniversal({
  titulo: "Caso C Sem Pix",
  marketplace: "Shopee",
  precoAtual: 159,
  linkAfiliado: "https://s.shopee.com.br/c"
});
assertContem(msgC, "Por: *R$ 159,00*");
assertNaoContem(msgC, "Pix:");

const msgD = gerarTemplateUniversal({
  titulo: "Caso D Pix nu contaminado",
  marketplace: "Mercado Livre",
  textoComercialOriginal: "De R$ 319 por R$ 131",
  precoOriginal: 319,
  precoAtual: 131,
  precoPix: "R$ 319",
  linkAfiliado: "https://meli.la/d"
});
assertContem(msgD, "De: *R$ 319,00*");
assertContem(msgD, "Por: *R$ 131,00*");
assertNaoContem(msgD, "Pix:");

const msgE = gerarTemplateUniversal({
  titulo: "Caso E OFF sem codigo",
  marketplace: "Shopee",
  precoAtual: 455,
  beneficioTexto: "R$ 50 OFF",
  beneficios: ["R$ 50 OFF"],
  linkAfiliado: "https://s.shopee.com.br/e"
});
assert.strictEqual((normalizar(msgE).match(/R\$ 50 OFF/g) || []).length, 1);
assertNaoContem(msgE, "Cupom: *R$ 50 OFF*");

const msgF = gerarTemplateUniversal({
  titulo: "Caso F Cupom e beneficio",
  marketplace: "Shopee",
  precoAtual: 455,
  cupom: "PROMO10",
  beneficioTexto: "R$ 50 OFF",
  beneficios: ["R$ 50 OFF"],
  linkAfiliado: "https://s.shopee.com.br/f"
});
assertContem(msgF, "Cupom: *PROMO10*");
assertContem(msgF, "R$ 50 OFF");

const contratoCupomDaloja = resolverContratoComercialFinal({
  titulo: "Cupom explicito DALOJA",
  marketplace: "AliExpress",
  textoOriginal: "Cupom: DALOJA",
  cupom: "DALOJA"
}).contratoComercialFinal;
assert.strictEqual(contratoCupomDaloja.cupomCodigo, "DALOJA");

const contratoCupomNovo = resolverContratoComercialFinal({
  titulo: "Cupom explicito NOVO",
  marketplace: "Amazon",
  textoOriginal: "Cupom: NOVO",
  cupom: "NOVO"
}).contratoComercialFinal;
assert.strictEqual(contratoCupomNovo.cupomCodigo, "NOVO");

const contratoCupomCampoConfiavel = resolverContratoComercialFinal({
  titulo: "Cupom por campo confiavel",
  marketplace: "KaBuM",
  cupomCodigo: "EXCLUSIVO"
}).contratoComercialFinal;
assert.strictEqual(contratoCupomCampoConfiavel.cupomCodigo, "EXCLUSIVO");

const contratoG = resolverContratoComercialFinal({
  titulo: "Caso G Linguagem fraca",
  marketplace: "Amazon",
  precoAtual: 99,
  cupom: "NOVO",
  textoOriginal: "novo exclusivo da loja",
  instrucaoCupom: "Aplique Caes e Gatos"
}).contratoComercialFinal;
assert.strictEqual(contratoG.cupomCodigo, "");
assert.strictEqual(contratoG.instrucaoComercial, "");

const msgSemInstrucaoUniversal = gerarTemplateUniversal({
  titulo: "Cupom real sem instrucao",
  marketplace: "Amazon",
  precoAtual: 100,
  cupom: "SEMPREMODA",
  textoOriginal: "Cupom: SEMPREMODA",
  linkAfiliado: "https://amzn.to/sempremoda"
});
assertContem(msgSemInstrucaoUniversal, "Cupom: *SEMPREMODA*");
assertNaoContem(msgSemInstrucaoUniversal, "Aplique o cupom SEMPREMODA");

const msgSemInstrucaoPersonalizado = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Cupom real personalizado",
    marketplace: "Amazon",
    precoAtual: 100,
    cupom: "SEMPREMODA",
    textoOriginal: "Cupom: SEMPREMODA",
    linkAfiliado: "https://amzn.to/sempremoda"
  },
  template: {
    id: "sem_instrucao",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "cupom", ativo: true, ordem: 10 },
      { tipo: "frase_cupom", ativo: true, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assertContem(msgSemInstrucaoPersonalizado.mensagem, "Cupom: SEMPREMODA");
assertNaoContem(msgSemInstrucaoPersonalizado.mensagem, "Aplique o cupom SEMPREMODA");

const msgH = gerarTemplateUniversal({
  titulo: "Caso H Shopee links",
  marketplace: "Shopee",
  precoAtual: 100,
  linkAfiliado: "https://go.optimus/produto-principal",
  linksComerciais: linksFixture().slice(0, 3)
});
assertContem(msgH, "Resgate:");
assertContem(msgH, "https://go.optimus/resgate");
assertContem(msgH, "Confira aqui:");
assertContem(msgH, "https://go.optimus/produto-1");
assertContem(msgH, "https://go.optimus/produto-2");

const msgI = gerarTemplateUniversal({
  titulo: "Caso I AliExpress APP PC",
  marketplace: "AliExpress",
  precoAtual: 100,
  linkAfiliado: "https://go.optimus/produto",
  linksComerciais: linksFixture().filter(item => ["app", "pc", "produto"].includes(item.tipo))
});
assertContem(msgI, "APP:");
assertContem(msgI, "https://go.optimus/app");
assertContem(msgI, "PC:");
assertContem(msgI, "https://go.optimus/pc");

const personalizadoJ = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Caso J Multiplos links",
    marketplace: "Shopee",
    precoAtual: 100,
    linkAfiliado: "https://go.optimus/produto-principal",
    linksComerciais: linksFixture()
  },
  template: {
    id: "contrato_final_links",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "link_resgate", ativo: true, ordem: 30 },
      { tipo: "link_app", ativo: true, ordem: 40 },
      { tipo: "link_pc", ativo: true, ordem: 50 },
      { tipo: "link", ativo: true, ordem: 60 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(personalizadoJ.ok, true);
assertContem(personalizadoJ.mensagem, "https://go.optimus/resgate");
assertContem(personalizadoJ.mensagem, "https://go.optimus/app");
assertContem(personalizadoJ.mensagem, "https://go.optimus/pc");
assertContem(personalizadoJ.mensagem, "https://go.optimus/produto-1");
assertContem(personalizadoJ.mensagem, "https://go.optimus/produto-2");

const personalizadoPixTextoOriginal = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Caso Pix textoOriginal",
    marketplace: "Amazon",
    textoOriginal: "De R$ 259 por R$ 145 no Pix",
    precoOriginal: 259,
    precoAtual: 145,
    precoPix: "R$ 259",
    linkAfiliado: "https://amzn.to/pix"
  },
  template: {
    id: "pix_texto_original",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "preco_de", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "preco_pix", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});
assertContem(personalizadoPixTextoOriginal.mensagem, "De: R$ 259,00");
assertContem(personalizadoPixTextoOriginal.mensagem, "Por: R$ 145,00 no Pix");
assertNaoContem(personalizadoPixTextoOriginal.mensagem, "Pix:", "personalizado nao cria linha Pix separada para De/Por no Pix");

for (const marketplace of ["Mercado Livre", "Shopee", "Amazon", "AliExpress", "KaBuM"]) {
  const contrato = resolverContratoComercialFinal({
    titulo: `Contrato ${marketplace}`,
    marketplace,
    textoComercialOriginal: "De R$ 259 por R$ 145 no Pix",
    precoOriginal: 259,
    precoAtual: 145,
    linkAfiliado: "https://example.com/produto"
  }).contratoComercialFinal;
  assert.strictEqual(contrato.condicaoPrecoPor, "pix", `${marketplace}: contrato universal preserva Pix como condicao`);
  assert.strictEqual(contrato.precoPixDistinto, null, `${marketplace}: contrato universal nao inventa Pix distinto`);
}

const linksRadarDuplicados = extrairLinksRadar("Resgate\nhttps://x.test/a\nResgate\nhttps://x.test/a\nProduto\nhttps://x.test/b");
assert.deepStrictEqual(linksRadarDuplicados, ["https://x.test/a", "https://x.test/a", "https://x.test/b"]);

const linksOcorrenciasDuplicadas = [
  { tipo: "resgate", papel: "link_resgate", ordemCaptura: 1, urlAfiliada: "https://go.optimus/resgate-a" },
  { tipo: "resgate", papel: "link_resgate", ordemCaptura: 2, urlAfiliada: "https://go.optimus/resgate-a" },
  { tipo: "produto", papel: "link_produto", ordemCaptura: 3, urlAfiliada: "https://go.optimus/produto-b" },
  { tipo: "produto", papel: "link_produto", ordemCaptura: 4, urlAfiliada: "https://go.optimus/produto-b" },
  { tipo: "app", papel: "link_app", ordemCaptura: 5, urlAfiliada: "https://go.optimus/app" },
  { tipo: "app", papel: "link_app", ordemCaptura: 6, urlAfiliada: "https://go.optimus/app" },
  { tipo: "moedas", papel: "link_moedas", ordemCaptura: 7, urlAfiliada: "https://go.optimus/moedas" },
  { tipo: "pc", papel: "link_pc", ordemCaptura: 8, urlAfiliada: "https://go.optimus/pc" }
];
const contratoOcorrencias = resolverContratoComercialFinal({
  titulo: "Ocorrencias de links",
  marketplace: "Shopee",
  precoAtual: 100,
  linksComerciais: linksOcorrenciasDuplicadas
}).contratoComercialFinal;
assert.strictEqual(contratoOcorrencias.linksResgate.length, 2, "2 Resgates identicos permanecem 2 ocorrencias");
assert.strictEqual(contratoOcorrencias.linksProduto.length, 2, "2 Produtos identicos permanecem 2 ocorrencias");
assert.strictEqual(contratoOcorrencias.linksApp.length, 2, "2 APP identicos permanecem 2 ocorrencias");
assert.strictEqual(contratoOcorrencias.linksMoedas.length, 1);
assert.strictEqual(contratoOcorrencias.linksPc.length, 1);

const msgOcorrencias = gerarTemplateUniversal({
  titulo: "Render ocorrencias",
  marketplace: "Shopee",
  precoAtual: 100,
  linksComerciais: linksOcorrenciasDuplicadas
});
assert.strictEqual(contarOcorrencias(msgOcorrencias, "https://go.optimus/resgate-a"), 2);
assert.strictEqual(contarOcorrencias(msgOcorrencias, "https://go.optimus/produto-b"), 2);
assert.strictEqual(contarOcorrencias(msgOcorrencias, "https://go.optimus/app"), 2);
assert.strictEqual(contarOcorrencias(msgOcorrencias, "https://go.optimus/moedas"), 1);
assert.strictEqual(contarOcorrencias(msgOcorrencias, "https://go.optimus/pc"), 1);
assert.ok(
  msgOcorrencias.indexOf("https://go.optimus/resgate-a") < msgOcorrencias.indexOf("https://go.optimus/produto-b"),
  "ordem semantica de Resgate antes de Produto permanece"
);

const personalizadoOcorrencias = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Personalizado ocorrencias",
    marketplace: "Shopee",
    precoAtual: 100,
    linksComerciais: linksOcorrenciasDuplicadas
  },
  template: {
    id: "ocorrencias_links",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "link_resgate", ativo: true, ordem: 10 },
      { tipo: "link_app", ativo: true, ordem: 20 },
      { tipo: "link_moedas", ativo: true, ordem: 30 },
      { tipo: "link_pc", ativo: true, ordem: 40 },
      { tipo: "link", ativo: true, ordem: 50 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(personalizadoOcorrencias.ok, true);
assert.strictEqual(contarOcorrencias(personalizadoOcorrencias.mensagem, "https://go.optimus/resgate-a"), 2);
assert.strictEqual(contarOcorrencias(personalizadoOcorrencias.mensagem, "https://go.optimus/produto-b"), 2);
assert.strictEqual(contarOcorrencias(personalizadoOcorrencias.mensagem, "https://go.optimus/app"), 2);
assert.strictEqual(contarOcorrencias(personalizadoOcorrencias.mensagem, "https://go.optimus/moedas"), 1);
assert.strictEqual(contarOcorrencias(personalizadoOcorrencias.mensagem, "https://go.optimus/pc"), 1);

const msgWorkspaceA = gerarTemplateUniversal({
  titulo: "Workspace A",
  marketplace: "Shopee",
  precoAtual: 100,
  clienteId: "workspace_a",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://s.shopee.com.br/original", urlAfiliada: "https://s.shopee.com.br/workspace-a" },
    { tipo: "produto", papel: "link_produto", ordemCaptura: 2, original: "https://s.shopee.com.br/original", urlAfiliada: "https://s.shopee.com.br/workspace-a" }
  ]
});
const msgWorkspaceB = gerarTemplateUniversal({
  titulo: "Workspace B",
  marketplace: "Shopee",
  precoAtual: 100,
  clienteId: "workspace_b",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://s.shopee.com.br/original", urlAfiliada: "https://s.shopee.com.br/workspace-b" },
    { tipo: "produto", papel: "link_produto", ordemCaptura: 2, original: "https://s.shopee.com.br/original", urlAfiliada: "https://s.shopee.com.br/workspace-b" }
  ]
});
assert.strictEqual(contarOcorrencias(msgWorkspaceA, "https://s.shopee.com.br/workspace-a"), 2);
assert.strictEqual(contarOcorrencias(msgWorkspaceA, "https://s.shopee.com.br/workspace-b"), 0);
assert.strictEqual(contarOcorrencias(msgWorkspaceB, "https://s.shopee.com.br/workspace-b"), 2);
assert.strictEqual(contarOcorrencias(msgWorkspaceB, "https://s.shopee.com.br/workspace-a"), 0);

for (const marketplace of ["Mercado Livre", "Shopee", "Amazon", "AliExpress", "KaBuM"]) {
  const msgLinksMarketplace = gerarTemplateUniversal({
    titulo: `Links ${marketplace}`,
    marketplace,
    precoAtual: 100,
    linksComerciais: [
      { tipo: "produto", papel: "link_produto", ordemCaptura: 1, urlAfiliada: `https://go.optimus/${marketplace}/x` },
      { tipo: "produto", papel: "link_produto", ordemCaptura: 2, urlAfiliada: `https://go.optimus/${marketplace}/x` }
    ]
  });
  assert.strictEqual(contarOcorrencias(msgLinksMarketplace, `https://go.optimus/${marketplace}/x`), 2, `${marketplace}: clones de link produto permanecem`);
}

console.log("contrato-comercial-final-universal.test.js OK");
