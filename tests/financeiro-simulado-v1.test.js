"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const financeiro = require("../modules/financeiro");
const saas = require("../utils/saas-fundacao");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

class RepoMemoria {
  constructor() {
    this.state = { events: [], payments: [], subscriptions: [], ledger: [] };
    this.seq = 1;
    this.lock = Promise.resolve();
  }

  id(prefixo) {
    const id = `${prefixo}_${this.seq}`;
    this.seq += 1;
    return id;
  }

  async transacao(fn) {
    const executar = this.lock.then(async () => {
      const draft = clone(this.state);
      const tx = this.tx(draft);
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

  async buscarPayment(provider, externalPaymentId) {
    return this.state.payments.find((p) => p.provider === provider && p.external_payment_id === externalPaymentId) || null;
  }

  async listarLedgerPendente(opcoes = {}) {
    const filtros = typeof opcoes === "object" ? opcoes : { limite: opcoes };
    return this.state.ledger
      .filter((l) => l.projection_status === "pending")
      .filter((l) => !filtros.clienteId || l.cliente_id === filtros.clienteId)
      .filter((l) => {
        if (!filtros.provider && !filtros.externalPaymentId) return true;
        const p = this.state.payments.find((pay) => pay.id === l.payment_id);
        if (!p) return false;
        if (filtros.provider && p.provider !== filtros.provider) return false;
        if (filtros.externalPaymentId && p.external_payment_id !== filtros.externalPaymentId) return false;
        return true;
      })
      .slice(0, Number(filtros.limite || 50));
  }

  async marcarLedgerProjetado(ledgerId) {
    const l = this.state.ledger.find((item) => item.id === ledgerId);
    if (!l) return;
    l.projection_status = "projected";
    l.projection_attempts += 1;
    l.projected_at = new Date().toISOString();
    l.projection_error = null;
  }

  async marcarLedgerFalha(ledgerId, erro) {
    const l = this.state.ledger.find((item) => item.id === ledgerId);
    if (!l) return;
    l.projection_status = "pending";
    l.projection_attempts += 1;
    l.projection_error = String(erro || "erro");
  }

  tx(state) {
    const repo = this;
    return {
      async inserirEvento(evento) {
        if (state.events.some((e) => e.provider === evento.provider && e.provider_event_id === evento.providerEventId)) return null;
        const row = {
          id: repo.id("evt"),
          provider: evento.provider,
          provider_event_id: evento.providerEventId,
          external_payment_id: evento.externalPaymentId,
          event_type: evento.type,
          cliente_id: evento.clienteId,
          plano_id: evento.planoId || null,
          processing_status: "received",
          metadata: evento.metadata || {}
        };
        state.events.push(row);
        return row;
      },
      async marcarEventoProcessado(id) {
        const e = state.events.find((item) => item.id === id);
        e.processing_status = "processed";
      },
      async marcarEventoIgnorado(id, motivo) {
        const e = state.events.find((item) => item.id === id);
        e.processing_status = "ignored";
        e.ignored_reason = motivo;
      },
      async marcarEventoFalha(id, motivo) {
        const e = state.events.find((item) => item.id === id);
        e.processing_status = "failed";
        e.ignored_reason = motivo;
      },
      async buscarPayment(provider, externalPaymentId) {
        return state.payments.find((p) => p.provider === provider && p.external_payment_id === externalPaymentId) || null;
      },
      async criarPayment(payment) {
        const existente = state.payments.find((p) => p.provider === payment.provider && p.external_payment_id === payment.externalPaymentId);
        if (existente) return existente;
        const row = {
          id: repo.id("pay"),
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
      async atualizarPayment(id, campos) {
        const p = state.payments.find((item) => item.id === id);
        if (!p) return null;
        if (campos.status) p.status = campos.status;
        if (campos.subscriptionId !== undefined) p.subscription_id = campos.subscriptionId;
        if (campos.approvedAt !== undefined) p.approved_at = campos.approvedAt;
        if (campos.cancelledAt !== undefined) p.cancelled_at = campos.cancelledAt;
        if (campos.refundedAt !== undefined) p.refunded_at = campos.refundedAt;
        return p;
      },
      async obterOuCriarSubscription(clienteId, planoId) {
        let s = state.subscriptions.find((item) => item.cliente_id === clienteId);
        if (s) return s;
        s = { id: repo.id("sub"), cliente_id: clienteId, plano_id: planoId, status: "pending_payment", metadata: {} };
        state.subscriptions.push(s);
        return s;
      },
      async atualizarSubscription(id, campos) {
        const s = state.subscriptions.find((item) => item.id === id);
        if (!s) return null;
        if (campos.planoId) s.plano_id = campos.planoId;
        if (campos.status) s.status = campos.status;
        if (campos.currentCycleStart !== undefined) s.current_cycle_start = campos.currentCycleStart;
        if (campos.currentCycleEnd !== undefined) s.current_cycle_end = campos.currentCycleEnd;
        if (campos.nextRenewalAt !== undefined) s.next_renewal_at = campos.nextRenewalAt;
        if (campos.lastPaymentId !== undefined) s.last_payment_id = campos.lastPaymentId;
        if (campos.metadata !== undefined) s.metadata = campos.metadata;
        return s;
      },
      async inserirLedger(ledger) {
        if (state.ledger.some((l) => l.idempotency_key === ledger.idempotencyKey)) return null;
        const row = {
          id: repo.id("led"),
          cliente_id: ledger.clienteId,
          subscription_id: ledger.subscriptionId || null,
          payment_id: ledger.paymentId || null,
          ledger_type: ledger.ledgerType,
          amount: ledger.amount,
          balance_policy: ledger.balancePolicy || "replace_cycle",
          cycle_start: ledger.cycleStart || null,
          cycle_end: ledger.cycleEnd || null,
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

const planoFree = {
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

const planoPro = {
  id: "pro",
  nome: "Pro",
  preco: "R$ 34,90",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento",
  limites: { creditosPorCiclo: 2000, cicloDias: 30 }
};

const planoUltimate = {
  id: "ultimate",
  nome: "Ultimate",
  preco: "R$ 79,90",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento",
  limites: { creditosPorCiclo: 4000, cicloDias: 30 }
};

async function reconciliar(repo, usuarios, externalPaymentId, salvarUsuarios = async () => {}) {
  return financeiro.reconciliarLedgerFinanceiroPendente({
    repositorio: repo,
    lerUsuarios: async () => usuarios,
    salvarUsuarios,
    filtro: { provider: "simulated", externalPaymentId },
    limite: 20,
    agora: new Date("2026-08-22T12:00:00.000Z")
  });
}

async function cobrar(repo, plano, externalPaymentId, clienteId = "cliente_1") {
  return financeiro.criarCobrancaSimulada({
    clienteId,
    planoId: plano.id,
    planos: { [plano.id]: plano },
    externalPaymentId,
    providerEventId: `evt_created_${externalPaymentId}`,
    repositorio: repo,
    agora: new Date("2026-08-22T10:00:00.000Z")
  });
}

async function emitir(repo, type, externalPaymentId, providerEventId, clienteId = "cliente_1") {
  return financeiro.emitirEventoPagamentoSimulado({
    type,
    externalPaymentId,
    providerEventId,
    clienteId,
    repositorio: repo,
    agora: new Date("2026-08-22T12:00:00.000Z")
  });
}

(async () => {
  const repoFree = new RepoMemoria();
  const free = await cobrar(repoFree, planoFree, "pay_free");
  assert.strictEqual(free.ok, false);
  assert.strictEqual(free.codigo, "plano_free_beta_nao_cobravel", "Free nao gera cobranca");

  const repo = new RepoMemoria();
  const pro = await cobrar(repo, planoPro, "pay_pro");
  assert.strictEqual(pro.ok, true);
  assert.strictEqual(pro.provider, "simulated");
  assert.strictEqual(pro.externalPaymentId, "pay_pro");
  assert.strictEqual(pro.planSnapshot.amountCents, 3490);
  assert.strictEqual(pro.planSnapshot.creditosPorCiclo, 2000);
  assert.strictEqual(repo.state.events[0].event_type, "payment.created", "cobranca registra evento created pela fronteira comum");

  const pending = await emitir(repo, "payment.pending", "pay_pro", "evt_pending_pay_pro");
  assert.strictEqual(pending.resultado.status, "pending");
  assert.strictEqual(repo.state.ledger.length, 0, "pending nao concede credito");

  const usuarios = [{ id: "cliente_1", creditos: 99, plano: "free_beta", assinaturaStatus: "suspensa", statusConta: "ativa" }];
  const approved = await emitir(repo, "payment.approved", "pay_pro", "evt_approved_pay_pro");
  assert.strictEqual(approved.resultado.status, "approved");
  assert.strictEqual(repo.state.ledger.length, 1);
  await reconciliar(repo, usuarios, "pay_pro");
  assert.strictEqual(usuarios[0].creditos, 2000, "approved projeta creditos do snapshot");
  assert.strictEqual(usuarios[0].plano, "pro");
  assert.strictEqual(usuarios[0].assinaturaStatus, "ativa");

  await emitir(repo, "payment.approved", "pay_pro", "evt_approved_pay_pro");
  await emitir(repo, "payment.approved", "pay_pro", "evt_approved_pay_pro_outro");
  assert.strictEqual(repo.state.ledger.filter((l) => l.ledger_type === "cycle_credit").length, 1, "replays nao duplicam cycle_credit");

  await Promise.all([
    emitir(repo, "payment.approved", "pay_pro", "evt_conc_1"),
    emitir(repo, "payment.approved", "pay_pro", "evt_conc_2")
  ]);
  assert.strictEqual(repo.state.ledger.filter((l) => l.ledger_type === "cycle_credit").length, 1, "duas aprovacoes concorrentes = uma concessao");

  const oldPending = await emitir(repo, "payment.pending", "pay_pro", "evt_pending_old");
  assert.strictEqual(oldPending.resultado.ignorado, true, "approved -> pending ignorado");

  const repoRejected = new RepoMemoria();
  await cobrar(repoRejected, planoPro, "pay_rejected");
  await emitir(repoRejected, "payment.rejected", "pay_rejected", "evt_rejected");
  assert.strictEqual(repoRejected.state.ledger.length, 0, "rejected nao concede");

  const repoCancelled = new RepoMemoria();
  await cobrar(repoCancelled, planoPro, "pay_cancelled");
  await emitir(repoCancelled, "payment.cancelled", "pay_cancelled", "evt_cancelled");
  assert.strictEqual(repoCancelled.state.ledger.length, 0, "cancelled nao concede");

  const repoRefund = new RepoMemoria();
  const usuarioRefund = [{ id: "cliente_1", creditos: 0 }];
  await cobrar(repoRefund, planoPro, "pay_refund");
  await emitir(repoRefund, "payment.approved", "pay_refund", "evt_refund_approved");
  await reconciliar(repoRefund, usuarioRefund, "pay_refund");
  assert.strictEqual(usuarioRefund[0].creditos, 2000);
  const refunded = await emitir(repoRefund, "payment.refunded", "pay_refund", "evt_refunded");
  assert.strictEqual(refunded.resultado.status, "refunded");
  assert.strictEqual(repoRefund.state.ledger.some((l) => l.ledger_type === "refund_adjustment" && l.amount === -2000), true, "refund tem politica explicita em ledger");
  await reconciliar(repoRefund, usuarioRefund, "pay_refund");
  assert.strictEqual(usuarioRefund[0].creditos, 0);

  const repoVencido = new RepoMemoria();
  const vencido = [{ id: "cliente_1", creditos: 0, plano: "pro", assinaturaStatus: "suspensa", statusConta: "ativa" }];
  await cobrar(repoVencido, planoPro, "pay_vencido");
  await emitir(repoVencido, "payment.approved", "pay_vencido", "evt_vencido_approved");
  await reconciliar(repoVencido, vencido, "pay_vencido");
  assert.strictEqual(vencido[0].assinaturaStatus, "ativa", "Pro vencido + approved reativa");
  assert.strictEqual(vencido[0].creditos, 2000);

  const repoUpgrade = new RepoMemoria();
  const upgrade = [{ id: "cliente_1", creditos: 1300, plano: "pro", assinaturaStatus: "ativa" }];
  await cobrar(repoUpgrade, planoUltimate, "pay_ultimate");
  await emitir(repoUpgrade, "payment.approved", "pay_ultimate", "evt_ultimate_approved");
  await reconciliar(repoUpgrade, upgrade, "pay_ultimate");
  assert.strictEqual(upgrade[0].creditos, 4000, "Pro -> Ultimate usa saldo do snapshot, sem somar residual");
  assert.strictEqual(upgrade[0].plano, "ultimate");

  const repoSnapshot = new RepoMemoria();
  await cobrar(repoSnapshot, planoPro, "pay_snapshot_antigo");
  const planoProEditado = clone(planoPro);
  planoProEditado.preco = "R$ 39,90";
  planoProEditado.limites.creditosPorCiclo = 2500;
  await emitir(repoSnapshot, "payment.approved", "pay_snapshot_antigo", "evt_snapshot_antigo_approved");
  assert.strictEqual(repoSnapshot.state.ledger[0].amount, 2000, "edicao apos cobranca nao altera snapshot antigo");
  const nova = await cobrar(repoSnapshot, planoProEditado, "pay_snapshot_novo");
  assert.strictEqual(nova.planSnapshot.amountCents, 3990);
  assert.strictEqual(nova.planSnapshot.creditosPorCiclo, 2500, "cobranca nova pega snapshot novo");

  const repoFalha = new RepoMemoria();
  const usuariosFalha = [{ id: "cliente_1", creditos: 0 }];
  await cobrar(repoFalha, planoPro, "pay_projection");
  await emitir(repoFalha, "payment.approved", "pay_projection", "evt_projection_approved");
  let falhar = true;
  const falha = await reconciliar(repoFalha, usuariosFalha, "pay_projection", async () => {
    if (falhar) {
      falhar = false;
      throw new Error("falha_storage");
    }
  });
  assert.strictEqual(falha.falhas, 1);
  assert.strictEqual(repoFalha.state.ledger[0].projection_status, "pending", "falha de projecao fica pending");
  await reconciliar(repoFalha, usuariosFalha, "pay_projection");
  assert.strictEqual(repoFalha.state.ledger[0].projection_status, "projected");
  assert.strictEqual(usuariosFalha[0].creditos, 2000, "retry projeta uma vez");
  await reconciliar(repoFalha, usuariosFalha, "pay_projection");
  assert.strictEqual(usuariosFalha[0].creditos, 2000);

  const adminManual = { id: "cliente_admin_credit", creditos: 0, plano: "pro" };
  saas.aplicarCreditoManualAdmin({ usuario: adminManual, plano: planoPro, quantidade: 777 });
  assert.strictEqual(adminManual.creditos, 777);
  assert.strictEqual(repo.state.payments.some((p) => p.cliente_id === "cliente_admin_credit"), false, "credito Admin manual continua fora de payment");

  const indexFonte = fs.readFileSync(path.resolve(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.includes('"/admin/financeiro/simulado"'), "rotas internas do adapter simulador devem estar montadas");
  assert.ok(indexFonte.includes('"/admin/assinaturas/:usuarioId/pagamento-simulado"'), "legado pagamento-simulado permanece intocado");

  console.log("financeiro-simulado-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
