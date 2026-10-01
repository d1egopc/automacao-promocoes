"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ml-work-backend-order-"));

const databasePath = require.resolve("../modules/engine/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryEngine: async sql => {
      if (/INSERT INTO engine_ofertas/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: 9001, uuid: "uuid-9001" }] } };
      }
      if (/UPDATE engine_ofertas\s+SET metadata/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: 9001 }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  }
};

const importer = require("../modules/engine/importer/importer.service");
const productId = "MLB123456789";
const productUrl = "https://produto.mercadolivre.com.br/MLB-123456789-produto";
const imageUrl = "https://http2.mlstatic.com/D_NQ_NP_123456789-MLB.jpg";
const affiliateUrl = "https://meli.la/afiliado-existente?tag=tag-ml&publisher=publisher-ml";
let sequence = 0;

function cacheValido(overrides = {}) {
  const now = Date.now();
  return {
    marketplace: "mercadolivre",
    productId,
    imageUrl,
    validatedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
    proof: {
      provenance: "local_worker.ml_image_v1",
      productIdObserved: productId,
      sameProductObject: true,
      checkedAt: new Date(now - 1000).toISOString()
    },
    ...overrides
  };
}

function offer(image = "") {
  return {
    ok: true,
    marketplace: "mercadolivre",
    titulo: "Produto ML comprovado",
    preco: 99.9,
    imagem: image,
    imagemOrigem: image ? "produto.imagem" : "",
    linkOriginal: productUrl,
    linkExpandido: productUrl,
    linkAfiliado: affiliateUrl,
    produtoIdDetectado: productId,
    metadata: { adapter: "mercadolivre", tag: "tag-ml", publisher: "publisher-ml", produto: { produtoId: productId } }
  };
}

async function run({ image = "", cache = null, backendImage = false, token = "", taskOk = true, task = null } = {}) {
  const id = ++sequence;
  const order = [];
  const oldFetch = global.fetch;
  const oldLog = console.log;
  global.fetch = async url => {
    order.push(`backend:${new URL(String(url)).hostname}`);
    if (String(url).includes("api.mercadolibre.com")) {
      return { status: 200, json: async () => ({ id: productId, pictures: [{ secure_url: imageUrl }] }) };
    }
    return {
      status: backendImage ? 200 : 404,
      url: productUrl,
      text: async () => backendImage
        ? `<script type="application/ld+json">{"@type":"Product","productID":"${productId}","image":"${imageUrl}"}</script>`
        : ""
    };
  };
  console.log = () => {};
  try {
    const result = await importer.gravarOfertaEngine(
      { id: 10000 + id, evento_id: 20000 + id, cliente_id: "workspace_ml", marketplace: "mercadolivre" },
      { id: 20000 + id, metadata: {}, links_extraidos: [] },
      { url_original: productUrl, url_expandida: productUrl },
      offer(image),
      {
        obterImagemCacheLocalWorker: async () => { order.push("work:cache"); return cache; },
        garantirImagemMercadoLivreLocalWorker: async () => {
          order.push("work:task");
          return task || (taskOk ? { ok: true, task: { id: 30000 + id, status: "pending" } } : { ok: false });
        },
        ...(token ? { getIntegracaoCliente: () => ({ credenciais: { accessToken: token } }) } : {})
      }
    );
    return { result, order };
  } finally {
    global.fetch = oldFetch;
    console.log = oldLog;
  }
}

(async () => {
  const existing = await run({ image: imageUrl });
  assert.strictEqual(existing.result.ok, true);
  assert.deepStrictEqual(existing.order, []);
  assert.strictEqual(existing.result.oferta.linkAfiliado, affiliateUrl);

  const cached = await run({ cache: cacheValido() });
  assert.strictEqual(cached.result.ok, true);
  assert.strictEqual(cached.result.oferta.imagem, imageUrl);
  assert.deepStrictEqual(cached.order, ["work:cache"]);
  assert.strictEqual(cached.result.oferta.linkAfiliado, affiliateUrl);

  const recovered = await run({ backendImage: true });
  assert.strictEqual(recovered.result.ok, true);
  assert.strictEqual(recovered.result.oferta.imagem, imageUrl);
  assert.deepStrictEqual(recovered.order.slice(0, 2), ["work:cache", "work:task"]);
  assert.strictEqual(recovered.order.filter(step => step === "work:task").length, 1);
  assert.strictEqual(recovered.order.filter(step => step.startsWith("backend:")).length, 1);
  assert.strictEqual(recovered.result.oferta.linkAfiliado, affiliateUrl);
  const contratoEsperado = {
    linkAfiliado: affiliateUrl,
    tag: "tag-ml",
    publisher: "publisher-ml",
    preco: 99.9,
    linkOriginal: productUrl
  };
  const contrato = resultado => ({
    linkAfiliado: resultado.oferta.linkAfiliado,
    tag: resultado.oferta.metadata.tag,
    publisher: resultado.oferta.metadata.publisher,
    preco: resultado.oferta.preco,
    linkOriginal: resultado.oferta.linkOriginal
  });
  assert.deepStrictEqual(contrato(cached.result), contratoEsperado, "Work preserva contrato comercial do HEAD");
  assert.deepStrictEqual(contrato(recovered.result), contratoEsperado, "fallback preserva contrato comercial do HEAD");
  for (const resultado of [cached.result, recovered.result]) {
    const linkFinal = new URL(resultado.oferta.linkAfiliado);
    assert.strictEqual(linkFinal.searchParams.get("tag"), "tag-ml");
    assert.strictEqual(linkFinal.searchParams.get("publisher"), "publisher-ml");
  }

  const pending = await run();
  assert.strictEqual(pending.result.ok, false);
  assert.strictEqual(pending.result.retriavel, true);
  assert.strictEqual(pending.result.localWorker.productId, productId);
  assert.deepStrictEqual(pending.order.slice(0, 2), ["work:cache", "work:task"]);
  assert(pending.order.some(step => step.startsWith("backend:")));
  assert(!pending.order.some(step => step === "backend:api.mercadolibre.com"));

  const terminal = await run({ backendImage: true, taskOk: false });
  assert.strictEqual(terminal.result.ok, true);
  assert.strictEqual(terminal.result.oferta.imagem, imageUrl);
  assert.strictEqual(terminal.result.oferta.linkAfiliado, affiliateUrl);

  const wrongProduct = await run({ cache: cacheValido({ productId: "MLB987654321" }) });
  assert.strictEqual(wrongProduct.result.ok, false);
  assert.strictEqual(wrongProduct.result.retriavel, true);
  assert(wrongProduct.order.includes("work:task"));
  assert.strictEqual(importer.resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: productId, tipoIdentidade: "mlb" },
    mlbsMetadata: ["MLB987654321"],
    sourceUrl: productUrl
  }).motivo, "identidade_divergente");

  const withToken = await run({ token: "existing-token" });
  assert.strictEqual(withToken.result.ok, true);
  assert.strictEqual(withToken.result.oferta.imagem, imageUrl);
  assert.strictEqual(withToken.order.filter(step => step === "backend:api.mercadolibre.com").length, 1);

  console.log("mercadolivre-work-backend-order.test.js ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
