-- Universal Radar replay schema. Apply after the ordinary Engine schema.
-- The event and its per-workspace intents must be committed together.
CREATE TABLE IF NOT EXISTS engine_radar_replay_intents_candidate (
  evento_id bigint NOT NULL REFERENCES engine_eventos_brutos(id) ON DELETE CASCADE,
  cliente_id text NOT NULL CHECK (length(btrim(cliente_id)) > 0),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'concluida', 'expirada', 'rejected_pre_epoch')),
  job_id bigint REFERENCES engine_jobs_cliente(id) ON DELETE SET NULL,
  capturado_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, cliente_id),
  CHECK (status <> 'concluida' OR job_id IS NOT NULL)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='engine_radar_replay_intents_candidate'::regclass
      AND conname='engine_radar_replay_intents_candidate_status_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%rejected_pre_epoch%') THEN
    ALTER TABLE engine_radar_replay_intents_candidate
      DROP CONSTRAINT engine_radar_replay_intents_candidate_status_check;
    ALTER TABLE engine_radar_replay_intents_candidate
      ADD CONSTRAINT engine_radar_replay_intents_candidate_status_check
      CHECK (status IN ('pendente', 'concluida', 'expirada', 'rejected_pre_epoch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS engine_radar_replay_pending_candidate
  ON engine_radar_replay_intents_candidate (criado_em, evento_id, cliente_id)
  WHERE status = 'pendente';

-- This is a database backstop for every event-deletion route, not a change
-- to the operational Auto-Clean policy. Completed/expired facts may cascade
-- only after a separately reviewed retention decision.
CREATE OR REPLACE FUNCTION engine_radar_pending_event_guard_candidate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM engine_radar_replay_intents_candidate i
     WHERE i.evento_id = OLD.id AND i.status = 'pendente'
  ) THEN
    RAISE EXCEPTION 'UF_RADAR_INTENT_PENDING_GC' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='engine_eventos_brutos'::regclass
      AND tgname='engine_radar_pending_event_guard_candidate_trigger') THEN
    CREATE TRIGGER engine_radar_pending_event_guard_candidate_trigger
    BEFORE DELETE ON engine_eventos_brutos
    FOR EACH ROW EXECUTE FUNCTION engine_radar_pending_event_guard_candidate();
  END IF;
END $$;
