"use strict";

const assert = require("node:assert/strict");
const { extrairEvidenciasRadarLocal } = require("../modules/radar/extrator-local");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");

const casosMl = [
  ["Kit 4 Cuecas Lupo Am Boxer Masculina", "https://meli.la/1wteTwg", 35, ""],
  ["Kit 4 Cuecas Lupo Am Boxer Masculina", "https://meli.la/1g6trs4", 35, ""],
  ["Kit 4 Cuecas Lupo Am Boxer Masculina Sortida - 0910 Liso Gg", "https://meli.la/16PXeHV", 35, "\n✅ Link do produto:\n"],
  ["Smartband Huawei Band 10 Preta com Tela AMOLED de 1.47\"", "https://meli.la/1sDRofG", 151, "\nCupom: FULL1611\n\nLink do produto:\n\nGrupo de ofertas Gerais:\nhttps://t.me/+2h6Fol5X-qVmYjVh\nConheça nossos canais de Ofertas:\nhttps://linktr.ee/pcdorafa\n\nanuncio"],
  ["Isca Rapala Precision Xtreme 11cm", "https://meli.la/rapala", 79.9, ""],
];

for (const [titulo, link, preco, extra] of casosMl) {
  const texto = `${titulo}\nR$ ${String(preco).replace(".", ",")}${extra}\n${link}`;
  const extracao = extrairEvidenciasRadarLocal({
    textoOriginal: texto,
    links: [link],
    marketplaceDetectado: "mercadolivre"
  });
  assert.equal(extracao.titulo.valor, titulo, `título factual ML perdido: ${titulo}`);
  const mirror = criarRadarMirror({
    origemTipo: "telegram",
    clienteId: "user_pss60lus",
    textoOriginal: texto,
    links: [link],
    extracaoRadarLocal: extracao,
    marketplace: "mercadolivre"
  });
  assert.equal(mirror.produto.tituloCapturado, titulo);
  assert.equal(mirror.links.produtoOriginal, link);
  assert.equal(mirror.preco.atualCapturado, preco);
  if (link.endsWith("1sDRofG")) assert.equal(extracao.cupom.codigo, "FULL1611");
}

const publicitario = extrairEvidenciasRadarLocal({
  textoOriginal: "Grupo de ofertas Gerais\nR$ 35\nhttps://meli.la/rapala",
  links: ["https://meli.la/rapala"],
  marketplaceDetectado: "mercadolivre"
});
assert.equal(publicitario.titulo.valor, null, "rodapé não pode virar título ML");

const outroMarketplace = extrairEvidenciasRadarLocal({
  textoOriginal: "Kit 4 Cuecas Lupo Am Boxer Masculina\nR$ 35\nhttps://shopee.test/item",
  links: ["https://shopee.test/item"],
  marketplaceDetectado: "shopee"
});
assert.equal(outroMarketplace.titulo.valor, null, "patch deve permanecer restrito ao ML");

console.log("ml-backend-first-title-capture: ok");
