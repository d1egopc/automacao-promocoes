const assert = require("assert");

const { extrairComercialUniversal } = require("../modules/radar/extrator-comercial-universal");
const { resolverPrecoSemantico, TIPOS_CANDIDATO } = require("../modules/radar/preco-semantico");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");
const { resolverPrecedenciaComercialRadar } = require("../modules/radar/comercial-precedencia");
const { gerarTemplateUniversal } = require("../modules/template-universal");

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

function testarPrecoUnitarioNaoSubstituiTotal() {
  const r = extrair("DE 75 | POR 31 (2,58 cada)");
  assertValor(r.precoAntigo, 75, "preco antigo total");
  assertValor(r.precoAtual, 31, "preco atual total");
  assertValor(r.precoUnitario, 2.58, "preco unitario preservado");
  assertTipo("DE 75 | POR 31 (2,58 cada)", 2.58, TIPOS_CANDIDATO.PRECO_UNITARIO, "cada nao vira preco principal");
}

function testarNumerosDoTituloNaoViraramPreco() {
  const r = extrair("Chapa Gloss Rose 230°C Bivolt 110V/220V Taiff\nDe: R$ 359,90\nPor: R$ 152,32 (Com Cupom)\nCupom: MELI26TODOSITE");
  assertValor(r.precoAntigo, 359.9, "preco antigo chapa");
  assertValor(r.precoAtual, 152.32, "preco atual chapa");
  assert.strictEqual(r.cupom.codigo, "MELI26TODOSITE");
  assertTipo("Chapa 230°C por R$ 152,32", 230, TIPOS_CANDIDATO.QUANTIDADE, "temperatura nao vira preco");
  assertTipo("Bivolt 110V/220V por R$ 152,32", 110, TIPOS_CANDIDATO.QUANTIDADE, "voltagem nao vira preco");
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

function testarBeneficioOffNaoViraPreco() {
  const r = extrair("R$200 OFF em compras a partir de R$1.500", { marketplaceDetectado: "shopee" });
  assert.strictEqual(r.precoAtual.valor, null, "beneficio OFF nao vira preco atual");
  assertValor(r.valorCupom, 200, "beneficio OFF preservado como valor de cupom");
  assertTipo("R$200 OFF em compras a partir de R$1.500", 200, TIPOS_CANDIDATO.VALOR_CUPOM, "R$200 OFF classificado como beneficio");
  assertTipo("R$200 OFF em compras a partir de R$1.500", 1500, TIPOS_CANDIDATO.VALOR_MINIMO_COMPRA, "minimo de compra nao vira preco de");
}

function testarComprasMinimasNaoViraPreco() {
  const r = extrair("R$100 OFF em compras minimas de R$599", { marketplaceDetectado: "shopee" });
  assert.strictEqual(r.precoAtual.valor, null, "beneficio com compra minima nao vira preco");
  assertValor(r.valorCupom, 100, "valor do cupom preservado");
  assertTipo("R$100 OFF em compras minimas de R$599", 599, TIPOS_CANDIDATO.VALOR_MINIMO_COMPRA, "compra minima nao vira preco");
}

function testarValorOffSimplesNaoViraPreco() {
  const r = extrair("cupom de R$90 OFF", { marketplaceDetectado: "shopee" });
  assert.strictEqual(r.precoAtual.valor, null, "R$90 OFF nao vira preco");
  assertValor(r.valorCupom, 90, "R$90 OFF preservado como valor de cupom");
}

function testarPrecoExplicitoMaisBeneficio() {
  const r = extrair("Por R$1.967 + R$200 OFF em compras a partir de R$1.500", { marketplaceDetectado: "shopee" });
  assertValor(r.precoAtual, 1967, "preco explicito preservado");
  assertValor(r.valorCupom, 200, "beneficio nao contamina preco");
  assertTipo("Por R$1.967 + R$200 OFF em compras a partir de R$1.500", 200, TIPOS_CANDIDATO.VALOR_CUPOM, "beneficio separado do preco");
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

function testarBeneficioOffNaoSobrescrevePrecoImportador() {
  const textoOriginal = "R$200 OFF em compras a partir de R$1.500";
  const comercial = extrair(textoOriginal, { marketplaceDetectado: "shopee" });
  const mirror = criarRadarMirror({ textoOriginal, links: [], extracaoRadarLocal: { precoAtual: comercial.precoAtual, comercial }, marketplace: "shopee" });
  const resultado = resolverPrecedenciaComercialRadar({
    ofertaImportador: { preco: 1967, precoAtual: 1967, marketplace: "shopee", metadata: {} },
    radarMirror: mirror,
    metadata: {}
  });
  assert.strictEqual(resultado.resolucao.origemPreco, "ausente");
  assert.strictEqual(resultado.resolucao.precoPublicacao, null);
  assert.strictEqual(resultado.oferta.preco, 1967);
  const template = gerarTemplateUniversal({
    ...resultado.oferta,
    titulo: "Oferta Shopee com beneficio",
    marketplace: "Shopee",
    beneficioTexto: "R$200 OFF",
    linkAfiliado: "https://s.shopee.com.br/produto"
  });
  assert.ok(!template.includes("Por: *R$ 200,00*"), "template final nao publica beneficio como preco");
  assert.ok(template.includes("Por: *R$ 1.967,00*"), "template final preserva fallback tecnico legitimo");
}

function testarMagaluM56DePorSemCifrao() {
  const r = extrair("DE 2.811,00 | POR 2.069,10", { marketplaceDetectado: "magalu" });
  assertValor(r.precoAntigo, 2811, "magalu de sem cifrao");
  assertValor(r.precoAtual, 2069.10, "magalu por sem cifrao");
  assertTipo("DE 2.811,00 | POR 2.069,10", 2811, TIPOS_CANDIDATO.PRECO_ANTIGO, "de sem cifrao classificado");
  assertTipo("DE 2.811,00 | POR 2.069,10", 2069.10, TIPOS_CANDIDATO.PRECO_ATUAL, "por sem cifrao classificado");
}

function testarMagaluM56DecimalPontoCupomParcelaAvaliacao() {
  const texto = `Secadora de Roupas de Piso e Parede Electrolux 11kg
4.8 (1248)
De: R$ 3.599
Por: R$ 2329.1 no Pix a vista
Ou 10x de R$ 232.91 sem juros
Cupom: LU100`;
  const r = extrair(texto, { marketplaceDetectado: "magalu" });
  assertValor(r.precoAntigo, 3599, "magalu de milhar inteiro");
  assertValor(r.precoAtual, 2329.10, "magalu por decimal ponto curto");
  assertValor(r.precoParcelado, 232.91, "parcelamento com decimal ponto preservado");
  assert.strictEqual(r.parcelamento.quantidade, 10);
  assert.strictEqual(r.cupom.codigo, "LU100");
  assertTipo(texto, 4.8, TIPOS_CANDIDATO.QUANTIDADE, "avaliacao decimal nao vira preco");
  assertTipo(texto, 232.91, TIPOS_CANDIDATO.PARCELA, "parcela nao vira preco atual");
}

function testarMagaluM561MarkdownDePor() {
  const texto = `AQUECE O JANTAR NUM PISCAR DE OLHOS
Micro-ondas Electrolux 23L Branco Efficient ME23B
DE ~799,00~ | POR *498,75*`;
  const r = extrair(texto, { marketplaceDetectado: "magalu" });
  assertValor(r.precoAntigo, 799, "magalu de com markdown");
  assertValor(r.precoAtual, 498.75, "magalu por com markdown");
  assertTipo(texto, 799, TIPOS_CANDIDATO.PRECO_ANTIGO, "de markdown classificado");
  assertTipo(texto, 498.75, TIPOS_CANDIDATO.PRECO_ATUAL, "por markdown classificado");
}

function testarMagaluM561CupomNaoContaminaPreco() {
  const texto = `Notebook Acer Aspire Go 15 AG15-51P-35JZ Intel Core i3 8GB RAM 256GB SSD 15.3 Windows 11
DE ~4.999,00~ | POR *3.214,05*
Cupom: INFLU300`;
  const r = extrair(texto, { marketplaceDetectado: "magalu" });
  assertValor(r.precoAntigo, 4999, "magalu de com cupom");
  assertValor(r.precoAtual, 3214.05, "magalu por com cupom");
  assert.strictEqual(r.cupom.codigo, "INFLU300");
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
  testarPrecoUnitarioNaoSubstituiTotal,
  testarNumerosDoTituloNaoViraramPreco,
  testarDePor,
  testarBasePix,
  testarPrecoUnicoComCifrao,
  testarBeneficioOffNaoViraPreco,
  testarComprasMinimasNaoViraPreco,
  testarValorOffSimplesNaoViraPreco,
  testarPrecoExplicitoMaisBeneficio,
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
  testarMetadataPrecedencia,
  testarBeneficioOffNaoSobrescrevePrecoImportador,
  testarMagaluM56DePorSemCifrao,
  testarMagaluM56DecimalPontoCupomParcelaAvaliacao,
  testarMagaluM561MarkdownDePor,
  testarMagaluM561CupomNaoContaminaPreco
];

for (const teste of testes) teste();
console.log(`radar-preco-semantico: ${testes.length} cenarios ok`);
