"use strict";

// Disposable PostgreSQL 17 only. Never reads DATABASE_URL or production env.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
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
const normalQueue = require("../modules/engine/universal-queue.repository");
const { armOneShot, readOneShot, oneShotRepository, activeOneShot,
  smokeCreditAvailable } =
  require("../modules/engine/universal-one-shot-smoke");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspace = "user_pss60lus";

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
    assert.equal(await armOneShot({pool,workspaceId:workspace,
      destinationId:"pre_mode_dest",targetKey:"pre_mode_target",
      channel:"whatsapp",itemPayload:{titulo:"Antes PREPARED"}})
      .then(()=>"allowed",error=>error.message),
    "smoke_requires_prepared_without_epoch");
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    assert.equal((await normalQueue.claimDestination({pool,
      workspaceId:workspace}).catch(error=>error.message)),
    "universal_mode_not_active");
    assert.equal((await armOneShot({pool,workspaceId:"ws_other",
      destinationId:"d",targetKey:"t",channel:"whatsapp",
      itemPayload:{titulo:"x"}}).catch(error=>error.message)),
    "smoke_arm_identity_invalid");
    const gate = await armOneShot({pool,workspaceId:workspace,
      destinationId:"controlled_destination",targetKey:"controlled_target",
      channel:"whatsapp",itemPayload:{titulo:"Oferta controlada",
        linkAfiliado:"https://example.test/controlled"}});
    assert.equal((await activeOneShot({pool})).id,gate.id);
    const source = (await admin.query(`SELECT j.status AS job_status,
      o.status AS offer_status,e.capturado_em,i.capturado_em AS queue_t0
      FROM engine_jobs_cliente j JOIN engine_ofertas o ON o.id=j.oferta_id
      JOIN engine_eventos_brutos e ON e.id=j.evento_id
      JOIN engine_universal_queue_items i ON i.job_id=j.id
      WHERE j.id=$1`,[gate.jobId])).rows[0];
    assert.equal(source.job_status,"cutover_validation");
    assert.equal(source.offer_status,"cutover_validation");
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
      leaseMs:1000});
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
    assert.equal((await admin.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1`)).rows[0].mode,
    "CUTOVER_PREPARED");
    assert.equal((await activeOneShot({pool})),null);
    assert.equal(await reservation.carregarOwnerTarget(admin,
      {...ownerIdentity,smokeGateId:gate.id}),null);
    assert.equal(await armOneShot({pool,workspaceId:workspace,
      destinationId:"forbidden_after_call",targetKey:"forbidden_target",
      channel:"whatsapp",itemPayload:{titulo:"Nao rearmar"}})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    const expiringFixture=await fixture(admin);
    fixtures.push(expiringFixture);pool=expiringFixture.pool;
    const expiring=await armOneShot({pool,workspaceId:workspace,
      destinationId:"expire_dest",targetKey:"expire_target",channel:"whatsapp",
      itemPayload:{titulo:"Expirando"}});
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
    const afterAck=await armOneShot({pool,workspaceId:workspace,
      destinationId:"ack_dest",targetKey:"ack_target",channel:"whatsapp",
      itemPayload:{titulo:"Crash apos ACK"}});
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
    assert.equal(await armOneShot({pool,workspaceId:workspace,
      destinationId:"forbidden_after_ack",targetKey:"forbidden_target",
      channel:"whatsapp",itemPayload:{titulo:"Nao rearmar ACK"}})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
    const ambiguousFixture=await fixture(admin);
    fixtures.push(ambiguousFixture);pool=ambiguousFixture.pool;
    const ambiguous=await armOneShot({pool,workspaceId:workspace,
      destinationId:"ambiguous_dest",targetKey:"ambiguous_target",
      channel:"whatsapp",itemPayload:{titulo:"ACK ausente"}});
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
    assert.equal(await armOneShot({pool,workspaceId:workspace,
      destinationId:"second_dest",targetKey:"second_target",
      channel:"whatsapp",itemPayload:{titulo:"Segundo smoke"}})
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
    assert.equal(await armOneShot({pool,workspaceId:workspace,
      destinationId:"forbidden_after_late_ack",targetKey:"forbidden_target",
      channel:"whatsapp",itemPayload:{titulo:"Nao rearmar tardio"}})
      .then(()=>"allowed",error=>error.message),
    "smoke_budget_already_spent");
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
  }
}

main().catch(error=>{console.error("ONE_SHOT_POSTGRES17_FAIL",
  error?.code || error?.message,error?.constraint || "",
  error?.message || "");process.exitCode=1;});
