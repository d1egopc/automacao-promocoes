"use strict";

const assert = require("assert");

const dados = {
  optimus_local_worker_auth: {
    workerId: "worker-1",
    ownerId: "owner-1",
    token: "token-nao-exibido",
    expiresAt: new Date(Date.now() + 60000).toISOString()
  }
};
const sessao = {};
const chromeAnterior = global.chrome;
const fetchAnterior = global.fetch;
const runnerAnterior = global.OptimusLocalWorkerRunner;
let abortado = false;
let limpezas = 0;

global.chrome = {
  storage: {
    local: {
      get: async chave => ({ [chave]: dados[chave] }),
      set: async valor => Object.assign(dados, valor),
      remove: async chave => { delete dados[chave]; }
    },
    session: {
      get: async chave => ({ [chave]: sessao[chave] }),
      set: async valor => Object.assign(sessao, valor),
      remove: async chave => { delete sessao[chave]; }
    }
  }
};
global.OptimusLocalWorkerRunner = { limparEstado: async opcoes => { limpezas += 1; assert.strictEqual(opcoes.limparBreadcrumbs, true); } };

delete require.cache[require.resolve("../optimus-capture/local-worker/worker-client.js")];
const client = require("../optimus-capture/local-worker/worker-client.js");

(async () => {
  global.fetch = async (_url, init = {}) => {
    init.signal?.addEventListener?.("abort", () => { abortado = true; });
    return { ok: true, status: 200, body: { cancel: () => undefined }, json: () => new Promise(() => {}) };
  };
  const inicio = Date.now();
  await assert.rejects(
    () => client.result({ id: "1" }, { productId: "241382400" }, { timeoutMs: 25 }),
    erro => erro.name === "AbortError" && erro.codigo === "local_worker_request_timeout" && erro.status === 0
  );
  assert.strictEqual(abortado, true);
  assert(Date.now() - inicio < 1000, "body pendente deve terminar pelo timeout controlado");
  assert.strictEqual(dados.optimus_local_worker_auth.token, undefined, "token legado deve sair de storage.local");
  assert.strictEqual(sessao[client.TOKEN_SESSION_KEY], "token-nao-exibido");

  global.fetch = async () => ({ ok: false, status: 409, body: { cancel: () => undefined }, json: async () => ({ ok: false, motivo: "lease_invalido" }) });
  await assert.rejects(
    () => client.heartbeat("1", "lease-nao-logado"),
    erro => erro.codigo === "lease_invalido" && erro.status === 409 && !String(erro.stack).includes("lease-nao-logado")
  );

  const localSetOriginal = global.chrome.storage.local.set;
  const sessionSetOriginal = global.chrome.storage.session.set;
  const sessionGetOriginal = global.chrome.storage.session.get;

  dados.optimus_local_worker_auth = { workerId: "worker-migracao-1", ownerId: "owner-1", token: "legado-session-falha" };
  delete sessao[client.TOKEN_SESSION_KEY];
  global.chrome.storage.session.set = async () => { throw new Error("session_indisponivel"); };
  await assert.rejects(() => client.ler(), erro => erro.codigo === "worker_token_migration_session_falhou");
  assert.strictEqual(dados.optimus_local_worker_auth.token, "legado-session-falha", "falha no session.set preserva legado");
  global.chrome.storage.session.set = sessionSetOriginal;

  dados.optimus_local_worker_auth = { workerId: "worker-migracao-2", ownerId: "owner-1", token: "legado-readback" };
  delete sessao[client.TOKEN_SESSION_KEY];
  let leiturasSession = 0;
  global.chrome.storage.session.get = async chave => ({ [chave]: ++leiturasSession === 1 ? undefined : "valor-divergente" });
  await assert.rejects(() => client.ler(), erro => erro.codigo === "worker_token_migration_readback_divergente");
  assert.strictEqual(dados.optimus_local_worker_auth.token, "legado-readback", "readback divergente preserva legado");
  global.chrome.storage.session.get = sessionGetOriginal;

  dados.optimus_local_worker_auth = { workerId: "worker-migracao-3", ownerId: "owner-1", token: "legado-local-falha" };
  delete sessao[client.TOKEN_SESSION_KEY];
  global.chrome.storage.local.set = async () => { throw new Error("local_cleanup_falhou"); };
  const migradoComDuplicidade = await client.ler();
  assert.strictEqual(migradoComDuplicidade.token, "legado-local-falha");
  assert.strictEqual(sessao[client.TOKEN_SESSION_KEY], "legado-local-falha");
  assert.strictEqual(dados.optimus_local_worker_auth.token, "legado-local-falha", "falha local permite apenas duplicidade temporaria");
  global.chrome.storage.local.set = localSetOriginal;
  await client.ler();
  assert.strictEqual(dados.optimus_local_worker_auth.token, undefined, "proxima leitura converge e remove legado");

  dados.optimus_local_worker_auth = {
    workerId: "worker-capability-antiga",
    ownerId: "owner-1",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    capabilities: [client.CAPABILITY]
  };
  sessao[client.TOKEN_SESSION_KEY] = "token-capability-antiga";
  const chamadasUpgrade = [];
  global.fetch = async (url, init = {}) => {
    chamadasUpgrade.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      status: 200,
      body: { cancel: () => undefined },
      json: async () => ({
        ok: true,
        workerId: "worker-capability-antiga",
        token: "token-capability-nova",
        workerType: "dedicated",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        capabilities: client.CAPABILITIES
      })
    };
  };
  const atualizado = await client.ensureRegistered("jwt-usuario", "owner-1");
  assert.strictEqual(atualizado.workerId, "worker-capability-antiga", "upgrade deve reutilizar o workerId existente");
  assert.deepStrictEqual(atualizado.capabilities, client.CAPABILITIES);
  assert.deepStrictEqual(chamadasUpgrade.map(item => new URL(item.url).pathname), ["/local-worker/register"]);
  assert.deepStrictEqual(chamadasUpgrade[0].body.capabilities, client.CAPABILITIES);

  dados.optimus_local_worker_auth = { workerId: "worker-antigo", ownerId: "owner-antigo", expiresAt: new Date(Date.now() + 60000).toISOString() };
  sessao[client.TOKEN_SESSION_KEY] = "token-antigo";
  const chamadas = [];
  global.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), authorization: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    const register = String(url).endsWith("/register");
    return {
      ok: true,
      status: 200,
      body: { cancel: () => undefined },
      json: async () => register
        ? ({ ok: true, workerId: "worker-novo", token: "token-novo", workerType: "dedicated", expiresAt: new Date(Date.now() + 60000).toISOString(), capabilities: [client.CAPABILITY] })
        : ({ ok: true })
    };
  };
  const novo = await client.ensureRegistered("jwt-usuario-novo", "owner-novo");
  assert.strictEqual(novo.ownerId, "owner-novo");
  assert.strictEqual(novo.workerId, "worker-novo");
  assert.strictEqual(dados.optimus_local_worker_auth.token, undefined);
  assert.strictEqual(sessao[client.TOKEN_SESSION_KEY], "token-novo");
  assert.deepStrictEqual(chamadas.map(item => new URL(item.url).pathname), ["/local-worker/revoke", "/local-worker/register"]);
  assert.deepStrictEqual(chamadas[1].body.capabilities, ["magalu_image_v1", "magalu_opportunity_v1"]);
  assert.strictEqual(limpezas, 1, "troca de owner deve apagar estado tecnico e lease");

  await client.limpar();
  assert.strictEqual(dados.optimus_local_worker_auth, undefined);
  assert.strictEqual(sessao[client.TOKEN_SESSION_KEY], undefined);
  assert.strictEqual(limpezas, 2, "logout/limpeza deve apagar estado e breadcrumbs");
  assert(!JSON.stringify(chamadas).includes("lease-nao-logado"));

  console.log("optimus-capture-worker-client.test.js: ok");
})()
  .catch(erro => { console.error(erro); process.exitCode = 1; })
  .finally(() => {
    global.chrome = chromeAnterior;
    global.fetch = fetchAnterior;
    global.OptimusLocalWorkerRunner = runnerAnterior;
  });
