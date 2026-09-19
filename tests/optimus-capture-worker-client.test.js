"use strict";

const assert = require("assert");

const storage = {
  optimus_local_worker_auth: {
    workerId: "worker-1",
    token: "token-nao-exibido"
  }
};
const chromeAnterior = global.chrome;
const fetchAnterior = global.fetch;
let abortado = false;

global.chrome = {
  storage: {
    local: {
      get: async chave => ({ [chave]: storage[chave] }),
      set: async valor => Object.assign(storage, valor),
      remove: async chave => { delete storage[chave]; }
    }
  }
};
global.fetch = async (_url, init = {}) => {
  init.signal?.addEventListener?.("abort", () => { abortado = true; });
  return {
    ok: true,
    status: 200,
    body: { cancel: () => undefined },
    json: () => new Promise(() => {})
  };
};

delete require.cache[require.resolve("../optimus-capture/local-worker/worker-client.js")];
const client = require("../optimus-capture/local-worker/worker-client.js");

(async () => {
  const inicio = Date.now();
  await assert.rejects(
    () => client.result({ id: "1" }, { productId: "241382400" }, { timeoutMs: 25 }),
    /local_worker_request_timeout/
  );
  assert.strictEqual(abortado, true);
  assert(Date.now() - inicio < 1000, "body pendente deve terminar pelo timeout controlado");
  console.log("optimus-capture-worker-client.test.js: ok");
})()
  .catch(erro => { console.error(erro); process.exitCode = 1; })
  .finally(() => {
    global.chrome = chromeAnterior;
    global.fetch = fetchAnterior;
  });
