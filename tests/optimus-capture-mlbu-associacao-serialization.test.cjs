"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/mlbu-associacao-page.json");
const { validarResultadoMlIdentity } = require("../modules/local-worker/ml-identity.contract");

function storageFake(store, writes = null) {
  return {
    get: async key => ({ [key]: store[key] }),
    set: async value => {
      if (writes) writes.push(structuredClone(value));
      Object.assign(store, value);
    },
    remove: async key => { delete store[key]; }
  };
}

function resolverResult(item) {
  const collectedAt = new Date().toISOString();
  const provaTecnica = {
    capability: "ml_identity_v1",
    contractVersion: 1,
    source: "local_first_party",
    provenance: "local_worker.ml_identity_v1",
    expectedMlb: item.mlb,
    observedMlb: item.mlb,
    sameProductObject: true,
    finalUrl: item.finalUrl,
    canonicalUrl: item.canonicalUrl,
    variationId: item.variationId,
    collectedAt,
    associacaoPagina: { ...item.association },
    cookies: "must-not-cross-boundary",
    privateToken: "must-not-cross-boundary"
  };
  return {
    capability: "ml_identity_v1",
    contractVersion: 1,
    marketplace: "mercadolivre",
    expectedMlb: item.mlb,
    observedMlb: item.mlb,
    identidadeValidada: true,
    tituloOficial: item.title,
    imagemOficial: item.image,
    origemTitulo: "jsonld.name",
    origemImagem: "jsonld.image",
    finalUrl: item.finalUrl,
    canonicalUrl: item.canonicalUrl,
    variationId: item.variationId,
    collectedAt,
    provaTecnica
  };
}

test("MLBU association survives parser → stage → persisted state → POST", async () => {
  const local = {};
  const session = {};
  const localWrites = [];
  const sent = [];
  let claimIndex = 0;
  const originalChrome = global.chrome;
  const originalClient = global.OptimusLocalWorkerClient;
  const originalResolver = global.OptimusMercadoLivreIdentityResolver;
  global.chrome = {
    storage: { local: storageFake(local, localWrites), session: storageFake(session) },
    alarms: { get: (_name, callback) => callback(null), create: () => undefined, onAlarm: { addListener: () => undefined } }
  };
  global.OptimusLocalWorkerClient = {
    ML_IDENTITY_CAPABILITY: "ml_identity_v1",
    ML_CAPABILITY: "ml_image_v1",
    bootstrap: async () => ({ token: "redacted", workerId: "fixture-worker" }),
    claim: async () => {
      const item = fixture.cases[claimIndex++];
      if (!item) return null;
      return { task: { id: item.taskId, type: "identidade_oficial", marketplace: "mercadolivre", productId: item.mlb, sourceUrl: item.sourceUrl, capability: "ml_identity_v1", leaseToken: `lease-${item.taskId}` } };
    },
    heartbeat: async () => ({ ok: true }),
    result: async (_task, payload) => { sent.push(payload); return { ok: true }; },
    failure: async () => { throw new Error("unexpected_failure"); }
  };
  global.OptimusMercadoLivreIdentityResolver = {
    resolver: async ({ productId }) => resolverResult(fixture.cases.find(item => item.mlb === productId))
  };
  try {
    delete require.cache[require.resolve("../optimus-capture/local-worker/task-runner.js")];
    const runner = require("../optimus-capture/local-worker/task-runner.js");
    await runner.processar();
    await runner.processar();
    assert.equal(sent.length, 2);
    for (const [index, payload] of sent.entries()) {
      const item = fixture.cases[index];
      assert.ok(localWrites.some(write => write.optimus_local_worker_task_state_v1?.provaTecnica?.associacaoPagina
        && write.optimus_local_worker_task_state_v1.provaTecnica.associacaoPagina.mlb === item.mlb));
      assert.deepEqual(payload.provaTecnica.associacaoPagina, item.association);
      assert.equal(payload.provaTecnica.cookies, undefined);
      assert.equal(payload.provaTecnica.privateToken, undefined);
      assert.equal(payload.variationId, item.variationId);
      const accepted = validarResultadoMlIdentity(payload, {
        expectedMlb: item.mlb,
        sourceUrl: item.sourceUrl,
        variationId: item.variationId,
        agoraMs: Date.now()
      });
      assert.equal(accepted.associacaoPagina.mlb, item.mlb);
      assert.equal(accepted.associacaoPagina.pageMlbu, item.mlbu);

      assert.throws(() => validarResultadoMlIdentity({ ...payload, associacaoPagina: undefined, provaTecnica: { ...payload.provaTecnica, associacaoPagina: undefined } }, {
        expectedMlb: item.mlb, sourceUrl: item.sourceUrl, variationId: item.variationId, agoraMs: Date.now()
      }), /ml_identity_final_url_invalida/);
      assert.throws(() => validarResultadoMlIdentity({ ...payload, observedMlb: "MLB9999999999" }, {
        expectedMlb: item.mlb, sourceUrl: item.sourceUrl, variationId: item.variationId, agoraMs: Date.now()
      }), /ml_identity_mlb_divergente/);
      assert.throws(() => validarResultadoMlIdentity({ ...payload, collectedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() }, {
        expectedMlb: item.mlb, sourceUrl: item.sourceUrl, variationId: item.variationId, agoraMs: Date.now()
      }), /ml_identity_resultado_stale/);
    }
  } finally {
    global.chrome = originalChrome;
    global.OptimusLocalWorkerClient = originalClient;
    global.OptimusMercadoLivreIdentityResolver = originalResolver;
  }
});
