"use strict";

const ORIGEM_PROVA = "card-featured.polycards[0].metadata";
const TIPO_PROVA_PDP_FILTERS = "pdp_filters_item_id";
const TIPO_PROVA_ESTRUTURAL = "card_featured_estrutural";

function normalizarMlbExato(valor = "") {
  const match = String(valor || "").trim().match(/^MLB-?(\d{6,})$/i);
  return match ? `MLB${match[1]}` : "";
}

function extrairJsonBalanceado(fonte = "", inicio = -1, abertura = "[", fechamento = "]") {
  if (inicio < 0 || fonte[inicio] !== abertura) return "";
  let profundidade = 0;
  let emString = false;
  let escapado = false;

  for (let indice = inicio; indice < fonte.length; indice += 1) {
    const caractere = fonte[indice];
    if (emString) {
      if (escapado) escapado = false;
      else if (caractere === "\\") escapado = true;
      else if (caractere === '"') emString = false;
      continue;
    }
    if (caractere === '"') {
      emString = true;
      continue;
    }
    if (caractere === abertura) profundidade += 1;
    if (caractere === fechamento) profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, indice + 1);
  }

  return "";
}

function extrairObjetoJsonContendo(fonte = "", indiceAlvo = -1) {
  if (indiceAlvo < 0) return "";
  const pilha = [];
  let emString = false;
  let escapado = false;

  for (let indice = 0; indice < indiceAlvo; indice += 1) {
    const caractere = fonte[indice];
    if (emString) {
      if (escapado) escapado = false;
      else if (caractere === "\\") escapado = true;
      else if (caractere === '"') emString = false;
      continue;
    }
    if (caractere === '"') emString = true;
    else if (caractere === "{") pilha.push(indice);
    else if (caractere === "}") pilha.pop();
  }

  const inicioObjeto = pilha.at(-1);
  return extrairJsonBalanceado(fonte, inicioObjeto, "{", "}");
}

function normalizarUrlMetadata(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) return "";
  if (texto.startsWith("//")) return `https:${texto}`;
  if (texto.startsWith("www.")) return `https://${texto}`;
  return texto;
}

function extrairMlbsTexto(valor = "") {
  return [...String(valor || "").matchAll(/MLBP?-?\d{6,}/gi)]
    .map(match => normalizarMlbExato(String(match[0] || "").replace(/^MLBP/i, "MLB")))
    .filter(Boolean);
}

function validarUrlProduto({ url = "", mlbProduto = "", mlbItem = "", exigirPdpFilters = true } = {}) {
  try {
    const parsed = new URL(normalizarUrlMetadata(url));
    const host = parsed.hostname.toLowerCase();
    if (!(host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br"))) {
      return { ok: false, motivo: "dominio_produto_nao_oficial" };
    }
    if (parsed.pathname.toLowerCase().startsWith("/social/")) {
      return { ok: false, motivo: "url_produto_social" };
    }

    const matchProduto = parsed.pathname.match(/\/p\/(MLB-?\d{6,})(?:\/|$)/i);
    const produtoUrl = normalizarMlbExato(matchProduto?.[1] || "");
    if (!produtoUrl || produtoUrl !== mlbProduto) {
      return { ok: false, motivo: "metadata_product_id_diverge_url" };
    }

    if (exigirPdpFilters) {
      const filtros = parsed.searchParams.getAll("pdp_filters");
      if (filtros.length !== 1) {
        return { ok: false, motivo: "pdp_filters_ausente_ou_ambiguo" };
      }
      const matchItem = filtros[0].match(/^item_id\s*:\s*(MLB-?\d{6,})$/i);
      const itemUrl = normalizarMlbExato(matchItem?.[1] || "");
      if (!itemUrl || itemUrl !== mlbItem) {
        return { ok: false, motivo: "metadata_id_diverge_item_id" };
      }
    }

    parsed.hash = "";
    parsed.search = "";
    parsed.searchParams.set("pdp_filters", `item_id:${mlbItem}`);
    return { ok: true, urlProduto: parsed.toString(), mlbProduto, mlbItem };
  } catch {
    return { ok: false, motivo: "url_produto_invalida" };
  }
}

function provaUsaPdpFilters(prova = {}) {
  try {
    const parsed = new URL(normalizarUrlMetadata(prova.urlProduto || ""));
    return parsed.searchParams.getAll("pdp_filters").some(filtro => {
      const matchItem = String(filtro || "").match(/^item_id\s*:\s*(MLB-?\d{6,})$/i);
      return normalizarMlbExato(matchItem?.[1] || "") === normalizarMlbExato(prova.mlbItem);
    });
  } catch {
    return false;
  }
}

function provaEstruturalPodeDispensarPdpFilters(prova = {}) {
  if (prova.tipoProva !== TIPO_PROVA_ESTRUTURAL) return false;

  const mlbItem = normalizarMlbExato(prova.mlbItem);
  const mlbProduto = normalizarMlbExato(prova.mlbProduto);
  if (!mlbItem || !mlbProduto) return false;

  const urlFragments = String(prova.urlFragments || "");
  if (/reco_item_pos\s*=/i.test(urlFragments) || /recommendations_home/i.test(urlFragments)) {
    return false;
  }

  const wid = normalizarMlbExato(prova.wid);
  if (wid && wid !== mlbItem) return false;

  const idsInternos = extrairMlbsTexto([
    prova.wid,
    prova.pid,
    prova.pidExtended,
    prova.urlFragments
  ].filter(Boolean).join(" "));

  const temVinculoItem = idsInternos.includes(mlbItem);
  const temVinculoProduto = idsInternos.includes(mlbProduto);
  return temVinculoItem && temVinculoProduto;
}

function validarProvaIdentidadeMercadoLivre(prova = {}, opcoes = {}) {
  if (!prova || typeof prova !== "object") return { ok: false, motivo: "prova_ausente" };
  if (prova.origem !== ORIGEM_PROVA || prova.cardFeaturedUnico !== true || prova.totalPolycards !== 1) {
    return { ok: false, motivo: "bloco_destacado_ambiguo" };
  }

  const mlbItem = normalizarMlbExato(prova.mlbItem);
  const mlbProduto = normalizarMlbExato(prova.mlbProduto);
  if (!mlbItem || !mlbProduto) return { ok: false, motivo: "metadata_sem_identidade_explicita" };

  const exigirPdpFilters = !(!provaUsaPdpFilters(prova) && provaEstruturalPodeDispensarPdpFilters(prova));
  const validacao = validarUrlProduto({ url: prova.urlProduto, mlbProduto, mlbItem, exigirPdpFilters });
  if (!validacao.ok) return validacao;

  if (opcoes.urlProdutoResolvido) {
    const resolvida = validarUrlProduto({
      url: opcoes.urlProdutoResolvido,
      mlbProduto,
      mlbItem,
      exigirPdpFilters
    });
    if (!resolvida.ok || resolvida.urlProduto !== validacao.urlProduto) {
      return { ok: false, motivo: "produto_resolvido_diverge_prova" };
    }
  }

  return {
    ...validacao,
    origem: ORIGEM_PROVA,
    tipoProva: exigirPdpFilters ? TIPO_PROVA_PDP_FILTERS : (prova.tipoProva || TIPO_PROVA_ESTRUTURAL)
  };
}

function extrairProvaIdentidadeMercadoLivreHtml(html = "") {
  const fonte = String(html || "");
  const marcadores = [...fonte.matchAll(/"id"\s*:\s*"card-featured"/g)];
  if (marcadores.length !== 1) {
    return { ok: false, motivo: "card_featured_ausente_ou_ambiguo" };
  }

  const jsonCard = extrairObjetoJsonContendo(fonte, marcadores[0].index);
  if (!jsonCard) return { ok: false, motivo: "card_featured_json_invalido" };

  let cardFeatured;
  try {
    cardFeatured = JSON.parse(jsonCard);
  } catch {
    return { ok: false, motivo: "card_featured_json_invalido" };
  }
  if (cardFeatured?.id !== "card-featured") return { ok: false, motivo: "card_featured_invalido" };

  const polycards = cardFeatured?.recommendation_data?.recommendation_info?.polycards;
  if (!Array.isArray(polycards) || polycards.length !== 1) {
    return { ok: false, motivo: "polycard_destacado_ausente_ou_ambiguo" };
  }

  const metadata = polycards[0]?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, motivo: "metadata_destacada_ausente" };
  }

  const mlbItem = normalizarMlbExato(metadata.id);
  const mlbProduto = normalizarMlbExato(metadata.product_id);
  if (!mlbItem || !mlbProduto) {
    return { ok: false, motivo: "metadata_sem_identidade_explicita" };
  }

  const urlBase = normalizarUrlMetadata(metadata.url);
  let urlComIdentidade = urlBase;
  try {
    const parsed = new URL(urlBase);
    if (parsed.search) {
      return { ok: false, motivo: "metadata_url_params_ambiguo" };
    }
    if (String(metadata.url_params || "").startsWith("?")) {
      parsed.search = String(metadata.url_params);
    }
    urlComIdentidade = parsed.toString();
  } catch {
    return { ok: false, motivo: "metadata_url_invalida" };
  }

  const prova = {
    origem: ORIGEM_PROVA,
    cardFeaturedUnico: true,
    totalPolycards: 1,
    mlbItem,
    mlbProduto,
    urlProduto: urlComIdentidade,
    wid: metadata.wid || "",
    pid: metadata.pid || "",
    pidExtended: metadata.pid_extended || "",
    urlFragments: metadata.url_fragments || "",
    tipoProva: String(metadata.url_params || "").includes("pdp_filters=")
      ? TIPO_PROVA_PDP_FILTERS
      : TIPO_PROVA_ESTRUTURAL
  };
  const validacao = validarProvaIdentidadeMercadoLivre(prova);
  return validacao.ok
    ? { ...prova, ok: true, urlProduto: validacao.urlProduto, tipoProva: validacao.tipoProva }
    : validacao;
}

module.exports = {
  ORIGEM_PROVA,
  TIPO_PROVA_ESTRUTURAL,
  TIPO_PROVA_PDP_FILTERS,
  extrairProvaIdentidadeMercadoLivreHtml,
  normalizarMlbExato,
  validarProvaIdentidadeMercadoLivre
};
