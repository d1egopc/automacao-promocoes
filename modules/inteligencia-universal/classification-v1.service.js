"use strict";

const crypto = require("crypto");

const {
  CATEGORIAS_OPTIMUS,
  categoriaExiste
} = require("../../marketplaces/inteligencia/categorias-globais");

const CLASSIFIER_VERSION = "optimus-intelligence-v1-phase-c";
const RESERVED_COMMERCIAL_CATEGORY = "Sex Shop +18";
const OFFICIAL_IDENTITY_SOURCES = new Set([
  "api_oficial",
  "feed_oficial",
  "pagina_oficial",
  "marketplace_oficial",
  "extension_verified",
  "local_worker_verified"
]);
const TRUSTED_FACTUAL_TITLE_SOURCES = new Set([
  "api_feed_oficial",
  "pagina_oficial",
  "extension_verified",
  "local_worker_verified",
  "produto_confirmado",
  "titulo_factual_existente"
]);

function text(value = "", max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value = "") {
  return text(value, 1200)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalCategoryId(value = "") {
  const category = text(value, 100);
  return categoriaExiste(category) ? category : null;
}

function evidenceHash(parts = []) {
  const value = parts.map(item => text(item)).filter(Boolean).join("|");
  return value ? crypto.createHash("sha256").update(value).digest("hex") : null;
}

function makeEvidence({ categoryId, role, source, reason, confidence = "high", identityKey = "" }) {
  const canonicalId = canonicalCategoryId(categoryId);
  if (!canonicalId || canonicalId === "Diversos" || canonicalId === RESERVED_COMMERCIAL_CATEGORY) return null;
  return Object.freeze({
    categoryId: canonicalId,
    role,
    source: text(source, 80) || "factual_title",
    reason: text(reason, 120),
    confidence,
    evidenceHash: evidenceHash([identityKey, canonicalId, role, source, reason, CLASSIFIER_VERSION])
  });
}

function uniqueAffinities(primary, values = []) {
  return [...new Set(values.map(canonicalCategoryId).filter(Boolean))]
    .filter(category => category !== primary && category !== "Diversos")
    .slice(0, 4);
}

function productFacts(offer = {}, factualTitle = {}) {
  const raw = object(offer.raw);
  const metadata = object(offer.metadata || raw.metadata);
  const product = object(metadata.produto);
  return {
    title: normalizeText(factualTitle.title),
    officialCategory: canonicalCategoryId(product.categoriaOficial || product.officialCategory),
    productType: normalizeText(product.tipoProduto || product.productType),
    source: text(factualTitle.source || "factual_title", 80)
  };
}

function matchedRule(facts = {}) {
  const value = [facts.title, facts.productType].filter(Boolean).join(" ");
  if (/\bperfume\b|\beau de (?:toilette|parfum)\b|\bbody splash\b/.test(value)) {
    return { primary: "Perfumaria, Farmácia e Beleza", affinities: [], reason: "perfume_product_nature" };
  }
  const pants = /\b(?:calca|calcas)\b/.test(value);
  const fishingPurpose = /\b(?:para pesca|de pesca|pescador|pescadora)\b/.test(value);
  if (pants && fishingPurpose && /\b(?:masculina|masculino|homem)\b/.test(value)) {
    return { primary: "Pesca e Camping", affinities: ["Roupas e Moda Masculina"], reason: "fishing_menswear_explicit" };
  }
  if (pants && fishingPurpose && /\b(?:feminina|feminino|mulher)\b/.test(value)) {
    return { primary: "Pesca e Camping", affinities: ["Roupas e Moda Feminina"], reason: "fishing_womenswear_explicit" };
  }
  if (/\bmouse\b/.test(value) && /\b(?:gamer|gaming)\b/.test(value)) {
    return { primary: "Periféricos", affinities: ["Gamer e Hardware"], reason: "gamer_mouse_identity" };
  }
  if (/\bplaca mae\b/.test(value)) {
    const gamingEvidence = /\b(?:gamer|gaming|tuf|rog|aorus)\b/.test(value);
    return {
      primary: "Computadores e Notebook",
      affinities: gamingEvidence ? ["Gamer e Hardware"] : [],
      reason: gamingEvidence ? "gaming_motherboard_identity" : "motherboard_identity"
    };
  }
  if (/\bar condicionado\b/.test(value) && /\bsplit\b/.test(value)) {
    return { primary: "Climatização e Ventilação", affinities: ["Eletrodomésticos"], reason: "split_air_conditioner_identity" };
  }
  if (/\bventilador\b/.test(value)) {
    return { primary: "Climatização e Ventilação", affinities: [], reason: "fan_identity" };
  }
  if (/\blanterna\b/.test(value) && /\b(?:camping|acampamento|outdoor)\b/.test(value)) {
    return { primary: "Pesca e Camping", affinities: ["Iluminação e Elétrica"], reason: "camping_lantern_identity" };
  }
  if (/\bcooler termico\b/.test(value) && /\b(?:camping|acampamento|outdoor)\b/.test(value)) {
    return { primary: "Pesca e Camping", affinities: [], reason: "camping_thermal_cooler_identity" };
  }
  return null;
}

function classifyMulticategoryShadow({ offer = {}, identity = {}, factualTitle = {}, safety = {} } = {}) {
  const safeOffer = object(offer);
  const legacyCategory = canonicalCategoryId(safeOffer.categoria) || "Diversos";
  const base = {
    classifierVersion: CLASSIFIER_VERSION,
    principal: legacyCategory,
    affinities: [],
    evidence: [],
    eligibilityAuthoritative: false
  };

  if (identity.divergent === true) {
    return Object.freeze({ ...base, status: "rejected", reason: "identity_or_sku_divergent", confidence: "rejected" });
  }
  if (identity.confirmed !== true || !identity.identityKey) {
    return Object.freeze({ ...base, status: "pending", reason: "identity_unconfirmed", confidence: "unconfirmed" });
  }
  if (safety.class === "adult") {
    return Object.freeze({ ...base, status: "resolved", reason: "adult_category_reserved_not_enabled", confidence: "high" });
  }
  if (factualTitle.factual !== true || !factualTitle.title) {
    return Object.freeze({ ...base, status: "pending", reason: "factual_title_unavailable", confidence: "unconfirmed" });
  }

  const facts = productFacts(safeOffer, factualTitle);
  const rule = TRUSTED_FACTUAL_TITLE_SOURCES.has(facts.source) ? matchedRule(facts) : null;
  if (rule) {
    const primary = canonicalCategoryId(rule.primary) || legacyCategory;
    const affinities = uniqueAffinities(primary, rule.affinities);
    const source = `${facts.source}:identity_confirmed`;
    const evidence = [makeEvidence({
      categoryId: primary,
      role: "principal",
      source,
      reason: rule.reason,
      identityKey: identity.identityKey
    }), ...affinities.map(categoryId => makeEvidence({
      categoryId,
      role: "affinity",
      source,
      reason: rule.reason,
      identityKey: identity.identityKey
    }))].filter(Boolean);
    return Object.freeze({
      ...base,
      status: "resolved",
      principal: primary,
      affinities: Object.freeze(affinities),
      evidence: Object.freeze(evidence),
      reason: rule.reason,
      confidence: "high"
    });
  }

  if (facts.officialCategory && facts.officialCategory !== "Diversos" &&
      OFFICIAL_IDENTITY_SOURCES.has(text(identity.source, 80))) {
    const evidence = makeEvidence({
      categoryId: facts.officialCategory,
      role: "principal",
      source: "official_product_category",
      reason: "official_category_for_confirmed_identity",
      identityKey: identity.identityKey
    });
    return Object.freeze({
      ...base,
      status: "resolved",
      principal: facts.officialCategory,
      evidence: Object.freeze(evidence ? [evidence] : []),
      reason: "official_category_for_confirmed_identity",
      confidence: "high"
    });
  }

  return Object.freeze({
    ...base,
    status: "uncertain",
    reason: legacyCategory === "Diversos"
      ? "category_evidence_insufficient"
      : "legacy_category_preserved_without_multicategory_evidence",
    confidence: "low"
  });
}

module.exports = {
  CLASSIFIER_VERSION,
  RESERVED_COMMERCIAL_CATEGORY,
  CANONICAL_CATEGORY_IDS: Object.freeze([...CATEGORIAS_OPTIMUS]),
  canonicalCategoryId,
  classifyMulticategoryShadow
};
