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
