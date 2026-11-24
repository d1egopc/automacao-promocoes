CREATE TABLE engine_operation_state(id smallint PRIMARY KEY, mode text, operation_epoch_started_at timestamptz);
CREATE TABLE engine_universal_claim_fence(id smallint PRIMARY KEY,state text,generation bigint,
  operation_epoch_started_at timestamptz,requested_at timestamptz,requested_by text,released_at timestamptz,changed_at timestamptz);
CREATE TABLE engine_jobs_cliente(id bigint PRIMARY KEY, evento_id bigint, oferta_id bigint,
  cliente_id text, status text, marketplace text, motivo_final text, criado_em timestamptz DEFAULT now(), metadata jsonb);
CREATE TABLE engine_universal_queue_items(id bigint PRIMARY KEY, workspace_id text,
  job_id bigint, evento_id bigint, oferta_id bigint, operation_epoch_started_at timestamptz);
CREATE TABLE engine_universal_queue_destinations(id bigint PRIMARY KEY, queue_item_id bigint,
  workspace_id text, operation_epoch_started_at timestamptz, channel text, status text,
  confirmed_at timestamptz, provider_message_id text);
INSERT INTO engine_operation_state VALUES(1,'UNIVERSAL','2026-01-01T00:00:00Z');
INSERT INTO engine_universal_claim_fence(id,state,generation) VALUES(1,'OPEN',0);
INSERT INTO engine_jobs_cliente(id,evento_id,oferta_id,cliente_id,status,marketplace,motivo_final)
  VALUES(1,11,111,'alpha','oferta_criada','magalu','https://fixture.invalid/?token=fixture-only'),
    (2,22,222,'beta','oferta_criada','magalu','sem_imagem');
INSERT INTO engine_universal_queue_items VALUES
  (1,'alpha',1,11,111,'2026-01-01T00:00:00Z'),(2,'beta',2,22,222,'2026-01-01T00:00:00Z');
INSERT INTO engine_universal_queue_destinations VALUES
  (1,1,'alpha','2026-01-01T00:00:00Z','whatsapp','sent','2026-01-01T00:00:01Z','fixture-confirmed'),
  (2,1,'alpha','2026-01-01T00:00:00Z','whatsapp','ambiguous',NULL,NULL),
  (3,1,'alpha','2026-01-01T00:00:00Z','whatsapp','send_started',NULL,NULL),
  (4,2,'beta','2026-01-01T00:00:00Z','telegram','sent','2026-01-01T00:00:02Z','fixture-other');
CREATE ROLE fixture_audit LOGIN;
ALTER ROLE fixture_audit SET default_transaction_read_only=on;
GRANT SELECT(id,evento_id,oferta_id,cliente_id,status,marketplace,motivo_final,criado_em,metadata)
  ON engine_jobs_cliente TO fixture_audit;
GRANT SELECT ON engine_universal_queue_items, engine_universal_queue_destinations TO fixture_audit;
CREATE ROLE fixture_fence LOGIN;
GRANT SELECT ON engine_operation_state,engine_universal_claim_fence TO fixture_fence;
GRANT SELECT(status,operation_epoch_started_at) ON engine_universal_queue_destinations TO fixture_fence;
GRANT UPDATE(id) ON engine_operation_state TO fixture_fence;
GRANT UPDATE(state,generation,operation_epoch_started_at,requested_at,requested_by,released_at,changed_at)
  ON engine_universal_claim_fence TO fixture_fence;
