-- Intelligence V1 Phase B: durable product facts.
-- This file is intentionally NOT wired to the production bootstrap.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '10s';

CREATE TABLE IF NOT EXISTS intelligence_product_memory (
  memory_id BIGSERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace')),
  workspace_id TEXT NOT NULL DEFAULT '',
  marketplace TEXT NOT NULL CHECK (btrim(marketplace) <> ''),
  product_id TEXT NOT NULL CHECK (btrim(product_id) <> ''),
  sku TEXT NOT NULL DEFAULT '',
  variant_key TEXT NOT NULL DEFAULT '',
  identity_key TEXT NOT NULL CHECK (btrim(identity_key) <> ''),
  identity_evidence_hash TEXT NOT NULL CHECK (identity_evidence_hash ~ '^[a-f0-9]{64}$'),
  factual_title TEXT,
  brand TEXT,
  model TEXT,
  capacity TEXT,
  quantity TEXT,
  category_primary TEXT NOT NULL DEFAULT 'Diversos',
  category_affinities TEXT[] NOT NULL DEFAULT '{}'::text[],
  classification_status TEXT NOT NULL
    CHECK (classification_status IN ('resolved', 'pending', 'uncertain', 'rejected')),
  safety_class TEXT NOT NULL
    CHECK (safety_class IN ('general', 'adult', 'child', 'uncertain')),
  source TEXT NOT NULL CHECK (btrim(source) <> ''),
  source_rank SMALLINT NOT NULL CHECK (source_rank BETWEEN 0 AND 100),
  confidence TEXT NOT NULL CHECK (btrim(confidence) <> ''),
  schema_version TEXT NOT NULL CHECK (btrim(schema_version) <> ''),
  classifier_version TEXT NOT NULL CHECK (btrim(classifier_version) <> ''),
  record_revision BIGINT NOT NULL DEFAULT 1 CHECK (record_revision > 0),
  confirmed_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  negative_until TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (scope_type = 'global' AND workspace_id = '') OR
    (scope_type = 'workspace' AND btrim(workspace_id) <> '')
  ),
  CHECK (category_primary <> 'Sex Shop +18'),
  CHECK (NOT ('Sex Shop +18' = ANY(category_affinities))),
  CHECK (invalidated_at IS NULL OR btrim(COALESCE(invalidation_reason, '')) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS intelligence_product_memory_identity_uq
  ON intelligence_product_memory
  (scope_type, workspace_id, marketplace, product_id, sku, variant_key);

CREATE INDEX IF NOT EXISTS intelligence_product_memory_identity_key_idx
  ON intelligence_product_memory
  (scope_type, workspace_id, marketplace, identity_key);

CREATE INDEX IF NOT EXISTS intelligence_product_memory_last_seen_idx
  ON intelligence_product_memory (last_seen_at, memory_id);

CREATE INDEX IF NOT EXISTS intelligence_product_memory_invalidated_idx
  ON intelligence_product_memory (invalidated_at, memory_id)
  WHERE invalidated_at IS NOT NULL;

COMMENT ON TABLE intelligence_product_memory IS
  'Durable Intelligence V1 product facts; independent from operational offers and Auto-Clean.';

COMMIT;
