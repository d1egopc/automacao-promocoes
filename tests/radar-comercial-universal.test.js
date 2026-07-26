const assert = require("assert");

const radarCupomMensagem = require("../utils/radar-cupom-mensagem");
const {
  extrairComercialUniversal,
  classificarLinksComerciais
} = require("../modules/radar/extrator-comercial-universal");
const {
  extrairEvidenciasRadarLocal,
  resumirExtratorComercialParaLog
} = require("../modules/radar/extrator-local");

function extrair(textoOriginal, extra = {}) {
  return extrairComercialUniversal({
    textoOriginal,
    links: extra.links || [],
    marketplaceDetectado: extra.marketplaceDetectado || ""
  });
}

function extrairLocal(textoOriginal, extra = {}) {
  return extrairEvidenciasRadarLocal({
    textoOriginal,
    links: extra.links || [],
    marketplaceDetectado: extra.marketplaceDetectado || "",
    origemTipo: "whatsapp",
    grupoId: "grupo_teste",
    grupoNome: "Grupo Teste",
    capturadaEm: "2026-07-25T12:00:00.000Z",
    metadadosMidia: extra.metadadosMidia || null
  }, { radarCupomMensagem });
}

function assertCampo(resultado, caminho, esperado, mensagem) {
  const partes = caminho.split(".");
  let atual = resultado;
  for (const parte of partes) atual = atual?.[parte];
  assert.strictEqual(atual, esperado, mensagem || caminho);
}

function testarMercadoLivreCompleto() {
  const texto = `🔥 Air Fryer Mondial 4L
De: R$ 399,90
Por: R$ 299,90 no Pix
Cupom: CASA10
Frete grátis
Loja Oficial
★★★★☆ 4.8 - 120 vendidos
https://www.mercadolivre.com.br/p/MLB123456
https://cupom.exemplo/resgate-casa10`;
  const resultado = extrair(texto, { marketplaceDetectado: "mercadolivre" });
  assertCampo(resultado, "precoAtual.valor", 299.9);
  assertCampo(resultado, "precoAntigo.valor", 399.9);
  assertCampo(resultado, "precoPix.valor", 299.9);
  assertCampo(resultado, "cupom.codigo", "CASA10");
  assertCampo(resultado, "freteGratis.valor", true);
  assertCampo(resultado, "seloOficial.valor", true);
  assertCampo(resultado, "quantidadeVendida.valor", 120);
  assertCampo(resultado, "marketplace.valor", "mercadolivre");
  assert.strictEqual(resultado.links.produto, "https://www.mercadolivre.com.br/p/MLB123456");
  assert.strictEqual(resultado.links.resgate, "https://cupom.exemplo/resgate-casa10");
}

function testarShopeeMoedasMall() {
  const texto = `🏷️ Fone Bluetooth
Sai por R$ 87,35 no app
Use o cupom TECH15
Ganhe 350 moedas Shopee
Shopee Mall
10x sem juros
https://s.shopee.com.br/abc123`;
  const resultado = extrair(texto);
  assertCampo(resultado, "precoAtual.valor", 87.35);
  assertCampo(resultado, "cupom.codigo", "TECH15");
  assertCampo(resultado, "moedasShopee.valor", 350);
  assertCampo(resultado, "seloOficial.valor", true);
  assert.ok(resultado.condicoesEspeciais.includes("app"));
  assert.strictEqual(resultado.links.encurtadores.length, 1);
}

function testarAmazonPrimeParcelado() {
  const texto = `Amazon Prime ⚡
Smart TV 50 polegadas
Antes R$ 2.999,90
Agora R$ 2.399,99
12x de R$ 199,99 sem juros
Entrega Prime
⭐ 4,7/5
https://www.amazon.com.br/dp/B0TESTE123`;
  const resultado = extrair(texto);
  assertCampo(resultado, "precoAtual.valor", 2399.99);
  assertCampo(resultado, "precoAntigo.valor", 2999.9);
  assertCampo(resultado, "parcelamento.quantidade", 12);
  assertCampo(resultado, "parcelamento.valorParcela", 199.99);
  assertCampo(resultado, "parcelamento.semJuros", true);
  assertCampo(resultado, "freteGratis.valor", true);
  assertCampo(resultado, "marketplace.valor", "amazon");
  assert.strictEqual(resultado.avaliacao.valor, 4.7);
}

function testarAliExpressOffAffiliate() {
  const texto = `AliExpress Choice
Mini Projetor HY300
Apenas R$ 189,90
23% OFF
Cashback 5%
https://s.click.aliexpress.com/e/_abc123
https://pt.aliexpress.com/item/1005001234567890.html`;
  const resultado = extrair(texto);
  assertCampo(resultado, "precoAtual.valor", 189.9);
  assertCampo(resultado, "descontoPercentual.valor", 23);
  assertCampo(resultado, "cashback.valor", "5%");
  assertCampo(resultado, "marketplace.valor", "aliexpress");
  assert.strictEqual(resultado.links.afiliados.length, 1);
  assert.strictEqual(resultado.links.produto, "https://pt.aliexpress.com/item/1005001234567890.html");
}

function testarKabumPixBoletoCartao() {
  const texto = `KaBuM oferta relâmpago
Water Cooler RGB
R$ 199,99 no Pix
Boleto R$ 209,99
Cartão R$ 229,99
10x de R$ 22,99 sem juros
Últimas 12 unidades
https://www.kabum.com.br/produto/921292/water-cooler`;
  const resultado = extrair(texto);
  assertCampo(resultado, "precoAtual.valor", 199.99);
  assertCampo(resultado, "precoPix.valor", 199.99);
  assertCampo(resultado, "precoBoleto.valor", 209.99);
  assertCampo(resultado, "precoCartao.valor", 229.99);
  assertCampo(resultado, "parcelamento.quantidade", 10);
  assertCampo(resultado, "estoque.valor", 12);
  assertCampo(resultado, "marketplace.valor", "kabum");
}

function testarMagaluSemAcentos() {
  const texto = `Magalu
Tenis esportivo
Frete Gratis
Aplicar cupom MAGALU20
Economize R$ 40
Fica por R$ 159,90
https://www.magazineluiza.com.br/produto/teste/p/abc123/`;
  const resultado = extrair(texto);
  assertCampo(resultado, "precoAtual.valor", 159.9);
  assertCampo(resultado, "cupom.codigo", "MAGALU20");
  assertCampo(resultado, "valorEconomia.valor", 40);
  assertCampo(resultado, "freteGratis.valor", true);
  assertCampo(resultado, "marketplace.valor", "magalu");
}

function testarMensagensCurtasEEmojis() {
  const resultado = extrair(`💰 Apenas R$ 17,99 🔥
Use PROMO5
https://amzn.to/teste`);
  assertCampo(resultado, "precoAtual.valor", 17.99);
  assertCampo(resultado, "cupom.codigo", "PROMO5");
  assert.strictEqual(resultado.links.encurtadores.length, 1);
}

function testarVariosPrecosComMarcadores() {
  const resultado = extrair(`Produto Multi Oferta
De R$ 999,90
Por R$ 799,90
No Pix R$ 749,90
Cartão R$ 829,90
Cupom de R$ 50 acima de R$ 700`);
  assertCampo(resultado, "precoAtual.valor", 799.9);
  assertCampo(resultado, "precoPix.valor", 749.9);
  assertCampo(resultado, "precoCartao.valor", 829.9);
  assertCampo(resultado, "cupom.valor", 50);
}

function testarCupomInstrucaoResgate() {
  const resultado = extrair(`Produto com cupom
Resgate o cupom da página e utilize o cupom BLACK25 no carrinho
Desconto 25%
R$ 120,00`);
  assertCampo(resultado, "cupom.codigo", "BLACK25");
  assert.ok(resultado.cupom.instrucao.toLowerCase().includes("resgate"));
  assertCampo(resultado, "descontoPercentual.valor", 25);
}

function testarLinksClassificados() {
  const links = [
    "https://www.amazon.com.br/dp/B0TESTE123",
    "https://cupom.exemplo/resgate",
    "https://loja.exemplo/ofertas-do-dia",
    "https://bit.ly/abc",
    "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F1"
  ];
  const resultado = classificarLinksComerciais("Produto", links);
  assert.strictEqual(resultado.produto, links[0]);
  assert.strictEqual(resultado.resgate, links[1]);
  assert.deepStrictEqual(resultado.landing, [links[2]]);
  assert.deepStrictEqual(resultado.encurtadores, [links[3]]);
  assert.deepStrictEqual(resultado.afiliados, [links[4]]);
}

function testarFachadaLocalPreenchePrecoECupom() {
  const local = extrairLocal(`⚡ Sai por 87,35 no Pix
Utilize o cupom TECH15
https://s.shopee.com.br/abc`, {
    links: ["https://s.shopee.com.br/abc"]
  });
  assertCampo(local, "precoAtual.valor", 87.35);
  assertCampo(local, "cupom.codigo", "TECH15");
  assert.ok(local.comercial.camposEncontrados.includes("precoAtual"));
  assert.ok(local.comercial.tiposReconhecidos.includes("cupom"));
}

function testarResumoLogSanitizado() {
  const local = extrairLocal(`Produto secreto
Cupom: LOG10
Por R$ 99,90
https://www.mercadolivre.com.br/p/MLB1`);
  const resumo = resumirExtratorComercialParaLog(local.comercial, 3);
  assert.strictEqual(resumo.versao, "radar_comercial_universal_v1");
  assert.ok(Array.isArray(resumo.camposEncontrados));
  assert.ok(!JSON.stringify(resumo).includes("Produto secreto"));
  assert.strictEqual(resumo.duracaoMs, 3);
}

function testarCamposAusentes() {
  const resultado = extrair("Mensagem sem oferta clara");
  assert.strictEqual(resultado.precoAtual.valor, null);
  assert.strictEqual(resultado.cupom.codigo, null);
  assert.ok(resultado.camposAusentes.includes("precoAtual"));
}

testarMercadoLivreCompleto();
testarShopeeMoedasMall();
testarAmazonPrimeParcelado();
testarAliExpressOffAffiliate();
testarKabumPixBoletoCartao();
testarMagaluSemAcentos();
testarMensagensCurtasEEmojis();
testarVariosPrecosComMarcadores();
testarCupomInstrucaoResgate();
testarLinksClassificados();
testarFachadaLocalPreenchePrecoECupom();
testarResumoLogSanitizado();
testarCamposAusentes();

console.log("radar-comercial-universal.test.js OK");
