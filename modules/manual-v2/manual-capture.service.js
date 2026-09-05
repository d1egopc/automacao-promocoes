const {
  normalizarMarketplaceManualV2,
  normalizarOfertaManualV2
} = require("./manual-offers.contract");
const {
  gerarShortLinkShopee
} = require("../../marketplaces/shopee/importar");
const {
  extrairIdsShopee,
  urlShopeeValida
} = require("../../marketplaces/shopee/normalizacao");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function erroCapture(codigo, statusCode = 400, detalhes = {}) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.motivo = codigo;
  erro.statusCode = statusCode;
  Object.assign(erro, detalhes);
  return erro;
}

function precoNumero(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  }

  const bruto = texto(valor);
  if (!bruto) return null;

  const semMoeda = bruto
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "");
  const limpo = semMoeda.includes(",")
    ? semMoeda.replace(/\./g, "").replace(",", ".")
    : semMoeda;
  const numero = Number(limpo);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function faixaPrecoValida(entrada = {}) {
  const min = precoNumero(entrada.precoMin ?? entrada.preco_min);
  const max = precoNumero(entrada.precoMax ?? entrada.preco_max);
  if (min === null || max === null || max <= min) {
    return null;
  }
  return { precoMin: min, precoMax: max, temVariacaoPreco: true };
}

function tituloTecnicoOuInutil(valor = "") {
  const titulo = texto(valor);
  if (!titulo) return true;

  const normalizado = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizado === "windows") return true;
  return /captcha|account verification|just a moment|security check|verificacao de seguranca|seguridad/.test(normalizado);
}

function urlMercadoLivreSegura(urlOriginal = "") {
  const valor = texto(urlOriginal);
  if (!valor) return { ok: false, motivo: "url_original_obrigatoria" };

  let url;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, motivo: "url_original_invalida" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, motivo: "url_original_invalida" };
  }

  const host = url.hostname.toLowerCase();
  if (host === "meli.la" || host.endsWith(".meli.la")) {
    return { ok: false, motivo: "meli_la_capture_inseguro", host };
  }

  const hostMercadoLivre =
    host === "mercadolivre.com.br" ||
    host.endsWith(".mercadolivre.com.br") ||
    host === "mercadolibre.com" ||
    host.endsWith(".mercadolibre.com");

  if (!hostMercadoLivre) {
    return { ok: false, motivo: "url_mercadolivre_invalida", host };
  }

  if (!/(?:^|[^\w])(mlb|mlbu)[-\d]/i.test(`${url.pathname}${url.search}`)) {
    return { ok: false, motivo: "url_mercadolivre_produto_invalida", host };
  }

  return { ok: true, url: url.toString(), host };
}

function urlShopeeCaptureSegura(urlOriginal = "") {
  const valor = texto(urlOriginal);
  if (!valor) return { ok: false, motivo: "url_original_obrigatoria" };

  let url;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, motivo: "url_original_invalida" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, motivo: "url_original_invalida" };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "s.shopee.com.br" || host.endsWith(".s.shopee.com.br")) {
    return { ok: false, motivo: "shopee_shortlink_capture_inseguro", host };
  }

  if (!urlShopeeValida(url.toString())) {
    return { ok: false, motivo: "url_shopee_invalida", host };
  }

  const ids = extrairIdsShopee(url.toString());
  if (!ids.itemId) {
    return { ok: false, motivo: "url_shopee_produto_invalida", host };
  }

  return { ok: true, url: url.toString(), host, ids };
}

function asinAmazonUrl(url) {
  const pathname = texto(url?.pathname).toUpperCase();
  const match = pathname.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})(?:\/|$)/);
  return match?.[1] || "";
}

function urlAmazonCaptureSegura(urlOriginal = "") {
  const valor = texto(urlOriginal);
  if (!valor) return { ok: false, motivo: "url_original_obrigatoria" };

  let url;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, motivo: "url_original_invalida" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, motivo: "url_original_invalida" };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "amzn.to" || host.endsWith(".amzn.to")) {
    return { ok: false, motivo: "amazon_shortlink_capture_inseguro", host };
  }

  if (host !== "amazon.com.br" && !host.endsWith(".amazon.com.br")) {
    return { ok: false, motivo: "url_amazon_invalida", host };
  }

  const asin = asinAmazonUrl(url);
  if (!asin) {
    return { ok: false, motivo: "url_amazon_produto_invalida", host };
  }

  return { ok: true, url: url.toString(), host, asin };
}

function itemIdAliExpressUrl(url) {
  return texto(url?.pathname).match(/\/item\/(\d{10,})\.html/i)?.[1] || "";
}

function urlAliExpressCaptureSegura(urlOriginal = "") {
  const valor = texto(urlOriginal);
  if (!valor) return { ok: false, motivo: "url_original_obrigatoria" };

  let url;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, motivo: "url_original_invalida" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, motivo: "url_original_invalida" };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "a.aliexpress.com" || host === "s.click.aliexpress.com") {
    return { ok: false, motivo: "aliexpress_shortlink_capture_inseguro", host };
  }

  if (host !== "aliexpress.com" && !host.endsWith(".aliexpress.com")) {
    return { ok: false, motivo: "url_aliexpress_invalida", host };
  }

  const itemId = itemIdAliExpressUrl(url);
  if (!itemId) {
    return { ok: false, motivo: "url_aliexpress_produto_invalida", host };
  }

  return { ok: true, url: `https://${url.hostname.toLowerCase()}/item/${itemId}.html`, host, itemId };
}

function sanitizarUrlOpcional(valor = "") {
  const entrada = texto(valor);
  if (!entrada) return "";

  try {
    const url = new URL(entrada);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function respostaPreview(ofertaNormalizada = {}) {
  const oferta = { ...ofertaNormalizada };
  delete oferta.id;
  delete oferta.status;
  delete oferta.criadoEm;
  delete oferta.atualizadoEm;
  return oferta;
}

async function gerarLinkAfiliadoCapture(clienteId, marketplace, urlValidada, baseConversao, deps = {}) {
  if (marketplace === "shopee") {
    const getIntegracaoCliente = deps.getIntegracaoCliente;
    if (typeof getIntegracaoCliente !== "function") {
      throw erroCapture("integracao_shopee_indisponivel", 503, { host: urlValidada.host });
    }

    const integracao = getIntegracaoCliente(clienteId, "shopee") || {};
    const gerarShortLink = typeof deps.gerarShortLinkShopee === "function"
      ? deps.gerarShortLinkShopee
      : gerarShortLinkShopee;
    const resultado = await gerarShortLink(urlValidada.url, integracao, [], {
      fetch: deps.fetch || global.fetch
    });

    if (!resultado?.ok || !texto(resultado.shortLink)) {
      throw erroCapture("conversao_afiliada_indisponivel", 502, { host: urlValidada.host });
    }
    return texto(resultado.shortLink);
  }

  const gerarLinkAfiliadoCliente = deps.gerarLinkAfiliadoCliente;
  if (typeof gerarLinkAfiliadoCliente !== "function") {
    throw erroCapture("conversao_afiliada_indisponivel", 503, { host: urlValidada.host });
  }

  return texto(await gerarLinkAfiliadoCliente(
    clienteId,
    marketplace,
    urlValidada.url,
    baseConversao
  ));
}

async function gerarPreviewCaptureManualV2(entrada = {}, deps = {}) {
  const clienteId = texto(deps.clienteId);
  if (!clienteId) {
    throw erroCapture("cliente_nao_autenticado", 401);
  }

  const marketplace = normalizarMarketplaceManualV2(entrada.marketplace);
  if (!["mercadolivre", "shopee", "amazon", "aliexpress"].includes(marketplace)) {
    throw erroCapture("capture_marketplace_nao_suportado", 400);
  }

  const urlEntrada = entrada.urlOriginal || entrada.url || entrada.linkOriginal;
  const urlValidada = marketplace === "shopee"
    ? urlShopeeCaptureSegura(urlEntrada)
    : (marketplace === "amazon"
      ? urlAmazonCaptureSegura(urlEntrada)
      : (marketplace === "aliexpress"
        ? urlAliExpressCaptureSegura(urlEntrada)
        : urlMercadoLivreSegura(urlEntrada)));
  if (!urlValidada.ok) {
    throw erroCapture(urlValidada.motivo, 400, { host: urlValidada.host || "" });
  }

  const titulo = texto(entrada.titulo || entrada.nome || entrada.title);
  if (tituloTecnicoOuInutil(titulo)) {
    throw erroCapture("capture_titulo_invalido", 400, { host: urlValidada.host });
  }

  const faixaPreco = ["shopee", "aliexpress"].includes(marketplace) && entrada.temVariacaoPreco === true
    ? faixaPrecoValida(entrada)
    : null;
  const precoAtualNumero = faixaPreco
    ? null
    : precoNumero(entrada.precoAtual ?? entrada.preco ?? entrada.valor ?? entrada.price);
  if (precoAtualNumero === null && !faixaPreco) {
    throw erroCapture("capture_preco_invalido", 400, { host: urlValidada.host });
  }

  const baseConversao = {
    marketplace,
    titulo,
    precoAtual: faixaPreco ? "" : precoAtualNumero,
    precoAnterior: faixaPreco ? "" : entrada.precoAnterior,
    precoMin: faixaPreco?.precoMin || "",
    precoMax: faixaPreco?.precoMax || "",
    temVariacaoPreco: faixaPreco?.temVariacaoPreco === true,
    imagem: sanitizarUrlOpcional(entrada.imagem || entrada.image || entrada.imageUrl),
    cupom: texto(entrada.cupom || entrada.codigoCupom),
    categoria: texto(entrada.categoria || entrada.categoriaProduto),
    parcelamento: texto(entrada.parcelamento || entrada.parcelas),
    urlOriginal: urlValidada.url
  };

  let urlAfiliada = "";
  try {
    urlAfiliada = await gerarLinkAfiliadoCapture(clienteId, marketplace, urlValidada, baseConversao, deps);
  } catch {
    throw erroCapture("conversao_afiliada_indisponivel", 502, { host: urlValidada.host });
  }

  if (!urlAfiliada || urlAfiliada === urlValidada.url) {
    throw erroCapture("conversao_afiliada_indisponivel", 502, { host: urlValidada.host });
  }

  const ofertaNormalizada = normalizarOfertaManualV2({
    ...baseConversao,
    precoAtual: faixaPreco ? "" : precoAtualNumero,
    urlAfiliada,
    fonteImportacao: {
      marketplaceDetectado: marketplace,
      adapter: "optimus_capture_v1",
      parseOnly: true,
      camposConfiaveis: faixaPreco
        ? ["titulo", "precoMin", "precoMax", "urlOriginal", "urlAfiliada"]
        : ["titulo", "precoAtual", "urlOriginal", "urlAfiliada"],
      camposAusentes: [],
      avisos: []
    }
  }, {
    clienteId,
    marketplace,
    now: deps.now
  });

  return {
    ok: true,
    salva: false,
    oferta: respostaPreview(ofertaNormalizada),
    warnings: []
  };
}

module.exports = {
  gerarPreviewCaptureManualV2,
  urlMercadoLivreSegura,
  urlShopeeCaptureSegura,
  urlAmazonCaptureSegura,
  urlAliExpressCaptureSegura,
  precoNumero,
  tituloTecnicoOuInutil
};
