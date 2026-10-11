"use strict";

// Local-only integrated admission -> real Processor selector -> fairness claim.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Client, Pool } = require("pg");
const processor = require("../modules/engine/processor.service");
const validator = require("../modules/engine/validator.service");
const importer = require("../modules/engine/importer/importer.service");
const processorFairness = require("../modules/engine/processor-fairness.service");
const validatorFairness = require("../modules/engine/validator-fairness.service");
const importerFairness = require("../modules/engine/importer/importer-fairness.service");
const { calcularCotasFrescorPreImporter,sqlFrescorComercialPreImporter,
  sqlRetryPreImporter } = require("../modules/engine/frescor-pre-importer.service");
const { projectionDdl, runSteadyLifecycle } = require("../modules/engine/lifecycle-steady.candidate");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_fair_admission_${crypto.randomBytes(6).toString("hex")}`;

async function importerQuery(limit, marketplace = "") {
  const source = fs.readFileSync(path.join(__dirname,"..","modules","engine",
    "importer","importer.service.js"),"utf8");
  const start = source.indexOf("async function buscarJobsProntos(");
  const end = source.indexOf("function removerCamposInternosCandidatePoolImporter(",start);
  assert(start >= 0 && end > start);
  const captured=[];
  const context={queryEngine:async(sql,params)=>{
    captured.push({sql,params}); return {ok:true,resultado:{rows:[]}};
  },calcularCotasFrescorPreImporter,sqlFrescorComercialPreImporter,
    sqlRetryPreImporter,limitarJobs:n=>n,
    separarResultadoJobsProntos:()=>({jobs:[],candidatePool:[]}),
    console:{log:()=>{}}};
  vm.runInNewContext(source.slice(start,end)+"\nthis.capture=buscarJobsProntos;",
    context,{timeout:1000});
  await context.capture({limite:limit,marketplace});
  return captured.find(item=>/^\s*WITH\b/i.test(item.sql));
}

const stages=[
  {name:"processor",status:"pendente",sql:processor.sqlBuscarJobsPendentes,
    parse:processor.separarResultadoJobsPendentes,fairness:processorFairness},
  {name:"validator",status:"diagnosticado",sql:validator.sqlBuscarJobsDiagnosticados,
    parse:validator.separarResultadoJobsDiagnosticados,fairness:validatorFairness},
  {name:"importer",status:"pronto_para_importar",query:importerQuery,
    parse:importer.separarResultadoJobsProntos,fairness:importerFairness}
];

async function main() {
  const admin = new Client(config);
  let pool, installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host, inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const name of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules", "engine", name), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_max_staleness,lifecycle_last_success)
      VALUES (1,100,0,'HEALTHY',interval '1 minute',now())`);
    pool = new Pool({ ...config, options: `-c search_path=${schema},public`, max: 2 });

    async function seed(workspace, origin = "optimus", stage = stages[0],
      marketplace = "mercadolivre", extraMetadata = {}, ageMinutes = 1) {
      const event = (await admin.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,origem_tipo,capturado_em,metadata)
        VALUES ('radar','radar','synthetic',clock_timestamp()-$2::int*interval '1 minute',
          jsonb_build_object('origemFluxo',$1::text)) RETURNING id`,
      [origin,ageMinutes])).rows[0].id;
      const job = (await admin.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status,marketplace,marketplace_detectado,metadata)
        VALUES ($1,$2,$3,$4,$4,$5::jsonb) RETURNING id`,
      [event,workspace,stage.status,marketplace,
        JSON.stringify({origemFluxo:origin,...extraMetadata})])).rows[0].id;
      return Number(job);
    }
    async function round(limit, stage = stages[0], nextStatus = "oferta_criada") {
      const q = calcularCotasFrescorPreImporter(limit);
      const query = stage.query ? await stage.query(limit) : {sql:stage.sql(),
        params:[q.aguaNova,q.frescaEmRisco,q.frescaCirculavel,q.limpeza,q.totalSelecao]};
      const rows = (await admin.query(query.sql,query.params)).rows;
      const parsed = stage.parse(rows);
      const groups = stage.fairness.montarGruposFairness(parsed.jobs.map((job, indiceBaseline) =>
        ({ ...job, indiceBaseline })), parsed.candidatePool);
      const claimed = [];
      for (const group of groups) {
        const positions = group.baseline.map(job => job.indiceBaseline);
        let plan;
        const reserved = new Set();
        for (const position of positions) {
          const result = await stage.fairness.reivindicarSlotFairness(group, position,
            { pool, plano: plan, idsReservados: reserved });
          assert.equal(result.ok, true, JSON.stringify(result));
          if (result.plano) plan = result.plano;
          if (result.job) {
            const factualOrigin = (await admin.query(`SELECT metadata->>'origemFluxo' origin
              FROM engine_jobs_cliente WHERE id=$1`, [result.job.id])).rows[0].origin;
            const recordedOrigin = (await admin.query(`SELECT ultima_origem_atendida origin
              FROM engine_fairness_origem_fluxo WHERE cliente_id=$1 AND etapa=$2 AND lane=$3`,
            [group.clienteId,stage.fairness.ETAPA_PROCESSOR_FAIRNESS ||
              stage.fairness.ETAPA_VALIDATOR_FAIRNESS || stage.fairness.ETAPA_IMPORTER_FAIRNESS,
              stage.name === "importer" ? `${group.marketplace}:${group.lane}` :
                group.lane])).rows[0]?.origin;
            claimed.push({ id: Number(result.job.id), workspace: group.clienteId,
              origin: factualOrigin, recordedOrigin });
            reserved.add(Number(result.job.id));
          }
        }
      }
      assert.equal(claimed.length, limit, JSON.stringify({ stage:stage.name,
        limit, claimed, baseline: parsed.jobs.length }));
      assert.equal(new Set(claimed.map(item => item.id)).size, limit);
      await admin.query(`UPDATE engine_jobs_cliente SET status=$2
        WHERE id=ANY($1::bigint[])`, [claimed.map(item => item.id),nextStatus]);
      return claimed;
    }
    async function reset() {
      // TRUNCATE does not fire the admission row trigger; release live jobs first.
      await admin.query(`UPDATE engine_jobs_cliente SET status='oferta_criada'
        WHERE status IN ('pendente','diagnosticado','pronto_para_importar')`);
      await admin.query(`TRUNCATE engine_fairness_origem_fluxo,
        engine_jobs_cliente,engine_eventos_brutos CASCADE`);
      assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`))
        .rows[0].hot_used,0);
    }
    async function scenario(workspaces, slots, stage) {
      await reset();
      const target = [];
      for (let i=0;i<workspaces;i++) target.push(await seed(`ws_${i}`, "optimus",stage));
      const received = [];
      for (let i=0;i<Math.ceil(workspaces/slots);i++) {
        const batch = await round(Math.min(slots,workspaces-received.length),stage);
        received.push(...batch);
      }
      assert.deepEqual(new Set(received.map(item => item.id)),new Set(target));
      return { stage:stage.name,workspaces,slots,rounds:Math.ceil(workspaces/slots),
        reached:new Set(received.map(item=>item.workspace)).size };
    }
    async function originScenario(heavy, light, stage) {
      await reset();
      await seed("both",light,stage);
      for (let i=0;i<12;i++) await seed("both",heavy,stage);
      const first=(await round(1,stage))[0];
      await seed("both",heavy,stage);
      const second=(await round(1,stage))[0];
      assert.deepEqual(new Set([first.origin,second.origin]),new Set([heavy,light]),
        JSON.stringify({ heavy, light, first, second }));
      assert.equal(first.recordedOrigin,first.origin);
      assert.equal(second.recordedOrigin,second.origin);
      return [first.origin,second.origin];
    }
    const results=[];
    for (const stage of stages) {
      const eight=await scenario(8,2,stage);
      const twentyFive=await scenario(25,1,stage);
      await reset();
      for (let i=0;i<16;i++) await seed("dominant","optimus",stage);
      for (let i=0;i<8;i++) await seed(`small_${i}`,"optimus",stage);
      const dominant=[];
      for (let i=0;i<16;i++) {
        dominant.push(...await round(1,stage));
        await seed("dominant","optimus",stage);
      }
      assert.equal(new Set(dominant.filter(item=>item.workspace.startsWith("small_"))
        .map(item=>item.workspace)).size,8);
      const optimusHeavy=await originScenario("optimus","clonador_grupos",stage);
      const clonadorHeavy=await originScenario("clonador_grupos","optimus",stage);
      await reset();
      await seed("only_clone","clonador_grupos",stage);
      const cloneOnly=(await round(1,stage))[0];
      assert.equal(cloneOnly.origin,"clonador_grupos");
      await reset();
      await seed("only_optimus","optimus",stage);
      assert.equal((await round(1,stage))[0].origin,"optimus");
      results.push({stage:stage.name,eight,twentyFive,dominantSmallReached:8,
        optimusHeavy,clonadorHeavy,cloneOnly:cloneOnly.origin});
    }
    const importerStage=stages[2];
    await reset();
    const ml=await seed("market_mix","optimus",importerStage,"mercadolivre");
    const shopee=await seed("market_mix","clonador_grupos",importerStage,"shopee");
    const interleaved=await round(2,importerStage);
    assert.deepEqual(new Set(interleaved.map(item=>item.id)),new Set([ml,shopee]));

    await reset();
    const future=await seed("retry_mix","optimus",importerStage,"mercadolivre",
      {afiliacaoWorkspaceRetry:{proximaTentativaEmMs:Date.now()+600000}});
    const due=await seed("retry_mix","clonador_grupos",importerStage,"mercadolivre",
      {afiliacaoWorkspaceRetry:{proximaTentativaEmMs:Date.now()-60000}});
    assert.equal((await round(1,importerStage))[0].id,due);
    assert.equal((await admin.query(`SELECT status FROM engine_jobs_cliente WHERE id=$1`,
      [future])).rows[0].status,"pronto_para_importar");
    await admin.query(`UPDATE engine_jobs_cliente SET metadata=jsonb_set(metadata,
      '{afiliacaoWorkspaceRetry,proximaTentativaEmMs}',to_jsonb($2::bigint),true)
      WHERE id=$1`,[future,Date.now()-1000]);
    assert.equal((await round(1,importerStage))[0].id,future);

    await reset();
    const normal20=await seed("normal20","optimus",importerStage,"mercadolivre",{},20);
    const normal35=await seed("normal35","optimus",importerStage,"mercadolivre",{},35);
    const turbo5=await seed("turbo5","optimus",importerStage,"mercadolivre",{cupomTurbo:true},5);
    const turbo15=await seed("turbo15","optimus",importerStage,"mercadolivre",{cupomTurbo:true},15);
    const manual=await seed("manual60","optimus",importerStage,"mercadolivre",{manualV2:true},60);
    const freshness=await round(3,importerStage);
    assert.deepEqual(new Set(freshness.map(item=>item.id)),new Set([normal20,turbo5,manual]));
    for (const id of [normal35,turbo15]) {
      assert.equal((await admin.query(`SELECT status FROM engine_jobs_cliente WHERE id=$1`,
        [id])).rows[0].status,"pronto_para_importar");
    }
    const steady=await runSteadyLifecycle({ pool,limit:2 });
    assert.equal(steady.ok,true);
    assert.equal(steady.selected,2);
    assert.deepEqual(new Set(steady.terminalized.map(item=>Number(item.id))),
      new Set([normal35,turbo15]));
    await reset();
    const transitionIds=[];
    for (const [workspace,origin] of [["ws_a","optimus"],["ws_a","clonador_grupos"],
      ["ws_b","clonador_grupos"],["ws_c","optimus"]]) {
      transitionIds.push(await seed(workspace,origin,stages[0]));
    }
    const transitions=[];
    for (const [stage,nextStatus] of [[stages[0],"diagnosticado"],
      [stages[1],"pronto_para_importar"],[stages[2],"oferta_criada"]]) {
      const claimed=await round(4,stage,nextStatus);
      assert.deepEqual(new Set(claimed.map(item=>item.id)),new Set(transitionIds));
      transitions.push({stage:stage.name,ids:claimed.map(item=>item.id)});
    }
    console.log(JSON.stringify({ candidate:"fairness_admission_three_stage",
      results,marketplaceInterleaved:[ml,shopee],retryDueBeforeFuture:true,
      freshnessNormalTurboManual:true,steadyExpired:steady.terminalized.length,
      selectorTransitions:transitions,
      hotUsed:(await admin.query(`SELECT hot_used
        FROM engine_hot_admission_control`)).rows[0].hot_used }));
  } finally {
    await pool?.end().catch(()=>{});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
