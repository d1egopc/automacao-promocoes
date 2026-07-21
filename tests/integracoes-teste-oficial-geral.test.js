const assert = require("assert");

const { testarIntegracaoMarketplace } = require("../utils/testar-integracao-marketplace");

(async () => {
  const amazonCookiesOk = await testarIntegracaoMarketplace(
    "cliente_amazon",
    "amazon",
    {
      modo: "cookies",
      credenciais: {
        cookies: "cookie-amazon",
        trackingId: "abc-20"
      },
      urlTeste: "https://www.amazon.com.br/dp/B000TESTE"
    },
    {
      importarAmazon: async (url, config) => ({
        titulo: "Produto Amazon",
        precoAtual: "99,90",
        linkOriginal: url,
        linkAfiliado: `${url}?tag=${config.credenciais.trackingId}`
      })
    }
  );
  assert.strictEqual(amazonCookiesOk.ok, true);
  assert.strictEqual(amazonCookiesOk.status, "ok");

  const amazonSemTagNoLink = await testarIntegracaoMarketplace(
    "cliente_amazon_sem_tag",
    "amazon",
    {
      modo: "cookies",
      credenciais: {
        cookies: "cookie-amazon",
        trackingId: "abc-20"
      },
      urlTeste: "https://www.amazon.com.br/dp/B000TESTE"
    },
    {
      importarAmazon: async (url) => ({
        titulo: "Produto Amazon",
        precoAtual: "99,90",
        linkAfiliado: url
      })
    }
  );
  assert.strictEqual(amazonSemTagNoLink.ok, false);
  assert.strictEqual(amazonSemTagNoLink.status, "link_afiliado_ausente");

  const amazonApiOk = await testarIntegracaoMarketplace(
    "cliente_amazon_api",
    "amazon",
    {
      modo: "api",
      credenciais: {
        appId: "app",
        accessKey: "access",
        secretKey: "secret",
        partnerTag: "abc-20"
      }
    },
    {
      testarAmazonPaApi: async () => ({
        asin: "B000TESTE",
        titulo: "Produto Amazon API",
        linkAfiliado: "https://www.amazon.com.br/dp/B000TESTE?tag=abc-20"
      })
    }
  );
  assert.strictEqual(amazonApiOk.ok, true, "PA-API nao deve exigir cookies");

  const fetchOriginal = global.fetch;
  try {
    global.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        data: {
          productOfferV2: {
            nodes: [{
              itemId: "123",
              productName: "Produto Shopee",
              productLink: "https://shopee.com.br/product/1/123",
              offerLink: "https://shopee.com.br/product/1/123"
            }]
          }
        }
      })
    });
    const shopeeLinkPublico = await testarIntegracaoMarketplace(
      "cliente_shopee",
      "shopee",
      { credenciais: { appId: "app", secret: "secret" } }
    );
    assert.strictEqual(shopeeLinkPublico.ok, false);

    global.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        data: {
          productOfferV2: {
            nodes: [{
              itemId: "123",
              productName: "Produto Shopee",
              productLink: "https://shopee.com.br/product/1/123",
              offerLink: "https://s.shopee.com.br/abc"
            }]
          }
        }
      })
    });
    const shopeeOk = await testarIntegracaoMarketplace(
      "cliente_shopee",
      "shopee",
      { credenciais: { appId: "app", secret: "secret" } }
    );
    assert.strictEqual(shopeeOk.ok, true);
  } finally {
    global.fetch = fetchOriginal;
  }

  const aliexpressLinkPublico = await testarIntegracaoMarketplace(
    "cliente_ali",
    "aliexpress",
    {
      credenciais: { appKey: "app", secret: "secret", trackingId: "track" },
      urlTeste: "https://www.aliexpress.com/item/100500.html"
    },
    {
      importarAliExpress: async (url) => ({
        titulo: "Produto AliExpress",
        linkOriginal: url,
        linkAfiliado: url
      })
    }
  );
  assert.strictEqual(aliexpressLinkPublico.ok, false);

  const aliexpressOk = await testarIntegracaoMarketplace(
    "cliente_ali",
    "aliexpress",
    {
      credenciais: { appKey: "app", secret: "secret", trackingId: "track" },
      urlTeste: "https://www.aliexpress.com/item/100500.html"
    },
    {
      importarAliExpress: async (url) => ({
        titulo: "Produto AliExpress",
        linkOriginal: url,
        linkAfiliado: "https://s.click.aliexpress.com/e/_DmTeste"
      })
    }
  );
  assert.strictEqual(aliexpressOk.ok, true);

  const awinLinkPublico = await testarIntegracaoMarketplace(
    "cliente_awin",
    "kabum",
    {
      credenciais: { publisherId: "pub", apiToken: "token", advertiserId: "17729" },
      urlTeste: "https://www.kabum.com.br/produto/123/produto-teste"
    },
    {
      gerarDeepLinkAwin: async () => "",
      importarProdutoKabumViaAwin: async (url) => ({
        titulo: "Produto KaBuM",
        produtoId: "123",
        linkOriginal: url,
        linkAfiliado: url
      })
    }
  );
  assert.strictEqual(awinLinkPublico.ok, false);

  const awinOk = await testarIntegracaoMarketplace(
    "cliente_awin",
    "kabum",
    {
      credenciais: { publisherId: "pub", apiToken: "token", advertiserId: "17729" },
      urlTeste: "https://www.kabum.com.br/produto/123/produto-teste"
    },
    {
      gerarDeepLinkAwin: async () => "https://www.awin1.com/cread.php?clickref=teste",
      importarProdutoKabumViaAwin: async (url, clienteId, deps) => ({
        titulo: "Produto KaBuM",
        produtoId: "123",
        linkOriginal: url,
        linkAfiliado: await deps.gerarDeepLinkAwin(url, clienteId)
      })
    }
  );
  assert.strictEqual(awinOk.ok, true);

  console.log("integracoes-teste-oficial-geral: ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
