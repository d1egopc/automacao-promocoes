"use strict";

const assert = require("node:assert/strict");
const axios = require("axios");

const moduloAxios = require.resolve("axios");
const originalAxios = require.cache[moduloAxios].exports;
require.cache[moduloAxios].exports = {
  ...axios,
  get: async () => ({
    status: 200,
    data: [
      "<html><head>",
      '<title data-next-head="">Processador AMD Ryzen 9 5900XT | KaBuM!</title>',
      '<meta property="og:image" content="https://images.kabum.com.br/produtos/fotos/609953/ryzen.jpg">',
      "</head><body>R$ 1.779,00</body></html>"
    ].join("")
  })
};

const importerPath = require.resolve("../marketplaces/kabum/importador.js");
delete require.cache[importerPath];
const { importarProdutoKabumViaAwin } = require(importerPath);

(async () => {
  try {
    const original = "https://www.kabum.com.br/produto/609953/processador-amd-ryzen-9-5900xt";
    const produto = await importarProdutoKabumViaAwin(original, "user_pss60lus", {
      gerarDeepLinkAwin: async url => `https://www.awin1.com/cread.php?awinaffid=fixture&ued=${encodeURIComponent(url)}`
    });
    assert.equal(produto.titulo, "Processador AMD Ryzen 9 5900XT");
    assert.equal(produto.produtoIdCanonico, "609953");
    assert.equal(produto.linkOriginal, original);
    assert.equal(produto.imagem, "https://images.kabum.com.br/produtos/fotos/609953/ryzen.jpg");
    assert.match(produto.linkAfiliado, /awin1\.com\/cread\.php/);
    console.log("kabum-current-title-markup.test.cjs: ok");
  } finally {
    require.cache[moduloAxios].exports = originalAxios;
    delete require.cache[importerPath];
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
