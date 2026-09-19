"use strict";

const assert = require("assert");
const resolver = require("../optimus-capture/local-worker/magalu-image.js");

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

let claims = 0;
let results = 0;
global.chrome = { alarms: { create: () => undefined, onAlarm: { addListener: () => undefined } } };
global.OptimusLocalWorkerClient = {
  CAPABILITY: "magalu_image_v1",
  claim: async () => { claims += 1; return { task: { id: "1", marketplace: "magalu", productId: "241382400", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: "lease" } }; },
  result: async (_task, payload) => { results += 1; assert.strictEqual(payload.productId, "241382400"); return { ok: true }; },
  failure: async () => { throw new Error("failure_not_expected"); }
};
let slugRecebido = "";
global.OptimusMagaluLocalResolver = { resolver: async ({ productId, slugWorkspace }) => { slugRecebido = slugWorkspace; return { imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/produto.jpg", provaTecnica: { origem: "local_first_party", productId, skuConfirmado: true, hrefConfirmado: true } }; } };
const runner = require("../optimus-capture/local-worker/task-runner.js");
(async () => {
  const prova = await resolver.resolver({ productId: "241382400", slugWorkspace: "d1egopc" });
  assert.strictEqual(prova.provaTecnica.hrefProduto, "https://www.magazinevoce.com.br/d1egopc/produto/p/241382400/");
  global.fetch = fetchAnterior;
  await Promise.all([runner.processar(), runner.processar()]);
  assert.strictEqual(claims, 1);
  assert.strictEqual(results, 1);
  assert.strictEqual(slugRecebido, "d1egopc");
  const logs = [];
  const consoleInfoAnterior = console.info;
  let failurePayload = null;
  console.info = (...args) => logs.push(args);
  try {
    global.OptimusLocalWorkerClient.claim = async () => ({ task: { id: "2", marketplace: "magalu", productId: "241382400", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: "lease-2" } });
    global.OptimusLocalWorkerClient.failure = async (_task, payload) => { failurePayload = payload; return { ok: true }; };
    global.OptimusMagaluLocalResolver.resolver = async () => { throw new Error("magalu_imagem_busca_captcha"); };
    await runner.processar();
  } finally {
    console.info = consoleInfoAnterior;
  }
  assert.strictEqual(failurePayload.motivo, "magalu_imagem_busca_captcha");
  assert(logs.some(args => args[0] === "[LOCAL-WORKER-TASK-INICIO]"));
  assert(logs.some(args => args[0] === "[LOCAL-WORKER-FAILURE]"));
  const logsFailureTransporte = [];
  console.info = (...args) => logsFailureTransporte.push(args);
  try {
    global.OptimusLocalWorkerClient.claim = async () => ({ task: { id: "3", marketplace: "magalu", productId: "241382400", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: "lease-3" } });
    global.OptimusLocalWorkerClient.failure = async () => { throw new Error("failure_transport_timeout"); };
    await runner.processar();
  } finally {
    console.info = consoleInfoAnterior;
  }
  assert(logsFailureTransporte.some(args => args[0] === "[LOCAL-WORKER-ERRO]"));
  console.log("optimus-capture-local-worker.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
