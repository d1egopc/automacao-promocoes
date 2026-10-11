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
  if (!["armed", "claimed"].includes(gate.state) ||
      Number(gate.provider_call_count) !== 0) {
    throw new Error("smoke_gate_not_armed");
  }
}

async function armOneShot({ pool, workspaceId, destinationId, targetKey,
  channel, connectionId = "", itemPayload, ttlSeconds = 300 } = {}) {
  const workspace = String(workspaceId || "").trim();
  const destination = String(destinationId || "").trim();
  const target = String(targetKey || "").trim();
  const type = String(channel || "").trim().toLowerCase();
  const ttl = Number(ttlSeconds);
  if (workspace !== CONTROLLED_WORKSPACE || !destination || !target ||
      !CHANNELS.has(type) || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 600 ||
      !itemPayload || typeof itemPayload !== "object" ||
      Array.isArray(itemPayload)) throw new Error("smoke_arm_identity_invalid");
  const id = randomUUID();
  return tx(pool, async client => {
    await prepared(client);
    const spent=(await client.query(`SELECT 1
      FROM engine_universal_one_shot_smoke
      WHERE provider_call_count=1 LIMIT 1`)).rowCount>0;
    if (spent) throw new Error("smoke_budget_already_spent");
    // A new, isolated commercial fact is created here. Its non-operational
    // job status makes it invisible to the legacy Processor/Importer.
    const event = (await client.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,capturado_em,metadata)
      VALUES ('cutover_validation','cutover_validation',clock_timestamp(),
        jsonb_build_object('cutoverValidationId',$1::text))
      RETURNING id,capturado_em`, [id])).rows[0];
    const epoch = new Date(event.capturado_em).toISOString();
    const offer = (await client.query(`INSERT INTO engine_ofertas
      (evento_id,origem,status,capturada_em,metadata)
      VALUES ($1,'cutover_validation','cutover_validation',$2,
        jsonb_build_object('cutoverValidationId',$3::text)) RETURNING id`,
    [event.id, epoch, id])).rows[0];
    const job = (await client.query(`INSERT INTO engine_jobs_cliente
      (evento_id,oferta_id,cliente_id,status,metadata)
      VALUES ($1,$2,$3,'cutover_validation',
        jsonb_build_object('cutoverValidationId',$4::text)) RETURNING id`,
    [event.id, offer.id, workspace, id])).rows[0];
    const payload = { ...itemPayload, id: "", clienteId: workspace,
      engineOfertaId: offer.id, engineJobId: job.id,
      evento_capturado_em: epoch, origemFluxo: "cutover_validation",
      cutoverValidation: { id, kind: "CUTOVER_VALIDATION" } };
    const item = (await client.query(`INSERT INTO engine_universal_queue_items
      (operation_epoch_started_at,workspace_id,evento_id,job_id,oferta_id,
       origem_fluxo,capturado_em,item_payload,status)
      VALUES ($1,$2,$3,$4,$5,'cutover_validation',$1,$6::jsonb,'pending')
      RETURNING id`, [epoch, workspace, event.id, job.id, offer.id,
      serializarJsonbSeguro(payload, {})])).rows[0];
    const itemKey = `universal_${item.id}`;
    await client.query(`UPDATE engine_universal_queue_items
      SET item_payload=jsonb_set(item_payload,'{id}',to_jsonb($2::text),true)
      WHERE id=$1`, [item.id, itemKey]);
    const owner = hash([epoch, workspace, String(item.id), destination]);
    const snapshot = hash([[type, target, String(connectionId || "")]]);
    await client.query(`INSERT INTO engine_universal_fanout_owners
      (owner_id,queue_item_id,operation_epoch_started_at,workspace_id,
       destination_id,target_snapshot_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [owner,item.id,epoch,workspace,
      destination,snapshot]);
    const targetRow = (await client.query(`INSERT INTO engine_universal_queue_destinations
      (queue_item_id,operation_epoch_started_at,workspace_id,destination_id,
       fanout_owner_id,target_key,connection_id,channel)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [item.id,epoch,workspace,destination,owner,target,
      String(connectionId || "") || null,type])).rows[0];
    await client.query(`INSERT INTO engine_universal_queue_workspace_state
      (operation_epoch_started_at,workspace_id,health,revision)
      VALUES ($1,$2,'UNKNOWN',1)`, [epoch,workspace]);
    // One operator-funded validation credit is isolated by this smoke epoch.
    // It is not a customer's final opening balance and never touches JSON.
    const sourceHash = hash(["CUTOVER_VALIDATION",id,workspace]);
    await client.query(`INSERT INTO engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id,opening_balance,balance,source_hash)
      VALUES ($1,$2,1,1,$3)`, [epoch,workspace,sourceHash]);
    await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at,
       universal_movement_type,universal_balance_revision,
       universal_balance_after)
      VALUES ($1,'adjustment',1,'set','cutover_validation_opening',$2,
       'projected',$3::jsonb,$4,'CUTOVER_VALIDATION_OPENING',0,1)`,
    [workspace,`cutover-validation-opening:${id}`,
      JSON.stringify({ authority: "postgresql_cutover_validation",
        cutoverValidationId: id, sourceHash }),epoch]);
    await client.query(`INSERT INTO engine_universal_one_shot_smoke
      (id,smoke_epoch_at,workspace_id,destination_id,target_key,channel,
       queue_item_id,queue_destination_id,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
        clock_timestamp()+($9::integer * interval '1 second'))`,
    [id,epoch,workspace,destination,target,type,item.id,targetRow.id,ttl]);
    return { id, workspaceId: workspace, destinationId: destination,
      targetKey: target, channel: type, eventId: event.id, jobId: job.id,
      offerId: offer.id, queueItemId: item.id,
      queueDestinationId: targetRow.id, smokeEpochAt: epoch };
  });
}

async function activeOneShot({ pool }) {
  if (!pool || typeof pool.query !== "function") throw new Error("smoke_pool_required");
  const row = (await pool.query(`SELECT g.id,g.workspace_id,g.state,g.expires_at
    FROM engine_universal_one_shot_smoke g
    JOIN engine_operation_state s ON s.id=1
      AND s.mode='CUTOVER_PREPARED' AND s.operation_epoch_started_at IS NULL
    WHERE g.state IN ('armed','claimed','consumed')
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
    WHERE g.id=$1::uuid AND g.workspace_id=$2 AND g.destination_id=$3
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

module.exports = { armOneShot, activeOneShot, readOneShot,
  oneShotRepository, smokeCreditAvailable, CONTROLLED_WORKSPACE };
