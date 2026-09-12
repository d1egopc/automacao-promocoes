"use strict";

const assert = require("assert");
const {
  ehShortlinkAmazonExterno,
  ehUrlAmazonDireta,
  extrairAsinAmazonUrl,
  hostAmazonReconhecido,
  urlAmazonDiretaComAsin
} = require("../modules/engine/preparacao-links.helpers");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");
const { diagnosticarAwinKabum } = require("../modules/radar/redirect/redirect-resolver");

const amazonProduto = "https://www.amazon.com.br/dp/B0C3T4MFMM?tag=origem-20";

for (const url of [
  "https://amzn.to/3abc",
  "https://amzn.divulgador.link/abc",
  "https://amzlink.to/abc"
]) {
  assert.strictEqual(ehShortlinkAmazonExterno(url), true, `${url} deve continuar shortlink Amazon`);
  assert.strictEqual(detectarMarketplaceLink(url), "amazon", `${url} deve continuar Amazon na entrada`);
}

assert.strictEqual(ehShortlinkAmazonExterno(amazonProduto), false);
assert.strictEqual(ehUrlAmazonDireta(amazonProduto), true);
assert.strictEqual(extrairAsinAmazonUrl(amazonProduto), "B0C3T4MFMM");
assert.strictEqual(urlAmazonDiretaComAsin(amazonProduto), amazonProduto);
assert.strictEqual(urlAmazonDiretaComAsin("https://www.amazon.com.br/gp/browse"), "");
assert.strictEqual(
  urlAmazonDiretaComAsin(`https://redirect.example/?url=${encodeURIComponent(amazonProduto)}`),
  amazonProduto,
  "ASIN explicito aninhado deve continuar reconhecido"
);
assert.strictEqual(hostAmazonReconhecido("amzn.divulgador.link"), true);
assert.strictEqual(hostAmazonReconhecido("amzn.divulguei.app"), false, "nao ampliar whitelist/deteccao nesta fase");

const awin = diagnosticarAwinKabum(
  "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123456%2Fteclado"
);
assert.strictEqual(awin?.produtoId, "123456");
assert.strictEqual(awin?.chaveCanonica, "kabum:123456");

console.log("preparacao-links-helpers.test.js ok");
