"use strict";

const FINANCIAL_PAYMENT_EVENT_TYPES = Object.freeze([
  "payment.created",
  "payment.pending",
  "payment.approved",
  "payment.rejected",
  "payment.cancelled",
  "payment.refunded"
]);

const FINANCIAL_PAYMENT_STATUSES = Object.freeze([
  "created",
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "refunded"
]);

const FINANCIAL_SUBSCRIPTION_STATUSES = Object.freeze([
  "pending_payment",
  "active",
  "suspended",
  "cancelled",
  "refunded"
]);

const FINANCIAL_LEDGER_TYPES = Object.freeze([
  "cycle_credit",
  "admin_credit",
  "adjustment",
  "refund_adjustment"
]);

const FINANCIAL_PROJECTION_STATUSES = Object.freeze([
  "pending",
  "projected",
  "failed",
  "ignored"
]);

const SQL_SCHEMA_FINANCEIRO_V1 = Object.freeze([
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE OR REPLACE FUNCTION financial_touch_updated_at()
   RETURNS TRIGGER AS $$
   BEGIN
     NEW.updated_at = NOW();
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql`,

  `CREATE TABLE IF NOT EXISTS financial_subscriptions (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     cliente_id TEXT NOT NULL,
     plano_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending_payment'
       CHECK (status IN ('pending_payment', 'active', 'suspended', 'cancelled', 'refunded')),
     current_cycle_start TIMESTAMPTZ,
     current_cycle_end TIMESTAMPTZ,
     next_renewal_at TIMESTAMPTZ,
     last_payment_id UUID,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (cliente_id)
   )`,

  `CREATE TABLE IF NOT EXISTS financial_payments (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     provider TEXT NOT NULL,
     external_payment_id TEXT NOT NULL,
     cliente_id TEXT NOT NULL,
     subscription_id UUID REFERENCES financial_subscriptions(id),
     plano_id TEXT NOT NULL,
     amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
     currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
     status TEXT NOT NULL DEFAULT 'created'
       CHECK (status IN ('created', 'pending', 'approved', 'rejected', 'cancelled', 'refunded')),
     plan_snapshot JSONB NOT NULL
       CHECK (
         plan_snapshot ? 'planoId'
         AND plan_snapshot ? 'nomeComercial'
         AND plan_snapshot ? 'amountCents'
         AND plan_snapshot ? 'currency'
         AND plan_snapshot ? 'creditosPorCiclo'
         AND plan_snapshot ? 'cicloDias'
         AND plan_snapshot ? 'renovacaoCreditos'
       ),
     plan_snapshot_captured_at TIMESTAMPTZ NOT NULL,
     approved_at TIMESTAMPTZ,
     cancelled_at TIMESTAMPTZ,
     refunded_at TIMESTAMPTZ,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (provider, external_payment_id)
   )`,

  `CREATE TABLE IF NOT EXISTS financial_payment_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     provider TEXT NOT NULL,
     provider_event_id TEXT NOT NULL,
     external_payment_id TEXT NOT NULL,
     event_type TEXT NOT NULL
       CHECK (event_type IN ('payment.created', 'payment.pending', 'payment.approved', 'payment.rejected', 'payment.cancelled', 'payment.refunded')),
     cliente_id TEXT NOT NULL,
     plano_id TEXT,
     amount_cents INTEGER,
     currency CHAR(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
     occurred_at TIMESTAMPTZ,
     received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     processed_at TIMESTAMPTZ,
     processing_status TEXT NOT NULL DEFAULT 'received'
       CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
     ignored_reason TEXT,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (provider, provider_event_id)
   )`,

  `CREATE TABLE IF NOT EXISTS financial_credit_ledger (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     cliente_id TEXT NOT NULL,
     subscription_id UUID REFERENCES financial_subscriptions(id),
     payment_id UUID REFERENCES financial_payments(id),
     ledger_type TEXT NOT NULL
       CHECK (ledger_type IN ('cycle_credit', 'admin_credit', 'adjustment', 'refund_adjustment')),
     amount INTEGER NOT NULL,
     balance_policy TEXT NOT NULL DEFAULT 'replace_cycle'
       CHECK (balance_policy IN ('replace_cycle', 'add', 'subtract', 'set')),
     cycle_start TIMESTAMPTZ,
     cycle_end TIMESTAMPTZ,
     reason TEXT,
     idempotency_key TEXT NOT NULL,
     projection_status TEXT NOT NULL DEFAULT 'pending'
       CHECK (projection_status IN ('pending', 'projected', 'failed', 'ignored')),
     projected_at TIMESTAMPTZ,
     projection_attempts INTEGER NOT NULL DEFAULT 0,
     projection_error TEXT,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (idempotency_key)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_financial_subscriptions_status
     ON financial_subscriptions(status)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_subscriptions_cycle_end
     ON financial_subscriptions(current_cycle_end)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_payments_cliente
     ON financial_payments(cliente_id)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_payments_status
     ON financial_payments(status)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_payment_events_payment
     ON financial_payment_events(provider, external_payment_id)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_payment_events_processing
     ON financial_payment_events(processing_status, received_at)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_credit_ledger_cliente
     ON financial_credit_ledger(cliente_id)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_credit_ledger_payment
     ON financial_credit_ledger(payment_id)`,

  `CREATE INDEX IF NOT EXISTS idx_financial_credit_ledger_projection
     ON financial_credit_ledger(projection_status, created_at)`,

  `DROP TRIGGER IF EXISTS trg_financial_subscriptions_updated_at ON financial_subscriptions`,
  `CREATE TRIGGER trg_financial_subscriptions_updated_at
     BEFORE UPDATE ON financial_subscriptions
     FOR EACH ROW EXECUTE FUNCTION financial_touch_updated_at()`,

  `DROP TRIGGER IF EXISTS trg_financial_payments_updated_at ON financial_payments`,
  `CREATE TRIGGER trg_financial_payments_updated_at
     BEFORE UPDATE ON financial_payments
     FOR EACH ROW EXECUTE FUNCTION financial_touch_updated_at()`,

  `DROP TRIGGER IF EXISTS trg_financial_payment_events_updated_at ON financial_payment_events`,
  `CREATE TRIGGER trg_financial_payment_events_updated_at
     BEFORE UPDATE ON financial_payment_events
     FOR EACH ROW EXECUTE FUNCTION financial_touch_updated_at()`
]);

module.exports = {
  FINANCIAL_LEDGER_TYPES,
  FINANCIAL_PAYMENT_EVENT_TYPES,
  FINANCIAL_PAYMENT_STATUSES,
  FINANCIAL_PROJECTION_STATUSES,
  FINANCIAL_SUBSCRIPTION_STATUSES,
  SQL_SCHEMA_FINANCEIRO_V1
};
