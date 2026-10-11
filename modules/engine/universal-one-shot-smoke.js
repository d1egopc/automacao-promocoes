"use strict";

// Explicitly armed cutover instrument. No normal ingress, scheduler or global
// operation epoch can discover this queue scope. All effects are PostgreSQL
// facts; a consumed gate is never rearmed after a crash.
const { randomUUID, createHash } = require("node:crypto");
const { serializarJsonbSeguro } = require("../../utils/jsonb-safe");
const { holdForTargetTx, releaseForTargetTx } =
  require("./universal-credits.repository");
const { factualAckTx, confirmFactualSendTx } =
  require("./universal-queue.repository");
const { statusPublico } = require("./universal-history.read-model");
const { normalizarAlvosDestino, chaveAlvo } =
  require("../../utils/destinos-multialvo");

const CONTROLLED_WORKSPACE = "user_pss60lus";
const CHANNELS = new Set(["whatsapp", "telegram", "discord"]);

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function tx(pool, action) {
  if (!pool || typeof pool.connect !== "function") throw new Error("smoke_pool_required");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const result = await action(client);
    await client.query("COMMIT"); open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function prepared(client) {
  const row = (await client.query(`SELECT mode,operation_epoch_started_at
    FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
  if (row?.mode !== "CUTOVER_PREPARED" || row.operation_epoch_started_at) {
    throw new Error("smoke_requires_prepared_without_epoch");
  }
}

async function gateTx(client, id, lock = true) {
  const row = (await client.query(`SELECT * FROM engine_universal_one_shot_smoke
    WHERE id=$1::uuid ${lock ? "FOR UPDATE" : "FOR SHARE"}`, [id])).rows[0];
  if (!row) throw new Error("smoke_gate_missing");
  return row;
}

function gateIdentity(gate, { workspaceId, destinationId, targetKey,
  channel, queueDestinationId } = {}) {
  if (workspaceId != null && gate.workspace_id !== String(workspaceId) ||
      destinationId != null && gate.destination_id !== String(destinationId) ||
      targetKey != null && gate.target_key !== String(targetKey) ||
      channel != null && gate.channel !== String(channel).toLowerCase() ||
      queueDestinationId != null && String(gate.queue_destination_id) !==
        String(queueDestinationId)) {
    throw new Error("smoke_identity_mismatch");
  }
}

function gateLive(gate) {
  if (new Date(gate.expires_at).getTime() <= Date.now()) {
    throw new Error("smoke_gate_expired");
  }
  if (gate.binding_state !== "bound" || !gate.queue_item_id ||
      !gate.queue_destination_id ||
      !["armed", "claimed"].includes(gate.state) ||
      Number(gate.provider_call_count) !== 0) {
    throw new Error("smoke_gate_not_armed");
  }
}

async function armOneShot({ pool, workspaceId, destinationId, targetKey,
  channel, connectionId = "", sourceSessionId, sourceGroupJid,
  ttlSeconds = 300 } = {}) {
  const workspace = String(workspaceId || "").trim();
  const destination = String(destinationId || "").trim();
  const target = String(targetKey || "").trim();
  const type = String(channel || "").trim().toLowerCase();
  const session = String(sourceSessionId || "").trim();
  const group = String(sourceGroupJid || "").trim();
  const ttl = Number(ttlSeconds);
  if (workspace !== CONTROLLED_WORKSPACE || !destination || !target ||
      !CHANNELS.has(type) || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 600 ||
      !session || !group) throw new Error("smoke_arm_identity_invalid");
  const id = randomUUID();
  return tx(pool, async client => {
    await prepared(client);
    const spent=(await client.query(`SELECT 1
      FROM engine_universal_one_shot_smoke
      WHERE provider_call_count=1 LIMIT 1`)).rowCount>0;
    if (spent) throw new Error("smoke_budget_already_spent");
    await client.query(`UPDATE engine_universal_one_shot_smoke
      SET state='expired',updated_at=clock_timestamp()
      WHERE binding_state='waiting' AND state='armed'
        AND expires_at<=clock_timestamp()`);
    // The principal gate is the only authority even while waiting. Neither
    // queue identity nor credit/provider work exists until a Radar binding.
    const gate = (await client.query(`INSERT INTO engine_universal_one_shot_smoke
      (id,smoke_epoch_at,workspace_id,destination_id,target_key,channel,
       connection_id,queue_item_id,queue_destination_id,binding_state,state,
       expires_at)
      VALUES ($1,date_trunc('milliseconds',clock_timestamp()),
        $2,$3,$4,$5,$6,NULL,NULL,'waiting',
        'armed',clock_timestamp()+($7::integer * interval '1 second'))
      RETURNING created_at,expires_at`, [id,workspace,destination,target,
      type,String(connectionId || "") || null,ttl])).rows[0];
    await client.query(`INSERT INTO engine_universal_one_shot_trigger
      (id,source_type,source_session_id,source_group_jid)
      VALUES ($1,'radar',$2,$3)`,[id,session,group]);
    return { id, state: "armed_waiting_trigger", workspaceId: workspace,
      sourceSessionId: session, sourceGroupJid: group,
      destinationId: destination, targetKey: target, channel: type,
      armedAt: gate.created_at, expiresAt: gate.expires_at,
      providerCallCount: 0, eventId: null, queueItemId: null };
  });
}

function validCommercialPayload(offer = {}, payload = {}) {
  const link = String(payload.linkAfiliado || "").trim();
  const image = String(payload.imagem || payload.imagemUrl || "").trim();
  const title = String(payload.titulo || payload.nome || "").trim();
  return Boolean(title && /^https?:\/\/[^\s]+$/i.test(link) &&
    /^https?:\/\/[^\s]+$/i.test(String(offer.link_afiliado || "")) &&
    image && payload.imagemEnviavel === true);
}

// Called by the claimed Distributor worker, after commercial validation and
// immediately before its first legacy/VIVA write. The offer row is the shared
// PostgreSQL CAS boundary: a concurrent Distributor cannot own it twice.
async function bindRadarOfferOneShot({ pool, offer, itemPayload,
  compatibleDestinations = [] } = {}) {
  if (!pool || !offer || !itemPayload ||
      String(offer.cliente_id || "") !== CONTROLLED_WORKSPACE) {
    return { bound: false };
  }
  return tx(pool, async client => {
    // Serialize even accidental direct re-entry of the same legacy writer.
    // The normal Distributor has already won its status CAS before this call.
    const offerLock = await client.query(`SELECT id FROM engine_ofertas
      WHERE id=$1 FOR UPDATE`,[offer.id]);
    if (!offerLock.rowCount) return { bound: false };
    const existing = (await client.query(`SELECT t.id,t.bound_event_id,
      t.bound_job_id,t.bound_offer_id,g.queue_item_id,
      g.queue_destination_id,g.smoke_epoch_at
      FROM engine_universal_one_shot_trigger t
      JOIN engine_universal_one_shot_smoke g ON g.id=t.id
      WHERE g.workspace_id=$1 AND t.bound_offer_id=$2
        AND g.binding_state='bound'
      FOR SHARE OF t,g`,[CONTROLLED_WORKSPACE,offer.id])).rows[0];
    if (existing) return {bound:true,alreadyBound:true,id:existing.id,
      eventId:existing.bound_event_id,jobId:existing.bound_job_id,
      offerId:existing.bound_offer_id,queueItemId:existing.queue_item_id,
      queueDestinationId:existing.queue_destination_id,
      smokeEpochAt:existing.smoke_epoch_at};
    if (!validCommercialPayload(offer,itemPayload)) return { bound: false };
    const mode = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (mode?.mode !== "CUTOVER_PREPARED" || mode.operation_epoch_started_at) {
      return { bound: false };
    }
    await client.query(`UPDATE engine_universal_one_shot_smoke
      SET state='expired',updated_at=clock_timestamp()
      WHERE binding_state='waiting' AND state='armed'
        AND expires_at<=clock_timestamp()`);
    const gate = (await client.query(`SELECT g.*,t.source_type,
      t.source_session_id,t.source_group_jid
      FROM engine_universal_one_shot_smoke g
      JOIN engine_universal_one_shot_trigger t ON t.id=g.id
      WHERE g.state='armed' AND g.binding_state='waiting'
        AND g.workspace_id=$1 AND g.expires_at>clock_timestamp()
      FOR UPDATE OF g,t`, [CONTROLLED_WORKSPACE])).rows[0];
    if (!gate) return { bound: false };
    const matchingDestination = compatibleDestinations.find(destination =>
      String(destination?.id || destination?.destinoId || "") ===
        gate.destination_id &&
      String(destination?.tipo || destination?.canal || "").toLowerCase() ===
        gate.channel &&
      normalizarAlvosDestino(destination).some(target =>
        chaveAlvo(target) === gate.target_key &&
        (!gate.connection_id ||
          String(target.conexaoId || target.sessao || "") ===
            gate.connection_id)));
    if (!matchingDestination) return { bound: false };
    const source = (await client.query(`SELECT e.id AS event_id,e.capturado_em,
      e.criado_em AS event_created_at,j.criado_em AS job_created_at,
      o.criada_em AS offer_created_at,
      e.origem,e.fonte,e.origem_tipo,e.sessao_id,e.grupo_id,e.metadata,
      j.id AS job_id,j.status AS job_status,o.id AS offer_id,o.status AS offer_status
      FROM engine_ofertas o
      JOIN engine_jobs_cliente j ON j.id=$2 AND j.oferta_id=o.id
      JOIN engine_eventos_brutos e ON e.id=o.evento_id AND e.id=j.evento_id
      JOIN engine_universal_one_shot_smoke g ON g.id=$4
        AND e.capturado_em>=g.created_at AND e.criado_em>=g.created_at
        AND j.criado_em>=g.created_at AND o.criada_em>=g.created_at
        AND e.capturado_em<g.expires_at
      WHERE o.id=$1 AND j.cliente_id=$3 FOR UPDATE OF o,j`,
    [offer.id,offer.job_id,gate.workspace_id,gate.id])).rows[0];
    if (!source || source.offer_status !== "distribuindo" ||
        source.origem !== "radar" || source.fonte !== "radar" ||
        source.origem_tipo !== "whatsapp" ||
        source.sessao_id !== gate.source_session_id ||
        source.grupo_id !== gate.source_group_jid ||
        source.metadata?.fonteCaptura !== "radar" ||
        source.metadata?.teleradar ||
        new Date(source.capturado_em).getTime() < new Date(gate.created_at).getTime() ||
        new Date(source.event_created_at).getTime() < new Date(gate.created_at).getTime() ||
        new Date(source.job_created_at).getTime() < new Date(gate.created_at).getTime() ||
        new Date(source.offer_created_at).getTime() < new Date(gate.created_at).getTime() ||
        new Date(source.capturado_em).getTime() >= new Date(gate.expires_at).getTime() ||
        new Date(gate.expires_at).getTime() <= Date.now()) {
      return { bound: false };
    }
    const id = gate.id;
    const epoch = new Date(gate.smoke_epoch_at).toISOString();
    const captured = new Date(source.capturado_em).toISOString();
    const fingerprint = hash([gate.workspace_id,source.event_id,
      source.job_id,source.offer_id,itemPayload.linkAfiliado || itemPayload.linkFinal]);
    const excluded = await client.query(`UPDATE engine_ofertas
      SET status='cutover_validation',motivo_status='cutover_validation',
        atualizada_em=clock_timestamp()
      WHERE id=$1 AND status='distribuindo' RETURNING id`,[source.offer_id]);
    if (excluded.rowCount !== 1) return { bound: false };
    await client.query(`UPDATE engine_jobs_cliente
      SET status='cutover_validation' WHERE id=$1`,[source.job_id]);
    const payload = { ...itemPayload, id: "", clienteId: gate.workspace_id,
      engineOfertaId: source.offer_id, engineJobId: source.job_id,
      evento_capturado_em: captured, origemFluxo: "cutover_validation",
      cutoverValidation: { id, kind: "CUTOVER_VALIDATION" } };
    const item = (await client.query(`INSERT INTO engine_universal_queue_items
      (operation_epoch_started_at,workspace_id,evento_id,job_id,oferta_id,
       origem_fluxo,capturado_em,item_payload,status)
      VALUES ($1,$2,$3,$4,$5,'cutover_validation',$6,$7::jsonb,'pending')
      RETURNING id`, [epoch,gate.workspace_id,source.event_id,
      source.job_id,source.offer_id,captured,
      serializarJsonbSeguro(payload, {})])).rows[0];
    const itemKey = `universal_${item.id}`;
    await client.query(`UPDATE engine_universal_queue_items
      SET item_payload=jsonb_set(item_payload,'{id}',to_jsonb($2::text),true)
      WHERE id=$1`, [item.id, itemKey]);
    const owner = hash([epoch,gate.workspace_id,String(item.id),
      gate.destination_id]);
    const snapshot = hash([[gate.channel,gate.target_key,
      gate.connection_id || ""]]);
    await client.query(`INSERT INTO engine_universal_fanout_owners
      (owner_id,queue_item_id,operation_epoch_started_at,workspace_id,
       destination_id,target_snapshot_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [owner,item.id,epoch,
      gate.workspace_id,gate.destination_id,snapshot]);
    const targetRow = (await client.query(`INSERT INTO engine_universal_queue_destinations
      (queue_item_id,operation_epoch_started_at,workspace_id,destination_id,
       fanout_owner_id,target_key,connection_id,channel)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [item.id,epoch,gate.workspace_id,gate.destination_id,owner,
      gate.target_key,gate.connection_id,gate.channel])).rows[0];
    await client.query(`INSERT INTO engine_universal_queue_workspace_state
      (operation_epoch_started_at,workspace_id,health,revision)
      VALUES ($1,$2,'UNKNOWN',1)`, [epoch,gate.workspace_id]);
    // One operator-funded validation credit is isolated by this smoke epoch.
    // It is not a customer's final opening balance and never touches JSON.
    const sourceHash = hash(["CUTOVER_VALIDATION",id,gate.workspace_id]);
    await client.query(`INSERT INTO engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id,opening_balance,balance,source_hash)
      VALUES ($1,$2,1,1,$3)`, [epoch,gate.workspace_id,sourceHash]);
    await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at,
       universal_movement_type,universal_balance_revision,
       universal_balance_after)
      VALUES ($1,'adjustment',1,'set','cutover_validation_opening',$2,
       'projected',$3::jsonb,$4,'CUTOVER_VALIDATION_OPENING',0,1)`,
    [gate.workspace_id,`cutover-validation-opening:${id}`,
      JSON.stringify({ authority: "postgresql_cutover_validation",
        cutoverValidationId: id, sourceHash }),epoch]);
    const boundGate=await client.query(`UPDATE engine_universal_one_shot_smoke
      SET queue_item_id=$2,queue_destination_id=$3,binding_state='bound',
        updated_at=clock_timestamp()
      WHERE id=$1 AND state='armed' AND binding_state='waiting'
        AND queue_item_id IS NULL AND queue_destination_id IS NULL
        AND expires_at>clock_timestamp() RETURNING id`,
    [id,item.id,targetRow.id]);
    if (boundGate.rowCount!==1) throw new Error("smoke_gate_binding_conflict");
    const boundTrigger=await client.query(`UPDATE engine_universal_one_shot_trigger
      SET bound_event_id=$2,bound_job_id=$3,bound_offer_id=$4,
        capture_t0=$5,commercial_fingerprint=$6,bound_at=clock_timestamp()
      WHERE id=$1 AND bound_at IS NULL`,
    [id,source.event_id,source.job_id,source.offer_id,captured,fingerprint]);
    if (boundTrigger.rowCount!==1) throw new Error("smoke_trigger_binding_conflict");
    return { bound: true,id,eventId:source.event_id,jobId:source.job_id,
      offerId:source.offer_id,queueItemId:item.id,
      queueDestinationId:targetRow.id,smokeEpochAt:epoch };
  });
}

async function activeOneShot({ pool }) {
  if (!pool || typeof pool.query !== "function") throw new Error("smoke_pool_required");
  await pool.query(`UPDATE engine_universal_one_shot_smoke
    SET state='expired',updated_at=clock_timestamp()
    WHERE binding_state='waiting' AND state='armed'
      AND expires_at<=clock_timestamp()`);
  const row = (await pool.query(`SELECT g.id,g.workspace_id,g.state,g.expires_at
    FROM engine_universal_one_shot_smoke g
    JOIN engine_operation_state s ON s.id=1
      AND s.mode='CUTOVER_PREPARED' AND s.operation_epoch_started_at IS NULL
    WHERE g.binding_state='bound'
      AND g.queue_item_id IS NOT NULL AND g.queue_destination_id IS NOT NULL
      AND g.state IN ('armed','claimed','consumed')
    ORDER BY g.created_at LIMIT 1`)).rows[0];
  return row || null;
}

async function smokeCreditAvailable({ pool,id,workspaceId,destinationId,
  targetKey,queueItemId,quantity = 1 }) {
  const amount=Number(quantity);
  if (!pool || typeof pool.query!=="function" ||
      !Number.isSafeInteger(amount) || amount!==1) return false;
  const result=await pool.query(`SELECT b.balance,b.reserved,g.state,
      h.state AS hold_state
    FROM engine_universal_one_shot_smoke g
    JOIN engine_operation_state s ON s.id=1 AND s.mode='CUTOVER_PREPARED'
      AND s.operation_epoch_started_at IS NULL
    JOIN engine_universal_queue_destinations d
      ON d.id=g.queue_destination_id AND d.queue_item_id=g.queue_item_id
      AND d.operation_epoch_started_at=g.smoke_epoch_at
      AND d.workspace_id=g.workspace_id AND d.destination_id=g.destination_id
      AND d.target_key=g.target_key AND d.channel=g.channel
    JOIN engine_universal_credit_balances b
      ON b.operation_epoch_started_at=g.smoke_epoch_at
      AND b.workspace_id=g.workspace_id
    LEFT JOIN engine_universal_credit_holds h
      ON h.operation_epoch_started_at=g.smoke_epoch_at
      AND h.workspace_id=g.workspace_id AND h.target_id=d.id
    WHERE g.id=$1::uuid AND g.binding_state='bound'
      AND g.workspace_id=$2 AND g.destination_id=$3
      AND g.target_key=$4 AND g.queue_item_id=$5
      AND g.state IN ('claimed','consumed')
      AND (g.state='consumed' OR g.expires_at>clock_timestamp())`,
  [id,workspaceId,destinationId,targetKey,queueItemId]);
  const row=result.rows[0];
  return Boolean(row && (row.state==="claimed"
    ? Number(row.balance)-Number(row.reserved)>=1
    : row.hold_state==="held" && Number(row.balance)>=1));
}

async function readOneShot({ pool, id }) {
  return tx(pool, async client => {
    const binding = (await client.query(`SELECT g.id,g.state,g.binding_state,
      g.workspace_id,g.destination_id,g.target_key,g.channel,
      g.smoke_epoch_at,g.created_at,g.expires_at,g.provider_call_count,
      t.source_session_id,t.source_group_jid,t.bound_event_id
      FROM engine_universal_one_shot_smoke g
      LEFT JOIN engine_universal_one_shot_trigger t ON t.id=g.id
      WHERE g.id=$1::uuid FOR SHARE OF g`,[id])).rows[0];
    if (binding?.binding_state === "waiting") {
      return { id:binding.id,state:binding.state === "armed" &&
          new Date(binding.expires_at).getTime() > Date.now()
          ? "armed_waiting_trigger" : "expired",
        providerCallCount:Number(binding.provider_call_count),
        workspaceId:binding.workspace_id,
        sourceSessionId:binding.source_session_id,
        sourceGroupJid:binding.source_group_jid,
        destinationId:binding.destination_id,targetKey:binding.target_key,
        channel:binding.channel,armedAt:binding.created_at,
        expiresAt:binding.expires_at,boundEventId:null,
        queueItemId:null,queueDestinationId:null,historyFact:null };
    }
    const gate = await gateTx(client,id,false);
    const target = (await client.query(`SELECT status,confirmation_key,
      provider_message_id,credit_debited FROM engine_universal_queue_destinations
      WHERE id=$1`, [gate.queue_destination_id])).rows[0];
    const item = (await client.query(`SELECT status,terminal_at,
      item_payload->'cutoverValidation' AS validation
      FROM engine_universal_queue_items WHERE id=$1`,
    [gate.queue_item_id])).rows[0];
    const debits = (await client.query(`SELECT count(*)::int AS total
      FROM financial_credit_ledger WHERE operation_epoch_started_at=$1
        AND cliente_id=$2 AND universal_movement_type='TARGET_DEBIT'
        AND universal_target_id=$3`, [gate.smoke_epoch_at,gate.workspace_id,
      gate.queue_destination_id])).rows[0];
    return { id: gate.id, state: gate.state,
      providerCallCount: Number(gate.provider_call_count),
      expiresAt: gate.expires_at, workspaceId: gate.workspace_id,
      sourceSessionId:binding?.source_session_id || null,
      sourceGroupJid:binding?.source_group_jid || null,
      boundEventId:binding?.bound_event_id || null,
      destinationId: gate.destination_id, targetKey: gate.target_key,
      channel: gate.channel, queueItemId: gate.queue_item_id,
      queueDestinationId: gate.queue_destination_id,
      smokeEpochAt: gate.smoke_epoch_at, target,
      historyFact: item?.terminal_at ? {
        kind: "CUTOVER_VALIDATION",id: gate.id,
        resultadoFinalPublico: statusPublico(item.status),
        terminalAt: item.terminal_at,
        validation: item.validation,
        providerMessageId: target?.provider_message_id || null,
        creditDebits: Number(debits?.total || 0)
      } : null };
  });
}

async function targetTx(client, gate, leaseToken = null) {
  const target = (await client.query(`SELECT id,queue_item_id,workspace_id,
    destination_id,target_key,channel,status,lease_token,lease_until,available_at,
    send_started_at FROM engine_universal_queue_destinations
    WHERE id=$1 AND operation_epoch_started_at=$2 FOR UPDATE`,
  [gate.queue_destination_id,gate.smoke_epoch_at])).rows[0];
  if (!target || String(target.queue_item_id) !== String(gate.queue_item_id)) {
    throw new Error("smoke_target_missing_or_conflicting");
  }
  gateIdentity(gate, { workspaceId: target.workspace_id,
    destinationId: target.destination_id,targetKey: target.target_key,
    channel: target.channel,queueDestinationId: target.id });
  if (leaseToken != null && String(target.lease_token) !== String(leaseToken)) {
    throw new Error("smoke_lease_mismatch");
  }
  return target;
}

async function requireHealthyWorkspaceTx(client,gate) {
  const row=(await client.query(`SELECT health,revision,checkpoint_revision
    FROM engine_universal_queue_workspace_state
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
  [gate.smoke_epoch_at,gate.workspace_id])).rows[0];
  if (!row || row.health!=="HEALTHY" ||
      Number(row.revision)!==Number(row.checkpoint_revision)) {
    throw new Error("smoke_workspace_preflight_required");
  }
}

async function checkpointWorkspaceTx(client,gate) {
  await client.query(`UPDATE engine_universal_queue_workspace_state
    SET revision=revision+1,checkpoint_revision=revision+1,
      updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [gate.smoke_epoch_at,gate.workspace_id]);
}

async function reconcileAckTx(client, gate, target) {
  const ack = await factualAckTx(client,target);
  if (!ack) return false;
  if (Number(gate.provider_call_count) !== 1 ||
      !["consumed","completed"].includes(gate.state)) {
    throw new Error("smoke_ack_without_consumed_gate");
  }
  if (target.status !== "sent") {
    const result = await confirmFactualSendTx(client, {
      destination: target, epoch: gate.smoke_epoch_at,
      ack, skipVitrine: true });
    await client.query(`UPDATE financial_credit_ledger
      SET reason='cutover_validation_target_confirmed',
        metadata=metadata || jsonb_build_object(
          'cutoverValidationId',$2::text,'authority',
          'postgresql_cutover_validation')
      WHERE id=$1`, [result.ledgerId,gate.id]);
  }
  await client.query(`UPDATE engine_universal_one_shot_smoke
    SET state='completed',completed_at=COALESCE(completed_at,clock_timestamp()),
      updated_at=clock_timestamp() WHERE id=$1`, [gate.id]);
  return true;
}

function oneShotRepository(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) {
    throw new Error("smoke_id_invalid");
  }
  return {
    async preflightWorkspace({ pool, workspaceId }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate = await gateTx(client,id);
        gateIdentity(gate,{ workspaceId });
        const target = await targetTx(client,gate);
        if (await reconcileAckTx(client,gate,target)) {
          return { ok: false, reason: "smoke_already_completed",
            recoveredAcks: 1 };
        }
        if (gate.state === "consumed") {
          if (target.status === "send_started" &&
              new Date(target.lease_until).getTime() < Date.now()) {
            await client.query(`UPDATE engine_universal_queue_destinations
              SET status='ambiguous',revision=revision+1,
                updated_at=clock_timestamp() WHERE id=$1`, [target.id]);
          }
          return { ok: false, reason: "smoke_provider_result_ambiguous" };
        }
        if (new Date(gate.expires_at).getTime() <= Date.now()) {
          await client.query(`UPDATE engine_universal_one_shot_smoke
            SET state='expired',updated_at=clock_timestamp()
            WHERE id=$1`, [gate.id]);
          return { ok: false, reason: "smoke_gate_expired" };
        }
        if (!["armed","claimed"].includes(gate.state)) {
          return { ok: false, reason: "smoke_gate_not_active" };
        }
        if (target.status === "claimed" && !target.send_started_at &&
            new Date(target.lease_until).getTime() < Date.now()) {
          await client.query(`UPDATE engine_universal_queue_destinations
            SET status='pending',lease_token=NULL,lease_until=NULL,
              revision=revision+1,updated_at=clock_timestamp()
            WHERE id=$1`, [target.id]);
        }
        await client.query(`UPDATE engine_universal_queue_workspace_state
          SET health='HEALTHY',revision=revision+1,
            checkpoint_revision=revision+1,checked_at=clock_timestamp(),
            updated_at=clock_timestamp()
          WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
        [gate.smoke_epoch_at,gate.workspace_id]);
        return { ok: true, health: "HEALTHY" };
      });
    },
    async claimDestination({ pool, workspaceId, leaseMs = 30000 }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate = await gateTx(client,id);
        gateIdentity(gate,{ workspaceId }); gateLive(gate);
        await requireHealthyWorkspaceTx(client,gate);
        const target = await targetTx(client,gate);
        if (target.status !== "pending" ||
            new Date(target.available_at).getTime() > Date.now()) {
          return { ok: true, empty: true };
        }
        const token = randomUUID();
        const duration = Math.max(1000,Math.min(120000,
          Math.floor(Number(leaseMs) || 30000)));
        await client.query(`UPDATE engine_universal_queue_destinations
          SET status='claimed',lease_token=$2,
            lease_until=clock_timestamp()+($3::integer * interval '1 millisecond'),
            revision=revision+1,updated_at=clock_timestamp()
          WHERE id=$1`, [target.id,token,duration]);
        await client.query(`UPDATE engine_universal_one_shot_smoke
          SET state='claimed',updated_at=clock_timestamp() WHERE id=$1`,[id]);
        await checkpointWorkspaceTx(client,gate);
        const claim = (await client.query(`SELECT d.id,d.queue_item_id,d.workspace_id,
          d.destination_id,d.fanout_owner_id,d.target_key,d.connection_id,
          d.channel,i.item_payload,i.capturado_em,i.origem_fluxo,
          i.oferta_id,i.evento_id
          FROM engine_universal_queue_destinations d
          JOIN engine_universal_queue_items i ON i.id=d.queue_item_id
          WHERE d.id=$1`,[target.id])).rows[0];
        return { ok: true,empty:false,...claim,leaseToken:token,
          operationEpochStartedAt:gate.smoke_epoch_at };
      });
    },
    async markSendStarted({ pool,destinationId,leaseToken,commercialCta = {} }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate = await gateTx(client,id);
        gateIdentity(gate,{ queueDestinationId:destinationId }); gateLive(gate);
        await requireHealthyWorkspaceTx(client,gate);
        const target = await targetTx(client,gate,leaseToken);
        if (target.status !== "claimed" ||
            new Date(target.lease_until).getTime() <= Date.now()) {
          throw new Error("smoke_claim_not_current");
        }
        const hold = await holdForTargetTx(client,{epoch:gate.smoke_epoch_at,
          workspaceId:gate.workspace_id,targetId:target.id});
        if (!hold.ok) throw new Error(hold.reason);
        await client.query(`UPDATE engine_universal_queue_destinations
          SET status='send_started',send_started_at=clock_timestamp(),
            commercial_cta=$2::jsonb,revision=revision+1,
            updated_at=clock_timestamp() WHERE id=$1`,
        [target.id,serializarJsonbSeguro(commercialCta,{})]);
        const consumed = await client.query(`UPDATE engine_universal_one_shot_smoke
          SET state='consumed',provider_call_count=1,
            consumed_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE id=$1 AND state IN ('armed','claimed')
            AND provider_call_count=0 AND expires_at>clock_timestamp()
          RETURNING id`,[id]);
        if (consumed.rowCount !== 1) throw new Error("smoke_budget_exhausted");
        await checkpointWorkspaceTx(client,gate);
        return { ok:true };
      });
    },
    async releaseUnstarted({ pool,destinationId,leaseToken,retryAt }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate=await gateTx(client,id);
        gateIdentity(gate,{queueDestinationId:destinationId});
        const target=await targetTx(client,gate,leaseToken);
        if (target.status!=="claimed" || target.send_started_at ||
            Number(gate.provider_call_count)!==0) {
          return {ok:false,reason:"smoke_claim_not_releasable"};
        }
        const available=retryAt?new Date(retryAt):new Date();
        if (!Number.isFinite(available.getTime())) throw new Error("smoke_retry_invalid");
        await client.query(`UPDATE engine_universal_queue_destinations
          SET status='pending',lease_token=NULL,lease_until=NULL,
            available_at=$2,revision=revision+1,updated_at=clock_timestamp()
          WHERE id=$1`,[target.id,available.toISOString()]);
        await checkpointWorkspaceTx(client,gate);
        return {ok:true};
      });
    },
    async confirmSend({ pool,destinationId,leaseToken,confirmationKey,
      providerMessageId }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate=await gateTx(client,id);
        gateIdentity(gate,{queueDestinationId:destinationId});
        const target=await targetTx(client,gate,leaseToken);
        if (gate.state!=="consumed" && gate.state!=="completed") {
          throw new Error("smoke_gate_not_consumed");
        }
        const ack=await factualAckTx(client,target);
        if (!ack || ack.confirmation_key!==String(confirmationKey) ||
            ack.provider_message_id!==String(providerMessageId)) {
          throw new Error("smoke_provider_ack_not_durable_or_conflicting");
        }
        if (gate.state==="completed") return {ok:true,duplicate:true};
        await reconcileAckTx(client,gate,target);
        return {ok:true,duplicate:false};
      });
    },
    async confirmFailure({ pool,destinationId,leaseToken,reason,evidence }) {
      return tx(pool, async client => {
        await prepared(client);
        const gate=await gateTx(client,id);
        gateIdentity(gate,{queueDestinationId:destinationId});
        const target=await targetTx(client,gate,leaseToken);
        const valid=(evidence==="local_before_transport" &&
          Number(gate.provider_call_count)===0 && target.status==="claimed") ||
          (evidence==="provider_no_effect_confirmed" &&
          Number(gate.provider_call_count)===1 && target.status==="send_started");
        if (!valid || !String(reason||"").trim()) {
          throw new Error("smoke_failure_fact_unproven");
        }
        if (Number(gate.provider_call_count)===1) {
          if (await factualAckTx(client,target)) {
            throw new Error("smoke_failure_conflicts_with_ack");
          }
          await releaseForTargetTx(client,{epoch:gate.smoke_epoch_at,
            workspaceId:gate.workspace_id,targetId:target.id});
        }
        await client.query(`UPDATE engine_universal_queue_destinations
          SET status='failed',terminal_reason=$2,revision=revision+1,
            updated_at=clock_timestamp() WHERE id=$1`,[target.id,String(reason)]);
        await client.query(`UPDATE engine_universal_queue_items
          SET status='error',terminal_at=clock_timestamp(),revision=revision+1,
            updated_at=clock_timestamp() WHERE id=$1`,[gate.queue_item_id]);
        await client.query(`UPDATE engine_universal_one_shot_smoke
          SET state='aborted',updated_at=clock_timestamp() WHERE id=$1`,[id]);
        return {ok:true,terminal:true};
      });
    },
    async completeWithoutSend({ pool,destinationId,leaseToken,reason }) {
      return tx(pool,async client=>{
        await prepared(client);
        const gate=await gateTx(client,id);
        gateIdentity(gate,{queueDestinationId:destinationId});
        const target=await targetTx(client,gate,leaseToken);
        if (Number(gate.provider_call_count)!==0 || target.status!=="claimed" ||
            !String(reason||"").trim()) throw new Error("smoke_no_send_unproven");
        await client.query(`UPDATE engine_universal_queue_destinations
          SET status='skipped',terminal_reason=$2,revision=revision+1,
            updated_at=clock_timestamp() WHERE id=$1`,[target.id,String(reason)]);
        await client.query(`UPDATE engine_universal_queue_items
          SET status='not_sent',terminal_at=clock_timestamp(),revision=revision+1,
            updated_at=clock_timestamp() WHERE id=$1`,[gate.queue_item_id]);
        await client.query(`UPDATE engine_universal_one_shot_smoke
          SET state='aborted',updated_at=clock_timestamp() WHERE id=$1`,[id]);
        return {ok:true,terminal:true};
      });
    }
  };
}

module.exports = { armOneShot, bindRadarOfferOneShot, activeOneShot, readOneShot,
  oneShotRepository, smokeCreditAvailable, CONTROLLED_WORKSPACE };
