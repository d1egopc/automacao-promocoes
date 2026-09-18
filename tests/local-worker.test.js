"use strict";

const assert = require("assert");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { planoRetryImagemMagaluLocal } = require("../modules/engine/importer/importer.service");

function respostaImagem({ status = 200, url = "https://a-static.mlcdn.com.br/imagens/produto.jpg", contentType = "image/jpeg" } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: nome => nome.toLowerCase() === "content-type" ? contentType : "" },
    body: { cancel: async () => undefined }
  };
}

function criarRepoFake() {
  const state = { task: { id: "1", type: "imagem_oficial", marketplace: "magalu", productId: "241382400", capability: "magalu_image_v1", status: "leased", claimed_by: "worker-1", lease_token: "lease-1", lease_until: new Date(Date.now() + 60000).toISOString() }, completed: null, failed: null };
  return {
    state,
    ensureSchema: async () => ({ ok: true }),
    autenticarWorker: async token => token === "community"
      ? ({ ok: true, workerId: "worker-community", ownerId: "owner-common", workerType: "community", capabilities: [] })
      : ({ ok: true, workerId: "worker-1", ownerId: "owner-1", workerType: "dedicated", capabilities: ["magalu_image_v1"] }),
    registrarWorkerDedicated: async payload => ({ ok: true, workerId: payload.workerId || "worker-1", workerType: "dedicated", capabilities: payload.capabilities || [], expiresAt: new Date(Date.now() + 60000).toISOString() }),
    registrarWorkerCommunity: async payload => ({ ok: true, workerId: payload.workerId || "worker-community", workerType: "community", capabilities: payload.capabilities || [], expiresAt: new Date(Date.now() + 60000).toISOString() }),
    revogarWorker: async payload => ({ ok: true, workerId: payload.workerId }),
    claim: async () => ({ ok: true, task: state.task }),
    heartbeat: async () => ({ ok: true }),
    obterTask: async () => state.task,
    obterTaskAtiva: async () => state.task,
    completar: async payload => { state.completed = payload; return { ok: true, idempotente: false }; },
    falhar: async payload => { state.failed = payload; return { ok: true }; },
    garantirTask: async payload => ({ ok: true, criada: true, task: { id: "2", status: "pending", capability: payload.capability } }),
    obterCache: async () => ({ source: "local_first_party", imageUrl: "https://a-static.mlcdn.com.br/imagens/produto.jpg" }),
    status: async () => ({ ok: true, counts: { pending: 1 } })
  };
}

(async () => {
  const repo = criarRepoFake();
  const service = criarLocalWorkerService({ repository: repo, dedicatedOwnerIds: ["owner-1"], magaluTechnicalSlug: "d1egopc", fetchFn: async () => respostaImagem() });
  const worker = await service.autenticar("token");
  assert.strictEqual((await service.claim({ worker })).task.productId, "241382400");
  assert.strictEqual((await service.heartbeat({ worker, taskId: "1", leaseToken: "lease-1" })).ok, true);
  const resultado = await service.resultado({
    worker,
    taskId: "1",
    leaseToken: "lease-1",
    marketplace: "magalu",
    productId: "241382400",
    imagemOficialUrl: "https://a-static.mlcdn.com.br/imagens/produto.jpg",
    provaTecnica: { trustLevel: "community", origem: "local_first_party", productId: "241382400", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "https://www.magazinevoce.com.br/d1egopc/produto/p/241382400/", hostFinal: "a-static.mlcdn.com.br" }
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(repo.state.completed.imageUrl, "https://a-static.mlcdn.com.br/imagens/produto.jpg");
  const dedicado = await service.registrarWorker({ ownerId: "owner-1", workerId: "dedicado", workerType: "community" });
  assert.strictEqual(dedicado.workerType, "dedicated", "o cliente nao escolhe o trust level");
  const comum = await service.registrarWorker({ ownerId: "owner-common", workerId: "comum", workerType: "dedicated" });
  assert.strictEqual(comum.workerType, "community", "owner fora da allowlist permanece community");
  const workerCommunity = await service.autenticar("community");
  await assert.rejects(() => service.claim({ worker: workerCommunity }), /worker_nao_autorizado/);
  assert.strictEqual((await service.revogar({ worker })).ok, true);
  await assert.rejects(() => service.resultado({ worker, taskId: "1", leaseToken: "lease-1", marketplace: "magalu", productId: "outro", imagemOficialUrl: "https://a-static.mlcdn.com.br/imagens/produto.jpg", provaTecnica: { origem: "local_first_party", productId: "outro", skuConfirmado: true, hrefConfirmado: true } }), /product_id_divergente/);
  await assert.rejects(() => service.resultado({ worker, taskId: "1", leaseToken: "lease-1", marketplace: "magalu", productId: "241382400", imagemOficialUrl: "https://a-static.mlcdn.com.br/imagens/produto.jpg", provaTecnica: { origem: "local_first_party", productId: "241382400", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "https://www.magazinevoce.com.br/d1egopc/produto/p/outro/" } }), /prova_href_produto_invalido/);
  await assert.rejects(() => service.resultado({ worker, taskId: "1", leaseToken: "lease-1", marketplace: "magalu", productId: "241382400", imagemOficialUrl: "https://evilmlcdn.com.br/imagens/produto.jpg", provaTecnica: { origem: "local_first_party", productId: "241382400", skuConfirmado: true, hrefConfirmado: true } }), /imagem_host_invalido/);
  const task = await service.garantirImagemMagalu({ productId: "241382400", sourceUrl: "https://www.magazineluiza.com.br/p/241382400/" });
  assert.strictEqual(task.task.capability, "magalu_image_v1");
  assert.strictEqual((await service.obterTaskImagemMagalu({ productId: "241382400" })).task.status, "leased");
  assert.strictEqual((await service.obterImagemCache({ marketplace: "magalu", productId: "241382400" })).source, "local_first_party");
  const repoHttp = criarRepoFake();
  const serviceHttp = criarLocalWorkerService({ repository: repoHttp, dedicatedOwnerIds: ["owner-1"], fetchFn: async () => respostaImagem({ status: 403, contentType: "text/html" }) });
  const workerHttp = await serviceHttp.autenticar("token");
  await assert.rejects(() => serviceHttp.resultado({ worker: workerHttp, taskId: "1", leaseToken: "lease-1", marketplace: "magalu", productId: "241382400", imagemOficialUrl: "https://a-static.mlcdn.com.br/imagens/produto.jpg", provaTecnica: { origem: "local_first_party", productId: "241382400", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "https://www.magazinevoce.com.br/d1egopc/produto/p/241382400/", hostFinal: "a-static.mlcdn.com.br" } }), /imagem_http_nao_confirmada/);
  assert.strictEqual(repoHttp.state.failed.motivo, "magalu_imagem_http_403");
  assert.strictEqual(planoRetryImagemMagaluLocal({ metadata: {} }, new Date("2026-01-01T00:00:00Z")).proximaTentativaEmMs, Date.parse("2026-01-01T00:00:30Z"));
  console.log("local-worker.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
