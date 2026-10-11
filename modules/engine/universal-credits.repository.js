"use strict";

// Post-epoch balances are a locked projection of the existing financial
// ledger. No JSON balance is read or written here. A hold protects capacity
// before transport but is not a financial debit.
const { createHash } = require("node:crypto");

function text(value) { return String(value ?? "").trim(); }
function integer(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("universal_credit_amount_invalid");
  }
  return number;
}
function epochIso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("universal_credit_epoch_invalid");
  return date.toISOString();
}
function movementKey(kind, epoch, workspaceId, targetId = "") {
  return `universal:${createHash("sha256").update(JSON.stringify([
    kind, epoch, workspaceId, String(targetId)
  ])).digest("hex")}`;
}

async function transaction(pool, action) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("universal_credit_pool_required");
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

async function openBalance({ pool, workspaceId, operationEpochStartedAt,
  openingBalance, sourceHash }) {
  const workspace = text(workspaceId);
  const epoch = epochIso(operationEpochStartedAt);
  const amount = integer(openingBalance);
  const hash = text(sourceHash);
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("universal_credit_opening_identity_invalid");
  }
  return transaction(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (!state || !["CUTOVER_PREPARED", "UNIVERSAL"].includes(state.mode) ||
        (state.mode === "UNIVERSAL" &&
          epochIso(state.operation_epoch_started_at) !== epoch)) {
      throw new Error("universal_credit_opening_mode_or_epoch_invalid");
    }
    const inserted = await client.query(`INSERT INTO engine_universal_credit_balances
      (operation_epoch_started_at,workspace_id,opening_balance,balance,source_hash)
      VALUES ($1,$2,$3,$3,$4) ON CONFLICT DO NOTHING RETURNING workspace_id`,
    [epoch, workspace, amount, hash]);
    if (inserted.rowCount) {
      const ledger = await client.query(`INSERT INTO financial_credit_ledger
        (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
         projection_status,metadata,operation_epoch_started_at,
         universal_movement_type,universal_balance_revision,
         universal_balance_after)
        VALUES ($1,'adjustment',$2,'set','universal_epoch_opening',$3,
          'projected',$4::jsonb,$5,'OPENING_BALANCE',0,$2)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [workspace, amount, movementKey("OPENING_BALANCE", epoch, workspace),
        JSON.stringify({ authority: "postgresql_universal", sourceHash: hash }), epoch]);
      if (ledger.rowCount !== 1) throw new Error("universal_credit_opening_ledger_conflict");
    }
    const row = (await client.query(`SELECT opening_balance,balance,reserved,source_hash
      FROM engine_universal_credit_balances WHERE operation_epoch_started_at=$1
        AND workspace_id=$2 FOR UPDATE`, [epoch, workspace])).rows[0];
    if (!row || Number(row.opening_balance) !== amount || row.source_hash !== hash) {
      throw new Error("universal_credit_opening_conflict");
    }
    const ledger = await client.query(`SELECT amount,metadata->>'sourceHash' AS source_hash
      FROM financial_credit_ledger WHERE operation_epoch_started_at=$1
        AND cliente_id=$2 AND universal_movement_type='OPENING_BALANCE'`,
    [epoch, workspace]);
    if (ledger.rowCount !== 1 || Number(ledger.rows[0].amount) !== amount ||
        ledger.rows[0].source_hash !== hash) {
      throw new Error("universal_credit_opening_ledger_missing_or_conflicting");
    }
    return { ok: true, created: inserted.rowCount === 1,
      balance: Number(row.balance), reserved: Number(row.reserved) };
  });
}

async function prepareRegistrationOpening({ pool, workspaceId, openingBalance,
  planId = "" }) {
  const workspace = text(workspaceId);
  const amount = integer(openingBalance);
  if (!workspace) throw new Error("universal_registration_workspace_required");
  return transaction(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (state?.mode !== "UNIVERSAL" || !state.operation_epoch_started_at) {
      throw new Error("universal_registration_mode_required");
    }
    const epoch = epochIso(state.operation_epoch_started_at);
    const hash = createHash("sha256").update(JSON.stringify([
      "registration", epoch, workspace, amount, text(planId)
    ])).digest("hex");
    await client.query(`INSERT INTO engine_universal_credit_opening_intents
      (operation_epoch_started_at,workspace_id,opening_balance,source_hash)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [epoch, workspace, amount, hash]);
    const row = (await client.query(`SELECT opening_balance,source_hash,state
      FROM engine_universal_credit_opening_intents
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace])).rows[0];
    if (!row || Number(row.opening_balance) !== amount ||
        row.source_hash !== hash || row.state === "orphaned") {
      throw new Error("universal_registration_opening_conflict");
    }
    return { workspaceId: workspace, operationEpochStartedAt: epoch,
      openingBalance: amount, sourceHash: hash };
  });
}

async function reconcileRegistrationOpening({ pool, workspaceId,
  userExists }) {
  const workspace = text(workspaceId);
  if (!workspace) throw new Error("universal_registration_workspace_required");
  const result = await pool.query(`SELECT i.operation_epoch_started_at,
      i.opening_balance,i.source_hash,i.state
    FROM engine_operation_state s
    JOIN engine_universal_credit_opening_intents i
      ON i.operation_epoch_started_at=s.operation_epoch_started_at
    WHERE s.id=1 AND s.mode='UNIVERSAL' AND i.workspace_id=$1`,
  [workspace]);
  const intent = result.rows[0];
  if (!intent || intent.state === "orphaned") {
    throw new Error("universal_registration_opening_intent_missing");
  }
  if (userExists !== true) return { ok: false, reason: "registration_not_persisted" };
  await openBalance({ pool, workspaceId: workspace,
    operationEpochStartedAt: intent.operation_epoch_started_at,
    openingBalance: Number(intent.opening_balance), sourceHash: intent.source_hash });
  await pool.query(`UPDATE engine_universal_credit_opening_intents
    SET state='completed',completed_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND state='pending'`,
  [intent.operation_epoch_started_at, workspace]);
  return { ok: true, workspaceId: workspace };
}

async function recoverRegistrationOpenings({ pool, userExists, limit = 20 }) {
  if (typeof userExists !== "function") throw new Error("user_exists_required");
  const size = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = (await pool.query(`SELECT i.workspace_id,
      i.created_at FROM engine_operation_state s
    JOIN engine_universal_credit_opening_intents i
      ON i.operation_epoch_started_at=s.operation_epoch_started_at
    WHERE s.id=1 AND s.mode='UNIVERSAL' AND i.state='pending'
    ORDER BY i.created_at,i.workspace_id LIMIT $1`, [size])).rows;
  let completed = 0;
  let orphaned = 0;
  for (const row of rows) {
    if (userExists(row.workspace_id)) {
      await reconcileRegistrationOpening({ pool, workspaceId: row.workspace_id,
        userExists: true });
      completed += 1;
    } else if (Date.now() - new Date(row.created_at).getTime() > 86400000) {
      const result = await pool.query(`UPDATE engine_universal_credit_opening_intents
        SET state='orphaned',completed_at=clock_timestamp()
        WHERE workspace_id=$1 AND state='pending' AND created_at <
          clock_timestamp()-interval '24 hours'`, [row.workspace_id]);
      orphaned += result.rowCount;
    }
  }
  return { scanned: rows.length, completed, orphaned };
}

async function registerSimulatedCycle({ pool, workspaceId, paymentId, planId,
  amount, cycleStart, cycleEnd, operator = "", allowCreate = true }) {
  const workspace = text(workspaceId);
  const payment = text(paymentId);
  const plan = text(planId);
  const value = integer(amount);
  if (!workspace || !payment || !plan ||
      (allowCreate && (!cycleStart || !cycleEnd))) {
    throw new Error("universal_simulated_cycle_identity_invalid");
  }
  const key = `universal:simulated:${createHash("sha256").update(JSON.stringify([
    workspace, payment
  ])).digest("hex")}`;
  const fingerprint = createHash("sha256").update(JSON.stringify([
    workspace, payment, plan
  ])).digest("hex");
  return transaction(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (state?.mode !== "UNIVERSAL" || !state.operation_epoch_started_at) {
      throw new Error("universal_simulated_cycle_mode_required");
    }
    const existing = (await client.query(`SELECT id,cliente_id,amount,
        metadata,projection_status FROM financial_credit_ledger
      WHERE idempotency_key=$1`, [key])).rows[0];
    if (existing) {
      if (existing.cliente_id !== workspace ||
          existing.metadata?.fingerprint !== fingerprint) {
        throw new Error("universal_simulated_cycle_idempotency_conflict");
      }
      return { ledgerId: existing.id, duplicate: true,
        projected: existing.projection_status === "projected" };
    }
    if (!allowCreate) return { ledgerId: null, duplicate: true,
      projected: true, previousEpoch: true };
    const metadata = { authority: "postgresql_universal",
      origin: "admin_simulated_payment", fingerprint,
      externalPaymentId: payment, paymentStatus: "approved",
      planSnapshot: { planoId: plan }, operator: text(operator) };
    const result = await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,cycle_start,cycle_end,
       reason,idempotency_key,projection_status,metadata)
      VALUES ($1,'cycle_credit',$2,'replace_cycle',$3,$4,
        'admin_simulated_payment',$5,'pending',$6::jsonb)
      RETURNING id`, [workspace, value, cycleStart, cycleEnd, key,
        JSON.stringify(metadata)]);
    return { ledgerId: result.rows[0].id, duplicate: false,
      projected: false };
  });
}

async function readBalance({ pool, workspaceId }) {
  const workspace = text(workspaceId);
  if (!workspace || !pool || typeof pool.query !== "function") {
    throw new Error("universal_credit_read_identity_invalid");
  }
  const result = await pool.query(`SELECT b.balance,b.reserved,b.opening_balance,
      b.operation_epoch_started_at,b.revision
    FROM engine_operation_state s
    JOIN engine_universal_credit_balances b
      ON b.operation_epoch_started_at=s.operation_epoch_started_at
    WHERE s.id=1 AND s.mode='UNIVERSAL' AND b.workspace_id=$1`, [workspace]);
  if (result.rowCount !== 1) throw new Error("universal_credit_opening_missing");
  const row = result.rows[0];
  return { balance: Number(row.balance), reserved: Number(row.reserved),
    available: Number(row.balance) - Number(row.reserved),
    openingBalance: Number(row.opening_balance),
    operationEpochStartedAt: epochIso(row.operation_epoch_started_at),
    revision: Number(row.revision) };
}

async function holdForTargetTx(client, { epoch, workspaceId, targetId }) {
  const row = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
  [epoch, workspaceId])).rows[0];
  if (!row) return { ok: false, reason: "universal_credit_opening_missing" };
  const existing = (await client.query(`SELECT state FROM engine_universal_credit_holds
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3
    FOR UPDATE`, [epoch, workspaceId, targetId])).rows[0];
  if (existing) return { ok: false, reason: "universal_credit_hold_existing" };
  if (Number(row.balance) - Number(row.reserved) < 1) {
    return { ok: false, reason: "workspace_credits_unavailable" };
  }
  await client.query(`INSERT INTO engine_universal_credit_holds
    (operation_epoch_started_at,workspace_id,target_id,state)
    VALUES ($1,$2,$3,'held')`, [epoch, workspaceId, targetId]);
  await client.query(`UPDATE engine_universal_credit_balances
    SET reserved=reserved+1,revision=revision+1,updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspaceId]);
  return { ok: true };
}

async function settleConfirmedTx(client, { epoch, workspaceId, targetId }) {
  const row = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
  [epoch, workspaceId])).rows[0];
  const hold = (await client.query(`SELECT state FROM engine_universal_credit_holds
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3
    FOR UPDATE`, [epoch, workspaceId, targetId])).rows[0];
  if (!row || !hold || hold.state !== "held" ||
      Number(row.balance) < 1 || Number(row.reserved) < 1) {
    throw new Error("universal_credit_confirmed_hold_missing");
  }
  const ledger = await client.query(`INSERT INTO financial_credit_ledger
    (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
     projection_status,metadata,operation_epoch_started_at,
     universal_movement_type,universal_target_id,universal_balance_revision,
     universal_balance_after)
    VALUES ($1,'adjustment',-1,'subtract','universal_target_confirmed',$2,
      'projected',$3::jsonb,$4,'TARGET_DEBIT',$5,$6,$7)
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  [workspaceId, movementKey("TARGET_DEBIT", epoch, workspaceId, targetId),
    JSON.stringify({ authority: "postgresql_universal", targetId: String(targetId) }),
    epoch, targetId, Number(row.revision) + 1, Number(row.balance) - 1]);
  if (ledger.rowCount !== 1) throw new Error("universal_credit_target_debit_conflict");
  await client.query(`UPDATE engine_universal_credit_balances
    SET balance=balance-1,reserved=reserved-1,revision=revision+1,
        updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspaceId]);
  await client.query(`UPDATE engine_universal_credit_holds
    SET state='consumed',updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3`,
  [epoch, workspaceId, targetId]);
  return { ok: true, ledgerId: ledger.rows[0].id };
}

async function releaseForTargetTx(client, { epoch, workspaceId, targetId }) {
  const row = (await client.query(`SELECT reserved FROM
    engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
  [epoch, workspaceId])).rows[0];
  const hold = (await client.query(`SELECT state FROM engine_universal_credit_holds
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3
    FOR UPDATE`, [epoch, workspaceId, targetId])).rows[0];
  if (!hold) return { ok: true, released: false };
  if (!row || hold.state !== "held" || Number(row.reserved) < 1) {
    throw new Error("universal_credit_release_conflict");
  }
  await client.query(`UPDATE engine_universal_credit_balances
    SET reserved=reserved-1,revision=revision+1,updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspaceId]);
  await client.query(`UPDATE engine_universal_credit_holds
    SET state='released',updated_at=clock_timestamp()
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND target_id=$3`,
  [epoch, workspaceId, targetId]);
  return { ok: true, released: true };
}

async function applyFinancialLedger({ pool, ledgerId }) {
  const id = text(ledgerId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("universal_financial_ledger_id_invalid");
  }
  return transaction(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (state?.mode !== "UNIVERSAL" || !state.operation_epoch_started_at) {
      throw new Error("universal_financial_mode_required");
    }
    const epoch = epochIso(state.operation_epoch_started_at);
    const movement = (await client.query(`SELECT id,cliente_id,amount,
        balance_policy,created_at,projection_status,
        universal_movement_type,operation_epoch_started_at
      FROM financial_credit_ledger WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!movement) throw new Error("universal_financial_ledger_missing");
    if (movement.universal_movement_type === "FINANCIAL_MOVEMENT" &&
        epochIso(movement.operation_epoch_started_at) === epoch) {
      return { ok: true, applied: false, workspaceId: movement.cliente_id };
    }
    if (movement.universal_movement_type ||
        movement.projection_status !== "pending" ||
        new Date(movement.created_at).getTime() < new Date(epoch).getTime()) {
      throw new Error("universal_financial_movement_epoch_conflict");
    }
    const row = (await client.query(`SELECT balance,reserved,revision
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, movement.cliente_id])).rows[0];
    if (!row) throw new Error("universal_financial_opening_missing");
    const policy = movement.balance_policy;
    const amount = Number(movement.amount);
    if (!Number.isSafeInteger(amount) || !["replace_cycle", "set", "add",
      "subtract"].includes(policy)) {
      throw new Error("universal_financial_policy_invalid");
    }
    const next = ["replace_cycle", "set"].includes(policy)
      ? amount : Number(row.balance) + amount;
    if (!Number.isSafeInteger(next) || next < 0 || next < Number(row.reserved) ||
        (["replace_cycle", "set"].includes(policy) && Number(row.reserved) > 0)) {
      return { ok: false, deferred: true, reason: "universal_financial_holds_or_balance_conflict" };
    }
    const revision = Number(row.revision) + 1;
    await client.query(`UPDATE engine_universal_credit_balances
      SET balance=$3,revision=$4,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, movement.cliente_id, next, revision]);
    await client.query(`UPDATE financial_credit_ledger
      SET operation_epoch_started_at=$2,
          universal_movement_type='FINANCIAL_MOVEMENT',
          universal_balance_revision=$3,universal_balance_after=$4
      WHERE id=$1`, [id, epoch, revision, next]);
    return { ok: true, applied: true, workspaceId: movement.cliente_id,
      balance: next };
  });
}

async function setAdminBalance({ pool, workspaceId, amount,
  idempotencyKey, reason = "admin_credit_set",
  movementType = "ADMIN_BALANCE_SET" }) {
  const workspace = text(workspaceId);
  const next = integer(amount);
  const key = text(idempotencyKey);
  if (!workspace || !key || key.length > 200) {
    throw new Error("universal_admin_credit_identity_invalid");
  }
  if (!["ADMIN_BALANCE_SET", "POLICY_BALANCE_SET"].includes(movementType)) {
    throw new Error("universal_credit_set_type_invalid");
  }
  return transaction(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (state?.mode !== "UNIVERSAL" || !state.operation_epoch_started_at) {
      throw new Error("universal_admin_credit_mode_required");
    }
    const epoch = epochIso(state.operation_epoch_started_at);
    const balance = (await client.query(`SELECT balance,reserved,revision
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, workspace])).rows[0];
    if (!balance) throw new Error("universal_admin_credit_opening_missing");
    const existing = (await client.query(`SELECT cliente_id,amount,
        operation_epoch_started_at,universal_movement_type
      FROM financial_credit_ledger WHERE idempotency_key=$1`, [key])).rows[0];
    if (existing) {
      if (existing.cliente_id !== workspace || Number(existing.amount) !== next ||
          epochIso(existing.operation_epoch_started_at) !== epoch ||
          existing.universal_movement_type !== movementType) {
        throw new Error("universal_admin_credit_idempotency_conflict");
      }
      return { ok: true, duplicate: true, balance: Number(balance.balance) };
    }
    if (Number(balance.reserved) > 0) {
      return { ok: false, reason: "universal_admin_credit_holds_open" };
    }
    const revision = Number(balance.revision) + 1;
    await client.query(`UPDATE engine_universal_credit_balances
      SET balance=$3,revision=$4,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace, next, revision]);
    await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at,
       universal_movement_type,universal_balance_revision,
       universal_balance_after)
      VALUES ($1,$7,$2,'set',$3,$4,'projected',
        '{"authority":"postgresql_universal"}'::jsonb,$5,
        $8,$6,$2)`,
    [workspace, next, text(reason).slice(0, 200), key, epoch, revision,
      movementType === "ADMIN_BALANCE_SET" ? "admin_credit" : "adjustment",
      movementType]);
    return { ok: true, duplicate: false, balance: next };
  });
}

async function rollbackBalanceProjection({ pool, workspaceId }) {
  const current = await readBalance({ pool, workspaceId });
  if (current.reserved !== 0) throw new Error("universal_credit_rollback_holds_open");
  const result = await pool.query(`SELECT universal_movement_type,
      amount,balance_policy,universal_balance_revision,universal_balance_after
    FROM financial_credit_ledger WHERE operation_epoch_started_at=$1
      AND cliente_id=$2 AND universal_movement_type IS NOT NULL
    ORDER BY universal_balance_revision,id`,
  [current.operationEpochStartedAt, workspaceId]);
  let balance = null;
  let openings = 0;
  for (const movement of result.rows) {
    const kind = movement.universal_movement_type;
    if (kind === "OPENING_BALANCE") {
      openings += 1;
      balance = Number(movement.amount);
    } else if (["FINANCIAL_MOVEMENT", "ADMIN_BALANCE_SET",
      "POLICY_BALANCE_SET"].includes(kind) &&
        ["replace_cycle", "set"].includes(movement.balance_policy)) {
      balance = Number(movement.amount);
    } else if (["FINANCIAL_MOVEMENT", "TARGET_DEBIT"].includes(kind)) {
      balance += Number(movement.amount);
    } else {
      throw new Error("universal_credit_rollback_movement_unknown");
    }
    if (balance !== Number(movement.universal_balance_after)) {
      throw new Error("universal_credit_rollback_movement_mismatch");
    }
  }
  if (openings !== 1 || balance !== current.balance) {
    throw new Error("universal_credit_rollback_projection_conflict");
  }
  return { workspaceId, operationEpochStartedAt: current.operationEpochStartedAt,
    openingBalance: current.openingBalance,
    movementCount: result.rows.length,
    rollbackBalance: current.balance };
}

module.exports = { openBalance, prepareRegistrationOpening,
  reconcileRegistrationOpening, recoverRegistrationOpenings,
  registerSimulatedCycle,
  readBalance, holdForTargetTx,
  settleConfirmedTx, releaseForTargetTx, applyFinancialLedger,setAdminBalance,
  rollbackBalanceProjection };
