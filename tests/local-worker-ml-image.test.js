"use strict";

const assert = require("assert");
const resolver = require("../optimus-capture/local-worker/mercadolivre-image.js");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");

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

(async () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    sku: "MLB123456789",
    offers: { url: "https://produto.mercadolivre.com.br/MLB123456789" },
    image: ["https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLB123456789.jpg"]
  })}</script>`;
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes("mlstatic.com")
    ? resposta(String(url), { contentType: "image/jpeg", body: "" })
    : resposta(String(url), { body: html });
  try {
    const resultado = await resolver.resolver({
      productId: "MLB123456789",
      sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789"
    });
    assert.strictEqual(resultado.productId, "MLB123456789");
    assert.strictEqual(resultado.provaTecnica.provenance, "local_worker.ml_image_v1");
    assert.strictEqual(resultado.provaTecnica.productIdObserved, "MLB123456789");
    assert.strictEqual(resultado.provaTecnica.sameProductObject, true);
    assert.match(resultado.imagemOficialUrl, /\.mlstatic\.com\//);

    await assert.rejects(() => resolver.resolver({
      productId: "MLB999999999",
      sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789"
    }), /ml_identidade_incompleta/);
  } finally {
    global.fetch = originalFetch;
  }

  const state = {
    task: {
      id: "1",
      type: "imagem_oficial",
      marketplace: "mercadolivre",
      productId: "MLB123456789",
      capability: "ml_image_v1",
      status: "leased",
      claimed_by: "worker-1",
      lease_token: "lease-1",
      lease_until: new Date(Date.now() + 60_000).toISOString()
    },
    completed: null
  };
  let guaranteeArgs = null;
  const repo = {
    autenticarWorker: async () => ({ ok: true, workerId: "worker-1", ownerId: "owner-1", workerType: "dedicated", capabilities: ["ml_image_v1"] }),
    obterTask: async () => state.task,
    completar: async payload => { state.completed = payload; return { ok: true }; },
    falhar: async () => ({ ok: true }),
    garantirTask: async payload => { guaranteeArgs = payload; return { ok: true, criada: true, task: { ...state.task, status: "pending", capability: payload.capability } }; },
    obterCache: async () => null
  };
  const service = criarLocalWorkerService({
    repository: repo,
    dedicatedOwnerIds: ["owner-1"],
    fetchFn: async url => resposta(url, { contentType: "image/jpeg" })
  });
  const ensured = await service.garantirImagemMercadoLivre({ productId: "MLB123456789", sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789" });
  assert.strictEqual(ensured.ok, true);
  assert.strictEqual(guaranteeArgs.capability, "ml_image_v1");
  assert.strictEqual(guaranteeArgs.reutilizarCompleted, false);
  const worker = await service.autenticar("token");
  const result = await service.resultado({
    worker,
    taskId: "1",
    leaseToken: "lease-1",
    capability: "ml_image_v1",
    marketplace: "mercadolivre",
    productId: "MLB123456789",
    imagemOficialUrl: "https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLB123456789.jpg",
    finalUrl: "https://produto.mercadolivre.com.br/MLB123456789",
    checkedAt: new Date().toISOString(),
    provaTecnica: {
      source: "local_first_party",
      provenance: "local_worker.ml_image_v1",
      productIdObserved: "MLB123456789",
      sameProductObject: true,
      finalUrl: "https://produto.mercadolivre.com.br/MLB123456789"
    }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.completed.proof.productId, "MLB123456789");
  const payloadBase = {
    worker,
    taskId: "1",
    leaseToken: "lease-1",
    capability: "ml_image_v1",
    marketplace: "mercadolivre",
    productId: "MLB123456789",
    imagemOficialUrl: "https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLB123456789.jpg",
    finalUrl: "https://produto.mercadolivre.com.br/MLB123456789",
    provaTecnica: { source: "local_first_party", provenance: "local_worker.ml_image_v1", productIdObserved: "MLB123456789", sameProductObject: true }
  };
  await assert.rejects(() => service.resultado({
    worker,
    taskId: "1",
    leaseToken: "lease-1",
    capability: "ml_image_v1",
    marketplace: "mercadolivre",
    productId: "MLB000000000",
    imagemOficialUrl: "https://http2.mlstatic.com/item.jpg",
    finalUrl: "https://produto.mercadolivre.com.br/MLB123456789",
    checkedAt: new Date().toISOString(),
    provaTecnica: { source: "local_first_party", provenance: "local_worker.ml_image_v1", productIdObserved: "MLB123456789", sameProductObject: true }
  }), /product_id_divergente/);
  await assert.rejects(() => service.resultado({ ...payloadBase, checkedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() }), /resultado_ml_stale/);
  await assert.rejects(() => service.resultado({ ...payloadBase, imagemOficialUrl: "https://evil.example/image.jpg", checkedAt: new Date().toISOString() }), /imagem_host_invalido/);
  await assert.rejects(() => service.resultado({ ...payloadBase, finalUrl: "https://produto.mercadolivre.com.br/MLB987654321", checkedAt: new Date().toISOString() }), /prova_final_url_invalida/);
  console.log("local-worker-ml-image.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
