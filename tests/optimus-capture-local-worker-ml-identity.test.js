"use strict";

const assert = require("assert");

function resposta(url, { status = 200, contentType = "text/html", body = "" } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: nome => nome.toLowerCase() === "content-type" ? contentType : "" },
    text: async () => body,
    body: { cancel: async () => undefined }
  };
}

function htmlProduto({ mlb = "MLB123456789", titulo = "Furadeira Parafusadeira Bosch GSR 120-LI 12V", imagem = "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg", extra = "" } = {}) {
  return `<link rel="canonical" href="https://produto.mercadolivre.com.br/${mlb}-furadeira"><script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    sku: mlb,
    name: titulo,
    url: `https://produto.mercadolivre.com.br/${mlb}-furadeira`,
    offers: { url: `https://produto.mercadolivre.com.br/${mlb}-furadeira` },
    image: [imagem]
  })}</script>${extra}`;
}

function storageFake(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => Object.assign(dados, valor),
    remove: async chave => { delete dados[chave]; }
  };
}

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes("mlstatic.com")
    ? resposta(String(url), { contentType: "image/jpeg" })
    : resposta(String(url), { body: htmlProduto() });
  const resolver = require("../optimus-capture/local-worker/mercadolivre-identity.js");
  try {
    const resultado = await resolver.resolver({
      productId: "MLB123456789",
      sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789-furadeira"
    });
    assert.strictEqual(resultado.capability, "ml_identity_v1");
    assert.strictEqual(resultado.identidadeValidada, true);
    assert.strictEqual(resultado.expectedMlb, "MLB123456789");
    assert.strictEqual(resultado.observedMlb, "MLB123456789");
    assert.strictEqual(resultado.tituloOficial, "Furadeira Parafusadeira Bosch GSR 120-LI 12V");
    assert.match(resultado.imagemOficial, /\.mlstatic\.com\//);
    assert.strictEqual(resultado.provaTecnica.sameProductObject, true);
    assert.strictEqual(Object.hasOwn(resultado, "html"), false);

    assert.throws(() => resolver.extrair(
      htmlProduto({ titulo: "Produto factual A" }) + `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", sku: "MLB123456789", name: "Produto factual B", image: "https://http2.mlstatic.com/B.jpg" })}</script>`,
      "MLB123456789",
      "https://produto.mercadolivre.com.br/MLB123456789-furadeira"
    ), /ml_identity_products_conflitantes/);

    assert.throws(() => resolver.extrair(
      htmlProduto({ titulo: "Vendido por Loja Oficial no ML", imagem: "" }),
      "MLB123456789",
      "https://produto.mercadolivre.com.br/MLB123456789-furadeira"
    ), /ml_identity_sem_identidade_factual/);

    assert.throws(() => resolver.extrair(
      htmlProduto({ mlb: "MLB999999999" }),
      "MLB123456789",
      "https://produto.mercadolivre.com.br/MLB123456789-furadeira"
    ), /ml_identity_canonical_divergente|ml_identity_product_ausente/);

    assert.throws(() => resolver.extrair(
      `<link rel="canonical" href="https://produto.mercadolivre.com.br/MLB123456789-furadeira"><script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        sku: "MLB123456789",
        productID: "MLB999999999",
        name: "Furadeira Parafusadeira Bosch GSR 120-LI 12V",
        image: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg"
      })}</script>`,
      "MLB123456789",
      "https://produto.mercadolivre.com.br/MLB123456789-furadeira"
    ), /ml_identity_product_identificadores_conflitantes/);
  } finally {
    global.fetch = originalFetch;
  }

  const local = {};
  const session = {};
  let claims = 0;
  let results = 0;
  let heartbeats = 0;
  global.chrome = {
    storage: { local: storageFake(local), session: storageFake(session) },
    alarms: { get: (_nome, callback) => callback(null), create: () => undefined, onAlarm: { addListener: () => undefined } }
  };
  global.OptimusLocalWorkerClient = {
    CAPABILITY: "magalu_image_v1",
    ML_CAPABILITY: "ml_image_v1",
    ML_IDENTITY_CAPABILITY: "ml_identity_v1",
    bootstrap: async () => ({ token: "worker-token", workerId: "worker-identity" }),
    claim: async () => {
      claims += 1;
      return { task: { id: "identity-1", type: "identidade_oficial", marketplace: "mercadolivre", productId: "MLB123456789", sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789-furadeira", capability: "ml_identity_v1", leaseToken: "lease-identity" } };
    },
    heartbeat: async () => { heartbeats += 1; return { ok: true }; },
    result: async (_task, payload) => {
      results += 1;
      assert.strictEqual(payload.capability, "ml_identity_v1");
      assert.strictEqual(payload.identidadeValidada, true);
      assert.strictEqual(payload.expectedMlb, "MLB123456789");
      assert.strictEqual(payload.observedMlb, "MLB123456789");
      assert.strictEqual(payload.tituloOficial, "Furadeira Parafusadeira Bosch GSR 120-LI 12V");
      assert.strictEqual(Object.hasOwn(payload, "preco"), false);
      assert.strictEqual(Object.hasOwn(payload, "linkAfiliado"), false);
      return { ok: true };
    },
    failure: async () => { throw new Error("failure_not_expected"); }
  };
  global.OptimusMercadoLivreIdentityResolver = {
    resolver: async ({ productId, sourceUrl }) => ({
      capability: "ml_identity_v1",
      contractVersion: 1,
      marketplace: "mercadolivre",
      expectedMlb: productId,
      observedMlb: productId,
      identidadeValidada: true,
      tituloOficial: "Furadeira Parafusadeira Bosch GSR 120-LI 12V",
      imagemOficial: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg",
      origemTitulo: "jsonld.name",
      origemImagem: "jsonld.image",
      finalUrl: sourceUrl,
      canonicalUrl: sourceUrl,
      variationId: "",
      collectedAt: new Date().toISOString(),
      provaTecnica: {
        capability: "ml_identity_v1",
        contractVersion: 1,
        source: "local_first_party",
        provenance: "local_worker.ml_identity_v1",
        expectedMlb: productId,
        observedMlb: productId,
        sameProductObject: true,
        finalUrl: sourceUrl,
        collectedAt: new Date().toISOString()
      }
    })
  };
  const runner = require("../optimus-capture/local-worker/task-runner.js");
  await runner.processar();
  assert.strictEqual(claims, 1);
  assert.ok(heartbeats >= 1);
  assert.strictEqual(results, 1);
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(session[runner.STORAGE_KEYS.LEASE], undefined);

  console.log("optimus-capture-local-worker-ml-identity.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
