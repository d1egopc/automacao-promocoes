"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const clientPath = require.resolve("../optimus-capture/local-worker/worker-client.js");
const runnerPath = require.resolve("../optimus-capture/local-worker/task-runner.js");
const AUTH_KEY = "optimus_capture_auth";
const WORKER_KEY = "optimus_local_worker_auth";
const TOKEN_KEY = "optimus_local_worker_token_v1";
const STATE_KEY = "optimus_local_worker_task_state_v1";
const LEASE_KEY = "optimus_local_worker_task_lease_v1";

function area(estadoRef) {
  return {
    get: async chave => ({ [chave]: estadoRef()[chave] }),
    set: async valor => Object.assign(estadoRef(), JSON.parse(JSON.stringify(valor))),
    remove: async chave => { delete estadoRef()[chave]; }
  };
}
function resposta(status, body) {
  return { ok: status >= 200 && status < 300, status, body: { cancel: () => undefined }, json: async () => body };
}
function metadataWorker(ownerId = "user_pss60lus") {
  return { workerId: "worker-estavel", ownerId, workerType: "dedicated", capabilities: ["magalu_image_v1"], expiresAt: new Date(Date.now() + 60000).toISOString() };
}
function estadoTask(stage = "CLAIMED") {
  return {
    version: 1,
    stage,
    task: { id: "3", type: "imagem_oficial", marketplace: "magalu", productId: "afh3e1g80j", capability: "magalu_image_v1", technicalSlug: "d1egopc", attempt: 1 },
    imagemOficialUrl: stage === "RESULT_PENDING" ? "https://a-static.mlcdn.com.br/320x320/item.jpg" : "",
    provaTecnica: stage === "RESULT_PENDING" ? { origem: "local_first_party", source: "magazinevoce_busca", productId: "afh3e1g80j", skuConfirmado: true, hrefConfirmado: true, hrefProduto: "https://www.magazinevoce.com.br/d1egopc/item/p/afh3e1g80j/", hostFinal: "a-static.mlcdn.com.br", imagemOficialUrl: "https://a-static.mlcdn.com.br/320x320/item.jpg" } : null,
    lastTechnicalError: "",
    updatedAt: new Date().toISOString()
  };
}
function ambiente({ auth = true, authToken = "jwt-valido", ownerId = "user_pss60lus", workerOwner = ownerId, stage = "CLAIMED" } = {}) {
  const local = {
    ...(auth ? { [AUTH_KEY]: { token: authToken, usuario: { id: ownerId, nome: "Diego" } } } : {}),
    [WORKER_KEY]: metadataWorker(workerOwner),
    [STATE_KEY]: estadoTask(stage)
  };
  let session = { [TOKEN_KEY]: "worker-token-antigo", [LEASE_KEY]: { taskId: "3", leaseToken: "lease-antiga" } };
  const alarmes = [];
  global.chrome = {
    storage: { local: area(() => local), session: area(() => session) },
    alarms: { get: (_nome, cb) => cb(null), create: nome => alarmes.push(nome), onAlarm: { addListener: () => undefined } }
  };
  return { local, get session() { return session; }, restart: () => { session = {}; }, alarmes };
}
function recarregar() {
  delete require.cache[clientPath];
  delete require.cache[runnerPath];
  const client = require(clientPath);
  global.OptimusMagaluLocalResolver = global.OptimusMagaluLocalResolver || { identificar: async () => null, provarImagem: async () => null };
  const runner = require(runnerPath);
  return { client, runner };
}

(async () => {
  const infoAnterior = console.info;
  const fetchAnterior = global.fetch;
  const chromeAnterior = global.chrome;
  console.info = () => {};
  try {
    const serviceWorkerSource = fs.readFileSync(path.join(__dirname, "..", "optimus-capture", "background", "service-worker.js"), "utf8");
    assert.match(serviceWorkerSource, /OptimusLocalWorkerRunner\?\.iniciar\(\)/, "background deve iniciar runner sem sidepanel");

    const env = ambiente();
    env.restart();
    let register = 0; let claim = 0;
    global.fetch = async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      const body = init.body ? JSON.parse(init.body) : {};
      if (pathname.endsWith("/register")) {
        register += 1;
        assert.strictEqual(init.headers.authorization, "Bearer jwt-valido");
        assert.strictEqual(body.workerId, "worker-estavel", "cold restart deve reutilizar identidade nao secreta");
        return resposta(201, { ok: true, workerId: body.workerId, token: "worker-token-novo", workerType: "dedicated", capabilities: ["magalu_image_v1"], expiresAt: new Date(Date.now() + 60000).toISOString() });
      }
      if (pathname.endsWith("/claim")) { claim += 1; assert.strictEqual(init.headers.authorization, "Bearer worker-token-novo"); return resposta(200, { ok: true, task: null }); }
      throw new Error(`request_inesperado_${pathname}`);
    };
    let contexto = recarregar();
    await contexto.runner.processar();
    assert.strictEqual(register, 1);
    assert.strictEqual(claim, 0, "primeiro wake descarta tentativa sem lease antes de novo claim");
    assert.strictEqual(env.session[TOKEN_KEY], "worker-token-novo");
    assert.strictEqual(env.local[WORKER_KEY].workerId, "worker-estavel");
    assert.strictEqual(env.local[WORKER_KEY].token, undefined);
    assert.strictEqual(env.local[STATE_KEY], undefined);
    await contexto.runner.processar();
    assert.strictEqual(claim, 1, "polling volta sozinho sem sidepanel");

    const resultEnv = ambiente({ stage: "RESULT_PENDING" });
    resultEnv.restart();
    let result = 0; let heartbeat = 0;
    global.fetch = async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      const body = init.body ? JSON.parse(init.body) : {};
      if (pathname.endsWith("/register")) return resposta(201, { ok: true, workerId: body.workerId, token: "worker-token-result", workerType: "dedicated", capabilities: ["magalu_image_v1"], expiresAt: new Date(Date.now() + 60000).toISOString() });
      if (pathname.endsWith("/result")) { result += 1; assert.strictEqual(body.leaseToken, ""); return resposta(200, { ok: true, idempotente: true }); }
      if (pathname.endsWith("/heartbeat")) { heartbeat += 1; return resposta(409, { ok: false, motivo: "lease_invalido" }); }
      throw new Error(`request_inesperado_${pathname}`);
    };
    contexto = recarregar();
    await contexto.runner.processar();
    assert.strictEqual(result, 1, "RESULT_PENDING sem lease deve reconciliar completed pelo endpoint idempotente");
    assert.strictEqual(heartbeat, 0);
    assert.strictEqual(resultEnv.local[STATE_KEY], undefined);

    const semSessao = ambiente({ auth: false });
    semSessao.restart();
    let chamadasSemSessao = 0;
    global.fetch = async () => { chamadasSemSessao += 1; throw new Error("nao_deveria_chamar"); };
    contexto = recarregar();
    await contexto.runner.processar();
    assert.strictEqual(chamadasSemSessao, 0);
    assert(semSessao.local[STATE_KEY], "sem sessao Optimus o worker nao opera nem inventa contexto");

    const expirada = ambiente({ authToken: "jwt-expirado" });
    expirada.restart();
    let registrosExpirados = 0;
    global.fetch = async url => {
      if (String(url).endsWith("/register")) { registrosExpirados += 1; return resposta(401, { ok: false, motivo: "sessao_expirada" }); }
      return resposta(500, {});
    };
    contexto = recarregar();
    await contexto.runner.processar();
    await contexto.runner.processar();
    assert.strictEqual(registrosExpirados, 1, "sessao rejeitada nao pode criar loop de registro a cada alarm");
    assert.strictEqual(expirada.local[WORKER_KEY], undefined);
    assert.strictEqual(expirada.local[STATE_KEY], undefined);

    const ownerDiferente = ambiente({ ownerId: "owner-novo", workerOwner: "owner-antigo" });
    ownerDiferente.restart();
    let workerNovo = "";
    global.fetch = async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      const body = init.body ? JSON.parse(init.body) : {};
      if (pathname.endsWith("/register")) { workerNovo = body.workerId; return resposta(201, { ok: true, workerId: body.workerId, token: "token-owner-novo", workerType: "dedicated", capabilities: ["magalu_image_v1"], expiresAt: new Date(Date.now() + 60000).toISOString() }); }
      if (pathname.endsWith("/claim")) return resposta(200, { ok: true, task: null });
      throw new Error(`request_inesperado_${pathname}`);
    };
    contexto = recarregar();
    await contexto.runner.processar();
    assert(workerNovo && workerNovo !== "worker-estavel", "owner diferente nao pode herdar identidade anterior");
    assert.strictEqual(ownerDiferente.local[STATE_KEY], undefined);
    assert.strictEqual(ownerDiferente.local[WORKER_KEY].ownerId, "owner-novo");

    console.log("optimus-capture-local-worker-cold-restart.test.js: ok");
  } finally {
    console.info = infoAnterior;
    global.fetch = fetchAnterior;
    global.chrome = chromeAnterior;
  }
})().catch(erro => { console.error(erro); process.exitCode = 1; });
