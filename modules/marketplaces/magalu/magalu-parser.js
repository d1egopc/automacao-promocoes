"use strict";

const HOSTS_MAGALU = [
  "magazineluiza.com.br",
  "www.magazineluiza.com.br",
  "magazinevoce.com.br",
  "www.magazinevoce.com.br",
  "magalu.com",
  "www.magalu.com"
];

const MAGALU_HTTP_TIMEOUT_MS_PADRAO = 4500;
const MAGALU_HTTP_RETRIES_PADRAO = 2;
const MAGALU_HTTP_RETRY_DELAY_MS_PADRAO = 250;

function resultadoVazio(urlOriginal = "", avisos = []) {
  return {
    urlOriginal: String(urlOriginal || ""),
    urlCanonica: "",
    produtoId: "",
    codigo: "",
    titulo: "",
    precoAtual: "",
    precoAnterior: "",
    imagem: "",
    categoria: "",
    seller: "",
    parcelamento: "",
    cupom: "",
    avisos: [...avisos],
    metadata: {
      parseOnly: true,
      marketplace: "magalu",
      fontes: {},
      camposBrutos: {}
    }
  };
}

function limparTextoMagalu(texto = "") {
  return String(texto || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limparUrlMagalu(url = "", base = "") {
  const valor = limparTextoMagalu(url);
  if (!valor) return "";

  try {
    const parsed = new URL(valor, base || undefined);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch (_) {
    return "";
  }
}

function hostMagaluValido(url = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOSTS_MAGALU.some(h => host === h || host.endsWith("." + h));
  } catch (_) {
    return false;
  }
}

function produtoIdPorUrl(url = "") {
  try {
    const pathname = new URL(url).pathname;
    const porP = pathname.match(/\/p\/([^/?#]+)/i)?.[1] || "";
    const porProduto = pathname.match(/\/produto\/(\d+)/i)?.[1] || "";
    const porDivulgadorOferta = pathname.match(/\/divulgador\/oferta\/([^/?#]+)/i)?.[1] || "";
    return limparTextoMagalu(decodeURIComponent(porP || porProduto || porDivulgadorOferta || ""));
  } catch (_) {
    return "";
  }
}

function adicionarAviso(avisos = [], aviso = "") {
  if (aviso && !avisos.includes(aviso)) avisos.push(aviso);
}

function inteiroPositivo(valor, padrao) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return padrao;
  return Math.floor(numero);
}

function aguardar(ms = 0) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tentativaHttpResumo({ tentativa = 1, status = 0, duracaoMs = 0, motivo = "", retry = false } = {}) {
  return {
    tentativa,
    status: Number(status || 0),
    duracaoMs: Number(duracaoMs || 0),
    motivo: String(motivo || "").trim(),
    retry: retry === true
  };
}

function anexarAuditoriaHttp(resultado = {}, auditoria = {}) {
  resultado.metadata = resultado.metadata && typeof resultado.metadata === "object"
    ? resultado.metadata
    : {};
  resultado.metadata.httpFactual = {
    timeoutMs: auditoria.timeoutMs,
    maxRetries: auditoria.maxRetries,
    totalTentativas: auditoria.tentativas.length,
    tentativas: auditoria.tentativas
  };
  return resultado;
}

function erroTimeoutFetch(erro) {
  return erro?.name === "AbortError" || /abort|timeout/i.test(String(erro?.message || ""));
}

async function fetchMagaluComTimeout(fetchFn, url, { headers = {}, timeoutMs = MAGALU_HTTP_TIMEOUT_MS_PADRAO } = {}) {
  if (typeof AbortController !== "function") {
    return fetchFn(url, { headers });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function urlProdutoMagaluValida(url = "") {
  return hostMagaluValido(url) && Boolean(produtoIdPorUrl(url));
}

function tituloPagina(html = "") {
  return limparTextoMagalu(String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function contemCaptchaMagalu(html = "") {
  const conteudo = String(html || "");
  const titulo = tituloPagina(conteudo)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\baz-request-verify\b/i.test(conteudo) ||
    /complete\s+o\s+captcha/i.test(conteudo) ||
    /captcha\s+magalu/i.test(titulo) ||
    /data-testid=["']captcha/i.test(conteudo);
}

function contemPaginaIndisponivelMagalu(html = "") {
  const conteudo = limparTextoMagalu(String(html || ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const titulo = tituloPagina(html)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return /magazine luiza\s*\|\s*nao e possivel acessar a pagina/i.test(titulo) ||
    /\bnao e possivel acessar a pagina\b/i.test(conteudo) ||
    /\bpagina indisponivel\b/i.test(conteudo);
}

function idProdutoJsonLd(produto = {}) {
  return limparTextoMagalu(produto?.sku || produto?.productID || produto?.mpn || "");
}

function produtoJsonLdCompativel(produto = {}, produtoIdOriginal = "") {
  const idJsonLd = idProdutoJsonLd(produto);
  if (!produtoIdOriginal || !idJsonLd) return true;
  return idJsonLd === produtoIdOriginal;
}

function removerScriptsJsonLd(html = "") {
  return String(html || "").replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
}

function escolherUrlCanonicaSegura({ resultado, conteudo, urlOriginal = "", urlFinal = "" } = {}) {
  const base = urlFinal || urlOriginal;
  const urlOriginalLimpa = limparUrlMagalu(urlOriginal);
  const produtoIdOriginal = produtoIdPorUrl(urlOriginalLimpa);
  const candidatas = [
    extrairLinkCanonical(conteudo, base),
    limparUrlMagalu(extrairAtributoMeta(conteudo, ["og:url"]), base),
    limparUrlMagalu(urlFinal || ""),
    urlOriginalLimpa
  ].filter(Boolean);

  for (const candidata of candidatas) {
    if (!hostMagaluValido(candidata)) {
      adicionarAviso(resultado.avisos, "magalu_canonica_fora_do_dominio_ignorada");
      continue;
    }

    const produtoIdCandidato = produtoIdPorUrl(candidata);
    if (produtoIdOriginal) {
      if (produtoIdCandidato && produtoIdCandidato !== produtoIdOriginal) {
        adicionarAviso(resultado.avisos, "magalu_canonica_produto_divergente_ignorada");
        continue;
      }

      if (!produtoIdCandidato) {
        continue;
      }
    }

    resultado.urlCanonica = candidata;
    return;
  }

  if (urlProdutoMagaluValida(urlOriginalLimpa)) {
    resultado.urlCanonica = urlOriginalLimpa;
  }
}

function conteudoComProdutoDivergente({ conteudo = "", urlOriginal = "", urlFinal = "", produtoJsonLd = null } = {}) {
  const produtoIdOriginal = produtoIdPorUrl(limparUrlMagalu(urlOriginal));
  if (!produtoIdOriginal) return false;

  const base = urlFinal || urlOriginal;
  const candidatas = [
    extrairLinkCanonical(conteudo, base),
    limparUrlMagalu(extrairAtributoMeta(conteudo, ["og:url"]), base),
    limparUrlMagalu(urlFinal || "")
  ].filter(Boolean);

  for (const candidata of candidatas) {
    const produtoIdCandidato = produtoIdPorUrl(candidata);
    if (produtoIdCandidato && produtoIdCandidato !== produtoIdOriginal) {
      return true;
    }
  }

  const idJsonLd = idProdutoJsonLd(produtoJsonLd);
  return Boolean(idJsonLd && idJsonLd !== produtoIdOriginal);
}

function normalizarPrecoMagalu(valor) {
  if (valor === undefined || valor === null) return "";

  let texto = limparTextoMagalu(valor);
  if (!texto) return "";

  texto = texto
    .replace(/^R\$\s*/i, "")
    .replace(/\s*BRL$/i, "")
    .trim();

  let numero;
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(texto)) {
    numero = Number(texto.replace(/\./g, "").replace(",", "."));
  } else if (/^\d+(?:,\d{1,2})?$/.test(texto)) {
    numero = Number(texto.replace(",", "."));
  } else if (/^\d+(?:\.\d{1,2})?$/.test(texto)) {
    numero = Number(texto);
  } else {
    const match = texto.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)/);
    if (!match) return "";
    return normalizarPrecoMagalu(match[1]);
  }

  if (!Number.isFinite(numero) || numero <= 0) return "";

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numeroPreco(valor = "") {
  const texto = String(valor || "")
    .replace(/^R\$\s*/i, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function extrairAtributoMeta(html = "", nomes = []) {
  for (const nome of nomes) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const direto = html.match(re)?.[1];
    if (direto) return limparTextoMagalu(direto);

    const reInvertido = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nome}["'][^>]*>`, "i");
    const invertido = html.match(reInvertido)?.[1];
    if (invertido) return limparTextoMagalu(invertido);
  }
  return "";
}

function extrairLinkCanonical(html = "", baseUrl = "") {
  const href = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i)?.[1] ||
    "";
  return limparUrlMagalu(href, baseUrl);
}

function tentarParseJson(texto = "") {
  try {
    return JSON.parse(texto);
  } catch (_) {
    return null;
  }
}

function scriptsJsonLd(html = "") {
  return [...String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => limparTextoMagalu(match[1] || ""))
    .map(tentarParseJson)
    .filter(Boolean);
}

function listarObjetosJsonLd(valor, saida = []) {
  if (!valor) return saida;
  if (Array.isArray(valor)) {
    for (const item of valor) listarObjetosJsonLd(item, saida);
    return saida;
  }
  if (typeof valor !== "object") return saida;

  saida.push(valor);
  if (Array.isArray(valor["@graph"])) listarObjetosJsonLd(valor["@graph"], saida);
  return saida;
}

function tipoJsonLd(obj = {}) {
  const tipo = obj["@type"];
  if (Array.isArray(tipo)) return tipo.map(String).join(" ").toLowerCase();
  return String(tipo || "").toLowerCase();
}

function acharProdutoJsonLd(html = "") {
  const objetos = scriptsJsonLd(html).flatMap(item => listarObjetosJsonLd(item, []));
  return objetos.find(obj => tipoJsonLd(obj).includes("product")) || null;
}

function acharBreadcrumbJsonLd(html = "") {
  const objetos = scriptsJsonLd(html).flatMap(item => listarObjetosJsonLd(item, []));
  return objetos.find(obj => tipoJsonLd(obj).includes("breadcrumblist")) || null;
}

function valorOfertaJsonLd(ofertas = {}, campos = []) {
  const lista = Array.isArray(ofertas) ? ofertas : [ofertas];
  for (const oferta of lista) {
    if (!oferta || typeof oferta !== "object") continue;
    for (const campo of campos) {
      if (oferta[campo] !== undefined && oferta[campo] !== null && String(oferta[campo]).trim()) {
        return { campo: `jsonld.offers.${campo}`, valor: oferta[campo] };
      }
    }
  }
  return null;
}

function imagemJsonLd(produto = {}) {
  produto = produto || {};
  const img = produto.image;
  if (Array.isArray(img)) return limparTextoMagalu(img[0] || "");
  if (img && typeof img === "object") return limparTextoMagalu(img.url || img.contentUrl || "");
  return limparTextoMagalu(img || "");
}

function categoriaBreadcrumb(breadcrumb = {}) {
  breadcrumb = breadcrumb || {};
  const itens = Array.isArray(breadcrumb.itemListElement) ? breadcrumb.itemListElement : [];
  const nomes = itens
    .map(item => limparTextoMagalu(item?.name || item?.item?.name || ""))
    .filter(Boolean);
  if (nomes.length > 1) return nomes[nomes.length - 2] || "";
  return nomes[0] || "";
}

function extrairPrecoPorPadroes(html = "", padroes = []) {
  for (const { campo, re } of padroes) {
    const match = html.match(re);
    if (!match?.[1]) continue;
    const preco = normalizarPrecoMagalu(match[1]);
    if (preco) return { campo, valor: match[1], preco };
  }
  return null;
}

function extrairPrecoAtual(html = "", produtoJsonLd = null) {
  const jsonLd = valorOfertaJsonLd(produtoJsonLd?.offers, ["price", "lowPrice"]);
  const precoJsonLd = normalizarPrecoMagalu(jsonLd?.valor);
  if (precoJsonLd) return { preco: precoJsonLd, fonte: jsonLd.campo, bruto: jsonLd.valor };

  const meta = extrairAtributoMeta(html, ["product:price:amount", "og:price:amount"]);
  const precoMeta = normalizarPrecoMagalu(meta);
  if (precoMeta) return { preco: precoMeta, fonte: "meta.product_price_amount", bruto: meta };

  const padrao = extrairPrecoPorPadroes(html, [
    { campo: "json.finalPrice", re: /"finalPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "json.bestPrice", re: /"bestPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "json.price", re: /"price"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "html.preco_a_vista", re: /(?:pre[cç]o\s*(?:atual|a\s*vista)|por|pix)[^<]{0,120}R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i }
  ]);
  if (padrao) return { preco: padrao.preco, fonte: padrao.campo, bruto: padrao.valor };

  return { preco: "", fonte: "", bruto: "" };
}

function extrairPrecoAnterior(html = "", precoAtual = "") {
  const padrao = extrairPrecoPorPadroes(html, [
    { campo: "json.listPrice", re: /"listPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "json.originalPrice", re: /"originalPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "json.oldPrice", re: /"oldPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i },
    { campo: "html.preco_de", re: /(?:pre[cç]o\s*(?:anterior|de)|valor\s*de)[^<]{0,80}R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i }
  ]);
  if (!padrao) return { preco: "", fonte: "", bruto: "" };

  if (precoAtual && numeroPreco(padrao.preco) <= numeroPreco(precoAtual)) {
    return { preco: "", fonte: "", bruto: "" };
  }

  return { preco: padrao.preco, fonte: padrao.campo, bruto: padrao.valor };
}

function extrairParcelamento(html = "") {
  const match = html.match(/(?:em\s*)?\d{1,2}x\s+de\s+R\$\s*[0-9.]+,[0-9]{2}[^<"]{0,80}/i);
  return limparTextoMagalu(match?.[0] || "");
}

function extrairCupom(html = "") {
  const match = html.match(/(?:cupom|coupon)[^<]{0,80}(?:R\$\s*[0-9.]+,[0-9]{2}|[A-Z0-9_-]{4,30})/i);
  return limparTextoMagalu(match?.[0] || "");
}

function tituloGenericoMagalu(titulo = "") {
  const texto = limparTextoMagalu(titulo)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return [
    "magazine luiza",
    "magalu",
    "magazine voce",
    "produto magalu"
  ].includes(texto);
}

function extrairSeller(html = "") {
  const match =
    html.match(/vendido\s+e\s+entregue\s+por\s*(?:<\/?[^>]*>\s*)?([^<"]{2,80})/i) ||
    html.match(/"sellerName"\s*:\s*"([^"]+)"/i) ||
    html.match(/"seller"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i);
  return limparTextoMagalu(match?.[1] || "");
}

function parseMagaluProdutoHtml({ urlOriginal = "", html = "", urlFinal = "" } = {}) {
  const resultado = resultadoVazio(urlOriginal);
  const conteudo = String(html || "");
  const urlOriginalLimpa = limparUrlMagalu(urlOriginal);
  const produtoIdOriginal = produtoIdPorUrl(urlOriginalLimpa);

  if (!conteudo.trim()) {
    resultado.avisos.push("magalu_html_ausente");
    return resultado;
  }

  escolherUrlCanonicaSegura({ resultado, conteudo, urlOriginal, urlFinal });

  if (contemCaptchaMagalu(conteudo)) {
    adicionarAviso(resultado.avisos, "magalu_captcha_detectado");
    if (produtoIdOriginal) {
      resultado.produtoId = produtoIdOriginal;
      resultado.codigo = produtoIdOriginal;
      resultado.metadata.fontes.produtoId = "urlOriginal";
    }
    adicionarAviso(resultado.avisos, "magalu_produto_nao_comprovado");
    return resultado;
  }

  if (contemPaginaIndisponivelMagalu(conteudo)) {
    adicionarAviso(resultado.avisos, "magalu_pagina_indisponivel");
    if (produtoIdOriginal) {
      resultado.produtoId = produtoIdOriginal;
      resultado.codigo = produtoIdOriginal;
      resultado.metadata.fontes.produtoId = "urlOriginal";
    }
    adicionarAviso(resultado.avisos, "magalu_produto_nao_comprovado");
    return resultado;
  }

  const produtoJsonLd = acharProdutoJsonLd(conteudo);
  const breadcrumbJsonLd = acharBreadcrumbJsonLd(conteudo);
  const fontes = resultado.metadata.fontes;
  const brutos = resultado.metadata.camposBrutos;
  const produtoJsonLdSeguro = produtoJsonLdCompativel(produtoJsonLd, produtoIdOriginal) ? produtoJsonLd : null;

  if (produtoJsonLd && !produtoJsonLdSeguro) {
    adicionarAviso(resultado.avisos, "magalu_jsonld_produto_divergente_ignorado");
  }
  const conteudoDivergente = conteudoComProdutoDivergente({
    conteudo,
    urlOriginal,
    urlFinal,
    produtoJsonLd
  });
  if (conteudoDivergente) {
    adicionarAviso(resultado.avisos, "magalu_conteudo_produto_divergente_ignorado");
  }
  const conteudoSeguro = produtoJsonLd && !produtoJsonLdSeguro
    ? removerScriptsJsonLd(conteudo)
    : conteudo;

  const produtoId =
    produtoIdPorUrl(resultado.urlCanonica) ||
    idProdutoJsonLd(produtoJsonLdSeguro);
  if (produtoId) {
    resultado.produtoId = produtoId;
    resultado.codigo = produtoId;
    fontes.produtoId = produtoIdPorUrl(resultado.urlCanonica) ? "urlCanonica" : "jsonld.product_id";
  }

  const titulo =
    (conteudoDivergente ? "" : limparTextoMagalu(produtoJsonLdSeguro?.name || "")) ||
    (conteudoDivergente ? "" : extrairAtributoMeta(conteudo, ["og:title", "twitter:title"])) ||
    (conteudoDivergente ? "" : tituloPagina(conteudo).replace(/\s*\|\s*Magazine Luiza\s*$/i, ""));
  if (titulo && !tituloGenericoMagalu(titulo)) {
    resultado.titulo = titulo;
    fontes.titulo = produtoJsonLdSeguro?.name ? "jsonld.name" : "meta_ou_title";
  }

  const imagem = conteudoDivergente ? "" : (
    limparUrlMagalu(imagemJsonLd(produtoJsonLdSeguro), urlFinal || urlOriginal) ||
    limparUrlMagalu(extrairAtributoMeta(conteudo, ["og:image", "twitter:image"]), urlFinal || urlOriginal)
  );
  if (imagem) {
    resultado.imagem = imagem;
    fontes.imagem = imagemJsonLd(produtoJsonLdSeguro) ? "jsonld.image" : "meta.image";
  }

  const precoAtual = conteudoDivergente
    ? { preco: "", fonte: "", bruto: "" }
    : extrairPrecoAtual(conteudoSeguro, produtoJsonLdSeguro);
  if (precoAtual.preco) {
    resultado.precoAtual = precoAtual.preco;
    fontes.precoAtual = precoAtual.fonte;
    brutos.precoAtual = { campo: precoAtual.fonte, valor: String(precoAtual.bruto) };
  }

  const precoAnterior = conteudoDivergente
    ? { preco: "", fonte: "", bruto: "" }
    : extrairPrecoAnterior(conteudoSeguro, resultado.precoAtual);
  if (precoAnterior.preco) {
    resultado.precoAnterior = precoAnterior.preco;
    fontes.precoAnterior = precoAnterior.fonte;
    brutos.precoAnterior = { campo: precoAnterior.fonte, valor: String(precoAnterior.bruto) };
  }

  const categoria = conteudoDivergente ? "" : (
    categoriaBreadcrumb(breadcrumbJsonLd) ||
    extrairAtributoMeta(conteudoSeguro, ["product:category", "category"])
  );
  if (categoria) {
    resultado.categoria = categoria;
    fontes.categoria = breadcrumbJsonLd ? "jsonld.breadcrumb" : "meta.category";
  }

  const seller = conteudoDivergente ? "" : extrairSeller(conteudoSeguro);
  if (seller) {
    resultado.seller = seller;
    fontes.seller = "html.seller";
  }

  const parcelamento = conteudoDivergente ? "" : extrairParcelamento(conteudoSeguro);
  if (parcelamento) {
    resultado.parcelamento = parcelamento;
    fontes.parcelamento = "html.parcelamento";
  }

  const cupom = conteudoDivergente ? "" : extrairCupom(conteudoSeguro);
  if (cupom) {
    resultado.cupom = cupom;
    fontes.cupom = "html.cupom";
  }

  const temFatoProduto = Boolean(resultado.titulo || resultado.precoAtual || resultado.imagem || resultado.produtoId);
  if (!temFatoProduto) {
    resultado.avisos.push("magalu_produto_nao_comprovado");
  }

  return resultado;
}

async function consultarProdutoMagalu(urlOriginal = "", opcoes = {}) {
  const fetchFn = opcoes.fetchFn || global.fetch;
  const headers = opcoes.headers || {};

  if (opcoes.html !== undefined) {
    return parseMagaluProdutoHtml({
      urlOriginal,
      html: opcoes.html,
      urlFinal: opcoes.urlFinal || urlOriginal
    });
  }

  const url = limparUrlMagalu(urlOriginal);
  if (!url || !hostMagaluValido(url)) {
    return resultadoVazio(urlOriginal, ["magalu_url_invalida"]);
  }

  if (typeof fetchFn !== "function") {
    return resultadoVazio(urlOriginal, ["magalu_fetch_indisponivel"]);
  }

  const timeoutMs = inteiroPositivo(opcoes.timeoutMs ?? opcoes.httpTimeoutMs ?? process.env.MAGALU_HTTP_TIMEOUT_MS, MAGALU_HTTP_TIMEOUT_MS_PADRAO);
  const maxRetries = Math.min(
    inteiroPositivo(opcoes.retries ?? opcoes.maxRetries ?? process.env.MAGALU_HTTP_RETRIES, MAGALU_HTTP_RETRIES_PADRAO),
    5
  );
  const retryDelayMs = inteiroPositivo(opcoes.retryDelayMs ?? process.env.MAGALU_HTTP_RETRY_DELAY_MS, MAGALU_HTTP_RETRY_DELAY_MS_PADRAO);
  const auditoria = { timeoutMs, maxRetries, tentativas: [] };

  for (let tentativa = 1; tentativa <= maxRetries + 1; tentativa += 1) {
    const inicio = Date.now();
    try {
      const resposta = await fetchMagaluComTimeout(fetchFn, url, { headers, timeoutMs });
      const html = await resposta.text();
      const status = Number(resposta.status || 0);
      const duracaoMs = Date.now() - inicio;
      const deveRetry = status >= 500 && tentativa <= maxRetries;
      auditoria.tentativas.push(tentativaHttpResumo({
        tentativa,
        status,
        duracaoMs,
        motivo: status >= 500 ? `magalu_http_${status}` : "ok",
        retry: deveRetry
      }));

      if (deveRetry) {
        await aguardar(retryDelayMs * tentativa);
        continue;
      }

      const resultado = parseMagaluProdutoHtml({
        urlOriginal,
        html,
        urlFinal: resposta.url || url
      });
      if (resposta.ok === false) {
        resultado.avisos.push(`magalu_http_${resposta.status || "erro"}`);
      }
      return anexarAuditoriaHttp(resultado, auditoria);
    } catch (erro) {
      const motivo = erroTimeoutFetch(erro) ? "magalu_timeout" : "magalu_fetch_falhou";
      const duracaoMs = Date.now() - inicio;
      const deveRetry = tentativa <= maxRetries;
      auditoria.tentativas.push(tentativaHttpResumo({
        tentativa,
        status: 0,
        duracaoMs,
        motivo,
        retry: deveRetry
      }));

      if (deveRetry) {
        await aguardar(retryDelayMs * tentativa);
        continue;
      }

      return anexarAuditoriaHttp(resultadoVazio(urlOriginal, [motivo]), auditoria);
    }
  }

  return anexarAuditoriaHttp(resultadoVazio(urlOriginal, ["magalu_fetch_falhou"]), auditoria);
}

module.exports = {
  consultarProdutoMagalu,
  parseMagaluProdutoHtml,
  limparTextoMagalu,
  normalizarPrecoMagalu,
  produtoIdPorUrl,
  hostMagaluValido
};
