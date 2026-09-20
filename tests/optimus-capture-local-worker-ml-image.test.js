"use strict";

const assert = require("assert");

function storageFake(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => Object.assign(dados, valor),
    remove: async chave => { delete dados[chave]; }
  };
}

const local = {};
const session = {};
let claims = 0;
let heartbeats = 0;
let results = 0;

global.chrome = {
  storage: { local: storageFake(local), session: storageFake(session) },
  alarms: { get: (_nome, callback) => callback(null), create: () => undefined, onAlarm: { addListener: () => undefined } }
};
global.OptimusLocalWorkerClient = {
  CAPABILITY: "magalu_image_v1",
  ML_CAPABILITY: "ml_image_v1",
  bootstrap: async () => ({ token: "worker-token", workerId: "worker-ml" }),
  claim: async () => {
    claims += 1;
    return { task: { id: "ml-1", type: "imagem_oficial", marketplace: "mercadolivre", productId: "MLB123456789", sourceUrl: "https://produto.mercadolivre.com.br/MLB123456789", capability: "ml_image_v1", leaseToken: "lease-ml" } };
  },
  heartbeat: async () => { heartbeats += 1; return { ok: true }; },
  result: async (_task, payload) => {
    results += 1;
    assert.strictEqual(payload.capability, "ml_image_v1");
    assert.strictEqual(payload.marketplace, "mercadolivre");
    assert.strictEqual(payload.productId, "MLB123456789");
    assert.strictEqual(payload.provaTecnica.provenance, "local_worker.ml_image_v1");
    assert.strictEqual(payload.provaTecnica.productIdObserved, "MLB123456789");
    return { ok: true };
  },
  failure: async () => { throw new Error("failure_not_expected"); }
};
global.OptimusMercadoLivreLocalResolver = {
  resolver: async ({ productId, sourceUrl }) => ({
    capability: "ml_image_v1",
    marketplace: "mercadolivre",
    productId,
    imagemOficialUrl: "https://http2.mlstatic.com/D_NQ_NP_123-MLB123456789.jpg",
    finalUrl: sourceUrl,
    checkedAt: new Date().toISOString(),
    provaTecnica: {
      source: "local_first_party",
      provenance: "local_worker.ml_image_v1",
      productIdObserved: productId,
      sameProductObject: true,
      finalUrl: sourceUrl,
      checkedAt: new Date().toISOString()
    }
  })
};

const runner = require("../optimus-capture/local-worker/task-runner.js");

(async () => {
  await runner.processar();
  assert.strictEqual(claims, 1);
  assert.strictEqual(heartbeats, 2);
  assert.strictEqual(results, 1);
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(session[runner.STORAGE_KEYS.LEASE], undefined);
  console.log("optimus-capture-local-worker-ml-image.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
