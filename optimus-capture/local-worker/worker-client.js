(function publicarLocalWorkerClient(global) {
  "use strict";
  const API_BASE = "https://go.optimuspromo.com.br";
  const STORAGE_KEY = "optimus_local_worker_auth";
  const TOKEN_SESSION_KEY = "optimus_local_worker_token_v1";
  const USER_AUTH_STORAGE_KEY = "optimus_capture_auth";
  const BOOTSTRAP_BLOCK_KEY = "optimus_local_worker_bootstrap_block_v1";
  const CAPABILITY = "magalu_image_v1";
  let bootstrapEmCurso = null;

  function texto(valor) { return String(valor ?? "").trim(); }
  function storageLocal() { return global.chrome?.storage?.local || null; }
  function storageSession() { return global.chrome?.storage?.session || null; }
  function erroEstruturado(codigo, status = 0) {
    const erro = new Error(texto(codigo) || "local_worker_request_falhou");
    erro.codigo = texto(codigo) || "local_worker_request_falhou";
    erro.status = Number(status || 0);
    return erro;
  }
  function randomId() {
    const bytes = new Uint8Array(12);
    if (global.crypto?.getRandomValues) global.crypto.getRandomValues(bytes);
    return `optimus-local-${Array.from(bytes).map(v => v.toString(16).padStart(2, "0")).join("")}`;
  }
  async function ler() {
    const local = storageLocal();
    const session = storageSession();
    if (!local || !session) return null;
    const [dados, credencial] = await Promise.all([local.get(STORAGE_KEY), session.get(TOKEN_SESSION_KEY)]);
    const metadata = dados?.[STORAGE_KEY] || null;
    if (!metadata) return null;
    const { token: tokenLegado, ...metadataSegura } = metadata;
    const tokenSessao = texto(credencial?.[TOKEN_SESSION_KEY]);
    const legado = texto(tokenLegado);
    let token = tokenSessao;
    if (tokenLegado) {
      if (!token) {
        try {
          await session.set({ [TOKEN_SESSION_KEY]: legado });
          const confirmado = await session.get(TOKEN_SESSION_KEY);
          if (texto(confirmado?.[TOKEN_SESSION_KEY]) !== legado) throw erroEstruturado("worker_token_migration_readback_divergente");
          token = legado;
        } catch (erro) {
          if (erro?.codigo) throw erro;
          throw erroEstruturado("worker_token_migration_session_falhou");
        }
      }
      try {
        await local.set({ [STORAGE_KEY]: metadataSegura });
      } catch (_) {
        // A credencial confirmada em session continua válida; o próximo acesso tenta convergir novamente.
      }
    }
    return { ...metadataSegura, ...(token ? { token } : {}) };
  }
  async function salvar(valor) {
    const local = storageLocal();
    const session = storageSession();
    if (!local || !session) throw erroEstruturado("storage_session_indisponivel");
    const { token, ...metadata } = valor || {};
    const segredo = texto(token);
    await local.set({ [STORAGE_KEY]: metadata });
    try {
      await session.set({ [TOKEN_SESSION_KEY]: segredo });
      const confirmado = await session.get(TOKEN_SESSION_KEY);
      if (texto(confirmado?.[TOKEN_SESSION_KEY]) !== segredo) throw erroEstruturado("worker_token_session_readback_divergente");
    } catch (erro) {
      if (erro?.codigo) throw erro;
      throw erroEstruturado("worker_token_session_falhou");
    }
    return valor;
  }
  async function request(path, opts = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1, Number(opts.timeoutMs || 10000));
    const timeoutError = () => {
      const erro = erroEstruturado("local_worker_request_timeout");
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
      if (!response.ok || body?.ok === false) throw erroEstruturado(String(body?.motivo || body?.erro || `http_${response.status}`), response.status);
      return body;
    } finally {
      if (timer) clearTimeout(timer);
      try {
        const cancel = response?.body?.cancel?.();
        cancel?.catch?.(() => {});
      } catch (_) {}
    }
  }
  async function limparRunner() {
    try { await global.OptimusLocalWorkerRunner?.limparEstado?.({ limparBreadcrumbs: true }); } catch (_) {}
  }
  async function limparCredenciaisLocais() {
    const local = storageLocal();
    const session = storageSession();
    if (local) await local.remove(STORAGE_KEY);
    if (local) await local.remove(BOOTSTRAP_BLOCK_KEY);
    if (session) await session.remove(TOKEN_SESSION_KEY);
    await limparRunner();
  }
  async function invalidarTokenWorker() {
    const session = storageSession();
    if (session) await session.remove(TOKEN_SESSION_KEY);
  }
  async function ensureRegistered(userToken, ownerId) {
    let atual = await ler();
    const owner = texto(ownerId);
    if (atual?.workerId && owner && texto(atual.ownerId) !== owner) {
      await revogar({ aguardarRemoto: false });
      atual = null;
    }
    if (atual?.token && atual?.workerId && (!atual.expiresAt || Date.parse(atual.expiresAt) > Date.now())) {
      return atual;
    }
    if (!texto(userToken)) return null;
    const workerId = atual?.workerId && (!owner || texto(atual.ownerId) === owner) ? texto(atual.workerId) : randomId();
    const resposta = await request("/local-worker/register", { method: "POST", token: userToken, body: { workerId, capabilities: [CAPABILITY] } });
    return salvar({ workerId: texto(resposta.workerId), ownerId: owner, token: texto(resposta.token), workerType: texto(resposta.workerType), expiresAt: resposta.expiresAt || null, capabilities: resposta.capabilities || [], registeredAt: new Date().toISOString() });
  }
  async function bootstrap() {
    if (bootstrapEmCurso) return bootstrapEmCurso;
    bootstrapEmCurso = (async () => {
      const atual = await ler();
      if (atual?.token && atual?.workerId && (!atual.expiresAt || Date.parse(atual.expiresAt) > Date.now())) return atual;
      const local = storageLocal();
      if (!local) return null;
      const salvo = await local.get(USER_AUTH_STORAGE_KEY);
      const auth = salvo?.[USER_AUTH_STORAGE_KEY] || null;
      const userToken = texto(auth?.token);
      const ownerId = texto(auth?.usuario?.id);
      if (!userToken || !ownerId) return null;
      const authMarker = `${ownerId}:${texto(auth?.confirmadoEm || auth?.autenticadoEm || auth?.origem)}`;
      const bloqueioSalvo = await local.get(BOOTSTRAP_BLOCK_KEY);
      if (texto(bloqueioSalvo?.[BOOTSTRAP_BLOCK_KEY]?.authMarker) === authMarker) return null;
      try {
        const registrado = await ensureRegistered(userToken, ownerId);
        await local.remove(BOOTSTRAP_BLOCK_KEY);
        return registrado;
      } catch (erro) {
        if (erro?.status === 401 || erro?.status === 403) {
          await limparCredenciaisLocais();
          await local.set({ [BOOTSTRAP_BLOCK_KEY]: { ownerId, authMarker, blockedAt: new Date().toISOString() } });
        }
        throw erro;
      }
    })().finally(() => { bootstrapEmCurso = null; });
    return bootstrapEmCurso;
  }
  async function withWorker(fn) {
    const worker = await ler();
    if (!worker?.token || !worker.workerId) return null;
    return fn(worker);
  }
  async function revogar(opcoes = {}) {
    let worker = null;
    try { worker = await ler(); } catch (_) {}
    await limparCredenciaisLocais();
    if (!worker?.token || !worker.workerId) return null;
    const remoto = request("/local-worker/revoke", { method: "POST", token: worker.token });
    if (opcoes.aguardarRemoto === false) {
      void remoto.catch(() => {});
      return { ok: true, local: true, remoto: "best_effort" };
    }
    return remoto;
  }
  const client = {
    CAPABILITY,
    ler,
    salvar,
    ensureRegistered,
    bootstrap,
    claim: () => withWorker(worker => request("/local-worker/claim", { method: "POST", token: worker.token, body: { capabilities: [CAPABILITY] } })),
    heartbeat: (taskId, leaseToken) => withWorker(worker => request("/local-worker/heartbeat", { method: "POST", token: worker.token, body: { taskId, leaseToken } })),
    result: (task, payload, options = {}) => withWorker(worker => request(`/local-worker/tasks/${encodeURIComponent(task.id)}/result`, { method: "POST", token: worker.token, body: payload, timeoutMs: options.timeoutMs })),
    failure: (task, payload, options = {}) => withWorker(worker => request(`/local-worker/tasks/${encodeURIComponent(task.id)}/failure`, { method: "POST", token: worker.token, body: payload, timeoutMs: options.timeoutMs })),
    revogar,
    limpar: limparCredenciaisLocais,
    invalidarToken: invalidarTokenWorker,
    STORAGE_KEY,
    TOKEN_SESSION_KEY,
    USER_AUTH_STORAGE_KEY
  };
  global.OptimusLocalWorkerClient = client;
  if (typeof module !== "undefined" && module.exports) module.exports = client;
})(typeof globalThis !== "undefined" ? globalThis : self);
