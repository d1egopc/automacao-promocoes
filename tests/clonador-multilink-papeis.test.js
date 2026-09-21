const assert = require("assert");

const {
  PAPEL_LINK,
  classificarLinkEngine,
  resumoLinksClassificados
} = require("../modules/engine/link-role.service");
const {
  extrairOcorrenciasLinksPosicionais,
  classificarOcorrenciaContextualClonador
} = require("../modules/clonador-grupos/service");

function classificarClonador(texto, indice = 0, marketplace = "") {
  const ocorrencia = extrairOcorrenciasLinksPosicionais(texto, "teste_multilink")[indice];
  return classificarOcorrenciaContextualClonador({ ...ocorrencia, textoOriginal: texto, marketplace });
}

function classificarEngine(marketplace, texto, url) {
  return classificarLinkEngine({
    marketplace,
    evento: { texto_original: texto, links_extraidos: [url] },
    url,
    link: { url_original: url }
  });
}

function testarRotulosNovos() {
  const aliApp = "https://a.aliexpress.com/_c3eQlEMx";
  const shopeeProduto = "https://s.shopee.com.br/6fhEQ5acAo";
  const shopeeResgate = "https://s.shopee.com.br/7Aa9TOkP8y";

  assert.strictEqual(classificarClonador(`Link APP\n${aliApp}`, 0, "aliexpress").papelContextual, "app");
  assert.strictEqual(classificarEngine("aliexpress", `Link APP\n${aliApp}`, aliApp).papelLink, PAPEL_LINK.LINK_APP);

  assert.strictEqual(classificarClonador(`Link Produto!\n${shopeeProduto}`, 0, "shopee").papelContextual, "produto");
  assert.strictEqual(classificarEngine("shopee", `Link Produto!\n${shopeeProduto}`, shopeeProduto).papelLink, PAPEL_LINK.PRODUTO);

  assert.strictEqual(classificarClonador(`Resgate o cupom de 20,00 OFF\n${shopeeResgate}`, 0, "shopee").papelContextual, "resgate");
  assert.strictEqual(classificarEngine("shopee", `Resgate o cupom de 20,00 OFF\n${shopeeResgate}`, shopeeResgate).papelLink, PAPEL_LINK.CUPOM);

  const linkResgate = "https://s.shopee.com.br/linkResgate";
  assert.strictEqual(classificarClonador(`Link de resgate\n${linkResgate}`, 0, "shopee").papelContextual, "resgate");
  assert.strictEqual(classificarEngine("shopee", `Link de resgate\n${linkResgate}`, linkResgate).papelLink, PAPEL_LINK.CUPOM);

  const pc = "https://a.aliexpress.com/_c3puyDp1";
  assert.strictEqual(classificarClonador(`pc\n${pc}`, 0, "aliexpress").papelContextual, "pc");

  const aliMoedas = "https://a.aliexpress.com/_c3moedas";
  assert.strictEqual(classificarClonador(`Link com moedas\n${aliMoedas}`, 0, "aliexpress").papelContextual, "app");
  assert.strictEqual(classificarEngine("aliexpress", `Link com moedas\n${aliMoedas}`, aliMoedas).papelLink, PAPEL_LINK.LINK_APP);
  assert.strictEqual(classificarClonador(`Link com moedas\n${aliMoedas}`, 0, "").papelContextual, "moedas");
  assert.strictEqual(classificarEngine("aliexpress", `pc\n${pc}`, pc).papelLink, PAPEL_LINK.LINK_PC);
}

function testarAmazonEstruturalELinktree() {
  const amazon = "https://www.amazon.com.br/dp/B0GZYB1Z9X?tag=workspace-20";
  const classificado = classificarEngine("amazon", amazon, amazon);
  assert.strictEqual(classificado.papelLink, PAPEL_LINK.PRODUTO);
  assert.strictEqual(classificado.confianca, "alta");
  assert.strictEqual(classificado.urlProduto, amazon);

  const linktree = "https://linktr.ee/iskandarsouza";
  const linktreeClassificado = classificarEngine("amazon", linktree, linktree);
  assert.strictEqual(linktreeClassificado.papelLink, PAPEL_LINK.DESCONHECIDO);
  assert.strictEqual(linktreeClassificado.urlProduto || "", "");

  const hostFalso = "https://amazon.com.br.evil.example/dp/B0GZYB1Z9X";
  assert.strictEqual(classificarEngine("amazon", hostFalso, hostFalso).papelLink, PAPEL_LINK.DESCONHECIDO);
}

function testarMultiplosLinksEOrdem() {
  const aliApp = "https://a.aliexpress.com/_appA";
  const aliPc = "https://a.aliexpress.com/_pcA";
  const shopeeProduto = "https://s.shopee.com.br/produtoA";
  const shopeeResgate = "https://s.shopee.com.br/resgateA";
  const texto = [
    `Link APP: ${aliApp}`,
    `Link PC: ${aliPc}`,
    `Link Produto!: ${shopeeProduto}`,
    `Resgate o cupom de 20,00 OFF: ${shopeeResgate}`
  ].join("\n");

  const aliLinks = [aliApp, aliPc].map(url => ({ url_original: url }));
  const ali = resumoLinksClassificados(aliLinks, { texto_original: texto }, "aliexpress");
  assert.deepStrictEqual(ali.map(item => item.papelLink), [PAPEL_LINK.LINK_APP, PAPEL_LINK.LINK_PC]);

  const shopeeLinks = [shopeeProduto, shopeeResgate].map(url => ({ url_original: url }));
  const shopee = resumoLinksClassificados(shopeeLinks, { texto_original: texto }, "shopee");
  assert.deepStrictEqual(shopee.map(item => item.papelLink), [PAPEL_LINK.PRODUTO, PAPEL_LINK.CUPOM]);

  const invertido = [shopeeResgate, shopeeProduto].map(url => ({ url_original: url }));
  const resultadoInvertido = resumoLinksClassificados(invertido, { texto_original: texto }, "shopee");
  const porUrl = new Map(shopee.map(item => [item.urlOriginal, item.papelLink]));
  for (const item of resultadoInvertido) assert.strictEqual(item.papelLink, porUrl.get(item.urlOriginal));

  assert.strictEqual(classificarClonador(`Produto com cupom\n${shopeeProduto}`, 0, "shopee").papelContextual, "desconhecido");
  assert.strictEqual(classificarEngine("shopee", `Sem rotulo\n${shopeeProduto}`, shopeeProduto).papelLink, PAPEL_LINK.DESCONHECIDO);
  assert.strictEqual(classificarClonador(`Sem rotulo\n${shopeeProduto}`, 0, "shopee").papelContextual, "desconhecido");
}

function testarContratosExistentesPreservados() {
  const ali = [
    ["Link APP", PAPEL_LINK.LINK_APP],
    ["Link PC", PAPEL_LINK.LINK_PC],
    ["Link com moedas", PAPEL_LINK.LINK_APP],
    ["Moedas", PAPEL_LINK.MOEDAS],
    ["Resgate o cupom", PAPEL_LINK.CUPOM]
  ];
  for (const [rotulo, esperado] of ali) {
    const url = `https://a.aliexpress.com/_${rotulo.replace(/[^a-z]+/gi, "").toLowerCase()}`;
    assert.strictEqual(classificarEngine("aliexpress", `${rotulo}\n${url}`, url).papelLink, esperado, rotulo);
  }

  const produto = "https://s.shopee.com.br/produtoEstrutural";
  const resgate = "https://s.shopee.com.br/resgateContextual";
  assert.strictEqual(classificarEngine("shopee", `Link Produto\n${produto}`, produto).papelLink, PAPEL_LINK.PRODUTO);
  assert.strictEqual(classificarEngine("shopee", `Resgate o cupom\n${resgate}`, resgate).papelLink, PAPEL_LINK.CUPOM);

  const candidato = {
    url_original: produto,
    precoAtual: 82.73,
    precoAnterior: 99.9,
    cupom: "FUTMELI10",
    origemFluxo: "clonador_grupos",
    linkAfiliado: "https://go.optimus/workspace"
  };
  const antes = JSON.parse(JSON.stringify(candidato));
  classificarLinkEngine({ marketplace: "shopee", evento: { texto_original: `Link Produto\n${produto}` }, link: candidato, url: produto });
  assert.deepStrictEqual(candidato, antes, "classificação não pode alterar verdade comercial, origem ou afiliação");
}

testarRotulosNovos();
testarAmazonEstruturalELinktree();
testarMultiplosLinksEOrdem();
testarContratosExistentesPreservados();
console.log("clonador-multilink-papeis.test.js OK");
