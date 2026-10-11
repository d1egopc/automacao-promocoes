"use strict";

// Exercises admission -> reserved lifecycle -> factual terminality in an
// isolated schema. It is not the full Processor/Validator/Importer pipeline.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { criarLifecycleLaneCandidata } = require("../modules/engine/lifecycle-lane.candidate");
const { terminalizarJobsPreImporter } = require("../modules/engine/terminalizer-pre-importer.service");

const config = { host:"127.0.0.1",port:55433,user:"postgres",
  database:"optimus_universal_fixture",connectionTimeoutMillis:5000 };
const schema = `uf_connected_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const admin = new Client(config);
  let commercial;
  let lifecycle;
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
    await admin.query(fs.readFileSync(path.join(__dirname,"..","modules","engine","admission-gate.candidate.sql"),"utf8"));
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,4,0,'HEALTHY',now(),interval '5 minutes')`);
    // Same total budget (2) split 1 commercial + 1 lifecycle. The bootstrap
    // of the real Engine pool is not altered by this isolated test.
    commercial = new Pool({ ...config,max:1,options:`-c search_path=${schema},public` });
    lifecycle = new Pool({ ...config,max:1,options:`-c search_path=${schema},public` });

    const oldCapture = new Date(Date.now()-60*60*1000);
    const event = (await commercial.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      VALUES ('radar','radar','whatsapp',$1) RETURNING id`,[oldCapture])).rows[0].id;
    for(let i=0;i<4;i++) {
      await commercial.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status,metadata)
        VALUES ($1,$2,'pendente','{}'::jsonb)`,[event,`ws_${i}`]);
    }
    await admin.query(`UPDATE engine_hot_admission_control SET health='CRITICAL' WHERE id=1`);
    await assert.rejects(commercial.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status) VALUES ($1,'ws_blocked','pendente')`,[event]),
    /UF_HOT_ADMISSION_DENIED/);

    const lane = criarLifecycleLaneCandidata({
      intervalMs:50,
      runBatch:()=>terminalizarJobsPreImporter({limite:2,pool:lifecycle,timeoutMs:5000}),
      persistWatchdog:async watchdog=>{
        if(!watchdog.lastSuccess)return;
        await admin.query(`UPDATE engine_hot_admission_control
          SET health='HEALTHY',lifecycle_last_success=to_timestamp($1::double precision/1000)
          WHERE id=1`,[watchdog.lastSuccess]);
      }
    });
    const commercialHeld = await commercial.connect();
    let first;
    try {
      // Simulate Processor/Validator/Importer occupying every commercial
      // application connection. Lifecycle must not wait for this pool.
      first = await lane.tick();
    } finally {
      commercialHeld.release();
    }
    assert.equal(first.ok,true,JSON.stringify(first));
    assert.equal(first.terminalizados.length,2);
    const usedAfterFirst = (await admin.query(`SELECT hot_used FROM engine_hot_admission_control`)).rows[0].hot_used;
    assert.equal(usedAfterFirst,2);
    const freshCapture = new Date();
    const freshEvent = (await commercial.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      VALUES ('clonador_grupos','clonador_grupos','whatsapp',$1) RETURNING id`,[freshCapture])).rows[0].id;
    await commercial.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      VALUES ($1,'ws_fresh','pendente','{}'::jsonb)`,[freshEvent]);
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`)).rows[0].hot_used,3);
    await admin.query("BEGIN");
    await admin.query(`SELECT pg_advisory_xact_lock(
      hashtext('engine'),hashtext('terminalizer_pre_importer'))`);
    const blockedByLease = await lane.tick();
    assert.equal(blockedByLease.pulado,true);
    await admin.query("COMMIT");
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`)).rows[0].hot_used,3);
    const second = await lane.tick();
    assert.equal(second.ok,true,JSON.stringify(second));
    assert.equal(second.terminalizados.length,2);
    const facts = (await admin.query(`SELECT count(*)::int AS n
      FROM engine_eventos_comerciais WHERE tipo_evento='job_expirada_operacional'`)).rows[0].n;
    assert.equal(facts,4);
    const freshStatus = (await admin.query(`SELECT status FROM engine_jobs_cliente
      WHERE evento_id=$1`,[freshEvent])).rows[0].status;
    assert.equal(freshStatus,"pendente");
    const persistedCapture = (await admin.query(`SELECT capturado_em
      FROM engine_eventos_brutos WHERE id=$1`,[freshEvent])).rows[0].capturado_em;
    assert.equal(new Date(persistedCapture).toISOString(),freshCapture.toISOString());
    lane.stop();

    console.log(JSON.stringify({candidate:"local_admission_lifecycle_connection",
      applicationPoolBudget:2,commercialPoolMax:1,lifecyclePoolMax:1,
      fixtureObserverConnections:1,commercialPoolSaturatedDuringLifecycle:true,
      hotLimit:4,maxHotObserved:4,terminalized:4,historicalFacts:4,
      freshJobStatus:freshStatus,capturedAtPreserved:true,
      crossConnectionLeaseAvoidedOverlap:true,
      productionPoolChanged:false}));
  } finally {
    if(commercial) await commercial.end().catch(()=>{});
    if(lifecycle) await lifecycle.end().catch(()=>{});
    if(installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
