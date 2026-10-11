"use strict";

// Cutover gate probe: do not bypass the approved atomic-admission preflight.
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {Client}=require("pg");

const config={host:"127.0.0.1",port:55433,user:"postgres",
  database:"optimus_universal_fixture",connectionTimeoutMillis:5000};
const schema=`uf_boot_real_${crypto.randomBytes(6).toString("hex")}`;

async function main(){
  const db=new Client(config);
  let installed=false;
  try{
    await db.connect();
    const identity=(await db.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db,config.database);
    assert.equal(identity.host,config.host);
    assert.equal(identity.port,config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname,"..",".local-postgres","data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`);installed=true;
    await db.query(`SET search_path TO ${schema},public`);
    const engineRoot=path.join(__dirname,"..","modules","engine");
    await db.query(fs.readFileSync(path.join(engineRoot,"schema.sql"),"utf8"));
    await db.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      SELECT 'radar','radar','legacy_fixture',clock_timestamp()-interval '1 hour'
      FROM generate_series(1,100002)`);
    const conflict=(await db.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status) VALUES
      (1,'legacy_conflict','diagnosticado'),
      (1,'legacy_conflict','oferta_criada') RETURNING id`)).rows.map(row=>Number(row.id));
    await db.query(`INSERT INTO engine_processamentos(job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`,[conflict[0]]);
    await db.query(`INSERT INTO engine_eventos_comerciais
      (tipo_evento,cliente_id,workspace_id,job_id,chave_idempotencia)
      VALUES ('oferta_criada','legacy_conflict','legacy_conflict',$1,'uf_unsafe_fixture')`,
    [conflict[1]]);
    await db.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status) VALUES
      (2,'legacy_safe','pendente'),(2,'legacy_safe','pendente')`);
    await db.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status)
      SELECT id,'legacy_'||(id%25),'pendente'
      FROM engine_eventos_brutos WHERE id BETWEEN 3 AND 100002`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM engine_jobs_cliente`))
      .rows[0].n,100004);
    await assert.rejects(db.query(fs.readFileSync(path.join(engineRoot,
      "admission-gate.candidate.sql"),"utf8")),
    error=>error.message.includes("UF_LEGACY_RECONCILIATION_REQUIRED"));
    assert.equal((await db.query(`SELECT count(*)::int n FROM engine_jobs_cliente`))
      .rows[0].n,100004);
    assert.equal((await db.query(`SELECT count(*)::int n FROM engine_jobs_cliente
      WHERE id=ANY($1::bigint[])`,[conflict])).rows[0].n,2);
    console.log(JSON.stringify({candidate:"bootstrap_real_engine_legacy",
      legacyInitialDue:100000,unsafePreserved:2,safeDuplicates:2,
      admissionInstall:"BLOCKED_BY_UF_LEGACY_RECONCILIATION_REQUIRED",
      legacyDrainIntegrated:false,freshAdmitted:0,
      productionMigration:false}));
  }finally{
    if(installed)await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    await db.end().catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
