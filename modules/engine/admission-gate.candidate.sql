-- CANDIDATE ONLY. Do not run in production. The singleton limit and lifecycle
-- heartbeat must be chosen, seeded and reconciled before enabling this trigger.
-- Fail before any DDL on a populated legacy table. Backfill, duplicate
-- reconciliation and cutover require a separate reviewed migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM engine_jobs_cliente LIMIT 1) THEN
    RAISE EXCEPTION 'UF_LEGACY_RECONCILIATION_REQUIRED';
  END IF;
END $$;

-- WHY_REQUIRED: one row lock serializes admissions from every SQL writer.
-- Existing engine_jobs_cliente has no atomic global headroom reservation.
CREATE TABLE engine_hot_admission_control (
  id integer PRIMARY KEY CHECK (id = 1),
  hot_limit integer NOT NULL CHECK (hot_limit > 0),
  hot_used integer NOT NULL CHECK (hot_used >= 0),
  health text NOT NULL CHECK (health IN ('HEALTHY','PRESSURED','CRITICAL','UNKNOWN')),
  lifecycle_last_success timestamptz,
  lifecycle_max_staleness interval NOT NULL CHECK (lifecycle_max_staleness > interval '0 seconds'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- WHY_REQUIRED: an event can disappear before a cascading job DELETE trigger
-- runs. Persisting membership on the job avoids reclassifying a vanished event.
-- Existing rows require an explicit reconciled backfill before this can ship.
ALTER TABLE engine_jobs_cliente
  ADD COLUMN engine_hot_accounted boolean NOT NULL DEFAULT false;

-- The current NOT EXISTS fanout is not a uniqueness guarantee: concurrent
-- workers can create multiple jobs for one event/workspace. This index is
-- safe only after legacy duplicates have been reconciled before cutover.
CREATE UNIQUE INDEX engine_jobs_event_workspace_unique_candidate
  ON engine_jobs_cliente (evento_id, cliente_id);

CREATE FUNCTION engine_hot_status_candidate(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status = ANY(ARRAY[
    'pendente','diagnosticado','validando','pronto','pronto_para_importar',
    'processando','importando','distribuindo','executando','retry',
    'agendado','claimed','bloqueado','pronto_sem_utilidade'
  ]::text[])
$$;

CREATE FUNCTION engine_manual_v2_candidate(p_evento_id bigint, p_metadata jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(p_metadata->>'manualV2','') = 'true'
    OR COALESCE(p_metadata->>'manual_v2','') = 'true'
    OR COALESCE(p_metadata->>'manual','') = 'true'
    OR POSITION('manual' IN LOWER(COALESCE(p_metadata->>'origem',''))) > 0
    OR POSITION('manual' IN LOWER(COALESCE(p_metadata->>'fonte',''))) > 0
    OR COALESCE((p_metadata->'metadataEvento')->>'manualV2','') = 'true'
    OR COALESCE((p_metadata->'metadataEvento')->>'manual_v2','') = 'true'
    OR COALESCE((p_metadata->'metadataEvento')->>'manual','') = 'true'
    OR POSITION('manual' IN LOWER(COALESCE((p_metadata->'metadataEvento')->>'origem',''))) > 0
    OR POSITION('manual' IN LOWER(COALESCE((p_metadata->'metadataEvento')->>'fonte',''))) > 0
    OR EXISTS (
      SELECT 1 FROM engine_eventos_brutos e WHERE e.id = p_evento_id AND (
        POSITION('manual' IN LOWER(COALESCE(e.origem,''))) > 0
        OR POSITION('manual' IN LOWER(COALESCE(e.origem_tipo,''))) > 0
        OR COALESCE(e.metadata->>'manualV2','') = 'true'
        OR COALESCE(e.metadata->>'manual_v2','') = 'true'
        OR COALESCE(e.metadata->>'manual','') = 'true'
        OR POSITION('manual' IN LOWER(COALESCE(e.metadata->>'origem',''))) > 0
        OR POSITION('manual' IN LOWER(COALESCE(e.metadata->>'fonte',''))) > 0
      )
    )
$$;

CREATE FUNCTION engine_hot_membership_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.evento_id IS NOT DISTINCT FROM OLD.evento_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata THEN
    NEW.engine_hot_accounted := OLD.engine_hot_accounted;
    RETURN NEW;
  END IF;
  NEW.engine_hot_accounted := engine_hot_status_candidate(NEW.status)
    AND NOT engine_manual_v2_candidate(NEW.evento_id, NEW.metadata);
  RETURN NEW;
END $$;

-- Count only rows that were actually inserted/updated/deleted. A BEFORE
-- trigger that increments the counter drifts on INSERT ... ON CONFLICT DO
-- NOTHING, because its side effects survive even when the row is skipped.
CREATE FUNCTION engine_hot_admission_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_hot boolean := false;
  new_hot boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_hot := OLD.engine_hot_accounted; END IF;
  IF TG_OP <> 'DELETE' THEN new_hot := NEW.engine_hot_accounted; END IF;

  IF new_hot AND NOT old_hot THEN
    UPDATE engine_hot_admission_control
       SET hot_used = hot_used + 1, updated_at = clock_timestamp()
     WHERE id = 1
       AND health IN ('HEALTHY','PRESSURED')
       AND lifecycle_last_success >= clock_timestamp() - lifecycle_max_staleness
       AND hot_used < hot_limit;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'UF_HOT_ADMISSION_DENIED' USING ERRCODE = 'P0001';
    END IF;
  ELSIF old_hot AND NOT new_hot THEN
    UPDATE engine_hot_admission_control
       SET hot_used = hot_used - 1, updated_at = clock_timestamp()
     WHERE id = 1 AND hot_used > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'UF_HOT_ACCOUNTING_DRIFT' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER engine_hot_membership_candidate_trigger
BEFORE INSERT OR UPDATE ON engine_jobs_cliente
FOR EACH ROW EXECUTE FUNCTION engine_hot_membership_candidate();

CREATE TRIGGER engine_hot_admission_candidate_trigger
AFTER INSERT OR UPDATE OR DELETE ON engine_jobs_cliente
FOR EACH ROW EXECUTE FUNCTION engine_hot_admission_candidate();
