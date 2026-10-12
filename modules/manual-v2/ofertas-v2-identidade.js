const crypto = require("crypto");
const { validarProvaCaptureMl } = require("../local-worker/ml-identity.contract");

function texto(valor) { return String(valor ?? "").trim(); }
function mercado(valor) {
  const nome = texto(valor).toLowerCase().replace(/[\s_-]/g, "");
  return ({ amazon: "amazon", mercadolivre: "mercadolivre", meli: "mercadolivre",
    shopee: "shopee", aliexpress: "aliexpress", kabum: "kabum" })[nome] || nome;
}
function dominioDa(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const familia = (raiz) => host === raiz || host.endsWith(`.${raiz}`);
  if (["amazon.com.br", "amazon.com", "amzn.to"].some(familia)) return "amazon";
  if (["mercadolivre.com.br", "mercadolivre.com", "meli.la"].some(familia)) return "mercadolivre";
  if (["shopee.com.br", "shopee.com", "s.shopee.com.br"].some(familia)) return "shopee";
  if (["aliexpress.com", "aliexpress.com.br"].some(familia)) return "aliexpress";
  if (["kabum.com.br"].some(familia)) return "kabum";
  return "";
}
function formatoId(marketplace, valor) {
  const id = texto(valor);
  if (marketplace === "amazon") return /^[a-z0-9]{10}$/i.test(id) ? id.toLowerCase() : "";
  if (marketplace === "mercadolivre") {
    const match = id.match(/^MLB-?(\d{6,})$/i);
    return match ? `mlb${match[1]}` : "";
  }
  if (marketplace === "shopee") return /^\d+\/\d+$/.test(id) ? id : "";
  if (marketplace === "aliexpress") return /^\d{10,}$/.test(id) ? id : "";
  if (marketplace === "kabum") return /^\d+$/.test(id) ? id : "";
  return "";
}

function canonicalizarUrl(valor) {
  try {
    const url = new URL(texto(valor));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|affiliate|aff_|ref$|tag$|tracking|mmp_|subid|clickid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}

function idProdutoPorUrl(marketplace, valor) {
  try {
    const url = new URL(texto(valor));
    if (dominioDa(url) !== mercado(marketplace)) return "";
    const caminho = decodeURIComponent(url.pathname);
    if (marketplace === "amazon") return (caminho.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i)?.[1] || "").toLowerCase();
    if (marketplace === "aliexpress") return caminho.match(/\/item\/(\d{10,})\.html/i)?.[1] || "";
    if (marketplace === "shopee") {
      const ids = caminho.match(/\/product\/(\d+)\/(\d+)/i) || caminho.match(/-i\.(\d+)\.(\d+)/i);
      return ids ? `${ids[1]}/${ids[2]}` : "";
    }
    if (marketplace === "mercadolivre") {
      const match = caminho.match(/\bMLB-?(\d{6,})\b/i);
      return match ? formatoId(marketplace, `MLB${match[1]}`) : "";
    }
    if (marketplace === "kabum") return caminho.match(/\/produto\/(\d+)/i)?.[1] || "";
    return "";
  } catch { return ""; }
}

// MLBU is the factual identity of Mercado Livre's current product page.  It is
// intentionally distinct from the operational MLB item identity: a URL may
// prove the former without proving the latter.
function idFonteMlbuPorUrl(valor) {
  try {
    const url = new URL(texto(valor));
    if (dominioDa(url) !== "mercadolivre") return "";
    const match = decodeURIComponent(url.pathname).match(/\/up\/(MLBU\d{6,})(?:\/|$)/i);
    return match ? match[1].toUpperCase() : "";
  } catch { return ""; }
}

function chaveIdentidade(marketplace, identidadeProduto) {
  return crypto.createHash("sha256")
    .update(JSON.stringify([marketplace, identidadeProduto]))
    .digest("hex");
}

function componentesIdentidadeCanonica(oferta = {}) {
  const marketplace = mercado(oferta.marketplace);
  if (!marketplace || !["amazon", "mercadolivre", "shopee", "aliexpress", "kabum"].includes(marketplace)) return null;
  const fontesOriginais = [oferta.urlOriginal, oferta.linkOriginal, oferta.urlCanonica, oferta.url];
  const urls = (marketplace === "mercadolivre"
    ? fontesOriginais
    : [...fontesOriginais, oferta.link, oferta.urlAfiliada])
    .map(texto).filter(Boolean);
  const idsUrl = new Set();
  for (const valor of urls) {
    let url;
    try { url = new URL(valor); } catch { continue; }
    const familia = dominioDa(url);
    if (familia && familia !== marketplace) return null;
    const id = idProdutoPorUrl(marketplace, valor);
    if (id) idsUrl.add(id);
  }
  const candidatos = [oferta.produtoId, oferta.productId, oferta.idProduto, oferta.asin, oferta.mlbId,
    ...(marketplace === "shopee" ? [] : [oferta.itemId])]
    .map(texto).filter(Boolean);
  // Campos brutos contraditorios nao podem escolher arbitrariamente o primeiro.
  if (candidatos.some((id) => !formatoId(marketplace, id))) return null;
  const prova = oferta.identidadeProdutoVerificada;
  const idOficial = formatoId(marketplace, prova?.id);
  const comprovado = prova?.origem === "engine_importer" && mercado(prova.marketplace) === marketplace && idOficial;
  const metadata = oferta.metadata || {};
  const universal = metadata.ofertaUniversal || {};
  const idUniversal = formatoId(marketplace, universal.produto?.idExterno);
  const universalValidada = metadata.ofertaUniversalValidacao?.ok === true &&
    mercado(universal.marketplace) === marketplace &&
    texto(universal.workspaceId) === texto(oferta.clienteId || oferta.workspaceId) && idUniversal;
  const idCapture = marketplace === "mercadolivre"
    ? formatoId(marketplace, validarProvaCaptureMl(oferta.identidadeMlCapture || {}, oferta)) : "";
  const ids = new Set([...idsUrl, ...(comprovado ? [idOficial] : []),
    ...(idCapture ? [idCapture] : []),
    ...(universalValidada ? [idUniversal] : [])]);
  if (ids.size !== 1 || (candidatos.length && candidatos.some((id) => !ids.has(formatoId(marketplace, id))))) return null;
  if (marketplace === "mercadolivre") {
    for (const link of [oferta.link, oferta.urlAfiliada].map(texto).filter(Boolean)) {
      const idAfiliado = idProdutoPorUrl(marketplace, link);
      if (idAfiliado && !ids.has(idAfiliado)) return null;
    }
  }
  if (marketplace === "shopee" && texto(oferta.itemId) &&
      texto(oferta.itemId) !== [...ids][0].split("/")[1]) return null;
  return {
    marketplace,
    identidadeProduto: [...ids][0],
    origem: comprovado || universalValidada ? "adapter_oficial" : (idCapture ? "ml_identity_v1" : "url_produto_oficial")
  };
}

function identidadeCanonica(oferta = {}) {
  const componentes = componentesIdentidadeCanonica(oferta);
  if (!componentes) return "";
  return chaveIdentidade(componentes.marketplace, componentes.identidadeProduto);
}

// Capture-to-List has a different minimum than operational dispatch: its
// source identity must be factual, while an operational marketplace identity
// remains an optional, verified alias.  This never derives MLB from MLBU or
// from wid/title data.
function componentesIdentidadeCaptura(oferta = {}) {
  const marketplace = mercado(oferta.marketplace);
  const operacional = componentesIdentidadeCanonica(oferta);
  if (marketplace === "mercadolivre") {
    const mlbu = idFonteMlbuPorUrl(oferta.urlOriginal || oferta.linkOriginal || oferta.url);
    if (mlbu) {
      const identidadeFonte = mlbu.toLowerCase();
      const chaveFonte = chaveIdentidade(marketplace, identidadeFonte);
      const mlbVerificado = operacional?.identidadeProduto || "";
      const chaves = [chaveFonte, ...(mlbVerificado
        ? [chaveIdentidade(marketplace, mlbVerificado)] : [])];
      return {
        marketplace,
        canonicalKey: chaveFonte,
        identityKeys: [...new Set(chaves)],
        sourceProductIdentity: {
          marketplace,
          type: "MLBU",
          value: mlbu,
          source: "url_original"
        },
        ...(mlbVerificado ? {
          operationalMarketplaceIdentity: {
            marketplace,
            type: "MLB",
            value: mlbVerificado.toUpperCase(),
            verification: operacional.origem
          }
        } : {})
      };
    }
  }
  if (!operacional) return null;
  const chave = chaveIdentidade(operacional.marketplace, operacional.identidadeProduto);
  return {
    marketplace: operacional.marketplace,
    canonicalKey: chave,
    identityKeys: [chave],
    sourceProductIdentity: {
      marketplace: operacional.marketplace,
      type: operacional.marketplace === "mercadolivre" ? "MLB" : "marketplace_product",
      value: operacional.identidadeProduto,
      source: operacional.origem
    },
    ...(operacional.marketplace === "mercadolivre" ? {
      operationalMarketplaceIdentity: {
        marketplace: operacional.marketplace,
        type: "MLB",
        value: operacional.identidadeProduto.toUpperCase(),
        verification: operacional.origem
      }
    } : {})
  };
}

function normalizarTituloConservador(valor) {
  const titulo = texto(valor)
    .toLowerCase()
    .replace(/\bc\s*\/\s*/g, " com ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!titulo) return "";
  const tokens = titulo.split(/\s+/).map((token) => {
    if (token.length >= 5 && token.endsWith("s") && !/(?:is|us|ss)$/.test(token)) return token.slice(0, -1);
    return token;
  });
  const relevantes = tokens.filter((token) => token.length >= 3 || /^\d+$/.test(token));
  const normalizado = tokens.join(" ");
  return relevantes.length >= 3 && normalizado.length >= 12 ? normalizado : "";
}

function identidadeTituloConservadora(oferta = {}) {
  const marketplace = mercado(oferta.marketplace);
  const titulo = normalizarTituloConservador(oferta.titulo || oferta.produto?.titulo);
  if (!marketplace || !titulo) return "";
  return `titulo:${crypto.createHash("sha256")
    .update(JSON.stringify([marketplace, titulo]))
    .digest("hex")}`;
}

function identidadeIsoladaObservacao(oferta = {}) {
  const marketplace = texto(oferta.marketplace).toLowerCase() || "desconhecido";
  const observacaoId = texto(oferta.identidadeObservacaoId || oferta.ofertaIdAtual || oferta.ofertaId || oferta.id || oferta.engineOfertaId);
  const workspaceId = texto(oferta.clienteId || oferta.workspaceId);
  if (!observacaoId) return "";
  return `isolada:${crypto.createHash("sha256")
    .update(JSON.stringify([workspaceId, marketplace, observacaoId]))
    .digest("hex")}`;
}

module.exports = {
  canonicalizarUrl,
  idProdutoPorUrl,
  idFonteMlbuPorUrl,
  componentesIdentidadeCanonica,
  componentesIdentidadeCaptura,
  identidadeCanonica,
  normalizarTituloConservador,
  identidadeTituloConservadora,
  identidadeIsoladaObservacao
};
