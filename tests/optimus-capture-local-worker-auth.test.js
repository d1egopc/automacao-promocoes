"use strict";

const assert = require("assert");

const anteriores = {
  storage: global.OptimusCaptureStorage,
  api: global.OptimusCaptureApi,
  handoff: global.OptimusCaptureHandoff,
  worker: global.OptimusLocalWorkerClient
};
let authSalva = null;
let ownerRecebido = null;
let limpezasAuth = 0;
let workerLocalLimpo = false;

global.OptimusCaptureStorage = {
  salvarAuth: async valor => { authSalva = valor; },
  lerAuth: async () => authSalva,
  limparAuth: async () => { assert.strictEqual(workerLocalLimpo, true, "logout principal so conclui depois da limpeza local do worker"); authSalva = null; limpezasAuth += 1; }
};
global.OptimusCaptureApi = {
  login: async () => ({ token: "jwt-secreto", usuario: { id: "user_pss60lus", nome: "Diego" } }),
  me: async () => ({ usuario: { id: "user_pss60lus", nome: "Diego" } })
};
global.OptimusCaptureHandoff = {};
global.OptimusLocalWorkerClient = {
  ensureRegistered: async (_token, ownerId) => { ownerRecebido = ownerId; throw new Error("worker_offline"); },
  revogar: async opcoes => { assert.strictEqual(opcoes.aguardarRemoto, false); throw new Error("worker_revoke_offline"); },
  limpar: async () => { workerLocalLimpo = true; }
};

delete require.cache[require.resolve("../optimus-capture/services/auth.js")];
const auth = require("../optimus-capture/services/auth.js");

(async () => {
  const sessao = await auth.autenticar("usuario", "senha");
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(sessao.usuario.id, "user_pss60lus");
  assert.strictEqual(ownerRecebido, "user_pss60lus");
  assert(authSalva?.token, "falha opcional do worker nao pode impedir login");

  await auth.sair();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(limpezasAuth, 1, "falha de revogacao do worker nao pode impedir logout normal");
  assert.strictEqual(authSalva, null);

  console.log("optimus-capture-local-worker-auth.test.js: ok");
})()
  .catch(erro => { console.error(erro); process.exitCode = 1; })
  .finally(() => {
    global.OptimusCaptureStorage = anteriores.storage;
    global.OptimusCaptureApi = anteriores.api;
    global.OptimusCaptureHandoff = anteriores.handoff;
    global.OptimusLocalWorkerClient = anteriores.worker;
  });
