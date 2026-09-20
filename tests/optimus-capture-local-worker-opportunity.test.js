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
let taskAtual = null;
let resultPayload = null;
let failurePayload = null;
let imageCalls = 0;
let opportunityCalls = 0;

global.chrome = {
  storage: { local: storageFake(local), session: storageFake(session) },
  alarms: { get: (_nome, callback) => callback(null), create: () => undefined, onAlarm: { addListener: () => undefined } }
};
global.OptimusLocalWorkerClient = {
  CAPABILITY: "magalu_image_v1",
  OPPORTUNITY_CAPABILITY: "magalu_opportunity_v1",
  CAPABILITIES: ["magalu_image_v1", "magalu_opportunity_v1"],
  bootstrap: async () => ({ workerId: "worker-1", token: "token" }),
  claim: async () => ({ ok: true, task: taskAtual }),
  heartbeat: async () => ({ ok: true }),
  result: async (_task, payload) => { resultPayload = payload; return { ok: true }; },
  failure: async (_task, payload) => { failurePayload = payload; return { ok: true }; }
};
global.OptimusMagaluLocalResolver = {
  identificar: async () => { imageCalls += 1; throw new Error("imagem_nao_deveria_ser_chamada"); },
  provarImagem: async () => { imageCalls += 1; throw new Error("imagem_nao_deveria_ser_chamada"); }
};
global.OptimusMagaluOpportunityResolver = {
  URL_OFICIAL: "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/",
  verificar: async () => {
    opportunityCalls += 1;
    return { accessible: true, indicatorFound: true, finalUrl: "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/", checkedAt: new Date().toISOString() };
  }
};

delete require.cache[require.resolve("../optimus-capture/local-worker/task-runner.js")];
const runner = require("../optimus-capture/local-worker/task-runner.js");

function task(id) {
  return {
    id,
    type: "oportunidade_oficial",
    marketplace: "magalu",
    productId: "ofertasdodiamundo",
    sourceUrl: "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/",
    capability: "magalu_opportunity_v1",
    leaseToken: `lease-${id}`,
    attempts: 1
  };
}

(async () => {
  taskAtual = null;
  await runner.processar();
  assert.strictEqual(opportunityCalls, 0, "sem task não existe consulta Magazine Luiza adicional");
  assert.strictEqual(imageCalls, 0, "capability ociosa não toca o resolver de imagem");

  taskAtual = task("20");
  await runner.processar();
  assert.strictEqual(resultPayload.capability, "magalu_opportunity_v1");
  assert.strictEqual(resultPayload.accessible, true);
  assert.strictEqual(resultPayload.indicatorFound, true);
  assert.strictEqual(resultPayload.finalUrl, global.OptimusMagaluOpportunityResolver.URL_OFICIAL);
  assert.strictEqual(imageCalls, 0, "capability de oportunidade não usa resolver de imagem");
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(session[runner.STORAGE_KEYS.LEASE], undefined);

  resultPayload = null;
  taskAtual = task("21");
  global.OptimusMagaluOpportunityResolver.verificar = async () => {
    opportunityCalls += 1;
    return { accessible: false, indicatorFound: false, finalUrl: global.OptimusMagaluOpportunityResolver.URL_OFICIAL, checkedAt: new Date().toISOString(), reason: "magalu_oportunidade_challenge" };
  };
  await runner.processar();
  assert.strictEqual(resultPayload, null);
  assert.strictEqual(failurePayload.motivo, "magalu_oportunidade_challenge");
  assert.strictEqual(failurePayload.metadata.accessible, false);
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);

  console.log("optimus-capture-local-worker-opportunity.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
