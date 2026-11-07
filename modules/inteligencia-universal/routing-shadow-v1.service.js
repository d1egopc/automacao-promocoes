"use strict";

const {
  CLASSIFIER_VERSION,
  canonicalCategoryId
} = require("./classification-v1.service");

const ROUTING_MODES = Object.freeze({
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active"
});
const ROUTING_BRIDGE_VERSION = "optimus-intelligence-v1-phase-d";
const ROUTING_ACTIVE_RELEASED = false;
const MAX_AFFINITIES = 4;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALID_SAFETY_CLASSES = new Set(["general", "adult", "child", "uncertain"]);
const VALID_CLASSIFICATION_STATUS = new Set(["resolved", "pending", "uncertain", "rejected"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value = "", max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function validHash(value = "") {
  return HASH_PATTERN.test(text(value, 64));
}

function categoryKey(value = "") {
  return text(value, 100)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function routingMode(env = process.env) {
  if (String(env.OPTIMUS_INTELLIGENCE_V1_ROUTING_DISABLED || "").trim() === "1") {
    return Object.freeze({
      requestedMode: ROUTING_MODES.OFF,
      effectiveMode: ROUTING_MODES.OFF,
      activeReleased: ROUTING_ACTIVE_RELEASED,
      reason: "routing_disabled"
    });
  }

  const requested = text(env.OPTIMUS_INTELLIGENCE_V1_ROUTING_MODE, 20).toLowerCase();
  if (requested === ROUTING_MODES.SHADOW) {
    return Object.freeze({
      requestedMode: requested,
      effectiveMode: ROUTING_MODES.SHADOW,
      activeReleased: ROUTING_ACTIVE_RELEASED,
      reason: "shadow_enabled"
    });
  }
  if (requested === ROUTING_MODES.ACTIVE) {
    return Object.freeze({
      requestedMode: requested,
      effectiveMode: ROUTING_MODES.OFF,
      activeReleased: ROUTING_ACTIVE_RELEASED,
      reason: "active_not_released"
    });
  }

  return Object.freeze({
    requestedMode: requested === ROUTING_MODES.OFF ? requested : ROUTING_MODES.OFF,
    effectiveMode: ROUTING_MODES.OFF,
    activeReleased: ROUTING_ACTIVE_RELEASED,
    reason: requested && requested !== ROUTING_MODES.OFF ? "invalid_mode_fail_closed" : "routing_off"
  });
}

function sanitizeEvidence(value = {}) {
  const evidence = object(value);
  const categoryId = canonicalCategoryId(evidence.categoryId);
  const role = text(evidence.role, 20);
  const evidenceHash = text(evidence.evidenceHash, 64);
  const source = text(evidence.source, 80);
  const reason = text(evidence.reason, 120);
  const confidence = text(evidence.confidence, 30);
  if (!categoryId || !["principal", "affinity"].includes(role) || !validHash(evidenceHash) ||
      !source || !reason || confidence !== "high") return null;
  return Object.freeze({
    categoryId,
    role,
    source,
    reason,
    confidence,
    evidenceHash
  });
}

function buildRoutingBridge(metadata = {}) {
  const source = object(metadata);
  const identity = object(source.identity);
  const category = object(source.category);
  const safety = object(source.safety);
  const classificationStatus = text(source.classificationStatus, 30).toLowerCase();
  const safetyClass = text(safety.class, 30).toLowerCase();
  const principal = canonicalCategoryId(category.principal);
  const affinitySource = Array.isArray(category.affinities)
    ? category.affinities
    : (Array.isArray(category.categoriasAfinidade) ? category.categoriasAfinidade : []);
  const affinities = [...new Set(affinitySource
    .map(canonicalCategoryId)
    .filter(Boolean))]
    .filter(categoryId => categoryId !== principal)
    .slice(0, MAX_AFFINITIES);
  const evidence = (Array.isArray(category.evidence) ? category.evidence : [])
    .map(sanitizeEvidence)
    .filter(Boolean)
    .slice(0, 1 + MAX_AFFINITIES);
  const classifierVersion = text(category.classifierVersion, 100);
  const identityEvidenceHash = text(identity.evidenceHash, 64);

  if (!VALID_CLASSIFICATION_STATUS.has(classificationStatus) || !VALID_SAFETY_CLASSES.has(safetyClass)) {
    return null;
  }

  return Object.freeze({
    schemaVersion: ROUTING_BRIDGE_VERSION,
    classifierVersion,
    classificationStatus,
    identity: Object.freeze({
      confirmed: identity.confirmed === true,
      divergent: identity.divergent === true,
      evidenceHash: validHash(identityEvidenceHash) ? identityEvidenceHash : null
    }),
    category: Object.freeze({
      principal,
      affinities: Object.freeze(affinities),
      evidence: Object.freeze(evidence)
    }),
    safety: Object.freeze({
      class: safetyClass,
      reason: text(safety.reason, 120),
      confidence: text(safety.confidence, 30),
      adultDistributionAllowed: false
    }),
    eligibilityAuthoritative: false,
    commercialFieldsAuthoritative: false
  });
}

function bridgeFromOffer(offer = {}) {
  const metadata = object(offer.metadata);
  return object(metadata.intelligenceV1Routing);
}

function validateRoutingBridge(value = {}) {
  const bridge = object(value);
  const identity = object(bridge.identity);
  const category = object(bridge.category);
  const safety = object(bridge.safety);
  const errors = [];
  const principal = canonicalCategoryId(category.principal);
  const affinitiesRaw = Array.isArray(category.affinities) ? category.affinities : [];
  const affinities = affinitiesRaw.map(canonicalCategoryId).filter(Boolean).slice(0, MAX_AFFINITIES);
  const evidenceRaw = Array.isArray(category.evidence) ? category.evidence : [];
  const evidence = evidenceRaw.map(sanitizeEvidence).filter(Boolean);

  if (bridge.schemaVersion !== ROUTING_BRIDGE_VERSION) errors.push("bridge_version_invalid");
  if (bridge.classifierVersion !== CLASSIFIER_VERSION) errors.push("classifier_version_invalid");
  if (bridge.classificationStatus !== "resolved") errors.push("classification_not_resolved");
  if (identity.confirmed !== true || identity.divergent === true || !validHash(identity.evidenceHash)) {
    errors.push("identity_not_confirmed");
  }
  if (!VALID_SAFETY_CLASSES.has(safety.class)) errors.push("safety_invalid");
  if (affinitiesRaw.length > MAX_AFFINITIES || affinities.length !== affinitiesRaw.length) {
    errors.push("affinities_invalid");
  }
  if (evidence.length !== evidenceRaw.length) errors.push("evidence_invalid");
  if (principal && principal !== "Diversos") {
    const principalEvidence = evidence.some(item => item.categoryId === principal && item.role === "principal");
    if (!principalEvidence) errors.push("principal_evidence_missing");
  }
  for (const affinity of affinities) {
    const affinityEvidence = evidence.some(item => item.categoryId === affinity && item.role === "affinity");
    if (!affinityEvidence) errors.push("affinity_evidence_missing");
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    principal,
    affinities: Object.freeze([...new Set(affinities.filter(item => item !== principal))]),
    adult: safety.class === "adult",
    safetyClass: VALID_SAFETY_CLASSES.has(safety.class) ? safety.class : "invalid"
  });
}

function projectedCategoryCandidates({ legacyCategories = [], bridge = {} } = {}) {
  const legacy = [...new Set((Array.isArray(legacyCategories) ? legacyCategories : [])
    .map(value => text(value, 100))
    .filter(Boolean))];
  const validation = validateRoutingBridge(bridge);

  if (validation.adult) {
    return Object.freeze({
      categories: Object.freeze([]),
      addedCategories: Object.freeze([]),
      validation,
      securityBlocked: true,
      approvalBlocked: true,
      reason: "adult_safety_not_released"
    });
  }
  if (!validation.valid) {
    return Object.freeze({
      categories: Object.freeze(legacy),
      addedCategories: Object.freeze([]),
      validation,
      securityBlocked: false,
      approvalBlocked: false,
      reason: "metadata_not_eligible"
    });
  }

  const categories = [...legacy];
  const normalized = new Set(legacy.map(categoryKey));
  const addedCategories = [];
  for (const categoryId of [validation.principal, ...validation.affinities].filter(Boolean)) {
    const key = categoryKey(categoryId);
    if (normalized.has(key)) continue;
    normalized.add(key);
    categories.push(categoryId);
    addedCategories.push(categoryId);
  }
  return Object.freeze({
    categories: Object.freeze(categories),
    addedCategories: Object.freeze(addedCategories),
    validation,
    securityBlocked: false,
    approvalBlocked: false,
    reason: addedCategories.length ? "projected_categories_added" : "projected_equals_legacy"
  });
}

module.exports = {
  ROUTING_MODES,
  ROUTING_BRIDGE_VERSION,
  ROUTING_ACTIVE_RELEASED,
  MAX_AFFINITIES,
  routingMode,
  buildRoutingBridge,
  bridgeFromOffer,
  validateRoutingBridge,
  projectedCategoryCandidates
};
