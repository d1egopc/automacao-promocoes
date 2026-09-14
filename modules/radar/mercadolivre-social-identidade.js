"use strict";

const ORIGEM_PROVA = "card-featured.polycards[0].metadata";
const ORIGEM_PROVA_BLOCO_PRINCIPAL = "bloco-principal-social";
const ORIGEM_PROVA_CANDIDATO_RADAR = "candidato-social-radar";
const TIPO_PROVA_PDP_FILTERS = "pdp_filters_item_id";
const TIPO_PROVA_ESTRUTURAL = "card_featured_estrutural";
const TIPO_PROVA_RADAR_CANDIDATO = "radar_candidato_textual";
const ORIGENS_PROVA_IDENTIDADE = new Set([ORIGEM_PROVA]);
const MAX_CANDIDATOS_RADAR_SOCIAL = 24;

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

function normalizarMlbProdutoCatalogo(valor = "") {
  return normalizarMlbExato(String(valor || "").trim().replace(/^MLBP/i, "MLB"));
}

function normalizarTextoRadarCandidatoMercadoLivre(valor = "") {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensRadarCandidatoMercadoLivre(valor = "") {
  const stopwords = new Set([
    "a", "as", "o", "os", "de", "da", "das", "do", "dos", "e", "em", "no", "na", "nos", "nas",
    "com", "para", "por", "pra", "pro", "promocao", "promo", "cupom", "oferta", "gratis", "mercado",
    "livre", "original", "produto", "novo", "nova", "kit", "un", "und", "unidade", "unidades"
  ]);
  return normalizarTextoRadarCandidatoMercadoLivre(valor)
    .split(/\s+/)
    .filter(token => token.length >= 2 && !stopwords.has(token));
}

function slugUrlProdutoMercadoLivre(url = "") {
  try {
    const parsed = new URL(normalizarUrlMetadata(url));
    return decodeURIComponent(parsed.pathname)
      .split("/")
      .filter(Boolean)
      .filter(parte => !/^p$/i.test(parte) && !/^MLB-?\d+/i.test(parte))
      .join(" ");
  } catch {
    return "";
  }
}

function textoIdentidadeCandidatoMercadoLivre(objeto = {}, url = "") {
  const chaves = [
    "title", "titulo", "name", "nome", "label", "text", "description", "subtitle",
    "heading", "alt", "aria_label", "ariaLabel"
  ];
  const textos = valoresDiretosObjeto(objeto, chaves).map(String).filter(Boolean);
  textos.push(slugUrlProdutoMercadoLivre(url));
  return textos.join(" ").trim();
}

function extrairIdentificadoresTextoMercadoLivre(valor = "") {
  const texto = normalizarTextoRadarCandidatoMercadoLivre(valor);
  const tokens = tokensRadarCandidatoMercadoLivre(texto);
  const modelos = tokens.filter(token => /[a-z]/.test(token) && /\d/.test(token));
  const voltagens = [...texto.matchAll(/\b(110|127|220)\s*v\b/g)].map(match => `${match[1]}v`);
  const capacidades = [...texto.matchAll(/\b\d+(?:[,.]\d+)?\s*(?:ml|l|gb|tb|kg|g|w|mah|cm|mm|m)\b/g)]
    .map(match => match[0].replace(/\s+/g, "").replace(",", "."));
  const kits = [...texto.matchAll(/\bkit\s*(?:com\s*)?(\d+)|\b(\d+)\s*(?:un|und|unidades|pecas|peças|camisetas|bermudas)\b/g)]
    .map(match => `kit${match[1] || match[2]}`);
  const marcasConhecidas = [
    "samsung", "motorola", "xiaomi", "apple", "lg", "philco", "mondial", "electrolux", "brastemp",
    "consul", "medicube", "redragon", "amd", "intel", "lenovo", "asus", "acer", "dell"
  ].filter(marca => tokens.includes(marca));
  return {
    tokens,
    modelos: [...new Set(modelos)],
    voltagens: [...new Set(voltagens)],
    capacidades: [...new Set(capacidades)],
    kits: [...new Set(kits)],
    marcas: [...new Set(marcasConhecidas)]
  };
}

function conjuntosConflitamMercadoLivre(a = [], b = []) {
  if (!a.length || !b.length) return false;
  return !a.some(valor => b.includes(valor));
}

function validarMatchRadarCandidatoMercadoLivre(tituloRadar = "", textoCandidato = "") {
  const radar = extrairIdentificadoresTextoMercadoLivre(tituloRadar);
  const candidato = extrairIdentificadoresTextoMercadoLivre(textoCandidato);
  if (!radar.tokens.length || !candidato.tokens.length) {
    return { ok: false, motivo: "identidade_textual_ausente" };
  }

  if (conjuntosConflitamMercadoLivre(radar.marcas, candidato.marcas)) return { ok: false, motivo: "marca_divergente" };
  if (conjuntosConflitamMercadoLivre(radar.modelos, candidato.modelos)) return { ok: false, motivo: "modelo_divergente" };
  if (conjuntosConflitamMercadoLivre(radar.voltagens, candidato.voltagens)) return { ok: false, motivo: "voltagem_divergente" };
  if (conjuntosConflitamMercadoLivre(radar.capacidades, candidato.capacidades)) return { ok: false, motivo: "capacidade_divergente" };
  if (conjuntosConflitamMercadoLivre(radar.kits, candidato.kits)) return { ok: false, motivo: "quantidade_kit_divergente" };

  for (const grupo of [radar.modelos, radar.voltagens, radar.capacidades, radar.kits]) {
    for (const identificador of grupo) {
      if (!candidato.tokens.includes(identificador) && !normalizarTextoRadarCandidatoMercadoLivre(textoCandidato).includes(identificador)) {
        return { ok: false, motivo: "identificador_radar_ausente_candidato" };
      }
    }
  }

  const rarosRadar = radar.tokens.filter(token => token.length >= 4 || /\d/.test(token));
  const rarosCandidato = new Set(candidato.tokens);
  const intersecao = rarosRadar.filter(token => rarosCandidato.has(token));
  const minimo = Math.min(3, rarosRadar.length);
  const razao = rarosRadar.length ? intersecao.length / rarosRadar.length : 0;
  if (intersecao.length < minimo && razao < 0.72) {
    return {
      ok: false,
      motivo: "similaridade_textual_insuficiente",
      intersecao: intersecao.length,
      tokensRadar: rarosRadar.length
    };
  }

  return {
    ok: true,
    intersecao: intersecao.length,
    tokensRadar: rarosRadar.length,
    razao: Number(razao.toFixed(4))
  };
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

    const matchItemDireto = host === "produto.mercadolivre.com.br"
      ? parsed.pathname.match(/^\/(MLB-?\d{6,})(?:\D|$)/i)
      : null;
    const itemDiretoUrl = normalizarMlbExato(matchItemDireto?.[1] || "");
    if (itemDiretoUrl) {
      if (itemDiretoUrl !== mlbItem) {
        return { ok: false, motivo: "metadata_id_diverge_url_direta" };
      }
      parsed.hash = "";
      parsed.search = "";
      return { ok: true, urlProduto: parsed.toString(), mlbProduto, mlbItem };
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

  if (prova.origem === ORIGEM_PROVA_BLOCO_PRINCIPAL) {
    const itemEstrutural = normalizarMlbExato(prova.itemEstrutural);
    const produtoEstrutural = normalizarMlbProdutoCatalogo(prova.produtoEstrutural);
    return prova.blocoPrincipal === true
      && itemEstrutural === mlbItem
      && produtoEstrutural === mlbProduto;
  }

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
  if (prova.origem === ORIGEM_PROVA_BLOCO_PRINCIPAL && opcoes.aceitarBlocoPrincipal !== true) {
    return { ok: false, motivo: "bloco_principal_nao_homologado_contexto" };
  }
  if (prova.origem === ORIGEM_PROVA_CANDIDATO_RADAR && opcoes.aceitarCandidatoRadar !== true) {
    return { ok: false, motivo: "candidato_radar_nao_homologado_contexto" };
  }
  const origemHomologada = ORIGENS_PROVA_IDENTIDADE.has(prova.origem)
    || (prova.origem === ORIGEM_PROVA_BLOCO_PRINCIPAL && opcoes.aceitarBlocoPrincipal === true)
    || (prova.origem === ORIGEM_PROVA_CANDIDATO_RADAR && opcoes.aceitarCandidatoRadar === true);
  if (!origemHomologada || prova.cardFeaturedUnico !== true || prova.totalPolycards !== 1) {
    return { ok: false, motivo: "bloco_destacado_ambiguo" };
  }

  const mlbItem = normalizarMlbExato(prova.mlbItem);
  const mlbProduto = normalizarMlbExato(prova.mlbProduto);
  const provaCandidatoRadar = prova.origem === ORIGEM_PROVA_CANDIDATO_RADAR;
  if (!mlbItem || (!mlbProduto && !provaCandidatoRadar)) return { ok: false, motivo: "metadata_sem_identidade_explicita" };
  if (provaCandidatoRadar && prova.candidatoUnico !== true) {
    return { ok: false, motivo: "candidato_radar_ambiguo" };
  }
  if (provaCandidatoRadar && prova.matchRadar?.ok !== true) {
    return { ok: false, motivo: prova.matchRadar?.motivo || "candidato_radar_sem_match_forte" };
  }

  const exigirPdpFilters = provaCandidatoRadar
    ? false
    : !(!provaUsaPdpFilters(prova) && provaEstruturalPodeDispensarPdpFilters(prova));
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
    origem: prova.origem,
    tipoProva: provaCandidatoRadar
      ? TIPO_PROVA_RADAR_CANDIDATO
      : (exigirPdpFilters ? TIPO_PROVA_PDP_FILTERS : (prova.tipoProva || TIPO_PROVA_ESTRUTURAL)),
    ...(provaCandidatoRadar ? { matchRadar: prova.matchRadar, textoIdentidade: prova.textoIdentidade || "" } : {})
  };
}

function extrairProvaCardFeaturedMercadoLivreHtml(fonte = "") {
  const marcadores = [...fonte.matchAll(/"id"\s*:\s*"card-featured"/g)];
  if (marcadores.length === 0) {
    return { ok: false, motivo: "card_featured_ausente" };
  }
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

function valoresDiretosObjeto(objeto = {}, chaves = []) {
  if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) return [];
  return chaves
    .map(chave => objeto[chave])
    .filter(valor => typeof valor === "string" || typeof valor === "number");
}

function primeiroMlbDiretoObjeto(objeto = {}, chaves = [], normalizador = normalizarMlbExato) {
  for (const valor of valoresDiretosObjeto(objeto, chaves)) {
    const mlb = normalizador(valor);
    if (mlb) return mlb;
  }
  return "";
}

function primeiraUrlDiretaObjeto(objeto = {}, chaves = []) {
  for (const valor of valoresDiretosObjeto(objeto, chaves)) {
    const url = normalizarUrlMetadata(valor);
    if (url) return url;
  }
  return "";
}

function objetoPlano(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor);
}

function fontesProdutoBlocoPrincipal(objeto = {}) {
  const fontes = [objeto];
  for (const chave of ["metadata", "product", "produto", "item", "offer", "oferta", "main_product", "current_product", "featured_product"]) {
    if (objetoPlano(objeto[chave])) fontes.push(objeto[chave]);
  }
  return [...new Set(fontes)];
}

function objetoTemMarcadorProdutoPrincipal(objeto = {}) {
  const marcador = valoresDiretosObjeto(objeto, ["id", "type", "role", "component", "component_id", "componentId", "name"]).join(" ");
  if (/(^|[-_\s])(main|current|featured|primary)[-_\s]?(product|item|offer|pdp)([-_\s]|$)/i.test(marcador)) return true;
  if (/(^|[-_\s])(product|item|offer|pdp)[-_\s]?(main|current|featured|primary)([-_\s]|$)/i.test(marcador)) return true;
  return objeto.is_main_product === true
    || objeto.isMainProduct === true
    || objeto.mainProduct === true
    || objeto.currentProduct === true
    || objeto.featuredProduct === true;
}

function objetoContemContextoNaoComprovante(objeto = {}) {
  return /recommendation|polycard|reco_backend|reco_item_pos|item_decorator|carousel|banner|advertising|ads|adn/i.test(JSON.stringify(objeto || {}));
}

function montarProvaBlocoPrincipalObjeto(objeto = {}) {
  if (!objetoTemMarcadorProdutoPrincipal(objeto)) return null;
  if (objetoContemContextoNaoComprovante(objeto)) {
    return { ok: false, motivo: "bloco_principal_contexto_nao_comprovante" };
  }

  const candidatos = [];
  for (const fonte of fontesProdutoBlocoPrincipal(objeto)) {
    const mlbItem = primeiroMlbDiretoObjeto(fonte, ["item_id", "itemId", "item", "mlbItem", "meliItemId", "wid", "id"]);
    const mlbProduto = primeiroMlbDiretoObjeto(fonte, ["product_id", "productId", "catalog_product_id", "catalogProductId", "mlbProduto", "pid"], normalizarMlbProdutoCatalogo);
    const urlProduto = primeiraUrlDiretaObjeto(fonte, ["url", "permalink", "product_url", "productUrl", "target_url", "targetUrl", "destination_url", "destinationUrl"]);
    if (!mlbItem || !mlbProduto || !urlProduto) continue;

    const prova = {
      origem: ORIGEM_PROVA_BLOCO_PRINCIPAL,
      cardFeaturedUnico: true,
      totalPolycards: 1,
      blocoPrincipal: true,
      mlbItem,
      mlbProduto,
      itemEstrutural: mlbItem,
      produtoEstrutural: mlbProduto,
      urlProduto,
      tipoProva: /[?&]pdp_filters=/i.test(urlProduto) ? TIPO_PROVA_PDP_FILTERS : TIPO_PROVA_ESTRUTURAL
    };
    const validacao = validarProvaIdentidadeMercadoLivre(prova, { aceitarBlocoPrincipal: true });
    if (validacao.ok) {
      candidatos.push({ ...prova, ok: true, urlProduto: validacao.urlProduto, tipoProva: validacao.tipoProva });
    }
  }

  const chaves = new Set(candidatos.map(prova => `${prova.mlbItem}|${prova.mlbProduto}|${prova.urlProduto}`));
  if (chaves.size === 1) return candidatos[0];
  if (chaves.size > 1) return { ok: false, motivo: "bloco_principal_ambiguo" };
  return { ok: false, motivo: "bloco_principal_sem_identidade_completa" };
}

function extrairProvaBlocoPrincipalMercadoLivreHtml(fonte = "") {
  const marcadores = [
    /"id"\s*:\s*"[^"]*(?:main|current|featured|primary)[-_]?(?:product|item|offer|pdp)[^"]*"/gi,
    /"id"\s*:\s*"[^"]*(?:product|item|offer|pdp)[-_]?(?:main|current|featured|primary)[^"]*"/gi,
    /"(?:type|role|component|component_id|componentId|name)"\s*:\s*"[^"]*(?:main|current|featured|primary)[-_]?(?:product|item|offer|pdp)[^"]*"/gi,
    /"(?:is_main_product|isMainProduct|mainProduct|currentProduct|featuredProduct)"\s*:\s*true/gi
  ];
  const objetos = new Map();
  for (const regex of marcadores) {
    for (const match of fonte.matchAll(regex)) {
      const jsonObjeto = extrairObjetoJsonContendo(fonte, match.index);
      if (jsonObjeto) objetos.set(jsonObjeto, jsonObjeto);
    }
  }
  if (!objetos.size) return { ok: false, motivo: "bloco_principal_ausente" };

  const provas = [];
  let motivo = "bloco_principal_sem_identidade_completa";
  for (const jsonObjeto of objetos.values()) {
    try {
      const prova = montarProvaBlocoPrincipalObjeto(JSON.parse(jsonObjeto));
      if (prova?.ok) provas.push(prova);
      else if (prova?.motivo) motivo = prova.motivo;
    } catch {
      motivo = "bloco_principal_json_invalido";
    }
  }

  const chaves = new Set(provas.map(prova => `${prova.mlbItem}|${prova.mlbProduto}|${prova.urlProduto}`));
  if (chaves.size === 1) return provas[0];
  if (chaves.size > 1) return { ok: false, motivo: "bloco_principal_ambiguo" };
  return { ok: false, motivo };
}

function urlProdutoOficialDiretaObjeto(objeto = {}) {
  const chavesUrl = ["url", "permalink", "product_url", "productUrl", "target_url", "targetUrl", "destination_url", "destinationUrl"];
  for (const valor of valoresDiretosObjeto(objeto, chavesUrl)) {
    const url = normalizarUrlMetadata(valor);
    const validacaoDireta = validarUrlProduto({
      url,
      mlbItem: primeiroMlbDiretoObjeto(objeto, ["item_id", "itemId", "item", "mlbItem", "meliItemId", "wid", "id"]),
      mlbProduto: primeiroMlbDiretoObjeto(objeto, ["product_id", "productId", "catalog_product_id", "catalogProductId", "mlbProduto", "pid"], normalizarMlbProdutoCatalogo),
      exigirPdpFilters: false
    });
    if (validacaoDireta.ok) return url;
  }
  return "";
}

function montarCandidatoRadarSocialMercadoLivre(objeto = {}, tituloRadar = "") {
  if (!objetoPlano(objeto)) return null;
  const mlbItem = primeiroMlbDiretoObjeto(objeto, ["item_id", "itemId", "item", "mlbItem", "meliItemId", "wid", "id"]);
  if (!mlbItem) return null;

  const mlbProduto = primeiroMlbDiretoObjeto(
    objeto,
    ["product_id", "productId", "catalog_product_id", "catalogProductId", "mlbProduto", "pid"],
    normalizarMlbProdutoCatalogo
  );
  const urlProduto = urlProdutoOficialDiretaObjeto(objeto);
  if (!urlProduto) return null;

  const textoIdentidade = textoIdentidadeCandidatoMercadoLivre(objeto, urlProduto);
  const matchRadar = validarMatchRadarCandidatoMercadoLivre(tituloRadar, textoIdentidade);
  if (!matchRadar.ok) {
    return { ok: false, motivo: matchRadar.motivo || "candidato_radar_sem_match_forte" };
  }

  return {
    origem: ORIGEM_PROVA_CANDIDATO_RADAR,
    cardFeaturedUnico: true,
    totalPolycards: 1,
    candidatoUnico: true,
    mlbItem,
    mlbProduto,
    urlProduto,
    textoIdentidade,
    matchRadar,
    tipoProva: TIPO_PROVA_RADAR_CANDIDATO
  };
}

function extrairProvasCandidatoRadarMercadoLivreHtml(fonte = "", tituloRadar = "") {
  if (!String(tituloRadar || "").trim()) return { provas: [], motivo: "titulo_radar_ausente" };
  const texto = String(fonte || "");
  const regexUrl = /"[^"]*"\s*:\s*"[^"]*(?:produto\.mercadolivre\.com\.br\/MLB|mercadolivre\.com\.br\/[^"]*\/p\/MLB)[^"]*"/gi;
  const provas = [];
  const chaves = new Set();
  let motivo = "candidato_radar_ausente";
  let match;
  let inspecionados = 0;

  while ((match = regexUrl.exec(texto)) !== null && inspecionados < MAX_CANDIDATOS_RADAR_SOCIAL) {
    inspecionados += 1;
    const jsonObjeto = extrairObjetoJsonContendo(texto, match.index);
    if (!jsonObjeto) continue;

    try {
      const objeto = JSON.parse(jsonObjeto);
      const fontes = fontesProdutoBlocoPrincipal(objeto).filter(objetoPlano);
      for (const fonteObjeto of fontes) {
        const prova = montarCandidatoRadarSocialMercadoLivre(fonteObjeto, tituloRadar);
        if (prova?.ok === false && prova.motivo) motivo = prova.motivo;
        if (!prova?.origem) continue;
        const validacao = validarProvaIdentidadeMercadoLivre(prova, { aceitarCandidatoRadar: true });
        if (!validacao.ok) {
          motivo = validacao.motivo || motivo;
          continue;
        }
        const chave = validacao.mlbItem;
        if (chaves.has(chave)) continue;
        chaves.add(chave);
        provas.push({ ...prova, ok: true, urlProduto: validacao.urlProduto, tipoProva: validacao.tipoProva });
      }
    } catch {
      motivo = "candidato_radar_json_invalido";
    }
  }

  return { provas, motivo, inspecionados };
}

function extrairProvaCandidatoRadarMercadoLivreHtml(fonte = "", opcoes = {}) {
  const resultado = extrairProvasCandidatoRadarMercadoLivreHtml(fonte, opcoes.tituloRadar || "");
  if (resultado.provas.length === 1) return resultado.provas[0];
  if (resultado.provas.length > 1) return { ok: false, motivo: "candidato_radar_ambiguo" };
  return { ok: false, motivo: resultado.motivo || "candidato_radar_ausente" };
}

function extrairProvaIdentidadeMercadoLivreHtml(html = "", opcoes = {}) {
  const fonte = String(html || "");
  const provaCardFeatured = extrairProvaCardFeaturedMercadoLivreHtml(fonte);
  if (provaCardFeatured.ok || provaCardFeatured.motivo !== "card_featured_ausente") {
    return provaCardFeatured;
  }
  const provaBlocoPrincipal = extrairProvaBlocoPrincipalMercadoLivreHtml(fonte);
  if (provaBlocoPrincipal.ok || provaBlocoPrincipal.motivo !== "bloco_principal_ausente") {
    return provaBlocoPrincipal;
  }
  return extrairProvaCandidatoRadarMercadoLivreHtml(fonte, opcoes);
}

module.exports = {
  ORIGEM_PROVA,
  ORIGEM_PROVA_BLOCO_PRINCIPAL,
  ORIGEM_PROVA_CANDIDATO_RADAR,
  TIPO_PROVA_ESTRUTURAL,
  TIPO_PROVA_PDP_FILTERS,
  TIPO_PROVA_RADAR_CANDIDATO,
  extrairProvaIdentidadeMercadoLivreHtml,
  normalizarMlbExato,
  validarProvaIdentidadeMercadoLivre
};
