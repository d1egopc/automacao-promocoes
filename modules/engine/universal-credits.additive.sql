-- Post-epoch credit authority. The existing financial_credit_ledger remains
-- the only financial movement ledger; this table is only its locked balance
-- projection and target holds are transport reservations, never debits.
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS operation_epoch_started_at timestamptz;
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS universal_movement_type text;
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS universal_target_id bigint;
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS universal_balance_revision bigint;
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS universal_balance_after integer;
ALTER TABLE financial_credit_ledger
  ADD COLUMN IF NOT EXISTS universal_credit_source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS financial_universal_opening_once_idx
  ON financial_credit_ledger (operation_epoch_started_at,cliente_id)
  WHERE universal_movement_type='OPENING_BALANCE';
CREATE UNIQUE INDEX IF NOT EXISTS financial_universal_target_debit_once_idx
  ON financial_credit_ledger
    (operation_epoch_started_at,cliente_id,universal_target_id)
  WHERE universal_movement_type='TARGET_DEBIT';
CREATE INDEX IF NOT EXISTS financial_universal_workspace_movements_idx
  ON financial_credit_ledger
    (operation_epoch_started_at,cliente_id,universal_balance_revision,id)
  WHERE universal_movement_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS financial_universal_movement_revision_once_idx
  ON financial_credit_ledger
    (operation_epoch_started_at,cliente_id,universal_balance_revision)
  WHERE universal_movement_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS engine_universal_credit_balances (
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  opening_balance integer NOT NULL CHECK (opening_balance >= 0),
  balance integer NOT NULL CHECK (balance >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_epoch_started_at,workspace_id),
  CHECK (reserved <= balance)
);

-- Source-scoped projection. The financial ledger remains the authority; each
-- row below is a locked projection of one opening/grant/top-up or of a
-- deliberately unclassified legacy snapshot. No workspace enters this model
-- merely because the additive DDL exists.
CREATE TABLE IF NOT EXISTS engine_universal_credit_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  ledger_id uuid REFERENCES financial_credit_ledger(id),
  source_kind text NOT NULL CHECK (source_kind IN
    ('opening','cycle','admin_topup','legacy_escrow','legacy_unclassified')),
  state text NOT NULL CHECK (state IN
    ('active','expired','escrow','unclassified','closed')),
  cycle_start timestamptz,
  cycle_end timestamptz,
  granted integer NOT NULL CHECK (granted >= 0),
  available integer NOT NULL CHECK (available >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  expired integer NOT NULL DEFAULT 0 CHECK (expired >= 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (operation_epoch_started_at,workspace_id)
    REFERENCES engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id),
  UNIQUE (operation_epoch_started_at,workspace_id,source_key),
  CHECK (granted = available + reserved + consumed + expired),
  CHECK ((source_kind='cycle' AND cycle_start IS NOT NULL AND cycle_end IS NOT NULL)
    OR source_kind<>'cycle'),
  CHECK (cycle_end IS NULL OR cycle_start IS NULL OR cycle_end > cycle_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_universal_credit_source_ledger_once_idx
  ON engine_universal_credit_sources (ledger_id) WHERE ledger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS engine_universal_credit_sources_spendable_idx
  ON engine_universal_credit_sources
    (operation_epoch_started_at,workspace_id,state,cycle_end,created_at,id)
  WHERE state='active' AND available>0;

-- Absence of a row means legacy balance authority. SHADOW is comparison only;
-- ACTIVE can only be selected by the explicit guarded cutover function.
CREATE TABLE IF NOT EXISTS engine_universal_credit_source_workspaces (
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  mode text NOT NULL CHECK (mode IN ('SHADOW','ACTIVE','ACTIVE_SEGREGATED')),
  baseline_hash text NOT NULL CHECK (baseline_hash ~ '^[0-9a-f]{64}$'),
  baseline_balance integer NOT NULL CHECK (baseline_balance >= 0),
  baseline_reserved integer NOT NULL CHECK (baseline_reserved >= 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_epoch_started_at,workspace_id),
  FOREIGN KEY (operation_epoch_started_at,workspace_id)
    REFERENCES engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id),
  CHECK ((mode='SHADOW' AND activated_at IS NULL) OR
    (mode IN ('ACTIVE','ACTIVE_SEGREGATED') AND activated_at IS NOT NULL))
);

-- Existing R1.3 installations already have the table, so CREATE IF NOT EXISTS
-- cannot widen its checks. Replace only these two authority-state constraints.
ALTER TABLE engine_universal_credit_source_workspaces
  DROP CONSTRAINT IF EXISTS engine_universal_credit_source_workspaces_mode_check;
ALTER TABLE engine_universal_credit_source_workspaces
  DROP CONSTRAINT IF EXISTS engine_universal_credit_source_workspaces_check;
ALTER TABLE engine_universal_credit_source_workspaces
  DROP CONSTRAINT IF EXISTS engine_universal_credit_source_workspaces_mode_r15_check;
ALTER TABLE engine_universal_credit_source_workspaces
  DROP CONSTRAINT IF EXISTS engine_universal_credit_source_workspaces_activation_r15_check;
ALTER TABLE engine_universal_credit_source_workspaces
  ADD CONSTRAINT engine_universal_credit_source_workspaces_mode_r15_check
    CHECK (mode IN ('SHADOW','ACTIVE','ACTIVE_SEGREGATED'));
ALTER TABLE engine_universal_credit_source_workspaces
  ADD CONSTRAINT engine_universal_credit_source_workspaces_activation_r15_check
    CHECK ((mode='SHADOW' AND activated_at IS NULL) OR
      (mode IN ('ACTIVE','ACTIVE_SEGREGATED') AND activated_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS engine_universal_credit_holds (
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  target_id bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('held','consumed','released')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_epoch_started_at,workspace_id,target_id),
  FOREIGN KEY (operation_epoch_started_at,workspace_id)
    REFERENCES engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id),
  FOREIGN KEY (target_id) REFERENCES engine_universal_queue_destinations(id)
);
ALTER TABLE engine_universal_credit_holds
  ADD COLUMN IF NOT EXISTS source_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='engine_universal_credit_holds'::regclass
      AND conname='engine_universal_credit_holds_source_fk'
  ) THEN
    ALTER TABLE engine_universal_credit_holds
      ADD CONSTRAINT engine_universal_credit_holds_source_fk
      FOREIGN KEY (source_id) REFERENCES engine_universal_credit_sources(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS engine_universal_credit_holds_source_idx
  ON engine_universal_credit_holds
    (operation_epoch_started_at,workspace_id,source_id,state,target_id)
  WHERE source_id IS NOT NULL;

-- SHADOW never writes the live hold binding. This audit mapping is inert until
-- activateWorkspaceSources() validates the original snapshot again and binds
-- all still-held targets atomically with the authority switch.
CREATE TABLE IF NOT EXISTS engine_universal_credit_shadow_hold_sources (
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  target_id bigint NOT NULL,
  source_id uuid NOT NULL REFERENCES engine_universal_credit_sources(id),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_epoch_started_at,workspace_id,target_id),
  FOREIGN KEY (operation_epoch_started_at,workspace_id)
    REFERENCES engine_universal_credit_source_workspaces
      (operation_epoch_started_at,workspace_id),
  FOREIGN KEY (operation_epoch_started_at,workspace_id,target_id)
    REFERENCES engine_universal_credit_holds
      (operation_epoch_started_at,workspace_id,target_id)
);
CREATE INDEX IF NOT EXISTS engine_universal_credit_shadow_hold_source_idx
  ON engine_universal_credit_shadow_hold_sources
    (operation_epoch_started_at,workspace_id,source_id,target_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='financial_credit_ledger'::regclass
      AND conname='financial_credit_ledger_universal_source_fk'
  ) THEN
    ALTER TABLE financial_credit_ledger
      ADD CONSTRAINT financial_credit_ledger_universal_source_fk
      FOREIGN KEY (universal_credit_source_id)
      REFERENCES engine_universal_credit_sources(id);
  END IF;
END $$;

-- Registration bridge only: durable intent, not a second money ledger.
-- Pending rows are reconciled in bounded batches; orphaned intents are terminal.
CREATE TABLE IF NOT EXISTS engine_universal_credit_opening_intents (
  operation_epoch_started_at timestamptz NOT NULL,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  opening_balance integer NOT NULL CHECK (opening_balance >= 0),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','completed','orphaned')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (operation_epoch_started_at,workspace_id)
);
CREATE INDEX IF NOT EXISTS engine_universal_credit_opening_pending_idx
  ON engine_universal_credit_opening_intents (created_at,workspace_id)
  WHERE state='pending';
