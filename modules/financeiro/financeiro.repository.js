"use strict";

const {
  getEnginePool,
  queryEngine
} = require("../engine/database");
const { SQL_SCHEMA_FINANCEIRO_V1 } = require("./financeiro.schema");

function financeiroDatabaseUrl() {
  return String(process.env.DATABASE_URL || "").trim();
}

function financeiroDbHabilitado() {
  return Boolean(financeiroDatabaseUrl());
}

function getFinanceiroPool() {
  return getEnginePool();
}

async function queryFinanceiro(sql, params = []) {
  return queryEngine(sql, params);
}

async function prepararSchemaFinanceiro({ query = queryFinanceiro } = {}) {
  for (const sql of SQL_SCHEMA_FINANCEIRO_V1) {
    const resultado = await query(sql);
    if (!resultado?.ok) {
      return {
        ok: false,
        motivo: resultado?.motivo || "schema_financeiro_falhou",
        erro: resultado?.erro,
        sql
      };
    }
  }
  return { ok: true, tabelas: "financeiro_v1" };
}

function linhaUnica(resultado) {
  return resultado?.rows?.[0] || null;
}

async function executarTransacaoFinanceira(fn, { pool = getFinanceiroPool } = {}) {
  const clientPool = typeof pool === "function" ? pool() : pool;
  if (!clientPool) {
    return { ok: false, motivo: financeiroDbHabilitado() ? "pool_indisponivel" : "database_url_ausente" };
  }

  const client = await clientPool.connect();
  try {
    await client.query("BEGIN");
    const tx = criarTransacaoFinanceira(client);
    const resultado = await fn(tx);
    await client.query("COMMIT");
    return resultado;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

function criarTransacaoFinanceira(client) {
  return {
    async inserirEvento(evento) {
      const resultado = await client.query(
        `INSERT INTO financial_payment_events (
           provider, provider_event_id, external_payment_id, event_type,
           cliente_id, plano_id, amount_cents, currency, occurred_at,
           received_at, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING *`,
        [
          evento.provider,
          evento.providerEventId,
          evento.externalPaymentId,
          evento.type,
          evento.clienteId,
          evento.planoId || null,
          evento.amountCents ?? null,
          evento.currency || null,
          evento.occurredAt || null,
          evento.receivedAt,
          JSON.stringify(evento.metadata || {})
        ]
      );
      return linhaUnica(resultado);
    },

    async marcarEventoProcessado(eventoId) {
      await client.query(
        `UPDATE financial_payment_events
         SET processing_status = 'processed', processed_at = NOW(), ignored_reason = NULL
         WHERE id = $1`,
        [eventoId]
      );
    },

    async marcarEventoIgnorado(eventoId, motivo) {
      await client.query(
        `UPDATE financial_payment_events
         SET processing_status = 'ignored', processed_at = NOW(), ignored_reason = $2
         WHERE id = $1`,
        [eventoId, motivo]
      );
    },

    async marcarEventoFalha(eventoId, motivo) {
      await client.query(
        `UPDATE financial_payment_events
         SET processing_status = 'failed', processed_at = NOW(), ignored_reason = $2
         WHERE id = $1`,
        [eventoId, motivo]
      );
    },

    async buscarPayment(provider, externalPaymentId) {
      const resultado = await client.query(
        `SELECT * FROM financial_payments
         WHERE provider = $1 AND external_payment_id = $2
         FOR UPDATE`,
        [provider, externalPaymentId]
      );
      return linhaUnica(resultado);
    },

    async criarPayment(payment) {
      const resultado = await client.query(
        `INSERT INTO financial_payments (
           provider, external_payment_id, cliente_id, subscription_id, plano_id,
           amount_cents, currency, status, plan_snapshot,
           plan_snapshot_captured_at, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
         ON CONFLICT (provider, external_payment_id) DO UPDATE
           SET provider = financial_payments.provider
         RETURNING *`,
        [
          payment.provider,
          payment.externalPaymentId,
          payment.clienteId,
          payment.subscriptionId || null,
          payment.planoId,
          payment.amountCents,
          payment.currency,
          payment.status || "created",
          JSON.stringify(payment.planSnapshot),
          payment.planSnapshotCapturedAt,
          JSON.stringify(payment.metadata || {})
        ]
      );
      return linhaUnica(resultado);
    },

    async atualizarPayment(paymentId, campos) {
      const atualizacoes = [];
      const params = [];
      function add(coluna, valor, cast = "") {
        params.push(valor);
        atualizacoes.push(`${coluna} = $${params.length}${cast}`);
      }

      if (campos.status) add("status", campos.status);
      if (campos.subscriptionId !== undefined) add("subscription_id", campos.subscriptionId);
      if (campos.approvedAt !== undefined) add("approved_at", campos.approvedAt);
      if (campos.cancelledAt !== undefined) add("cancelled_at", campos.cancelledAt);
      if (campos.refundedAt !== undefined) add("refunded_at", campos.refundedAt);
      if (campos.metadata !== undefined) add("metadata", JSON.stringify(campos.metadata), "::jsonb");

      if (!atualizacoes.length) return null;
      params.push(paymentId);
      const resultado = await client.query(
        `UPDATE financial_payments
         SET ${atualizacoes.join(", ")}
         WHERE id = $${params.length}
         RETURNING *`,
        params
      );
      return linhaUnica(resultado);
    },

    async obterOuCriarSubscription(clienteId, planoId) {
      let resultado = await client.query(
        `SELECT * FROM financial_subscriptions
         WHERE cliente_id = $1
         FOR UPDATE`,
        [clienteId]
      );
      let subscription = linhaUnica(resultado);
      if (subscription) return subscription;

      resultado = await client.query(
        `INSERT INTO financial_subscriptions (cliente_id, plano_id, status)
         VALUES ($1, $2, 'pending_payment')
         ON CONFLICT (cliente_id) DO UPDATE
           SET cliente_id = financial_subscriptions.cliente_id
         RETURNING *`,
        [clienteId, planoId]
      );
      subscription = linhaUnica(resultado);
      if (!subscription) {
        resultado = await client.query(
          `SELECT * FROM financial_subscriptions
           WHERE cliente_id = $1
           FOR UPDATE`,
          [clienteId]
        );
        subscription = linhaUnica(resultado);
      }
      return subscription;
    },

    async atualizarSubscription(subscriptionId, campos) {
      const atualizacoes = [];
      const params = [];
      function add(coluna, valor, cast = "") {
        params.push(valor);
        atualizacoes.push(`${coluna} = $${params.length}${cast}`);
      }

      if (campos.planoId) add("plano_id", campos.planoId);
      if (campos.status) add("status", campos.status);
      if (campos.currentCycleStart !== undefined) add("current_cycle_start", campos.currentCycleStart);
      if (campos.currentCycleEnd !== undefined) add("current_cycle_end", campos.currentCycleEnd);
      if (campos.nextRenewalAt !== undefined) add("next_renewal_at", campos.nextRenewalAt);
      if (campos.lastPaymentId !== undefined) add("last_payment_id", campos.lastPaymentId);
      if (campos.metadata !== undefined) add("metadata", JSON.stringify(campos.metadata), "::jsonb");

      if (!atualizacoes.length) return null;
      params.push(subscriptionId);
      const resultado = await client.query(
        `UPDATE financial_subscriptions
         SET ${atualizacoes.join(", ")}
         WHERE id = $${params.length}
         RETURNING *`,
        params
      );
      return linhaUnica(resultado);
    },

    async inserirLedger(ledger) {
      const resultado = await client.query(
        `INSERT INTO financial_credit_ledger (
           cliente_id, subscription_id, payment_id, ledger_type, amount,
           balance_policy, cycle_start, cycle_end, reason,
           idempotency_key, projection_status, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          ledger.clienteId,
          ledger.subscriptionId || null,
          ledger.paymentId || null,
          ledger.ledgerType,
          ledger.amount,
          ledger.balancePolicy || "replace_cycle",
          ledger.cycleStart || null,
          ledger.cycleEnd || null,
          ledger.reason || null,
          ledger.idempotencyKey,
          JSON.stringify(ledger.metadata || {})
        ]
      );
      return linhaUnica(resultado);
    }
  };
}

function criarRepositorioFinanceiroPostgres({ pool } = {}) {
  return {
    async transacao(fn) {
      return executarTransacaoFinanceira(fn, { pool: pool || getFinanceiroPool });
    },

    async criarCobranca(payment) {
      return executarTransacaoFinanceira(async (tx) => tx.criarPayment(payment), { pool: pool || getFinanceiroPool });
    },

    async buscarPayment(provider, externalPaymentId) {
      const resultado = await queryFinanceiro(
        `SELECT *
         FROM financial_payments
         WHERE provider = $1 AND external_payment_id = $2`,
        [provider, externalPaymentId]
      );
      if (!resultado?.ok) return null;
      return resultado.resultado?.rows?.[0] || null;
    },

    async listarLedgerPendente(opcoes = 50) {
      const filtros = typeof opcoes === "object" && opcoes !== null ? opcoes : { limite: opcoes };
      const limite = Math.max(1, Math.min(200, Number(filtros.limite) || 50));
      const params = [limite];
      const where = ["l.projection_status = 'pending'"];
      let joinPayment = false;

      if (filtros.clienteId) {
        params.push(String(filtros.clienteId));
        where.push(`l.cliente_id = $${params.length}`);
      }
      if (filtros.provider) {
        joinPayment = true;
        params.push(String(filtros.provider));
        where.push(`p.provider = $${params.length}`);
      }
      if (filtros.externalPaymentId) {
        joinPayment = true;
        params.push(String(filtros.externalPaymentId));
        where.push(`p.external_payment_id = $${params.length}`);
      }

      const resultado = await queryFinanceiro(
        `SELECT l.*
         FROM financial_credit_ledger l
         ${joinPayment ? "JOIN financial_payments p ON p.id = l.payment_id" : ""}
         WHERE ${where.join(" AND ")}
         ORDER BY l.created_at ASC
         LIMIT $1`,
        params
      );
      if (!resultado?.ok) return [];
      return resultado.resultado?.rows || [];
    },

    async marcarLedgerProjetado(ledgerId) {
      return queryFinanceiro(
        `UPDATE financial_credit_ledger
         SET projection_status = 'projected',
             projected_at = NOW(),
             projection_attempts = projection_attempts + 1,
             projection_error = NULL
         WHERE id = $1`,
        [ledgerId]
      );
    },

    async marcarLedgerFalha(ledgerId, erro) {
      return queryFinanceiro(
        `UPDATE financial_credit_ledger
         SET projection_status = 'pending',
             projection_attempts = projection_attempts + 1,
             projection_error = $2
         WHERE id = $1`,
        [ledgerId, String(erro || "erro_projecao").slice(0, 500)]
      );
    }
  };
}

module.exports = {
  criarRepositorioFinanceiroPostgres,
  criarTransacaoFinanceira,
  executarTransacaoFinanceira,
  financeiroDatabaseUrl,
  financeiroDbHabilitado,
  getFinanceiroPool,
  prepararSchemaFinanceiro,
  queryFinanceiro
};
