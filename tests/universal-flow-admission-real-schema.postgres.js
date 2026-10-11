"use strict";

// Applies the unchanged Engine schema and the unshipped candidate migration
// inside one disposable, randomly named local PostgreSQL schema.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_real_gate_${crypto.randomBytes(6).toString("hex")}`;
const hotStatuses = ["pendente","diagnosticado","validando","pronto",
  "pronto_para_importar","processando","importando","distribuindo",
  "executando","retry","agendado","claimed","bloqueado",
  "pronto_sem_utilidade"];

async function connect() {
  const client = new Client({ ...config, options: `-c search_path=${schema},public` });
  await client.connect();
  return client;
}

async function createEvent(client, origin, capturedAt = new Date()) {
  const result = await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,origem_tipo,capturado_em)
    VALUES ($1,$1,$2,$3) RETURNING id`, [origin,"whatsapp",capturedAt]);
  return result.rows[0].id;
}

async function createJob(client, eventId, workspace, status = "pendente") {
  try {
    const result = await client.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
    [eventId,workspace,status]);
    return result.rows[0].id;
  } catch (error) {
    assert.match(error.message,/UF_HOT_ADMISSION_DENIED/);
    return null;
  }
}

async function checkInvariant(client, limit) {
  const result = await client.query(`SELECT c.hot_used,c.hot_limit,
    (SELECT count(*)::int FROM engine_jobs_cliente j
      WHERE engine_hot_status_candidate(j.status)
        AND NOT engine_manual_v2_candidate(j.evento_id,j.metadata)) AS actual
    FROM engine_hot_admission_control c WHERE c.id=1`);
  assert.equal(result.rows[0].hot_limit,limit);
  assert.equal(result.rows[0].hot_used,result.rows[0].actual);
  assert(result.rows[0].hot_used<=limit);
  return result.rows[0].hot_used;
}

async function run() {
  const admin = new Client(config);
  const workers = [];
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db,config.database);
    assert.equal(identity.host,config.host);
    assert.equal(identity.port,config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname,"..",".local-postgres","data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(__dirname,"..","modules","engine","schema.sql"),"utf8"));
    const candidateSql = fs.readFileSync(path.join(__dirname,"..","modules","engine","admission-gate.candidate.sql"),"utf8");
    const legacyEvent = await createEvent(admin,"radar");
    await admin.query(`INSERT INTO engine_jobs_cliente (evento_id,cliente_id,status)
      VALUES ($1,'ws_legacy','pendente')`,[legacyEvent]);
    await assert.rejects(admin.query(candidateSql),/UF_LEGACY_RECONCILIATION_REQUIRED/);
    const untouched = (await admin.query(`SELECT to_regclass('engine_hot_admission_control') AS table_name`)).rows[0];
    assert.equal(untouched.table_name,null);
    await admin.query(`DELETE FROM engine_eventos_brutos WHERE id=$1`,[legacyEvent]);
    await admin.query(candidateSql);
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,2,0,'HEALTHY',now(),interval '5 minutes')`);
    for(let i=0;i<6;i++) workers.push(await connect());

    const capturedAt = new Date(Date.now()-8*60*1000);
    const eventId = await createEvent(admin,"radar",capturedAt);
    const first = await createJob(workers[0],eventId,"ws_a");
    const second = await createJob(workers[1],eventId,"ws_b");
    const third = await createJob(workers[2],eventId,"ws_c");
    assert(first && second && !third);
    assert.equal(await checkInvariant(admin,2),2);
    const capture = (await admin.query(`SELECT capturado_em FROM engine_eventos_brutos
      WHERE id=$1`,[eventId])).rows[0].capturado_em;
    assert.equal(new Date(capture).toISOString(),capturedAt.toISOString());

    await admin.query(`UPDATE engine_jobs_cliente SET status='expirada_operacional'
      WHERE id=$1`,[first]);
    assert.equal(await checkInvariant(admin,2),1);
    const manualEvent = await createEvent(admin,"manual_v2");
    const manual = await createJob(admin,manualEvent,"ws_manual");
    assert(manual);
    assert.equal(await checkInvariant(admin,2),1);

    const results = await Promise.all(workers.map((client,i) =>
      createJob(client,eventId,`ws_race_${i}`)));
    assert.equal(results.filter(Boolean).length,1);
    assert.equal(await checkInvariant(admin,2),2);
    await assert.rejects(admin.query(`UPDATE engine_jobs_cliente SET status='pendente'
      WHERE id=$1`,[first]),/UF_HOT_ADMISSION_DENIED/);
    assert.equal(await checkInvariant(admin,2),2);

    await admin.query(`UPDATE engine_hot_admission_control SET hot_limit=4,
      health='UNKNOWN' WHERE id=1`);
    assert.equal(await createJob(admin,eventId,"ws_unknown"),null);
    await admin.query(`UPDATE engine_hot_admission_control SET health='HEALTHY',
      lifecycle_last_success=now()-interval '1 day' WHERE id=1`);
    assert.equal(await createJob(admin,eventId,"ws_stale"),null);
    await admin.query(`UPDATE engine_hot_admission_control SET health='HEALTHY',
      lifecycle_last_success=now() WHERE id=1`);

    for (const status of hotStatuses) {
      await admin.query(`UPDATE engine_jobs_cliente SET status=$2 WHERE id=$1`,
        [first,status]);
      assert.equal(await checkInvariant(admin,4),3,status);
      await admin.query(`UPDATE engine_jobs_cliente SET status='expirada_operacional'
        WHERE id=$1`,[first]);
      assert.equal(await checkInvariant(admin,4),2,status);
    }

    await admin.query(`DELETE FROM engine_eventos_brutos WHERE id=$1`,[manualEvent]);
    assert.equal(await checkInvariant(admin,4),2);

    const conflict = await admin.query(`INSERT INTO engine_jobs_cliente
      (id,evento_id,cliente_id,status,metadata)
      VALUES ($1,$2,'ws_b','pendente','{}'::jsonb)
      ON CONFLICT (id) DO NOTHING RETURNING id`,[second,eventId]);
    assert.equal(conflict.rowCount,0);
    assert.equal(await checkInvariant(admin,4),2,
      "ON CONFLICT DO NOTHING must not consume headroom");
    const conflictUpdate = await admin.query(`INSERT INTO engine_jobs_cliente
      (id,evento_id,cliente_id,status,metadata)
      VALUES ($1,$2,'ws_b','pendente','{}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET atualizado_em=NOW()
      RETURNING id`,[second,eventId]);
    assert.equal(conflictUpdate.rowCount,1);
    assert.equal(await checkInvariant(admin,4),2,
      "ON CONFLICT DO UPDATE without hot transition must not consume headroom");
    await admin.query(`DELETE FROM engine_eventos_brutos WHERE id=$1`,[eventId]);
    assert.equal(await checkInvariant(admin,4),0,
      "cascading event deletion must release all hot slots");

    console.log(JSON.stringify({candidate:"actual_engine_schema_trigger",
      fanoutAdmitted:2,fanoutRejected:1,sixWorkerRaceAdmitted:1,
      capturedAtPreserved:true,manualExcluded:true,
      testedHotStatuses:hotStatuses.length,rollbackDeniedAtCap:true,
      unknownDenied:true,staleDenied:true,manualCascadeDeleteSafe:true,
      conflictDoNothingAccountingSafe:true,conflictDoUpdateAccountingSafe:true,
      hotCascadeDeleteAccountingSafe:true,
      legacyCutoverFailsClosed:true,
      maxHotObserved:3}));
  } finally {
    await Promise.all(workers.map(client=>client.end().catch(()=>{})));
    if(installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
