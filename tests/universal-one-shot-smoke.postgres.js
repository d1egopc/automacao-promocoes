"use strict";

// Disposable PostgreSQL 17 only. Never reads DATABASE_URL or production env.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const localDataRoot=fs.mkdtempSync(path.join(__dirname,"..",
  ".local-test-tmp","one-shot-data-"));
process.env.DATA_DIR=localDataRoot;
const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json",[{id:"user_pss60lus",ativo:true,
  plano:"pro"}]);
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const { criarExecutorFilaUniversal } =
  require("../modules/engine/universal-queue-executor.adapter");
const { criarDispatcherProviderExistentePorAlvo } =
  require("../modules/engine/universal-target-provider-bridge");
const { consultarHistoricoValidacaoCutover } =
  require("../modules/engine/universal-history.read-model");
const { reservaPostgres } =
  require("../modules/manual-v2/ofertas-v2-envio-claim");
const distributor = require("../modules/engine/distributor/distributor.service");
const { criarHandlerRadarServidor } =
  require("./helpers/universal-flow-radar-server-handler");
const normalQueue = require("../modules/engine/universal-queue.repository");
const { armOneShot, bindRadarOfferOneShot, readOneShot,
  oneShotRepository, activeOneShot,
  smokeCreditAvailable } =
  require("../modules/engine/universal-one-shot-smoke");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspace = "user_pss60lus";
const sourceSessionId = "controlled_session";
const sourceGroupJid = "controlled_source@g.us";

function armArgs(destinationId, targetKey) {
  return { workspaceId:workspace,destinationId,targetKey,
    channel:"whatsapp",sourceSessionId,sourceGroupJid };
}

function destinationFor(gate) {
  return {id:gate.destinationId,tipo:"whatsapp",
    grupo:gate.targetKey};
}

function bindFor(pool,gate,real,itemPayload=real.payload) {
  return bindRadarOfferOneShot({pool,offer:real.offer,itemPayload,
    compatibleDestinations:[destinationFor(gate)]});
}

async function realRadarOffer(admin,{source="radar",session=sourceSessionId,
  group=sourceGroupJid,capturedAt=null,title="Oferta real"}={}) {
  const event=(await admin.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,origem_tipo,sessao_id,grupo_id,texto_original,
     links_extraidos,metadata,capturado_em)
    VALUES ('radar',$1,'whatsapp',$2,$3,$4,
      '["https://example.test/real"]'::jsonb,
      jsonb_build_object('fonteCaptura',$1::text),
      COALESCE($5::timestamptz,clock_timestamp()))
    RETURNING id,capturado_em`,[source,session,group,title,capturedAt])).rows[0];
  const offer=(await admin.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status,titulo,imagem,link_afiliado,capturada_em)
    VALUES ($1,'radar','distribuindo',$2,
      'https://example.test/real.jpg','https://example.test/real',$3)
    RETURNING id`,[event.id,title,event.capturado_em])).rows[0];
  const job=(await admin.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status)
    VALUES ($1,$2,$3,'importado') RETURNING id`,
  [event.id,offer.id,workspace])).rows[0];
  const payload={titulo:title,imagem:"https://example.test/real.jpg",
    imagemEnviavel:true,
    linkAfiliado:"https://example.test/real",origem:"radar"};
  return { eventId:event.id,jobId:job.id,offerId:offer.id,
    offer:{id:offer.id,job_id:job.id,cliente_id:workspace,
      evento_id:event.id,marketplace:"shopee",titulo:title,
      imagem:"https://example.test/real.jpg",categoria:"geral",preco:42,
      status:"distribuindo",link_original:"https://example.test/real",
      link_afiliado:"https://example.test/real"},payload };
}

async function armAndBind(admin,pool,destinationId,targetKey,title="Oferta real") {
  const armed=await armOneShot({pool,...armArgs(destinationId,targetKey)});
  const real=await realRadarOffer(admin,{title});
  const bound=await bindFor(pool,armed,real);
  assert.equal(bound.bound,true);
  return {...armed,...bound,destinationId,targetKey};
}

async function fixture(admin,{ prepared = true } = {}) {
  const schema=`uf_one_shot_${crypto.randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query(fs.readFileSync(path.join(root,"modules","engine",
    "schema.sql"),"utf8"));
  for (const sql of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(sql);
  await prepararModoOperacionalReal({pool:admin});
  await prepararModoOperacionalReal({pool:admin});
  if (prepared) await admin.query(`UPDATE engine_operation_state
    SET mode='CUTOVER_PREPARED' WHERE id=1`);
  const pool=new Pool({...config,max:5,
    options:`-c search_path=${schema},public`});
  return {schema,pool};
}

async function ack(client, claim, messageId) {
  const attempt = crypto.randomUUID();
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id,`universal_${claim.queue_item_id}`,
    `whatsapp:${claim.destination_id}`,`grupo:${claim.target_key}`,
    attempt,messageId]);
  return attempt;
}

async function main() {
  const admin = new Client(config);
  let pool;
  const fixtures=[];
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir,
      current_setting('server_version_num')::int AS version`)).rows[0];
    assert.equal(identity.db,config.database);
    assert.equal(identity.host,config.host);
    assert.equal(identity.port,config.port);
    assert.ok(identity.version>=170000 && identity.version<180000);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root,".local-postgres","data").toLowerCase());
    const first=await fixture(admin,{prepared:false});
    fixtures.push(first);pool=first.pool;
    const spentIndex=(await admin.query(`SELECT indexdef FROM pg_indexes
      WHERE schemaname=current_schema()
        AND indexname='engine_uq_one_shot_spent_once_idx'`)).rows[0];
    assert.match(spentIndex?.indexdef || "",/CREATE UNIQUE INDEX/);
    assert.match(spentIndex?.indexdef || "",/provider_call_count = 1/);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_one_shot_smoke`)).rows[0].n,0);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_one_shot_trigger`)).rows[0].n,0);
    const triggerFk=(await admin.query(`SELECT count(*)::int AS n
      FROM pg_constraint WHERE conrelid=
        'engine_universal_one_shot_trigger'::regclass
        AND confrelid='engine_universal_one_shot_smoke'::regclass
        AND contype='f'`)).rows[0].n;
    assert.equal(triggerFk,1);
    assert.equal(await admin.query(`INSERT INTO engine_universal_one_shot_trigger
      (id,source_type,source_session_id,source_group_jid)
      VALUES ($1,'radar',$2,$3)`,[crypto.randomUUID(),sourceSessionId,
      sourceGroupJid]).then(()=>"allowed",error=>error.code),"23503");
    assert.equal((await admin.query(`SELECT column_default FROM information_schema.columns
      WHERE table_schema=current_schema()
        AND table_name='engine_universal_one_shot_smoke'
        AND column_name='state'`)).rows[0].column_default,null);
    assert.equal(await armOneShot({pool,...armArgs("pre_mode_dest","pre_mode_target")})
      .then(()=>"allowed",error=>error.message),
    "smoke_requires_prepared_without_epoch");
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    assert.equal((await normalQueue.claimDestination({pool,
      workspaceId:workspace}).catch(error=>error.message)),
    "universal_mode_not_active");
    assert.equal((await armOneShot({pool,workspaceId:"ws_other",
      destinationId:"d",targetKey:"t",channel:"whatsapp",
      sourceSessionId,sourceGroupJid}).catch(error=>error.message)),
    "smoke_arm_identity_invalid");
    const armed=await armOneShot({pool,...armArgs(
      "controlled_destination","controlled_target")});
    assert.equal(armed.state,"armed_waiting_trigger");
    assert.equal(armed.eventId,null);
    const waitingGate=(await admin.query(`SELECT state,binding_state,
      queue_item_id,queue_destination_id,provider_call_count
      FROM engine_universal_one_shot_smoke WHERE id=$1`,[armed.id])).rows[0];
    assert.equal(waitingGate.state,"armed");
    assert.equal(waitingGate.binding_state,"waiting");
    assert.equal(waitingGate.queue_item_id,null);
    assert.equal(waitingGate.queue_destination_id,null);
    assert.equal(Number(waitingGate.provider_call_count),0);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_one_shot_trigger WHERE id=$1`,
    [armed.id])).rows[0].n,1);
    assert.equal(await admin.query(`UPDATE engine_universal_one_shot_smoke
      SET binding_state='bound' WHERE id=$1`,[armed.id])
      .then(()=>"allowed",error=>error.code),"23514");
    assert.equal(await admin.query(`UPDATE engine_universal_one_shot_smoke
      SET state='claimed' WHERE id=$1`,[armed.id])
      .then(()=>"allowed",error=>error.code),"23514");
    assert.equal((await readOneShot({pool,id:armed.id})).state,
      "armed_waiting_trigger");
    assert.equal((await activeOneShot({pool})),null);
    assert.equal(await oneShotRepository(armed.id).claimDestination({pool,
      workspaceId:workspace}).then(()=>"allowed",error=>error.message),
    "smoke_gate_not_armed");
    assert.equal(await smokeCreditAvailable({pool,id:armed.id,
      workspaceId:workspace,destinationId:armed.destinationId,
      targetKey:armed.targetKey,queueItemId:null}),false);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_items`)).rows[0].n,0);
    for (const table of ["engine_eventos_brutos","engine_ofertas",
      "engine_jobs_cliente"]) {
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${table}`))
        .rows[0].n,0);
    }
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations`)).rows[0].n,0);
    await new Promise(resolve=>setTimeout(resolve,30100));
    assert.equal((await activeOneShot({pool})),null);
    const restartedPool=new Pool({...config,max:2,
      options:`-c search_path=${first.schema},public`});
    assert.equal((await readOneShot({pool:restartedPool,id:armed.id})).state,
      "armed_waiting_trigger");
    await restartedPool.end();
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations`)).rows[0].n,0);
    const wrong=await realRadarOffer(admin,{group:"wrong_source@g.us"});
    assert.equal((await bindFor(pool,armed,wrong)).bound,false);
    const otherSession=await realRadarOffer(admin,{session:"other_session"});
    assert.equal((await bindFor(pool,armed,otherSession)).bound,false);
    const tele=await realRadarOffer(admin,{source:"teleradar"});
    assert.equal((await bindFor(pool,armed,tele)).bound,false);
    const old=await realRadarOffer(admin,{capturedAt:new Date(
      new Date(armed.armedAt).getTime()-1000).toISOString()});
    assert.equal((await bindFor(pool,armed,old)).bound,false);
    const invalid=await realRadarOffer(admin,{});
    assert.equal((await bindFor(pool,armed,invalid,
      {...invalid.payload,imagem:""})).bound,false);
    assert.equal((await bindFor(pool,armed,invalid,
      {...invalid.payload,imagemEnviavel:false})).bound,false);
    assert.equal((await bindRadarOfferOneShot({pool,
      offer:{...invalid.offer,link_afiliado:""},
      itemPayload:invalid.payload,
      compatibleDestinations:[destinationFor(armed)]})).bound,false);
    assert.equal((await bindRadarOfferOneShot({pool,offer:invalid.offer,
      itemPayload:invalid.payload,
      compatibleDestinations:[{...destinationFor(armed),
        grupo:"another_target"}]})).bound,false);
    let real=null;
    const radarHandler=criarHandlerRadarServidor(async input=>{
      assert.equal(input.origem,"radar");
      assert.equal(input.metadata?.fonteCaptura,"radar");
      assert.equal(input.sessaoId,sourceSessionId);
      assert.equal(input.grupoId,sourceGroupJid);
      real=await realRadarOffer(admin,{
        session:input.sessaoId,group:input.grupoId,
        capturedAt:input.capturadoEm,title:"Oferta Radar do usuário"});
      return {ok:true,id:real.eventId};
    });
    const seconds=Math.floor(Date.now()/1000);
    const capture=await radarHandler({origemTipo:"whatsapp",
      sessaoId:sourceSessionId,grupoId:sourceGroupJid,
      texto:"Oferta Radar do usuário https://www.amazon.com.br/dp/B012345678",
      linksCapturados:["https://www.amazon.com.br/dp/B012345678"],
      raw:{messageTimestamp:{toNumber:()=>seconds}},
      aguardarAckEngine:true,origemAutorizadaInternamente:true});
    assert.equal(capture.radarAccepted,true);
    assert.ok(real);
    let legacyWrites=0;
    const distributeReal=()=>distributor.adicionarOfertaNaFilaCliente(real.offer,{
      destinosCompativeisImagem:[destinationFor(armed)],
      deps:{oneShotPool:pool,adicionarOfertaNaFilaGlobal:async()=>{
        legacyWrites+=1;return {ok:true};
      }}
    });
    const [distributed,concurrentSame]=await Promise.all([
      distributeReal(),distributeReal()]);
    assert.equal(distributed.oneShotBound,true);
    assert.equal(concurrentSame.oneShotBound,true);
    assert.equal([distributed,concurrentSame].filter(item=>
      item.smokeBinding.alreadyBound === true).length,1);
    assert.equal(legacyWrites,0);
    const bound=distributed.smokeBinding;
    const sameOfferAgain=await distributeReal();
    assert.equal(sameOfferAgain.oneShotBound,true);
    assert.equal(sameOfferAgain.smokeBinding.alreadyBound,true);
    assert.equal(legacyWrites,0);
    const gate={...armed,...bound,
      destinationId:"controlled_destination",targetKey:"controlled_target"};
    assert.equal((await activeOneShot({pool})).id,gate.id);
    const boundGate=(await admin.query(`SELECT state,binding_state,
      queue_item_id,queue_destination_id,provider_call_count
      FROM engine_universal_one_shot_smoke WHERE id=$1`,[gate.id])).rows[0];
    assert.equal(boundGate.binding_state,"bound");
    assert.ok(boundGate.queue_item_id);
    assert.ok(boundGate.queue_destination_id);
    assert.equal(Number(boundGate.provider_call_count),0);
    assert.equal(await admin.query(`UPDATE engine_universal_one_shot_smoke
      SET queue_destination_id=NULL WHERE id=$1`,[gate.id])
      .then(()=>"allowed",error=>error.code),"23514");
    assert.equal(String((await readOneShot({pool,id:gate.id})).boundEventId),
      String(real.eventId));
    assert.equal(new Date((await admin.query(`SELECT capture_t0 FROM
      engine_universal_one_shot_trigger WHERE id=$1`,[gate.id]))
      .rows[0].capture_t0).toISOString(),
    new Date((await admin.query(`SELECT capturado_em FROM
      engine_eventos_brutos WHERE id=$1`,[real.eventId]))
      .rows[0].capturado_em).toISOString());
    const reboundPool=new Pool({...config,max:2,
      options:`-c search_path=${first.schema},public`});
    assert.equal(String((await readOneShot({pool:reboundPool,
      id:gate.id})).boundEventId),String(real.eventId));
    await reboundPool.end();
    const afterBinding=await realRadarOffer(admin,{title:"Segunda captura"});
    assert.equal((await bindFor(pool,armed,afterBinding)).bound,false);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations`)).rows[0].n,1);
    const source = (await admin.query(`SELECT j.status AS job_status,
      o.status AS offer_status,e.capturado_em,i.capturado_em AS queue_t0,
      i.item_payload
      FROM engine_jobs_cliente j JOIN engine_ofertas o ON o.id=j.oferta_id
      JOIN engine_eventos_brutos e ON e.id=j.evento_id
      JOIN engine_universal_queue_items i ON i.job_id=j.id
      WHERE j.id=$1`,[gate.jobId])).rows[0];
    assert.equal(source.job_status,"cutover_validation");
    assert.equal(source.offer_status,"cutover_validation");
    assert.equal((await admin.query(`UPDATE engine_ofertas
      SET status='distribuindo' WHERE id=$1
        AND status IN ('importada','oferta_criada') RETURNING id`,
    [gate.offerId])).rowCount,0);
    assert.equal(source.item_payload.titulo,"Oferta Radar do usuário");
    assert.equal(source.item_payload.linkAfiliado,"https://example.test/real");
    assert.equal(new Date(source.capturado_em).toISOString(),
      new Date(source.queue_t0).toISOString());
    assert.equal((await admin.query(`SELECT 1 FROM engine_jobs_cliente
      WHERE id=$1 AND status='pendente'`,[gate.jobId])).rowCount,0);
    assert.equal((await admin.query(`SELECT 1 FROM engine_jobs_cliente
      WHERE id=$1 AND status='validacao_ok'`,[gate.jobId])).rowCount,0);
    assert.equal((await admin.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1`)).rows[0]
      .operation_epoch_started_at,null);
    const repo=oneShotRepository(gate.id);
    assert.equal(await repo.preflightWorkspace({pool,workspaceId:"ws_other"})
      .then(()=>"allowed",error=>error.message),"smoke_identity_mismatch");
    assert.equal(await repo.claimDestination({pool,workspaceId:workspace})
      .then(()=>"allowed",error=>error.message),
    "smoke_workspace_preflight_required");
    assert.equal((await repo.preflightWorkspace({pool,workspaceId:workspace})).ok,true);
    const before = await repo.claimDestination({pool,workspaceId:workspace,
      leaseMs:30000});
    assert.equal(before.empty,false);
    const ownerIdentity={ownerId:before.fanout_owner_id,
      clienteId:workspace,destinoId:gate.destinationId,
      targetId:before.id,leaseToken:before.leaseToken};
    const reservation=reservaPostgres();
    assert.equal(await reservation.carregarOwnerTarget(admin,ownerIdentity),null);
    assert.ok(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,smokeGateId:gate.id}));
    assert.equal(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,smokeGateId:crypto.randomUUID()}),null);
    assert.equal(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,destinoId:"other_dest",smokeGateId:gate.id}),null);
    assert.equal(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,clienteId:"ws_other",smokeGateId:gate.id}),null);
    const creditIdentity={pool,id:gate.id,workspaceId:workspace,
      destinationId:gate.destinationId,targetKey:gate.targetKey,
      queueItemId:gate.queueItemId};
    assert.equal(await smokeCreditAvailable(creditIdentity),true);
    assert.equal(await smokeCreditAvailable({...creditIdentity,
      workspaceId:"ws_other"}),false);
    assert.equal(await smokeCreditAvailable({...creditIdentity,
      destinationId:"other_dest"}),false);
    assert.equal(await smokeCreditAvailable({...creditIdentity,
      targetKey:"other_target"}),false);
    assert.equal(await repo.markSendStarted({pool,
      destinationId:Number(before.id)+1,leaseToken:before.leaseToken})
      .then(()=>"allowed",error=>error.message),"smoke_identity_mismatch");
    assert.equal((await readOneShot({pool,id:gate.id})).providerCallCount,0);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second'
      WHERE id=$1`,[before.id]);
    assert.equal((await repo.preflightWorkspace({pool,
      workspaceId:workspace})).ok,true);
    assert.equal((await readOneShot({pool,id:gate.id})).providerCallCount,0);
    let providerCalls=0;
    const provider=criarDispatcherProviderExistentePorAlvo({
      resolveConfigCliente:()=>({}),
      send:async (_d,_o,_m,_w,_c,options)=>{
        await assert.rejects(options.beforeUniversalProvider({
          canal:"whatsapp",alvo:{grupoId:"other_target"}}),
        /universal_provider_target_identity_mismatch/);
        await assert.rejects(options.beforeUniversalProvider({
          canal:"discord",alvo:{channelId:"controlled_target"}}),
        /universal_provider_target_identity_mismatch/);
        assert.equal(providerCalls,0);
        await options.beforeUniversalProvider({canal:"whatsapp",
          alvo:{grupoId:"controlled_target"}});
        assert.equal(await smokeCreditAvailable(creditIdentity),true);
        providerCalls+=1;
        const current=(await admin.query(`SELECT d.id,d.queue_item_id,
          d.workspace_id,d.destination_id,d.target_key,d.channel
          FROM engine_universal_queue_destinations d WHERE d.id=$1`,
        [gate.queueDestinationId])).rows[0];
        const attempt=await ack(admin,current,"provider_one_shot_1");
        options.onUniversalTargetCheckpoint({canal:"whatsapp",
          alvo:{grupoId:"controlled_target"},checkpoint:{ok:true,
            resposta:{key:{id:"provider_one_shot_1"}},
            contexto:{estado:"enviado",attemptId:attempt}}});
        await assert.rejects(options.beforeUniversalProvider({
          canal:"whatsapp",alvo:{grupoId:"controlled_target"}}),
        /smoke_provider_call_budget_exhausted/);
        return {enviado:true,tentouEnvio:true};
      }
    });
    const run=criarExecutorFilaUniversal({pool,repository:repo,oneShot:true,
      prepare:async()=>({ready:true,destination:{id:"controlled_destination"},
        oferta:{titulo:"Oferta controlada"},
        rendered:{message:"fixture controlada"}}),
      dispatch:(claim,prepared,context)=>provider(claim,prepared,context)});
    const sent=await run(workspace);
    assert.equal(sent.ok,true);
    assert.equal(providerCalls,1);
    const result=await readOneShot({pool,id:gate.id});
    assert.equal(result.state,"completed");
    assert.equal(result.providerCallCount,1);
    assert.equal(result.historyFact.kind,"CUTOVER_VALIDATION");
    assert.equal(result.historyFact.resultadoFinalPublico,"enviada");
    assert.equal(result.historyFact.creditDebits,1);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      engine_universal_credit_balances WHERE workspace_id='ws_other'`))
      .rows[0].n,0);
    const history=await consultarHistoricoValidacaoCutover({pool,
      gateId:gate.id,workspaceId:workspace});
    assert.equal(history.kind,"CUTOVER_VALIDATION");
    assert.equal(history.resultadoFinalPublico,"enviada");
    assert.equal(history.destino.providerMessageId,"provider_one_shot_1");
    assert.equal(history.destino.creditDebited,true);
    assert.equal(await consultarHistoricoValidacaoCutover({pool,
      gateId:gate.id,workspaceId:"ws_other"}),null);
    assert.equal(await smokeCreditAvailable(creditIdentity),false);
    assert.equal((await run(workspace)).reason,"smoke_already_completed");
    assert.equal(providerCalls,1);
    assert.equal((await admin.query(`SELECT balance,reserved FROM
      engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2`,[gate.smokeEpochAt,workspace])).rows[0].balance,0);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      engine_universal_vitrine_outbox WHERE queue_item_id=$1`,
    [gate.queueItemId])).rows[0].n,0);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      engine_history_items WHERE universal_item_id=$1`,
    [gate.queueItemId])).rows[0].n,0,
    "one-shot smoke não entra no Histórico comercial");
    assert.equal((await admin.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1`)).rows[0].mode,
    "CUTOVER_PREPARED");
    assert.equal((await activeOneShot({pool})),null);
    assert.equal(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,smokeGateId:gate.id}),null);
    assert.equal(await armOneShot({pool,...armArgs(
      "forbidden_after_call","forbidden_target")})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    const expiringFixture=await fixture(admin);
    fixtures.push(expiringFixture);pool=expiringFixture.pool;
    const expiring=await armAndBind(admin,pool,"expire_dest","expire_target",
      "Expirando");
    const expiringRepo=oneShotRepository(expiring.id);
    assert.equal((await expiringRepo.preflightWorkspace({pool,
      workspaceId:workspace})).ok,true);
    const expiringClaim=await expiringRepo.claimDestination({pool,
      workspaceId:workspace});
    await admin.query(`UPDATE engine_universal_one_shot_smoke
      SET created_at=clock_timestamp()-interval '2 minutes',
        expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [expiring.id]);
    assert.equal(await reservation.carregarOwnerTarget(admin,{
      ownerId:expiringClaim.fanout_owner_id,clienteId:workspace,
      destinoId:expiring.destinationId,targetId:expiringClaim.id,
      leaseToken:expiringClaim.leaseToken,smokeGateId:expiring.id}),null);
    assert.equal((await expiringRepo.preflightWorkspace({pool,
      workspaceId:workspace})).reason,"smoke_gate_expired");
    assert.equal((await readOneShot({pool,id:expiring.id})).state,"expired");
    assert.equal(providerCalls,1);
    const ackFixture=await fixture(admin);
    fixtures.push(ackFixture);pool=ackFixture.pool;
    const afterAck=await armAndBind(admin,pool,"ack_dest","ack_target",
      "Crash apos ACK");
    const ackRepo=oneShotRepository(afterAck.id);
    assert.equal((await ackRepo.preflightWorkspace({pool,
      workspaceId:workspace})).ok,true);
    const ackClaim=await ackRepo.claimDestination({pool,workspaceId:workspace});
    assert.equal((await ackRepo.markSendStarted({pool,
      destinationId:ackClaim.id,leaseToken:ackClaim.leaseToken})).ok,true);
    // Even if a stale observer were to misclassify the target as claimed,
    // the consumed gate alone must deny a new commercial reservation.
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET status='claimed' WHERE id=$1`,[ackClaim.id]);
    assert.equal(await reservation.carregarOwnerTarget(admin,{
      ownerId:ackClaim.fanout_owner_id,clienteId:workspace,
      destinoId:afterAck.destinationId,targetId:ackClaim.id,
      leaseToken:ackClaim.leaseToken,smokeGateId:afterAck.id}),null);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET status='send_started' WHERE id=$1`,[ackClaim.id]);
    await ack(admin,ackClaim,"provider_ack_before_crash");
    const recovered=await oneShotRepository(afterAck.id)
      .preflightWorkspace({pool,workspaceId:workspace});
    assert.equal(recovered.recoveredAcks,1);
    const afterAckState=await readOneShot({pool,id:afterAck.id});
    assert.equal(afterAckState.state,"completed");
    assert.equal(afterAckState.providerCallCount,1);
    assert.equal(afterAckState.historyFact.creditDebits,1);
    assert.equal((await oneShotRepository(afterAck.id)
      .preflightWorkspace({pool,workspaceId:workspace})).recoveredAcks,1);
    assert.equal((await readOneShot({pool,id:afterAck.id}))
      .historyFact.creditDebits,1);
    assert.equal(providerCalls,1);
    assert.equal(await armOneShot({pool,...armArgs(
      "forbidden_after_ack","forbidden_target")})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    const ambiguousFixture=await fixture(admin);
    fixtures.push(ambiguousFixture);pool=ambiguousFixture.pool;
    const ambiguous=await armAndBind(admin,pool,"ambiguous_dest",
      "ambiguous_target","ACK ausente");
    const ambiguousRepo=oneShotRepository(ambiguous.id);
    assert.equal((await ambiguousRepo.preflightWorkspace({pool,
      workspaceId:workspace})).ok,true);
    const ambiguousClaim=await ambiguousRepo.claimDestination({pool,
      workspaceId:workspace});
    await ambiguousRepo.markSendStarted({pool,
      destinationId:ambiguousClaim.id,leaseToken:ambiguousClaim.leaseToken});
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second'
      WHERE id=$1`,[ambiguousClaim.id]);
    const failedClosed=await oneShotRepository(ambiguous.id)
      .preflightWorkspace({pool,workspaceId:workspace});
    assert.equal(failedClosed.reason,"smoke_provider_result_ambiguous");
    assert.equal((await readOneShot({pool,id:ambiguous.id})).target.status,
      "ambiguous");
    assert.equal((await readOneShot({pool,id:ambiguous.id})).state,
      "consumed");
    assert.equal(await ambiguousRepo.claimDestination({pool,
      workspaceId:workspace}).then(()=>"allowed",error=>error.message),
    "smoke_gate_not_armed");
    assert.equal(await armOneShot({pool,...armArgs(
      "second_dest","second_target")})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    assert.equal(providerCalls,1);
    await ack(admin,ambiguousClaim,"provider_late_ack");
    assert.equal((await ambiguousRepo.preflightWorkspace({pool,
      workspaceId:workspace})).recoveredAcks,1);
    assert.equal((await readOneShot({pool,id:ambiguous.id})).state,
      "completed");
    assert.equal((await readOneShot({pool,id:ambiguous.id}))
      .historyFact.creditDebits,1);
    assert.equal(await armOneShot({pool,...armArgs(
      "forbidden_after_late_ack","forbidden_target")})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    const waitingFixture=await fixture(admin);
    fixtures.push(waitingFixture);pool=waitingFixture.pool;
    const waiting=await armOneShot({pool,...armArgs(
      "waiting_dest","waiting_target")});
    assert.equal((await activeOneShot({pool})),null);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_one_shot_smoke`)).rows[0].n,1);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_items`)).rows[0].n,0);
    await admin.query(`UPDATE engine_universal_one_shot_smoke
      SET smoke_epoch_at=clock_timestamp()-interval '3 minutes',
        created_at=clock_timestamp()-interval '3 minutes',
        expires_at=clock_timestamp()-interval '1 second'
      WHERE id=$1`,[waiting.id]);
    assert.equal((await activeOneShot({pool})),null);
    assert.equal((await admin.query(`SELECT state FROM
      engine_universal_one_shot_smoke WHERE id=$1`,[waiting.id]))
      .rows[0].state,"expired");
    const late=await realRadarOffer(admin,{});
    assert.equal((await bindFor(pool,waiting,late)).bound,false);
    assert.equal((await admin.query(`SELECT state FROM
      engine_universal_one_shot_smoke WHERE id=$1`,[waiting.id]))
      .rows[0].state,"expired");
    assert.equal((await readOneShot({pool,id:waiting.id})).providerCallCount,0);
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations`)).rows[0].n,0);
    const raceFixture=await fixture(admin);
    fixtures.push(raceFixture);pool=raceFixture.pool;
    const race=await armOneShot({pool,...armArgs(
      "race_dest","race_target")});
    const firstRace=await realRadarOffer(admin,{title:"Primeira real"});
    const secondRace=await realRadarOffer(admin,{title:"Segunda real"});
    const bindings=await Promise.all([firstRace,secondRace].map(item=>
      bindFor(pool,race,item)));
    assert.equal(bindings.filter(item=>item.bound).length,1);
    const winner=bindings[0].bound?firstRace:secondRace;
    const loser=bindings[0].bound?secondRace:firstRace;
    assert.equal((await admin.query(`SELECT bound_event_id FROM
      engine_universal_one_shot_trigger WHERE id=$1`,[race.id]))
      .rows[0].bound_event_id,String(winner.eventId));
    assert.equal((await admin.query(`SELECT status FROM engine_ofertas
      WHERE id=$1`,[winner.offerId])).rows[0].status,
    "cutover_validation");
    assert.equal((await admin.query(`SELECT status FROM engine_ofertas
      WHERE id=$1`,[loser.offerId])).rows[0].status,"distribuindo");
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations`)).rows[0].n,1);
    console.log("ONE_SHOT_POSTGRES17_PASS",JSON.stringify({
      version:identity.version,providerCalls,gate:result.state,
      history:result.historyFact.resultadoFinalPublico,
      creditDebits:result.historyFact.creditDebits,
      globalEpoch:null,expiredGate:"expired",recoveredAck:true,
      ambiguousFailClosed:true}));
  } finally {
    for (const item of fixtures) await item.pool.end();
    for (const item of fixtures) {
      await admin.query(`DROP SCHEMA ${item.schema} CASCADE`);
    }
    await admin.end().catch(()=>{});
    fs.rmSync(localDataRoot,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error("ONE_SHOT_POSTGRES17_FAIL",
  error?.code || error?.message,error?.constraint || "",
  error?.stack || error?.message || "");process.exitCode=1;});
