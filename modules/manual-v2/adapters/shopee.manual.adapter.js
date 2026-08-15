const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  criarImportarShopee
} = require("../../../marketplaces/shopee/importar");
const {
  extrairIdsShopee,
  urlShopeeValida
} = require("../../../marketplaces/shopee/normalizacao");

const ADAPTER_SHOPEE_MANUAL_V2 = "shopee.manual.adapter";

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

function htmlDecode(valor = "") {
  return String(valor)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extrairMeta(html = "", propriedade = "") {
  const alvo = texto(propriedade).toLowerCase();
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

function limparPreco(valor = "") {
  return String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
}

function corrigirImagemUrl(url = "") {
  const valor = String(url || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  if (valor.startsWith("//")) return `https:${valor}`;
  return valor;
}

function criarImportadorShopeeManualV2(deps = {}) {
  if (typeof deps.importarShopee === "function") return deps.importarShopee;

  return criarImportarShopee({
    limparPreco,
    htmlDecode,
    extrairMeta,
    corrigirImagemUrl
  });
}

function numeroPrecoBR(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return null;
  const normalizado = bruto
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function temFaixaRealShopee(precoMin = "", precoMax = "") {
  const min = numeroPrecoBR(precoMin);
  const max = numeroPrecoBR(precoMax);
  return min !== null && max !== null && Math.abs(max - min) >= 0.01;
}

function origemPrecoUnicoComprovadaShopee(produto = {}) {
  const origem = normalizarChave(
    produto.precoAtualOrigem ||
    produto.origemPrecoAtual ||
    produto.precoOrigem ||
    produto.precoAuditoria?.precoOrigem ||
    produto.precoAuditoria?.origemPreco ||
    produto.precoAuditoria?.campoPrecoUsado ||
    ""
  );

  if (!origem) return false;
  if (origem.includes("texto")) return false;
  if (origem.includes("priceminpricemax")) return false;

  return (
    origem.includes("htmljsonld") ||
    origem.includes("jsonld") ||
    origem.includes("productpriceamount") ||
    origem.includes("precoestruturado") ||
    origem.includes("precoatualunico") ||
    origem.includes("precohtmlunico")
  );
}

function origemPrecoAnteriorComprovadaShopee(produto = {}) {
  const origem = normalizarChave(
    produto.precoAnteriorOrigem ||
    produto.precoAntigoOrigem ||
    produto.precoOriginalOrigem ||
    produto.origemPrecoAnterior ||
    produto.origemPrecoAntigo ||
    ""
  );

  if (!origem) return false;
  if (origem.includes("desconto") || origem.includes("calcul")) return false;

  return (
    origem.includes("html") ||
    origem.includes("jsonld") ||
    origem.includes("pagina") ||
    origem.includes("page") ||
    origem.includes("api") ||
    origem.includes("schema") ||
    origem.includes("meta")
  );
}

function precoAnteriorManualShopee(produto = {}) {
  const explicito = primeiroTexto(produto.precoAnterior);
  if (explicito) return explicito;
  if (!origemPrecoAnteriorComprovadaShopee(produto)) return "";
  return primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe);
}

function idsShopeeProduto(produto = {}, urlOriginal = "") {
  const candidatos = [
    produto.linkExpandido,
    produto.linkOriginal,
    produto.urlOriginal,
    produto.url,
    produto.productLink,
    produto.offerLink,
    produto.linkAfiliado,
    urlOriginal
  ];

  for (const candidato of candidatos) {
    const ids = extrairIdsShopee(candidato);
    if (ids.itemId) return ids;
  }

  return {
    shopId: texto(produto.shopId),
    itemId: texto(produto.itemId)
  };
}

function rotaLandingShopee(url = "") {
  try {
    const parsed = new URL(texto(url));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/g, "").toLowerCase();
    return host === "shopee.com.br" && path.startsWith("/m/");
  } catch {
    return false;
  }
}

function bloquearProdutoSemItemShopee(produto = {}, urlOriginal = "") {
  const ids = idsShopeeProduto(produto, urlOriginal);
  if (ids.itemId) return false;

  const motivo = normalizarChave(produto.motivo || produto.motivoFalha || produto.aviso || "");
  if (motivo.includes("resgateshopeesemconversaolanding")) return true;
  if (motivo.includes("linkresgate") || motivo.includes("landing")) return true;
  if (rotaLandingShopee(produto.linkExpandido || produto.linkOriginal || urlOriginal)) return true;

  return !primeiroTexto(produto.titulo, produto.nome) || !primeiroTexto(produto.precoAtual, produto.preco);
}

function cupomManualShopee(produto = {}) {
  const origem = normalizarChave(produto.cupomOrigem || produto.tipoCupom || produto.cupomTipo || "");
  if (origem.includes("texto")) return "";
  return primeiroTexto(produto.cupom, produto.codigoCupom);
}

function categoriaManualShopee(produto = {}) {
  const categoria = primeiroTexto(produto.categoriaProduto, produto.categoria);
  const chave = normalizarChave(categoria);
  if (!categoria || chave === "shopee") return "";
  return categoria;
}

function urlAfiliadaSeguraShopee(produto = {}, urlOriginal = "") {
  const candidata = primeiroTexto(produto.offerLink, produto.linkAfiliado, produto.linkFinal);
  if (!candidata || !urlShopeeValida(candidata)) return "";

  try {
    const parsed = new URL(candidata);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const fonteProduto = primeiroTexto(produto.productLink, produto.linkExpandido, produto.linkOriginal, urlOriginal);
    const diferenteDoProduto = fonteProduto && candidata !== fonteProduto;
    const parametros = parsed.searchParams.toString().toLowerCase();

    if (host === "s.shopee.com.br" || host.endsWith(".s.shopee.com.br")) return candidata;
    if (produto.offerLink && diferenteDoProduto) return candidata;
    if (/(^|[=&])(?:af|affiliate|sub|uls|utm|smtt)/i.test(parametros)) return candidata;
  } catch {}

  return "";
}

function resolverPrecosShopee(produto = {}) {
  const precoMin = primeiroTexto(produto.precoMin, produto.priceMin);
  const precoMax = primeiroTexto(produto.precoMax, produto.priceMax);
  const faixaReal = produto.temVariacaoPreco === true ||
    produto.variacaoComprovada === true ||
    produto.precoAmbiguo === true ||
    temFaixaRealShopee(precoMin, precoMax);
  const precoUnico = primeiroTexto(produto.precoAtual, produto.preco);

  if (faixaReal) {
    return {
      precoAtual: origemPrecoUnicoComprovadaShopee(produto) ? precoUnico : "",
      precoMin,
      precoMax,
      temVariacaoPreco: true
    };
  }

  return {
    precoAtual: precoUnico,
    precoMin: "",
    precoMax: "",
    temVariacaoPreco: false
  };
}

function avisosShopee(produto = {}, contexto = {}) {
  const avisos = [];
  const temPrecoAnteriorNaoUsado = primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe) &&
    !contexto.precoAnterior;

  if (temPrecoAnteriorNaoUsado) {
    avisos.push("preco_anterior_ignorado_sem_origem_comprovada");
  }

  if (contexto.bloqueadoSemItem) {
    avisos.push("link_shopee_sem_item_id_nao_importado");
  }

  if (contexto.temFaixa && !contexto.precoAtual) {
    avisos.push("faixa_preco_preservada_sem_preco_unico");
  }

  const origemPreco = normalizarChave(
    produto.precoOrigem ||
    produto.precoAuditoria?.precoOrigem ||
    produto.precoAuditoria?.origemPreco ||
    ""
  );
  if (origemPreco.includes("texto")) {
    avisos.push("preco_textual_ignorado_no_manual_v2");
  }

  if (!primeiroTexto(produto.titulo, produto.nome) || !primeiroTexto(produto.precoAtual, produto.preco, produto.precoMin)) {
    avisos.push("shopee_retorno_parcial_campos_editaveis");
  }

  return [...new Set(avisos)];
}

function camposConfiaveisShopee(oferta = {}) {
  return [
    ["urlOriginal", oferta.urlOriginal],
    ["urlAfiliada", oferta.urlAfiliada],
    ["titulo", oferta.titulo],
    ["precoAtual", oferta.precoAtual],
    ["precoAnterior", oferta.precoAnterior],
    ["precoMin", oferta.precoMin],
    ["precoMax", oferta.precoMax],
    ["imagem", oferta.imagem],
    ["categoria", oferta.categoria],
    ["cupom", oferta.cupom],
    ["parcelamento", oferta.parcelamento]
  ]
    .filter(([, valor]) => texto(valor))
    .map(([campo]) => campo);
}

function observacoesShopee(produto = {}, avisos = []) {
  return [
    produto.aviso || "",
    produto.avisoCupom || "",
    produto.avisoVariacaoPreco || "",
    ...avisos
  ]
    .map(texto)
    .filter(Boolean)
    .join(" | ");
}

async function importarShopeeManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const importarShopee = criarImportadorShopeeManualV2(opcoes);
  const integracao = opcoes.integracao ||
    (typeof opcoes.getIntegracaoCliente === "function"
      ? opcoes.getIntegracaoCliente(clienteId, "shopee")
      : null) ||
    {};

  const produto = await importarShopee(urlOriginal, {
    ...integracao,
    clienteId,
    credenciais: integracao?.credenciais || integracao || {}
  });
  const dados = produto && typeof produto === "object" ? produto : {};
  const bloqueadoSemItem = bloquearProdutoSemItemShopee(dados, urlOriginal);
  const precos = bloqueadoSemItem
    ? { precoAtual: "", precoMin: "", precoMax: "", temVariacaoPreco: false }
    : resolverPrecosShopee(dados);
  const precoAnterior = bloqueadoSemItem ? "" : precoAnteriorManualShopee(dados);
  const urlAfiliada = bloqueadoSemItem ? "" : urlAfiliadaSeguraShopee(dados, urlOriginal);
  const avisos = avisosShopee(dados, {
    precoAnterior,
    bloqueadoSemItem,
    temFaixa: precos.temVariacaoPreco,
    precoAtual: precos.precoAtual
  });

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "shopee",
      urlOriginal: primeiroTexto(dados.linkOriginal, dados.urlOriginal, urlOriginal),
      urlAfiliada,
      titulo: bloqueadoSemItem ? "" : primeiroTexto(dados.titulo, dados.nome, dados.productName),
      precoAtual: precos.precoAtual,
      precoAnterior,
      precoMin: precos.precoMin,
      precoMax: precos.precoMax,
      temVariacaoPreco: precos.temVariacaoPreco,
      imagem: bloqueadoSemItem ? "" : primeiroTexto(dados.imagem, dados.imageUrl),
      categoria: bloqueadoSemItem ? "" : categoriaManualShopee(dados),
      cupom: bloqueadoSemItem ? "" : cupomManualShopee(dados),
      parcelamento: bloqueadoSemItem ? "" : primeiroTexto(dados.parcelamento),
      observacoes: observacoesShopee(dados, avisos),
      fonteImportacao: {
        marketplaceDetectado: "shopee",
        adapter: ADAPTER_SHOPEE_MANUAL_V2,
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

  if (!urlAfiliada) {
    oferta.urlAfiliada = "";
    if (!oferta.fonteImportacao.camposAusentes.includes("urlAfiliada")) {
      oferta.fonteImportacao.camposAusentes.push("urlAfiliada");
    }
  }

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisShopee(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_SHOPEE_MANUAL_V2,
  importarShopeeManualV2,
  resolverPrecosShopee,
  temFaixaRealShopee,
  precoAnteriorManualShopee,
  bloquearProdutoSemItemShopee,
  urlAfiliadaSeguraShopee
};
