-- Future cutover migration only. Do not execute against production in this stage.
-- No epoch is inferred from deployment time or from a job's creation time.
CREATE TABLE IF NOT EXISTS engine_operation_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL CHECK (mode IN
    ('LEGACY','CUTOVER_PREPARED','UNIVERSAL','ROLLBACK_FROZEN')),
  operation_epoch_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (mode <> 'UNIVERSAL' OR operation_epoch_started_at IS NOT NULL),
  CHECK (mode <> 'LEGACY' OR operation_epoch_started_at IS NULL)
);

CREATE OR REPLACE FUNCTION engine_operation_state_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'UF_OPERATION_STATE_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.operation_epoch_started_at IS NOT NULL AND
       NEW.operation_epoch_started_at IS DISTINCT FROM OLD.operation_epoch_started_at THEN
      RAISE EXCEPTION 'UF_OPERATION_EPOCH_IMMUTABLE';
    END IF;
    IF OLD.mode = 'UNIVERSAL' AND NEW.mode NOT IN ('UNIVERSAL','ROLLBACK_FROZEN') THEN
      RAISE EXCEPTION 'UF_OPERATION_MODE_ROLLBACK_REQUIRES_FREEZE';
    END IF;
    IF OLD.mode = 'ROLLBACK_FROZEN' AND NEW.mode <> 'ROLLBACK_FROZEN' THEN
      RAISE EXCEPTION 'UF_OPERATION_MODE_FROZEN';
    END IF;
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
END $$;
