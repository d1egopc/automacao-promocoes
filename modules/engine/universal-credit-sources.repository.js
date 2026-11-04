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
function sourceAuthorityActive(mode) {
  return mode === "ACTIVE" || mode === "ACTIVE_SEGREGATED";
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

async function legacySnapshotTx(client, { epoch, workspaceId, lock = false }) {
  const balance = (await client.query(`SELECT balance,reserved,revision,
      opening_balance FROM engine_universal_credit_balances
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
    ${lock ? "FOR UPDATE" : ""}`, [epoch, workspaceId])).rows[0];
  if (!balance) throw new Error("universal_credit_source_balance_missing");
  const holds = (await client.query(`SELECT target_id,source_id
    FROM engine_universal_credit_holds
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND state='held'
    ORDER BY target_id ${lock ? "FOR UPDATE" : ""}`,
  [epoch, workspaceId])).rows;
  const snapshot = {
    epoch, workspaceId, balance: Number(balance.balance),
    reserved: Number(balance.reserved), revision: Number(balance.revision),
    openingBalance: Number(balance.opening_balance),
    holds: holds.map(row => ({ targetId: String(row.target_id),
      sourceId: row.source_id || null }))
  };
  snapshot.hash = stableHash([snapshot.epoch, snapshot.workspaceId,
    snapshot.balance, snapshot.reserved, snapshot.revision, snapshot.holds]);
  return snapshot;
}

async function ledgerProvenanceTx(client, { epoch, workspaceId }) {
  const rows = (await client.query(`SELECT id,ledger_type,amount,balance_policy,
      cycle_start,cycle_end,projection_status,universal_movement_type,
      universal_balance_revision,universal_balance_after,metadata
    FROM financial_credit_ledger
    WHERE cliente_id=$1 AND operation_epoch_started_at=$2
      AND universal_movement_type IS NOT NULL
    ORDER BY universal_balance_revision NULLS LAST,id`,
  [workspaceId, epoch])).rows;
  return rows.map(row => {
    const origin = text(row.metadata?.origin);
    let provenance = "indeterminate";
    if (row.ledger_type === "cycle_credit" && origin === "admin_courtesy") {
      provenance = "courtesy_cycle";
    } else if (row.ledger_type === "cycle_credit" &&
        ["financial_event_v1", "payment_approved", "mercadopago_pix"].includes(origin)) {
      provenance = "pix_cycle";
    } else if (row.ledger_type === "admin_credit" &&
        row.balance_policy === "add" && origin === "admin_credit_topup") {
      provenance = "admin_topup";
    } else if (row.universal_movement_type === "OPENING_BALANCE") {
      provenance = "opening_unclassified";
    } else if (row.universal_movement_type === "TARGET_DEBIT") {
      provenance = "target_debit";
    }
    return { id: row.id, provenance, ledgerType: row.ledger_type,
      amount: Number(row.amount), balancePolicy: row.balance_policy,
      cycleStart: row.cycle_start, cycleEnd: row.cycle_end,
      projectionStatus: row.projection_status,
      movementType: row.universal_movement_type,
      revision: row.universal_balance_revision === null ? null :
        Number(row.universal_balance_revision),
      balanceAfter: row.universal_balance_after === null ? null :
        Number(row.universal_balance_after), origin };
  });
}

async function readOnlyTransaction(pool, action) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("universal_credit_source_pool_required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function shadowComparisonTx(client, { epoch, workspaceId,
  state = null, lock = false }) {
  const sourceState = state || await workspaceModeTx(client, { epoch,
    workspaceId, lock });
  if (!sourceState) throw new Error("universal_credit_source_shadow_missing");
  const snapshot = await legacySnapshotTx(client, { epoch, workspaceId, lock });
  const totals = await totalsTx(client, { epoch, workspaceId });
  const mapping = (await client.query(`SELECT
      COUNT(*)::int AS mapped,
      COUNT(*) FILTER (WHERE h.state='held')::int AS mapped_held,
      COUNT(*) FILTER (WHERE h.target_id IS NULL OR h.state<>'held')::int AS stale
    FROM engine_universal_credit_shadow_hold_sources m
    LEFT JOIN engine_universal_credit_holds h
      ON h.operation_epoch_started_at=m.operation_epoch_started_at
     AND h.workspace_id=m.workspace_id AND h.target_id=m.target_id
    WHERE m.operation_epoch_started_at=$1 AND m.workspace_id=$2`,
  [epoch, workspaceId])).rows[0];
  const missing = (await client.query(`SELECT COUNT(*)::int AS n
    FROM engine_universal_credit_holds h
    LEFT JOIN engine_universal_credit_shadow_hold_sources m
      ON m.operation_epoch_started_at=h.operation_epoch_started_at
     AND m.workspace_id=h.workspace_id AND m.target_id=h.target_id
    WHERE h.operation_epoch_started_at=$1 AND h.workspace_id=$2
      AND h.state='held' AND m.target_id IS NULL`,
  [epoch, workspaceId])).rows[0];
  const divergences = [];
  if (snapshot.hash !== sourceState.baseline_hash) divergences.push("snapshot_changed");
  if (snapshot.reserved !== snapshot.holds.length) divergences.push("held_count");
  if (snapshot.holds.some(hold => hold.sourceId !== null)) {
    divergences.push("legacy_hold_already_bound");
  }
  if (totals.reserved !== snapshot.reserved) divergences.push("reserved");
  if (Number(mapping.mapped) !== snapshot.holds.length ||
      Number(mapping.mapped_held) !== snapshot.holds.length ||
      Number(mapping.stale) !== 0 || Number(missing.n) !== 0) {
    divergences.push("shadow_hold_mapping");
  }
  if (totals.backed > snapshot.balance) divergences.push("source_value_created");
  return { ok: divergences.length === 0, divergences, snapshot,
    projectedBalance: totals.backed, projectedReserved: totals.reserved,
    mappedHolds: Number(mapping.mapped), ...totals };
}

async function inspectShadowWorkspace({ pool, workspaceId }) {
  const workspace = text(workspaceId);
  if (!workspace) throw new Error("universal_credit_source_workspace_required");
  return readOnlyTransaction(pool, async client => {
    const operation = (await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1`)).rows[0];
    if (operation?.mode !== "UNIVERSAL" || !operation.operation_epoch_started_at) {
      throw new Error("universal_credit_source_mode_required");
    }
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const snapshot = await legacySnapshotTx(client, { epoch,
      workspaceId: workspace, lock: false });
    const state = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: false });
    const provenance = await ledgerProvenanceTx(client, { epoch,
      workspaceId: workspace });
    return { ok: snapshot.reserved === snapshot.holds.length &&
      snapshot.holds.every(hold => hold.sourceId === null),
    readOnly: true, snapshotHash: snapshot.hash, snapshot,
    mode: state?.mode || "LEGACY", provenance };
  });
}

async function prepareShadowWorkspace({ pool, workspaceId,
  expectedSnapshotHash }) {
  const workspace = text(workspaceId);
  const expected = text(expectedSnapshotHash);
  if (!workspace || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("universal_credit_source_shadow_preflight_required");
  }
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
      const comparison = await shadowComparisonTx(client, { epoch,
        workspaceId: workspace, state: existing, lock: true });
      return { ok: comparison.ok, duplicate: true, mode: existing.mode,
        baselineHash: existing.baseline_hash, ...comparison };
    }
    const snapshot = await legacySnapshotTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (snapshot.hash !== expected) {
      throw new Error("universal_credit_source_snapshot_changed");
    }
    if (snapshot.holds.length !== snapshot.reserved ||
        snapshot.holds.some(hold => hold.sourceId !== null)) {
      throw new Error("universal_credit_source_held_count_divergence");
    }
    const available = snapshot.balance - snapshot.reserved;
    const baselineHash = snapshot.hash;
    let escrowId = null;
    if (snapshot.holds.length) {
      escrowId = (await client.query(`INSERT INTO engine_universal_credit_sources
        (operation_epoch_started_at,workspace_id,source_key,source_kind,state,
         granted,available,reserved,consumed,expired,metadata)
        VALUES ($1,$2,$3,'legacy_escrow','escrow',$4,0,$4,0,0,$5::jsonb)
        RETURNING id`, [epoch, workspace, `legacy-escrow:${baselineHash}`,
        snapshot.holds.length, JSON.stringify({ authority: "shadow_backfill",
          origin: "legacy_indeterminate" })])).rows[0].id;
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
      snapshot.balance, snapshot.reserved]);
    if (escrowId) {
      for (const hold of snapshot.holds) {
        await client.query(`INSERT INTO engine_universal_credit_shadow_hold_sources
          (operation_epoch_started_at,workspace_id,target_id,source_id)
          VALUES ($1,$2,$3,$4)`, [epoch, workspace, hold.targetId, escrowId]);
      }
    }
    const comparison = await shadowComparisonTx(client, { epoch,
      workspaceId: workspace });
    if (!comparison.ok) throw new Error(
      `universal_credit_source_shadow_divergence:${comparison.divergences.join(",")}`);
    return { ok: true, duplicate: false, mode: "SHADOW", baselineHash,
      escrowSourceId: escrowId, legacyAuthorityUntouched: true, ...comparison };
  });
}

async function classifyLegacyAvailable({ pool, workspaceId, baselineHash,
  classification, evidenceLedgerIds, reason }) {
  const workspace = text(workspaceId);
  const hash = text(baselineHash);
  const decision = text(classification);
  const auditReason = text(reason);
  const evidence = [...new Set((Array.isArray(evidenceLedgerIds) ?
    evidenceLedgerIds : []).map(text).filter(Boolean))];
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash) ||
      !["admin_topup", "expired_cycle"].includes(decision) || !auditReason ||
      evidence.length === 0) {
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
    const snapshot = await legacySnapshotTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (snapshot.hash !== state.baseline_hash) {
      throw new Error("universal_credit_source_snapshot_changed");
    }
    const rows = (await client.query(`SELECT id,available,reserved
      FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND source_kind='legacy_unclassified' AND state='unclassified'
      FOR UPDATE`, [epoch, workspace])).rows;
    const movements = await ledgerProvenanceTx(client, { epoch,
      workspaceId: workspace });
    const selected = movements.filter(item => evidence.includes(String(item.id)));
    if (selected.length !== evidence.length) {
      throw new Error("universal_credit_source_provenance_missing");
    }
    const latestRevision = Math.max(...movements
      .map(item => item.revision).filter(Number.isSafeInteger));
    const latestSelected = Math.max(...selected
      .map(item => item.revision).filter(Number.isSafeInteger));
    let proven = false;
    if (decision === "admin_topup") {
      const nonOpening = movements.filter(item =>
        item.movementType !== "OPENING_BALANCE");
      proven = snapshot.openingBalance === 0 && snapshot.reserved === 0 &&
        nonOpening.length === selected.length &&
        selected.every(item => item.provenance === "admin_topup" && item.amount > 0) &&
        selected.reduce((sum, item) => sum + item.amount, 0) === snapshot.balance &&
        latestSelected === latestRevision;
    } else {
      proven = selected.length === 1 &&
        ["pix_cycle", "courtesy_cycle"].includes(selected[0].provenance) &&
        selected[0].balanceAfter === snapshot.balance &&
        selected[0].revision === latestRevision && selected[0].cycleEnd &&
        new Date(selected[0].cycleEnd).getTime() <= Date.now();
    }
    if (!proven) throw new Error("universal_credit_source_provenance_unproven");
    for (const row of rows) {
      if (decision === "admin_topup") {
        await client.query(`UPDATE engine_universal_credit_sources
          SET source_kind='admin_topup',state='active',revision=revision+1,
              metadata=metadata||$2::jsonb,updated_at=clock_timestamp()
          WHERE id=$1`, [row.id, JSON.stringify({ classification: decision,
          reason: auditReason, evidenceLedgerIds: evidence })]);
      } else {
        await client.query(`UPDATE engine_universal_credit_sources
          SET state=CASE WHEN reserved>0 THEN 'escrow' ELSE 'expired' END,
              expired=expired+available,available=0,revision=revision+1,
              metadata=metadata||$2::jsonb,updated_at=clock_timestamp()
          WHERE id=$1`, [row.id, JSON.stringify({ classification: decision,
          reason: auditReason, evidenceLedgerIds: evidence })]);
      }
    }
    return { ok: true, classified: rows.length, classification: decision,
      legacyBalanceUnchanged: snapshot.balance };
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
    const comparison = await shadowComparisonTx(client, { epoch,
      workspaceId: workspace, state, lock: true });
    if (!comparison.ok || comparison.unclassifiedSources > 0) {
      throw new Error(`universal_credit_source_cutover_blocked:${[
        ...comparison.divergences,
        ...(comparison.unclassifiedSources ? ["legacy_unclassified"] : [])
      ].join(",")}`);
    }
    const projected = comparison.projectedBalance;
    const delta = projected - comparison.snapshot.balance;
    if (delta > 0) throw new Error("universal_credit_source_cutover_value_created");
    const mapped = await client.query(`UPDATE engine_universal_credit_holds h
      SET source_id=m.source_id,updated_at=clock_timestamp()
      FROM engine_universal_credit_shadow_hold_sources m
      WHERE h.operation_epoch_started_at=$1 AND h.workspace_id=$2
        AND h.state='held' AND h.source_id IS NULL
        AND m.operation_epoch_started_at=h.operation_epoch_started_at
        AND m.workspace_id=h.workspace_id AND m.target_id=h.target_id`,
    [epoch, workspace]);
    if (mapped.rowCount !== comparison.snapshot.holds.length) {
      throw new Error("universal_credit_source_hold_cutover_conflict");
    }
    const revision = comparison.snapshot.revision + 1;
    if (delta < 0) {
      await client.query(`INSERT INTO financial_credit_ledger
        (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
         projection_status,metadata,operation_epoch_started_at,
         universal_movement_type,universal_balance_revision,
         universal_balance_after)
        VALUES ($1,'adjustment',$2,'add','source_cutover_classification',$3,
          'projected',$4::jsonb,$5,'SOURCE_CUTOVER',$6,$7)`,
      [workspace, delta, movementKey("SOURCE_CUTOVER", epoch, workspace, hash),
        JSON.stringify({ authority: "financial_credit_ledger",
          baselineHash: hash }), epoch, revision, projected]);
    }
    await client.query(`UPDATE engine_universal_credit_balances
      SET balance=$3,reserved=$4,revision=$5,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspace, projected, comparison.projectedReserved, revision]);
    await client.query(`UPDATE engine_universal_credit_source_workspaces
      SET mode='ACTIVE',activated_at=clock_timestamp(),revision=revision+1,
          updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND mode='SHADOW'`,
    [epoch, workspace]);
    return { ok: true, duplicate: false, cutoverDelta: delta,
      balance: projected, ...comparison };
  });
}

// Explicit R1.5 transition: legacy value remains unclassified and
// non-spendable. Only later ledger-backed cycle sources can fund new holds.
async function activateWorkspaceSegregated({ pool, workspaceId, baselineHash }) {
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
    if (state.mode === "ACTIVE_SEGREGATED") {
      return { ok: true, duplicate: true, mode: state.mode };
    }
    if (state.mode !== "SHADOW") {
      throw new Error("universal_credit_source_transition_mode_conflict");
    }
    const comparison = await shadowComparisonTx(client, { epoch,
      workspaceId: workspace, state, lock: true });
    if (!comparison.ok || comparison.projectedBalance !== comparison.snapshot.balance ||
        comparison.projectedReserved !== comparison.snapshot.reserved) {
      throw new Error(`universal_credit_source_transition_blocked:${[
        ...comparison.divergences,
        ...(comparison.projectedBalance !== comparison.snapshot.balance ?
          ["legacy_balance_changed"] : []),
        ...(comparison.projectedReserved !== comparison.snapshot.reserved ?
          ["legacy_reserved_changed"] : [])
      ].join(",")}`);
    }
    const nonLegacy = (await client.query(`SELECT COUNT(*)::int AS n
      FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND source_kind NOT IN ('legacy_escrow','legacy_unclassified')`,
    [epoch, workspace])).rows[0];
    if (Number(nonLegacy.n) !== 0) {
      throw new Error("universal_credit_source_transition_nonlegacy_source");
    }
    const mapped = await client.query(`UPDATE engine_universal_credit_holds h
      SET source_id=m.source_id,updated_at=clock_timestamp()
      FROM engine_universal_credit_shadow_hold_sources m
      WHERE h.operation_epoch_started_at=$1 AND h.workspace_id=$2
        AND h.state='held' AND h.source_id IS NULL
        AND m.operation_epoch_started_at=h.operation_epoch_started_at
        AND m.workspace_id=h.workspace_id AND m.target_id=h.target_id`,
    [epoch, workspace]);
    if (mapped.rowCount !== comparison.snapshot.holds.length) {
      throw new Error("universal_credit_source_hold_cutover_conflict");
    }
    await client.query(`UPDATE engine_universal_credit_source_workspaces
      SET mode='ACTIVE_SEGREGATED',activated_at=clock_timestamp(),
          revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND mode='SHADOW'`,
    [epoch, workspace]);
    return { ok: true, duplicate: false, mode: "ACTIVE_SEGREGATED",
      historicalBalance: comparison.snapshot.balance,
      historicalReserved: comparison.snapshot.reserved,
      spendable: 0 };
  });
}

async function rollbackSegregatedWorkspace({ pool, workspaceId, baselineHash }) {
  const workspace = text(workspaceId);
  const hash = text(baselineHash);
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("universal_credit_source_rollback_identity_invalid");
  }
  return transaction(pool, async client => {
    const operation = (await client.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 AND mode='UNIVERSAL' FOR SHARE`)).rows[0];
    if (!operation) throw new Error("universal_credit_source_mode_required");
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const state = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (!state || state.mode !== "ACTIVE_SEGREGATED" ||
        state.baseline_hash !== hash) {
      throw new Error("universal_credit_source_rollback_blocked");
    }
    const balance = (await client.query(`SELECT balance,reserved FROM
      engine_universal_credit_balances WHERE operation_epoch_started_at=$1
        AND workspace_id=$2 FOR UPDATE`, [epoch, workspace])).rows[0];
    if (!balance || Number(balance.balance) !== Number(state.baseline_balance) ||
        Number(balance.reserved) !== Number(state.baseline_reserved)) {
      throw new Error("universal_credit_source_rollback_balance_changed");
    }
    const mutations = (await client.query(`SELECT COUNT(*)::int AS n FROM
      financial_credit_ledger WHERE operation_epoch_started_at=$1
        AND cliente_id=$2 AND universal_credit_source_id IS NOT NULL`,
    [epoch, workspace])).rows[0];
    if (Number(mutations.n) !== 0) {
      throw new Error("universal_credit_source_rollback_movements_exist");
    }
    const holds = (await client.query(`SELECT COUNT(*)::int AS held,
        COUNT(*) FILTER (WHERE h.source_id=m.source_id)::int AS mapped
      FROM engine_universal_credit_holds h
      LEFT JOIN engine_universal_credit_shadow_hold_sources m
        ON m.operation_epoch_started_at=h.operation_epoch_started_at
       AND m.workspace_id=h.workspace_id AND m.target_id=h.target_id
      WHERE h.operation_epoch_started_at=$1 AND h.workspace_id=$2
        AND h.state='held'`, [epoch, workspace])).rows[0];
    if (Number(holds.held) !== Number(state.baseline_reserved) ||
        Number(holds.mapped) !== Number(holds.held)) {
      throw new Error("universal_credit_source_rollback_holds_changed");
    }
    await client.query(`UPDATE engine_universal_credit_holds
      SET source_id=NULL,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND state='held'`,
    [epoch, workspace]);
    await client.query(`DELETE FROM engine_universal_credit_shadow_hold_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace]);
    await client.query(`DELETE FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace]);
    await client.query(`DELETE FROM engine_universal_credit_source_workspaces
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND mode='ACTIVE_SEGREGATED'`, [epoch, workspace]);
    return { ok: true, rolledBack: true, legacyAuthorityRestored: true };
  });
}

async function rollbackShadowWorkspace({ pool, workspaceId, baselineHash }) {
  const workspace = text(workspaceId);
  const hash = text(baselineHash);
  if (!workspace || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("universal_credit_source_rollback_identity_invalid");
  }
  return transaction(pool, async client => {
    const operation = (await client.query(`SELECT operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 AND mode='UNIVERSAL' FOR SHARE`)).rows[0];
    if (!operation) throw new Error("universal_credit_source_mode_required");
    const epoch = new Date(operation.operation_epoch_started_at).toISOString();
    const state = await workspaceModeTx(client, { epoch,
      workspaceId: workspace, lock: true });
    if (!state || state.mode !== "SHADOW" || state.baseline_hash !== hash) {
      throw new Error("universal_credit_source_rollback_blocked");
    }
    const comparison = await shadowComparisonTx(client, { epoch,
      workspaceId: workspace, state, lock: true });
    if (comparison.snapshot.holds.some(hold => hold.sourceId !== null)) {
      throw new Error("universal_credit_source_rollback_live_binding_detected");
    }
    await client.query(`DELETE FROM engine_universal_credit_shadow_hold_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace]);
    await client.query(`DELETE FROM engine_universal_credit_sources
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`, [epoch, workspace]);
    await client.query(`DELETE FROM engine_universal_credit_source_workspaces
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 AND mode='SHADOW'`,
    [epoch, workspace]);
    return { ok: true, rolledBack: true, legacyAuthorityUntouched: true,
      snapshotDiverged: !comparison.ok,
      divergencesObserved: comparison.divergences };
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
  if (!sourceAuthorityActive(mode?.mode)) return { handled: false };
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
  if (!sourceAuthorityActive(mode?.mode)) return { handled: false };
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
  if (!sourceAuthorityActive(mode?.mode)) return { handled: false };
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
  if (!sourceAuthorityActive(mode?.mode)) return { handled: false };
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
  if (!sourceAuthorityActive(mode?.mode)) return { handled: false };
  const balance = (await client.query(`SELECT balance,reserved,revision FROM
    engine_universal_credit_balances WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 FOR UPDATE`, [epoch, workspaceId])).rows[0];
  const hold = (await client.query(`SELECT state,source_id FROM
    engine_universal_credit_holds WHERE operation_epoch_started_at=$1
      AND workspace_id=$2 AND target_id=$3 FOR UPDATE`,
  [epoch, workspaceId, targetId])).rows[0];
  if (!hold?.source_id) return { handled: false };
  if (hold.state !== "held") throw new Error("universal_credit_release_conflict");
  const source = (await client.query(`SELECT source_kind,state,cycle_end,reserved,
      (cycle_end IS NULL OR cycle_end>clock_timestamp()) AS cycle_current FROM
    engine_universal_credit_sources WHERE id=$1 FOR UPDATE`,
  [hold.source_id])).rows[0];
  if (!balance || !source || Number(source.reserved) < 1 ||
      Number(balance.reserved) < 1) throw new Error("universal_credit_release_conflict");
  const legacyEscrow = mode.mode === "ACTIVE_SEGREGATED" &&
    source.source_kind === "legacy_escrow";
  const returnable = source.state === "active" && source.cycle_current === true;
  if (returnable) {
    await client.query(`UPDATE engine_universal_credit_sources
      SET reserved=reserved-1,available=available+1,revision=revision+1,
          updated_at=clock_timestamp() WHERE id=$1`, [hold.source_id]);
    await client.query(`UPDATE engine_universal_credit_balances
      SET reserved=reserved-1,revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspaceId]);
  } else if (legacyEscrow) {
    // A factual failure of a legacy ambiguous send removes only the escrow
    // reservation. The historical obligation remains non-spendable until a
    // future, evidence-backed accounting decision classifies it.
    const revision = Number(balance.revision) + 1;
    const ledger = await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at,
       universal_movement_type,universal_target_id,universal_balance_revision,
       universal_balance_after,universal_credit_source_id)
      VALUES ($1,'adjustment',0,'add','universal_legacy_hold_released',$2,
        'projected',$3::jsonb,$4,'LEGACY_HOLD_RELEASE',$5,$6,$7,$8)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [workspaceId, movementKey("LEGACY_HOLD_RELEASE", epoch, workspaceId, targetId),
      JSON.stringify({ authority: "postgresql_universal",
        targetId: String(targetId), sourceId: String(hold.source_id),
        disposition: "legacy_unclassified_nonspendable" }), epoch,
      targetId, revision, Number(balance.balance), hold.source_id]);
    if (ledger.rowCount !== 1) {
      throw new Error("universal_credit_legacy_release_conflict");
    }
    await client.query(`UPDATE engine_universal_credit_sources
      SET reserved=reserved-1,available=available+1,revision=revision+1,
          state=CASE WHEN reserved=1 THEN 'unclassified' ELSE state END,
          updated_at=clock_timestamp() WHERE id=$1`, [hold.source_id]);
    await client.query(`UPDATE engine_universal_credit_balances
      SET reserved=reserved-1,revision=$3,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, workspaceId, revision]);
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
    legacyPreserved: legacyEscrow, sourceId: hold.source_id };
}

module.exports = { workspaceModeTx, sourceAuthorityActive, totalsTx, legacySnapshotTx,
  ledgerProvenanceTx, inspectShadowWorkspace, shadowComparisonTx,
  prepareShadowWorkspace, classifyLegacyAvailable, activateWorkspaceSources,
  activateWorkspaceSegregated, rollbackShadowWorkspace,
  rollbackSegregatedWorkspace,
  recomputeAggregateTx, applyLedgerTx, addAdminTopupTx, holdForTargetTx,
  settleConfirmedTx, releaseForTargetTx };
