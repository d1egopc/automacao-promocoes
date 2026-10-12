"use strict";

// O Manual V2 usa a mesma autoridade financeira do Universal: saldo projetado
// em engine_universal_credit_balances e movimento em financial_credit_ledger.
// A linha amount=0/projection_status=ignored e somente uma reserva duravel; ela
// vira TARGET_DEBIT apenas depois de confirmacao factual do transporte.
const { createHash } = require("node:crypto");

function texto(valor) { return String(valor ?? "").trim(); }

function identidade({ workspaceId, operationId, destinationId }) {
  const workspace = texto(workspaceId);
  const operacao = texto(operationId);
  const destino = texto(destinationId);
  if (!workspace || !operacao || !destino) {
    throw new Error("manual_universal_credit_identity_invalid");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([workspace, operacao, destino]))
    .digest("hex");
  const targetId = (BigInt(`0x${digest.slice(0, 16)}`) & ((1n << 63n) - 1n)) || 1n;
  return {
    workspaceId: workspace,
    operationId: operacao,
    destinationId: destino,
    idempotencyKey: `manual-universal:${digest}`,
    targetId: targetId.toString()
  };
}

async function transacao(pool, executar) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("manual_universal_credit_pool_required");
  }
  const client = await pool.connect();
  let aberta = false;
  try {
    await client.query("BEGIN");
    aberta = true;
    const resultado = await executar(client);
    await client.query("COMMIT");
    aberta = false;
    return resultado;
  } catch (erro) {
    if (aberta) await client.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

async function estadoUniversal(client) {
  const estado = (await client.query(`SELECT mode,operation_epoch_started_at
    FROM engine_operation_state WHERE id=1 FOR SHARE`)).rows[0];
  if (estado?.mode !== "UNIVERSAL" || !estado.operation_epoch_started_at) {
    throw new Error("manual_universal_credit_mode_required");
  }
  return new Date(estado.operation_epoch_started_at).toISOString();
}

function validarReservaExistente(row, id, epoch) {
  if (!row) return;
  if (row.cliente_id !== id.workspaceId ||
      new Date(row.operation_epoch_started_at).toISOString() !== epoch ||
      texto(row.metadata?.operationId) !== id.operationId ||
      texto(row.metadata?.destinationId) !== id.destinationId) {
    throw new Error("manual_universal_credit_idempotency_conflict");
  }
}

async function reservarCreditoManualUniversal({ pool, workspaceId, operationId, destinationId }) {
  const id = identidade({ workspaceId, operationId, destinationId });
  return transacao(pool, async (client) => {
    const epoch = await estadoUniversal(client);
    const saldo = (await client.query(`SELECT balance,reserved,revision
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, id.workspaceId])).rows[0];
    if (!saldo) throw new Error("universal_credit_opening_missing");

    const existente = (await client.query(`SELECT cliente_id,amount,
        operation_epoch_started_at,universal_movement_type,metadata
      FROM financial_credit_ledger WHERE idempotency_key=$1 FOR UPDATE`,
    [id.idempotencyKey])).rows[0];
    validarReservaExistente(existente, id, epoch);
    if (existente) {
      const estado = texto(existente.metadata?.reservationState);
      if (existente.universal_movement_type === "TARGET_DEBIT" && Number(existente.amount) === -1) {
        return { ok: true, duplicate: true, consumed: true, epoch, ...id };
      }
      if (estado === "held") return { ok: true, duplicate: true, held: true, epoch, ...id };
      return { ok: false, reason: "manual_credit_reservation_terminal", epoch, ...id };
    }
    if (Number(saldo.balance) - Number(saldo.reserved) < 1) {
      return { ok: false, reason: "sem_creditos", epoch, ...id };
    }

    const metadata = {
      authority: "postgresql_universal",
      origin: "manual_v2",
      reservationState: "held",
      operationId: id.operationId,
      destinationId: id.destinationId,
      targetId: id.targetId
    };
    await client.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,reason,idempotency_key,
       projection_status,metadata,operation_epoch_started_at)
      VALUES ($1,'adjustment',0,'subtract','manual_v2_credit_hold',$2,
        'ignored',$3::jsonb,$4)`,
    [id.workspaceId, id.idempotencyKey, JSON.stringify(metadata), epoch]);
    await client.query(`UPDATE engine_universal_credit_balances
      SET reserved=reserved+1,revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, id.workspaceId]);
    return { ok: true, held: true, duplicate: false, epoch, ...id };
  });
}

async function confirmarCreditoManualUniversal({ pool, reserva }) {
  const id = identidade(reserva || {});
  return transacao(pool, async (client) => {
    const epoch = await estadoUniversal(client);
    const saldo = (await client.query(`SELECT balance,reserved,revision
      FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, id.workspaceId])).rows[0];
    const movimento = (await client.query(`SELECT cliente_id,amount,
        operation_epoch_started_at,universal_movement_type,metadata
      FROM financial_credit_ledger WHERE idempotency_key=$1 FOR UPDATE`,
    [id.idempotencyKey])).rows[0];
    validarReservaExistente(movimento, id, epoch);
    if (movimento?.universal_movement_type === "TARGET_DEBIT" && Number(movimento.amount) === -1) {
      return { ok: true, duplicate: true, debited: false };
    }
    if (!saldo || !movimento || texto(movimento.metadata?.reservationState) !== "held" ||
        Number(saldo.balance) < 1 || Number(saldo.reserved) < 1) {
      throw new Error("manual_universal_credit_confirmed_hold_missing");
    }
    const revision = Number(saldo.revision) + 1;
    const balanceAfter = Number(saldo.balance) - 1;
    await client.query(`UPDATE engine_universal_credit_balances
      SET balance=$3,reserved=reserved-1,revision=$4,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, id.workspaceId, balanceAfter, revision]);
    await client.query(`UPDATE financial_credit_ledger SET
        amount=-1,projection_status='projected',projected_at=clock_timestamp(),
        reason='manual_v2_target_confirmed',
        metadata=metadata || '{"reservationState":"consumed"}'::jsonb,
        universal_movement_type='TARGET_DEBIT',universal_target_id=$2,
        universal_balance_revision=$3,universal_balance_after=$4
      WHERE idempotency_key=$1`,
    [id.idempotencyKey, id.targetId, revision, balanceAfter]);
    return { ok: true, duplicate: false, debited: true, balanceAfter };
  });
}

async function liberarCreditoManualUniversal({ pool, reserva }) {
  const id = identidade(reserva || {});
  return transacao(pool, async (client) => {
    const epoch = await estadoUniversal(client);
    const saldo = (await client.query(`SELECT reserved FROM engine_universal_credit_balances
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2 FOR UPDATE`,
    [epoch, id.workspaceId])).rows[0];
    const movimento = (await client.query(`SELECT cliente_id,amount,
        operation_epoch_started_at,universal_movement_type,metadata
      FROM financial_credit_ledger WHERE idempotency_key=$1 FOR UPDATE`,
    [id.idempotencyKey])).rows[0];
    validarReservaExistente(movimento, id, epoch);
    if (!movimento || texto(movimento.metadata?.reservationState) === "released") {
      return { ok: true, released: false };
    }
    if (movimento.universal_movement_type === "TARGET_DEBIT") {
      return { ok: true, released: false, consumed: true };
    }
    if (!saldo || texto(movimento.metadata?.reservationState) !== "held" || Number(saldo.reserved) < 1) {
      throw new Error("manual_universal_credit_release_conflict");
    }
    await client.query(`UPDATE engine_universal_credit_balances
      SET reserved=reserved-1,revision=revision+1,updated_at=clock_timestamp()
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, id.workspaceId]);
    await client.query(`UPDATE financial_credit_ledger SET
        metadata=metadata || '{"reservationState":"released"}'::jsonb
      WHERE idempotency_key=$1`, [id.idempotencyKey]);
    return { ok: true, released: true };
  });
}

module.exports = {
  reservarCreditoManualUniversal,
  confirmarCreditoManualUniversal,
  liberarCreditoManualUniversal
};
