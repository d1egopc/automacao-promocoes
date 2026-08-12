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
  textoOriginal: "Por R$ 159,00\nR$ 145,00 no Pix",
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

const permalinkTecnicoMl = "https://www.mercadolivre.com.br/produto-tecnico-gigante/p/MLB123456789";
const msgNikeFiel = gerarTemplateUniversal({
  titulo: "ML Nike",
  marketplace: "Mercado Livre",
  textoOriginal: "Nike\nDe R$ 699 por R$ 299\nhttps://grupo.origem/nike",
  precoOriginal: 699,
  precoAtual: 299,
  precoPix: "Desconto no Pix R$ 299",
  descontoPix: "Desconto no Pix R$ 299",
  linkAfiliado: "https://afiliado.origem/nike",
  linkProduto: permalinkTecnicoMl,
  linksComerciais: [
    {
      tipo: "produto",
      papel: "link_produto",
      ordemCaptura: 1,
      original: "https://grupo.origem/nike",
      resolvido: permalinkTecnicoMl,
      urlAfiliada: "https://go.optimus/d1/nike"
    }
  ]
});
assertNaoContem(msgNikeFiel, "Pix:", "ML Nike nao cria Desconto no Pix externo");
assertNaoContem(msgNikeFiel, permalinkTecnicoMl, "permalink tecnico ML nao renderiza");
assertNaoContem(msgNikeFiel, "https://grupo.origem/nike", "link original do grupo nao renderiza quando convertido");
assertNaoContem(msgNikeFiel, "https://afiliado.origem/nike", "afiliado de origem nao aparece junto da conversao workspace");
assert.strictEqual(contarOcorrencias(msgNikeFiel, "https://go.optimus/d1/nike"), 1, "um link Radar vira um link convertido");

const msgCkDoseDupla = gerarTemplateUniversal({
  titulo: "ML CK EM DOSE DUPLA",
  marketplace: "Mercado Livre",
  textoOriginal: "CK em dose dupla\nDe R$ 271 por R$ 98 no Pix\nhttps://meli.la/ck",
  precoOriginal: 271,
  precoAtual: 98,
  precoPix: "Desconto no Pix R$ 129",
  descontoPix: "Desconto no Pix R$ 129",
  beneficioPix: "pagamento_pix",
  condicoes: ["pagamento_pix"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/ck", urlAfiliada: "https://go.optimus/d1/ck" }
  ]
});
assertContem(msgCkDoseDupla, "De: *R$ 271,00*");
assertContem(msgCkDoseDupla, "Por: *R$ 98,00 no Pix*");
assertNaoContem(msgCkDoseDupla, "Pix:", "CK De/Por no Pix nao cria linha Pix separada");
assertNaoContem(msgCkDoseDupla, "Desconto no Pix R$ 129");
assertNaoContem(msgCkDoseDupla, "pagamento_pix");

const msgBichoSemPix = gerarTemplateUniversal({
  titulo: "🔥 ML TA PARECENDO UM BICHO",
  marketplace: "Mercado Livre",
  textoOriginal: "TA PARECENDO UM BICHO\nDe R$ 600 por R$ 162\nhttps://meli.la/bicho",
  precoOriginal: 600,
  precoAtual: 162,
  descontoPix: "Desconto no Pix R$ 600",
  beneficioPix: "pagamento_pix",
  condicoes: ["pagamento_pix", "voucher_ou_moedas"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/bicho", urlAfiliada: "https://go.optimus/d1/bicho" }
  ]
});
assertContem(msgBichoSemPix, "Por: *R$ 162,00*");
assertNaoContem(msgBichoSemPix, "Pix");
assertNaoContem(msgBichoSemPix, "pagamento_pix");
assertNaoContem(msgBichoSemPix, "voucher_ou_moedas");
assert.strictEqual(contarOcorrencias(msgBichoSemPix, "🔥"), 1, "titulo com emoji nao duplica prefixo");

const msgKabumRyzen = gerarTemplateUniversal({
  titulo: "KaBuM Ryzen 9 7900",
  marketplace: "KaBuM",
  textoOriginal: "KaBuM Ryzen 9 7900\nPor R$ 2.199\nOu 10x de R$ 219,90\nFrete gratis",
  precoAtual: 2199,
  parcelamento: "💳 Ou 10x de R$ 219,90",
  frete: "frete",
  freteGratis: true,
  condicoes: ["frete", "voucher_ou_moedas"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://kabum.test/ryzen", urlAfiliada: "https://go.optimus/d1/ryzen" }
  ]
});
assertContem(msgKabumRyzen, "💳 Ou 10x de R$ 219,90");
assertNaoContem(msgKabumRyzen, "💳 💳");
assertNaoContem(msgKabumRyzen, "voucher_ou_moedas");
assertNaoContem(msgKabumRyzen, "\nfrete\n");
assert.strictEqual(contarOcorrencias(msgKabumRyzen, "Frete gratis"), 1);

const msgFraseReal = gerarTemplateUniversal({
  titulo: "Frase comercial real",
  marketplace: "Mercado Livre",
  textoOriginal: "Cupom: PROMO10\nAplique o cupom de 10% no anuncio",
  precoAtual: 100,
  cupom: "PROMO10",
  instrucaoCupom: "Aplique o cupom de 10% no anuncio",
  linkAfiliado: "https://go.optimus/frase-real"
});
assertContem(msgFraseReal, "Aplique o cupom de 10% no anuncio");

const msgCalcaMl = gerarTemplateUniversal({
  titulo: "ML Calca Jeans",
  marketplace: "Mercado Livre",
  precoAtual: 89,
  linkProduto: "https://produto.mercadolivre.com.br/MLB-tecnico",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/calca", urlAfiliada: "https://go.optimus/d1/calca" }
  ]
});
assert.strictEqual(contarOcorrencias(msgCalcaMl, "https://go.optimus/d1/calca"), 1);
assertNaoContem(msgCalcaMl, "produto.mercadolivre.com.br/MLB-tecnico");

const msgSegurancaMl = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "ML Seguranca",
    marketplace: "Mercado Livre",
    precoAtual: 519,
    descontoPix: "Desconto no Pix R$ 519",
    linkAfiliado: "https://afiliado.origem/seguranca",
    linksComerciais: [
      { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/seg", urlAfiliada: "https://go.optimus/d1/seguranca" }
    ]
  },
  template: {
    id: "ml_seguranca_fiel",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "preco_por", ativo: true, ordem: 10 },
      { tipo: "preco_pix", ativo: true, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(msgSegurancaMl.ok, true);
assertNaoContem(msgSegurancaMl.mensagem, "Pix:");
assertNaoContem(msgSegurancaMl.mensagem, "https://afiliado.origem/seguranca");
assert.strictEqual(contarOcorrencias(msgSegurancaMl.mensagem, "https://go.optimus/d1/seguranca"), 1);

const msgPlacaMae = gerarTemplateUniversal({
  titulo: "ML Placa-mae A520m",
  marketplace: "Mercado Livre",
  precoAtual: 389,
  precoPix: "Pix: si A520m DDR4 HDMI",
  beneficioTexto: "Frete gratis",
  beneficios: ["Frete gratis"],
  freteGratis: true,
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, urlAfiliada: "https://go.optimus/placa" }
  ]
});
assertNaoContem(msgPlacaMae, "Pix: si A520m");
assert.strictEqual(contarOcorrencias(msgPlacaMae, "Frete gratis"), 1, "frete nao duplica como beneficio + frete");

const msgKabumMonitor = gerarTemplateUniversal({
  titulo: "KaBuM Monitor",
  marketplace: "KaBuM",
  precoAtual: 699,
  parcelamento: "10x de R$ 69,90",
  freteGratis: true,
  condicoes: ["10x de R$ 69,90", "Frete gratis"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, urlAfiliada: "https://go.optimus/kabum-monitor" }
  ]
});
assert.strictEqual(contarOcorrencias(msgKabumMonitor, "10x de R$ 69,90"), 1, "parcelamento nao duplica por condicoes");
assert.strictEqual(contarOcorrencias(msgKabumMonitor, "Frete gratis"), 1, "frete nao duplica por condicoes");

console.log("contrato-comercial-final-universal.test.js OK");
