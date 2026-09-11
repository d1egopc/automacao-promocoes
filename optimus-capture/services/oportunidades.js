(function publicarOportunidades(global) {
  const TTL_MS = 60 * 1000;

  function urlOportunidadeSegura(valor = "") {
    try {
      const url = new URL(String(valor || ""));
      return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
    } catch {
      return "";
    }
  }

  async function abrirUrlOportunidade(chromeTabs, valor) {
    const url = urlOportunidadeSegura(valor);
    if (!url || !chromeTabs?.create) return false;
    await chromeTabs.create({ url, active: true });
    return true;
  }

  function criarClienteOportunidades(opcoes = {}) {
    const api = opcoes.api || global.OptimusCaptureApi;
    const agora = typeof opcoes.agora === "function" ? opcoes.agora : () => Date.now();
    let cache = null;

    async function carregar(token) {
      if (cache && agora() - cache.carregadoEm < TTL_MS) return { ...cache.resposta, cache: true };

      try {
        const resposta = await api.listarResumoOportunidades(token);
        const oportunidades = Array.isArray(resposta?.oportunidades) ? resposta.oportunidades : [];
        cache = {
          carregadoEm: agora(),
          resposta: { ok: true, oportunidades, geradoEm: resposta?.geradoEm || "" }
        };
        return { ...cache.resposta, cache: false };
      } catch (erro) {
        if (erro?.status === 401 || erro?.message === "sessao_expirada") {
          return { ok: false, sessaoExpirada: true, oportunidades: [] };
        }
        throw erro;
      }
    }

    return { carregar, ttlMs: TTL_MS };
  }

  const api = { criarClienteOportunidades, urlOportunidadeSegura, abrirUrlOportunidade, TTL_MS };
  global.OptimusCaptureOportunidades = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
