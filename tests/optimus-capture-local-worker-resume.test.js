"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const modulo = require.resolve("../optimus-capture/local-worker/task-runner.js");
const resolverMagalu = require("../optimus-capture/local-worker/magalu-image.js");
const repositorySource = fs.readFileSync(path.join(__dirname, "..", "modules", "local-worker", "local-worker.repository.js"), "utf8");
const guardaCompleted = repositorySource.indexOf("if (row.status === STATUS.COMPLETED)");
const guardaLease = repositorySource.indexOf("if (row.status !== STATUS.LEASED", guardaCompleted);
assert(guardaCompleted >= 0 && guardaLease > guardaCompleted, "resultado repetido deve ser idempotente antes de validar lease encerrada");
assert.match(repositorySource, /ON CONFLICT \(marketplace, product_id\) DO UPDATE/, "cache repetido nao pode duplicar linha");

function storageFake(dados, depoisDeSalvar) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => {
      Object.assign(dados, JSON.parse(JSON.stringify(valor)));
      if (depoisDeSalvar) await depoisDeSalvar(valor);
    },
    remove: async chave => { delete dados[chave]; }
  };
}
function abortError(mensagem = "local_worker_request_timeout") {
  const erro = new Error(mensagem);
  erro.name = "AbortError";
  erro.codigo = mensagem;
  return erro;
}
function leaseError() {
  const erro = new Error("lease_invalido");
  erro.codigo = "lease_invalido";
  erro.status = 409;
  return erro;
}
function task(id = "10") {
  return { id, type: "imagem_oficial", marketplace: "magalu", productId: "afh3e1g80j", technicalSlug: "d1egopc", capability: "magalu_image_v1", leaseToken: `lease-secreto-${id}`, attempts: 1 };
}
function identificado() {
  return { imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg", provaTecnica: { origem: "local_first_party", source: "magazinevoce_busca", productId: "afh3e1g80j", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/" } };
}
function identificadoComHrefRelativo() {
  return { imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg", provaTecnica: { origem: "local_first_party", source: "magazinevoce_busca", productId: "afh3e1g80j", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "/d1egopc/item/p/afh3e1g80j/", imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg" } };
}
function ambiente(depoisDeSalvarLocal) {
  const local = {};
  const session = {};
  let alarmCreates = 0;
  let alarmListeners = 0;
  global.chrome = {
    storage: { local: storageFake(local, depoisDeSalvarLocal), session: storageFake(session) },
    alarms: {
      get: (_nome, callback) => callback(null),
      create: () => { alarmCreates += 1; },
      onAlarm: { addListener: () => { alarmListeners += 1; } }
    }
  };
  return { local, session, alarmCreates: () => alarmCreates, alarmListeners: () => alarmListeners };
}

async function suspensaoLogoAposClaim() {
  let matar = true;
  const env = ambiente(async valor => {
    if (matar && valor.optimus_local_worker_task_state_v1?.stage === "CLAIMED") {
      matar = false;
      throw abortError("service_worker_suspenso");
    }
  });
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("9"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificado(); },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => { c.probe += 1; return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } }; }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.CLAIMED);
  assert.strictEqual(c.identify, 0);
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1);
  assert.strictEqual(c.result, 1);
}
function recarregar() {
  delete require.cache[modulo];
  return require(modulo);
}
function clientBase(contadores, tarefa = task()) {
  return {
    CAPABILITY: "magalu_image_v1",
    claim: async () => { contadores.claim += 1; return { task: tarefa }; },
    heartbeat: async () => { contadores.heartbeat += 1; return { ok: true }; },
    result: async (_task, payload) => { contadores.result += 1; contadores.payloads.push(JSON.stringify(payload)); return { ok: true }; },
    failure: async () => { contadores.failure += 1; return { ok: true }; }
  };
}
function contadores() { return { claim: 0, heartbeat: 0, identify: 0, probe: 0, result: 0, failure: 0, payloads: [] }; }

async function resumeDurantePagina() {
  const env = ambiente(); const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c);
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; throw abortError("magalu_busca_timeout"); },
    provarImagem: async () => { c.probe += 1; return identificado(); }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.RESOLVING_PAGE);
  assert.strictEqual(c.claim, 1);
  global.OptimusMagaluLocalResolver.identificar = async () => { c.identify += 1; return identificado(); };
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1, "resume nao pode reivindicar nova task");
  assert.strictEqual(c.result, 1);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
}

async function resumeDepoisDaIdentificacao() {
  const env = ambiente(); const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("11"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificadoComHrefRelativo(); },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => {
      c.probe += 1;
      assert.strictEqual(provaTecnica.skuConfirmado, true);
      assert.strictEqual(provaTecnica.hrefConfirmado, true);
      assert.strictEqual(provaTecnica.hrefProduto, "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/");
      assert.strictEqual(provaTecnica.imagemOficialUrl, imagemOficialUrl);
      throw abortError("magalu_imagem_timeout");
    }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.IMAGE_IDENTIFIED);
  assert.deepStrictEqual(env.local[runner.STORAGE_KEYS.STATE].provaTecnica, {
    origem: "local_first_party",
    source: "magazinevoce_busca",
    productId: "afh3e1g80j",
    skuConfirmado: true,
    hrefConfirmado: true,
    hrefProduto: "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/",
    hostFinal: "",
    imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg"
  });
  const primeiroProbe = env.local[runner.STORAGE_KEYS.BREADCRUMBS].find(item => item.stage === "PROBE_START");
  assert.strictEqual(primeiroProbe.skuConfirmado, true);
  assert.strictEqual(primeiroProbe.hrefConfirmado, true);
  assert.strictEqual(primeiroProbe.hostImagem, "a-static.mlcdn.com.br");
  global.OptimusMagaluLocalResolver.provarImagem = async ({ productId, imagemOficialUrl, provaTecnica }) => {
    c.probe += 1;
    assert.strictEqual(productId, "afh3e1g80j", "productId da task deve sobreviver IMAGE_IDENTIFIED -> PROBE_START");
    assert.strictEqual(provaTecnica.productId, "afh3e1g80j", "productId da prova persistida deve sobreviver ao resume");
    assert.strictEqual(provaTecnica.skuConfirmado, true);
    assert.strictEqual(provaTecnica.hrefConfirmado, true);
    assert.strictEqual(provaTecnica.hrefProduto, "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/");
    assert.strictEqual(provaTecnica.imagemOficialUrl, imagemOficialUrl);
    return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } };
  };
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1);
  assert.strictEqual(c.identify, 1, "pagina ja identificada nao deve ser relida");
  assert.strictEqual(c.probe, 2);
  assert.strictEqual(c.result, 1);
}

async function provaEstrangeiraContinuaFailClosed() {
  const env = ambiente(); const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("110"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => ({
      imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg",
      provaTecnica: {
        origem: "local_first_party",
        source: "magazinevoce_busca",
        productId: "afh3e1g80j",
        skuConfirmado: true,
        hrefConfirmado: true,
        hrefProduto: "https://evil.example/item/p/afh3e1g80j/",
        imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg"
      }
    }),
    provarImagem: resolverMagalu.provarImagem
  };
  const runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.result, 0);
  assert.strictEqual(c.failure, 1);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(env.session[runner.STORAGE_KEYS.LEASE], undefined);
}

async function resumeDepoisDoProbe() {
  let matar = true;
  const env = ambiente(async valor => {
    if (matar && valor.optimus_local_worker_task_state_v1?.stage === "IMAGE_PROBED") {
      matar = false;
      throw abortError("service_worker_suspenso");
    }
  });
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("111"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificado(); },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => { c.probe += 1; return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } }; }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.IMAGE_PROBED);
  assert.strictEqual(c.result, 0);
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1);
  assert.strictEqual(c.identify, 1);
  assert.strictEqual(c.probe, 1, "probe concluido nao deve ser repetido");
  assert.strictEqual(c.result, 1);
}

async function resumeAntesDoPostResult() {
  let matar = true;
  const env = ambiente(async valor => {
    if (matar && valor.optimus_local_worker_task_state_v1?.stage === "RESULT_PENDING") {
      matar = false;
      throw abortError("service_worker_suspenso");
    }
  });
  const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("112"));
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificado(); },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => { c.probe += 1; return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } }; }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.RESULT_PENDING);
  assert.strictEqual(c.result, 0);
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1);
  assert.strictEqual(c.result, 1);
}

async function retryResultIdempotente() {
  const env = ambiente(); const c = contadores();
  const client = clientBase(c, task("12"));
  client.result = async (_task, payload) => {
    c.result += 1;
    c.payloads.push(JSON.stringify(payload));
    if (c.result === 1) throw abortError("local_worker_request_timeout");
    return { ok: true, idempotente: true };
  };
  global.OptimusLocalWorkerClient = client;
  global.OptimusMagaluLocalResolver = {
    identificar: async () => { c.identify += 1; return identificado(); },
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => { c.probe += 1; return { imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } }; }
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.RESULT_PENDING);
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1);
  assert.strictEqual(c.identify, 1);
  assert.strictEqual(c.probe, 1);
  assert.strictEqual(c.result, 2);
  assert.strictEqual(c.payloads[0], c.payloads[1], "retry deve repetir exatamente o mesmo resultado");
}

async function resultadoAceitoComRespostaPerdida() {
  const env = ambiente(); const c = contadores();
  let completedNoBackend = false;
  const client = clientBase(c, task("121"));
  client.heartbeat = async () => {
    c.heartbeat += 1;
    if (completedNoBackend) throw leaseError();
    return { ok: true };
  };
  client.result = async (_task, payload) => {
    c.result += 1;
    c.payloads.push(JSON.stringify(payload));
    if (!completedNoBackend) {
      completedNoBackend = true;
      throw abortError("resposta_result_perdida");
    }
    return { ok: true, idempotente: true };
  };
  global.OptimusLocalWorkerClient = client;
  global.OptimusMagaluLocalResolver = {
    identificar: async () => identificado(),
    provarImagem: async ({ imagemOficialUrl, provaTecnica }) => ({ imagemOficialUrl, provaTecnica: { ...provaTecnica, hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl } })
  };
  let runner = recarregar();
  await runner.processar();
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE].stage, runner.STAGES.RESULT_PENDING);
  const heartbeatAntesDaRetomada = c.heartbeat;
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1, "task completada no backend nao pode gerar novo claim local");
  assert.strictEqual(c.result, 2, "RESULT_PENDING deve repetir diretamente o mesmo result");
  assert.strictEqual(c.payloads[0], c.payloads[1]);
  assert.strictEqual(c.heartbeat, heartbeatAntesDaRetomada, "RESULT_PENDING nao deve heartbeat antes da reconciliacao");
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(env.session[runner.STORAGE_KEYS.LEASE], undefined);
}

async function sessionPerdidaNaoInventaLease() {
  const env = ambiente(); const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("13"));
  global.OptimusMagaluLocalResolver = { identificar: async () => { throw abortError(); }, provarImagem: async () => identificado() };
  let runner = recarregar();
  await runner.processar();
  delete env.session[runner.STORAGE_KEYS.LEASE];
  runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.claim, 1, "wake com estado orfao apenas descarta; nao claima na mesma execucao");
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  await runner.processar();
  assert.strictEqual(c.claim, 2, "wake seguinte pode obter lease legitimo do backend");
}

async function leaseInvalidoLimpaSemEnviar() {
  const env = ambiente(); const c = contadores();
  const client = clientBase(c, task("14"));
  client.heartbeat = async () => { c.heartbeat += 1; throw leaseError(); };
  global.OptimusLocalWorkerClient = client;
  global.OptimusMagaluLocalResolver = { identificar: async () => identificado(), provarImagem: async () => identificado() };
  const runner = recarregar();
  await runner.processar();
  assert.strictEqual(c.result, 0);
  assert.strictEqual(c.failure, 0);
  assert.strictEqual(env.local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(env.session[runner.STORAGE_KEYS.LEASE], undefined);
  client.heartbeat = async () => { c.heartbeat += 1; return { ok: true }; };
  await runner.processar();
  assert.strictEqual(c.claim, 2, "reclaim posterior deve vir somente do backend");
  assert.strictEqual(c.result, 1);
}

async function breadcrumbsLimitadosESemSegredos() {
  const env = ambiente(); const c = contadores();
  global.OptimusLocalWorkerClient = clientBase(c, task("15"));
  global.OptimusMagaluLocalResolver = { identificar: async () => { throw abortError("timeout_html_secreto"); }, provarImagem: async () => identificado() };
  let runner = recarregar();
  for (let i = 0; i < 25; i += 1) {
    await runner.processar();
    runner = recarregar();
  }
  const breadcrumbs = env.local[runner.STORAGE_KEYS.BREADCRUMBS];
  assert.strictEqual(breadcrumbs.length, 20);
  const serializadoLocal = JSON.stringify(env.local);
  assert(!serializadoLocal.includes("lease-secreto"));
  assert(!serializadoLocal.includes("<html"));
}

async function alarmeUnico() {
  const env = ambiente();
  const client = clientBase(contadores(), task("16"));
  let bootstraps = 0;
  client.bootstrap = async () => { bootstraps += 1; return { workerId: "worker-1", token: "token-em-memoria" }; };
  global.OptimusLocalWorkerClient = client;
  global.OptimusMagaluLocalResolver = { identificar: async () => identificado(), provarImagem: async () => identificado() };
  const runner = recarregar();
  runner.iniciar();
  runner.iniciar();
  assert.strictEqual(env.alarmListeners(), 1);
  assert.strictEqual(env.alarmCreates(), 1);
  assert.strictEqual(bootstraps, 1);
}

(async () => {
  const infoAnterior = console.info;
  console.info = () => {};
  try {
    await suspensaoLogoAposClaim();
    await resumeDurantePagina();
    await resumeDepoisDaIdentificacao();
    await provaEstrangeiraContinuaFailClosed();
    await resumeDepoisDoProbe();
    await resumeAntesDoPostResult();
    await retryResultIdempotente();
    await resultadoAceitoComRespostaPerdida();
    await sessionPerdidaNaoInventaLease();
    await leaseInvalidoLimpaSemEnviar();
    await breadcrumbsLimitadosESemSegredos();
    await alarmeUnico();
  } finally {
    console.info = infoAnterior;
  }
  console.log("optimus-capture-local-worker-resume.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
