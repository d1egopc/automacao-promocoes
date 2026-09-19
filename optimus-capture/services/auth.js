(function publicarAuth(global) {
  const storage = global.OptimusCaptureStorage || require("./storage");
  const api = global.OptimusCaptureApi || require("./api");
  const handoff = global.OptimusCaptureHandoff || require("./handoff");

  function usuarioPublico(payload) {
    const usuario = payload?.usuario || payload?.user || {};
    return {
      id: String(usuario.id || ""),
      nome: String(usuario.nome || ""),
      email: String(usuario.email || ""),
      papel: String(usuario.papel || ""),
      plano: String(usuario.plano || usuario.planoAssinatura || "")
    };
  }

  async function registrarWorkerLocalSilencioso(auth) {
    try {
      if (global.OptimusLocalWorkerClient?.ensureRegistered && auth?.token) {
        await global.OptimusLocalWorkerClient.ensureRegistered(auth.token, auth?.usuario?.id);
      }
    } catch (_) {
      // A captura autenticada continua disponível mesmo quando o worker local está offline.
    }
  }

  async function revogarWorkerLocalSilencioso() {
    try {
      if (global.OptimusLocalWorkerClient?.revogar) await global.OptimusLocalWorkerClient.revogar();
      else if (global.OptimusLocalWorkerClient?.limpar) await global.OptimusLocalWorkerClient.limpar();
    } catch (_) {
      try { await global.OptimusLocalWorkerClient?.limpar?.(); } catch (_) {}
    }
  }

  async function encerrarWorkerLocalNoLogout() {
    try {
      if (global.OptimusLocalWorkerClient?.revogar) await global.OptimusLocalWorkerClient.revogar({ aguardarRemoto: false });
      else if (global.OptimusLocalWorkerClient?.limpar) await global.OptimusLocalWorkerClient.limpar();
    } catch (_) {
      try { await global.OptimusLocalWorkerClient?.limpar?.(); } catch (_) {}
    }
  }

  async function autenticar(user, pass) {
    const resposta = await api.login(user, pass);
    const token = String(resposta?.token || "");
    if (!token) throw new Error("token_ausente");
    const auth = {
      token,
      usuario: usuarioPublico(resposta),
      autenticadoEm: new Date().toISOString()
    };
    await storage.salvarAuth(auth);
    void registrarWorkerLocalSilencioso(auth);
    return auth;
  }

  async function restaurarSessao() {
    const auth = await storage.lerAuth();
    if (!auth?.token) return null;
    try {
      const atual = await api.me(auth.token);
      const atualizado = {
        ...auth,
        usuario: usuarioPublico(atual),
        confirmadoEm: new Date().toISOString()
      };
      await storage.salvarAuth(atualizado);
      void registrarWorkerLocalSilencioso(atualizado);
      return atualizado;
    } catch (erro) {
      if (erro?.status === 401 || erro?.message === "sessao_expirada") {
        void revogarWorkerLocalSilencioso();
        await storage.limparAuth();
        return null;
      }
      throw erro;
    }
  }

  async function conectarComOptimus(opcoes = {}) {
    const resposta = await handoff.conectarComOptimus({
      api,
      onStatus: opcoes.onStatus,
      intervaloMs: opcoes.intervaloMs,
      maxTentativas: opcoes.maxTentativas,
      esperar: opcoes.esperar,
      chromeTabs: opcoes.chromeTabs,
      abrirUrl: opcoes.abrirUrl
    });
    const token = String(resposta?.token || "");
    if (!token) throw new Error("token_ausente");
    const confirmado = await api.me(token);
    const auth = {
      token,
      usuario: usuarioPublico(confirmado),
      autenticadoEm: new Date().toISOString(),
      origem: "capture_handoff"
    };
    await storage.salvarAuth(auth);
    void registrarWorkerLocalSilencioso(auth);
    return auth;
  }

  async function sair() {
    await encerrarWorkerLocalNoLogout();
    await storage.limparAuth();
  }

  const apiAuth = { autenticar, conectarComOptimus, restaurarSessao, sair, usuarioPublico };
  global.OptimusCaptureAuth = apiAuth;
  if (typeof module !== "undefined" && module.exports) module.exports = apiAuth;
})(typeof globalThis !== "undefined" ? globalThis : window);
