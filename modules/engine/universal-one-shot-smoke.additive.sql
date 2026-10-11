-- Additive, dormant cutover validation gate. It never changes the global epoch.
CREATE TABLE IF NOT EXISTS engine_universal_one_shot_smoke (
  id uuid PRIMARY KEY,
  smoke_epoch_at timestamptz NOT NULL UNIQUE,
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  destination_id text NOT NULL CHECK (btrim(destination_id) <> ''),
  target_key text NOT NULL CHECK (btrim(target_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('whatsapp','telegram','discord')),
  queue_item_id bigint NOT NULL UNIQUE REFERENCES engine_universal_queue_items(id),
  queue_destination_id bigint NOT NULL UNIQUE
    REFERENCES engine_universal_queue_destinations(id),
  state text NOT NULL CHECK (state IN
    ('armed','claimed','consumed','completed','aborted','expired')),
  provider_call_budget integer NOT NULL DEFAULT 1
    CHECK (provider_call_budget = 1),
  provider_call_count integer NOT NULL DEFAULT 0
    CHECK (provider_call_count BETWEEN 0 AND 1),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((provider_call_count = 0 AND consumed_at IS NULL) OR
         (provider_call_count = 1 AND consumed_at IS NOT NULL)),
  CHECK (state NOT IN ('consumed','completed') OR provider_call_count = 1),
  CHECK (expires_at > created_at)
);

-- At most one armed/in-flight operational validation at a time. Consumed
-- without ACK remains in-flight and blocks every subsequent smoke.
CREATE UNIQUE INDEX IF NOT EXISTS engine_uq_one_shot_active_idx
  ON engine_universal_one_shot_smoke ((1))
  WHERE state IN ('armed','claimed','consumed');
CREATE INDEX IF NOT EXISTS engine_uq_one_shot_expiry_idx
  ON engine_universal_one_shot_smoke (expires_at,id)
  WHERE state IN ('armed','claimed');
-- Once any validation crossed the provider boundary, this cutover instrument
-- cannot be armed again, even after a successful ACK or a restart.
CREATE UNIQUE INDEX IF NOT EXISTS engine_uq_one_shot_spent_once_idx
  ON engine_universal_one_shot_smoke ((1))
  WHERE provider_call_count = 1;

-- Existing gates retain their bound identity. A new gate may wait for Radar
-- without creating a queue item, target or provider work.
ALTER TABLE engine_universal_one_shot_smoke
  ALTER COLUMN queue_item_id DROP NOT NULL,
  ALTER COLUMN queue_destination_id DROP NOT NULL;
ALTER TABLE engine_universal_one_shot_smoke
  ADD COLUMN IF NOT EXISTS binding_state text NOT NULL DEFAULT 'bound',
  ADD COLUMN IF NOT EXISTS connection_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='engine_universal_one_shot_smoke'::regclass
      AND conname='engine_uq_one_shot_binding_identity_ck') THEN
    ALTER TABLE engine_universal_one_shot_smoke
      ADD CONSTRAINT engine_uq_one_shot_binding_identity_ck CHECK (
        (binding_state='waiting' AND state IN ('armed','expired')
          AND queue_item_id IS NULL AND queue_destination_id IS NULL)
        OR
        (binding_state='bound' AND queue_item_id IS NOT NULL
          AND queue_destination_id IS NOT NULL));
  END IF;
END $$;

-- One factual Radar binding record per authoritative gate. It cannot exist
-- without its gate and cannot authorize executable work by itself.
CREATE TABLE IF NOT EXISTS engine_universal_one_shot_trigger (
  id uuid PRIMARY KEY REFERENCES engine_universal_one_shot_smoke(id),
  source_type text NOT NULL CHECK (source_type = 'radar'),
  source_session_id text NOT NULL CHECK (btrim(source_session_id) <> ''),
  source_group_jid text NOT NULL CHECK (btrim(source_group_jid) <> ''),
  bound_event_id bigint REFERENCES engine_eventos_brutos(id),
  bound_job_id bigint REFERENCES engine_jobs_cliente(id),
  bound_offer_id bigint REFERENCES engine_ofertas(id),
  capture_t0 timestamptz,
  commercial_fingerprint text,
  bound_at timestamptz,
  CHECK ((bound_at IS NULL AND bound_event_id IS NULL AND
    bound_job_id IS NULL AND bound_offer_id IS NULL AND capture_t0 IS NULL
    AND commercial_fingerprint IS NULL) OR
    (bound_at IS NOT NULL AND bound_event_id IS NOT NULL AND
     bound_job_id IS NOT NULL AND bound_offer_id IS NOT NULL AND
     capture_t0 IS NOT NULL AND commercial_fingerprint IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_uq_one_shot_trigger_bound_offer_idx
  ON engine_universal_one_shot_trigger (bound_offer_id)
  WHERE bound_offer_id IS NOT NULL;
