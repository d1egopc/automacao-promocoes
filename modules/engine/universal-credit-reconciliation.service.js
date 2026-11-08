"use strict";

const { createHash } = require("node:crypto");

function texto(valor) { return String(valor ?? "").trim(); }
function inteiro(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero)) {
    throw new Error("historical_admin_reconciliation_amount_invalid");
  }
  return numero;
}
function hashEstavel(valor) {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

function calcularReconciliacaoAdministrativaHistorica({
  workspaceId,
  epoch,
  sourceMode,
  balance,
  sources = [],
  movements = []
} = {}) {
  const workspace = texto(workspaceId);
  if (!workspace || !epoch || sourceMode !== "ACTIVE_SEGREGATED") {
    throw new Error("historical_admin_reconciliation_scope_invalid");
  }
  const sourceRows = sources.map(item => ({
    id: texto(item.id),
    kind: texto(item.source_kind || item.kind),
    state: texto(item.state),
    granted: inteiro(item.granted),
    available: inteiro(item.available),
    reserved: inteiro(item.reserved),
    consumed: inteiro(item.consumed),
    expired: inteiro(item.expired)
  }));
  const unclassified = sourceRows.filter(item =>
    item.kind === "legacy_unclassified" && item.state === "unclassified");
  const blockers = [];
  if (unclassified.length !== 1) blockers.push("legacy_unclassified_source_count");
  if (unclassified.some(item => item.reserved !== 0)) {
    blockers.push("legacy_unclassified_has_reservations");
  }
  if (sourceRows.some(item => item.granted !==
      item.available + item.reserved + item.consumed + item.expired)) {
    blockers.push("source_conservation_divergence");
  }

  const ledger = movements.map(item => ({
    id: texto(item.id),
    ledgerType: texto(item.ledger_type || item.ledgerType),
    balancePolicy: texto(item.balance_policy || item.balancePolicy),
    movementType: texto(item.universal_movement_type || item.movementType),
    amount: inteiro(item.amount),
    sourceId: texto(item.universal_credit_source_id || item.sourceId),
    createdAt: texto(item.created_at || item.createdAt)
  }));
  const historicalUnlinked = ledger.filter(item => !item.sourceId);
  const adminAdds = historicalUnlinked.filter(item =>
    item.ledgerType === "admin_credit" && item.balancePolicy === "add" &&
    item.amount > 0);
  const adminReversals = historicalUnlinked.filter(item =>
    item.ledgerType === "admin_credit" && item.amount < 0);
  const adminGranted = adminAdds.reduce((total, item) => total + item.amount, 0);
  const adminReversed = adminReversals.reduce((total, item) =>
    total + Math.abs(item.amount), 0);
  const adminNet = Math.max(0, adminGranted - adminReversed);
  // Pior caso conservador: todo valor positivo de outra origem ainda pode
  // compor o saldo não classificado. Só o excedente é inequivocamente Admin.
  const otherPositiveUpperBound = historicalUnlinked
    .filter(item => !(item.ledgerType === "admin_credit" &&
      item.balancePolicy === "add" && item.amount > 0))
    .reduce((total, item) => total + Math.max(0, item.amount), 0);
  const unclassifiedAvailable = unclassified.reduce((total, item) =>
    total + item.available, 0);
  const provableByResidual = Math.max(0,
    unclassifiedAvailable - otherPositiveUpperBound);
  const provenAdminCredits = Math.min(unclassifiedAvailable, adminNet,
    provableByResidual);
  const unprovenCredits = Math.max(0,
    unclassifiedAvailable - provenAdminCredits);
  const total = inteiro(balance?.balance ?? 0);
  const reserved = inteiro(balance?.reserved ?? 0);
  const proof = {
    workspace,
    epoch: texto(epoch),
    sourceMode,
    total,
    reserved,
    sources: sourceRows,
    movements: ledger.map(item => [item.id, item.ledgerType,
      item.balancePolicy, item.movementType, item.amount, item.sourceId,
      item.createdAt]),
    adminGranted,
    adminReversed,
    otherPositiveUpperBound,
    unclassifiedAvailable,
    provenAdminCredits,
    unprovenCredits
  };
  return {
    ok: blockers.length === 0,
    dryRun: true,
    applyAllowed: false,
    workspaceId: workspace,
    sourceMode,
    total,
    reserved,
    adminGranted,
    adminReversed,
    otherPositiveUpperBound,
    historicalBlocked: unclassifiedAvailable,
    provenAdminCredits,
    unprovenCredits,
    blockers,
    proofHash: hashEstavel(proof),
    requiresExpectedProofHash: true
  };
}

async function dryRunReconciliacaoAdministrativaHistorica({ pool,
  workspaceId } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("historical_admin_reconciliation_pool_required");
  }
  const workspace = texto(workspaceId);
  if (!workspace) throw new Error("historical_admin_reconciliation_workspace_required");
  const client = await pool.connect();
  let aberta = false;
  try {
    await client.query("BEGIN READ ONLY");
    aberta = true;
    const operation = (await client.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 AND mode='UNIVERSAL'`)).rows[0];
    if (!operation) throw new Error("historical_admin_reconciliation_mode_required");
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const workspaceState = (await client.query(`SELECT mode,activated_at FROM
      engine_universal_credit_source_workspaces
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace])).rows[0];
    if (!workspaceState?.activated_at) {
      throw new Error("historical_admin_reconciliation_activation_missing");
    }
    const balance = (await client.query(`SELECT balance,reserved FROM
      engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace])).rows[0];
    if (!balance) throw new Error("historical_admin_reconciliation_balance_missing");
    const sources = (await client.query(`SELECT id,source_kind,state,granted,
        available,reserved,consumed,expired
      FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 ORDER BY id`,
    [epoch, workspace])).rows;
    const movements = (await client.query(`SELECT id,ledger_type,
        balance_policy,universal_movement_type,amount,
        universal_credit_source_id,created_at
      FROM financial_credit_ledger
      WHERE cliente_id=$1 AND universal_credit_source_id IS NULL
        AND created_at<=$2 ORDER BY created_at,id LIMIT 10001`,
    [workspace, workspaceState.activated_at])).rows;
    if (movements.length > 10000) {
      throw new Error("historical_admin_reconciliation_batch_exceeded");
    }
    const result = calcularReconciliacaoAdministrativaHistorica({
      workspaceId: workspace,
      epoch,
      sourceMode: workspaceState.mode,
      balance,
      sources,
      movements
    });
    await client.query("COMMIT");
    aberta = false;
    return result;
  } catch (error) {
    if (aberta) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  calcularReconciliacaoAdministrativaHistorica,
  dryRunReconciliacaoAdministrativaHistorica
};
