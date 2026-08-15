const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  criarImportarAmazon
} = require("../../../marketplaces/amazon/importar");

const ADAPTER_AMAZON_MANUAL_V2 = "amazon.manual.adapter";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarChave(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const atual = texto(valor);
    if (atual) return atual;
  }
  return "";
}

function htmlDecode(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extrairMeta(html = "", property = "") {
  const alvo = texto(property).toLowerCase();
  if (!alvo) return "";

  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const atributos = {};
    const regex = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match;
    while ((match = regex.exec(tag)) !== null) {
      atributos[match[1].toLowerCase()] = match[3];
    }

    const chave = texto(atributos.property || atributos.name).toLowerCase();
    if (chave === alvo && atributos.content) return htmlDecode(atributos.content).trim();
  }

  return "";
}

function encontrarProdutoJsonLd(valor, profundidade = 0) {
  if (!valor || profundidade > 8) return null;
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const produto = encontrarProdutoJsonLd(item, profundidade + 1);
      if (produto) return produto;
    }
    return null;
  }
  if (typeof valor !== "object") return null;

  const tipos = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
  if (tipos.some((tipo) => String(tipo || "").toLowerCase() === "product")) return valor;

  for (const item of Object.values(valor)) {
    const produto = encontrarProdutoJsonLd(item, profundidade + 1);
    if (produto) return produto;
  }

  return null;
}

function extrairJsonLd(html = "") {
  const matches = [...String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    try {
      const produto = encontrarProdutoJsonLd(JSON.parse(htmlDecode(match[1])));
      if (produto) return produto;
    } catch {}
  }
  return null;
}

function limparPreco(valor = "") {
  return String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
}

function corrigirImagemUrl(url = "") {
  return String(url || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace("&amp;", "&");
}

function limparLinkAmazonManual(url = "") {
  try {
    const u = new URL(String(url || "").trim());
    const asin =
      u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];

    if (!asin) return u.toString();
    const tag = u.searchParams.get("tag") || "";
    return tag
      ? `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(tag)}`
      : `https://www.amazon.com.br/dp/${asin}`;
  } catch {
    return texto(url);
  }
}

function criarImportadorAmazonManualV2(deps = {}) {
  if (typeof deps.importarAmazon === "function") return deps.importarAmazon;

  return criarImportarAmazon({
    extrairJsonLd,
    extrairMeta,
    htmlDecode,
    limparPreco,
    corrigirImagemUrl,
    limparLinkAmazon: deps.limparLinkAmazon || limparLinkAmazonManual,
    gerarLinkOptimus: deps.gerarLinkOptimus || ((link) => link)
  });
}

function tituloGenericoAmazon(titulo = "") {
  const chave = normalizarChave(titulo);
  return !chave || chave === "produtoamazon";
}

function origemPrecoAnteriorComprovadaAmazon(produto = {}) {
  const origem = normalizarChave(
    produto.precoAnteriorOrigem ||
    produto.precoAntigoOrigem ||
    produto.precoOriginalOrigem ||
    produto.origemPrecoAnterior ||
    produto.origemPrecoAntigo ||
    produto.origemPrecoOriginal ||
    ""
  );

  if (!origem) return false;
  if (origem.includes("desconto") || origem.includes("calcul")) return false;

  return (
    origem.includes("atextprice") ||
    origem.includes("aoffscreen") ||
    origem.includes("html") ||
    origem.includes("jsonld") ||
    origem.includes("pagina") ||
    origem.includes("page") ||
    origem.includes("api") ||
    origem.includes("schema") ||
    origem.includes("meta")
  );
}

function precoAnteriorManualAmazon(produto = {}) {
  const explicito = primeiroTexto(produto.precoAnterior);
  if (explicito) return explicito;
  if (!origemPrecoAnteriorComprovadaAmazon(produto)) return "";
  return primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe);
}

function cupomManualAmazon(produto = {}) {
  const origem = normalizarChave(produto.cupomOrigem || produto.tipoCupom || produto.cupomTipo || "");
  if (origem.includes("texto")) return "";
  return primeiroTexto(produto.cupom, produto.codigoCupom);
}

function detectarBloqueioAmazon(produto = {}) {
  const textoDiagnostico = normalizarChave([
    produto.aviso,
    produto.motivo,
    produto.motivoFalha,
    produto.erro,
    produto.statusDetalhe,
    produto.diagnostico
  ].filter(Boolean).join(" "));

  return (
    textoDiagnostico.includes("captcha") ||
    textoDiagnostico.includes("robot") ||
    textoDiagnostico.includes("antibot") ||
    textoDiagnostico.includes("bloqueio") ||
    produto.temCaptcha === true ||
    produto.temRobotCheck === true ||
    produto.bloqueado === true
  );
}

function avisosAmazon(produto = {}, precoAnterior = "") {
  const avisos = [];
  const temPrecoAnteriorNaoUsado = primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe) &&
    !precoAnterior;

  if (temPrecoAnteriorNaoUsado) {
    avisos.push("preco_anterior_ignorado_sem_origem_comprovada");
  }

  if (detectarBloqueioAmazon(produto)) {
    avisos.push("amazon_bloqueio_ou_captcha_sem_dados_fabricados");
  }

  if (normalizarChave(produto.precoOrigem || "").includes("radar")) {
    avisos.push("preco_textual_ignorado_no_manual_v2");
  }

  return avisos;
}

function camposConfiaveisAmazon(oferta = {}) {
  return [
    ["urlOriginal", oferta.urlOriginal],
    ["urlAfiliada", oferta.urlAfiliada],
    ["titulo", oferta.titulo],
    ["precoAtual", oferta.precoAtual],
    ["precoAnterior", oferta.precoAnterior],
    ["imagem", oferta.imagem],
    ["categoria", oferta.categoria],
    ["cupom", oferta.cupom],
    ["parcelamento", oferta.parcelamento]
  ]
    .filter(([, valor]) => texto(valor))
    .map(([campo]) => campo);
}

function observacoesAmazon(produto = {}, avisos = []) {
  return [
    produto.aviso || "",
    produto.avisoCupom || "",
    ...avisos
  ]
    .map(texto)
    .filter(Boolean)
    .join(" | ");
}

async function importarAmazonManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const importarAmazon = criarImportadorAmazonManualV2(opcoes);
  const integracao = opcoes.integracao ||
    (typeof opcoes.getIntegracaoCliente === "function"
      ? opcoes.getIntegracaoCliente(clienteId, "amazon")
      : null) ||
    {};

  const produto = await importarAmazon(urlOriginal, {
    ...integracao,
    clienteId,
    credenciais: integracao?.credenciais || {}
  });
  const dados = produto && typeof produto === "object" ? produto : {};
  const bloqueado = detectarBloqueioAmazon(dados);
  const precoAnterior = bloqueado ? "" : precoAnteriorManualAmazon(dados);
  const titulo = bloqueado || tituloGenericoAmazon(dados.titulo || dados.nome)
    ? ""
    : primeiroTexto(dados.titulo, dados.nome);
  const avisos = avisosAmazon(dados, precoAnterior);

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "amazon",
      urlOriginal: primeiroTexto(dados.linkOriginal, dados.urlOriginal, urlOriginal),
      urlAfiliada: primeiroTexto(dados.linkAfiliado, dados.linkFinal, dados.link),
      titulo,
      precoAtual: bloqueado ? "" : primeiroTexto(dados.precoAtual, dados.preco),
      precoAnterior,
      imagem: bloqueado ? "" : primeiroTexto(dados.imagem),
      categoria: bloqueado ? "" : primeiroTexto(dados.categoriaProduto, dados.categoria),
      cupom: bloqueado ? "" : cupomManualAmazon(dados),
      parcelamento: bloqueado ? "" : primeiroTexto(dados.parcelamento),
      observacoes: observacoesAmazon(dados, avisos),
      fonteImportacao: {
        marketplaceDetectado: "amazon",
        adapter: ADAPTER_AMAZON_MANUAL_V2,
        parseOnly: true,
        avisos
      }
    },
    {
      clienteId,
      now: opcoes.now,
      idFactory: opcoes.idFactory
    }
  );

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisAmazon(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_AMAZON_MANUAL_V2,
  importarAmazonManualV2,
  precoAnteriorManualAmazon,
  origemPrecoAnteriorComprovadaAmazon,
  detectarBloqueioAmazon,
  limparLinkAmazonManual
};
