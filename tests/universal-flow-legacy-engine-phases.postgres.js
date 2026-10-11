"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
process.env.DATA_DIR = path.join(__dirname,"..",".local-test-tmp",
  "uf_legacy_engine_phases");
const { runSteadyLifecycle } = require("../modules/engine/lifecycle-steady.candidate");
const { instalarFaseA, criarLegacyDrainEngineCandidato, instalarFaseD } =
  require("../modules/engine/legacy-engine-drain.candidate");
const { criarBootstrapLocalCandidato } =
  require("../modules/engine/universal-flow-local-bootstrap.candidate");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const volume = Math.max(1000, Number(process.env.UF_TEST_LEGACY_VOLUME) || 100000);

async function fixture(unsafe) {
  const schema = `uf_cut_phases_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new Client(config);
  let pool, enginePool, bootstrap, installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`); installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root,
      "modules/engine/schema.sql"), "utf8"));
    await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      SELECT 'radar','radar','whatsapp',now()-interval '2 hours'
      FROM generate_series(1,$1::int)`, [volume + 3]);
    await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status)
      SELECT id,'legacy_'||(id%25),'pendente'
      FROM engine_eventos_brutos WHERE id<=$1`, [volume]);
    // Two safe groups: pristine/pristine, then one factual owner + pristine.
    await admin.query(`INSERT INTO engine_jobs_cliente(evento_id,cliente_id,status)
      VALUES (1,'legacy_1','pendente'),
        ($1,'safe_owner','diagnosticado'),
        ($1,'safe_owner','pendente')`, [volume + 1]);
    const owner = (await admin.query(`SELECT id FROM engine_jobs_cliente
      WHERE evento_id=$1 AND status='diagnosticado'`, [volume + 1])).rows[0].id;
    await admin.query(`INSERT INTO engine_processamentos(job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [owner]);
    let conflicting = [];
    if (unsafe) {
      conflicting = (await admin.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status) VALUES
        ($1,'unsafe','diagnosticado'),
        ($1,'unsafe','oferta_criada') RETURNING id`,
      [volume + 2])).rows.map(row => row.id);
      await admin.query(`INSERT INTO engine_processamentos(job_id,etapa,status)
        VALUES ($1,'diagnostico','concluido')`, [conflicting[0]]);
      await admin.query(`INSERT INTO engine_eventos_comerciais
        (tipo_evento,cliente_id,workspace_id,job_id,chave_idempotencia)
        VALUES ('oferta_criada','unsafe','unsafe',$1,'unsafe_fact')`, [conflicting[1]]);
    }
    const initialHot = (await admin.query(`SELECT count(*)::int n
      FROM engine_jobs_cliente WHERE status IN
      ('pendente','diagnosticado','validando','pronto','pronto_para_importar',
       'processando','importando','distribuindo','executando','retry','agendado',
       'claimed','bloqueado','pronto_sem_utilidade')`)).rows[0].n;
    const oldAdmission = fs.readFileSync(path.join(root,
      "modules/engine/admission-gate.candidate.sql"), "utf8");
    await assert.rejects(admin.query(oldAdmission),
      /UF_LEGACY_RECONCILIATION_REQUIRED/);
    await instalarFaseA(admin);
    const additiveInstalled = (await admin.query(`SELECT count(*)::int n
      FROM engine_legacy_duplicate_keys_candidate`)).rows[0].n;
    assert.equal(additiveInstalled, unsafe ? 3 : 2);
    pool = new Pool({ ...config, max: 2,
      options: `-c search_path=${schema},public` });
    const drain = criarLegacyDrainEngineCandidato({ pool,
      inspectExternalReferences: async () => 0 });
    const healthSnapshots = [];
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool:pool,
      lifecycleLimit:100,legacyDrainLimit:100,
      runLegacyDrain:args=>drain.tick(args),
      persistWatchdog:async snapshot=>healthSnapshots.push(
        snapshot.lastSuccess ? "HEALTHY" : "UNKNOWN"),
      setIntervalFn:()=>({unref(){}}),clearIntervalFn:()=>{} });
    const started = await bootstrap.start();
    assert.equal(started.ok,true);
    assert.equal(healthSnapshots.at(-1),"UNKNOWN");
    let legacyDrained = started.legacy.processed;
    let legacyReconciled = started.legacy.reconciled;
    let lifecycleProgress = started.lifecycle.terminalized.length;
    let freshInserted = 0, freshProcessed = 0;
    let maxHotSet = initialHot, maxFreshHotSet = 0, poolWaitMax = 0;
    const roundsMax = Math.ceil((volume + 5) / 100) + 20;
    for (let round = 0; round < roundsMax; round++) {
      const batch = await bootstrap.legacyTick();
      assert.equal(batch.ok, true, JSON.stringify(batch));
      legacyDrained += batch.processed;
      legacyReconciled += batch.reconciled;
      const steady = await bootstrap.lifecycleTick();
      poolWaitMax = Math.max(poolWaitMax,pool.waitingCount);
      assert.equal(steady.ok, true, JSON.stringify(steady));
      lifecycleProgress += steady.terminalized.length;
      if (round === 10) {
        await admin.query(`INSERT INTO engine_eventos_brutos
          (origem,fonte,origem_tipo,capturado_em,links_extraidos,marketplace_detectado)
          SELECT 'radar','radar','whatsapp',now()-interval '1 minute',
            jsonb_build_array('https://www.amazon.com.br/dp/B0'||lpad(g::text,8,'0')),
            'amazon' FROM generate_series(1,25) AS g`);
        await admin.query(`INSERT INTO engine_links
          (evento_id,url_original,url_normalizada,url_expandida,marketplace_detectado)
          SELECT e.id,e.links_extraidos->>0,e.links_extraidos->>0,
            e.links_extraidos->>0,'amazon'
          FROM engine_eventos_brutos e WHERE e.id>$1`,[volume + 3]);
        const ids = (await admin.query(`INSERT INTO engine_jobs_cliente
          (evento_id,cliente_id,status,marketplace_detectado,marketplace)
          SELECT id,'fresh_'||id,'pendente','amazon','amazon'
          FROM engine_eventos_brutos WHERE id>$1 RETURNING id`,
        [volume + 3])).rows;
        freshInserted = ids.length;
        assert.equal(freshInserted,25);
        maxFreshHotSet = Math.max(maxFreshHotSet, freshInserted);
        maxHotSet = Math.max(maxHotSet,(await admin.query(`SELECT count(*)::int n
          FROM engine_jobs_cliente WHERE status IN
          ('pendente','diagnosticado','validando','pronto','pronto_para_importar',
           'processando','importando','distribuindo','executando','retry','agendado',
           'claimed','bloqueado','pronto_sem_utilidade')`)).rows[0].n);
        if (unsafe) {
          // The conflict fixture is only for preserving facts/fail-closed.
          freshProcessed = (await admin.query(`UPDATE engine_jobs_cliente
            SET status='oferta_criada' WHERE id=ANY($1::bigint[])`,
          [ids.map(row => row.id)])).rowCount;
        } else {
          process.env.PGSSLMODE = "disable";
          process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:55433/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
          fs.mkdirSync(process.env.DATA_DIR,{recursive:true});
          const workspaces = (await admin.query(`SELECT cliente_id FROM engine_jobs_cliente
            WHERE id=ANY($1::bigint[])`,[ids.map(row=>row.id)])).rows
            .map(row=>row.cliente_id);
          require("../utils/storage").writeGlobalJson("usuarios.json",
            workspaces.map(id=>({id,ativo:true,plano:"pro"})));
          enginePool = require("../modules/engine/database").getEnginePool();
          const { processarJobsPendentesEngine } =
            require("../modules/engine/processor.runner");
          const { validarJobsDiagnosticadosEngine } =
            require("../modules/engine/validator.runner");
          const { importarJobsProntosEngine } =
            require("../modules/engine/importer/importer.runner");
          const integration = {ativo:true,credenciais:{tag:"fixture-tag"}};
          const integrations = Object.fromEntries(workspaces.map(id=>
            [id,{amazon:integration}]));
          const originalLog = console.log;
          try {
            console.log=()=>{};
            for(let attempt=0;attempt<5;attempt++) {
              const p=await processarJobsPendentesEngine({limite:25,
                clientesValidos:workspaces,
                avaliarWorkspaceParaEngine:()=>({elegivelEngine:true})});
              const v=await validarJobsDiagnosticadosEngine({limite:25,
                clientesValidos:workspaces,
                avaliarWorkspaceParaEngine:()=>({elegivelEngine:true}),
                integracoesPorCliente:integrations});
              const i=await importarJobsProntosEngine({limite:25,
                marketplace:"amazon",deps:{getIntegracaoCliente:()=>integration,
                  importarAmazon:async url=>({titulo:"Produto de fixture",
                    precoAtual:199.9,precoOriginal:249.9,
                    imagem:"https://example.invalid/fixture.jpg",
                    linkOriginal:url,linkAfiliado:`${url}?tag=fixture-tag`,
                    categoria:"Eletronicos"})}});
              assert.equal(p.erros,0,JSON.stringify(p));
              assert.equal(v.erro_validacao,0,JSON.stringify(v));
              assert.equal(i.erros,0,JSON.stringify(i));
              freshProcessed=(await admin.query(`SELECT count(*)::int n
                FROM engine_jobs_cliente WHERE id=ANY($1::bigint[])
                  AND status='oferta_criada'`,[ids.map(row=>row.id)])).rows[0].n;
              if(freshProcessed===25)break;
            }
          } finally { console.log=originalLog; }
        }
      }
      if (round % 100 === 0) console.error(`legacy_phase_progress unsafe=${unsafe} round=${round} scanned=${legacyDrained} terminal=${lifecycleProgress}`);
      if (batch.processed === 0 && round > Math.ceil(volume / 100)) break;
    }
    const finalTick = await bootstrap.legacyTick();
    assert.equal(finalTick.processed, 0);
    // A deleted duplicate can still be present in the current selected batch.
    assert.equal(legacyDrained,volume + 2 + (unsafe ? 2 : 0));
    assert.equal(legacyReconciled,2);
    assert.equal(freshInserted,25);
    assert.equal(freshProcessed,25);
    const aliases = (await admin.query(`SELECT count(*)::int n
      FROM engine_legacy_job_alias_candidate`)).rows[0].n;
    assert.equal(aliases,2);
    const conflictRows = unsafe ? (await admin.query(`SELECT id FROM engine_jobs_cliente
      WHERE id=ANY($1::bigint[])`, [conflicting])).rows.length : 0;
    assert.equal(conflictRows, unsafe ? 2 : 0);
    const conflictFacts = unsafe ? (await admin.query(`SELECT
      (SELECT count(*)::int FROM engine_processamentos
        WHERE job_id=$1 AND etapa='diagnostico' AND status='concluido') AS processing,
      (SELECT count(*)::int FROM engine_eventos_comerciais
        WHERE job_id=$2 AND tipo_evento='oferta_criada') AS commercial`,
    conflicting)).rows[0] : {processing:0,commercial:0};
    if (unsafe) assert.deepEqual(conflictFacts,{processing:1,commercial:1});
    const finalStatuses = (await admin.query(`SELECT status,count(*)::int n
      FROM engine_jobs_cliente WHERE id<=$1 GROUP BY status ORDER BY status`,
    [drain.state().ceiling])).rows;
    if (unsafe) {
      assert.equal(finalTick.completed,false);
      assert.equal(healthSnapshots.at(-1),"UNKNOWN");
      const denied = await instalarFaseD(admin);
      assert.equal(denied.ok,false);
      assert.match(denied.error,/UF_PHASE_D_PREFLIGHT_DENIED/);
    } else {
      assert.equal(finalTick.completed,true,JSON.stringify(finalTick));
      assert.equal(healthSnapshots.at(-1),"HEALTHY");
      const enforced = await instalarFaseD(admin);
      assert.equal(enforced.ok,true,JSON.stringify(enforced));
      const control = await admin.query(`INSERT INTO engine_hot_admission_control
        (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
        VALUES (1,25,0,'UNKNOWN',NULL,interval '5 minutes') RETURNING id`);
      assert.equal(control.rowCount,1);
      const steady = await runSteadyLifecycle({ pool, limit: 25 });
      assert.equal(steady.ok,true);
      await admin.query(`UPDATE engine_hot_admission_control
        SET health='HEALTHY',lifecycle_last_success=now() WHERE id=1`);
      const event = (await admin.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,origem_tipo,capturado_em)
        VALUES ('radar','radar','whatsapp',now()) RETURNING id`)).rows[0].id;
      const admitted = await admin.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status)
        VALUES ($1,'post_cutover','pendente') RETURNING id`, [event]);
      assert.equal(admitted.rowCount,1);
      assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`))
        .rows[0].hot_used,1);
    }
    return { unsafe, phaseA:"ADDITIVE", phaseB:{ scanned:legacyDrained,
      reconciled:legacyReconciled }, phaseC:{ conflictRows,
      legacyTerminalized:lifecycleProgress, aliases,
      completed:finalTick.completed,conflictFacts,finalStatuses },
      phaseD:unsafe?"DENIED_CONFLICT":"ENFORCED",
      freshInserted,freshProcessed,maxHotSet,maxFreshHotSet,poolWaitMax,
      freshTransition:unsafe?"fixture_terminal":"processor_validator_importer",
      bootstrapHealth:healthSnapshots.at(-1) };
  } finally {
    bootstrap?.stop();
    if (enginePool) await enginePool.end().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

async function run() {
  const unsafe = await fixture(true);
  const safe = await fixture(false);
  console.log(JSON.stringify({ candidate:"legacy_engine_cutover_phases",
    unsafe,safe,productionMigration:false }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
