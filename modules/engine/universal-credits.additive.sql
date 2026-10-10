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
