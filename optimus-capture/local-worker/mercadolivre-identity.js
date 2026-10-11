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
  function pageMlbu(valor = "") {
    const url = urlMercadoLivre(valor);
    return url?.pathname.match(/\/up\/(MLBU\d{6,})\/?$/i)?.[1]?.toUpperCase() || "";
  }
  function contextoNordic(html = "") {
    const fontes = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) {
      if (atributos(match[1]).id === "__NORDIC_RENDERING_CTX__") fontes.push(match[2]);
    }
    if (fontes.length !== 1 || fontes[0].length > 1_000_000) throw new Error("ml_identity_contexto_ausente_ou_ambiguo");
    const fonte = fontes[0];
    const inicio = fonte.match(/^\s*_n\.ctx\.r\s*=\s*/)?.[0].length;
    if (inicio === undefined || fonte[inicio] !== "{") throw new Error("ml_identity_contexto_invalido");
    let nivel = 0, aspas = false, escape = false;
    for (let i = inicio; i < fonte.length; i++) {
      const c = fonte[i];
      if (aspas) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') aspas = false;
      } else if (c === '"') aspas = true;
      else if (c === "{") nivel++;
      else if (c === "}" && --nivel === 0) return JSON.parse(fonte.slice(inicio, i + 1)).appProps?.pageProps?.initialState;
    }
    throw new Error("ml_identity_contexto_invalido");
  }
  function associacaoMlbu(html, finalUrl) {
    const page = pageMlbu(finalUrl);
    const estado = contextoNordic(html);
    const c = estado?.components;
    const mlb = texto(c?.bookmark?.item_id);
    if (!page || estado?.id !== page || !/^MLB\d{6,}$/.test(mlb)) throw new Error("ml_identity_binding_invalido");
    const bookmark = c.bookmark.add?.track?.melidata_event?.event_data;
    const track = c.track?.melidata_event?.event_data;
    for (const contexto of [bookmark, track]) {
      if (!contexto || contexto.item_id !== mlb || contexto.pid !== page || contexto.user_product_id !== page) {
        throw new Error("ml_identity_binding_conflitante");
      }
    }
    for (const contexto of [c.bookmark.delete?.track?.melidata_event?.event_data,
      c.share?.action?.track?.melidata_event?.event_data, c.share?.show_track?.melidata_event?.event_data]) {
      if (!contexto) continue;
      if ((contexto.item_id && contexto.item_id !== mlb) ||
          (contexto.pid && contexto.pid !== page) || (contexto.user_product_id && contexto.user_product_id !== page) ||
          (contexto.object_id && contexto.object_id !== page)) throw new Error("ml_identity_binding_conflitante");
    }
    const canonicas = [];
    const links = /<link\b([^>]+)>/gi;
    let link;
    while ((link = links.exec(html))) {
      const attrs = atributos(link[1]);
      if (texto(attrs.rel).toLowerCase().split(/\s+/).includes("canonical")) canonicas.push(attrs.href);
    }
    const metas = /<meta\b([^>]+)>/gi;
    let meta;
    while ((meta = metas.exec(html))) {
      const attrs = atributos(meta[1]);
      if (attrs.property === "og:url") canonicas.push(attrs.content);
    }
    if (!canonicas.length || canonicas.some(url => pageMlbu(url) !== page)) throw new Error("ml_identity_canonical_divergente");
    if (c.share?.permalink) {
      const share = new URL(decode(c.share.permalink));
      if (pageMlbu(share.toString()) !== page ||
          (share.searchParams.has("pdp_filters") && share.searchParams.get("pdp_filters") !== `item_id:${mlb}`)) {
        throw new Error("ml_identity_binding_conflitante");
      }
    }
    const produtos = jsonLdProdutos(html);
    if (!produtos.length || produtos.some(p => texto(p.productID) !== page ||
        (p.sku && texto(p.sku) !== page) || (p.url && pageMlbu(p.url) !== page) ||
        (p["@id"] && pageMlbu(p["@id"]) !== page) || pageMlbu(p.offers?.url) !== page || mlbsProduto(p).length)) {
      throw new Error("ml_identity_product_identificadores_conflitantes");
    }
    const titulo = texto(c.header?.title || c.header?.heading_label?.text).replace(/\s+/g, " ");
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    if (!titulo || produtos.some(p => texto(p.name).replace(/\s+/g, " ") !== titulo) ||
        (h1 && decode(h1.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim() !== titulo)) {
      throw new Error("ml_identity_contexto_produto_divergente");
    }
    return { pageMlbu: page, mlb, source: "nordic_current_product", bookmarkItem: mlb, bookmarkPage: page, trackItem: mlb, trackPage: page };
  }
  function extrair(html, expectedMlb, finalUrl) {
    const associacaoPagina = pageMlbu(finalUrl) ? associacaoMlbu(html, finalUrl) : null;
    const esperado = normalizarMlb(expectedMlb || associacaoPagina?.mlb);
    const final = urlMercadoLivre(finalUrl);
    if (!esperado || !final || (associacaoPagina ? associacaoPagina.mlb !== esperado : normalizarMlb(final.pathname) !== esperado)) throw new Error("ml_identity_final_url_invalida");
    const canonical = canonicalPagina(html, final.toString());
    const canonicalMlb = canonical ? normalizarMlb(canonical.pathname) : "";
    if (canonical && canonicalMlb && canonicalMlb !== esperado) throw new Error("ml_identity_canonical_divergente");

    const produtos = jsonLdProdutos(html);
    const candidatos = produtos
      .filter(produto => associacaoPagina ? produto.productID === associacaoPagina.pageMlbu : mlbsProduto(produto).includes(esperado))
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
      variationId: variationIds[0] || "",
      ...(associacaoPagina ? { associacaoPagina } : {})
    };
  }
  async function fetchTexto(url, timeoutMs = TIMEOUT_MS, fetchImpl = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      // Validate each redirect before the request, not only the final URL.
      for (let i = 0; i < 4; i++) {
        response = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = urlMercadoLivre(response.headers?.get?.("location"), url);
        await response.body?.cancel?.();
        if (!next || i === 3) throw new Error("ml_identity_redirect_invalido");
        url = next.toString();
      }
      if (Number(response.headers?.get?.("content-length")) > 2_000_000) throw new Error("ml_identity_html_muito_grande");
      let html;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = [];
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > 2_000_000) throw new Error("ml_identity_html_muito_grande");
            chunks.push(value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        html = new TextDecoder().decode(bytes);
      } else html = await response.text();
      if (html.length > 2_000_000) throw new Error("ml_identity_html_muito_grande");
      return { response, html };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function validarImagem(url, timeoutMs = TIMEOUT_MS, fetchImpl = fetch) {
    if (!url) return "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      for (let i = 0; i < 4; i++) {
        response = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = imagemOficial(response.headers?.get?.("location"), url);
        await response.body?.cancel?.();
        if (!next || i === 3) throw new Error("ml_identity_imagem_redirect_invalido");
        url = next;
      }
      const finalUrl = imagemOficial(response.url || url);
      const contentType = texto(response.headers?.get?.("content-type") || "").toLowerCase().split(";", 1)[0];
      if (!response.ok || !finalUrl || !contentType.startsWith("image/")) throw new Error("ml_identity_imagem_http_invalida");
      return finalUrl;
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }
  async function resolver({ productId, sourceUrl }, opcoes = {}) {
    const esperado = normalizarMlb(productId);
    const origem = urlMercadoLivre(sourceUrl);
    if (!origem || (!pageMlbu(origem.toString()) && (!esperado || normalizarMlb(origem.pathname) !== esperado))) throw new Error("ml_identity_entrada_invalida");
    const leitura = await fetchTexto(origem.toString(), TIMEOUT_MS, opcoes.fetch || fetch);
    const finalUrl = urlMercadoLivre(leitura.response?.url || origem.toString());
    if (!leitura.response?.ok || !finalUrl) throw new Error(`ml_identity_http_${leitura.response?.status || 0}`);
    if (pageMlbu(origem.toString()) && pageMlbu(origem.toString()) !== pageMlbu(finalUrl.toString())) throw new Error("ml_identity_redirect_produto_divergente");
    const resultado = extrair(leitura.html, esperado, finalUrl.toString());
    if (resultado.imagemOficial) resultado.imagemOficial = await validarImagem(resultado.imagemOficial, TIMEOUT_MS, opcoes.fetch || fetch);
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
        collectedAt,
        ...(resultado.associacaoPagina ? { associacaoPagina: resultado.associacaoPagina } : {})
      }
    };
  }

  global.OptimusMercadoLivreIdentityResolver = {
    resolver,
    extrair,
    associacaoMlbu,
    pageMlbu,
    tituloFactual,
    normalizarMlb,
    CAPABILITY,
    CONTRACT_VERSION
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMercadoLivreIdentityResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
