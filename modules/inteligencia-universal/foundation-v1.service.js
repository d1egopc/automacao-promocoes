const crypto = require("crypto");

const { categoriaExiste } = require("../../marketplaces/inteligencia/categorias-globais");
const { classificarCategoriaUniversal } = require("./categoria.service");
const { normalizarMarketplace, texto } = require("./normalizacao.service");

const INTELLIGENCE_V1_SCHEMA_VERSION = "optimus-intelligence-v1-phase-a";
const INTELLIGENCE_V1_MODES = Object.freeze({ OFF: "off", SHADOW: "shadow" });
const CLASSIFICATION_STATUS = Object.freeze({
  RESOLVED: "resolved",
  PENDING: "pending",
  UNCERTAIN: "uncertain",
  REJECTED: "rejected"
});
const SAFETY_CLASS = Object.freeze({
  GENERAL: "general",
  ADULT: "adult",
  CHILD: "child",
  UNCERTAIN: "uncertain"
});
const RESERVED_COMMERCIAL_CATEGORY = "Sex Shop +18";

const TRUSTED_IDENTITY_SOURCES = new Set([
  "api_oficial",
  "feed_oficial",
  "pagina_oficial",
  "marketplace_oficial",
  "extension_verified",
  "local_worker_verified"
]);

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const atual = texto(valor);
    if (atual) return atual;
  }
  return "";
}

function valoresDistintos(valores = []) {
  return [...new Set(valores.map(valor => texto(valor)).filter(Boolean))];
}

function normalizarIdProduto(valor = "", marketplace = "") {
  const limpo = texto(valor).replace(/[^a-z0-9._/-]+/gi, "");
  if (!limpo) return "";
  if (marketplace === "mercadolivre") return limpo.toUpperCase().replace(/^MLB-?(\d+)$/, "MLB$1");
  if (marketplace === "amazon") return limpo.toUpperCase();
  return limpo.toLowerCase();
}

function hashEvidencia(partes = []) {
  const valor = partes.map(item => texto(item)).filter(Boolean).join("|");
  return valor ? crypto.createHash("sha256").update(valor).digest("hex") : "";
}

function resolverIdentidadeIntelligenceV1(oferta = {}) {
  const raw = objeto(oferta.raw);
  const metadata = objeto(oferta.metadata || raw.metadata);
  const produto = objeto(metadata.produto);
  const marketplace = normalizarMarketplace(primeiroTexto(oferta.marketplace, raw.marketplace));
  const productIdsPrimarios = valoresDistintos([
    oferta.produtoIdDetectado,
    oferta.produtoId,
    oferta.productId,
    raw.produtoIdDetectado,
    raw.produtoId,
    raw.productId,
    produto.produtoId,
    produto.productId
  ].map(valor => normalizarIdProduto(valor, marketplace)));
  const itemIds = valoresDistintos([
    oferta.itemId,
    raw.itemId,
    produto.itemId
  ].map(valor => normalizarIdProduto(valor, marketplace)));
  // itemId e productId podem ser aliases ou campos semanticamente distintos
  // dependendo do marketplace. Compare itemIds somente quando nao ha uma
  // identidade de produto mais forte, evitando falsa divergencia na Shopee.
  const productIds = productIdsPrimarios.length ? productIdsPrimarios : itemIds;
  const skus = valoresDistintos([
    oferta.sku,
    raw.sku,
    produto.sku,
    produto.skuId
  ].map(valor => normalizarIdProduto(valor, marketplace)));
  const variantes = valoresDistintos([
    oferta.variante,
    raw.variante,
    produto.variante,
    produto.variationId
  ].map(valor => normalizarIdProduto(valor, marketplace)));
  const fonte = normalizarComparacao(primeiroTexto(
    oferta.identitySource,
    raw.identitySource,
    produto.identitySource,
    produto.fonteIdentidade,
    metadata.identitySource
  )).replace(/\s+/g, "_");
  const confirmacaoExplicita = [
    oferta.identityConfirmed,
    raw.identityConfirmed,
    produto.identityConfirmed,
    produto.identidadeConfirmada,
    metadata.identityConfirmed
  ].some(valor => valor === true);
  const divergente = productIds.length > 1 || skus.length > 1 || variantes.length > 1;
  const produtoId = productIds[0] || "";
  const sku = skus[0] || "";
  const variante = variantes[0] || "";
  const confirmada = !divergente && Boolean(produtoId || sku) &&
    (confirmacaoExplicita || TRUSTED_IDENTITY_SOURCES.has(fonte));
  const identityKey = confirmada
    ? [marketplace, produtoId || "sem_product_id", sku || "sem_sku", variante || "sem_variante"].join(":")
    : "";

  return Object.freeze({
    marketplace,
    productId: produtoId || null,
    sku: sku || null,
    variant: variante || null,
    identityKey: identityKey || null,
    source: fonte || "nao_informada",
    confirmed: confirmada,
    divergent: divergente,
    confidence: divergente ? "rejected" : (confirmada ? "high" : "unconfirmed"),
    evidenceHash: confirmada ? hashEvidencia([marketplace, produtoId, sku, variante, fonte]) : null
  });
}

function linhaPromocional(valor = "") {
  const linha = normalizarComparacao(valor);
  if (!linha) return true;
  return /(?:^|\b)(?:trouxe pra voce|corre que|imperdivel|oferta do dia|promocao|aproveite|so hoje|baratinho|olha isso)(?:\b|$)/.test(linha) ||
    /\b(?:cupom|desconto|frete gratis|por apenas)\b/.test(linha) ||
    /(?:https?:\/\/|www\.|\br\$\s*\d)/i.test(valor);
}

function limparTituloFactual(valor = "") {
  const semPrefixo = texto(valor)
    .replace(/^.*?\btrouxe\s+pra\s+voc[eê]\s*[:\-–—|]*\s*/i, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, " ");
  const linhas = semPrefixo
    .split(/[\r\n]+/)
    .map(item => item.replace(/^[\s*#✅🔥⚡➡️👉]+|[\s*#]+$/gu, "").replace(/\s+/g, " ").trim())
    .filter(item => item && !linhaPromocional(item));
  const titulo = texto(linhas[0] || "").slice(0, 180).trim();
  if (!/[a-z\u00c0-\u024f]/i.test(titulo) || normalizarComparacao(titulo).split(" ").length < 2) return "";
  return titulo;
}

function resolverTituloFactualIntelligenceV1(oferta = {}, identidade = resolverIdentidadeIntelligenceV1(oferta)) {
  const raw = objeto(oferta.raw);
  const metadata = objeto(oferta.metadata || raw.metadata);
  const produto = objeto(metadata.produto);
  const extension = objeto(metadata.extension);
  const localWorker = objeto(metadata.localWorker);
  const radarMirror = objeto(metadata.radarMirror);
  const candidatos = [
    ["api_feed_oficial", oferta.tituloOficial],
    ["api_feed_oficial", produto.tituloOficial],
    ["api_feed_oficial", produto.titleOfficial],
    ["pagina_oficial", oferta.tituloPagina],
    ["pagina_oficial", produto.tituloPagina],
    ["extension_verified", extension.titulo],
    ["local_worker_verified", localWorker.titulo],
    ["produto_confirmado", produto.tituloFactual],
    ["produto_confirmado", produto.titulo],
    ["produto_confirmado", produto.name],
    ["titulo_factual_existente", oferta.tituloFactual],
    ["titulo_factual_existente", raw.tituloFactual],
    ["captura_origem", oferta.titulo],
    ["captura_origem", oferta.nome],
    ["captura_origem", radarMirror.tituloCapturado]
  ];

  if (!identidade.confirmed) {
    return Object.freeze({
      title: null,
      source: "identidade_nao_confirmada",
      confidence: "unconfirmed",
      factual: false,
      evidenceHash: null
    });
  }

  for (const [fonte, candidato] of candidatos) {
    const titulo = limparTituloFactual(candidato);
    if (!titulo) continue;
    return Object.freeze({
      title: titulo,
      source: fonte,
      confidence: fonte === "captura_origem" ? "medium" : "high",
      factual: true,
      evidenceHash: hashEvidencia([identidade.identityKey, titulo, fonte])
    });
  }

  return Object.freeze({
    title: null,
    source: "titulo_factual_ausente",
    confidence: "unconfirmed",
    factual: false,
    evidenceHash: null
  });
}

function resolverSafetyClassIntelligenceV1(oferta = {}, tituloFactual = {}) {
  const raw = objeto(oferta.raw);
  const metadata = objeto(oferta.metadata || raw.metadata);
  const produto = objeto(metadata.produto);
  const textoSeguranca = normalizarComparacao([
    tituloFactual.title,
    oferta.titulo,
    oferta.nome,
    oferta.descricao,
    raw.descricao,
    produto.tipoProduto,
    produto.categoriaOficial
  ].filter(Boolean).join(" "));
  const adulto = /\b(?:sex shop|vibrador(?:es)?|dildos?|masturbador(?:es)?|estimulador sexual|eroticos?|eroticas?|plug anal)\b/.test(textoSeguranca);
  const infantil = /\b(?:infantil|bebe|crianca|menino|menina|juvenil)\b/.test(textoSeguranca);
  const incertaExplicita = metadata.safetyEvidence?.uncertain === true || produto.safetyUncertain === true;

  if (adulto) {
    return Object.freeze({
      class: SAFETY_CLASS.ADULT,
      reason: infantil ? "adult_child_conflict" : "explicit_adult_nature",
      confidence: "high",
      adultDistributionAllowed: false,
      reservedCommercialCategory: RESERVED_COMMERCIAL_CATEGORY
    });
  }
  if (incertaExplicita) {
    return Object.freeze({
      class: SAFETY_CLASS.UNCERTAIN,
      reason: "explicit_safety_uncertainty",
      confidence: "low",
      adultDistributionAllowed: false,
      reservedCommercialCategory: null
    });
  }
  if (infantil) {
    return Object.freeze({
      class: SAFETY_CLASS.CHILD,
      reason: "explicit_child_nature",
      confidence: "high",
      adultDistributionAllowed: false,
      reservedCommercialCategory: null
    });
  }
  return Object.freeze({
    class: SAFETY_CLASS.GENERAL,
    reason: "no_adult_evidence",
    confidence: "high",
    adultDistributionAllowed: false,
    reservedCommercialCategory: null
  });
}

function categoriasUnicas(principal, candidatas = []) {
  return [...new Set(candidatas)]
    .filter(categoria => categoriaExiste(categoria) && categoria !== "Diversos" && categoria !== principal);
}

function categoriasPorNaturezaV1(titulo = "") {
  const t = normalizarComparacao(titulo);
  if (/\bperfume\b|\beau de (?:toilette|parfum)\b|\bbody splash\b/.test(t)) {
    return { principal: "Perfumaria, Farmácia e Beleza", afinidades: [], reason: "perfume_confirmed" };
  }
  if (/\bcalca\b/.test(t) && /\bpesca\b/.test(t) && /\b(?:masculina|masculino|homem)\b/.test(t)) {
    return { principal: "Pesca e Camping", afinidades: ["Roupas e Moda Masculina"], reason: "fishing_menswear_confirmed" };
  }
  if (/\bcalca\b/.test(t) && /\bpesca\b/.test(t) && /\b(?:feminina|feminino|mulher)\b/.test(t)) {
    return { principal: "Pesca e Camping", afinidades: ["Roupas e Moda Feminina"], reason: "fishing_womenswear_confirmed" };
  }
  if (/\bmouse\b/.test(t) && /\bgamer\b/.test(t)) {
    return { principal: "Periféricos", afinidades: ["Gamer e Hardware"], reason: "gamer_mouse_confirmed" };
  }
  if (/\bplaca mae\b/.test(t)) {
    return { principal: "Computadores e Notebook", afinidades: ["Gamer e Hardware"], reason: "motherboard_confirmed" };
  }
  if (/\bar condicionado\b/.test(t) && /\bsplit\b/.test(t)) {
    return { principal: "Climatização e Ventilação", afinidades: ["Eletrodomésticos"], reason: "split_air_conditioner_confirmed" };
  }
  if (/\bventilador\b/.test(t)) {
    return { principal: "Climatização e Ventilação", afinidades: [], reason: "fan_confirmed" };
  }
  if (/\blanterna\b/.test(t) && /\b(?:camping|acampamento|outdoor)\b/.test(t)) {
    return { principal: "Pesca e Camping", afinidades: ["Iluminação e Elétrica"], reason: "camping_lantern_confirmed" };
  }
  if (/\blanterna\b/.test(t)) {
    return { principal: "Iluminação e Elétrica", afinidades: [], reason: "generic_lantern_confirmed" };
  }
  if (/\bcooler termico\b/.test(t) && /\b(?:camping|acampamento|outdoor)\b/.test(t)) {
    const afinidades = /\b(?:veicular|automotivo)\b/.test(t) ? ["Automotivo"] : [];
    return { principal: "Pesca e Camping", afinidades, reason: "camping_thermal_cooler_confirmed" };
  }
  return null;
}

function resolverClassificacaoIntelligenceV1(oferta = {}, identidade, tituloFactual, safety) {
  const categoriaAtual = texto(oferta.categoria);
  const fallback = categoriaExiste(categoriaAtual) ? categoriaAtual : "Diversos";

  if (identidade.divergent) {
    return Object.freeze({
      status: CLASSIFICATION_STATUS.REJECTED,
      principal: fallback,
      affinities: [],
      reason: "identity_or_sku_divergent",
      confidence: "rejected"
    });
  }
  if (!identidade.confirmed || !tituloFactual.factual) {
    return Object.freeze({
      status: CLASSIFICATION_STATUS.PENDING,
      principal: fallback,
      affinities: [],
      reason: !identidade.confirmed ? "identity_unconfirmed" : "factual_title_unavailable",
      confidence: "unconfirmed"
    });
  }
  if (safety.class === SAFETY_CLASS.ADULT) {
    return Object.freeze({
      status: CLASSIFICATION_STATUS.RESOLVED,
      principal: fallback,
      affinities: [],
      reason: "adult_commercial_category_reserved_not_enabled",
      confidence: "high"
    });
  }

  const natureza = categoriasPorNaturezaV1(tituloFactual.title);
  if (natureza) {
    return Object.freeze({
      status: CLASSIFICATION_STATUS.RESOLVED,
      principal: natureza.principal,
      affinities: categoriasUnicas(natureza.principal, natureza.afinidades),
      reason: natureza.reason,
      confidence: "high"
    });
  }

  const classificada = classificarCategoriaUniversal({
    ...oferta,
    titulo: tituloFactual.title,
    nome: tituloFactual.title
  });
  const principal = categoriaExiste(classificada.categoria) ? classificada.categoria : fallback;
  const incerta = principal === "Diversos" || classificada.baixaConfianca === true;
  return Object.freeze({
    status: incerta ? CLASSIFICATION_STATUS.UNCERTAIN : CLASSIFICATION_STATUS.RESOLVED,
    principal,
    affinities: [],
    reason: incerta ? "category_evidence_insufficient" : (classificada.motivo || "legacy_classifier_confirmed"),
    confidence: incerta ? "low" : (classificada.confianca || "heuristic")
  });
}

function construirMetadataIntelligenceV1(oferta = {}) {
  const identidade = resolverIdentidadeIntelligenceV1(oferta);
  const tituloFactual = resolverTituloFactualIntelligenceV1(oferta, identidade);
  const safety = resolverSafetyClassIntelligenceV1(oferta, tituloFactual);
  const classificacao = resolverClassificacaoIntelligenceV1(oferta, identidade, tituloFactual, safety);

  return Object.freeze({
    schemaVersion: INTELLIGENCE_V1_SCHEMA_VERSION,
    identity: identidade,
    factualTitle: tituloFactual,
    classificationStatus: classificacao.status,
    category: Object.freeze({
      principal: classificacao.principal,
      affinities: Object.freeze([...classificacao.affinities]),
      reason: classificacao.reason,
      confidence: classificacao.confidence,
      classifierVersion: INTELLIGENCE_V1_SCHEMA_VERSION
    }),
    safety,
    eligibilityAuthoritative: false,
    commercialFieldsAuthoritative: false,
    generatedAt: null
  });
}

function modoGlobalIntelligenceV1(env = process.env) {
  if (String(env.OPTIMUS_INTELLIGENCE_V1_DISABLED || "").trim() === "1") return INTELLIGENCE_V1_MODES.OFF;
  return String(env.OPTIMUS_INTELLIGENCE_V1_MODE || "").trim().toLowerCase() === INTELLIGENCE_V1_MODES.SHADOW
    ? INTELLIGENCE_V1_MODES.SHADOW
    : INTELLIGENCE_V1_MODES.OFF;
}

function avaliarIntelligenceV1Global(oferta = {}, opcoes = {}) {
  const modo = modoGlobalIntelligenceV1(opcoes.env || process.env);
  if (modo === INTELLIGENCE_V1_MODES.OFF) return Object.freeze({ mode: modo, applied: false, metadata: null });
  try {
    return Object.freeze({ mode: modo, applied: true, metadata: construirMetadataIntelligenceV1(oferta) });
  } catch {
    return Object.freeze({ mode: modo, applied: false, metadata: null, error: "intelligence_v1_shadow_unavailable" });
  }
}

module.exports = {
  INTELLIGENCE_V1_SCHEMA_VERSION,
  INTELLIGENCE_V1_MODES,
  CLASSIFICATION_STATUS,
  SAFETY_CLASS,
  RESERVED_COMMERCIAL_CATEGORY,
  modoGlobalIntelligenceV1,
  resolverIdentidadeIntelligenceV1,
  resolverTituloFactualIntelligenceV1,
  resolverSafetyClassIntelligenceV1,
  resolverClassificacaoIntelligenceV1,
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global,
  limparTituloFactual
};
