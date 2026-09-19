"use strict";

const assert = require("assert");
const modulo = require.resolve("../optimus-capture/local-worker/task-runner.js");

function storageFake(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => { Object.assign(dados, JSON.parse(JSON.stringify(valor))); },
    remove: async chave => { delete dados[chave]; }
  };
}

function ambiente() {
  const local = {};
  const session = {};
  global.chrome = {
    storage: { local: storageFake(local), session: storageFake(session) },
    alarms: {
      get: (_nome, callback) => callback(null),
      create: () => {},
      onAlarm: { addListener: () => {} }
    }
  };
  return { local, session };
}

function recarregar() {
  delete require.cache[modulo];
  return require(modulo);
}

function task(id = "401") {
  return {
    id,
    type: "imagem_oficial",
    marketplace: "magalu",
    productId: "afh3e1g80j",
    technicalSlug: "d1egopc",
    capability: "magalu_image_v1",
    leaseToken: `lease-${id}`,
    attempts: 1
  };
}

function identificado() {
  return {
    imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg",
    provaTecnica: {
      origem: "local_first_party",
      source: "magazinevoce_busca",
      productId: "afh3e1g80j",
      skuConfirmado: true,
      hrefConfirmado: true,
      hrefProduto: "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/"
    }
  };
}

function abortError(mensagem) {
  const erro = new Error(mensagem);
  erro.name = "AbortError";
  erro.codigo = mensagem;
  return erro;
}

function contadores() {
  return { claim: 0, heartbeat: 0, identify: 0, probe: 0, result: 0, failure: 0 };
}

function clientBase(c, tarefa = task()) {
  return {
    CAPABILITY: "magalu_image_v1",
    claim: async () => { c.claim += 1; return { task: tarefa }; },
    heartbeat: async () => { c.heartbeat += 1; return { ok: true }; },
    result: async () => { c.result += 1; return { ok: true }; },
    failure: async () => { c.failure += 1; return { ok: true }; }
  };
}

async function timeoutIsoladoRetoma() {
  const env = ambiente();
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c);
  global.OptimusMagaluLocalResolver = {
    identificar: async () => {
      c.identify += 1;
      if (c.identify === 1) throw abortError("magalu_busca_timeout");
      return identificado();
    },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => {
      c.probe += 1;
      return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } };
    }
  };
  const runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.RESOLVING_PAGE);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].noProgressCount, 1);
  await runner.processar();
  assert.strictEqual(c.identify, 2);
  assert.strictEqual(c.result, 1);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
}

async function resolvingPageRelinquish() {
  const env = ambiente();
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("402"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; throw abortError("magalu_busca_timeout"); },
    provarImagem: async () => identificado()
  };
  const runner = recarregar();
  await runner.processar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].noProgressCount, 2);
  const heartbeatAntes = c.heartbeat;
  await runner.processar();
  assert.strictEqual(c.heartbeat, heartbeatAntes, "budget esgotado deve impedir novo heartbeat");
  assert.strictEqual(c.identify, 2);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(env.session[runner.STORAGE_KEYS.LEASE], undefined);
  assert(env.local[runner.STORAGE_KEYS.BREADCRUMBS].some(item => item.stage === "LIVENESS_EXHAUSTED" && item.taskStage === runner.STAGES.RESOLVING_PAGE));
}

async function stageAgeRelinquishAntesDoHeartbeat() {
  const env = ambiente();
  const c = contadores();
  const tarefa = task("403");
  const runner = recarregar();
  env.local[runner.STORAGE_KEYS.STATE] = {
    version: 2,
    stage: runner.STAGES.RESOLVING_PAGE,
    task: { ...tarefa, leaseToken: undefined, attempt: 1 },
    stageEnteredAt: new Date(Date.now() - runner.LIVENESS.maxStageAgeMs - 1000).toISOString(),
    lastProgressAt: new Date(Date.now() - runner.LIVENESS.maxStageAgeMs - 1000).toISOString(),
    noProgressCount: 0,
    updatedAt: new Date().toISOString()
  };
  env.session[runner.STORAGE_KEYS.LEASE] = { taskId: tarefa.id, leaseToken: tarefa.leaseToken };
  global.OptimusLocalWorkerClient = clientBase(c, tarefa);
  global.OptimusMagaluLocalResolver = { identificar: async () => identificado(), provarImagem: async () => identificado() };
  await runner.processar();
  assert.strictEqual(c.heartbeat, 0);
  assert.strictEqual(c.identify, 0);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
}

async function imageIdentifiedRelinquish() {
  const env = ambiente();
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("404"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificado(); },
    provarImagem: async () => { c.probe += 1; throw abortError("magalu_imagem_timeout"); }
  };
  const runner = recarregar();
  await runner.processar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.IMAGE_IDENTIFIED);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].noProgressCount, 2);
  const heartbeatAntes = c.heartbeat;
  await runner.processar();
  assert.strictEqual(c.heartbeat, heartbeatAntes);
  assert.strictEqual(c.identify, 1);
  assert.strictEqual(c.probe, 2);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
}

async function failurePendingPreservaOrigemERelinquish() {
  const env = ambiente();
  const c = contadores();
  const client = clientBase(c, task("405"));
  client.heartbeat = async () => {
    c.heartbeat += 1;
    if (c.heartbeat === 1) return { ok: true };
    throw abortError("Failed_to_fetch");
  };
  global.OptimusLocalWorkerClient = client;
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; throw new Error("magalu_produto_divergente"); },
    provarImagem: async () => identificado()
  };
  const runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.FAILURE_PENDING);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].lastTechnicalError, "magalu_produto_divergente");
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].noProgressCount, 2);
  const heartbeatAntes = c.heartbeat;
  await runner.processar();
  assert.strictEqual(c.heartbeat, heartbeatAntes);
  assert.strictEqual(c.failure, 0, "failure antigo não deve ser enviado sem lease confirmada");
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  const breadcrumbs = env.local[runner.STORAGE_KEYS.BREADCRUMBS];
  assert(breadcrumbs.some(item => item.stage === runner.STAGES.FAILURE_PENDING && item.motivo === "magalu_produto_divergente"), "erro original deve sobreviver no breadcrumb da transição");
  assert(breadcrumbs.some(item => item.stage === "LIVENESS_EXHAUSTED" && item.taskStage === runner.STAGES.FAILURE_PENDING));
}

async function progressoResetaBudgetEUpdatedAtNaoMascara() {
  const env = ambiente();
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("406"));
  let identifyCall = 0;
  global.OptimusMagaluLocalResolver = {
    identificar: async () => {
      c.identify += 1;
      identifyCall += 1;
      if (identifyCall === 1) throw abortError("magalu_busca_timeout");
      return identificado();
    },
    provarImagem: async () => { c.probe += 1; throw abortError("magalu_imagem_timeout"); }
  };
  const runner = recarregar();
  await runner.processar();
  const primeiro = { ...env.local[runner.STORAGE_KEYS.STATE] };
  await new Promise(resolve => setTimeout(resolve, 5));
  await runner.processar();
  const segundo = { ...env.local[runner.STORAGE_KEYS.STATE] };
  assert.strictEqual(segundo.stage, runner.STAGES.IMAGE_IDENTIFIED);
  assert.strictEqual(segundo.noProgressCount, 1, "mudança real deve zerar budget antes da primeira falha do novo stage");
  assert.notStrictEqual(segundo.stageEnteredAt, primeiro.stageEnteredAt);
  assert(env.local[runner.STORAGE_KEYS.BREADCRUMBS].some(item => item.stage === runner.STAGES.IMAGE_IDENTIFIED && item.noProgressCount === 0));

  const entrouImagemEm = segundo.stageEnteredAt;
  const progressoEm = segundo.lastProgressAt;
  const updatedAt = segundo.updatedAt;
  await new Promise(resolve => setTimeout(resolve, 5));
  await runner.processar();
  const terceiro = env.local[runner.STORAGE_KEYS.STATE];
  assert.strictEqual(terceiro.noProgressCount, 2);
  assert.strictEqual(terceiro.stageEnteredAt, entrouImagemEm);
  assert.strictEqual(terceiro.lastProgressAt, progressoEm);
  assert.notStrictEqual(terceiro.updatedAt, updatedAt, "updatedAt pode mudar sem representar progresso");
}

(async () => {
  const infoAnterior = console.info;
  console.info = () => {};
  try {
    await timeoutIsoladoRetoma();
    await resolvingPageRelinquish();
    await stageAgeRelinquishAntesDoHeartbeat();
    await imageIdentifiedRelinquish();
    await failurePendingPreservaOrigemERelinquish();
    await progressoResetaBudgetEUpdatedAtNaoMascara();
  } finally {
    console.info = infoAnterior;
  }
  console.log("optimus-capture-local-worker-liveness.test.js: ok");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
