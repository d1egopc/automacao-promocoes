const assert = require("assert");

const {
  analisarFaixaPrecoShopee,
  criarImportarShopee,
  normalizarPrecoApiShopee,
  resolverPrecoPixComprovadoShopee
} = require("../marketplaces/shopee/importar");
const { normalizarPrecoShopee: normalizarPrecoFarejadorShopee } = require("../marketplaces/shopee/farejador");

const originalFetch = global.fetch;

function depsImportador() {
  return {
    limparPreco: (valor = "") => String(valor || "").replace(/^R\$\s*/i, "").trim(),
    htmlDecode: (valor = "") => String(valor || ""),
    extrairMeta: () => "",
    corrigirImagemUrl: (valor = "") => String(valor || "")
  };
}

function produtoShopee(campos = {}) {
  return {
    itemId: "456",
    shopId: "123",
    productName: "Produto Shopee Teste",
    productLink: "https://shopee.com.br/product/123/456",
    offerLink: "https://shopee.com.br/product/123/456?af=1",
    imageUrl: "https://img.test/produto.jpg",
    priceMin: "3998",
    priceMax: "3998",
    ...campos
  };
}

async function importarComProduto(produto, textoOriginal = "") {
  global.fetch = async (url) => {
    if (!String(url).includes("open-api.affiliate.shopee.com.br")) {
      return {
        status: 200,
        text: async () => "<html></html>"
      };
    }

    return {
      json: async () => ({
        data: {
          productOfferV2: {
            nodes: [produto]
          }
        }
      })
    };
  };

  const importarShopee = criarImportarShopee(depsImportador());
  return importarShopee("https://shopee.com.br/product/123/456", {
    credenciais: { appId: "app", secret: "secret" },
    textoOriginal
  });
}

async function assertPrecoAmbiguo(priceMin, priceMax) {
  const resultado = await importarComProduto(produtoShopee({ priceMin, priceMax }));
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "shopee_preco_indisponivel");
  assert.strictEqual(resultado.precoAtual, "");
  assert.strictEqual(resultado.precoAmbiguo, true);
  assert.ok(resultado.faixaPreco);
}

function assertFaixaTecnica(priceMin, priceMax, precoAtual) {
  const analise = analisarFaixaPrecoShopee(precoAtual, String(Number(priceMax)).replace(".", ","));
  assert.strictEqual(analise.variacaoComprovada, true);
  assert.strictEqual(analise.precoAmbiguo, false);
}

(async () => {
  assert.strictEqual(analisarFaixaPrecoShopee("9,50", "899,00").precoAmbiguo, true);
  assert.strictEqual(analisarFaixaPrecoShopee("4,40", "320,00").precoAmbiguo, true);
  assert.strictEqual(analisarFaixaPrecoShopee("5,49", "699,00").precoAmbiguo, true);
  assert.strictEqual(analisarFaixaPrecoShopee("39,98", "39,98").precoAmbiguo, false);
  assert.strictEqual(analisarFaixaPrecoShopee("39,98", "44,98").precoAmbiguo, false);
  assert.strictEqual(analisarFaixaPrecoShopee("184,88", "199,90").precoAmbiguo, false);
  assert.strictEqual(analisarFaixaPrecoShopee("234,60", "275,99").precoAmbiguo, false);
  assert.strictEqual(analisarFaixaPrecoShopee("1099,00", "1299,00").precoAmbiguo, false);
  assert.strictEqual(analisarFaixaPrecoShopee("3999,00", "6999,00").precoAmbiguo, false);

  await assertPrecoAmbiguo("9.50", "899.00");
  await assertPrecoAmbiguo("4.40", "320.00");
  await assertPrecoAmbiguo("5.49", "699.00");

  assert.strictEqual(normalizarPrecoApiShopee("3338"), 3338);
  assert.strictEqual(normalizarPrecoApiShopee("3070.96"), 3070.96);
  assert.strictEqual(normalizarPrecoApiShopee("2978"), 2978);
  assert.strictEqual(normalizarPrecoFarejadorShopee("3338"), "3338,00");

  const barato = await importarComProduto(produtoShopee({ priceMin: "39.98", priceMax: "39.98" }));
  assert.strictEqual(barato.ok, false);
  assert.strictEqual(barato.precoAtual, "");
  assert.strictEqual(barato.precoAmbiguo, false);
  assert.strictEqual(barato.precoMin, "39,98");
  assert.strictEqual(barato.precoOrigem, "api_productOfferV2.priceMin_priceMax_tecnico");

  assertFaixaTecnica("39.98", "44.98", "39,98");
  assertFaixaTecnica("184.88", "199.90", "184,88");
  assertFaixaTecnica("234.60", "275.99", "234,60");
  assertFaixaTecnica("1099", "1299", "1099,00");
  assertFaixaTecnica("3999", "6999", "3999,00");

  const lavaESeca = await importarComProduto(produtoShopee({ priceMin: "3338", priceMax: "3338" }));
  assert.strictEqual(lavaESeca.ok, false);
  assert.strictEqual(lavaESeca.motivo, "shopee_preco_indisponivel");
  assert.strictEqual(lavaESeca.precoAtual, "");
  assert.strictEqual(lavaESeca.precoMin, "3338,00");
  assert.strictEqual(lavaESeca.precoAuditoria.precoNormalizado, "");

  const radarSoberano = await importarComProduto(
    produtoShopee({ priceMin: "3338", priceMax: "3338" }),
    "Oferta Radar\nPor: R$ 2.978,00"
  );
  assert.strictEqual(radarSoberano.precoAtual, "2978,00");
  assert.strictEqual(radarSoberano.precoOrigem, "texto_radar_preco_unico_claro");

  const pix = resolverPrecoPixComprovadoShopee("184,88", "17500");
  assert.strictEqual(pix.precoPix, "175,00");
  assert.strictEqual(pix.valorEfetivo, 175);
  assert.strictEqual(pix.valorEfetivoOrigem, "pix");

  const drone = await importarComProduto(
    produtoShopee({ priceMin: "184.88", priceMax: "184.88", precoPix: "17500" }),
    "Oferta Radar\nPor: R$ 184,88"
  );
  assert.strictEqual(drone.precoAtual, "184,88");
  assert.strictEqual(drone.precoPix, "175,00");
  assert.strictEqual(drone.valorEfetivo, 175);
  assert.strictEqual(drone.valorEfetivoOrigem, "pix");

  const semPix = await importarComProduto(
    produtoShopee({ priceMin: "184.88", priceMax: "184.88" }),
    "Oferta Radar\nPor: R$ 184,88"
  );
  assert.strictEqual(semPix.precoPix, "");
  assert.strictEqual(semPix.valorEfetivo, null);
  assert.strictEqual(semPix.valorEfetivoOrigem, "");

  console.log("shopee-hotfix.test.js ok");
})()
  .finally(() => {
    global.fetch = originalFetch;
  })
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
