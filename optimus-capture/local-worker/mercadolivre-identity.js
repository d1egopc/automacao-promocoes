(function publicarMercadoLivreIdentityResolver(global) {
  "use strict";

  const CAPABILITY = "ml_identity_v1";
  const CONTRACT_VERSION = 1;
  const TIMEOUT_MS = 6500;
  const HOSTS = Object.freeze(["mercadolivre.com.br", "mercadolibre.com"]);

  function texto(valor = "") { return String(valor ?? "").trim(); }
  function decode(valor = "") {
    return texto(valor)
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#x2f;|&#47;/gi, "/")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/");
  }
  function normalizarMlb(valor = "") {
    const match = texto(valor).match(/\bMLB-?(\d+)\b/i);
    return match ? `MLB${match[1]}` : "";
  }
  function hostMercadoLivre(host = "") {
    const valor = texto(host).toLowerCase().replace(/\.$/, "");
    return HOSTS.some(base => valor === base || valor.endsWith(`.${base}`));
  }
  function urlMercadoLivre(valor = "", base = "") {
    try {
      const url = new URL(decode(valor), base || undefined);
      if (url.protocol !== "https:" || !hostMercadoLivre(url.hostname)) return null;
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url;
    } catch (_) { return null; }
  }
  function imagemOficial(valor = "", base = "") {
    try {
      const url = new URL(decode(valor), base || undefined);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || !(host === "mlstatic.com" || host.endsWith(".mlstatic.com")) || url.pathname === "/") return "";
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) { return ""; }
  }
  function tituloFactual(valor = "") {
    const titulo = texto(valor).replace(/\s+/g, " ");
    if (titulo.length < 8 || titulo.length > 240 || titulo.split(/\s+/).length < 2) return "";
    const normalizado = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/^(?:mercado\s*livre|produto|anuncio|oferta|promocao|confira|compre\s+agora)\b/.test(normalizado)) return "";
    if (/\b(?:vendido\s+por|loja\s+oficial|varias\s+cores\s+disponiveis|compre\s+agora|confira\s+agora|oferta\s+imperdivel|just\s+a\s+moment|access\s+denied|captcha|verifique\s+se\s+voce\s+e\s+um\s+robo)\b/.test(normalizado)) return "";
    return /[\p{L}\p{N}]/u.test(titulo) ? titulo : "";
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
  function mlbsProduto(produto = {}) {
    return [...new Set([
      produto.sku,
      produto.productID,
      produto.productId,
      produto.mpn,
      produto.url,
      produto["@id"],
      produto.offers?.url
    ].map(normalizarMlb).filter(Boolean))];
  }
  function imagensProduto(produto = {}) {
    const saida = [];
    const visitar = valor => {
      if (typeof valor === "string") saida.push(valor);
      else if (Array.isArray(valor)) valor.forEach(visitar);
      else if (valor && typeof valor === "object") [valor.url, valor.contentUrl, valor.src].forEach(visitar);
    };
    visitar(produto.image);
    visitar(produto.images);
    return [...new Set(saida.map(valor => imagemOficial(valor)).filter(Boolean))];
  }
  function pontuarImagem(url = "") {
    const valor = texto(url).toLowerCase();
    let pontos = 0;
    if (/_2x_/.test(valor)) pontos += 100;
    if (/d_nq_np/.test(valor)) pontos += 40;
    if (/\.webp(?:$|\?)/.test(valor)) pontos += 10;
    const dimensoes = valor.match(/(\d{3,4})x(\d{3,4})/);
    if (dimensoes) pontos += Number(dimensoes[1]) * Number(dimensoes[2]) / 10000;
    return pontos;
  }
  function canonicalPagina(html = "", base = "") {
    const re = /<link\b([^>]+)>/gi;
    let match;
    while ((match = re.exec(html))) {
      const attrs = atributos(match[1]);
      if (texto(attrs.rel).toLowerCase().split(/\s+/).includes("canonical")) return urlMercadoLivre(attrs.href, base);
    }
    return null;
  }
  function assinaturaProduto(produto = {}, finalUrl = "") {
    const titulo = tituloFactual(produto.name || produto.title || "");
    const imagens = imagensProduto(produto).sort((a, b) => pontuarImagem(b) - pontuarImagem(a));
    return { titulo, imagens, chave: JSON.stringify({ titulo, imagens }) };
  }
  function extrair(html, expectedMlb, finalUrl) {
    const esperado = normalizarMlb(expectedMlb);
    const final = urlMercadoLivre(finalUrl);
    if (!esperado || !final || normalizarMlb(final.pathname) !== esperado) throw new Error("ml_identity_final_url_invalida");
    const canonical = canonicalPagina(html, final.toString());
    const canonicalMlb = canonical ? normalizarMlb(canonical.pathname) : "";
    if (canonical && canonicalMlb && canonicalMlb !== esperado) throw new Error("ml_identity_canonical_divergente");

    const produtos = jsonLdProdutos(html);
    const candidatos = produtos
      .filter(produto => mlbsProduto(produto).includes(esperado))
      .map(produto => ({ produto, ...assinaturaProduto(produto, final.toString()) }));
    if (candidatos.some(item => mlbsProduto(item.produto).some(mlb => mlb !== esperado))) {
      throw new Error("ml_identity_product_identificadores_conflitantes");
    }
    const assinaturas = new Set(candidatos.map(item => item.chave));
    if (!candidatos.length) throw new Error("ml_identity_product_ausente");
    if (assinaturas.size !== 1) throw new Error("ml_identity_products_conflitantes");

    const candidato = candidatos[0];
    const imagem = candidato.imagens[0] || "";
    if (!candidato.titulo && !imagem) throw new Error("ml_identity_sem_identidade_factual");
    const variationIds = [...new Set([
      candidato.produto.variationId,
      candidato.produto.variantId,
      candidato.produto.offers?.sku
    ].map(texto).filter(valor => /^\d{1,30}$/.test(valor)))];
    if (variationIds.length > 1) throw new Error("ml_identity_variacao_conflitante");

    return {
      expectedMlb: esperado,
      observedMlb: esperado,
      identidadeValidada: true,
      tituloOficial: candidato.titulo,
      imagemOficial: imagem,
      origemTitulo: candidato.titulo ? "jsonld.name" : "",
      origemImagem: imagem ? "jsonld.image" : "",
      finalUrl: final.toString(),
      canonicalUrl: canonical?.toString() || "",
      variationId: variationIds[0] || ""
    };
  }
  async function fetchTexto(url, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
      return { response, html: await response.text() };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function validarImagem(url, timeoutMs = TIMEOUT_MS) {
    if (!url) return "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, { redirect: "follow", signal: controller.signal });
      const finalUrl = imagemOficial(response.url || url);
      const contentType = texto(response.headers?.get?.("content-type") || "").toLowerCase().split(";", 1)[0];
      if (!response.ok || !finalUrl || !contentType.startsWith("image/")) throw new Error("ml_identity_imagem_http_invalida");
      return finalUrl;
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function resolver({ productId, sourceUrl }) {
    const esperado = normalizarMlb(productId);
    const origem = urlMercadoLivre(sourceUrl);
    if (!esperado || !origem || normalizarMlb(origem.pathname) !== esperado) throw new Error("ml_identity_entrada_invalida");
    const leitura = await fetchTexto(origem.toString());
    const finalUrl = urlMercadoLivre(leitura.response?.url || origem.toString());
    if (!leitura.response?.ok || !finalUrl) throw new Error(`ml_identity_http_${leitura.response?.status || 0}`);
    const resultado = extrair(leitura.html, esperado, finalUrl.toString());
    if (resultado.imagemOficial) resultado.imagemOficial = await validarImagem(resultado.imagemOficial);
    const collectedAt = new Date().toISOString();
    return {
      capability: CAPABILITY,
      contractVersion: CONTRACT_VERSION,
      marketplace: "mercadolivre",
      ...resultado,
      collectedAt,
      provaTecnica: {
        capability: CAPABILITY,
        contractVersion: CONTRACT_VERSION,
        source: "local_first_party",
        provenance: "local_worker.ml_identity_v1",
        expectedMlb: resultado.expectedMlb,
        observedMlb: resultado.observedMlb,
        sameProductObject: true,
        identidadeTipo: "mlb",
        origemTitulo: resultado.origemTitulo,
        origemImagem: resultado.origemImagem,
        finalUrl: resultado.finalUrl,
        canonicalUrl: resultado.canonicalUrl,
        variationId: resultado.variationId,
        collectedAt
      }
    };
  }

  global.OptimusMercadoLivreIdentityResolver = {
    resolver,
    extrair,
    tituloFactual,
    normalizarMlb,
    CAPABILITY,
    CONTRACT_VERSION
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMercadoLivreIdentityResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
