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
  function urlCatalogo(valor, base) {
    let url, caminhoDecodificado;
    try {
      url = new URL(decode(valor), base);
      caminhoDecodificado = decodeURIComponent(url.pathname);
    } catch (_) { return null; }
    if (!/\/p(?:[\/\\]|$)/i.test(caminhoDecodificado)) return null;
    const catalogo = url.pathname.match(/^\/(?:[a-z0-9-]+\/)?p\/(MLB-?\d{6,})\/?$/i)?.[1];
    const seletor = url.searchParams.get("pdp_filters")?.match(/^item_id:(MLB-?\d{6,})$/i)?.[1];
    if (!catalogo || !seletor || url.protocol !== "https:" ||
        !["www.mercadolivre.com.br", "mercadolivre.com.br"].includes(url.hostname) ||
        url.username || url.password || url.port || url.hash ||
        !/^\?pdp_filters=[^&]+$/.test(url.search)) {
      throw new Error("ml_identity_catalogo_url_invalida");
    }
    const catalogId = normalizarMlb(catalogo);
    const listingId = normalizarMlb(seletor);
    if (catalogId === listingId) throw new Error("ml_identity_catalogo_url_invalida");
    return { url: url.toString(), catalogId, listingId };
  }
  function mesmaSelecaoCatalogo(a, b) {
    return a && b && a.catalogId === b.catalogId && a.listingId === b.listingId;
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
  function extrairCatalogo(html, selecao, variacaoEsperada) {
    const canonicas = [...html.matchAll(/<link\b([^>]+)>/gi)]
      .map(link => atributos(link[1]))
      .filter(attrs => texto(attrs.rel).toLowerCase().split(/\s+/).includes("canonical"));
    if (canonicas.length !== 1) throw new Error("ml_identity_canonical_divergente");
    const canonical = urlCatalogo(canonicas[0].href, selecao.url);
    if (!mesmaSelecaoCatalogo(canonical, selecao)) throw new Error("ml_identity_canonical_divergente");

    const candidatos = jsonLdProdutos(html).filter(produto =>
      [produto.itemId, produto.item_id].some(id => normalizarMlb(id) === selecao.listingId));
    if (candidatos.length !== 1) throw new Error("ml_identity_catalogo_sem_prova_anuncio");
    const [produto] = candidatos;
    const anuncios = [produto.itemId, produto.item_id].filter(id => id != null);
    const catalogos = [produto.catalogProductId, produto.catalog_product_id].filter(id => id != null);
    const idIgual = (id, esperado) => /^MLB-?\d{6,}$/i.test(texto(id)) && normalizarMlb(id) === esperado;
    if (!anuncios.every(id => idIgual(id, selecao.listingId)) || !catalogos.length ||
        !catalogos.every(id => idIgual(id, selecao.catalogId)) ||
        [produto.productID, produto.productId].some(id =>
          id != null && !idIgual(id, selecao.listingId) && !idIgual(id, selecao.catalogId)) ||
        [produto.url, produto["@id"], produto.offers?.url].some(url =>
          url != null && !mesmaSelecaoCatalogo(urlCatalogo(url, selecao.url), selecao))) {
      throw new Error("ml_identity_catalogo_vinculo_divergente");
    }
    const variacoes = [...new Set([produto.variationId, produto.variantId, produto.variation_id]
      .filter(id => id != null).map(texto))];
    if (variacoes.length > 1 || variacoes.some(id => !/^\d{1,30}$/.test(id)) ||
        (variacaoEsperada && variacoes[0] !== variacaoEsperada)) {
      throw new Error("ml_identity_variacao_conflitante");
    }
    const titulo = tituloFactual(produto.name);
    if (!titulo) throw new Error("ml_identity_catalogo_sem_titulo_oficial");
    const imagem = imagensProduto(produto).sort((a, b) => pontuarImagem(b) - pontuarImagem(a))[0] || "";
    return {
      expectedMlb: selecao.listingId,
      observedMlb: selecao.listingId,
      catalogId: selecao.catalogId,
      listingId: selecao.listingId,
      identidadeValidada: true,
      tituloOficial: titulo,
      imagemOficial: imagem,
      origemTitulo: "jsonld.name",
      origemImagem: imagem ? "jsonld.image" : "",
      finalUrl: selecao.url,
      canonicalUrl: canonical.url,
      variationId: variacoes[0] || ""
    };
  }
  function extrair(html, expectedMlb, finalUrl) {
    const catalogo = urlCatalogo(finalUrl);
    if (catalogo) {
      if (normalizarMlb(expectedMlb) !== catalogo.listingId) throw new Error("ml_identity_final_url_invalida");
      return extrairCatalogo(html, catalogo, "");
    }
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
  async function fetchTexto(url, timeoutMs = TIMEOUT_MS, redirect = "follow") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, { redirect, signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
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
  async function resolver({ productId, sourceUrl, variationId }) {
    const esperado = normalizarMlb(productId);
    const catalogo = urlCatalogo(sourceUrl);
    const origem = urlMercadoLivre(sourceUrl);
    const variacaoEsperada = texto(variationId);
    if (!origem || (catalogo
      ? !/^MLB-?\d{6,}$/i.test(texto(productId)) || esperado !== catalogo.listingId ||
        (variacaoEsperada && !/^\d{1,30}$/.test(variacaoEsperada))
      : !pageMlbu(origem.toString()) && (!esperado || normalizarMlb(origem.pathname) !== esperado))) {
      throw new Error("ml_identity_entrada_invalida");
    }
    const urlConsulta = catalogo?.url || origem.toString();
    const leitura = await fetchTexto(urlConsulta, TIMEOUT_MS, catalogo ? "error" : "follow");
    const finalUrl = leitura.response?.url || (catalogo ? "" : urlConsulta);
    if (!leitura.response?.ok) throw new Error(`ml_identity_http_${leitura.response?.status || 0}`);
    const catalogoFinal = catalogo ? urlCatalogo(finalUrl) : null;
    if (catalogo && (leitura.response.redirected || !mesmaSelecaoCatalogo(catalogo, catalogoFinal))) {
      throw new Error("ml_identity_redirect_produto_divergente");
    }
    const finalLegado = catalogo ? null : urlMercadoLivre(finalUrl);
    if (!catalogo && !finalLegado) throw new Error(`ml_identity_http_${leitura.response?.status || 0}`);
    if (!catalogo && pageMlbu(origem.toString()) && pageMlbu(origem.toString()) !== pageMlbu(finalLegado.toString())) {
      throw new Error("ml_identity_redirect_produto_divergente");
    }
    const resultado = catalogo
      ? extrairCatalogo(leitura.html, catalogoFinal, variacaoEsperada)
      : extrair(leitura.html, esperado, finalLegado.toString());
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
        ...(catalogo ? { listingId: resultado.listingId, catalogId: resultado.catalogId } : {}),
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
    urlCatalogo,
    mesmaSelecaoCatalogo,
    pageMlbu,
    tituloFactual,
    normalizarMlb,
    CAPABILITY,
    CONTRACT_VERSION
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMercadoLivreIdentityResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
