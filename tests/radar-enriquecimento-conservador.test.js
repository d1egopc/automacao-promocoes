const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadComAxiosMock(request, parent, isMain) {
  if (request === "axios") return { get: async () => ({ status: 204, data: "" }) };
  return originalLoad.call(this, request, parent, isMain);
};

const {
  analisarBeneficiosMensagemRadar,
  extrairCuponsMultiplosRadar,
  extrairLinksRadar,
  limparUnicodeInvisivelRadar
} = require("../utils/radar-cupom-mensagem");

const {
  detectarMarketplaceRedirect,
  diagnosticarAwinKabum,
  extrairProdutoIdKabum
} = require("../modules/radar/redirect/redirect-resolver");

function assertDeepEqual(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
}

function testarRegressoesLinks() {
  assertDeepEqual(
    extrairLinksRadar("Oferta ML https://www.mercadolivre.com.br/produto/teste"),
    ["https://www.mercadolivre.com.br/produto/teste"],
    "Mercado Livre simples deve continuar igual"
  );

  assertDeepEqual(
    extrairLinksRadar("Oferta Shopee https://shopee.com.br/produto-i.123.456"),
    ["https://shopee.com.br/produto-i.123.456"],
    "Shopee simples deve continuar igual"
  );

  assertDeepEqual(
    extrairLinksRadar("Oferta Amazon https://www.amazon.com.br/dp/B000TESTE"),
    ["https://www.amazon.com.br/dp/B000TESTE"],
    "Amazon simples deve continuar igual"
  );

  assertDeepEqual(
    extrairLinksRadar("AliExpress https://www.aliexpress.com/item/100500.html"),
    ["https://www.aliexpress.com/item/100500.html"],
    "AliExpress com um link deve ser extraido"
  );

  assertDeepEqual(extrairLinksRadar("Mensagem sem link"), [], "Mensagem sem link deve retornar lista vazia");

  assertDeepEqual(
    extrairLinksRadar("🔥 https://a.aliexpress.com/_mTeste"),
    ["https://a.aliexpress.com/_mTeste"],
    "Emoji antes do link nao deve impedir extracao"
  );
}

function testarAliExpressLinks() {
  const links = extrairLinksRadar([
    "Link com moedas https://a.aliexpress.com/_mApp",
    "NO PC https://s.click.aliexpress.com/e/_DmPc"
  ].join("\n"));

  assertDeepEqual(
    links,
    ["https://a.aliexpress.com/_mApp", "https://s.click.aliexpress.com/e/_DmPc"],
    "Links app e PC do AliExpress devem ser reconhecidos"
  );

  assert.strictEqual(detectarMarketplaceRedirect("https://a.aliexpress.com/_mApp"), "aliexpress");
  assert.strictEqual(detectarMarketplaceRedirect("https://s.click.aliexpress.com/e/_DmPc"), "aliexpress");
}

function testarLimpezaEDeduplicacao() {
  const texto = "🔥\u200Bhttps://a.aliexpress.com/_mApp\u00A0\n🔥 https://a.aliexpress.com/_mApp";
  assert.strictEqual(limparUnicodeInvisivelRadar("a\u200Bb\u00A0c"), "ab c");
  assertDeepEqual(
    extrairLinksRadar(texto),
    ["https://a.aliexpress.com/_mApp"],
    "Link repetido deve ser deduplicado apos limpeza segura"
  );
}

function testarCuponsETexto() {
  const combinados = extrairCuponsMultiplosRadar("Cupons: TOP10 + OFF20, CASA30 e MODA40");
  assertDeepEqual(combinados.cupons, ["TOP10", "OFF20", "CASA30", "MODA40"]);
  assert.strictEqual(combinados.modoCupom, "combinado");

  const alternativos = extrairCuponsMultiplosRadar("Cupom: TOP10 ou OFF20");
  assertDeepEqual(alternativos.cupons, ["TOP10", "OFF20"]);
  assert.strictEqual(alternativos.modoCupom, "alternativo");

  const beneficios = analisarBeneficiosMensagemRadar(
    "Use o app com 120 moedas. Estoque no Brasil. Frete gratis por estado.",
    []
  );

  assert.strictEqual(beneficios.exigeApp, true);
  assert.strictEqual(beneficios.exigeMoedas, true);
  assert.strictEqual(beneficios.quantidadeMoedas, 120);
  assert.strictEqual(beneficios.estoqueBrasil, true);
  assert.strictEqual(beneficios.freteInformado, true);
}

function testarSelecaoSemanticaShopee() {
  const linkCupom = "https://s.shopee.com.br/9zuqGaAvwi";
  const linkProduto = "https://s.shopee.com.br/1VxQIcIvJj";
  const outroProduto = "https://s.shopee.com.br/2AbProduto";

  const produtoMaisCupom = [
    "Produto:",
    linkProduto,
    "Cupom:",
    "Resgate o cupom de 100 OFF",
    linkCupom
  ].join("\n");
  const beneficiosProdutoMaisCupom = analisarBeneficiosMensagemRadar(
    produtoMaisCupom,
    extrairLinksRadar(produtoMaisCupom)
  );
  assert.deepStrictEqual(beneficiosProdutoMaisCupom.linksResgate, [linkCupom], "produto + cupom marca apenas o link de resgate");
  assert.strictEqual(beneficiosProdutoMaisCupom.linkResgateCupom, linkCupom, "link de resgate fica disponivel como beneficio");
  assert.ok(/100 OFF/i.test(beneficiosProdutoMaisCupom.beneficioExtra), "texto do resgate enriquece a oferta");
  assert.ok(!beneficiosProdutoMaisCupom.linksResgate.includes(linkProduto), "produto nao e marcado como resgate");

  const cupomMaisProduto = [
    "Cupom:",
    "Pegue o cupom exclusivo de 100 OFF",
    linkCupom,
    "Produto:",
    linkProduto
  ].join("\n");
  const beneficiosCupomMaisProduto = analisarBeneficiosMensagemRadar(
    cupomMaisProduto,
    extrairLinksRadar(cupomMaisProduto)
  );
  assert.deepStrictEqual(beneficiosCupomMaisProduto.linksResgate, [linkCupom], "cupom + produto preserva produto para importacao");
  assert.ok(/cupom exclusivo/i.test(beneficiosCupomMaisProduto.beneficioExtra));

  const apenasProduto = `Oferta do dia\n${linkProduto}`;
  assert.deepStrictEqual(
    analisarBeneficiosMensagemRadar(apenasProduto, extrairLinksRadar(apenasProduto)).linksResgate,
    [],
    "apenas produto Shopee continua sem resgate"
  );

  const apenasCupom = `Resgate o cupom de 100 OFF\n${linkCupom}`;
  assert.deepStrictEqual(
    analisarBeneficiosMensagemRadar(apenasCupom, extrairLinksRadar(apenasCupom)).linksResgate,
    [],
    "apenas cupom Shopee preserva comportamento anterior"
  );

  const doisProdutos = [
    "Produto 1:",
    linkProduto,
    "Produto 2:",
    outroProduto
  ].join("\n");
  assert.deepStrictEqual(
    analisarBeneficiosMensagemRadar(doisProdutos, extrairLinksRadar(doisProdutos)).linksResgate,
    [],
    "dois produtos Shopee nao sao tratados como cupom"
  );

  const voucherMaisProduto = [
    "Voucher disponivel",
    "Aplicar cupom no app",
    linkCupom,
    "Oferta:",
    linkProduto
  ].join("\n");
  const beneficiosVoucher = analisarBeneficiosMensagemRadar(voucherMaisProduto, extrairLinksRadar(voucherMaisProduto));
  assert.deepStrictEqual(beneficiosVoucher.linksResgate, [linkCupom], "voucher Shopee + produto Shopee identifica resgate");

  const outrosMarketplaces = [
    "Cupom:",
    "Resgate o cupom de 100 OFF",
    "https://www.mercadolivre.com.br/produto/teste",
    "Produto:",
    "https://www.amazon.com.br/dp/B000TESTE",
    "https://www.aliexpress.com/item/100500.html",
    "https://www.kabum.com.br/produto/123456/produto-teste"
  ].join("\n");
  assert.deepStrictEqual(
    analisarBeneficiosMensagemRadar(outrosMarketplaces, extrairLinksRadar(outrosMarketplaces)).linksResgate,
    [],
    "semantica Shopee nao altera demais marketplaces"
  );
}

function testarAwinKabum() {
  const destino = encodeURIComponent("https://www.kabum.com.br/produto/123456/produto-teste");
  const awin1 = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=999&clickref=abc&ued=${destino}`;
  const awin2 = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=111&clickref=xyz&ued=${destino}`;
  const diag1 = diagnosticarAwinKabum(awin1);
  const diag2 = diagnosticarAwinKabum(awin2);

  assert.strictEqual(extrairProdutoIdKabum("https://www.kabum.com.br/produto/123456/produto-teste"), "123456");
  assert.strictEqual(diag1.produtoId, "123456");
  assert.strictEqual(diag1.chaveCanonica, "kabum:123456");
  assert.strictEqual(diag2.chaveCanonica, "kabum:123456");
  assert.strictEqual(detectarMarketplaceRedirect(awin1), "awin");
}

testarRegressoesLinks();
testarAliExpressLinks();
testarLimpezaEDeduplicacao();
testarCuponsETexto();
testarSelecaoSemanticaShopee();
testarAwinKabum();

console.log("radar-enriquecimento-conservador: ok");
