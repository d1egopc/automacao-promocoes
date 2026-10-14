(function publicarMagaluIdentityResolver(global) {
  "use strict";

  const CAPABILITY = "magalu_identity_v1";
  const CONTRACT_VERSION = 1;
  const TIMEOUT_MS = 6500;
  const CAMINHO_SENSIVEL = /(?:^|\/)(?:token|secret|api[_-]?key|authorization|bearer|password|session|cookie|signature|access[_-]?token)(?:\/|$)/i;

  function texto(valor = "") { return String(valor ?? "").trim(); }
  function sourceUrlSegura(valor = "") {
    try {
      const url = new URL(texto(valor));
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "magazineluiza.onelink.me" ||
        url.username || url.password || url.port || url.search || url.hash) return "";
      if (!/^\/[a-z0-9._~-]{1,120}\/[a-z0-9._~-]{1,160}\/?$/i.test(url.pathname)) return "";
      return `https://magazineluiza.onelink.me${url.pathname}`;
    } catch (_) { return ""; }
  }
  function hostProduto(host = "") {
    const valor = texto(host).toLowerCase().replace(/\.$/, "");
    return valor === "magazineluiza.com.br" || valor.endsWith(".magazineluiza.com.br") ||
      valor === "magazinevoce.com.br" || valor.endsWith(".magazinevoce.com.br") ||
      valor === "magalu.com" || valor.endsWith(".magalu.com");
  }
  function produtoFinal(valor = "") {
    try {
      const url = new URL(texto(valor));
      if (url.protocol !== "https:" || !hostProduto(url.hostname) || url.username || url.password || url.port) return null;
      if (CAMINHO_SENSIVEL.test(decodeURIComponent(url.pathname))) return null;
      const productId = texto(url.pathname.match(/\/p\/([^/]+)/i)?.[1]).toLowerCase();
      if (!/^[a-z0-9-]{5,80}$/.test(productId)) return null;
      return { productId, url: `https://${url.hostname.toLowerCase()}${url.pathname.slice(0, 512)}` };
    } catch (_) { return null; }
  }
  async function resolver({ sourceUrl, identityKey }) {
    const origem = sourceUrlSegura(sourceUrl);
    const chave = texto(identityKey);
    if (!origem || !/^url_[a-f0-9]{32}$/.test(chave)) throw new Error("magalu_identity_entrada_invalida");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response = null;
    try {
      response = await fetch(origem, {
        redirect: "follow",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: controller.signal
      });
      const produto = produtoFinal(response?.url || "");
      if (response?.redirected !== true || !produto) throw new Error("magalu_identity_produto_nao_confirmado");
      const collectedAt = new Date().toISOString();
      return {
        capability: CAPABILITY,
        contractVersion: CONTRACT_VERSION,
        marketplace: "magalu",
        identityKey: chave,
        sourceUrl: origem,
        observedProductId: produto.productId,
        identidadeValidada: true,
        finalUrl: produto.url,
        canonicalUrl: produto.url,
        collectedAt,
        provaTecnica: {
          capability: CAPABILITY,
          contractVersion: CONTRACT_VERSION,
          source: "local_first_party",
          provenance: "local_worker.magalu_identity_v1",
          identityKey: chave,
          observedProductId: produto.productId,
          redirected: true,
          finalUrl: produto.url,
          statusHttp: Number(response.status || 0),
          collectedAt
        }
      };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }

  global.OptimusMagaluIdentityResolver = { resolver, sourceUrlSegura, produtoFinal, CAPABILITY, CONTRACT_VERSION, TIMEOUT_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMagaluIdentityResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
