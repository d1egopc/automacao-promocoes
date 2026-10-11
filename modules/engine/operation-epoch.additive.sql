-- Additive operational mode and immutable epoch history. Deployment of this
-- schema never selects a cutover time or enables the Universal executor.
CREATE TABLE IF NOT EXISTS engine_operation_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL CHECK (mode IN
    ('LEGACY','CUTOVER_PREPARED','UNIVERSAL','ROLLBACK_FROZEN')),
  operation_epoch_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (mode <> 'UNIVERSAL' OR operation_epoch_started_at IS NOT NULL),
  CHECK (mode <> 'LEGACY' OR operation_epoch_started_at IS NULL)
);

CREATE TABLE IF NOT EXISTS engine_operation_epoch_history (
  started_at timestamptz PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('active','rolled_back')),
  closed_at timestamptz,
  rollback_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state='active' AND closed_at IS NULL AND rollback_key IS NULL) OR
    (state='rolled_back' AND closed_at IS NOT NULL AND
      rollback_key IS NOT NULL AND btrim(rollback_key)<>''))
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_operation_one_active_epoch_idx
  ON engine_operation_epoch_history ((state)) WHERE state='active';

-- A receipt records an absolute, read-back-verified Legacy credit projection.
-- It is not a second financial ledger and cannot authorize a send.
CREATE TABLE IF NOT EXISTS engine_operation_rollback_projections (
  epoch_started_at timestamptz NOT NULL REFERENCES engine_operation_epoch_history(started_at),
  workspace_id text NOT NULL CHECK (btrim(workspace_id)<>''),
  expected_balance integer NOT NULL CHECK (expected_balance>=0),
  legacy_readback_balance integer NOT NULL CHECK (legacy_readback_balance>=0),
  balance_revision bigint NOT NULL CHECK (balance_revision>=0),
  ledger_count integer NOT NULL CHECK (ledger_count>0),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key)<>''),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (epoch_started_at,workspace_id),
  CHECK (expected_balance=legacy_readback_balance)
);

CREATE OR REPLACE FUNCTION engine_operation_rollback_receipt_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'UF_ROLLBACK_RECEIPT_IMMUTABLE';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='engine_operation_rollback_projections'::regclass AND
      tgname='engine_operation_rollback_receipt_guard_trigger') THEN
    CREATE TRIGGER engine_operation_rollback_receipt_guard_trigger
      BEFORE UPDATE OR DELETE ON engine_operation_rollback_projections
      FOR EACH ROW EXECUTE FUNCTION engine_operation_rollback_receipt_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engine_operation_epoch_history_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'UF_EPOCH_HISTORY_DELETE_FORBIDDEN';
  END IF;
  IF OLD.started_at IS DISTINCT FROM NEW.started_at OR
      OLD.state='rolled_back' OR
      (OLD.state='active' AND NEW.state<>'rolled_back') OR
      (SELECT mode<>'ROLLBACK_FROZEN' OR
              operation_epoch_started_at IS DISTINCT FROM OLD.started_at
         FROM engine_operation_state WHERE id=1) THEN
    RAISE EXCEPTION 'UF_EPOCH_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='engine_operation_epoch_history'::regclass AND
      tgname='engine_operation_epoch_history_guard_trigger') THEN
    CREATE TRIGGER engine_operation_epoch_history_guard_trigger
      BEFORE UPDATE OR DELETE ON engine_operation_epoch_history
      FOR EACH ROW EXECUTE FUNCTION engine_operation_epoch_history_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION engine_operation_state_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'UF_OPERATION_STATE_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP = 'INSERT' AND
      (NEW.mode<>'LEGACY' OR NEW.operation_epoch_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'UF_OPERATION_STATE_INITIAL_LEGACY_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.mode=NEW.mode AND
       OLD.operation_epoch_started_at IS NOT DISTINCT FROM NEW.operation_epoch_started_at THEN
      RETURN NEW;
    ELSIF OLD.mode='LEGACY' AND NEW.mode='CUTOVER_PREPARED' AND
        OLD.operation_epoch_started_at IS NULL AND NEW.operation_epoch_started_at IS NULL THEN
      RETURN NEW;
    ELSIF OLD.mode='CUTOVER_PREPARED' AND NEW.mode='LEGACY' AND
        OLD.operation_epoch_started_at IS NULL AND NEW.operation_epoch_started_at IS NULL THEN
      RETURN NEW;
    ELSIF OLD.mode='CUTOVER_PREPARED' AND NEW.mode='UNIVERSAL' AND
        OLD.operation_epoch_started_at IS NULL AND NEW.operation_epoch_started_at IS NOT NULL THEN
      IF NEW.operation_epoch_started_at <= COALESCE(
          (SELECT max(started_at) FROM engine_operation_epoch_history),'-infinity'::timestamptz) THEN
        RAISE EXCEPTION 'UF_OPERATION_EPOCH_NOT_NEW';
      END IF;
      INSERT INTO engine_operation_epoch_history(started_at,state)
        VALUES (NEW.operation_epoch_started_at,'active');
      RETURN NEW;
    ELSIF OLD.mode='UNIVERSAL' AND NEW.mode='ROLLBACK_FROZEN' AND
        NEW.operation_epoch_started_at=OLD.operation_epoch_started_at THEN
      -- Emergency freeze is always available. Unresolved provider/credit
      -- states block only the later return to Legacy, never the freeze.
      RETURN NEW;
    ELSIF OLD.mode='ROLLBACK_FROZEN' AND NEW.mode='LEGACY' AND
        OLD.operation_epoch_started_at IS NOT NULL AND NEW.operation_epoch_started_at IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM engine_operation_epoch_history
          WHERE started_at=OLD.operation_epoch_started_at AND state='active') OR
         EXISTS (SELECT 1 FROM engine_universal_queue_destinations
          WHERE operation_epoch_started_at=OLD.operation_epoch_started_at
            AND status IN ('claimed','send_started','ambiguous') LIMIT 1) OR
         EXISTS (SELECT 1 FROM engine_universal_credit_holds
          WHERE operation_epoch_started_at=OLD.operation_epoch_started_at
            AND state='held' LIMIT 1) OR
         EXISTS (SELECT 1 FROM financial_credit_ledger
          WHERE created_at>=OLD.operation_epoch_started_at
            AND projection_status='pending' LIMIT 1) OR
         EXISTS (SELECT 1 FROM engine_universal_credit_balances b
          LEFT JOIN engine_operation_rollback_projections p
            ON p.epoch_started_at=b.operation_epoch_started_at AND
              p.workspace_id=b.workspace_id
          WHERE b.operation_epoch_started_at=OLD.operation_epoch_started_at
            AND (p.workspace_id IS NULL OR p.expected_balance<>b.balance OR
              p.legacy_readback_balance<>b.balance OR
              p.balance_revision<>b.revision OR p.ledger_count<>(
                SELECT count(*) FROM financial_credit_ledger l
                WHERE l.operation_epoch_started_at=b.operation_epoch_started_at
                  AND l.cliente_id=b.workspace_id AND
                  l.universal_movement_type IS NOT NULL))) THEN
        RAISE EXCEPTION 'UF_ROLLBACK_FINANCIAL_PROOF_MISSING';
      END IF;
      UPDATE engine_operation_epoch_history
        SET state='rolled_back',closed_at=clock_timestamp(),
          rollback_key='rollback:' || OLD.operation_epoch_started_at::text
        WHERE started_at=OLD.operation_epoch_started_at AND state='active';
      IF NOT FOUND THEN RAISE EXCEPTION 'UF_ROLLBACK_EPOCH_CLOSE_FAILED'; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'UF_OPERATION_TRANSITION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'engine_operation_state'::regclass
      AND tgname = 'engine_operation_state_guard_trigger') THEN
    CREATE TRIGGER engine_operation_state_guard_trigger
      BEFORE UPDATE OR DELETE ON engine_operation_state
      FOR EACH ROW EXECUTE FUNCTION engine_operation_state_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'engine_operation_state'::regclass
      AND tgname = 'engine_operation_state_insert_guard_trigger') THEN
    CREATE TRIGGER engine_operation_state_insert_guard_trigger
      BEFORE INSERT ON engine_operation_state
      FOR EACH ROW EXECUTE FUNCTION engine_operation_state_guard();
  END IF;
END $$;
