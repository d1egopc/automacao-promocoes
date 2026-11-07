"use strict";

const GLOBAL_OFFICIAL_SOURCES = new Set([
  "api_oficial",
  "feed_oficial",
  "pagina_oficial",
  "marketplace_oficial"
]);

const SOURCE_RANK = Object.freeze({
  api_oficial: 100,
  feed_oficial: 100,
  marketplace_oficial: 100,
  pagina_oficial: 90,
  local_worker_verified: 70,
  extension_verified: 60,
  produto_confirmado: 50,
  titulo_factual_existente: 40,
  captura_origem: 20,
  nao_informada: 0
});

const WORKSPACE_RE = /^[a-zA-Z0-9:_-]{1,120}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

function text(value = "", max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeMarketplace(value = "") {
  return text(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function normalizeIdentityPart(value = "", max = 180) {
  return text(value, max).replace(/[^a-zA-Z0-9._:/-]/g, "");
}

function normalizeCategories(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => text(value, 100))
    .filter(value => value && value !== "Sex Shop +18"))]
    .slice(0, 12);
}

function sourceRank(source = "") {
  return SOURCE_RANK[text(source, 80).toLowerCase()] ?? 0;
}

function normalizeScope({ scopeType = "", workspaceId = "", source = "" } = {}) {
  const requested = text(scopeType, 20).toLowerCase();
  const workspace = text(workspaceId, 120);
  const normalizedSource = text(source, 80).toLowerCase() || "nao_informada";
  if (requested === "global") {
    if (!GLOBAL_OFFICIAL_SOURCES.has(normalizedSource)) {
      return { ok: false, reason: "global_source_not_official" };
    }
    return { ok: true, scopeType: "global", workspaceId: "", source: normalizedSource };
  }
  if (requested === "workspace" && WORKSPACE_RE.test(workspace)) {
    return { ok: true, scopeType: "workspace", workspaceId: workspace, source: normalizedSource };
  }
  return { ok: false, reason: "memory_scope_invalid" };
}

function normalizeMemoryRecord(input = {}) {
  const scope = normalizeScope(input);
  if (!scope.ok) return scope;
  const marketplace = normalizeMarketplace(input.marketplace);
  const productId = normalizeIdentityPart(input.productId);
  const sku = normalizeIdentityPart(input.sku);
  const variantKey = normalizeIdentityPart(input.variantKey);
  const identityKey = text(input.identityKey, 600);
  const evidenceHash = text(input.identityEvidenceHash, 64).toLowerCase();
  if (!marketplace || !productId || !identityKey || !HASH_RE.test(evidenceHash)) {
    return { ok: false, reason: "memory_identity_unconfirmed" };
  }
  const classificationStatus = text(input.classificationStatus, 20).toLowerCase();
  const safetyClass = text(input.safetyClass, 20).toLowerCase();
  if (!["resolved", "pending", "uncertain", "rejected"].includes(classificationStatus) ||
      !["general", "adult", "child", "uncertain"].includes(safetyClass)) {
    return { ok: false, reason: "memory_classification_invalid" };
  }
  const categoryPrimary = text(input.categoryPrimary, 100) || "Diversos";
  if (categoryPrimary === "Sex Shop +18") {
    return { ok: false, reason: "adult_category_reserved" };
  }
  return {
    ok: true,
    record: {
      scopeType: scope.scopeType,
      workspaceId: scope.workspaceId,
      marketplace,
      productId,
      sku,
      variantKey,
      identityKey,
      identityEvidenceHash: evidenceHash,
      factualTitle: text(input.factualTitle, 300) || null,
      brand: text(input.brand, 120) || null,
      model: text(input.model, 120) || null,
      capacity: text(input.capacity, 80) || null,
      quantity: text(input.quantity, 80) || null,
      categoryPrimary,
      categoryAffinities: normalizeCategories(input.categoryAffinities),
      classificationStatus,
      safetyClass,
      source: scope.source,
      sourceRank: sourceRank(scope.source),
      confidence: text(input.confidence, 40) || "unconfirmed",
      schemaVersion: text(input.schemaVersion, 100),
      classifierVersion: text(input.classifierVersion, 100),
      confirmedAt: input.confirmedAt || new Date().toISOString(),
      negativeUntil: input.negativeUntil || null
    }
  };
}

function unwrapQueryResult(result) {
  if (result && result.ok === false) {
    return { ok: false, reason: result.motivo || result.reason || "memory_query_failed", rows: [] };
  }
  const pgResult = result?.resultado || result;
  return { ok: true, rows: Array.isArray(pgResult?.rows) ? pgResult.rows : [], rowCount: Number(pgResult?.rowCount || 0) };
}

async function execute(query, sql, params = []) {
  if (typeof query !== "function") return { ok: false, reason: "memory_query_unavailable", rows: [] };
  try {
    return unwrapQueryResult(await query(sql, params));
  } catch (error) {
    return {
      ok: false,
      reason: ["42P01", "57014"].includes(String(error?.code || ""))
        ? (String(error.code) === "42P01" ? "memory_table_unavailable" : "memory_query_timeout")
        : "memory_query_failed",
      rows: []
    };
  }
}

async function tableAvailable({ query } = {}) {
  const result = await execute(query,
    "SELECT to_regclass('intelligence_product_memory') IS NOT NULL AS available");
  if (!result.ok) return result;
  return { ok: true, available: result.rows[0]?.available === true };
}

async function readProductMemory({ query, scopeType, workspaceId = "", marketplace,
  productId, sku = "", variantKey = "" } = {}) {
  const normalizedScope = scopeType === "global"
    ? { ok: true, scopeType: "global", workspaceId: "" }
    : (WORKSPACE_RE.test(text(workspaceId, 120))
      ? { ok: true, scopeType: "workspace", workspaceId: text(workspaceId, 120) }
      : { ok: false });
  const market = normalizeMarketplace(marketplace);
  const product = normalizeIdentityPart(productId);
  if (!normalizedScope.ok || !market || !product) {
    return { ok: false, reason: "memory_read_identity_invalid", record: null };
  }
  const result = await execute(query, `SELECT memory_id,scope_type,workspace_id,marketplace,
      product_id,sku,variant_key,identity_key,identity_evidence_hash,factual_title,
      brand,model,capacity,quantity,category_primary,category_affinities,
      classification_status,safety_class,source,source_rank,confidence,
      schema_version,classifier_version,record_revision,confirmed_at,last_seen_at,
      negative_until,invalidated_at,invalidation_reason,created_at,updated_at
    FROM intelligence_product_memory
    WHERE scope_type=$1 AND workspace_id=$2 AND marketplace=$3 AND product_id=$4
      AND sku=$5 AND variant_key=$6
    LIMIT 1`, [normalizedScope.scopeType, normalizedScope.workspaceId, market, product,
    normalizeIdentityPart(sku), normalizeIdentityPart(variantKey)]);
  if (!result.ok) return { ...result, record: null };
  return { ok: true, record: result.rows[0] || null };
}

async function upsertProductMemory({ query, record: input } = {}) {
  const normalized = normalizeMemoryRecord(input);
  if (!normalized.ok) return normalized;
  const r = normalized.record;
  const result = await execute(query, `INSERT INTO intelligence_product_memory
    (scope_type,workspace_id,marketplace,product_id,sku,variant_key,identity_key,
     identity_evidence_hash,factual_title,brand,model,capacity,quantity,
     category_primary,category_affinities,classification_status,safety_class,
     source,source_rank,confidence,schema_version,classifier_version,confirmed_at,
     last_seen_at,negative_until)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17,
      $18,$19,$20,$21,$22,$23,clock_timestamp(),$24)
    ON CONFLICT (scope_type,workspace_id,marketplace,product_id,sku,variant_key)
    DO UPDATE SET
      last_seen_at=clock_timestamp(),
      negative_until=CASE
        WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
          THEN EXCLUDED.negative_until
        ELSE intelligence_product_memory.negative_until END,
      invalidated_at=CASE
        WHEN intelligence_product_memory.identity_evidence_hash<>EXCLUDED.identity_evidence_hash
          THEN clock_timestamp()
        WHEN EXCLUDED.source_rank>=intelligence_product_memory.source_rank
          THEN NULL
        ELSE intelligence_product_memory.invalidated_at END,
      invalidation_reason=CASE
        WHEN intelligence_product_memory.identity_evidence_hash<>EXCLUDED.identity_evidence_hash
          THEN 'identity_evidence_conflict'
        WHEN EXCLUDED.source_rank>=intelligence_product_memory.source_rank
          THEN NULL
        ELSE intelligence_product_memory.invalidation_reason END,
      factual_title=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.factual_title ELSE intelligence_product_memory.factual_title END,
      brand=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.brand ELSE intelligence_product_memory.brand END,
      model=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.model ELSE intelligence_product_memory.model END,
      capacity=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.capacity ELSE intelligence_product_memory.capacity END,
      quantity=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.quantity ELSE intelligence_product_memory.quantity END,
      category_primary=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.category_primary ELSE intelligence_product_memory.category_primary END,
      category_affinities=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.category_affinities ELSE intelligence_product_memory.category_affinities END,
      classification_status=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.classification_status ELSE intelligence_product_memory.classification_status END,
      safety_class=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.safety_class ELSE intelligence_product_memory.safety_class END,
      source=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.source ELSE intelligence_product_memory.source END,
      source_rank=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        THEN GREATEST(intelligence_product_memory.source_rank,EXCLUDED.source_rank)
        ELSE intelligence_product_memory.source_rank END,
      confidence=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.confidence ELSE intelligence_product_memory.confidence END,
      schema_version=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.schema_version ELSE intelligence_product_memory.schema_version END,
      classifier_version=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.classifier_version ELSE intelligence_product_memory.classifier_version END,
      confirmed_at=CASE WHEN intelligence_product_memory.identity_evidence_hash=EXCLUDED.identity_evidence_hash
        AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank
        THEN EXCLUDED.confirmed_at ELSE intelligence_product_memory.confirmed_at END,
      record_revision=intelligence_product_memory.record_revision + CASE
        WHEN intelligence_product_memory.identity_evidence_hash<>EXCLUDED.identity_evidence_hash THEN 1
        WHEN intelligence_product_memory.invalidated_at IS NOT NULL
          AND EXCLUDED.source_rank>=intelligence_product_memory.source_rank THEN 1
        WHEN EXCLUDED.source_rank>=intelligence_product_memory.source_rank AND
          (intelligence_product_memory.factual_title, intelligence_product_memory.category_primary,
           intelligence_product_memory.category_affinities, intelligence_product_memory.classification_status,
           intelligence_product_memory.safety_class, intelligence_product_memory.source_rank)
          IS DISTINCT FROM
          (EXCLUDED.factual_title, EXCLUDED.category_primary, EXCLUDED.category_affinities,
           EXCLUDED.classification_status, EXCLUDED.safety_class, EXCLUDED.source_rank)
          THEN 1 ELSE 0 END,
      updated_at=clock_timestamp()
    RETURNING memory_id,scope_type,workspace_id,marketplace,product_id,sku,variant_key,
      identity_key,identity_evidence_hash,factual_title,category_primary,category_affinities,
      classification_status,safety_class,source,source_rank,record_revision,
      invalidated_at,invalidation_reason,last_seen_at`, [
    r.scopeType, r.workspaceId, r.marketplace, r.productId, r.sku, r.variantKey,
    r.identityKey, r.identityEvidenceHash, r.factualTitle, r.brand, r.model,
    r.capacity, r.quantity, r.categoryPrimary, r.categoryAffinities,
    r.classificationStatus, r.safetyClass, r.source, r.sourceRank, r.confidence,
    r.schemaVersion, r.classifierVersion, r.confirmedAt, r.negativeUntil
  ]);
  if (!result.ok) return result;
  const row = result.rows[0] || null;
  return {
    ok: Boolean(row),
    record: row,
    conflict: row?.invalidation_reason === "identity_evidence_conflict"
  };
}

async function invalidateProductMemory({ query, scopeType, workspaceId = "", marketplace,
  productId, sku = "", variantKey = "", reason = "identity_invalidated" } = {}) {
  const safeReason = text(reason, 120) || "identity_invalidated";
  const result = await execute(query, `UPDATE intelligence_product_memory
    SET invalidated_at=COALESCE(invalidated_at,clock_timestamp()),
        invalidation_reason=$7,
        record_revision=record_revision+CASE WHEN invalidated_at IS NULL THEN 1 ELSE 0 END,
        updated_at=clock_timestamp()
    WHERE scope_type=$1 AND workspace_id=$2 AND marketplace=$3 AND product_id=$4
      AND sku=$5 AND variant_key=$6
    RETURNING memory_id,record_revision,invalidated_at,invalidation_reason`, [
    scopeType === "global" ? "global" : "workspace",
    scopeType === "global" ? "" : text(workspaceId, 120),
    normalizeMarketplace(marketplace), normalizeIdentityPart(productId),
    normalizeIdentityPart(sku), normalizeIdentityPart(variantKey), safeReason
  ]);
  if (!result.ok) return result;
  return { ok: true, record: result.rows[0] || null };
}

module.exports = {
  GLOBAL_OFFICIAL_SOURCES,
  SOURCE_RANK,
  sourceRank,
  normalizeScope,
  normalizeMemoryRecord,
  tableAvailable,
  readProductMemory,
  upsertProductMemory,
  invalidateProductMemory
};
