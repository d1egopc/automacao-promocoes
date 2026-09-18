"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");

const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function extrairFuncao(nome, proximaAssinatura) {
  const inicio = indexFonte.indexOf(`function ${nome}`);
  const fim = indexFonte.indexOf(proximaAssinatura, inicio);
  assert.ok(inicio >= 0 && fim > inicio, `${nome} deve continuar disponivel`);
  return indexFonte.slice(inicio, fim);
}

const dominioAmazonDivulgadorRadar = () => false;
const dominioMarketplaceConhecidoRadar = new Function(
  "detectarMarketplaceEngineLink",
  "dominioAmazonDivulgadorRadar",
  `${extrairFuncao("dominioMarketplaceConhecidoRadar", "function dominioRadar")}; return dominioMarketplaceConhecidoRadar;`
)(detectarMarketplaceLink, dominioAmazonDivulgadorRadar);

const linkEngineV2Radar = new Function(
  "linkRedirectPermitidoRadar",
  "dominioMarketplaceConhecidoRadar",
  `${extrairFuncao("linkEngineV2Radar", "function linkMeliLaRadar")}; return linkEngineV2Radar;`
)(() => false, dominioMarketplaceConhecidoRadar);

const casosPermitidos = [
  ["https://www.magazineluiza.com.br/smart-tv/p/behad7fah2/", "magalu"],
  ["https://www.magazinevoce.com.br/d1egopc/smart-tv/p/behad7fah2/", "magalu"],
  ["https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM", "mercadolivre"],
  ["https://www.amazon.com.br/dp/B0ABCDEF12", "amazon"],
  ["https://shopee.com.br/product/123/456", "shopee"],
  ["https://www.aliexpress.com/item/1005001111111111.html", "aliexpress"],
  ["https://www.kabum.com.br/produto/123456/produto", "awin"],
  ["https://www.awin1.com/cread.php?awinmid=1", "awin"]
];

for (const [url, marketplaceEsperado] of casosPermitidos) {
  assert.strictEqual(detectarMarketplaceLink(url), marketplaceEsperado === "awin" && url.includes("kabum") ? "kabum" : marketplaceEsperado);
  assert.strictEqual(linkEngineV2Radar(url), true, `${marketplaceEsperado} deve alcançar o Engine V2`);
}

const desconhecido = "https://loja-desconhecida.example/produto/behad7fah2";
assert.strictEqual(detectarMarketplaceLink(desconhecido), "");
assert.strictEqual(linkEngineV2Radar(desconhecido), false);

assert.strictEqual(detectarMarketplaceLink(casosPermitidos[0][0]), "magalu");
assert.strictEqual(dominioMarketplaceConhecidoRadar(casosPermitidos[0][0]), "magalu");

const runner = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "importer", "importer.runner.js"), "utf8");
assert.ok(runner.includes("magalu: importarProdutoMagaluEngine"), "Magalu deve continuar registrado no importer");
assert.ok(!indexFonte.includes('motivoRejeicaoEngineV2 = "marketplace_sem_rota_engine_v2"') || indexFonte.includes('marketplaceEngine === "magalu"'), "Magalu nao pode ficar fora do gate Engine V2");

console.log("radar-engine-v2-magalu-route.test.js OK");
