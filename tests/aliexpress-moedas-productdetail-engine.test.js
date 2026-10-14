const assert = require("assert");

const { importarAliExpress } = require("../marketplaces/aliexpress/importar");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const {
  validarProvaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

const PRODUCT_ID = "1005005325013777";
const COIN_ORIGINAL = "https://seuhardware.com/s/atrfdtR";
const PC_ORIGINAL = "https://seuhardware.com/s/KGJNd8h";
const COIN_EXPANDED = `https://m.aliexpress.com/p/coin-index/index.html?productIds=${PRODUCT_ID}`;
const WORKSPACE_ID = "workspace_movespeed_fixture";
const CREDENTIALS = {
  appKey: "app_movespeed_fixture",
  secret: "secret_movespeed_fixture",
  trackingId: "tracking_movespeed_fixture"
};

function responseJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://api-sg.aliexpress.com/sync",
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function productDetail(productId = PRODUCT_ID) {
  return {
    product_id: productId,
    product_title: "Movespeed SSD NVMe 2 TB PCIe 4.0",
    target_sale_price: "1999.90",
    target_original_price: "2299.90",
    product_main_image_url: "//ae01.alicdn.com/kf/movespeed-2tb.jpg",
    promotion_link: `https://s.click.aliexpress.com/e/_BASE_${productId}`,
    product_detail_url: `https://www.aliexpress.com/item/${productId}.html`,
    first_level_category_name: "Armazenamento"
  };
}

function detailResponse(product = productDetail()) {
  return responseJson({
    aliexpress_affiliate_productdetail_get_response: {
      resp_result: {
        resp_code: "200",
        result: { products: { product } }
      }
    }
  });
}

function queryResponse(products = []) {
  return responseJson({
    aliexpress_affiliate_product_query_response: {
      resp_result: {
        resp_code: "200",
        result: { products: { product: products } }
      }
    }
  });
}

function linkResponse(suffix = "MOVESPEED") {
  return responseJson({
    aliexpress_affiliate_link_generate_response: {
      resp_result: {
        result: {
          promotion_links: {
            promotion_link: [{ promotion_link: `https://s.click.aliexpress.com/e/_${suffix}` }]
          }
        }
      }
    }
  });
}

function installFetch(sequence, calls) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const body = options.body instanceof URLSearchParams
      ? options.body
      : new URLSearchParams(options.body || "");
    const method = body.get("method") || "";
    calls.push({ method, sourceValues: body.get("source_values") || "", productIds: body.get("product_ids") || "" });
    const next = sequence.shift();
    assert.ok(next, `requisição inesperada: ${method || url}`);
    assert.equal(next.method, method, `ordem de API inesperada: ${method}`);
    return next.response;
  };
  return () => { global.fetch = original; };
}

function importerConfig(papelLink = "link_moedas") {
  return {
    credenciais: CREDENTIALS,
    clienteId: WORKSPACE_ID,
    gerarLinkOptimus: link => link,
    contextoEngine: {
      conversaoLinkAlternativo: true,
      papelLink
    }
  };
}

async function testCoinLandingUsesOfficialProductDetailOnce() {
  const calls = [];
  const restore = installFetch([
    { method: "aliexpress.affiliate.productdetail.get", response: detailResponse() },
    { method: "aliexpress.affiliate.link.generate", response: linkResponse("COIN_WORKSPACE") }
  ], calls);

  try {
    const product = await importarAliExpress(COIN_EXPANDED, importerConfig());
    assert.equal(product.titulo, "Movespeed SSD NVMe 2 TB PCIe 4.0");
    assert.equal(product.imagem, "https://ae01.alicdn.com/kf/movespeed-2tb.jpg");
    assert.equal(product.categoria, "Armazenamento");
    assert.equal(product.productId, PRODUCT_ID);
    assert.equal(product.papelLink, "link_moedas");
    assert.equal(product.metadata.productId, PRODUCT_ID);
    assert.equal(product.metadata.sourceValuesUsado, COIN_EXPANDED);
    assert.equal(product.metadata.afiliacaoWorkspace.workspaceId, WORKSPACE_ID);
    assert.equal(product.metadata.afiliacaoWorkspace.conversaoStatus, "convertida");
    assert.deepEqual(calls.map(call => call.method), [
      "aliexpress.affiliate.productdetail.get",
      "aliexpress.affiliate.link.generate"
    ]);
    assert.equal(calls[0].productIds, PRODUCT_ID);
    assert.equal(calls[1].sourceValues, COIN_EXPANDED);
  } finally {
    restore();
  }
}

async function testEvent148876CoinOccurrenceBecomesSafeWithoutPcFabrication() {
  const calls = [];
  const restore = installFetch([
    { method: "aliexpress.affiliate.productdetail.get", response: detailResponse() },
    { method: "aliexpress.affiliate.link.generate", response: linkResponse("COIN_WORKSPACE") }
  ], calls);

  try {
    const result = await importarAliExpressEngine({
      job: { id: 707316, evento_id: 148876, cliente_id: WORKSPACE_ID, marketplace: "aliexpress" },
      evento: {
        texto_original: [
          "Movespeed SSD NVMe 2 TB PCIe 4.0",
          "R$ 1.769,91",
          "410 moedas",
          "Cupons: IFPVFHL2 / IFPO2TDC",
          `MOEDAS: ${COIN_ORIGINAL}`,
          `PC: ${PC_ORIGINAL}`
        ].join("\n")
      },
      // O link PC falhou antes da identificação AliExpress e não chegou ao
      // conjunto do marketplace do job 707316. Ele não é recriado aqui.
      links: [{
        url_original: COIN_ORIGINAL,
        url_expandida: COIN_EXPANDED,
        metadata: { papelLink: "link_moedas", papelLinkMotivo: "contexto_moedas" }
      }],
      deps: {
        getIntegracaoCliente: clientId => clientId === WORKSPACE_ID ? { credenciais: CREDENTIALS } : null,
        importarAliExpress
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.produtoId, PRODUCT_ID);
    assert.equal(result.titulo, "Movespeed SSD NVMe 2 TB PCIe 4.0");
    assert.equal(result.imagem, "https://ae01.alicdn.com/kf/movespeed-2tb.jpg");
    assert.equal(result.categoria, "Armazenamento");
    assert.equal(result.preco, 1769.91);
    assert.equal(result.precoOrigem, "texto_radar");
    assert.equal(result.cupom, "IFPVFHL2");
    assert.equal(result.moedasTexto, "+410 moedas");

    const coin = result.metadata.linksClassificados.find(link => link.papelLink === "link_app");
    assert.ok(coin, "ocorrência Moedas deve permanecer no papel APP/Moedas homologado");
    assert.equal(coin.urlOriginal, COIN_ORIGINAL);
    assert.equal(coin.sourceValuesUsado, COIN_EXPANDED);
    assert.equal(coin.renderizavel, true);
    assert.equal(coin.conversaoStatus, "convertida");
    assert.equal(coin.afiliacaoWorkspace.workspaceId, WORKSPACE_ID);
    assert.equal(coin.afiliacaoWorkspace.urlOriginal, COIN_ORIGINAL);
    assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(
      coin.afiliacaoWorkspace,
      { clienteId: WORKSPACE_ID, credenciais: CREDENTIALS, exigirAssinatura: true }
    ).valida, true);
    assert.ok(!result.metadata.linksClassificados.some(link => link.papelLink === "link_pc"));
    assert.deepEqual(calls.map(call => call.method), [
      "aliexpress.affiliate.productdetail.get",
      "aliexpress.affiliate.link.generate"
    ]);
  } finally {
    restore();
  }
}

async function testUnresolvedCapturedPcStillBlocksIntegralContract() {
  const calls = [];
  const restore = installFetch([
    { method: "aliexpress.affiliate.productdetail.get", response: detailResponse() },
    { method: "aliexpress.affiliate.link.generate", response: linkResponse("COIN_WORKSPACE") }
  ], calls);

  try {
    const result = await importarAliExpressEngine({
      job: { id: "fixture_148876_pc", evento_id: 148876, cliente_id: WORKSPACE_ID, marketplace: "aliexpress" },
      evento: { texto_original: `Movespeed SSD NVMe 2 TB\nR$ 1.769,91\nMOEDAS: ${COIN_ORIGINAL}\nPC: ${PC_ORIGINAL}` },
      links: [
        { url_original: COIN_ORIGINAL, url_expandida: COIN_EXPANDED, metadata: { papelLink: "link_moedas" } },
        { url_original: PC_ORIGINAL, metadata: { papelLink: "link_pc" } }
      ],
      deps: { getIntegracaoCliente: () => ({ credenciais: CREDENTIALS }), importarAliExpress }
    });

    assert.equal(result.ok, false);
    assert.equal(result.motivo, "afiliacao_workspace_incompleta");
    const pc = result.metadata.linksClassificados.find(link => link.papelLink === "link_pc");
    assert.ok(pc);
    assert.equal(pc.renderizavel, false);
    assert.equal(pc.urlAfiliada, "");
    assert.notEqual(pc.produtoCanonico, PRODUCT_ID, "PC opaco não herda identidade de Moedas");
  } finally {
    restore();
  }
}

async function testMismatchedDetailFallsBackOnlyToExactQueryProduct() {
  const calls = [];
  const restore = installFetch([
    { method: "aliexpress.affiliate.productdetail.get", response: detailResponse("1005005325013999") },
    { method: "aliexpress.affiliate.product.query", response: queryResponse([
      productDetail("1005005325013888"),
      productDetail(PRODUCT_ID)
    ]) },
    { method: "aliexpress.affiliate.link.generate", response: linkResponse("QUERY_EXACT") }
  ], calls);

  try {
    const product = await importarAliExpress(COIN_EXPANDED, importerConfig());
    assert.equal(product.productId, PRODUCT_ID);
    assert.equal(product.titulo, "Movespeed SSD NVMe 2 TB PCIe 4.0");
    assert.equal(product.metadata.sourceValuesUsado, COIN_EXPANDED);
    assert.deepEqual(calls.map(call => call.method), [
      "aliexpress.affiliate.productdetail.get",
      "aliexpress.affiliate.product.query",
      "aliexpress.affiliate.link.generate"
    ]);
  } finally {
    restore();
  }
}

(async () => {
  await testCoinLandingUsesOfficialProductDetailOnce();
  await testEvent148876CoinOccurrenceBecomesSafeWithoutPcFabrication();
  await testUnresolvedCapturedPcStillBlocksIntegralContract();
  await testMismatchedDetailFallsBackOnlyToExactQueryProduct();
  console.log("aliexpress-moedas-productdetail-engine.test.js OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
