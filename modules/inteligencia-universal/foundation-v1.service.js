const crypto = require("crypto");

const { normalizarMarketplace, texto } = require("./normalizacao.service");
const {
  CLASSIFIER_VERSION,
  classifyMulticategoryShadow
} = require("./classification-v1.service");

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
  return /(?:^|\b)(?:trouxe pra voce|corre que|imperdivel|oferta do dia|promocao|aproveita(?: e)?|aproveite|so hoje|baratinho|olha isso|todo mundo vai perguntar)(?:\b|$)/.test(linha) ||
    /\b(?:cupom|cupons|desconto|frete gratis|por apenas|convida(?:r)? .* grupo .* link|garanta .* enquanto .* ativo)\b/.test(linha) ||
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
    ["api_feed_oficial", raw.tituloOficial],
    ["api_feed_oficial", produto.tituloOficial],
    ["api_feed_oficial", produto.titleOfficial],
    ["pagina_oficial", oferta.tituloPagina],
    ["pagina_oficial", raw.tituloPagina],
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
  const metadados = [objeto(oferta.metadata), objeto(raw.metadata),
    objeto(oferta.evento_metadata), objeto(oferta.job_metadata?.metadataEvento)];
  const produtos = [objeto(oferta.produto), objeto(oferta.ofertaUniversal?.produto),
    ...metadados.flatMap(m => [objeto(m.produto), objeto(m.ofertaUniversal?.produto)])];
  const textoSeguranca = normalizarComparacao([
    tituloFactual.title, oferta.titulo, oferta.tituloFactual, oferta.tituloOficial, oferta.nome, oferta.descricao,
    raw.titulo, raw.descricao,
    ...metadados.flatMap(m => [m.provaTituloTecnicoValidada?.titulo?.valor,
      m.radarMirror?.produto?.tituloCapturado, m.radarEspelhoComercial?.radarMirror?.produto?.tituloCapturado]),
    ...produtos.flatMap(p => [p.titulo, p.tituloFactual, p.nome, p.tipoProduto, p.categoriaOficial,
      p.categoriaMarketplace?.tipoProduto, ...(Array.isArray(p.categoriaMarketplace?.hierarquia)
        ? p.categoriaMarketplace.hierarquia.slice(0, 8) : [])]),
    oferta.categoriaMarketplace?.tipoProduto,
    ...(Array.isArray(oferta.categoriaMarketplace?.hierarquia)
      ? oferta.categoriaMarketplace.hierarquia.slice(0, 8) : [])
  ].filter(v => typeof v === "string").map(v => v.slice(0, 2000)).join(" "));
  const adulto = /\b(?:sex toys?|sex shop|vibrador(?:es)?|dildos?|masturbador(?:es)?|estimulador sexual|eroticos?|eroticas?|plug anal)\b/.test(textoSeguranca);
  const infantil = /\b(?:infantil|bebe|crianca|menino|menina|juvenil)\b/.test(textoSeguranca);
  const classesRegistradas = [oferta.segurancaPublicacao?.class, ...metadados.flatMap(m => [
    m.segurancaPublicacao?.class,
    // Persisted JSON carries a value. A lazy shadow accessor is not a
    // requirement for the authoritative safety decision.
    Object.getOwnPropertyDescriptor(m, "intelligenceV1Routing")?.value?.safety?.class
  ])];
  const categoriaReservada = [oferta.categoria, oferta.categoriaProduto,
    ...produtos.map(p => p.categoriaNormalizada)].some(v =>
    normalizarComparacao(v) === normalizarComparacao(RESERVED_COMMERCIAL_CATEGORY));
  const incertaExplicita = metadados.some(m => m.safetyEvidence?.uncertain === true) ||
    produtos.some(p => p.safetyUncertain === true) || classesRegistradas.includes(SAFETY_CLASS.UNCERTAIN);

  if (adulto || categoriaReservada || classesRegistradas.includes(SAFETY_CLASS.ADULT)) {
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

function avaliarSegurancaPublicacao(...ofertas) {
  let classe = SAFETY_CLASS.GENERAL;
  for (const oferta of ofertas) {
    if (!oferta || typeof oferta !== "object") continue;
    const safety = resolverSafetyClassIntelligenceV1(oferta);
    if (safety.class === SAFETY_CLASS.ADULT) { classe = safety.class; break; }
    if (safety.class === SAFETY_CLASS.UNCERTAIN ||
        (safety.class === SAFETY_CLASS.CHILD && classe === SAFETY_CLASS.GENERAL)) classe = safety.class;
  }
  const motivo = classe === SAFETY_CLASS.ADULT ? "seguranca_conteudo_adulto"
    : classe === SAFETY_CLASS.UNCERTAIN ? "seguranca_conteudo_incerto" : "";
  return { ok: !motivo, class: classe, motivo };
}

function resolverClassificacaoIntelligenceV1(oferta = {}, identidade, tituloFactual, safety) {
  return classifyMulticategoryShadow({ offer: oferta, identity: identidade, factualTitle: tituloFactual, safety });
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
      categoriasAfinidade: Object.freeze([...classificacao.affinities]),
      evidence: Object.freeze([...(classificacao.evidence || [])]),
      reason: classificacao.reason,
      confidence: classificacao.confidence,
      classifierVersion: CLASSIFIER_VERSION
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
  avaliarSegurancaPublicacao,
  resolverClassificacaoIntelligenceV1,
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global,
  limparTituloFactual
};
