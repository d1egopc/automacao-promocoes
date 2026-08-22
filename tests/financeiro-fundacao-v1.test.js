"use strict";

const assert = require("assert");

const financeiro = require("../modules/financeiro");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

class RepositorioFinanceiroMemoria {
  constructor() {
    this.state = {
      events: [],
      payments: [],
      subscriptions: [],
      ledger: []
    };
    this.seq = 1;
    this.lock = Promise.resolve();
    this.falharInserirLedgerUmaVez = false;
    this.falhasProjecao = [];
    this.projetados = [];
  }

  novoId(prefixo) {
    const id = `${prefixo}_${this.seq}`;
    this.seq += 1;
    return id;
  }

  async transacao(fn) {
    const executar = this.lock.then(async () => {
      const draft = clone(this.state);
      const tx = this.criarTx(draft);
      const resultado = await fn(tx);
      this.state = draft;
      return resultado;
    });
    this.lock = executar.catch(() => {});
    return executar;
  }

  async criarCobranca(payment) {
    return this.transacao((tx) => tx.criarPayment(payment));
  }

  async listarLedgerPendente() {
    return this.state.ledger.filter((l) => l.projection_status === "pending");
  }

  async marcarLedgerProjetado(ledgerId) {
    const ledger = this.state.ledger.find((l) => l.id === ledgerId);
    if (ledger) {
      ledger.projection_status = "projected";
      ledger.projected_at = new Date("2026-08-22T00:00:00.000Z").toISOString();
      ledger.projection_attempts += 1;
      ledger.projection_error = null;
    }
    this.projetados.push(ledgerId);
  }

  async marcarLedgerFalha(ledgerId, erro) {
    const ledger = this.state.ledger.find((l) => l.id === ledgerId);
    if (ledger) {
      ledger.projection_status = "pending";
      ledger.projection_attempts += 1;
      ledger.projection_error = String(erro || "erro");
    }
    this.falhasProjecao.push({ ledgerId, erro: String(erro || "erro") });
  }

  criarTx(state) {
    const repo = this;
    return {
      async inserirEvento(evento) {
        if (state.events.some((e) => e.provider === evento.provider && e.provider_event_id === evento.providerEventId)) {
          return null;
        }
        const row = {
          id: repo.novoId("evt"),
          provider: evento.provider,
          provider_event_id: evento.providerEventId,
          external_payment_id: evento.externalPaymentId,
          event_type: evento.type,
          cliente_id: evento.clienteId,
          plano_id: evento.planoId || null,
          amount_cents: evento.amountCents ?? null,
          currency: evento.currency || null,
          metadata: evento.metadata || {},
          processing_status: "received"
        };
        state.events.push(row);
        return row;
      },

      async marcarEventoProcessado(eventoId) {
        const evt = state.events.find((e) => e.id === eventoId);
        evt.processing_status = "processed";
      },

      async marcarEventoIgnorado(eventoId, motivo) {
        const evt = state.events.find((e) => e.id === eventoId);
        evt.processing_status = "ignored";
        evt.ignored_reason = motivo;
      },

      async marcarEventoFalha(eventoId, motivo) {
        const evt = state.events.find((e) => e.id === eventoId);
        evt.processing_status = "failed";
        evt.ignored_reason = motivo;
      },

      async buscarPayment(provider, externalPaymentId) {
        return state.payments.find((p) => p.provider === provider && p.external_payment_id === externalPaymentId) || null;
      },

      async criarPayment(payment) {
        const existente = state.payments.find((p) => p.provider === payment.provider && p.external_payment_id === payment.externalPaymentId);
        if (existente) return existente;
        const row = {
          id: repo.novoId("pay"),
          provider: payment.provider,
          external_payment_id: payment.externalPaymentId,
          cliente_id: payment.clienteId,
          subscription_id: payment.subscriptionId || null,
          plano_id: payment.planoId,
          amount_cents: payment.amountCents,
          currency: payment.currency,
          status: payment.status || "created",
          plan_snapshot: clone(payment.planSnapshot),
          plan_snapshot_captured_at: payment.planSnapshotCapturedAt,
          metadata: payment.metadata || {}
        };
        state.payments.push(row);
        return row;
      },

      async atualizarPayment(paymentId, campos) {
        const row = state.payments.find((p) => p.id === paymentId);
        if (!row) return null;
        if (campos.status) row.status = campos.status;
        if (campos.subscriptionId !== undefined) row.subscription_id = campos.subscriptionId;
        if (campos.approvedAt !== undefined) row.approved_at = campos.approvedAt;
        if (campos.cancelledAt !== undefined) row.cancelled_at = campos.cancelledAt;
        if (campos.refundedAt !== undefined) row.refunded_at = campos.refundedAt;
        if (campos.metadata !== undefined) row.metadata = campos.metadata;
        return row;
      },

      async obterOuCriarSubscription(clienteId, planoId) {
        let row = state.subscriptions.find((s) => s.cliente_id === clienteId);
        if (row) return row;
        row = {
          id: repo.novoId("sub"),
          cliente_id: clienteId,
          plano_id: planoId,
          status: "pending_payment",
          metadata: {}
        };
        state.subscriptions.push(row);
        return row;
      },

      async atualizarSubscription(subscriptionId, campos) {
        const row = state.subscriptions.find((s) => s.id === subscriptionId);
        if (!row) return null;
        if (campos.planoId) row.plano_id = campos.planoId;
        if (campos.status) row.status = campos.status;
        if (campos.currentCycleStart !== undefined) row.current_cycle_start = campos.currentCycleStart;
        if (campos.currentCycleEnd !== undefined) row.current_cycle_end = campos.currentCycleEnd;
        if (campos.nextRenewalAt !== undefined) row.next_renewal_at = campos.nextRenewalAt;
        if (campos.lastPaymentId !== undefined) row.last_payment_id = campos.lastPaymentId;
        if (campos.metadata !== undefined) row.metadata = campos.metadata;
        return row;
      },

      async inserirLedger(ledger) {
        if (repo.falharInserirLedgerUmaVez) {
          repo.falharInserirLedgerUmaVez = false;
          throw new Error("falha_ledger_forcada");
        }
        if (state.ledger.some((l) => l.idempotency_key === ledger.idempotencyKey)) {
          return null;
        }
        const row = {
          id: repo.novoId("led"),
          cliente_id: ledger.clienteId,
          subscription_id: ledger.subscriptionId || null,
          payment_id: ledger.paymentId || null,
          ledger_type: ledger.ledgerType,
          amount: ledger.amount,
          balance_policy: ledger.balancePolicy || "replace_cycle",
          cycle_start: ledger.cycleStart || null,
          cycle_end: ledger.cycleEnd || null,
          reason: ledger.reason || null,
          idempotency_key: ledger.idempotencyKey,
          projection_status: "pending",
          projection_attempts: 0,
          metadata: clone(ledger.metadata || {})
        };
        state.ledger.push(row);
        return row;
      }
    };
  }
}

const planoPro3490 = {
  id: "pro",
  nome: "Pro",
  preco: "R$ 34,90",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento",
  limites: { creditosPorCiclo: 2000, cicloDias: 30 }
};

const planoFreeBeta = {
  id: "free_beta",
  nome: "Free Beta",
  preco: "R$ 0,00",
  visivelPublicamente: true,
  contratavel: true,
  entradaBeta: true,
  renovacaoCreditos: "sem_renovacao",
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 300, cicloDias: 30 }
};

function evento(type, providerEventId, externalPaymentId = "pay_001") {
  return {
    type,
    provider: "simulated",
    providerEventId,
    externalPaymentId,
    clienteId: "cliente_1",
    receivedAt: "2026-08-22T12:00:00.000Z"
  };
}

(async () => {
  const sqlExecutados = [];
  const schema = await financeiro.prepararSchemaFinanceiro({
    query: async (sql) => {
      sqlExecutados.push(sql);
      return { ok: true };
    }
  });
  assert.strictEqual(schema.ok, true, "migration financeira deve aplicar em banco vazio");
  const sql = sqlExecutados.join("\n");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS financial_subscriptions"));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS financial_payments"));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS financial_payment_events"));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS financial_credit_ledger"));
  assert.ok(sql.includes("plan_snapshot JSONB NOT NULL"), "payment deve ter snapshot comercial obrigatorio");
  assert.ok(sql.includes("UNIQUE (provider, external_payment_id)"), "payment deve deduplicar provider/payment");
  assert.ok(sql.includes("UNIQUE (provider, provider_event_id)"), "evento deve deduplicar provider/event");
  assert.ok(sql.includes("UNIQUE (idempotency_key)"), "ledger deve deduplicar idempotency_key");
  assert.ok(!financeiro.FINANCIAL_LEDGER_TYPES.includes("usage_debit"), "V1 nao registra debito por envio no ledger financeiro");

  const repoFree = new RepositorioFinanceiroMemoria();
  const free = await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_free",
    planoId: "free_beta",
    planos: { free_beta: planoFreeBeta },
    repositorio: repoFree
  });
  assert.strictEqual(free.ok, false);
  assert.strictEqual(free.codigo, "plano_free_beta_nao_cobravel", "Free Beta nao pode gerar cobranca paga");

  const repo = new RepositorioFinanceiroMemoria();
  const cobrancaAntiga = await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro3490 },
    externalPaymentId: "pay_001",
    repositorio: repo,
    agora: new Date("2026-08-22T10:00:00.000Z")
  });
  assert.strictEqual(cobrancaAntiga.ok, true);
  assert.strictEqual(cobrancaAntiga.planSnapshot.amountCents, 3490);
  assert.strictEqual(cobrancaAntiga.planSnapshot.creditosPorCiclo, 2000);

  const planoPro3990 = clone(planoPro3490);
  planoPro3990.preco = "R$ 39,90";
  planoPro3990.limites.creditosPorCiclo = 2500;

  const aprovado = await financeiro.processarFinancialPaymentEvent(
    evento("payment.approved", "evt_approved_001"),
    { repositorio: repo, agora: new Date("2026-08-22T12:00:00.000Z") }
  );
  assert.strictEqual(aprovado.ok, true);
  assert.strictEqual(repo.state.ledger.length, 1);
  assert.strictEqual(repo.state.ledger[0].amount, 2000, "aprovacao deve usar snapshot antigo, nao plano editado");

  const novaCobranca = await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro3990 },
    externalPaymentId: "pay_002",
    repositorio: repo,
    agora: new Date("2026-08-22T13:00:00.000Z")
  });
  assert.strictEqual(novaCobranca.planSnapshot.amountCents, 3990);
  assert.strictEqual(novaCobranca.planSnapshot.creditosPorCiclo, 2500, "nova cobranca pega snapshot novo");

  const duplicadoEvento = await financeiro.processarFinancialPaymentEvent(
    evento("payment.approved", "evt_approved_001"),
    { repositorio: repo, agora: new Date("2026-08-22T12:01:00.000Z") }
  );
  assert.strictEqual(duplicadoEvento.idempotente, true);
  assert.strictEqual(repo.state.ledger.length, 1, "evento duplicado nao duplica ledger");

  const duplicadoPagamento = await financeiro.processarFinancialPaymentEvent(
    evento("payment.approved", "evt_approved_002"),
    { repositorio: repo, agora: new Date("2026-08-22T12:02:00.000Z") }
  );
  assert.strictEqual(duplicadoPagamento.idempotente, true);
  assert.strictEqual(repo.state.ledger.length, 1, "pagamento duplicado nao duplica ciclo/credito");

  await Promise.all([
    financeiro.processarFinancialPaymentEvent(evento("payment.approved", "evt_conc_1"), { repositorio: repo }),
    financeiro.processarFinancialPaymentEvent(evento("payment.approved", "evt_conc_2"), { repositorio: repo })
  ]);
  assert.strictEqual(repo.state.ledger.length, 1, "duas aprovacoes concorrentes mantem uma concessao pelo idempotency_key");

  const repoPending = new RepositorioFinanceiroMemoria();
  await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro3490 },
    externalPaymentId: "pay_pending",
    repositorio: repoPending
  });
  const pendente = await financeiro.processarFinancialPaymentEvent(
    evento("payment.pending", "evt_pending", "pay_pending"),
    { repositorio: repoPending }
  );
  assert.strictEqual(pendente.status, "pending");
  assert.strictEqual(repoPending.state.ledger.length, 0);
  const aprovadoDepois = await financeiro.processarFinancialPaymentEvent(
    evento("payment.approved", "evt_pending_approved", "pay_pending"),
    { repositorio: repoPending }
  );
  assert.strictEqual(aprovadoDepois.status, "approved", "pending -> approved e valido");
  assert.strictEqual(repoPending.state.ledger.length, 1);
  const antigoPendente = await financeiro.processarFinancialPaymentEvent(
    evento("payment.pending", "evt_pending_old", "pay_pending"),
    { repositorio: repoPending }
  );
  assert.strictEqual(antigoPendente.ignorado, true, "approved -> pending deve ser ignorado");
  assert.strictEqual(repoPending.state.ledger.length, 1);

  const repoRejected = new RepositorioFinanceiroMemoria();
  await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro3490 },
    externalPaymentId: "pay_rejected",
    repositorio: repoRejected
  });
  const recusado = await financeiro.processarFinancialPaymentEvent(
    evento("payment.rejected", "evt_rejected", "pay_rejected"),
    { repositorio: repoRejected }
  );
  assert.strictEqual(recusado.status, "rejected");
  assert.strictEqual(repoRejected.state.ledger.length, 0, "rejected nao concede credito");

  const repoRollback = new RepositorioFinanceiroMemoria();
  await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro3490 },
    externalPaymentId: "pay_rollback",
    repositorio: repoRollback
  });
  repoRollback.falharInserirLedgerUmaVez = true;
  await assert.rejects(
    () => financeiro.processarFinancialPaymentEvent(
      evento("payment.approved", "evt_rollback", "pay_rollback"),
      { repositorio: repoRollback }
    ),
    /falha_ledger_forcada/,
    "falha dentro da transacao deve dar rollback integral"
  );
  assert.strictEqual(repoRollback.state.payments.find((p) => p.external_payment_id === "pay_rollback").status, "created");
  assert.strictEqual(repoRollback.state.ledger.length, 0);
  assert.strictEqual(repoRollback.state.events.some((e) => e.provider_event_id === "evt_rollback"), false);

  const ledger = repo.state.ledger[0];
  let usuarios = [{ id: "cliente_1", creditos: 17, plano: "free_beta", assinaturaStatus: "nao_aplicavel" }];
  let falharSalvar = true;
  const primeiraProjecao = await financeiro.reconciliarLedgerFinanceiroPendente({
    repositorio: repo,
    lerUsuarios: async () => usuarios,
    salvarUsuarios: async (novos) => {
      usuarios = novos;
      if (falharSalvar) {
        falharSalvar = false;
        throw new Error("falha_storage_usuarios");
      }
    }
  });
  assert.strictEqual(primeiraProjecao.falhas, 1);
  assert.strictEqual(repo.state.ledger.find((l) => l.id === ledger.id).projection_status, "pending", "falha de projecao fica pendente");

  const retry = await financeiro.reconciliarLedgerFinanceiroPendente({
    repositorio: repo,
    lerUsuarios: async () => usuarios,
    salvarUsuarios: async (novos) => {
      usuarios = novos;
    }
  });
  assert.strictEqual(retry.projetados, 1);
  assert.strictEqual(usuarios[0].creditos, 2000);
  assert.strictEqual(usuarios[0].plano, "pro");
  assert.strictEqual(usuarios[0].assinaturaStatus, "ativa");
  assert.strictEqual(repo.state.ledger.find((l) => l.id === ledger.id).projection_status, "projected");

  await financeiro.reconciliarLedgerFinanceiroPendente({
    repositorio: repo,
    lerUsuarios: async () => usuarios,
    salvarUsuarios: async (novos) => {
      usuarios = novos;
    }
  });
  assert.strictEqual(usuarios[0].creditos, 2000, "retry apos projected nao duplica saldo");

  console.log("financeiro-fundacao-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
