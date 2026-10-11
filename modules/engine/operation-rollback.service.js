"use strict";

// Offline rollback only. The caller must first stop the backend and prove it
// remains stopped; a live process could rewrite usuarios.json from stale memory.
const { createHash } = require("node:crypto");
const { readGlobalJson, writeGlobalJson } = require("../../utils/storage");
const { rollbackBalanceProjection } = require("./universal-credits.repository");

function keyFor(epoch, workspaceId) {
  return `universal-rollback:${createHash("sha256").update(JSON.stringify([
    epoch, workspaceId
  ])).digest("hex")}`;
}

async function requireStopped(check) {
  if (typeof check !== "function" || await check() !== true) {
    throw new Error("universal_rollback_backend_must_be_stopped");
  }
}

async function tx(pool, action) {
  if (!pool || typeof pool.connect !== "function") throw new Error("rollback_pool_required");
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

function legacyReader() { return readGlobalJson("usuarios.json", []); }
function legacyWriter(users) { return writeGlobalJson("usuarios.json", users); }

function checkedUser(users, workspaceId) {
  if (!Array.isArray(users)) throw new Error("rollback_legacy_users_invalid");
  const matches = users.filter(user => user && String(user.id) === workspaceId);
  if (matches.length !== 1) throw new Error("rollback_legacy_workspace_not_unique");
  return matches[0];
}

function assertProjected(user, epoch, balance, key) {
  if (Number(user.creditos) !== balance ||
      user.ultimoRollbackUniversal?.epoch !== epoch ||
      user.ultimoRollbackUniversal?.key !== key ||
      user.ultimoRollbackUniversal?.balance !== balance) {
    throw new Error("rollback_legacy_readback_mismatch");
  }
}

async function freezeUniversal({ pool, assertBackendStopped }) {
  await requireStopped(assertBackendStopped);
  return tx(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR UPDATE`)).rows[0];
    if (state?.mode === "ROLLBACK_FROZEN" && state.operation_epoch_started_at) {
      return { frozen: true, duplicate: true,
        epoch: new Date(state.operation_epoch_started_at).toISOString() };
    }
    if (state?.mode !== "UNIVERSAL" || !state.operation_epoch_started_at) {
      throw new Error("rollback_universal_mode_required");
    }
    await client.query(`UPDATE engine_operation_state
      SET mode='ROLLBACK_FROZEN',updated_at=clock_timestamp() WHERE id=1`);
    return { frozen: true, duplicate: false,
      epoch: new Date(state.operation_epoch_started_at).toISOString() };
  });
}

async function projectLegacyWorkspace({ pool, workspaceId, assertBackendStopped,
  readUsers = legacyReader, writeUsers = legacyWriter }) {
  await requireStopped(assertBackendStopped);
  const workspace = String(workspaceId || "").trim();
  if (!workspace) throw new Error("rollback_workspace_required");
  const state = (await pool.query(`SELECT mode,operation_epoch_started_at
    FROM engine_operation_state WHERE id=1`)).rows[0];
  if (state?.mode !== "ROLLBACK_FROZEN" || !state.operation_epoch_started_at) {
    throw new Error("rollback_frozen_mode_required");
  }
  const projection = await rollbackBalanceProjection({ pool, workspaceId: workspace });
  const epoch = projection.operationEpochStartedAt;
  const key = keyFor(epoch, workspace);
  const users = readUsers();
  const user = checkedUser(users, workspace);
  if (user.ultimoRollbackUniversal?.epoch === epoch) {
    assertProjected(user, epoch, projection.rollbackBalance, key);
  } else {
    if (user.ultimoRollbackUniversal?.epoch &&
        new Date(user.ultimoRollbackUniversal.epoch).getTime() >= new Date(epoch).getTime()) {
      throw new Error("rollback_legacy_epoch_not_new");
    }
    user.creditos = projection.rollbackBalance;
    user.ultimoRollbackUniversal = { epoch, balance: projection.rollbackBalance, key };
    await requireStopped(assertBackendStopped);
    if (await writeUsers(users) !== true) throw new Error("rollback_legacy_write_failed");
  }
  assertProjected(checkedUser(readUsers(), workspace), epoch,
    projection.rollbackBalance, key);
  await requireStopped(assertBackendStopped);
  return tx(pool, async client => {
    const current = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
    if (current?.mode !== "ROLLBACK_FROZEN" ||
        new Date(current.operation_epoch_started_at).toISOString() !== epoch) {
      throw new Error("rollback_epoch_changed_during_projection");
    }
    const balance = (await client.query(`SELECT balance,revision,reserved
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR SHARE`,
    [epoch, workspace])).rows[0];
    if (!balance || Number(balance.balance) !== projection.rollbackBalance ||
        Number(balance.revision) !== projection.balanceRevision ||
        Number(balance.reserved) !== 0) {
      throw new Error("rollback_balance_changed_during_projection");
    }
    await client.query(`INSERT INTO engine_operation_rollback_projections
      (epoch_started_at,workspace_id,expected_balance,legacy_readback_balance,
       balance_revision,ledger_count,idempotency_key)
      VALUES ($1,$2,$3,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [epoch, workspace, projection.rollbackBalance, projection.balanceRevision,
      projection.movementCount, key]);
    const receipt = (await client.query(`SELECT expected_balance,
        legacy_readback_balance,balance_revision,ledger_count,idempotency_key
      FROM engine_operation_rollback_projections
      WHERE epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace])).rows[0];
    if (!receipt || Number(receipt.expected_balance) !== projection.rollbackBalance ||
        Number(receipt.legacy_readback_balance) !== projection.rollbackBalance ||
        Number(receipt.balance_revision) !== projection.balanceRevision ||
        Number(receipt.ledger_count) !== projection.movementCount ||
        receipt.idempotency_key !== key) {
      throw new Error("rollback_financial_receipt_conflict");
    }
    return { ok: true, workspaceId: workspace, epoch,
      balance: projection.rollbackBalance, idempotencyKey: key };
  });
}

async function finishRollback({ pool, assertBackendStopped,
  readUsers = legacyReader }) {
  await requireStopped(assertBackendStopped);
  return tx(pool, async client => {
    const state = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR UPDATE`)).rows[0];
    if (state?.mode === "LEGACY" && !state.operation_epoch_started_at) {
      const last = (await client.query(`SELECT started_at,state FROM
        engine_operation_epoch_history ORDER BY started_at DESC LIMIT 1`)).rows[0];
      if (last?.state !== "rolled_back") throw new Error("rollback_closed_epoch_missing");
      return { ok: true, duplicate: true, epoch: new Date(last.started_at).toISOString() };
    }
    if (state?.mode !== "ROLLBACK_FROZEN" || !state.operation_epoch_started_at) {
      throw new Error("rollback_frozen_mode_required");
    }
    const epoch = new Date(state.operation_epoch_started_at).toISOString();
    const balances = (await client.query(`SELECT b.workspace_id,b.balance,
        p.idempotency_key FROM engine_universal_credit_balances b
      LEFT JOIN engine_operation_rollback_projections p
        ON p.epoch_started_at=b.operation_epoch_started_at AND
          p.workspace_id=b.workspace_id
      WHERE b.operation_epoch_started_at=$1 ORDER BY b.workspace_id`, [epoch])).rows;
    await requireStopped(assertBackendStopped);
    const users = readUsers();
    for (const row of balances) {
      if (!row.idempotency_key) throw new Error("rollback_financial_receipt_missing");
      assertProjected(checkedUser(users, row.workspace_id), epoch,
        Number(row.balance), row.idempotency_key);
    }
    await client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL,
          updated_at=clock_timestamp() WHERE id=1`);
    return { ok: true, duplicate: false, epoch, workspaces: balances.length };
  });
}

module.exports = { freezeUniversal, projectLegacyWorkspace, finishRollback };
