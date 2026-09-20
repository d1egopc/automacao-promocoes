(function publicarMercadoLivreLocalResolver(global) {
  "use strict";

  const HOSTS = Object.freeze(["mercadolivre.com.br", "mercadolibre.com"]);
  const CAPABILITY = "ml_image_v1";
  const TIMEOUT_MS = 6500;
  const TTL_MS = 10 * 60 * 1000;

  function texto(valor = "") { return String(valor ?? "").trim(); }
  function decode(valor = "") {
    return texto(valor)
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#x2f;|&#47;/gi, "/")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/");
  }
  function hostMercadoLivre(host = "") {
    const valor = texto(host).toLowerCase().replace(/\.$/, "");
    return HOSTS.some(base => valor === base || valor.endsWith(`.${base}`));
  }
  function urlMercadoLivre(valor = "", base = "") {
    try {
      const url = new URL(decode(valor), base || undefined);
      return url.protocol === "https:" && hostMercadoLivre(url.hostname) ? url : null;
    } catch (_) { return null; }
  }
  function normalizarMlb(valor = "") {
    const match = texto(valor).match(/\bMLB-?(\d+)\b/i);
    return match ? `MLB${match[1]}` : "";
  }
  function atributos(tag = "") {
    const saida = {};
    const re = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/gi;
    let match;
    while ((match = re.exec(tag))) saida[match[1].toLowerCase()] = decode(match[3]);
    return saida;
  }
  function jsonLdProdutos(html = "") {
    const produtos = [];
    const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    const visitar = valor => {
      if (!valor || typeof valor !== "object") return;
      if (Array.isArray(valor)) return valor.forEach(visitar);
      const tipos = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
      if (tipos.some(item => texto(item).toLowerCase() === "product")) produtos.push(valor);
      if (valor["@graph"]) visitar(valor["@graph"]);
    };
    while ((match = re.exec(html))) {
      try { visitar(JSON.parse(decode(match[1]))); } catch (_) {}
    }
    return produtos;
  }
  function idsProduto(produto = {}) {
    return [produto.sku, produto.productID, produto.productId, produto.mpn]
      .map(texto).filter(Boolean).map(normalizarMlb).filter(Boolean);
  }
  function imagensProduto(produto = {}) {
    const imagens = Array.isArray(produto.image) ? produto.image : [produto.image];
    return imagens.flatMap(valor => {
      if (typeof valor === "string") return [valor];
      if (valor && typeof valor === "object") return [valor.url, valor.contentUrl, valor.src].filter(Boolean);
      return [];
    });
  }
  function imagemOficial(valor = "", base = "") {
    try {
      const url = new URL(decode(valor), base || undefined);
      if (url.protocol !== "https:") return "";
      const host = url.hostname.toLowerCase();
      return host === "mlstatic.com" || host.endsWith(".mlstatic.com") ? url.toString() : "";
    } catch (_) { return ""; }
  }
  function imagemMeta(html = "", base = "") {
    const re = /<meta\b([^>]+)>/gi;
    let match;
    while ((match = re.exec(html))) {
      const attrs = atributos(match[1]);
      if (["og:image", "twitter:image"].includes(texto(attrs.property || attrs.name).toLowerCase())) {
        const imagem = imagemOficial(attrs.content, base);
        if (imagem) return imagem;
      }
    }
    return "";
  }
  function extrairCandidato(html, productId, finalUrl) {
    const esperado = normalizarMlb(productId);
    for (const produto of jsonLdProdutos(html)) {
      const ids = idsProduto(produto);
      const href = texto(produto.offers?.url || produto.url);
      const hrefMlb = normalizarMlb(href);
      if (!ids.includes(esperado) && hrefMlb !== esperado) continue;
      for (const raw of imagensProduto(produto)) {
        const imagem = imagemOficial(raw, finalUrl);
        if (imagem) return { imagem, productIdObserved: esperado, sameProductObject: true, origin: "jsonld" };
      }
    }
    if (normalizarMlb(finalUrl) === esperado) {
      const imagem = imagemMeta(html, finalUrl);
      if (imagem) return { imagem, productIdObserved: esperado, sameProductObject: true, origin: "pdp_meta" };
    }
    return null;
  }
  async function fetchTexto(url, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
      const html = await response.text();
      return { response, html };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function validarImagem(url, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, { redirect: "follow", signal: controller.signal });
      let finalUrl = null;
      try { finalUrl = new URL(response.url || url); } catch (_) {}
      const host = finalUrl?.hostname?.toLowerCase() || "";
      const contentType = texto(response.headers?.get?.("content-type") || "").toLowerCase().split(";", 1)[0];
      const okHost = finalUrl?.protocol === "https:" && (host === "mlstatic.com" || host.endsWith(".mlstatic.com"));
      if (!response.ok || !finalUrl || !okHost || !contentType.startsWith("image/")) {
        return { ok: false, motivo: "ml_imagem_http_nao_confirmada", statusHttp: response.status, contentType };
      }
      return { ok: true, urlFinal: finalUrl.toString(), statusHttp: response.status, contentType };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function resolver({ productId, sourceUrl }) {
    const esperado = normalizarMlb(productId);
    const origem = urlMercadoLivre(sourceUrl);
    if (!esperado || !origem || normalizarMlb(origem.pathname) !== esperado) throw new Error("ml_identidade_incompleta");
    const leitura = await fetchTexto(origem.toString());
    const finalUrl = urlMercadoLivre(leitura.response?.url || origem.toString());
    if (!finalUrl || !leitura.response?.ok || normalizarMlb(finalUrl.pathname) !== esperado) throw new Error(`ml_pdp_http_${leitura.response?.status || 0}`);
    const candidato = extrairCandidato(leitura.html, esperado, finalUrl.toString());
    if (!candidato) throw new Error("ml_imagem_produto_nao_confirmado");
    const imagem = await validarImagem(candidato.imagem);
    if (!imagem.ok) throw new Error(imagem.motivo);
    const checkedAt = new Date().toISOString();
    return {
      capability: CAPABILITY,
      marketplace: "mercadolivre",
      productId: esperado,
      imagemOficialUrl: imagem.urlFinal,
      finalUrl: finalUrl.toString(),
      checkedAt,
      provaTecnica: {
        source: "local_first_party",
        provenance: "local_worker.ml_image_v1",
        productId: esperado,
        productIdObserved: candidato.productIdObserved,
        sameProductObject: candidato.sameProductObject === true,
        finalUrl: finalUrl.toString(),
        origin: candidato.origin,
        statusHttp: imagem.statusHttp,
        contentType: imagem.contentType,
        checkedAt
      }
    };
  }
  global.OptimusMercadoLivreLocalResolver = { resolver, CAPABILITY, TTL_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMercadoLivreLocalResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
