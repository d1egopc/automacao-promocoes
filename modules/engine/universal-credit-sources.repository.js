"use strict";

// Additive, opt-in projection by financial source. The financial ledger is
// still the transaction authority. No workspace uses these paths until an
// explicit SHADOW -> ACTIVE cutover succeeds with an exact baseline hash.
const { createHash } = require("node:crypto");

function text(value) { return String(value ?? "").trim(); }
function amount(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("universal_credit_source_amount_invalid");
  }
  return number;
}
function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function movementKey(kind, epoch, workspaceId, targetId = "") {
  return `universal:${stableHash([kind, epoch, workspaceId, String(targetId)])}`;
}

async function transaction(pool, action) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("universal_credit_source_pool_required");
  }
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

async function workspaceModeTx(client, { epoch, workspaceId, lock = false }) {
  const result = await client.query(`SELECT mode,baseline_hash,
      baseline_balance,baseline_reserved,revision
    FROM engine_universal_credit_source_workspaces
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
    ${lock ? "FOR UPDATE" : ""}`, [epoch, workspaceId]);
  return result.rows[0] || null;
}

async function totalsTx(client, { epoch, workspaceId }) {
  const sources = (await client.query(`SELECT
      COALESCE(SUM(available+reserved),0)::int AS backed,
      COALESCE(SUM(reserved),0)::int AS reserved,
      COALESCE(SUM(available) FILTER (WHERE state='unclassified'),0)::int
        AS unclassified_available,
      COUNT(*) FILTER (WHERE state='unclassified')::int AS unclassified_sources
    FROM engine_universal_credit_sources
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [epoch, workspaceId])).rows[0];
  const holds = (await client.query(`SELECT
      COUNT(*) FILTER (WHERE state='held')::int AS held,
      COUNT(*) FILTER (WHERE state='held' AND source_id IS NULL)::int
        AS held_without_source
    FROM engine_universal_credit_holds
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [epoch, workspaceId])).rows[0];
  return { backed: Number(sources.backed), reserved: Number(sources.reserved),
    unclassifiedAvailable: Number(sources.unclassified_available),
    unclassifiedSources: Number(sources.unclassified_sources),
    held: Number(holds.held), heldWithoutSource: Number(holds.held_without_source) };
}

async function compareWorkspaceSourcesTx(client, { epoch, workspaceId,
  lockBalance = false }) {
  const balance = (await client.query(`SELECT balance,reserved,revision
    FROM engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
    ${lockBalance ? "FOR UPDATE" : ""}`, [epoch, workspaceId])).rows[0];
  if (!balance) throw new Error("universal_credit_source_balance_missing");
  const totals = await totalsTx(client, { epoch, workspaceId });
  const divergences = [];
  if (totals.backed !== Number(balance.balance)) divergences.push("balance");
  if (totals.reserved !== Number(balance.reserved)) divergences.push("reserved");
  if (totals.held !== Number(balance.reserved)) divergences.push("held_count");
  if (totals.heldWithoutSource !== 0) divergences.push("held_without_source");
  return { ok: divergences.length === 0, divergences,
    balance: Number(balance.balance), reserved: Number(balance.reserved),
    balanceRevision: Number(balance.revision), ...totals };
}

async function prepareShadowWorkspace({ pool, workspaceId }) {
  const workspace = text(workspaceId);
  if (!workspace) throw new Error("universal_credit_source_workspace_required");
  return transaction(pool, async client => {
    const operation = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (operation?.mode !== "UNIVERSAL" || !operation.operation_epoch_started_at) {
      throw new Error("universal_credit_source_mode_required");
    }
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const existing = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (existing) {
      const comparison = await compareWorkspaceSourcesTx(client, { epoch,
        workspaceId: workspace, lockBalance: true });
      return { ok: comparison.ok, duplicate: true, mode: existing.mode,
        baselineHash: existing.baseline_hash, ...comparison };
    }
    const balance = (await client.query(`SELECT balance,reserved,revision
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, workspace])).rows[0];
    if (!balance) throw new Error("universal_credit_source_balance_missing");
    const holds = (await client.query(`SELECT target_id
      FROM engine_universal_credit_holds
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND state='held'
      ORDER BY target_id FOR UPDATE`, [epoch, workspace])).rows;
    if (holds.length !== Number(balance.reserved)) {
      throw new Error("universal_credit_source_held_count_divergence");
    }
    const available = Number(balance.balance) - Number(balance.reserved);
    const baselineHash = stableHash([epoch, workspace, Number(balance.balance),
      Number(balance.reserved), Number(balance.revision),
      holds.map(row => String(row.target_id))]);
    let escrowId = null;
    if (holds.length) {
      escrowId = (await client.query(`INSERT INTO engine_universal_credit_sources
        (operation_epoch_started_at,workspace_id,source_key,source_kind,state,
         granted,available,reserved,consumed,expired,metadata)
        VALUES ($1,$2,$3,'legacy_escrow','escrow',$4,0,$4,0,0,$5::jsonb)
        RETURNING id`, [epoch, workspace, `legacy-escrow:${baselineHash}`,
        holds.length, JSON.stringify({ authority: "shadow_backfill",
          origin: "legacy_indeterminate" })])).rows[0].id;
      const mapped = await client.query(`UPDATE engine_universal_credit_holds
        SET source_id=$3,updated_at=clock_timestamp()
        WHERE operation_epoch_started_at=$1 AND workspace_id=$2
          AND state='held' AND source_id IS NULL`, [epoch, workspace, escrowId]);
      if (mapped.rowCount !== holds.length) {
        throw new Error("universal_credit_source_hold_backfill_conflict");
      }
    }
    if (available > 0) {
      await client.query(`INSERT INTO engine_universal_credit_sources
        (operation_epoch_started_at,workspace_id,source_key,source_kind,state,
         granted,available,reserved,consumed,expired,metadata)
        VALUES ($1,$2,$3,'legacy_unclassified','unclassified',$4,$4,0,0,0,$5::jsonb)`,
      [epoch, workspace, `legacy-unclassified:${baselineHash}`, available,
        JSON.stringify({ authority: "shadow_backfill",
          origin: "legacy_indeterminate" })]);
    }
    await client.query(`INSERT INTO engine_universal_credit_source_workspaces
      (operation_epoch_started_at,workspace_id,mode,baseline_hash,
       baseline_balance,baseline_reserved)
      VALUES ($1,$2,'SHADOW',$3,$4,$5)`, [epoch, workspace, baselineHash,
      Number(balance.balance), Number(balance.reserved)]);
    const comparison = await compareWorkspaceSourcesTx(client, { epoch,
      workspaceId: workspace });
    if (!comparison.ok) throw new Error(
      `universal_credit_source_shadow_divergence:${comparison.divergences.join(",")}`);
    return { ok: true, duplicate: false, mode: "SHADOW", baselineHash,
      escrowSourceId: escrowId, ...comparison };
  });
}

async function classifyLegacyAvailable({ pool, workspaceId, baselineHash,
  policy, reason }) {
  const workspace = text(workspaceId);
  const hash = text(baselineHash);
  const decision = text(policy);
  const auditReason = text(reason);
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash) ||
      !["preserve_admin", "expire"].includes(decision) || !auditReason) {
    throw new Error("universal_credit_source_classification_required");
  }
  return transaction(pool, async client => {
    const operation = (await client.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 AND mode='UNIVERSAL' FOR SHARE`)).rows[0];
    if (!operation) throw new Error("universal_credit_source_mode_required");
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const state = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (!state || state.mode !== "SHADOW" || state.baseline_hash !== hash) {
      throw new Error("universal_credit_source_baseline_conflict");
    }
    await client.query(`SELECT 1 FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, workspace]);
    const rows = (await client.query(`SELECT id,available,reserved
      FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND source_kind='legacy_unclassified' AND state='unclassified'
      FOR UPDATE`, [epoch, workspace])).rows;
    for (const row of rows) {
      if (decision === "preserve_admin") {
        await client.query(`UPDATE engine_universal_credit_sources
          SET source_kind='admin_topup',state='active',revision=revision+1,
              metadata=metadata||$2::jsonb,updated_at=clock_timestamp()
          WHERE id=$1`, [row.id, JSON.stringify({ classification: decision,
          reason: auditReason })]);
      } else {
        await client.query(`UPDATE engine_universal_credit_sources
          SET state=CASE WHEN reserved>0 THEN 'escrow' ELSE 'expired' END,
              expired=expired+available,available=0,revision=revision+1,
              metadata=metadata||$2::jsonb,updated_at=clock_timestamp()
          WHERE id=$1`, [row.id, JSON.stringify({ classification: decision,
          reason: auditReason })]);
      }
    }
    if (decision === "expire") {
      const totals = await totalsTx(client, { epoch, workspaceId: workspace });
      await client.query(`UPDATE engine_universal_credit_balances
        SET balance=$3,reserved=$4,revision=revision+1,
            updated_at=clock_timestamp()
        WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
      [epoch, workspace, totals.backed, totals.reserved]);
    }
    return { ok: true, classified: rows.length, policy: decision };
  });
}

async function activateWorkspaceSources({ pool, workspaceId, baselineHash }) {
  const workspace = text(workspaceId);
  const hash = text(baselineHash);
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("universal_credit_source_activation_identity_invalid");
  }
  return transaction(pool, async client => {
    const operation = (await client.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 AND mode='UNIVERSAL' FOR SHARE`)).rows[0];
    if (!operation) throw new Error("universal_credit_source_mode_required");
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const state = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (!state || state.baseline_hash !== hash) {
      throw new Error("universal_credit_source_baseline_conflict");
    }
    if (state.mode === "ACTIVE") return { ok: true, duplicate: true };
    const comparison = await compareWorkspaceSourcesTx(client, { epoch,
      workspaceId: workspace, lockBalance: true });
    if (!comparison.ok || comparison.unclassifiedSources > 0) {
      throw new Error(`universal_credit_source_cutover_blocked:${[
        ...comparison.divergences,
        ...(comparison.unclassifiedSources ? ["legacy_unclassified"] : [])
      ].join(",")}`);
    }
    await client.query(`UPDATE engine_universal_credit_source_workspaces
      SET mode='ACTIVE',activated_at=clock_timestamp(),revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND mode='SHADOW'`,
    [epoch, workspace]);
    return { ok: true, duplicate: false, ...comparison };
  });
}

async function recomputeAggregateTx(client, { epoch, workspaceId }) {
  const totals = await totalsTx(client, { epoch, workspaceId });
  if (totals.heldWithoutSource !== 0 || totals.held !== totals.reserved) {
    throw new Error("universal_credit_source_hold_projection_divergence");
  }
  const updated = await client.query(`UPDATE engine_universal_credit_balances
    SET balance=$3,reserved=$4,revision=revision+1,updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
    RETURNING revision`, [epoch, workspaceId, totals.backed, totals.reserved]);
  if (updated.rowCount !== 1) throw new Error("universal_credit_source_balance_missing");
  return { ...totals, revision: Number(updated.rows[0].revision) };
}

async function applyLedgerTx(client, { epoch, movement }) {
  const workspaceId = movement.cliente_id;
  const mode = await workspaceModeTx(client, { epoch, workspaceId, lock: true });
  if (mode?.mode !== "ACTIVE") return { handled: false };
  const balance = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 FOR UPDATE`, [epoch, workspaceId])).rows[0];
  if (!balance) throw new Error("universal_credit_source_balance_missing");
  const existing = (await client.query(`SELECT id FROM
    engine_universal_credit_sources WHERE ledger_id=$1 FOR UPDATE`,
  [movement.id])).rows[0];
  if (existing) return { handled: true, ok: true, applied: false,
    workspaceId, sourceId: existing.id };
  const value = Number(movement.amount);
  if (!Number.isSafeInteger(value)) throw new Error("universal_financial_policy_invalid");
  let sourceId = null;
  if (["replace_cycle", "set"].includes(movement.balance_policy)) {
    if (movement.ledger_type !== "cycle_credit" || value < 0 ||
        !movement.cycle_start || !movement.cycle_end) {
      throw new Error("universal_credit_source_cycle_invalid");
    }
    await client.query(`UPDATE engine_universal_credit_sources
      SET expired=expired+available,available=0,
          state=CASE WHEN reserved>0 THEN 'escrow' ELSE 'expired' END,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND source_kind IN ('opening','cycle') AND state='active'`,
    [epoch, workspaceId]);
    sourceId = (await client.query(`INSERT INTO engine_universal_credit_sources
      (operation_epoch_started_at,workspace_id,source_key,ledger_id,source_kind,
       state,cycle_start,cycle_end,granted,available,reserved,consumed,expired,
       metadata)
      VALUES ($1,$2,$3,$4,'cycle','active',$5,$6,$7,$7,0,0,0,$8::jsonb)
      RETURNING id`, [epoch, workspaceId, `ledger:${movement.id}`, movement.id,
      movement.cycle_start, movement.cycle_end, value,
      JSON.stringify({ authority: "financial_credit_ledger",
        ledgerType: movement.ledger_type })])).rows[0].id;
  } else if (movement.balance_policy === "add" && value > 0) {
    sourceId = (await client.query(`INSERT INTO engine_universal_credit_sources
      (operation_epoch_started_at,workspace_id,source_key,ledger_id,source_kind,
       state,granted,available,reserved,consumed,expired,metadata)
      VALUES ($1,$2,$3,$4,'admin_topup','active',$5,$5,0,0,0,$6::jsonb)
      RETURNING id`, [epoch, workspaceId, `ledger:${movement.id}`, movement.id,
      value, JSON.stringify({ authority: "financial_credit_ledger",
        ledgerType: movement.ledger_type })])).rows[0].id;
  } else {
    throw new Error("universal_credit_source_policy_not_supported");
  }
  const aggregate = await recomputeAggregateTx(client, { epoch, workspaceId });
  await client.query(`UPDATE financial_credit_ledger
    SET operation_epoch_started_at=$2,
        universal_movement_type='FINANCIAL_MOVEMENT',
        universal_balance_revision=$3,universal_balance_after=$4,
        universal_credit_source_id=$5
    WHERE id=$1`, [movement.id, epoch, aggregate.revision,
    aggregate.backed, sourceId]);
  return { handled: true, ok: true, applied: true, workspaceId,
    balance: aggregate.backed, sourceId };
}

async function addAdminTopupTx(client, { epoch, workspaceId, amount: delta,
  idempotencyKey, reason, operatorId }) {
  const mode = await workspaceModeTx(client, { epoch, workspaceId, lock: true });
  if (mode?.mode !== "ACTIVE") return { handled: false };
  const balance = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 FOR UPDATE`, [epoch, workspaceId])).rows[0];
  if (!balance) throw new Error("universal_admin_credit_opening_missing");
  const existing = (await client.query(`SELECT id,cliente_id,amount,
      operation_epoch_started_at,universal_movement_type,balance_policy,
      universal_credit_source_id
    FROM financial_credit_ledger WHERE idempotency_key=$1 FOR UPDATE`,
  [idempotencyKey])).rows[0];
  if (existing) {
    if (existing.cliente_id !== workspaceId || Number(existing.amount) !== delta ||
        new Date(existing.operation_epoch_started_at).toISOString() !== epoch ||
        existing.universal_movement_type !== "FINANCIAL_MOVEMENT" ||
        existing.balance_policy !== "add" || !existing.universal_credit_source_id) {
      throw new Error("universal_admin_credit_idempotency_conflict");
    }
    return { handled: true, ok: true, duplicate: true, delta,
      balance: Number(balance.balance), reserved: Number(balance.reserved),
      available: Number(balance.balance) - Number(balance.reserved),
      sourceId: existing.universal_credit_source_id };
  }
  const inserted = (await client.query(`INSERT INTO financial_credit_ledger
    (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
     projection_status,metadata)
    VALUES ($1,'admin_credit',$2,'add',$3,$4,'projected',$5::jsonb)
    RETURNING id`, [workspaceId, delta, text(reason).slice(0, 200),
    idempotencyKey, JSON.stringify({ authority: "postgresql_universal",
      origin: "admin_credit_topup", operatorId: text(operatorId) })])).rows[0];
  const source = (await client.query(`INSERT INTO engine_universal_credit_sources
    (operation_epoch_started_at,workspace_id,source_key,ledger_id,source_kind,
     state,granted,available,reserved,consumed,expired,metadata)
    VALUES ($1,$2,$3,$4,'admin_topup','active',$5,$5,0,0,0,$6::jsonb)
    RETURNING id`, [epoch, workspaceId, `ledger:${inserted.id}`, inserted.id,
    delta, JSON.stringify({ authority: "financial_credit_ledger",
      origin: "admin_credit_topup" })])).rows[0];
  const aggregate = await recomputeAggregateTx(client, { epoch, workspaceId });
  await client.query(`UPDATE financial_credit_ledger
    SET operation_epoch_started_at=$2,
        universal_movement_type='FINANCIAL_MOVEMENT',
        universal_balance_revision=$3,universal_balance_after=$4,
        universal_credit_source_id=$5
    WHERE id=$1`, [inserted.id, epoch, aggregate.revision,
    aggregate.backed, source.id]);
  return { handled: true, ok: true, duplicate: false, delta,
    balanceBefore: Number(balance.balance), balance: aggregate.backed,
    reserved: aggregate.reserved,
    available: aggregate.backed - aggregate.reserved,
    revision: aggregate.revision, sourceId: source.id };
}

async function holdForTargetTx(client, { epoch, workspaceId, targetId }) {
  const mode = await workspaceModeTx(client, { epoch, workspaceId, lock: true });
  if (mode?.mode !== "ACTIVE") return { handled: false };
  await client.query(`SELECT 1 FROM engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
  [epoch, workspaceId]);
  const existing = (await client.query(`SELECT state FROM
    engine_universal_credit_holds WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 AND target_id=$3 FOR UPDATE`,
  [epoch, workspaceId, targetId])).rows[0];
  if (existing) return { handled: true, ok: false,
    reason: "universal_credit_hold_existing" };
  const entitlement = (await client.query(`SELECT 1 FROM
    engine_universal_credit_sources
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
      AND source_kind IN ('cycle','opening') AND state='active'
      AND (cycle_start IS NULL OR cycle_start<=clock_timestamp())
      AND (cycle_end IS NULL OR cycle_end>clock_timestamp())
    LIMIT 1`, [epoch, workspaceId])).rows[0];
  if (!entitlement) return { handled: true, ok: false,
    reason: "workspace_credits_unavailable" };
  const source = (await client.query(`SELECT id FROM
    engine_universal_credit_sources
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
      AND state='active' AND available>0
      AND (cycle_start IS NULL OR cycle_start<=clock_timestamp())
      AND (cycle_end IS NULL OR cycle_end>clock_timestamp())
    ORDER BY cycle_end ASC NULLS LAST,created_at,id
    LIMIT 1 FOR UPDATE SKIP LOCKED`, [epoch, workspaceId])).rows[0];
  if (!source) return { handled: true, ok: false,
    reason: "workspace_credits_unavailable" };
  await client.query(`UPDATE engine_universal_credit_sources
    SET available=available-1,reserved=reserved+1,revision=revision+1,
        updated_at=clock_timestamp() WHERE id=$1`, [source.id]);
  await client.query(`INSERT INTO engine_universal_credit_holds
    (operation_epoch_started_at,workspace_id,target_id,state,source_id)
    VALUES ($1,$2,$3,'held',$4)`, [epoch, workspaceId, targetId, source.id]);
  await client.query(`UPDATE engine_universal_credit_balances
    SET reserved=reserved+1,revision=revision+1,updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [epoch, workspaceId]);
  return { handled: true, ok: true, sourceId: source.id };
}

async function settleConfirmedTx(client, { epoch, workspaceId, targetId }) {
  const mode = await workspaceModeTx(client, { epoch, workspaceId, lock: true });
  if (mode?.mode !== "ACTIVE") return { handled: false };
  const balance = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 FOR UPDATE`, [epoch, workspaceId])).rows[0];
  const hold = (await client.query(`SELECT state,source_id FROM
    engine_universal_credit_holds WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 AND target_id=$3 FOR UPDATE`,
  [epoch, workspaceId, targetId])).rows[0];
  if (!hold?.source_id) return { handled: false };
  const source = (await client.query(`SELECT reserved FROM
    engine_universal_credit_sources WHERE id=$1 FOR UPDATE`,
  [hold.source_id])).rows[0];
  if (!balance || hold.state !== "held" || !source ||
      Number(source.reserved) < 1 || Number(balance.reserved) < 1 ||
      Number(balance.balance) < 1) {
    throw new Error("universal_credit_confirmed_hold_missing");
  }
  const revision = Number(balance.revision) + 1;
  const ledger = await client.query(`INSERT INTO financial_credit_ledger
    (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
     projection_status,metadata,operation_epoch_started_at,
     universal_movement_type,universal_target_id,universal_balance_revision,
     universal_balance_after,universal_credit_source_id)
    VALUES ($1,'adjustment',-1,'subtract','universal_target_confirmed',$2,
      'projected',$3::jsonb,$4,'TARGET_DEBIT',$5,$6,$7,$8)
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  [workspaceId, movementKey("TARGET_DEBIT", epoch, workspaceId, targetId),
    JSON.stringify({ authority: "postgresql_universal",
      targetId: String(targetId), sourceId: String(hold.source_id) }), epoch,
    targetId, revision, Number(balance.balance) - 1, hold.source_id]);
  if (ledger.rowCount !== 1) throw new Error("universal_credit_target_debit_conflict");
  await client.query(`UPDATE engine_universal_credit_sources
    SET reserved=reserved-1,consumed=consumed+1,revision=revision+1,
        state=CASE WHEN state='escrow' AND reserved=1 THEN 'closed' ELSE state END,
        updated_at=clock_timestamp() WHERE id=$1`, [hold.source_id]);
  await client.query(`UPDATE engine_universal_credit_balances
    SET balance=balance-1,reserved=reserved-1,revision=$3,
        updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
  [epoch, workspaceId, revision]);
  await client.query(`UPDATE engine_universal_credit_holds
    SET state='consumed',updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3`,
  [epoch, workspaceId, targetId]);
  return { handled: true, ok: true, ledgerId: ledger.rows[0].id,
    sourceId: hold.source_id };
}

async function releaseForTargetTx(client, { epoch, workspaceId, targetId }) {
  const mode = await workspaceModeTx(client, { epoch, workspaceId, lock: true });
  if (mode?.mode !== "ACTIVE") return { handled: false };
  const balance = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 FOR UPDATE`, [epoch, workspaceId])).rows[0];
  const hold = (await client.query(`SELECT state,source_id FROM
    engine_universal_credit_holds WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 AND target_id=$3 FOR UPDATE`,
  [epoch, workspaceId, targetId])).rows[0];
  if (!hold?.source_id) return { handled: false };
  if (hold.state !== "held") throw new Error("universal_credit_release_conflict");
  const source = (await client.query(`SELECT state,cycle_end,reserved,
      (cycle_end IS NULL OR cycle_end>clock_timestamp()) AS cycle_current FROM
    engine_universal_credit_sources WHERE id=$1 FOR UPDATE`,
  [hold.source_id])).rows[0];
  if (!balance || !source || Number(source.reserved) < 1 ||
      Number(balance.reserved) < 1) throw new Error("universal_credit_release_conflict");
  const returnable = source.state === "active" && source.cycle_current === true;
  if (returnable) {
    await client.query(`UPDATE engine_universal_credit_sources
      SET reserved=reserved-1,available=available+1,revision=revision+1,
          updated_at=clock_timestamp() WHERE id=$1`, [hold.source_id]);
    await client.query(`UPDATE engine_universal_credit_balances
      SET reserved=reserved-1,revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspaceId]);
  } else {
    const revision = Number(balance.revision) + 1;
    const ledger = await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at,
       universal_movement_type,universal_target_id,universal_balance_revision,
       universal_balance_after,universal_credit_source_id)
      VALUES ($1,'adjustment',-1,'subtract','universal_expired_hold_released',$2,
        'projected',$3::jsonb,$4,'HOLD_EXPIRED_RELEASE',$5,$6,$7,$8)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [workspaceId, movementKey("HOLD_EXPIRED_RELEASE", epoch, workspaceId, targetId),
      JSON.stringify({ authority: "postgresql_universal",
        targetId: String(targetId), sourceId: String(hold.source_id) }), epoch,
      targetId, revision, Number(balance.balance) - 1, hold.source_id]);
    if (ledger.rowCount !== 1) throw new Error("universal_credit_expired_release_conflict");
    await client.query(`UPDATE engine_universal_credit_sources
      SET reserved=reserved-1,expired=expired+1,revision=revision+1,
          state=CASE WHEN reserved=1 THEN 'closed' ELSE state END,
          updated_at=clock_timestamp() WHERE id=$1`, [hold.source_id]);
    await client.query(`UPDATE engine_universal_credit_balances
      SET balance=balance-1,reserved=reserved-1,revision=$3,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspaceId, revision]);
  }
  await client.query(`UPDATE engine_universal_credit_holds
    SET state='released',updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3`,
  [epoch, workspaceId, targetId]);
  return { handled: true, ok: true, released: true, returned: returnable,
    sourceId: hold.source_id };
}

module.exports = { workspaceModeTx, totalsTx, compareWorkspaceSourcesTx,
  prepareShadowWorkspace, classifyLegacyAvailable, activateWorkspaceSources,
  recomputeAggregateTx, applyLedgerTx, addAdminTopupTx, holdForTargetTx,
  settleConfirmedTx, releaseForTargetTx };
