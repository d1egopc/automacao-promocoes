const assert = require("assert");

const { extrairComercialUniversal } = require("../modules/radar/extrator-comercial-universal");
const { resolverPrecoSemantico, TIPOS_CANDIDATO } = require("../modules/radar/preco-semantico");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");
const { resolverPrecedenciaComercialRadar } = require("../modules/radar/comercial-precedencia");

function extrair(texto, extras = {}) {
  return extrairComercialUniversal({ textoOriginal: texto, links: extras.links || [], marketplaceDetectado: extras.marketplaceDetectado || "" });
}

function assertValor(campo, valor, msg) {
  assert.strictEqual(campo?.valor ?? null, valor, msg);
}

function assertTipo(texto, valor, tipo, msg) {
  const candidato = resolverPrecoSemantico(texto).candidatos.find(item => item.valor === valor);
  assert.ok(candidato, `candidato ${valor} ausente: ${msg}`);
  assert.strictEqual(candidato.tipoCandidato, tipo, msg);
  return candidato;
}

function testarPorComCifrao() {
  const r = extrair("Produto top Por R$ 59,90");
  assertValor(r.precoAtual, 59.9, "Por R$ 59,90");
  assert.strictEqual(r.precoAtual.confianca, "alta");
}

function testarAgoraSemCifrao() {
  const r = extrair("Agora 59,90 somente hoje");
  assertValor(r.precoAtual, 59.9, "Agora sem R$");
  assert.strictEqual(r.precoAtual.confianca, "alta");
}

function testarPercentualMaisPreco() {
  const r = extrair("5% OFF - por R$ 239,90");
  assertValor(r.precoAtual, 239.9, "percentual nao vira preco");
  assert.strictEqual(r.descontoPercentual.valor, 5);
  assertTipo("5% OFF - por R$ 239,90", 5, TIPOS_CANDIDATO.PERCENTUAL, "5% classificado");
}

function testarParcelaSemTotal() {
  const r = extrair("12x de R$ 29,90 sem juros");
  assert.strictEqual(r.precoAtual.valor, null);
  assertValor(r.precoParcelado, 29.9, "parcela preservada");
  assert.strictEqual(r.parcelamento.quantidade, 12);
}

function testarParcelaComTotal() {
  const r = extrair("12x de R$ 29,90 sem juros Total R$ 358,80");
  assertValor(r.precoAtual, 358.8, "total vira preco");
  assertValor(r.precoParcelado, 29.9, "parcela preservada com total");
}

function testarCupomValorSeparado() {
  const r = extrair("Cupom de R$ 20 - produto R$ 89,90");
  assertValor(r.valorCupom, 20, "valor cupom separado");
  assertValor(r.precoAtual, 89.9, "produto vira preco");
}

function testarEconomiaSeparada() {
  const r = extrair("Economize R$ 40 - agora R$ 159,90");
  assertValor(r.valorEconomia, 40, "economia separada");
  assertValor(r.precoAtual, 159.9, "agora vira preco");
}

function testarVendidosNaoPreco() {
  const r = extrair("1.331 vendidos - R$ 18,99");
  assertValor(r.precoAtual, 18.99, "vendidos nao vira preco");
  assertTipo("1.331 vendidos - R$ 18,99", 1331, TIPOS_CANDIDATO.QUANTIDADE, "vendidos quantidade");
}

function testarAvaliacoesNaoPreco() {
  const r = extrair("503 avaliações - R$ 6,69");
  assertValor(r.precoAtual, 6.69, "avaliacoes nao vira preco");
  assertTipo("503 avaliações - R$ 6,69", 503, TIPOS_CANDIDATO.QUANTIDADE, "avaliacoes quantidade");
}

function testarModeloNaoPreco() {
  const r = extrair("modelo 1949 - R$ 23,30");
  assertValor(r.precoAtual, 23.3, "modelo nao vira preco");
  assertTipo("modelo 1949 - R$ 23,30", 1949, TIPOS_CANDIDATO.IDENTIFICADOR, "modelo id");
}

function testarDePor() {
  const r = extrair("De R$ 199,90 por R$ 129,90");
  assertValor(r.precoAntigo, 199.9, "preco antigo");
  assertValor(r.precoAtual, 129.9, "preco atual");
}

function testarBasePix() {
  const r = extrair("R$ 199,90 ou R$ 179,90 no Pix");
  assertValor(r.precoPix, 179.9, "pix preservado");
  assertValor(r.precoAtual, 179.9, "pix escolhido pela politica atual");
}

function testarPrecoUnicoComCifrao() {
  const r = extrair("Oferta relampago R$ 77,77");
  assertValor(r.precoAtual, 77.77, "unico com cifrao");
  assert.strictEqual(r.precoAtual.confianca, "media");
}

function testarVariosSemMarcador() {
  const r = extrair("Produto 1331 503 1949");
  assert.strictEqual(r.precoAtual.valor, null);
  assert.ok(r.resolucaoPreco.candidatosRejeitadosPorTipo.desconhecido >= 1);
}

function testarFreteSeparado() {
  const r = extrair("Produto R$ 89,90 frete R$ 12,90");
  assertValor(r.precoAtual, 89.9, "produto preservado");
  assertValor(r.frete, 12.9, "frete separado");
}

function testarCashbackSeparado() {
  const r = extrair("Produto R$ 499,90 cashback R$ 50");
  assertValor(r.precoAtual, 499.9, "produto preservado cashback");
  assertValor(r.cashbackValor, 50, "cashback separado");
}

function testarMercadoLivreCupom() {
  const r = extrair("Mercado Livre Cupom ML20 Produto por R$ 239,90", { marketplaceDetectado: "mercadolivre" });
  assertValor(r.precoAtual, 239.9, "ml preco");
  assert.strictEqual(r.marketplace.valor, "mercadolivre");
}

function testarShopeeDoisLinks() {
  const r = extrair("Shopee Mall Sai por R$ 55,90 Use CUPOM10 https://s.shopee.com.br/a https://cupom.exemplo/resgate", { marketplaceDetectado: "shopee" });
  assertValor(r.precoAtual, 55.9, "shopee preco");
  assert.strictEqual(r.links.encontrados.length, 2);
}

function testarKabumCupom() {
  const r = extrair("KaBuM Water Cooler Com cupom fica R$ 199,99");
  assertValor(r.precoAtual, 199.99, "kabum com cupom");
}

function testarAmazonPix() {
  const r = extrair("Amazon Fire TV R$ 299,90 no Pix Entrega Prime", { marketplaceDetectado: "amazon" });
  assertValor(r.precoPix, 299.9, "amazon pix");
}

function testarAliExpressMoedasCupom() {
  const r = extrair("AliExpress Ganhe 300 moedas Cupom ALI10 Agora R$ 44,90", { marketplaceDetectado: "aliexpress" });
  assertValor(r.precoAtual, 44.9, "ali preco");
  assert.strictEqual(r.moedasShopee.valor, 300);
}

function testarSemPreco() {
  const r = extrair("Oferta muito boa confira no link");
  assert.strictEqual(r.precoAtual.valor, null);
  assert.strictEqual(r.resolucaoPreco.quantidadeCandidatosPreco, 0);
}

function testarPrecoBaixoReal() {
  const r = extrair("Produto simples Por R$ 5,00");
  assertValor(r.precoAtual, 5, "preco baixo real");
  assert.strictEqual(r.precoAtual.confianca, "alta");
}

function testar1331SemContexto() {
  const r = extrair("Super oferta 1331 somente hoje");
  assert.strictEqual(r.precoAtual.valor, null);
}

function testar1331MonetarioValido() {
  const r = extrair("Oferta premium R$ 1.331,00");
  assertValor(r.precoAtual, 1331, "monetario valido");
}

function testarManualSemRadar() {
  const resultado = resolverPrecedenciaComercialRadar({ ofertaImportador: { preco: 10, origem: "manual" }, metadata: {} });
  assert.strictEqual(resultado.aplicavel, false);
}

function testarRadarMirrorFielPadrao() {
  const comercial = extrair("Por R$ 59,90");
  const mirror = criarRadarMirror({ textoOriginal: "Por R$ 59,90", links: [], extracaoRadarLocal: { precoAtual: comercial.precoAtual, comercial }, marketplace: "amazon" });
  const resultado = resolverPrecedenciaComercialRadar({ ofertaImportador: { preco: 99.9, precoAtual: 99.9, marketplace: "amazon", metadata: {} }, radarMirror: mirror, metadata: {} });
  assert.strictEqual(resultado.modo, "radar_mirror_fiel");
  assert.strictEqual(resultado.oferta.preco, 59.9);
  assert.strictEqual(resultado.metadata.precedenciaComercial.precoPublicacao, 59.9);
}

function testarMetadataPrecedencia() {
  const comercial = extrair("1.331 vendidos - R$ 18,99");
  const mirror = criarRadarMirror({ textoOriginal: "1.331 vendidos - R$ 18,99", links: [], extracaoRadarLocal: { precoAtual: comercial.precoAtual, comercial }, marketplace: "mercadolivre" });
  const resultado = resolverPrecedenciaComercialRadar({ ofertaImportador: { preco: 20, precoAtual: 20, marketplace: "mercadolivre", metadata: {} }, radarMirror: mirror, metadata: {} });
  assert.strictEqual(resultado.metadata.precedenciaComercial.quantidadeCandidatosPreco >= 2, true);
  assert.strictEqual(resultado.metadata.precedenciaComercial.tipoCandidatoEscolhido, "preco_atual");
}

const testes = [
  testarPorComCifrao,
  testarAgoraSemCifrao,
  testarPercentualMaisPreco,
  testarParcelaSemTotal,
  testarParcelaComTotal,
  testarCupomValorSeparado,
  testarEconomiaSeparada,
  testarVendidosNaoPreco,
  testarAvaliacoesNaoPreco,
  testarModeloNaoPreco,
  testarDePor,
  testarBasePix,
  testarPrecoUnicoComCifrao,
  testarVariosSemMarcador,
  testarFreteSeparado,
  testarCashbackSeparado,
  testarMercadoLivreCupom,
  testarShopeeDoisLinks,
  testarKabumCupom,
  testarAmazonPix,
  testarAliExpressMoedasCupom,
  testarSemPreco,
  testarPrecoBaixoReal,
  testar1331SemContexto,
  testar1331MonetarioValido,
  testarManualSemRadar,
  testarRadarMirrorFielPadrao,
  testarMetadataPrecedencia
];

for (const teste of testes) teste();
console.log(`radar-preco-semantico: ${testes.length} cenarios ok`);
