const assert = require("assert");

const {
  analisarFaixaPrecoShopee,
  criarImportarShopee,
  resolverPrecoPixComprovadoShopee
} = require("../marketplaces/shopee/importar");

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

async function importarComProduto(produto) {
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
    textoOriginal: ""
  });
}

async function assertPrecoAmbiguo(priceMin, priceMax) {
  const resultado = await importarComProduto(produtoShopee({ priceMin, priceMax }));
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "shopee_preco_variacao_ambiguo");
  assert.strictEqual(resultado.precoAtual, "");
  assert.strictEqual(resultado.precoAmbiguo, true);
  assert.ok(resultado.faixaPreco);
}

async function assertFaixaAceita(priceMin, priceMax, precoAtual, faixaPreco) {
  const analise = analisarFaixaPrecoShopee(precoAtual, String(Number(priceMax) / 100).replace(".", ","));
  assert.strictEqual(analise.variacaoComprovada, true);
  assert.strictEqual(analise.precoAmbiguo, false);

  const resultado = await importarComProduto(produtoShopee({ priceMin, priceMax }));
  assert.notStrictEqual(resultado.ok, false);
  assert.strictEqual(resultado.precoAtual, precoAtual);
  assert.strictEqual(resultado.precoAmbiguo, false);
  assert.strictEqual(resultado.variacaoComprovada, true);
  assert.strictEqual(resultado.faixaPreco, faixaPreco);
  assert.strictEqual(resultado.precoOrigem, "api_productOfferV2.priceMin");
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

  await assertPrecoAmbiguo("950", "89900");
  await assertPrecoAmbiguo("440", "32000");
  await assertPrecoAmbiguo("549", "69900");

  const barato = await importarComProduto(produtoShopee({ priceMin: "3998", priceMax: "3998" }));
  assert.strictEqual(barato.precoAtual, "39,98");
  assert.strictEqual(barato.precoAmbiguo, false);

  await assertFaixaAceita("3998", "4498", "39,98", "R$ 39,98 a R$ 44,98");
  await assertFaixaAceita("18488", "19990", "184,88", "R$ 184,88 a R$ 199,90");
  await assertFaixaAceita("23460", "27599", "234,60", "R$ 234,60 a R$ 275,99");
  await assertFaixaAceita("109900", "129900", "1099,00", "R$ 1099,00 a R$ 1299,00");
  await assertFaixaAceita("399900", "699900", "3999,00", "R$ 3999,00 a R$ 6999,00");

  const pix = resolverPrecoPixComprovadoShopee("184,88", "17500");
  assert.strictEqual(pix.precoPix, "175,00");
  assert.strictEqual(pix.valorEfetivo, 175);
  assert.strictEqual(pix.valorEfetivoOrigem, "pix");

  const drone = await importarComProduto(produtoShopee({ priceMin: "18488", priceMax: "18488", precoPix: "17500" }));
  assert.strictEqual(drone.precoAtual, "184,88");
  assert.strictEqual(drone.precoPix, "175,00");
  assert.strictEqual(drone.valorEfetivo, 175);
  assert.strictEqual(drone.valorEfetivoOrigem, "pix");

  const semPix = await importarComProduto(produtoShopee({ priceMin: "18488", priceMax: "18488" }));
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
