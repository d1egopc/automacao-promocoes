const {
  normalizarMarketplaceManualV2,
  normalizarOfertaManualV2
} = require("./manual-offers.contract");

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

async function gerarPreviewCaptureManualV2(entrada = {}, deps = {}) {
  const clienteId = texto(deps.clienteId);
  if (!clienteId) {
    throw erroCapture("cliente_nao_autenticado", 401);
  }

  const marketplace = normalizarMarketplaceManualV2(entrada.marketplace);
  if (marketplace !== "mercadolivre") {
    throw erroCapture("capture_marketplace_nao_suportado", 400);
  }

  const urlValidada = urlMercadoLivreSegura(entrada.urlOriginal || entrada.url || entrada.linkOriginal);
  if (!urlValidada.ok) {
    throw erroCapture(urlValidada.motivo, 400, { host: urlValidada.host || "" });
  }

  const titulo = texto(entrada.titulo || entrada.nome || entrada.title);
  if (tituloTecnicoOuInutil(titulo)) {
    throw erroCapture("capture_titulo_invalido", 400, { host: urlValidada.host });
  }

  const precoAtualNumero = precoNumero(entrada.precoAtual ?? entrada.preco ?? entrada.valor ?? entrada.price);
  if (precoAtualNumero === null) {
    throw erroCapture("capture_preco_invalido", 400, { host: urlValidada.host });
  }

  const gerarLinkAfiliadoCliente = deps.gerarLinkAfiliadoCliente;
  if (typeof gerarLinkAfiliadoCliente !== "function") {
    throw erroCapture("conversao_afiliada_indisponivel", 503, { host: urlValidada.host });
  }

  const baseConversao = {
    marketplace,
    titulo,
    precoAtual: precoAtualNumero,
    precoAnterior: entrada.precoAnterior,
    imagem: sanitizarUrlOpcional(entrada.imagem || entrada.image || entrada.imageUrl),
    cupom: texto(entrada.cupom || entrada.codigoCupom),
    categoria: texto(entrada.categoria || entrada.categoriaProduto),
    parcelamento: texto(entrada.parcelamento || entrada.parcelas),
    urlOriginal: urlValidada.url
  };

  let urlAfiliada = "";
  try {
    urlAfiliada = texto(await gerarLinkAfiliadoCliente(
      clienteId,
      marketplace,
      urlValidada.url,
      baseConversao
    ));
  } catch {
    throw erroCapture("conversao_afiliada_indisponivel", 502, { host: urlValidada.host });
  }

  if (!urlAfiliada || urlAfiliada === urlValidada.url) {
    throw erroCapture("conversao_afiliada_indisponivel", 502, { host: urlValidada.host });
  }

  const ofertaNormalizada = normalizarOfertaManualV2({
    ...baseConversao,
    precoAtual: precoAtualNumero,
    urlAfiliada,
    fonteImportacao: {
      marketplaceDetectado: marketplace,
      adapter: "optimus_capture_v1",
      parseOnly: true,
      camposConfiaveis: ["titulo", "precoAtual", "urlOriginal", "urlAfiliada"],
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
  precoNumero,
  tituloTecnicoOuInutil
};
