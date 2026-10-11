"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const root = path.join(__dirname,"..");
const schema = `uf_radar_clock_${crypto.randomBytes(6).toString("hex")}`;
const port = Number(process.env.UF_TEST_PG_PORT || 55433);
process.env.PGSSLMODE = "disable";
process.env.DATA_DIR = path.join(root,".local-test-tmp",schema);
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
const { projectionDdl, runSteadyLifecycle } =
  require("../modules/engine/lifecycle-steady.candidate");
const { criarHandlerRadarServidor } =
  require("./helpers/universal-flow-radar-server-handler");
const { avaliarFrescorPosClassificacaoCandidato } =
  require("../modules/engine/post-classification-freshness.candidate");
const { createMemoryTeleradarStore } =
  require("../modules/teleradar/checkpoint.repository");
const { createTeleRadarService } = require("../modules/teleradar");
const { createRadarIngressAdapter } =
  require("../modules/teleradar/radar-ingress.adapter");
const { extrairCodigosCupomSemanticos } =
  require("../modules/radar/cupom-semantico");
const config = {host:"127.0.0.1",port,user:"postgres",
  database:"optimus_universal_fixture",connectionTimeoutMillis:5000};

async function run(){
  const admin=new Client(config);
  let installed=false,pool;
  try{
    await admin.connect();
    const identity=(await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db,config.database);
    assert.equal(identity.host,config.host);
    assert.equal(identity.port,config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root,".local-postgres","data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);installed=true;
    await admin.query(`SET search_path TO ${schema},public`);
    for(const file of ["schema.sql","admission-gate.candidate.sql",
      "radar-replay.candidate.sql"]){
      await admin.query(fs.readFileSync(path.join(root,"modules","engine",file),"utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,25,0,'UNKNOWN',NULL,interval '5 minutes')`);
    fs.mkdirSync(process.env.DATA_DIR,{recursive:true});
    require("../utils/storage").writeGlobalJson("usuarios.json",
      [{id:"ws_alpha",ativo:true,plano:"pro"}]);
    require("../modules/workspace").avaliarWorkspaceParaEngine = id =>
      ({elegivelEngine:id==="ws_alpha"});
    const {getEnginePool}=require("../modules/engine/database");
    pool=getEnginePool();
    assert.equal((await runSteadyLifecycle({pool,limit:4})).ok,true);
    await admin.query(`UPDATE engine_hot_admission_control
      SET health='HEALTHY',lifecycle_last_success=now() WHERE id=1`);
    const {registrarEventoBruto}=require("../modules/engine/inbox.service");
    const handler=criarHandlerRadarServidor(input=>registrarEventoBruto(input,{
      clientes:["ws_alpha"],radarReplayCandidate:true,
      validarWorkspaceRadarCandidate:id=>id==="ws_alpha"}));
    const seconds=Math.floor(Date.now()/1000)-120;
    const t0=new Date(seconds*1000).toISOString();
    const urls=["https://www.amazon.com.br/dp/B012345678",
      "https://www.amazon.com.br/dp/B012345679",
      "https://www.amazon.com.br/dp/B012345680"];
    const common=url=>({sessaoId:"fixture",grupoNome:"Fixture",
      texto:`Oferta ${url}\nCupom: APP20`,linksCapturados:[url],aguardarAckEngine:true,
      origemAutorizadaInternamente:true});
    const wa=await handler({...common(urls[0]),origemTipo:"whatsapp",
      grupoId:"wa_clock_fixture",raw:{messageTimestamp:{toNumber:()=>seconds}}});
    const tele=await handler({...common(urls[1]),origemTipo:"telegram",
      grupoId:"tele_clock_fixture",fonte:"teleradar",capturadaEm:t0,
      raw:{message:{}}});
    assert.equal(wa.radarAccepted,true,JSON.stringify(wa));
    assert.equal(tele.radarAccepted,true,JSON.stringify(tele));
    const store=createMemoryTeleradarStore();
    let listener;
    let clockMs=Date.now()-180000;
    const clock=()=>new Date(clockMs);
    const telegramAccountService={
      async restore(){return {authorized:true};},
      async subscribeNewMessages({onMessage}){listener=onMessage;
        return async()=>{listener=null;};},
      async listParticipatingChats(){return [{chatKey:"-100123",chatId:"-100123",
        title:"Clock fixture",type:"channel",protectedContent:false}];},
      async disconnect(){}
    };
    const context={clientId:"admin",workspaceId:"workspace_admin",
      scope:"admin_master",feature:"teleradar",accountIdInterno:"telegram-admin-clock"};
    const commonTele={context,store,clock,telegramAccountService,
      solenoide:{avaliarOrigem:()=>({permitido:true})},
      handoffOptions:{setTimeoutFn:()=>({unref(){}}),clearTimeoutFn:()=>{}}};
    const first=createTeleRadarService({...commonTele,
      radarIngress:{accept:async()=>({accepted:false,durable:false,
        retryable:true,code:"hot_admission_denied"})}});
    await first.setMonitoringActive(true);
    await first.replaceSelectedSources(["-100123"]);
    await first.start();
    clockMs=Date.parse(t0);
    const update={accountId:"90071992547409931",chatId:"-100123",
      chatKey:"-100123",messageId:"991",senderId:"90071992547409932",
      receivedAt:new Date(clockMs+1000).toISOString(),telegramTimestamp:t0,
      text:`Oferta ${urls[2]}\nCupom: APP20`,textSource:"text",hasMedia:false,
      protectedContent:false,entities:[{type:"url",occurrence:0,offset:7,
        length:urls[2].length,label:urls[2],url:urls[2]}]};
    const captured=await listener(update);
    assert.equal(captured.accepted,true,JSON.stringify(captured));
    assert.equal(captured.handoffStatus,"pending");
    assert.equal(captured.envelope.capturedAt,t0);
    await first.stop();
    clockMs+=2000;
    const resumed=createTeleRadarService({...commonTele,
      radarIngress:createRadarIngressAdapter({processarMensagemRadar:handler})});
    await resumed.start();
    const recovered=(await resumed.getObservability());
    assert.equal(recovered.outbox.pending,0,JSON.stringify(recovered));
    assert.equal(recovered.activity.lastCapturedAt,t0);
    await resumed.stop();
    const noClock=await handler({...common(urls[0]),origemTipo:"telegram",
      grupoId:"missing_clock_fixture",raw:{message:{}}});
    assert.deepEqual(noClock,{ok:false,motivo:"captura_sem_tempo_factual"});
    const ids=[wa.radarEventId,tele.radarEventId];
    const facts=(await admin.query(`SELECT e.id,e.capturado_em,e.fonte,
      e.texto_original,
      j.id AS job_id,j.status FROM engine_eventos_brutos e
      JOIN engine_jobs_cliente j ON j.evento_id=e.id
      WHERE e.id=ANY($1::bigint[]) OR e.fonte='teleradar'
      ORDER BY e.id`,[ids])).rows;
    assert.equal(facts.length,3);
    assert(facts.every(row=>row.capturado_em.toISOString()===t0));
    const capturedCodes=facts.map(row=>extrairCodigosCupomSemanticos(
      row.texto_original));
    assert(capturedCodes.every(codes=>codes.length===1 && codes[0]==="APP20"));
    const {processarJobsPendentesEngine}=require("../modules/engine/processor.runner");
    const originalLog=console.log;
    let classified;
    try { console.log=()=>{};
      classified=await processarJobsPendentesEngine({limite:3,
        clientesValidos:["ws_alpha"],
        avaliarWorkspaceParaEngine:()=>({elegivelEngine:true})});
    } finally { console.log=originalLog; }
    assert.equal(classified.erros,0,JSON.stringify(classified));
    const after=(await admin.query(`SELECT j.id,j.status,e.capturado_em
      FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
      WHERE e.id=ANY($1::bigint[]) OR e.fonte='teleradar'`,[ids])).rows;
    assert(after.every(row=>row.status==="diagnosticado"));
    assert(after.every(row=>row.capturado_em.toISOString()===t0));
    const {validarJobsDiagnosticadosEngine}=require("../modules/engine/validator.runner");
    const validator=await validarJobsDiagnosticadosEngine({limite:3,
      clientesValidos:["ws_alpha"],
      avaliarWorkspaceParaEngine:()=>({elegivelEngine:true}),
      integracoesPorCliente:{ws_alpha:{amazon:{ativo:true,
        credenciais:{tag:"fixture-tag"}}}}});
    assert.equal(validator.pronto_para_importar,3,JSON.stringify(validator));
    const {importarJobsProntosEngine}=require("../modules/engine/importer/importer.runner");
    const originalLogImport=console.log;
    let imported;
    try { console.log=()=>{};
      imported=await importarJobsProntosEngine({limite:3,marketplace:"amazon",
        deps:{getIntegracaoCliente:()=>({ativo:true,
          credenciais:{tag:"fixture-tag"}}),
        importarAmazon:async url=>({
          titulo:`Produto Premium Cupom ${url.split("/").at(-1)}`,
          precoAtual:199.9,precoOriginal:249.9,
          imagem:"https://example.invalid/fixture-image.jpg",
          linkOriginal:url,linkAfiliado:`${url}?tag=fixture-tag`,
           categoria:"Eletronicos",cupom:capturedCodes[0][0],cupomTipo:"real"})}
      });
    } finally { console.log=originalLogImport; }
    assert.equal(imported.ofertaCriada,3,JSON.stringify(imported));
    const classifiedOffers=(await admin.query(`SELECT o.*,e.capturado_em AS evento_capturado_em,
      e.fonte AS evento_fonte,e.grupo_id FROM engine_ofertas o
      JOIN engine_eventos_brutos e ON e.id=o.evento_id
      WHERE e.id=ANY($1::bigint[]) OR e.fonte='teleradar'
      ORDER BY o.id`,[ids])).rows;
    assert.equal(classifiedOffers.length,3);
    console.log(JSON.stringify({candidate:"radar_importer_turbo_diagnostic",
      offers:classifiedOffers.map(row=>({cupom:row.cupom,tipoCupom:row.tipo_cupom,
        floor:row.metadata?.inteligenciaUniversalV2?.prioridadeMinimaCupom,
        turbo:row.metadata?.classificacaoTurboCandidata,
        captured:row.capturada_em,origin:row.evento_capturado_em}))}));
    assert(classifiedOffers.every(row=>row.capturada_em.toISOString()===t0 &&
      row.evento_capturado_em.toISOString()===t0 &&
      row.tipo_cupom==="real" &&
      Number(row.metadata?.inteligenciaUniversalV2?.prioridadeMinimaCupom)>=95 &&
      row.metadata?.classificacaoTurboCandidata?.ancora===
        "codigo_alfanumerico_valido"));
    const lateDecisions=classifiedOffers.map(row=>
      avaliarFrescorPosClassificacaoCandidato(row,Date.parse(t0)+15*60000));
    assert(lateDecisions.every(row=>row.tipoFluxo==="cupom_turbo" &&
      row.ok===false && row.motivo==="captura_expirada_pos_classificacao"));
    console.log(JSON.stringify({candidate:"radar_server_engine_capture_clock",
      handlerActualSource:true,serverBootstrap:false,
      sources:["radar_whatsapp","teleradar"],events:facts.length,
      jobs:after.length,processorClassified:after.length,t0,
      teleRadarRestartRetry:true,missingClockRejected:true,
       realImporterCouponFloor:true,
       lateTypes:lateDecisions.map(row=>row.tipoFluxo),
       lateBlocked:lateDecisions.every(row=>row.ok===false)}));
  }finally{
    if(pool)await pool.end().catch(()=>{});
    if(installed)await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
