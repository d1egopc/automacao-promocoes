(function publicarMagaluIdentityResolver(global) {
  "use strict";

  const CAPABILITY = "magalu_identity_v1";
  const CONTRACT_VERSION = 1;
  const TIMEOUT_MS = 6500;
  const BROWSER_TIMEOUT_MS = 12000;
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
      const sellerId = texto(url.searchParams.get("seller_id"));
      const sellerQuery = /^[a-z0-9_-]{1,80}$/i.test(sellerId) ? "?seller_id=" + encodeURIComponent(sellerId) : "";
      return { productId, url: "https://" + url.hostname.toLowerCase() + url.pathname.slice(0, 512) + sellerQuery };
    } catch (_) { return null; }
  }
  function imagemOficial(valor = "") {
    try {
      const url = new URL(texto(valor));
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (host === "mlcdn.com.br" || host.endsWith(".mlcdn.com.br")) &&
        url.pathname !== "/" && !url.username && !url.password ? url.toString() : "";
    } catch (_) { return ""; }
  }
  async function comPrazo(promise, motivo) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(motivo)), BROWSER_TIMEOUT_MS); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function capturarComReceptor(tabs, tabId, final) {
    const deadline = Date.now() + BROWSER_TIMEOUT_MS;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (Date.now() >= deadline) throw new Error("magalu_identity_browser_timeout");
      if (attempt > 0) {
        const current = produtoFinal((await comPrazo(tabs.get(tabId), "magalu_identity_browser_timeout"))?.url);
        if (!current || current.url !== final.url) throw new Error("magalu_identity_produto_nao_confirmado");
        if (Date.now() >= deadline) throw new Error("magalu_identity_browser_timeout");
      }
      try {
        return await tabs.sendMessage(tabId, { type: "OPTIMUS_CAPTURE_PAGE" }, { frameId: 0 });
      } catch (error) {
        // Page completion does not guarantee a document_idle receiver is registered yet.
        if (!/^Could not establish connection\. Receiving end does not exist\.?$/i.test(texto(error?.message))) throw error;
        if (attempt === 2) throw new Error("magalu_identity_content_script_ausente");
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  async function resolverPelaPagina(origem) {
    const tabs = global.chrome?.tabs;
    if (!tabs?.create || !tabs?.get || !tabs?.sendMessage || !tabs?.remove ||
      !tabs?.onUpdated?.addListener || !tabs?.onUpdated?.removeListener) {
      throw new Error("magalu_identity_browser_indisponivel");
    }
    let aba;
    try {
      aba = await tabs.create({ url: origem, active: false });
      if (!Number.isInteger(aba?.id)) throw new Error("magalu_identity_aba_invalida");
      const pronta = await new Promise((resolve, reject) => {
        let encerrado = false;
        let timer;
        const finalizar = (erro, valor) => {
          if (encerrado) return;
          encerrado = true;
          clearTimeout(timer);
          tabs.onUpdated.removeListener(atualizada);
          if (erro) reject(erro);
          else resolve(valor);
        };
        const atualizada = (tabId, changeInfo, tab) => {
          if (tabId === aba.id && changeInfo?.status === "complete") finalizar(null, tab);
        };
        tabs.onUpdated.addListener(atualizada);
        timer = setTimeout(() => finalizar(new Error("magalu_identity_browser_timeout")), BROWSER_TIMEOUT_MS);
        Promise.resolve(tabs.get(aba.id)).then(tab => {
          if (tab?.status === "complete") finalizar(null, tab);
        }, () => finalizar(new Error("magalu_identity_aba_indisponivel")));
      });
      const final = produtoFinal(pronta?.url);
      if (!final) throw new Error("magalu_identity_produto_nao_confirmado");
      const captura = await comPrazo(
        capturarComReceptor(tabs, aba.id, final),
        "magalu_identity_browser_timeout"
      );
      const produto = captura?.produto || {};
      const confirmacao = produtoFinal(produto.urlOriginal);
      const atual = produtoFinal((await comPrazo(tabs.get(aba.id), "magalu_identity_browser_timeout"))?.url);
      if (!captura?.produto || !confirmacao || !atual ||
        confirmacao.url !== final.url || atual.url !== final.url ||
        texto(produto.produtoId).toLowerCase() !== final.productId ||
        texto(produto.sku).toLowerCase() !== final.productId ||
        texto(produto.titulo).length < 10 || !imagemOficial(produto.imagem)) {
        throw new Error("magalu_identity_produto_nao_confirmado");
      }
      return final;
    } finally {
      if (Number.isInteger(aba?.id)) {
        try { await tabs.remove(aba.id); } catch (_) {}
      }
    }
  }
  async function resolver({ sourceUrl, identityKey }) {
    const origem = sourceUrlSegura(sourceUrl);
    const chave = texto(identityKey);
    if (!origem || !/^url_[a-f0-9]{32}$/.test(chave)) throw new Error("magalu_identity_entrada_invalida");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let produto = null;
    let statusHttp = 0;
    let response = null;
    try {
      response = await fetch(origem, {
        redirect: "follow",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: controller.signal
      });
      statusHttp = Number(response?.status || 0);
      if (response?.ok === true && response?.redirected === true) {
        produto = produtoFinal(response.url);
      }
    } catch (_) {
      // A navegação normal do Chrome pode funcionar mesmo se o fetch técnico falhar.
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
    if (!produto) {
      produto = await resolverPelaPagina(origem);
      statusHttp = 0; // A API tabs não fornece status HTTP da página.
    }
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
        statusHttp,
        collectedAt
      }
    };
  }

  global.OptimusMagaluIdentityResolver = { resolver, sourceUrlSegura, produtoFinal, CAPABILITY, CONTRACT_VERSION, TIMEOUT_MS, BROWSER_TIMEOUT_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMagaluIdentityResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
