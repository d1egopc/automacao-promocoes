"use strict";

// Schema compartilhado exclusivamente no PostgreSQL descartavel; removido no finally.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const { sqlFrescorComercialPreImporter, sqlRetryPreImporter } =
  require("../modules/engine/frescor-pre-importer.service");
const { sqlElegibilidadeTerminalizer, STATUS_TERMINALIZAVEIS } =
  require("../modules/engine/terminalizer-pre-importer.service");

const connection = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_head_model_${process.pid}`;
const frescor = sqlFrescorComercialPreImporter("j", "e");
const retry = sqlRetryPreImporter("j");
const active = "('pendente','diagnosticado','pronto_para_importar','pronto_sem_utilidade')";

async function tx(client, body) {
  await client.query("BEGIN");
  try {
    const value = await body();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function lockHead(client, workspace) {
  await client.query(`INSERT INTO uf_heads(cliente_id,pronto)
    VALUES($1,FALSE) ON CONFLICT(cliente_id) DO NOTHING`, [workspace]);
  await client.query("SELECT cliente_id FROM uf_heads WHERE cliente_id=$1 FOR UPDATE", [workspace]);
}

async function project(client, id) {
  await client.query(`UPDATE engine_jobs_cliente j
    SET expira_comercial_em=CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END,
        terminal_due_em=CASE WHEN ${frescor.manual} THEN NULL ELSE
          GREATEST(${frescor.expiraEm},to_timestamp(${retry.proximoEmMs}/1000.0)) END
    FROM engine_eventos_brutos e WHERE j.evento_id=e.id AND j.id=$1`, [id]);
}

async function refreshHead(client, workspace) {
  const next = (await client.query(`SELECT terminal_due_em AS due
    FROM engine_jobs_cliente WHERE cliente_id=$1 AND status IN ${active}
      AND terminal_due_em IS NOT NULL
    ORDER BY terminal_due_em,id LIMIT 1`, [workspace])).rows[0]?.due || null;
  await client.query(`UPDATE uf_heads
    SET proximo_due_em=$2,pronto=COALESCE($2::timestamptz<=clock_timestamp(),FALSE)
    WHERE cliente_id=$1`, [workspace, next]);
}

async function insertJob(client, id, workspace, ageMinutes, metadata = {}, status = "pendente",
  eventMetadata = {}) {
  await tx(client, async () => {
    await lockHead(client, workspace);
    await client.query(`INSERT INTO engine_eventos_brutos
      (id,origem,origem_tipo,metadata,capturado_em)
      VALUES($1,'synthetic_head','synthetic_head',$3::jsonb,
        clock_timestamp()-($2::numeric*INTERVAL '1 minute'))`,
    [id, ageMinutes, JSON.stringify(eventMetadata)]);
    await client.query(`INSERT INTO engine_jobs_cliente
      (id,evento_id,cliente_id,status,metadata,criado_em)
      VALUES($1,$1,$2,$3,$4::jsonb,clock_timestamp())`,
    [id, workspace, status, JSON.stringify(metadata)]);
    await project(client, id);
    await refreshHead(client, workspace);
  });
}

async function mutateJob(client, id, workspace, sql, params = []) {
  await tx(client, async () => {
    await lockHead(client, workspace);
    await client.query(sql, [id, ...params]);
    await project(client, id);
    await refreshHead(client, workspace);
  });
}

async function promoteDue(client, limit = 10) {
  return tx(client, async () => {
    const result = await client.query(`WITH due AS (
      SELECT cliente_id FROM uf_heads
       WHERE NOT pronto AND proximo_due_em<=clock_timestamp()
       ORDER BY proximo_due_em,cliente_id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE uf_heads h SET pronto=TRUE FROM due d
      WHERE h.cliente_id=d.cliente_id RETURNING h.cliente_id`, [limit]);
    return result.rows.map(row => row.cliente_id);
  });
}

async function consumeOne(client) {
  return tx(client, async () => {
    const head = (await client.query(`SELECT cliente_id FROM uf_heads WHERE pronto
      ORDER BY ultimo_atendimento_em ASC NULLS FIRST,cliente_id
      LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!head) return null;
    const workspace = head.cliente_id;
    const job = (await client.query(`SELECT id FROM engine_jobs_cliente
      WHERE cliente_id=$1 AND status IN ${active}
        AND terminal_due_em<=clock_timestamp()
      ORDER BY terminal_due_em,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [workspace])).rows[0];
    if (!job) {
      await refreshHead(client, workspace);
      return null;
    }
    const eligible = (await client.query(`WITH instante AS (SELECT clock_timestamp() AS agora)
      SELECT j.id FROM engine_jobs_cliente j
      LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id CROSS JOIN instante
      WHERE j.id=$2 AND ${sqlElegibilidadeTerminalizer({ agoraSql: "instante.agora" })}`,
    [STATUS_TERMINALIZAVEIS, job.id])).rows.length > 0;
    if (!eligible) {
      await project(client, job.id);
      await refreshHead(client, workspace);
      return null;
    }
    const changed = await client.query(`UPDATE engine_jobs_cliente
      SET status='expirada_operacional',
          metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{terminalOcorridoEm}',
            COALESCE(NULLIF(metadata->'terminalOcorridoEm','null'::jsonb),to_jsonb(clock_timestamp())),TRUE)
      WHERE id=$1 AND status IN ${active} RETURNING id,metadata->>'terminalOcorridoEm' AS terminal_em`,
    [job.id]);
    assert.equal(changed.rowCount, 1);
    await client.query(`INSERT INTO uf_terminal_facts(job_id,terminal_em)
      VALUES($1,$2::timestamptz) ON CONFLICT(job_id) DO NOTHING`,
    [job.id, changed.rows[0].terminal_em]);
    await refreshHead(client, workspace);
    await client.query("UPDATE uf_heads SET ultimo_atendimento_em=clock_timestamp() WHERE cliente_id=$1",
      [workspace]);
    return Number(job.id);
  });
}

(async () => {
  const owner = new Client(connection);
  const workerA = new Client(connection);
  const workerB = new Client(connection);
  let created = false;
  try {
    await Promise.all([owner.connect(), workerA.connect(), workerB.connect()]);
    const identity = (await owner.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, connection.database);
    assert.equal(identity.host, connection.host);
    assert.equal(identity.port, connection.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await owner.query(`CREATE SCHEMA ${schema}`);
    created = true;
    for (const client of [owner, workerA, workerB]) await client.query(`SET search_path TO ${schema}`);
    await owner.query(`CREATE TABLE engine_eventos_brutos
      (LIKE public.engine_eventos_brutos INCLUDING ALL)`);
    await owner.query(`CREATE TABLE engine_jobs_cliente
      (LIKE public.engine_jobs_cliente INCLUDING ALL)`);
    await owner.query("ALTER TABLE engine_jobs_cliente ADD COLUMN expira_comercial_em timestamptz");
    await owner.query("ALTER TABLE engine_jobs_cliente ADD COLUMN terminal_due_em timestamptz");
    await owner.query(`CREATE INDEX uf_jobs_due ON engine_jobs_cliente
      (cliente_id,terminal_due_em,id) WHERE status IN ${active} AND terminal_due_em IS NOT NULL`);
    await owner.query(`CREATE TABLE uf_heads(cliente_id text PRIMARY KEY,
      proximo_due_em timestamptz,pronto boolean NOT NULL DEFAULT FALSE,
      ultimo_atendimento_em timestamptz)`);
    await owner.query(`CREATE INDEX uf_heads_ready ON uf_heads
      (ultimo_atendimento_em ASC NULLS FIRST,cliente_id) WHERE pronto`);
    await owner.query(`CREATE INDEX uf_heads_schedule ON uf_heads
      (proximo_due_em,cliente_id) WHERE NOT pronto AND proximo_due_em IS NOT NULL`);
    await owner.query("CREATE TABLE uf_terminal_facts(job_id bigint PRIMARY KEY,terminal_em timestamptz NOT NULL)");

    for (let i = 0; i < 8; i += 1) await insertJob(owner, 1000+i, `ws8_${i}`, 60);
    const served8 = [];
    for (let i = 0; i < 8; i += 1) served8.push(await consumeOne(workerA));
    assert.equal(new Set(served8).size, 8);
    assert.equal(await consumeOne(workerA), null);
    for (let i = 0; i < 25; i += 1) await insertJob(owner, 2000+i, `ws25_${i}`, 60);
    const served25 = [];
    for (let i = 0; i < 25; i += 1) served25.push(await consumeOne(workerA));
    assert.equal(new Set(served25).size, 25);

    for (let i = 0; i < 5; i += 1) await insertJob(owner, 3000+i, "a_dominant", 60);
    await insertJob(owner, 3010, "z_small", 60);
    const firstTwo = [await consumeOne(workerA), await consumeOne(workerA)];
    assert(firstTwo.includes(3010), "workspace pequeno progride apesar de dominante");
    for (let i = 0; i < 8; i += 1) await insertJob(owner, 3100+i, `small_${i}`, 60);
    const smallUnderReplenishment = [];
    for (let i = 0; i < 8; i += 1) {
      await insertJob(owner, 3200+i, "a_dominant", 60);
      smallUnderReplenishment.push(await consumeOne(workerA));
    }
    assert.deepEqual(new Set(smallUnderReplenishment),
      new Set(Array.from({ length: 8 }, (_, i) => 3100+i)));

    await insertJob(owner, 4001, "retry_future", 60,
      { localWorkerImageRetry: { proximaTentativaEmMs: String(Date.now()+60000) } });
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='retry_future'")).rows[0].pronto, false);
    await mutateJob(owner, 4001, "retry_future", `UPDATE engine_jobs_cliente
      SET metadata=jsonb_set(metadata,'{localWorkerImageRetry,proximaTentativaEmMs}',to_jsonb($2::text))
      WHERE id=$1`, [String(Date.now()-1000)]);
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='retry_future'")).rows[0].pronto, true);

    await insertJob(owner, 4002, "manual", 120, { manualV2: true });
    assert.equal((await owner.query("SELECT proximo_due_em FROM uf_heads WHERE cliente_id='manual'")).rows[0].proximo_due_em, null);
    await mutateJob(owner, 4002, "manual", "UPDATE engine_jobs_cliente SET metadata=metadata-'manualV2' WHERE id=$1");
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='manual'")).rows[0].pronto, true);

    await insertJob(owner, 4003, "claimed", 60);
    await mutateJob(owner, 4003, "claimed", "UPDATE engine_jobs_cliente SET status='processando' WHERE id=$1");
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='claimed'")).rows[0].pronto, false);
    await mutateJob(owner, 4003, "claimed", "UPDATE engine_jobs_cliente SET status='pendente' WHERE id=$1");

    await insertJob(owner, 4004, "crash", 60);
    const crasher = new Client(connection);
    await crasher.connect();
    await crasher.query(`SET search_path TO ${schema}`);
    await crasher.query("BEGIN");
    await crasher.query("SELECT cliente_id FROM uf_heads WHERE cliente_id='crash' FOR UPDATE");
    await crasher.end(); // rollback automatico: head/job permanecem disponiveis

    const drained = [];
    for (let i = 0; i < 30; i += 1) {
      const id = await consumeOne(workerA);
      if (id === null) break;
      drained.push(id);
    }
    assert(drained.includes(4004), "job continua atendivel depois do rollback por queda");

    await insertJob(owner, 4005, "stale", 60);
    await owner.query("UPDATE engine_jobs_cliente SET metadata=metadata||'{\"manualV2\":true}'::jsonb WHERE id=4005");
    const staleResult = await consumeOne(workerA);
    assert.equal(staleResult, null, "head obsoleto deve reparar sem terminalizar Manual");
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='stale'")).rows[0].pronto, false);

    await insertJob(owner, 5001, "parallel_a", 60);
    await insertJob(owner, 5002, "parallel_b", 60);
    const parallel = await Promise.all([consumeOne(workerA), consumeOne(workerB)]);
    assert.equal(new Set(parallel.filter(Boolean)).size, 2);

    await insertJob(owner, 6001, "parallel_same", 60);
    await insertJob(owner, 6002, "parallel_same", 60);
    const sameHead = await Promise.all([consumeOne(workerA), consumeOne(workerB)]);
    assert.equal(sameHead.filter(Boolean).length, 1,
      "head do mesmo workspace so pode ser atendido por um worker por rodada");
    const nextSame = await consumeOne(workerA);
    assert.deepEqual(new Set([...sameHead, nextSame].filter(Boolean)), new Set([6001,6002]));

    await insertJob(owner, 6003, "scheduled", 29.99);
    assert.equal((await owner.query("SELECT pronto FROM uf_heads WHERE cliente_id='scheduled'")).rows[0].pronto, false);
    await new Promise(resolve => setTimeout(resolve, 900));
    const promoted = await promoteDue(owner);
    assert(promoted.includes("scheduled"));
    assert.equal(await consumeOne(workerB), 6003);
    assert.equal(await consumeOne(workerB), null, "replay nao deve criar novo fato");

    await insertJob(owner, 7001, "turbo_whitespace", 12, { tipoFluxo: " cupom_turbo " });
    await insertJob(owner, 7002, "turbo_alias", 12,
      { tipoFluxo: " ", tipo_fluxo: "cupom_turbo" });
    const turboTtls = (await owner.query(`SELECT j.id,
      EXTRACT(EPOCH FROM (j.expira_comercial_em-e.capturado_em))::int AS ttl_seconds
      FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
      WHERE j.id IN (7001,7002) ORDER BY j.id`)).rows;
    assert.deepEqual(turboTtls.map(row => row.ttl_seconds), [600,600]);
    assert.deepEqual(new Set([await consumeOne(workerA),await consumeOne(workerA)]),
      new Set([7001,7002]));
    await insertJob(owner, 7003, "manual_json_null", 120,
      { metadataEvento: { manualV2: true } }, "pendente", null);
    assert.equal((await owner.query("SELECT proximo_due_em FROM uf_heads WHERE cliente_id='manual_json_null'")).rows[0].proximo_due_em, null);

    const freshSession = new Client(connection);
    await freshSession.connect();
    await freshSession.query(`SET search_path TO ${schema}`);
    const facts = (await freshSession.query("SELECT COUNT(*)::int AS n FROM uf_terminal_facts")).rows[0].n;
    const heads = (await freshSession.query("SELECT COUNT(*)::int AS n FROM uf_heads")).rows[0].n;
    await freshSession.end();
    assert(facts >= 35);
    console.log("UNIVERSAL_HEAD_MODEL " + JSON.stringify({ served8: served8.length,
      served25: served25.length, dominantAndSmall: firstTwo,
      smallUnderReplenishment, retryAdvanced: true,
      manualProtected: true, claimRefresh: true, crashRollback: true,
      staleHeadRepaired: true, parallel, facts, heads,
      sameHead, nextSame, promoted,
      turboTtls, manualJsonNullProtected: true,
      caveat: "isolated API model; product write paths and 100k operational plan not integrated" }));
  } finally {
    await Promise.all([workerA.end().catch(() => {}), workerB.end().catch(() => {})]);
    if (created) await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await owner.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_HEAD_MODEL_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
