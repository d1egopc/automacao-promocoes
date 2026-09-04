const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
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

function montarMensagemComTemplateUniversalFalhando() {
  const pathMensagens = require.resolve("../utils/mensagens-ofertas");
  const pathTemplateUniversal = require.resolve("../modules/template-universal");
  const cacheMensagensOriginal = require.cache[pathMensagens];
  const cacheTemplateOriginal = require.cache[pathTemplateUniversal];

  delete require.cache[pathMensagens];
  require.cache[pathTemplateUniversal] = {
    id: pathTemplateUniversal,
    filename: pathTemplateUniversal,
    loaded: true,
    exports: { gerarTemplateUniversal: () => "" }
  };

  const { montarMensagemOferta: montar } = require("../utils/mensagens-ofertas");

  if (cacheTemplateOriginal) require.cache[pathTemplateUniversal] = cacheTemplateOriginal;
  else delete require.cache[pathTemplateUniversal];
  delete require.cache[pathMensagens];
  if (cacheMensagensOriginal) require.cache[pathMensagens] = cacheMensagensOriginal;

  return montar;
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
assertNaoContem(msgB, "Pix:", "Pix distinto nao cria linha propria");

const msgC = gerarTemplateUniversal({
  titulo: "Caso C Sem Pix",
  marketplace: "Shopee",
  precoAtual: 159,
  linkAfiliado: "https://s.shopee.com.br/c"
});
assertContem(msgC, "Por: *R$ 159,00*");
assertNaoContem(msgC, "Pix:");

const msgPorSemPix = gerarTemplateUniversal({
  titulo: "Caso A Pedido Sem Condicao",
  marketplace: "Mercado Livre",
  textoOriginal: "Por R$ 55,90",
  precoAtual: 55.9,
  linkAfiliado: "https://meli.la/sem-pix"
});
assertContem(msgPorSemPix, "Por: *R$ 55,90*");
assertNaoContem(msgPorSemPix, "Pix");

const msgPorNoPix = gerarTemplateUniversal({
  titulo: "Caso B Pedido Por no Pix",
  marketplace: "Mercado Livre",
  textoOriginal: "Por R$ 55,90 no Pix",
  precoAtual: 55.9,
  condicaoPix: "R$ 55,90 no Pix",
  linkAfiliado: "https://meli.la/por-pix"
});
assertContem(msgPorNoPix, "Por: *R$ 55,90 no Pix*");
assertNaoContem(msgPorNoPix, "Pix:");

const msgDePorNoPix = gerarTemplateUniversal({
  titulo: "Caso C Pedido De Por Pix",
  marketplace: "Mercado Livre",
  textoOriginal: "De R$ 129 por R$ 55 no Pix",
  precoOriginal: 129,
  precoAtual: 55,
  precoPix: "R$ 129",
  linkAfiliado: "https://meli.la/de-por-pix"
});
assertContem(msgDePorNoPix, "De: *R$ 129,00*");
assertContem(msgDePorNoPix, "Por: *R$ 55,00 no Pix*");
assertNaoContem(msgDePorNoPix, "Pix:");

const msgPixApiIgnorado = gerarTemplateUniversal({
  titulo: "Caso D Externo",
  marketplace: "Mercado Livre",
  textoOriginal: "Por R$ 55,90",
  precoOriginal: 129,
  precoAtual: 55.9,
  precoPix: "R$ 129 no Pix",
  linkAfiliado: "https://meli.la/api-pix"
});
assertContem(msgPixApiIgnorado, "Por: *R$ 55,90*");
assertNaoContem(msgPixApiIgnorado, "Pix");

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
assertContem(msgSemInstrucaoUniversal, "Aplique o cupom SEMPREMODA para obter o valor.");

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
assertContem(msgSemInstrucaoPersonalizado.mensagem, "Aplique o cupom SEMPREMODA para obter o valor.");

const msgCupomOcultoPersonalizado = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Cupom real personalizado oculto",
    marketplace: "Amazon",
    precoAtual: 100,
    cupom: "SEMPREMODA",
    textoOriginal: "Cupom: SEMPREMODA",
    linkAfiliado: "https://amzn.to/sempremoda"
  },
  template: {
    id: "instrucao_oculta",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "cupom", ativo: true, ordem: 10 },
      { tipo: "frase_cupom", ativo: false, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assertContem(msgCupomOcultoPersonalizado.mensagem, "Cupom: SEMPREMODA");
assertNaoContem(msgCupomOcultoPersonalizado.mensagem, "Aplique o cupom SEMPREMODA");

const msgSemCupomSemFrase = gerarTemplateUniversal({
  titulo: "Caso F Sem Cupom",
  marketplace: "Amazon",
  precoAtual: 55.9,
  linkAfiliado: "https://amzn.to/sem-cupom"
});
assertNaoContem(msgSemCupomSemFrase, "Aplique o cupom");

const msgH = gerarTemplateUniversal({
  titulo: "Caso H Shopee links",
  marketplace: "Shopee",
  precoAtual: 100,
  linkAfiliado: "https://go.optimus/produto-principal",
  linksComerciais: linksFixture().slice(0, 3)
});
assertContem(msgH, "Resgatar cupom");
assertContem(msgH, "https://go.optimus/resgate");
assertContem(msgH, "Produto:");
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
assert.strictEqual(linksOcorrenciasDuplicadas.length, 8, "renderizacao nao altera quantidade de ocorrencias de link de entrada");
assert.ok(
  msgOcorrencias.indexOf("https://go.optimus/resgate-a") < msgOcorrencias.indexOf("https://go.optimus/produto-b"),
  "ordem semantica de Resgate antes de Produto permanece"
);

const ofertaComImagemIntocada = {
  titulo: "Imagem intocada",
  marketplace: "Mercado Livre",
  precoAtual: 55.9,
  imagem: "https://img.test/produto.webp",
  imagemCanonicaFinal: true,
  linkAfiliado: "https://go.optimus/imagem"
};
gerarTemplateUniversal(ofertaComImagemIntocada);
assert.strictEqual(ofertaComImagemIntocada.imagem, "https://img.test/produto.webp");
assert.strictEqual(ofertaComImagemIntocada.imagemCanonicaFinal, true);

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
assertContem(msgFraseReal, "Aplique o cupom PROMO10 para obter o valor.");
assertNaoContem(msgFraseReal, "Aplique o cupom de 10% no anuncio");

const msgBraeCupomPix = gerarTemplateUniversal({
  titulo: "Brae tratamento capilar",
  marketplace: "Mercado Livre",
  textoOriginal: "Cupom: FULLRESGATE0309\nAplique o cupom FULLRESGATE0309 + Pix para chegar neste valor.",
  precoAtual: 129.9,
  cupom: "FULLRESGATE0309",
  instrucaoCupom: "Aplique o cupom FULLRESGATE0309 + Pix para chegar neste valor.",
  linkAfiliado: "https://go.optimus/brae"
});
assert.strictEqual(contarOcorrencias(msgBraeCupomPix, "Aplique o cupom FULLRESGATE0309 + Pix para chegar neste valor."), 1);
assertNaoContem(msgBraeCupomPix, "Aplique o cupom FULLRESGATE0309 para obter o valor.");

const msgRtxSemInstrucaoRica = gerarTemplateUniversal({
  titulo: "RTX 4060 oferta",
  marketplace: "KaBuM",
  textoOriginal: "Cupom: ECONOMIZASEMPRE\nOferta por tempo limitado",
  precoAtual: 1899.9,
  cupom: "ECONOMIZASEMPRE",
  linkAfiliado: "https://go.optimus/rtx"
});
assertContem(msgRtxSemInstrucaoRica, "Aplique o cupom ECONOMIZASEMPRE para obter o valor.");

const msgCupomInformativo = gerarTemplateUniversal({
  titulo: "Cupom informativo",
  marketplace: "Amazon",
  textoOriginal: "Cupom: INFO10\nCupom INFO10 disponivel na pagina.",
  precoAtual: 99.9,
  cupom: "INFO10",
  instrucaoCupom: "Cupom INFO10 disponivel na pagina.",
  linkAfiliado: "https://go.optimus/info10"
});
assertContem(msgCupomInformativo, "Aplique o cupom INFO10 para obter o valor.");

const msgCupomResgateSimplesSemDemora = gerarTemplateUniversal({
  titulo: "ML cupom SEMDEMORA",
  marketplace: "Mercado Livre",
  textoOriginal: "Cupom: SEMDEMORA\nResgate o cupom: SEMDEMORA",
  precoAtual: 79.9,
  cupom: "SEMDEMORA",
  beneficioTexto: "Resgate o cupom: SEMDEMORA",
  linkAfiliado: "https://go.optimus/semdemora"
});
assertContem(msgCupomResgateSimplesSemDemora, "Cupom: *SEMDEMORA*");
assertContem(msgCupomResgateSimplesSemDemora, "Aplique o cupom SEMDEMORA para obter o valor.");
assertNaoContem(msgCupomResgateSimplesSemDemora, "🎁 Resgate o cupom: SEMDEMORA");

const msgCupomResgateSimplesPrecinhos = gerarTemplateUniversal({
  titulo: "ML cupom PRECINHOS",
  marketplace: "Mercado Livre",
  textoOriginal: "Cupom: PRECINHOS\nResgate o cupom: PRECINHOS",
  precoAtual: 129.9,
  cupom: "PRECINHOS",
  beneficioExtra: "Resgate o cupom: PRECINHOS",
  linkAfiliado: "https://go.optimus/precinhos"
});
assertContem(msgCupomResgateSimplesPrecinhos, "Cupom: *PRECINHOS*");
assertContem(msgCupomResgateSimplesPrecinhos, "Aplique o cupom PRECINHOS para obter o valor.");
assertNaoContem(msgCupomResgateSimplesPrecinhos, "🎁 Resgate o cupom: PRECINHOS");

const msgResgateNaPaginaPreservado = gerarTemplateUniversal({
  titulo: "Cupom com acao na pagina",
  marketplace: "Mercado Livre",
  precoAtual: 100,
  cupom: "CUPOMX",
  beneficioTexto: "Resgate o cupom CUPOMX na página antes de finalizar",
  linkAfiliado: "https://go.optimus/resgate-pagina"
});
assertContem(msgResgateNaPaginaPreservado, "Aplique o cupom CUPOMX para obter o valor.");
assertContem(msgResgateNaPaginaPreservado, "🎁 Resgate o cupom CUPOMX na página antes de finalizar");

const msgAtiveNoLinkPreservado = gerarTemplateUniversal({
  titulo: "Cupom com link",
  marketplace: "Shopee",
  precoAtual: 100,
  cupom: "CUPOMX",
  beneficioTexto: "Ative o cupom CUPOMX no link",
  linkAfiliado: "https://go.optimus/ative-link"
});
assertContem(msgAtiveNoLinkPreservado, "Aplique o cupom CUPOMX para obter o valor.");
assertContem(msgAtiveNoLinkPreservado, "🎁 Ative o cupom CUPOMX no link");

const msgCupomPixPreservado = gerarTemplateUniversal({
  titulo: "Cupom com Pix",
  marketplace: "Mercado Livre",
  precoAtual: 100,
  cupom: "CUPOMX",
  beneficioTexto: "Use o cupom CUPOMX + Pix",
  linkAfiliado: "https://go.optimus/cupom-pix"
});
assertContem(msgCupomPixPreservado, "Aplique o cupom CUPOMX para obter o valor.");
assertContem(msgCupomPixPreservado, "🎁 Use o cupom CUPOMX + Pix");

const msgBeneficiosRicosPreservados = gerarTemplateUniversal({
  titulo: "Cupom com beneficio real",
  marketplace: "AliExpress",
  precoAtual: 100,
  cupom: "CUPOMX",
  beneficioTexto: "Use o cupom CUPOMX + moedas",
  linkAfiliado: "https://go.optimus/moedas"
});
assertContem(msgBeneficiosRicosPreservados, "Aplique o cupom CUPOMX para obter o valor.");
assertContem(msgBeneficiosRicosPreservados, "🎁 Use o cupom CUPOMX + moedas");

const msgBeneficioAppFreteCashbackPreservado = gerarTemplateUniversal({
  titulo: "Cupom com app frete cashback",
  marketplace: "Amazon",
  precoAtual: 100,
  cupom: "CUPOMX",
  beneficioTexto: "Use o cupom CUPOMX no app para frete gratis e cashback",
  linkAfiliado: "https://go.optimus/app-frete-cashback"
});
assertContem(msgBeneficioAppFreteCashbackPreservado, "Aplique o cupom CUPOMX para obter o valor.");
assertContem(msgBeneficioAppFreteCashbackPreservado, "🎁 Use o cupom CUPOMX no app para frete gratis e cashback");

const msgSemCupomControle = gerarTemplateUniversal({
  titulo: "Oferta sem cupom",
  marketplace: "Shopee",
  precoAtual: 49.9,
  instrucaoCupom: "Aplique o cupom SEMCODIGO + Pix para chegar neste valor.",
  linkAfiliado: "https://go.optimus/sem-cupom"
});
assertNaoContem(msgSemCupomControle, "Aplique o cupom");

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

const msgRadarPrecoCupom = gerarTemplateUniversal({
  titulo: "Radar R$171 cupom",
  marketplace: "Mercado Livre",
  textoOriginal: "Radar R$171 cupom\nR$ 171\nCupom: GANHEI10\nhttps://meli.la/171",
  precoAtual: 999,
  cupom: "GANHEI10",
  beneficioTexto: "Desconto no app",
  condicoes: ["pagamento_pix", "Pode haver beneficio pelo app"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/171", urlAfiliada: "https://go.optimus/171" }
  ]
});
assertContem(msgRadarPrecoCupom, "Por: *R$ 171,00*");
assertContem(msgRadarPrecoCupom, "Cupom: *GANHEI10*");
assertContem(msgRadarPrecoCupom, "Aplique o cupom GANHEI10 para obter o valor.");
assertNaoContem(msgRadarPrecoCupom, "Desconto no app");
assertNaoContem(msgRadarPrecoCupom, "pagamento_pix");
assertNaoContem(msgRadarPrecoCupom, "Pode haver beneficio pelo app");

const msgRadarParcelamentoFrete = gerarTemplateUniversal({
  titulo: "Radar parcelamento frete",
  marketplace: "KaBuM",
  textoOriginal: "R$ 688 ou R$ 764 em 10x\nCupom: GANHEIMAIS\nFrete gratis\nhttps://kabum.test/oferta",
  precoAtual: 1111,
  parcelamento: "R$ 764 em 10x",
  cupom: "GANHEIMAIS",
  freteGratis: true,
  frete: "Frete gratis",
  condicoes: ["parcelamento externo 12x", "frete"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://kabum.test/oferta", urlAfiliada: "https://go.optimus/kabum-oferta" }
  ]
});
assertContem(msgRadarParcelamentoFrete, "Por: *R$ 688,00*");
assertContem(msgRadarParcelamentoFrete, "R$ 764 em 10x");
assertContem(msgRadarParcelamentoFrete, "Cupom: *GANHEIMAIS*");
assertContem(msgRadarParcelamentoFrete, "Frete gratis");
assertNaoContem(msgRadarParcelamentoFrete, "12x");
assert.strictEqual(contarOcorrencias(msgRadarParcelamentoFrete, "Frete gratis"), 1);

const msgRadarPixCupom = gerarTemplateUniversal({
  titulo: "Radar De Por Pix Cupom",
  marketplace: "Mercado Livre",
  textoOriginal: "De R$ 499,90 por R$ 202,44 no Pix\nCupom: GANHEI\nhttps://meli.la/pix-cupom",
  precoOriginal: 999,
  precoAtual: 888,
  precoPix: "Desconto no Pix R$ 499,90",
  cupom: "GANHEI",
  beneficioPix: "pagamento_pix",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/pix-cupom", urlAfiliada: "https://go.optimus/pix-cupom" }
  ]
});
assertContem(msgRadarPixCupom, "De: *R$ 499,90*");
assertContem(msgRadarPixCupom, "Por: *R$ 202,44 no Pix*");
assertContem(msgRadarPixCupom, "Cupom: *GANHEI*");
assertNaoContem(msgRadarPixCupom, "Pix:");
assertNaoContem(msgRadarPixCupom, "Desconto no Pix");
assertNaoContem(msgRadarPixCupom, "pagamento_pix");

const msgRadarPixSemCupom = gerarTemplateUniversal({
  titulo: "Radar Pix Sem Cupom",
  marketplace: "Mercado Livre",
  textoOriginal: "De R$ 345,54 por R$ 311 no PIX\nhttps://meli.la/sem-cupom-pix",
  precoOriginal: 345.54,
  precoAtual: 311,
  cupom: "NOVO",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/sem-cupom-pix", urlAfiliada: "https://go.optimus/sem-cupom-pix" }
  ]
});
assertContem(msgRadarPixSemCupom, "De: *R$ 345,54*");
assertContem(msgRadarPixSemCupom, "Por: *R$ 311,00 no Pix*");
assertNaoContem(msgRadarPixSemCupom, "Cupom:");

const msgSempreModa = gerarTemplateUniversal({
  titulo: "Radar SEMPREMODA",
  marketplace: "Mercado Livre",
  textoOriginal: "De R$ 129 por R$ 55\nCupom: SEMPREMODA\nhttps://meli.la/sempremoda",
  precoOriginal: 129,
  precoAtual: 55,
  cupom: "SEMPREMODA",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/sempremoda", urlAfiliada: "https://go.optimus/sempremoda" }
  ]
});
assertContem(msgSempreModa, "De: *R$ 129,00*");
assertContem(msgSempreModa, "Por: *R$ 55,00*");
assertContem(msgSempreModa, "Cupom: *SEMPREMODA*");
assertContem(msgSempreModa, "Aplique o cupom SEMPREMODA para obter o valor.");
assertNaoContem(msgSempreModa, "Pix");

const casoLupoPosDeploy = {
  titulo: "LUPO PRA VC PUXAR FERRO",
  marketplace: "Mercado Livre",
  textoOriginal: "LUPO PRA VC PUXAR FERRO\nDe R$ 88 por R$ 55\nCupom: SEMPREMODA\nhttps://meli.la/13Njt6R",
  textoComercialCanonico: "Pode haver cupom disponivel. Confira no carrinho/app do Mercado Livre.",
  precoOriginal: 88,
  precoAtual: 55,
  precoPix: "Desconto no Pix R$ 24",
  descontoPix: "Desconto no Pix R$ 24",
  cupom: "SEMPREMODA",
  avisoCupom: "Pode haver cupom disponivel. Confira no carrinho/app do Mercado Livre.",
  beneficioTexto: "Pode haver beneficio pelo app do Mercado Livre",
  beneficioExtra: "Desconto no Pix R$ 24",
  beneficios: [
    "Pode haver cupom disponivel. Confira no carrinho/app do Mercado Livre.",
    "Pode haver beneficio pelo app do Mercado Livre",
    "Desconto no Pix R$ 24"
  ],
  condicoes: ["pagamento_pix", "Pode haver beneficio pelo app"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/13Njt6R", urlAfiliada: "https://go.optimus/lupo" }
  ]
};
const contratoLupo = resolverContratoComercialFinal(casoLupoPosDeploy).contratoComercialFinal;
assert.strictEqual(contratoLupo.beneficio, "", "inferencia de cupom/app/pix nao entra no contrato final");
assert.strictEqual(contratoLupo.precoPixTexto, "", "Desconto no Pix externo nao entra no contrato final");
const msgLupoPosDeploy = gerarTemplateUniversal(casoLupoPosDeploy);
assertContem(msgLupoPosDeploy, "De: *R$ 88,00*");
assertContem(msgLupoPosDeploy, "Por: *R$ 55,00*");
assertContem(msgLupoPosDeploy, "Cupom: *SEMPREMODA*");
assertContem(msgLupoPosDeploy, "Aplique o cupom SEMPREMODA para obter o valor.");
assert.strictEqual(contarOcorrencias(msgLupoPosDeploy, "Aplique o cupom SEMPREMODA para obter o valor."), 1);
assertNaoContem(msgLupoPosDeploy, "Pode haver cupom");
assertNaoContem(msgLupoPosDeploy, "Confira no carrinho/app");
assertNaoContem(msgLupoPosDeploy, "Pode haver beneficio");
assertNaoContem(msgLupoPosDeploy, "Desconto no Pix");
assertNaoContem(msgLupoPosDeploy, "Pix:");

const personalizadoLupoPosDeploy = renderizarTemplatePersonalizado({
  oferta: casoLupoPosDeploy,
  template: {
    id: "lupo_sem_inferencia",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "preco_de", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "cupom", ativo: true, ordem: 30 },
      { tipo: "frase_cupom", ativo: true, ordem: 40 },
      { tipo: "beneficio", ativo: true, ordem: 50 },
      { tipo: "link", ativo: true, ordem: 60 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(personalizadoLupoPosDeploy.ok, true);
assertContem(personalizadoLupoPosDeploy.mensagem, "De: R$ 88,00");
assertContem(personalizadoLupoPosDeploy.mensagem, "Por: R$ 55,00");
assertContem(personalizadoLupoPosDeploy.mensagem, "Cupom: SEMPREMODA");
assertContem(personalizadoLupoPosDeploy.mensagem, "Aplique o cupom SEMPREMODA para obter o valor.");
assertNaoContem(personalizadoLupoPosDeploy.mensagem, "Pode haver cupom");
assertNaoContem(personalizadoLupoPosDeploy.mensagem, "Confira no carrinho/app");
assertNaoContem(personalizadoLupoPosDeploy.mensagem, "Pode haver beneficio");
assertNaoContem(personalizadoLupoPosDeploy.mensagem, "Desconto no Pix");

const msgGanheiMais = gerarTemplateUniversal({
  titulo: "Radar GANHEIMAIS",
  marketplace: "Mercado Livre",
  textoOriginal: "De R$ 899 por R$ 521\nCupom: GANHEIMAIS\nhttps://meli.la/ganheimais",
  precoOriginal: 899,
  precoAtual: 521,
  cupom: "GANHEIMAIS",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/ganheimais", urlAfiliada: "https://go.optimus/ganheimais" }
  ]
});
assertContem(msgGanheiMais, "De: *R$ 899,00*");
assertContem(msgGanheiMais, "Por: *R$ 521,00*");
assertContem(msgGanheiMais, "Cupom: *GANHEIMAIS*");
assertContem(msgGanheiMais, "Aplique o cupom GANHEIMAIS para obter o valor.");

const msgRadarVenceExterno = gerarTemplateUniversal({
  titulo: "Radar vence externo",
  marketplace: "Amazon",
  textoOriginal: "Produto fiel\nDe R$ 300 por R$ 200\nCupom: RADAR10\nhttps://amzn.to/radar",
  precoOriginal: 999,
  precoAtual: 888,
  precoPix: "R$ 777 no Pix",
  condicaoPix: "R$ 777 no Pix",
  parcelamento: "12x de R$ 99,90 sem juros",
  frete: "Frete gratis",
  freteGratis: true,
  beneficioTexto: "Desconto no app",
  beneficios: ["Desconto no Pix", "voucher_ou_moedas"],
  condicoes: ["pagamento_pix", "Pode haver beneficio pelo app"],
  cupom: "RADAR10",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://amzn.to/radar", urlAfiliada: "https://go.optimus/radar" }
  ]
});
assertContem(msgRadarVenceExterno, "De: *R$ 300,00*");
assertContem(msgRadarVenceExterno, "Por: *R$ 200,00*");
assertContem(msgRadarVenceExterno, "Cupom: *RADAR10*");
assertNaoContem(msgRadarVenceExterno, "R$ 888");
assertNaoContem(msgRadarVenceExterno, "Pix");
assertNaoContem(msgRadarVenceExterno, "12x");
assertNaoContem(msgRadarVenceExterno, "Frete gratis");
assertNaoContem(msgRadarVenceExterno, "Desconto no app");
assertNaoContem(msgRadarVenceExterno, "voucher_ou_moedas");
assert.strictEqual(contarOcorrencias(msgRadarVenceExterno, "https://go.optimus/radar"), 1);

const contratoCupomForteExterno = resolverContratoComercialFinal({
  titulo: "Radar sem cupom",
  marketplace: "Mercado Livre",
  textoOriginal: "Radar sem cupom\nPor R$ 171\nhttps://meli.la/semcupom",
  precoAtual: 171,
  cupom: "PROMO10",
  cupomCodigo: "PROMO10",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/semcupom", urlAfiliada: "https://go.optimus/semcupom" }
  ]
}).contratoComercialFinal;
assert.strictEqual(contratoCupomForteExterno.cupomCodigo, "", "cupom forte externo sem prova Radar nao vira fato comercial");
const msgCupomForteExterno = gerarTemplateUniversal({
  titulo: "Radar sem cupom",
  marketplace: "Mercado Livre",
  textoOriginal: "Radar sem cupom\nPor R$ 171\nhttps://meli.la/semcupom",
  precoAtual: 171,
  cupom: "PROMO10",
  cupomCodigo: "PROMO10",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/semcupom", urlAfiliada: "https://go.optimus/semcupom" }
  ]
});
assertContem(msgCupomForteExterno, "Por: *R$ 171,00*");
assertNaoContem(msgCupomForteExterno, "PROMO10");
assertNaoContem(msgCupomForteExterno, "Cupom:");

const msgOfcNaoPromoveComercial = montarMensagemOferta({
  titulo: "Radar limpo com OFC contaminado",
  marketplace: "mercadolivre",
  textoOriginal: "Radar limpo\nPor R$ 171\nhttps://meli.la/radar-limpo",
  precoAtual: 171,
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/radar-limpo", urlAfiliadaWorkspace: "https://go.optimus/radar-limpo" }
  ],
  metadata: {
    ofcV24: {
      espelhoComercial: {
        precoDeTexto: "R$ 999,00",
        precoPorTexto: "R$ 888,00",
        precoPixTexto: "R$ 777,00 no Pix",
        cupomCodigo: "OFC10",
        beneficioTexto: "Pode haver beneficio pelo app",
        linkAfiliado: "https://meli.la/ofc-produto",
        linkResgateOriginal: "https://meli.la/ofc-resgate",
        parcelamentoTexto: "10x de R$ 88,80",
        freteTexto: "Frete gratis"
      },
      documentoComercialCanonico: {
        tituloOriginal: "Titulo tecnico OFC",
        marketplace: "mercadolivre",
        categoria: "Categoria tecnica",
        precoDeTexto: "R$ 999,00",
        precoPorTexto: "R$ 888,00",
        precoPixTexto: "R$ 777,00 no Pix",
        cupomTexto: "OFC10",
        instrucaoTexto: "Aplique o cupom OFC10",
        linkAfiliado: "https://meli.la/ofc-produto",
        blocos: [
          { tipo: "preco_referencia", textoOriginal: "R$ 999,00" },
          { tipo: "preco_oferta", textoOriginal: "R$ 888,00" },
          { tipo: "preco_pix", textoOriginal: "R$ 777,00 no Pix" },
          { tipo: "cupom_codigo", textoOriginal: "OFC10" },
          { tipo: "parcelamento", textoOriginal: "10x de R$ 88,80" },
          { tipo: "frete", textoOriginal: "Frete gratis" },
          { tipo: "link_resgate", textoOriginal: "https://meli.la/ofc-resgate", valorEstruturado: { url: "https://meli.la/ofc-resgate" } }
        ]
      }
    }
  }
});
assertContem(msgOfcNaoPromoveComercial, "Por: *R$ 171,00*");
assertContem(msgOfcNaoPromoveComercial, "https://go.optimus/radar-limpo");
assert.strictEqual(contarOcorrencias(msgOfcNaoPromoveComercial, "https://go.optimus/radar-limpo"), 1);
assertNaoContem(msgOfcNaoPromoveComercial, "R$ 999");
assertNaoContem(msgOfcNaoPromoveComercial, "R$ 888");
assertNaoContem(msgOfcNaoPromoveComercial, "R$ 777");
assertNaoContem(msgOfcNaoPromoveComercial, "OFC10");
assertNaoContem(msgOfcNaoPromoveComercial, "10x de R$ 88,80");
assertNaoContem(msgOfcNaoPromoveComercial, "Frete gratis");
assertNaoContem(msgOfcNaoPromoveComercial, "https://meli.la/ofc-resgate");

const montarMensagemFallbackFalhando = montarMensagemComTemplateUniversalFalhando();
const msgFallbackSeguro = montarMensagemFallbackFalhando({
  titulo: "Fallback seguro",
  marketplace: "Amazon",
  textoOriginal: "Radar\nPor R$ 171\nhttps://amzn.to/radar",
  precoAtual: 171,
  linkAfiliado: "https://go.optimus/radar",
  mensagemFinal: "MENSAGEM LEGADA COM PROMO10 E PIX INVENTADO"
}, {
  destino: { templateId: "tpl_inexistente", canal: "whatsapp" },
  plano: { recursos: { templatePersonalizado: true } }
});
assert.strictEqual(msgFallbackSeguro, "Oferta recebida. Renderizacao oficial indisponivel no momento.");
assertNaoContem(msgFallbackSeguro, "MENSAGEM LEGADA");
assertNaoContem(msgFallbackSeguro, "PROMO10");
assertNaoContem(msgFallbackSeguro, "PIX INVENTADO");

const kabumLegadoSource = fs.readFileSync(path.join(__dirname, "../marketplaces/kabum/index.js"), "utf8").replace(/\r\n/g, "\n");
const indiceImportContratoKabum = kabumLegadoSource.indexOf('require("../../utils/mensagens-ofertas")');
const indiceGuardaLegadoKabum = kabumLegadoSource.indexOf("if (false) {\nconst titulo = oferta.nome");
const indiceMontagemManualKabum = kabumLegadoSource.indexOf("let mensagem =", indiceGuardaLegadoKabum);
const indiceContratoKabum = kabumLegadoSource.indexOf("mensagem = montarMensagemOferta(oferta", indiceMontagemManualKabum);
const indiceEnvioKabum = kabumLegadoSource.indexOf("await enviarParaDestinoInteligente", indiceContratoKabum);
assert.ok(indiceImportContratoKabum >= 0, "legado KaBuM deve importar o montador oficial");
assert.ok(indiceGuardaLegadoKabum >= 0, "montagem manual legada deve ficar fora da execucao operacional");
assert.ok(indiceMontagemManualKabum >= 0, "teste deve localizar a montagem legada para provar neutralizacao");
assert.ok(indiceContratoKabum > indiceMontagemManualKabum, "mensagem legada deve ser sobrescrita pelo contrato oficial");
assert.ok(indiceEnvioKabum > indiceContratoKabum, "envio legado deve ocorrer somente depois do contrato oficial");

console.log("contrato-comercial-final-universal.test.js OK");
