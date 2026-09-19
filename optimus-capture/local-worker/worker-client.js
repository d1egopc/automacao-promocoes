(function publicarLocalWorkerClient(global) {
  "use strict";
  const API_BASE = "https://go.optimuspromo.com.br";
  const STORAGE_KEY = "optimus_local_worker_auth";
  const CAPABILITY = "magalu_image_v1";

  function texto(valor) { return String(valor ?? "").trim(); }
  function storage() { return global.chrome?.storage?.local || null; }
  function randomId() {
    const bytes = new Uint8Array(12);
    if (global.crypto?.getRandomValues) global.crypto.getRandomValues(bytes);
    return `optimus-local-${Array.from(bytes).map(v => v.toString(16).padStart(2, "0")).join("")}`;
  }
  async function ler() {
    const store = storage();
    if (!store) return null;
    const dados = await store.get(STORAGE_KEY);
    return dados?.[STORAGE_KEY] || null;
  }
  async function salvar(valor) {
    const store = storage();
    if (store) await store.set({ [STORAGE_KEY]: valor });
    return valor;
  }
  async function request(path, opts = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1, Number(opts.timeoutMs || 10000));
    const timeoutError = () => {
      const erro = new Error("local_worker_request_timeout");
      erro.name = "AbortError";
      return erro;
    };
    let response = null;
    let timer = null;
    const limite = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(timeoutError());
      }, timeoutMs);
    });
    try {
      const headers = { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) };
      response = await Promise.race([
        fetch(`${API_BASE}${path}`, { method: opts.method || "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), ...(controller ? { signal: controller.signal } : {}) }),
        limite
      ]);
      const body = await Promise.race([response.json().catch(() => ({})), limite]);
      if (!response.ok || body?.ok === false) throw new Error(String(body?.motivo || body?.erro || `http_${response.status}`));
      return body;
    } finally {
      if (timer) clearTimeout(timer);
      try {
        const cancel = response?.body?.cancel?.();
        cancel?.catch?.(() => {});
      } catch (_) {}
    }
  }
  async function ensureRegistered(userToken) {
    const atual = await ler();
    if (atual?.token && atual?.workerId && (!atual.expiresAt || Date.parse(atual.expiresAt) > Date.now())) return atual;
    if (!texto(userToken)) return null;
    const resposta = await request("/local-worker/register", { method: "POST", token: userToken, body: { workerId: randomId(), capabilities: [CAPABILITY] } });
    return salvar({ workerId: texto(resposta.workerId), token: texto(resposta.token), workerType: texto(resposta.workerType), expiresAt: resposta.expiresAt || null, capabilities: resposta.capabilities || [], registeredAt: new Date().toISOString() });
  }
  async function withWorker(fn) {
    const worker = await ler();
    if (!worker?.token || !worker.workerId) return null;
    return fn(worker);
  }
  async function revogar() {
    const worker = await ler();
    const store = storage();
    if (store) await store.remove(STORAGE_KEY);
    if (!worker?.token || !worker.workerId) return null;
    return request("/local-worker/revoke", { method: "POST", token: worker.token });
  }
  const client = {
    CAPABILITY,
    ler,
    salvar,
    ensureRegistered,
    claim: () => withWorker(worker => request("/local-worker/claim", { method: "POST", token: worker.token, body: { capabilities: [CAPABILITY] } })),
    heartbeat: (taskId, leaseToken) => withWorker(worker => request("/local-worker/heartbeat", { method: "POST", token: worker.token, body: { taskId, leaseToken } })),
    result: (task, payload, options = {}) => withWorker(worker => request(`/local-worker/tasks/${encodeURIComponent(task.id)}/result`, { method: "POST", token: worker.token, body: payload, timeoutMs: options.timeoutMs })),
    failure: (task, payload, options = {}) => withWorker(worker => request(`/local-worker/tasks/${encodeURIComponent(task.id)}/failure`, { method: "POST", token: worker.token, body: payload, timeoutMs: options.timeoutMs })),
    revogar,
    limpar: async () => { const store = storage(); if (store) await store.remove(STORAGE_KEY); }
  };
  global.OptimusLocalWorkerClient = client;
  if (typeof module !== "undefined" && module.exports) module.exports = client;
})(typeof globalThis !== "undefined" ? globalThis : self);
