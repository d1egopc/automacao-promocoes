"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Pool } = require("pg");
const { auditWorkspace } = require("../audit.cjs");
const fence = require("../../../modules/engine/universal-claim-fence.service");

const owner = "maintenance:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const epoch = "2026-11-24T13:54:00.000Z";
const database = "optimus_universal_fixture";
const config = { host: "127.0.0.1", port: 5432, database, connectionTimeoutMillis: 2000 };

test("PG17 lab: workspace joins, field sanitization, DB read-only grants and atomic fence ownership", async () => {
  assert.equal(process.env.OPTIMUS_MAINTENANCE_LAB, "1");
  const admin = new Pool({ ...config, user: "postgres" });
  const reader = new Pool({ ...config, user: "maintenance_fixture_read" });
  try {
    const { rows: [identity] } = await admin.query(`SELECT current_database() db,
      current_setting('server_version_num')::int version, current_setting('data_directory') data_dir,
      host(inet_server_addr()) host`);
    assert.equal(identity.db, database);
    assert.equal(identity.data_dir, "/var/lib/postgresql/data");
    assert.equal(identity.host, "127.0.0.1");
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    assert.equal((await admin.query("SELECT to_regclass('public.engine_jobs_cliente') AS table_name")).rows[0].table_name, null);
    await admin.query(`
      CREATE TABLE public.engine_jobs_cliente(id bigint PRIMARY KEY, evento_id bigint, oferta_id bigint,
        cliente_id text, status text, marketplace text, motivo_final text, criado_em timestamptz DEFAULT now(), metadata jsonb);
      CREATE TABLE public.engine_processamentos(id bigint PRIMARY KEY, job_id bigint, etapa text, status text,
        motivo text, criado_em timestamptz DEFAULT now());
      CREATE TABLE public.engine_links(id bigint PRIMARY KEY, evento_id bigint, url_original text,
        url_normalizada text, url_expandida text);
      CREATE TABLE public.local_worker_tasks(id bigint PRIMARY KEY, product_id text, source_url text,
        status text, capability text, completed_at timestamptz);
      CREATE TABLE public.engine_universal_queue_items(id bigint PRIMARY KEY, workspace_id text,
        job_id bigint, evento_id bigint, oferta_id bigint, operation_epoch_started_at timestamptz);
      CREATE TABLE public.engine_universal_queue_destinations(id bigint PRIMARY KEY, queue_item_id bigint,
        workspace_id text, operation_epoch_started_at timestamptz, channel text, status text,
        confirmed_at timestamptz, provider_message_id text);
      CREATE TABLE public.engine_operation_state(id smallint PRIMARY KEY, mode text, operation_epoch_started_at timestamptz);
      CREATE TABLE public.engine_universal_claim_fence(id smallint PRIMARY KEY,state text,generation bigint,
        operation_epoch_started_at timestamptz,requested_at timestamptz,requested_by text,released_at timestamptz,changed_at timestamptz);
      INSERT INTO public.engine_jobs_cliente(id,evento_id,oferta_id,cliente_id,status,marketplace,metadata) VALUES
        (1,10,100,'alpha','oferta_criada','magalu','{"localWorkerImageRetry":{"identidadeTask":{"jobId":"1","eventoId":"10","workspaceId":"alpha","linkId":"9","taskId":"3","identityKey":"fixture"}}}'),
        (2,20,200,'beta','oferta_criada','magalu','{}');
      INSERT INTO public.engine_links VALUES
        (9,10,'https://example.invalid/fixture',NULL,NULL);
      INSERT INTO public.local_worker_tasks VALUES
        (3,'fixture','https://example.invalid/fixture','completed','magalu_identity_v1',now());
      INSERT INTO public.engine_processamentos(id,job_id,etapa,status,motivo) VALUES
        (1,1,'importador','erro','https://example.invalid/?token=fixture-only'),
        (2,2,'importador','erro','sem_imagem');
      CREATE ROLE maintenance_fixture_read LOGIN;
      ALTER ROLE maintenance_fixture_read SET default_transaction_read_only=on;
      GRANT SELECT ON public.engine_jobs_cliente, public.engine_processamentos, public.engine_links,
        public.local_worker_tasks, public.engine_universal_queue_items, public.engine_universal_queue_destinations
        TO maintenance_fixture_read;
    `);
    await admin.query(`INSERT INTO public.engine_universal_queue_items VALUES
      (1,'alpha',1,10,100,$1),(2,'beta',2,20,200,$1)`, [epoch]);
    await admin.query(`INSERT INTO public.engine_universal_queue_destinations VALUES
      (1,1,'alpha',$1,'whatsapp','sent',now(),'provider-alpha'),
      (2,1,'beta',$1,'whatsapp','sent',now(),'provider-cross-workspace'),
      (3,1,'alpha',$1,'whatsapp','ambiguous',NULL,NULL),
      (4,2,'beta',$1,'whatsapp','sent',now(),'provider-beta')`, [epoch]);
    await admin.query("INSERT INTO public.engine_operation_state VALUES (1,'UNIVERSAL',$1)", [epoch]);
    await admin.query("INSERT INTO public.engine_universal_claim_fence(id,state,generation) VALUES (1,'OPEN',0)");
    const params = { pool: reader, scopes: ["alpha"], workspace: "alpha", salt: "fixture", minutes: 60, limit: 10 };
    assert.deepEqual((await auditWorkspace({ ...params, action: "jobs" })).rows.map(row => row.id), ["1"]);
    assert.deepEqual((await auditWorkspace({ ...params, action: "funil" })).rows, [{ jobs: 1, offers: 1, queued: 1 }]);
    assert.equal((await auditWorkspace({ ...params, action: "logs" })).rows[0].motivo, "other");
    assert.equal((await auditWorkspace({ ...params, action: "work" })).rows[0].task_id, "3");
    assert.equal((await auditWorkspace({ ...params, action: "acks" })).rows[0].factual, 1);
    await assert.rejects(auditWorkspace({ ...params, workspace: "beta", action: "jobs" }), /workspace_denied/);
    await assert.rejects(reader.query("UPDATE public.engine_jobs_cliente SET status='bad'"), error =>
      ["25006", "42501"].includes(error.code));
    const expected = { state: "OPEN", generation: 0, epoch };
    const [first, second] = await Promise.allSettled([
      fence.requestDrain({ pool: admin, requestedBy: owner, expected }),
      fence.requestDrain({ pool: admin, requestedBy: owner, expected })
    ]);
    assert.equal([first, second].filter(result => result.status === "fulfilled").length, 1);
    assert.equal([first, second].find(result => result.status === "rejected").reason.code, "maintenance_fence_state_changed");
    await assert.rejects(fence.confirmDrain({ pool: admin }), /maintenance_fence_owned/);
    assert.equal((await fence.confirmDrain({ pool: admin, expected: { state: "DRAINING", generation: 1, epoch, owner } })).state, "DRAINED");
    await assert.rejects(fence.releaseAdmission({ pool: admin, expected: { state: "DRAINED", generation: 1, epoch,
      owner: "maintenance:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" } }), /maintenance_fence_state_changed/);
    assert.equal((await fence.releaseAdmission({ pool: admin, expected: { state: "DRAINED", generation: 1, epoch, owner } })).state, "OPEN");
    assert.deepEqual((await admin.query(`SELECT status,provider_message_id FROM public.engine_universal_queue_destinations
      WHERE id IN (1,3) ORDER BY id`)).rows, [
      { status: "sent", provider_message_id: "provider-alpha" },
      { status: "ambiguous", provider_message_id: null }
    ]);
  } finally {
    await reader.end();
    await admin.end();
  }
});
