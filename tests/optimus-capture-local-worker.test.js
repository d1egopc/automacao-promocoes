"use strict";

const assert = require("assert");
const resolver = require("../optimus-capture/local-worker/magalu-image.js");

function storageFake(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => Object.assign(dados, valor),
    remove: async chave => { delete dados[chave]; }
  };
}

const html = `
<a href="https://www.magazinevoce.com.br/d1egopc/produto/p/241382400/">
  <img src="https://a-static.mlcdn.com.br/600x600/produto.jpg">
</a>
<a href="https://www.magazinevoce.com.br/d1egopc/outro/p/outro-id/">
  <img src="https://a-static.mlcdn.com.br/1200x1200/outro.jpg">
</a>`;

const encontrado = resolver.parse(html, "241382400");
assert.strictEqual(encontrado.skuConfirmado, true);
assert.strictEqual(encontrado.hrefConfirmado, true);
assert.strictEqual(encontrado.imagem, "https://a-static.mlcdn.com.br/600x600/produto.jpg");
assert.strictEqual(resolver.hostMlcdn("https://mlcdn.com.br/imagem.jpg"), true);
assert.strictEqual(resolver.hostMlcdn("https://a-static.mlcdn.com.br/imagem.jpg"), true);
assert.strictEqual(resolver.hostMlcdn("https://evilmlcdn.com.br/imagem.jpg"), false);
assert.strictEqual(resolver.hostMlcdn("https://mlcdn.com.br.evil.com/imagem.jpg"), false);
assert.strictEqual(resolver.parse(`<a href="https://www.magazinevoce.com.br/d1egopc/produto/p/jf4hfkkde1/"><img src="https://a-static.mlcdn.com.br/320x320/item.jpg"></a>`, "jf4hfkkde1").hrefConfirmado, true);
assert.strictEqual(resolver.parse(`<a href="https://www.magazinevoce.com.br/d1egopc/produto/p/outro/"><img src="https://a-static.mlcdn.com.br/320x320/item.jpg"></a>`, "jf4hfkkde1").hrefConfirmado, false);

const respostaBusca = { status: 200, ok: true, url: "https://www.magazinevoce.com.br/d1egopc/busca/241382400/", text: async () => html, body: { cancel: async () => undefined } };
const respostaImagem = { status: 200, ok: true, url: "https://a-static.mlcdn.com.br/600x600/produto.jpg", headers: { get: () => "image/jpeg" }, body: { cancel: () => undefined } };
const fetchAnterior = global.fetch;
global.fetch = async url => String(url).includes("/busca/") ? respostaBusca : respostaImagem;

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
  claim: async () => { claims += 1; return { task: { id: "1", type: "imagem_oficial", marketplace: "magalu", productId: "241382400", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: "lease" } }; },
  heartbeat: async () => { heartbeats += 1; return { ok: true }; },
  result: async (_task, payload) => { results += 1; assert.strictEqual(payload.productId, "241382400"); return { ok: true }; },
  failure: async () => { throw new Error("failure_not_expected"); }
};
let slugRecebido = "";
global.OptimusMagaluLocalResolver = {
  identificar: async ({ productId, slugWorkspace }) => {
    slugRecebido = slugWorkspace;
    return { imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/produto.jpg", provaTecnica: { origem: "local_first_party", source: "magazinevoce_busca", productId, skuConfirmado: true, hrefConfirmado: true, hrefProduto: `https://www.magazinevoce.com.br/d1egopc/produto/p/${productId}/` } };
  },
  provarImagem: async ({ productId, imagemOficialUrl, provaTecnica }) => ({ imagemOficialUrl, provaTecnica: { ...provaTecnica, productId, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } })
};
const runner = require("../optimus-capture/local-worker/task-runner.js");

(async () => {
  const identificada = await resolver.identificar({ productId: "241382400", slugWorkspace: "d1egopc" });
  assert.strictEqual(identificada.provaTecnica.hrefProduto, "https://www.magazinevoce.com.br/d1egopc/produto/p/241382400/");
  const prova = await resolver.provarImagem({ productId: "241382400", imagemOficialUrl: identificada.imagemOficialUrl, provaTecnica: identificada.provaTecnica });
  assert.strictEqual(prova.provaTecnica.hostFinal, "a-static.mlcdn.com.br");
  global.fetch = fetchAnterior;

  await Promise.all([runner.processar(), runner.processar()]);
  assert.strictEqual(claims, 1);
  assert.strictEqual(results, 1);
  assert.strictEqual(slugRecebido, "d1egopc");
  assert.strictEqual(heartbeats, 2);
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(session[runner.STORAGE_KEYS.LEASE], undefined);
  assert(local[runner.STORAGE_KEYS.BREADCRUMBS].length <= runner.MAX_BREADCRUMBS);
  assert(!JSON.stringify(local).includes("lease"), "lease token nao pode ir ao storage.local");

  let failurePayload = null;
  global.OptimusLocalWorkerClient.claim = async () => ({ task: { id: "2", type: "imagem_oficial", marketplace: "magalu", productId: "241382400", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: "lease-2" } });
  global.OptimusLocalWorkerClient.failure = async (_task, payload) => { failurePayload = payload; return { ok: true }; };
  global.OptimusMagaluLocalResolver.identificar = async () => { throw new Error("magalu_imagem_busca_captcha"); };
  await runner.processar();
  assert.strictEqual(failurePayload.motivo, "magalu_imagem_busca_captcha");
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);

  console.log("optimus-capture-local-worker.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
