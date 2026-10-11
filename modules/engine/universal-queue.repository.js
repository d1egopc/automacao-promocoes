"use strict";

// Post-epoch operational authority. Never reads or writes VIVA/JSON.
const { randomUUID, createHash } = require("node:crypto");
const { validarEstadoOperacional, exigirCapturaUniversal } =
  require("./operation-epoch");
const { classificarFilaUniversal } = require("./universal-queue-status");
const { holdForTargetTx, settleConfirmedTx, releaseForTargetTx } =
  require("./universal-credits.repository");

const RECOVERY_BATCH = 20;
const CHANNELS = new Set(["whatsapp", "telegram", "discord"]);

function validarDestinos(destinations) {
  if (!Array.isArray(destinations)) throw new Error("queue_destinations_required");
  const seen = new Set();
  return destinations.map(destination => {
    const id = String(destination?.destinationId || "").trim();
    const targetKey = String(destination?.targetKey || "").trim();
    const connectionId = String(destination?.connectionId || "").trim();
    const channel = String(destination?.channel || "").trim().toLowerCase();
    const identity = `${id}\u0000${targetKey}`;
    if (!id || !targetKey || !CHANNELS.has(channel) || seen.has(identity)) {
      throw new Error("queue_destination_invalid_or_duplicate");
    }
    seen.add(identity);
    return { destinationId: id, targetKey, connectionId, channel };
  });
}

function hashStable(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ownerIdFor({ epoch, workspace, itemId, destinationId }) {
  return hashStable([epoch, workspace, String(itemId), destinationId]);
}

async function transaction(pool, action) {
  if (!pool || typeof pool.connect !== "function") throw new Error("queue_pool_required");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await action(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function activeEpoch(client) {
  const result = await client.query(`SELECT mode,operation_epoch_started_at
    FROM engine_operation_state WHERE id=1 FOR SHARE`);
  const state = validarEstadoOperacional(result.rows[0]);
  if (state.mode !== "UNIVERSAL") throw new Error("universal_mode_not_active");
  return state;
}

function checkpointKeys(destination) {
  const channel = String(destination.channel || "").toLowerCase();
  const target = String(destination.target_key || "");
  const targetKey = channel === "whatsapp"
    ? (target.startsWith("grupo:") ? target : `grupo:${target}`)
    : channel === "discord"
      ? (target.startsWith("canal:") ? target : `canal:${target}`)
      : target;
  return [`universal_${destination.queue_item_id}`,
    `${channel}:${destination.destination_id}`, targetKey];
}

async function factualAckTx(client, destination) {
  const [itemKey, destinationKey, targetKey] = checkpointKeys(destination);
  const result = await client.query(`SELECT attempt_id::text AS confirmation_key,
      provider_message_id,confirmado_em
    FROM fila_checkpoints_entrega
    WHERE cliente_id=$1 AND fila_item_id=$2 AND destino_chave=$3
      AND alvo_chave=$4 AND estado='enviado'
      AND provider_message_id IS NOT NULL
      AND btrim(provider_message_id)<>''
    FOR SHARE`, [destination.workspace_id, itemKey, destinationKey, targetKey]);
  return result.rows[0] || null;
}

async function ensureVitrineProjectionTx(client, { epoch, destination,
  summary }) {
  if (summary.terminal !== true || Number(summary.counts?.sent || 0) < 1) return;
  await client.query(`INSERT INTO engine_universal_vitrine_outbox
    (operation_epoch_started_at,queue_item_id,workspace_id)
    VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
  [epoch, destination.queue_item_id, destination.workspace_id]);
}

async function confirmFactualSendTx(client, { destination, epoch, ack }) {
  const movement = await settleConfirmedTx(client, { epoch,
    workspaceId: destination.workspace_id, targetId: destination.id });
  const [itemKey, destinationKey, targetKey] = checkpointKeys(destination);
  const marked = await client.query(`UPDATE fila_checkpoints_entrega
    SET credito_debitado=TRUE,atualizado_em=clock_timestamp()
    WHERE cliente_id=$1 AND fila_item_id=$2 AND destino_chave=$3
      AND alvo_chave=$4 AND attempt_id=$5 AND estado='enviado'
      AND provider_message_id=$6`, [destination.workspace_id, itemKey,
    destinationKey, targetKey, ack.confirmation_key, ack.provider_message_id]);
  if (marked.rowCount !== 1) throw new Error("provider_ack_changed_during_reconciliation");
  await client.query(`UPDATE engine_universal_queue_destinations
    SET status='sent',confirmation_key=$2,provider_message_id=$3,
        credit_debited=TRUE,confirmed_at=COALESCE($4,clock_timestamp()),
        revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
  [destination.id, ack.confirmation_key, ack.provider_message_id, ack.confirmado_em]);
  await client.query(`INSERT INTO engine_universal_queue_destination_clock
    (operation_epoch_started_at,workspace_id,destination_id,last_confirmed_at)
    SELECT operation_epoch_started_at,workspace_id,destination_id,confirmed_at
    FROM engine_universal_queue_destinations WHERE id=$1
    ON CONFLICT (operation_epoch_started_at,workspace_id,destination_id)
    DO UPDATE SET last_confirmed_at=GREATEST(
      engine_universal_queue_destination_clock.last_confirmed_at,
      EXCLUDED.last_confirmed_at),updated_at=clock_timestamp()`, [destination.id]);
  const states = (await client.query(`SELECT status
    FROM engine_universal_queue_destinations WHERE queue_item_id=$1`,
  [destination.queue_item_id])).rows;
  const summary = classificarFilaUniversal(states);
  await client.query(`UPDATE engine_universal_queue_items
    SET status=$2,terminal_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
        revision=revision+1,updated_at=clock_timestamp()
    WHERE id=$1`, [destination.queue_item_id, summary.status, summary.terminal]);
  await ensureVitrineProjectionTx(client, { epoch, destination, summary });
  await client.query(`UPDATE engine_universal_queue_workspace_state
    SET health=CASE WHEN health='AMBIGUOUS' THEN 'UNKNOWN' ELSE health END,
        revision=revision+1,checkpoint_revision=revision+1,
        updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [epoch, destination.workspace_id]);
  return { ok: true, duplicate: false, itemStatus: summary.status,
    terminal: summary.terminal, ledgerId: movement.ledgerId };
}

async function enqueue({ pool, workspaceId, jobId, ofertaId, itemPayload,
  destinations }) {
  const workspace = String(workspaceId || "").trim();
  if (!workspace || !Number.isSafeInteger(Number(jobId)) || Number(jobId) <= 0 ||
      !Number.isSafeInteger(Number(ofertaId)) || Number(ofertaId) <= 0 || !itemPayload ||
      typeof itemPayload !== "object" || Array.isArray(itemPayload)) {
    throw new Error("queue_item_invalid");
  }
  const targets = validarDestinos(destinations);
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const source = (await client.query(`SELECT e.id AS evento_id,e.capturado_em,
        COALESCE(NULLIF(j.metadata->>'origemFluxo',''),
          NULLIF(e.metadata->>'origemFluxo',''),e.origem) AS origem_fluxo
      FROM engine_jobs_cliente j
      JOIN engine_eventos_brutos e ON e.id=j.evento_id
      JOIN engine_ofertas o ON o.id=$3 AND o.evento_id=e.id
      WHERE j.id=$2 AND j.cliente_id=$1 AND j.oferta_id=o.id
      FOR SHARE OF j,e,o`, [workspace, jobId, ofertaId])).rows[0];
    if (!source) throw new Error("queue_offer_workspace_identity_unproven");
    const capturedAt = new Date(source.capturado_em).toISOString();
    const eligibility = exigirCapturaUniversal({ capturedAt, state });
    if (!eligibility.ok) throw new Error(eligibility.reason);
    const epoch = state.operationEpochStartedAt;
    const inserted = (await client.query(`INSERT INTO engine_universal_queue_items
      (operation_epoch_started_at,workspace_id,evento_id,job_id,oferta_id,
       origem_fluxo,capturado_em,item_payload,status,terminal_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
        CASE WHEN $9='no_opportunity' THEN clock_timestamp() ELSE NULL END)
      ON CONFLICT (operation_epoch_started_at,workspace_id,oferta_id) DO NOTHING
      RETURNING id`, [epoch, workspace, source.evento_id, jobId, ofertaId,
      source.origem_fluxo, capturedAt, JSON.stringify(itemPayload),
      targets.length ? "pending" : "no_opportunity"])).rows[0];
    const item = inserted || (await client.query(`SELECT id,job_id,evento_id,
        capturado_em,origem_fluxo FROM engine_universal_queue_items
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND oferta_id=$3
      FOR UPDATE`, [epoch, workspace, ofertaId])).rows[0];
    if (!item) throw new Error("queue_item_missing_after_conflict");
    if (!inserted && (String(item.job_id) !== String(jobId) ||
        String(item.evento_id) !== String(source.evento_id) ||
        new Date(item.capturado_em).toISOString() !== capturedAt ||
        item.origem_fluxo !== source.origem_fluxo)) {
      throw new Error("queue_existing_identity_conflict");
    }
    if (inserted) {
      // The durable payload must carry the same stable identity returned to
      // the Distributor; a restart may never reconstruct a random queue ID.
      await client.query(`UPDATE engine_universal_queue_items
        SET item_payload=jsonb_set(
          jsonb_set(item_payload,'{id}',to_jsonb($2::text),true),
          '{operationEpochStartedAt}',to_jsonb($3::text),true)
        WHERE id=$1`, [item.id, `universal_${item.id}`, epoch]);
      const byDestination = new Map();
      for (const target of targets) {
        if (!byDestination.has(target.destinationId))
          byDestination.set(target.destinationId, []);
        byDestination.get(target.destinationId).push(target);
      }
      const ownerIds = new Map();
      for (const [destinationId, group] of byDestination) {
        const ownerId = ownerIdFor({ epoch, workspace, itemId: item.id,
          destinationId });
        const snapshotHash = hashStable(group.map(target => [target.channel,
          target.targetKey,target.connectionId]).sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b))));
        await client.query(`INSERT INTO engine_universal_fanout_owners
          (owner_id,queue_item_id,operation_epoch_started_at,workspace_id,
           destination_id,target_snapshot_hash)
          VALUES ($1,$2,$3,$4,$5,$6)`, [ownerId,item.id,epoch,workspace,
          destinationId,snapshotHash]);
        ownerIds.set(destinationId, ownerId);
      }
      for (const target of targets) {
        await client.query(`INSERT INTO engine_universal_queue_destinations
          (queue_item_id,operation_epoch_started_at,workspace_id,
           destination_id,fanout_owner_id,target_key,connection_id,channel)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [item.id, epoch, workspace,
          target.destinationId, ownerIds.get(target.destinationId),
          target.targetKey, target.connectionId || null, target.channel]);
      }
      await client.query(`INSERT INTO engine_universal_queue_workspace_state
        (operation_epoch_started_at,workspace_id,health,revision)
        VALUES ($1,$2,'UNKNOWN',1)
        ON CONFLICT (operation_epoch_started_at,workspace_id) DO UPDATE
          SET health='UNKNOWN',revision=engine_universal_queue_workspace_state.revision+1,
              updated_at=clock_timestamp()`, [epoch, workspace]);
    } else {
      const existing = (await client.query(`SELECT destination_id,target_key,
        connection_id,channel
        FROM engine_universal_queue_destinations WHERE queue_item_id=$1
        ORDER BY destination_id,target_key`, [item.id])).rows;
      const expected = [...targets].sort((a, b) =>
        a.destinationId.localeCompare(b.destinationId) ||
        a.targetKey.localeCompare(b.targetKey));
      if (JSON.stringify(existing.map(row => [row.destination_id,row.target_key,
        row.connection_id || "",row.channel])) !==
          JSON.stringify(expected.map(row => [row.destinationId,row.targetKey,
            row.connectionId,row.channel]))) {
        throw new Error("queue_existing_fanout_conflict");
      }
    }
    return { ok: true, itemId: item.id, created: Boolean(inserted),
      workspaceId: workspace, operationEpochStartedAt: epoch };
  });
}

async function preflightWorkspace({ pool, workspaceId }) {
  const workspace = String(workspaceId || "").trim();
  if (!workspace) throw new Error("queue_workspace_required");
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const row = (await client.query(`SELECT health,revision,checkpoint_revision
      FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, workspace])).rows[0];
    if (!row) return { ok: true, empty: true, workspaceId: workspace };
    if (Number(row.revision) !== Number(row.checkpoint_revision) &&
        row.health !== "UNKNOWN") {
      // An unaccounted revision cannot be reconstructed by copying the current
      // value into the checkpoint. Keep this workspace closed for diagnosis.
      return { ok: false, health: "AMBIGUOUS", workspaceId: workspace,
        reason: "workspace_checkpoint_revision_mismatch" };
    }
    // First reconcile the durable provider ACK, including targets that a
    // previous preflight conservatively marked ambiguous. Never resend them.
    const recoverable = (await client.query(`SELECT id,queue_item_id,workspace_id,
        destination_id,target_key,channel,status,lease_token
      FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND (status='ambiguous' OR
          (status='send_started' AND lease_until<clock_timestamp()))
      ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED`,
    [epoch, workspace, RECOVERY_BATCH])).rows;
    let recoveredAcks = 0;
    for (const target of recoverable) {
      const ack = await factualAckTx(client, target);
      if (!ack) continue;
      await confirmFactualSendTx(client, { destination: target, epoch, ack });
      recoveredAcks += 1;
    }
    // Only a send without a factual ACK remains ambiguous. A held credit is
    // retained until confirmed ACK or proven no-effect, never spent here.
    const uncertain = (await client.query(`WITH due AS (
      SELECT id FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND status='send_started' AND lease_until<clock_timestamp()
      ORDER BY lease_until,id LIMIT $3 FOR UPDATE SKIP LOCKED)
      UPDATE engine_universal_queue_destinations d
        SET status='ambiguous',revision=d.revision+1,
            updated_at=clock_timestamp()
      FROM due WHERE d.id=due.id RETURNING d.id`,
    [epoch, workspace, RECOVERY_BATCH])).rows.length;
    const reset = (await client.query(`WITH due AS (
      SELECT id FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND status='claimed' AND send_started_at IS NULL
        AND lease_until<clock_timestamp()
      ORDER BY lease_until,id LIMIT $3 FOR UPDATE SKIP LOCKED)
      UPDATE engine_universal_queue_destinations d
        SET status='pending',lease_token=NULL,lease_until=NULL,
            revision=d.revision+1,updated_at=clock_timestamp()
      FROM due WHERE d.id=due.id RETURNING d.id`,
    [epoch, workspace, RECOVERY_BATCH])).rows.length;
    const ambiguous = (await client.query(`SELECT 1
      FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND status='ambiguous' LIMIT 1`, [epoch, workspace])).rowCount > 0;
    const moreDue = (await client.query(`SELECT 1
      FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND ((status='claimed' AND lease_until<clock_timestamp()) OR
             (status='send_started' AND lease_until<clock_timestamp()))
      LIMIT 1`, [epoch, workspace])).rowCount > 0;
    const health = ambiguous ? "AMBIGUOUS" : moreDue ? "RECOVERING" : "HEALTHY";
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET health=$3,revision=revision+$4,
          checkpoint_revision=revision+$4,checked_at=clock_timestamp(),
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace, health, uncertain + reset]);
    return { ok: health === "HEALTHY", health, workspaceId: workspace,
      recoveredClaims: reset, recoveredAcks, ambiguousSends: uncertain };
  });
}

async function claimDestination({ pool, workspaceId, leaseMs = 30000 }) {
  const workspace = String(workspaceId || "").trim();
  if (!workspace) throw new Error("queue_workspace_required");
  const duration = Math.max(1000, Math.min(120000, Math.floor(Number(leaseMs) || 30000)));
  try { return await transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const health = (await client.query(`SELECT health,revision,checkpoint_revision
      FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, workspace])).rows[0];
    if (!health || health.health !== "HEALTHY" ||
        Number(health.revision) !== Number(health.checkpoint_revision)) {
      return { ok: false, reason: "workspace_preflight_required" };
    }
    const unsafe = (await client.query(`SELECT 1
      FROM engine_universal_queue_destinations
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND
        (status='ambiguous' OR
         (status IN ('claimed','send_started') AND lease_until<clock_timestamp()))
      LIMIT 1`, [epoch, workspace])).rowCount > 0;
    if (unsafe) return { ok: false, reason: "workspace_recovery_required" };
    const target = (await client.query(`SELECT d.id,d.workspace_id,d.queue_item_id,d.destination_id,
        d.fanout_owner_id,d.target_key,d.connection_id,d.channel,d.revision,
        i.item_payload,i.capturado_em,i.origem_fluxo,
        i.oferta_id,i.evento_id
      FROM engine_universal_queue_destinations d
      JOIN engine_universal_queue_items i ON i.id=d.queue_item_id
      WHERE d.operation_epoch_started_at=$1 AND d.workspace_id=$2
        AND d.status='pending' AND d.available_at<=clock_timestamp()
        AND i.terminal_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM engine_universal_queue_destinations active
          WHERE active.operation_epoch_started_at=d.operation_epoch_started_at
            AND active.workspace_id=d.workspace_id
            AND active.destination_id=d.destination_id
            AND active.status IN ('claimed','send_started'))
      ORDER BY d.available_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
    [epoch, workspace])).rows[0];
    if (!target) return { ok: true, empty: true };
    const token = randomUUID();
    await client.query(`UPDATE engine_universal_queue_destinations
      SET status='claimed',lease_token=$2,
          lease_until=clock_timestamp()+($3::integer * interval '1 millisecond'),
          revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND status='pending'`, [target.id, token, duration]);
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET revision=revision+1,checkpoint_revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace]);
    return { ok: true, empty: false, ...target, leaseToken: token,
      operationEpochStartedAt: epoch };
  }); } catch (error) {
    if (error?.code === "23505" &&
        error?.constraint === "engine_uq_one_active_destination_idx") {
      return { ok: true, empty: true, contention: true };
    }
    throw error;
  }
}

async function markSendStarted({ pool, destinationId, leaseToken,
  commercialCta = {} }) {
  if (!commercialCta || typeof commercialCta !== "object" ||
      Array.isArray(commercialCta) ||
      Buffer.byteLength(JSON.stringify(commercialCta), "utf8") > 16384) {
    throw new Error("universal_commercial_cta_invalid");
  }
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const candidate = (await client.query(`SELECT workspace_id FROM
      engine_universal_queue_destinations WHERE id=$1
        AND operation_epoch_started_at=$2 AND lease_token=$3
        AND status='claimed' AND lease_until>clock_timestamp()
      `, [destinationId, state.operationEpochStartedAt,
      leaseToken])).rows[0];
    if (!candidate) return { ok: false, reason: "claim_not_current" };
    const health = (await client.query(`SELECT health,revision,checkpoint_revision
      FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [state.operationEpochStartedAt, candidate.workspace_id])).rows[0];
    if (!health || health.health !== "HEALTHY" ||
        Number(health.revision) !== Number(health.checkpoint_revision)) {
      return { ok: false, reason: "workspace_preflight_required" };
    }
    const hold = await holdForTargetTx(client, {
      epoch: state.operationEpochStartedAt,
      workspaceId: candidate.workspace_id, targetId: destinationId });
    if (!hold.ok) return hold;
    const row = (await client.query(`UPDATE engine_universal_queue_destinations
      SET status='send_started',send_started_at=clock_timestamp(),
          commercial_cta=$4::jsonb,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND operation_epoch_started_at=$3 AND lease_token=$2
        AND status='claimed' AND lease_until>clock_timestamp()
      RETURNING workspace_id`, [destinationId, leaseToken,
      state.operationEpochStartedAt, JSON.stringify(commercialCta)])).rows[0];
    if (!row) throw new Error("claim_lost_after_credit_hold");
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET revision=revision+1,checkpoint_revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [state.operationEpochStartedAt, row.workspace_id]);
    return { ok: true };
  });
}

async function releaseUnstarted({ pool, destinationId, leaseToken, retryAt }) {
  const availableAt = retryAt == null ? null : new Date(retryAt);
  if (availableAt && !Number.isFinite(availableAt.getTime())) {
    throw new Error("queue_retry_at_invalid");
  }
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const identity = (await client.query(`SELECT workspace_id FROM
      engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2`,
    [destinationId, epoch])).rows[0];
    if (!identity) return { ok: false, reason: "claim_not_current" };
    await client.query(`SELECT 1 FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, identity.workspace_id]);
    const released = (await client.query(`UPDATE engine_universal_queue_destinations
      SET status='pending',lease_token=NULL,lease_until=NULL,
          available_at=COALESCE($4::timestamptz,clock_timestamp()),
          revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND operation_epoch_started_at=$2
        AND status='claimed' AND lease_token=$3 AND send_started_at IS NULL
      RETURNING workspace_id`, [destinationId, epoch, leaseToken,
      availableAt?.toISOString() || null])).rows[0];
    if (!released) return { ok: false, reason: "claim_not_releasable" };
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET revision=revision+1,checkpoint_revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, released.workspace_id]);
    return { ok: true };
  });
}

async function readDestinationClock({ pool, workspaceId, destinationId }) {
  const workspace = String(workspaceId || "").trim();
  const destination = String(destinationId || "").trim();
  if (!workspace || !destination || !pool || typeof pool.query !== "function") {
    throw new Error("destination_clock_identity_required");
  }
  const result = await pool.query(`SELECT c.last_confirmed_at
    FROM engine_operation_state s
    LEFT JOIN engine_universal_queue_destination_clock c
      ON c.operation_epoch_started_at=s.operation_epoch_started_at
     AND c.workspace_id=$1 AND c.destination_id=$2
    WHERE s.id=1 AND s.mode='UNIVERSAL'`, [workspace, destination]);
  if (result.rowCount !== 1) throw new Error("universal_mode_not_active");
  return result.rows[0].last_confirmed_at || null;
}

async function readDestinationDailyUsage({ pool, workspaceId, destinationId }) {
  const workspace = String(workspaceId || "").trim();
  const destination = String(destinationId || "").trim();
  if (!workspace || !destination || !pool || typeof pool.query !== "function") {
    throw new Error("destination_daily_limit_identity_required");
  }
  const result = await pool.query(`SELECT count(d.id)::int AS sent_today,
    (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 1)
      ::timestamp AT TIME ZONE 'America/Sao_Paulo') AS next_reset_at
    FROM engine_operation_state s
    LEFT JOIN engine_universal_queue_destinations d
      ON d.operation_epoch_started_at=s.operation_epoch_started_at
     AND d.workspace_id=$1 AND d.destination_id=$2 AND d.status='sent'
     AND d.confirmed_at >= ((clock_timestamp() AT TIME ZONE
       'America/Sao_Paulo')::date AT TIME ZONE 'America/Sao_Paulo')
    WHERE s.id=1 AND s.mode='UNIVERSAL'
    GROUP BY s.id`, [workspace, destination]);
  if (result.rowCount !== 1) throw new Error("universal_mode_not_active");
  return { sentToday: Number(result.rows[0].sent_today),
    nextResetAt: result.rows[0].next_reset_at };
}

async function countConfirmedToday(args) {
  return (await readDestinationDailyUsage(args)).sentToday;
}

async function confirmSend({ pool, destinationId, leaseToken,
  confirmationKey, providerMessageId }) {
  const factKey = String(confirmationKey || "").trim();
  const messageId = String(providerMessageId || "").trim();
  if (!factKey || !messageId) {
    throw new Error("send_confirmation_fact_required");
  }
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const identity = (await client.query(`SELECT workspace_id FROM
      engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2`,
    [destinationId, epoch])).rows[0];
    if (!identity) throw new Error("send_confirmation_identity_conflict");
    await client.query(`SELECT 1 FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, identity.workspace_id]);
    const destination = (await client.query(`SELECT id,queue_item_id,status,
        lease_token,confirmation_key,provider_message_id,credit_debited,workspace_id,
        destination_id,target_key,channel
      FROM engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2 FOR UPDATE`,
    [destinationId, epoch])).rows[0];
    if (!destination || String(destination.lease_token) !== String(leaseToken)) {
      throw new Error("send_confirmation_identity_conflict");
    }
    if (destination.status === "sent") {
      if (destination.confirmation_key !== factKey ||
          String(destination.provider_message_id || "") !== messageId ||
          destination.credit_debited !== true) {
        throw new Error("provider_confirmation_conflict");
      }
      return { ok: true, duplicate: true };
    }
    if (!["send_started", "ambiguous"].includes(destination.status)) {
      throw new Error("send_not_started");
    }
    const ack = await factualAckTx(client, destination);
    if (!ack || ack.confirmation_key !== factKey ||
        ack.provider_message_id !== messageId) {
      throw new Error("provider_confirmation_not_durable_or_conflicting");
    }
    return confirmFactualSendTx(client, { destination, epoch, ack });
  });
}

async function confirmFailure({ pool, destinationId, leaseToken,
  reason, evidence }) {
  const failureReason = String(reason || "").trim();
  const fact = String(evidence || "").trim();
  if (!failureReason || !["local_before_transport",
    "provider_no_effect_confirmed"].includes(fact)) {
    throw new Error("send_failure_fact_required");
  }
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const identity = (await client.query(`SELECT workspace_id FROM
      engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2`,
    [destinationId, epoch])).rows[0];
    if (!identity) throw new Error("send_failure_identity_conflict");
    await client.query(`SELECT 1 FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, identity.workspace_id]);
    const destination = (await client.query(`SELECT queue_item_id,status,
      lease_token,terminal_reason,workspace_id
      FROM engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2 FOR UPDATE`,
    [destinationId, epoch])).rows[0];
    if (!destination || String(destination.lease_token) !== String(leaseToken)) {
      throw new Error("send_failure_identity_conflict");
    }
    if (destination.status === "failed") {
      if (destination.terminal_reason !== failureReason) {
        throw new Error("send_failure_fact_conflict");
      }
      return { ok: true, duplicate: true };
    }
    const permitted = fact === "local_before_transport"
      ? destination.status === "claimed"
      : ["send_started", "ambiguous"].includes(destination.status);
    if (!permitted) throw new Error("send_failure_boundary_unproven");
    if (fact === "provider_no_effect_confirmed") {
      await releaseForTargetTx(client, { epoch,
        workspaceId: destination.workspace_id, targetId: destinationId });
    }
    await client.query(`UPDATE engine_universal_queue_destinations
      SET status='failed',terminal_reason=$2,revision=revision+1,
        updated_at=clock_timestamp() WHERE id=$1`,
    [destinationId, failureReason]);
    const states = (await client.query(`SELECT status
      FROM engine_universal_queue_destinations WHERE queue_item_id=$1`,
    [destination.queue_item_id])).rows;
    const summary = classificarFilaUniversal(states);
    await client.query(`UPDATE engine_universal_queue_items
      SET status=$2,terminal_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1`, [destination.queue_item_id, summary.status, summary.terminal]);
    await ensureVitrineProjectionTx(client, { epoch, destination, summary });
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET health=CASE WHEN health='AMBIGUOUS' THEN 'UNKNOWN' ELSE health END,
          revision=revision+1,checkpoint_revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, destination.workspace_id]);
    return { ok: true, duplicate: false, itemStatus: summary.status,
      terminal: summary.terminal };
  });
}

async function completeWithoutSend({ pool, destinationId, leaseToken,
  reason }) {
  const terminalReason = String(reason || "").trim();
  if (!terminalReason) throw new Error("no_send_terminal_reason_required");
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const identity = (await client.query(`SELECT workspace_id FROM
      engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2`,
    [destinationId, epoch])).rows[0];
    if (!identity) throw new Error("no_send_identity_conflict");
    await client.query(`SELECT 1 FROM engine_universal_queue_workspace_state
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, identity.workspace_id]);
    const destination = (await client.query(`SELECT queue_item_id,status,
      lease_token,terminal_reason,workspace_id
      FROM engine_universal_queue_destinations
      WHERE id=$1 AND operation_epoch_started_at=$2 FOR UPDATE`,
    [destinationId, epoch])).rows[0];
    if (!destination || String(destination.lease_token) !== String(leaseToken)) {
      throw new Error("no_send_identity_conflict");
    }
    if (destination.status === "skipped") {
      if (destination.terminal_reason !== terminalReason) {
        throw new Error("no_send_fact_conflict");
      }
      return { ok: true, duplicate: true };
    }
    if (destination.status !== "claimed") {
      throw new Error("no_send_boundary_unproven");
    }
    await client.query(`UPDATE engine_universal_queue_destinations
      SET status='skipped',terminal_reason=$2,revision=revision+1,
          updated_at=clock_timestamp() WHERE id=$1`,
    [destinationId, terminalReason]);
    const states = (await client.query(`SELECT status
      FROM engine_universal_queue_destinations WHERE queue_item_id=$1`,
    [destination.queue_item_id])).rows;
    const summary = classificarFilaUniversal(states);
    await client.query(`UPDATE engine_universal_queue_items
      SET status=$2,terminal_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1`, [destination.queue_item_id, summary.status, summary.terminal]);
    await ensureVitrineProjectionTx(client, { epoch, destination, summary });
    await client.query(`UPDATE engine_universal_queue_workspace_state
      SET revision=revision+1,checkpoint_revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, destination.workspace_id]);
    return { ok: true, duplicate: false, itemStatus: summary.status,
      terminal: summary.terminal };
  });
}

async function claimVitrineProjection({ pool }) {
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const epoch = state.operationEpochStartedAt;
    const row = (await client.query(`SELECT queue_item_id,workspace_id,attempts
      FROM engine_universal_vitrine_outbox
      WHERE operation_epoch_started_at=$1 AND (
        (state='pending' AND (lease_until IS NULL OR
          lease_until<=clock_timestamp())) OR
        (state='processing' AND lease_until<=clock_timestamp()))
      ORDER BY created_at,queue_item_id
      FOR UPDATE SKIP LOCKED LIMIT 1`, [epoch])).rows[0];
    if (!row) return { ok: true, empty: true };
    const token = randomUUID();
    await client.query(`UPDATE engine_universal_vitrine_outbox
      SET state='processing',lease_token=$3,lease_until=clock_timestamp()+
        interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND queue_item_id=$2`,
    [epoch, row.queue_item_id, token]);
    const item = (await client.query(`SELECT i.item_payload,i.status,i.terminal_at,
        (SELECT count(*)::int FROM engine_universal_queue_destinations d
          WHERE d.queue_item_id=i.id AND d.status='sent') AS confirmed,
        (SELECT d.commercial_cta FROM engine_universal_queue_destinations d
          WHERE d.queue_item_id=i.id AND d.status='sent'
          ORDER BY d.confirmed_at,d.id LIMIT 1) AS commercial_cta
      FROM engine_universal_queue_items i
      WHERE i.id=$1 AND i.operation_epoch_started_at=$2
        AND i.workspace_id=$3`,
    [row.queue_item_id, epoch, row.workspace_id])).rows[0];
    if (!item || !item.terminal_at || Number(item.confirmed) < 1 ||
        !["sent", "partial"].includes(item.status)) {
      throw new Error("universal_vitrine_projection_fact_missing");
    }
    return { ok: true, empty: false, operationEpochStartedAt: epoch,
      queueItemId: row.queue_item_id, workspaceId: row.workspace_id,
      leaseToken: token, attempts: Number(row.attempts) + 1,
      itemPayload: item.item_payload,
      commercialCta: item.commercial_cta || {},
      terminalAt: item.terminal_at, confirmed: Number(item.confirmed) };
  });
}

async function finishVitrineProjection({ pool, claim, result,
  retryAt, reason = "" }) {
  if (!claim?.leaseToken || !claim?.queueItemId ||
      !["completed", "skipped", "failed", "retry"].includes(result)) {
    throw new Error("universal_vitrine_projection_result_invalid");
  }
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    if (state.operationEpochStartedAt !==
        new Date(claim.operationEpochStartedAt).toISOString()) {
      throw new Error("universal_vitrine_projection_epoch_conflict");
    }
    const next = result === "retry" ? "pending" : result;
    const retry = result === "retry"
      ? new Date(retryAt || Date.now() + 30000).toISOString() : null;
    const updated = await client.query(`UPDATE engine_universal_vitrine_outbox
      SET state=$4,lease_token=NULL,lease_until=$5,
          last_result=$6,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND queue_item_id=$2
        AND lease_token=$3 AND state='processing'`,
    [state.operationEpochStartedAt, claim.queueItemId, claim.leaseToken,
      next, retry, String(reason || result).slice(0, 200)]);
    if (updated.rowCount !== 1) throw new Error("universal_vitrine_projection_lease_lost");
    return { ok: true, state: next };
  });
}

async function cleanupVitrineProjections({ pool, limit = 20 }) {
  const size = Math.max(1, Math.min(100, Number(limit) || 20));
  return transaction(pool, async client => {
    const state = await activeEpoch(client);
    const removed = await client.query(`DELETE FROM engine_universal_vitrine_outbox
      WHERE (operation_epoch_started_at,queue_item_id) IN (
        SELECT operation_epoch_started_at,queue_item_id
        FROM engine_universal_vitrine_outbox
        WHERE operation_epoch_started_at=$1
          AND state IN ('completed','skipped','failed')
          AND updated_at<clock_timestamp()-interval '7 days'
        ORDER BY updated_at,queue_item_id LIMIT $2)`,
    [state.operationEpochStartedAt, size]);
    return { removed: removed.rowCount };
  });
}

module.exports = { enqueue, preflightWorkspace, claimDestination,
  markSendStarted, releaseUnstarted, readDestinationClock,
  readDestinationDailyUsage, countConfirmedToday, confirmSend,
  confirmFailure, completeWithoutSend, claimVitrineProjection,
  finishVitrineProjection, cleanupVitrineProjections,
  validarDestinos };
