"use strict";

const assert = require("assert");
const cupom = require("../modules/radar/cupom-semantico");
const radarCupomMensagem = require("../utils/radar-cupom-mensagem");
const { extrairEvidenciasRadarLocal } = require("../modules/radar/extrator-local");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");
const { classificarLinksComerciais } = require("../modules/radar/links-comerciais");
const { textoComercialSemRodape, urlAuxiliarNoTexto } = require("../modules/radar/linhas-auxiliares");
const { construirEspelhoComercialV24 } = require("../modules/ofc-v2/espelho-comercial");

const casos = [
  {
    nome: "incidente jaqueta Amazon",
    marketplace: "amazon",
    texto: "➡️ Field & Stream Jaqueta masculina de lã padrão Hail Call azul royal, GG\n✅ R$ 54 😱😱\n🛒 https://link.amazon/B0boX3Y4h\n🚀 Mais grupos de ofertas e cupons: nerdofertas.com/t",
    preco: 54, cupons: []
  },
  {
    nome: "Amazon sem cupom e rodape",
    marketplace: "amazon",
    texto: "Suéter com capuz Shoveler Ring Neck Field & Stream Masculino\n✅ R$ 75\n🛒 https://link.amazon/B0b8o5vH4\n🚀 Mais grupos de ofertas e cupons:\nnerdofertas.com/t",
    preco: 75, cupons: []
  },
  {
    nome: "Shopee resgate sem codigo",
    marketplace: "shopee",
    texto: "Memória DDR4 Spectrum Blitz S, 16GB, 3200MHz\n💰 R$ 519,80 em 12x sem juros\n🎟️ Resgate todos os cupons desta página:\nhttps://s.shopee.com.br/4B07XwX4fA\n🔗 Link do produto:\nhttps://s.shopee.com.br/50ZEXTYETe",
    preco: 519.8, cupons: [], resgate: "https://s.shopee.com.br/4B07XwX4fA", produto: "https://s.shopee.com.br/50ZEXTYETe"
  },
  {
    nome: "Shopee codigo",
    marketplace: "shopee",
    texto: "Smart TV 43 LG LED 4K UHD\nR$ 1149 com cupom: 3SQUENT4150\nLink do produto:\nhttps://s.shopee.com.br/2gBMViV6cQ",
    preco: 1149, cupons: ["3SQUENT4150"], produto: "https://s.shopee.com.br/2gBMViV6cQ"
  },
  {
    nome: "ML Pix",
    marketplace: "mercadolivre",
    texto: "Kit com 5 Camisetas Dry All Black Alpha\nDe R$ 249 por R$ 130 no Pix\nUse o Cupom: MELHORCUPOM + Selecione Pix\nLoja Oficial UseAlpha no ML\nhttps://meli.la/1tLCti1",
    preco: 130, anterior: 249, cupons: ["MELHORCUPOM"], produto: "https://meli.la/1tLCti1"
  },
  {
    nome: "ML cupom e parcela",
    marketplace: "mercadolivre",
    texto: "Tênis Fila Racer Speedzone Tr\nDe R$ 699 por R$ 419 em 6x\nUse o Cupom: MELHORCUPOM\nLoja Oficial Fila no ML\nhttps://meli.la/2eeGFdB",
    preco: 419, anterior: 699, cupons: ["MELHORCUPOM"], produto: "https://meli.la/2eeGFdB"
  },
  {
    nome: "ML sem cupom com convite",
    marketplace: "mercadolivre",
    texto: "Furadeira Parafusadeira\nDe: R$ 219,90\nPor: R$ 122,90\nPegar promoção:\nhttps://meli.la/2vKWKE9\nConvide um amigo:\nhttps://chat.whatsapp.com/K17uWjsE4gbKDBeUEwv4sC",
    preco: 122.9, anterior: 219.9, cupons: [], produto: "https://meli.la/2vKWKE9", auxiliar: "https://chat.whatsapp.com/K17uWjsE4gbKDBeUEwv4sC"
  },
  {
    nome: "ML simples",
    marketplace: "mercadolivre",
    texto: "VARA DE PESCA TELESCÓPICA\nDe R$82\nPor R$56,07\n31% OFF\nCOMPRE AGORA:\nhttps://meli.la/1mZnfqh",
    preco: 56.07, anterior: 82, cupons: [], produto: "https://meli.la/1mZnfqh"
  },
  {
    nome: "cupom com anuncio",
    marketplace: "mercadolivre",
    texto: "RTX 5070\nR$ 4.673\nCupom: ECONOMIZASEMPRE\nhttps://meli.la/1SKJJbB\n(ANÚNCIO)",
    preco: 4673, cupons: ["ECONOMIZASEMPRE"], produto: "https://meli.la/1SKJJbB"
  },
  {
    nome: "cupom inline",
    marketplace: "mercadolivre",
    texto: "Processador AMD Ryzen 7 5700 - R$753\n-Cupom SONOML\nhttps://meli.la/1HVe3QN\nanuncio",
    preco: 753, cupons: ["SONOML"], produto: "https://meli.la/1HVe3QN"
  },
  {
    nome: "cupons alternativos",
    marketplace: "mercadolivre",
    texto: "Kit 3 Calça Esportiva\nR$ 55\nCupom: GARIMPEI ou GARANTIDO\nhttps://meli.la/1Xt9rQV",
    preco: 55, cupons: ["GARIMPEI", "GARANTIDO"], produto: "https://meli.la/1Xt9rQV"
  },
  {
    nome: "AliExpress multicupom moedas",
    marketplace: "aliexpress",
    texto: "Placa de Vídeo Veineda RX 5500\nR$ 744\nCupom:\nBRFS4 ou IFPAYY1T ou IFPEFVB9\n+ 173 moedas no APP\nLink produto:\nhttps://s.click.aliexpress.com/e/_c3lepfrP",
    preco: 744, cupons: ["BRFS4", "IFPAYY1T", "IFPEFVB9"], produto: "https://s.click.aliexpress.com/e/_c3lepfrP"
  },
  {
    nome: "AliExpress APP PC e Linktree",
    marketplace: "aliexpress",
    texto: "Camiseta Masculina\nValor: R$ 129,03 (2 Unidades)\nCUPOM: NIVER + 888 Moedas\nLink com moedas:\nhttps://a.aliexpress.com/_c3MkBamb\nLink para PC:\nhttps://a.aliexpress.com/_c2w1PzMT\nIMPOSTO incluso no valor!\nLink Geral Todas as Redes:\nhttps://linktr.ee/iskandarsouza",
    preco: 129.03, cupons: ["NIVER"], app: "https://a.aliexpress.com/_c3MkBamb", pc: "https://a.aliexpress.com/_c2w1PzMT", auxiliar: "https://linktr.ee/iskandarsouza"
  }
];

for (const caso of casos) {
  const antes = caso.texto;
  const codigos = cupom.extrairCodigosCupomSemanticos(caso.texto);
  assert.deepStrictEqual(codigos, caso.cupons, `${caso.nome}: codigos`);
  const links = radarCupomMensagem.extrairLinksRadar(caso.texto)
    .filter(link => !urlAuxiliarNoTexto(link, caso.texto));
  const local = extrairEvidenciasRadarLocal({ textoOriginal: caso.texto, links, marketplaceDetectado: caso.marketplace }, { radarCupomMensagem });
  const beneficios = radarCupomMensagem.analisarBeneficiosMensagemRadar(textoComercialSemRodape(caso.texto), links);
  const mirror = criarRadarMirror({ textoOriginal: caso.texto, links, marketplace: caso.marketplace, extracaoRadarLocal: local, beneficiosMensagem: beneficios });
  assert.strictEqual(local.cupom.codigo, caso.cupons[0] || null, `${caso.nome}: cupom local`);
  assert.deepStrictEqual(mirror.cupom.codigosCapturados, caso.cupons, `${caso.nome}: cupons mirror`);
  assert.strictEqual(local.precoAtual.valor, caso.preco, `${caso.nome}: preco`);
  if (caso.anterior !== undefined) assert.strictEqual(local.precoAnterior.valor, caso.anterior, `${caso.nome}: preco anterior`);
  assert.strictEqual(mirror.texto.original, antes, `${caso.nome}: raw original`);
  if (caso.nome === "ML Pix") assert.strictEqual(local.precoPix.valor, 130, "Pix comercial preservado");
  if (caso.nome === "AliExpress multicupom moedas") assert.strictEqual(local.comercial.moedasShopee.valor, 173, "173 moedas preservadas");
  if (caso.nome === "AliExpress APP PC e Linktree") {
    assert.strictEqual(local.comercial.moedasShopee.valor, 888, "888 moedas preservadas");
    assert(textoComercialSemRodape(caso.texto).includes("IMPOSTO incluso"), "imposto permanece no texto comercial");
  }
  const classificados = classificarLinksComerciais({ texto: caso.texto, marketplace: caso.marketplace });
  if (caso.produto) assert(classificados.produto.includes(caso.produto), `${caso.nome}: produto`);
  if (caso.resgate) assert(classificados.resgate.includes(caso.resgate), `${caso.nome}: resgate`);
  if (caso.app) assert(classificados.app.includes(caso.app), `${caso.nome}: APP`);
  if (caso.pc) assert(classificados.pc.includes(caso.pc), `${caso.nome}: PC`);
  if (caso.auxiliar) {
    assert(!links.includes(caso.auxiliar), `${caso.nome}: auxiliar no ingress`);
    assert(!classificados.encontrados.includes(caso.auxiliar), `${caso.nome}: auxiliar no mirror`);
  }
}

for (const [texto, esperado] of [
  ["Mais grupos de ofertas e cupons: SUPERPROMO.COM", []],
  ["Entre no grupo de cupons: CUPOMTOP", []],
  ["cupom: TESTE10", ["TESTE10"]],
  ["cupons disponíveis na página", []],
  ["cupom de 20% no anúncio", []],
  ["Use o cupom PROMO20", ["PROMO20"]],
  ["Site: cupomlegal.com.br", []],
  ["Canal @cupomdoze", []]
]) assert.deepStrictEqual(cupom.extrairCodigosCupomSemanticos(texto), esperado, texto);

const espelhoIncidente = construirEspelhoComercialV24({
  evento: { texto_original: casos[0].texto },
  job: { id: 1, cliente_id: "workspace_teste", marketplace_detectado: "amazon" },
  oferta: { titulo: "Field & Stream Jaqueta Hail Call", marketplace: "amazon", preco: 54, linkAfiliado: "https://www.amazon.com.br/dp/B0FC6CY3WT?tag=workspace-20" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 54 }
});
assert.strictEqual(espelhoIncidente.espelhoComercial.cupomCodigo, null, "OFC nao recria cupom do rodape");
assert(!String(espelhoIncidente.templateEspelhoShadow.mensagem).includes("NERDOFERTAS"), "template sem falso cupom");

console.log(`teleradar-semantica-comercial: ok (${casos.length} casos, 8 adversariais)`);
