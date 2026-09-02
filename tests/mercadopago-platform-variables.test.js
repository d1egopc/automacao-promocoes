"use strict";

const assert = require("assert");
const crypto = require("crypto");

const financeiro = require("../modules/financeiro");
const {
  iniciarSchedulerReconciliacaoMercadoPago
} = require("../modules/financeiro/mercadopago.routes");
const {
  MERCADOPAGO_ACCESS_TOKEN,
  MERCADOPAGO_ENV,
  MERCADOPAGO_WEBHOOK_SECRET,
  MERCADOPAGO_VARIAVEIS_HOMOLOGADAS,
  resolverConfigMercadoPago
} = require("../modules/financeiro/mercadopago-platform-config");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

class RepoMemoria {
  constructor() {
    this.state = { events: [], payments: [], subscriptions: [], ledger: [] };
    this.seq = 1;
  }

  id(prefixo) {
    const id = `${prefixo}_${this.seq}`;
    this.seq += 1;
    return id;
  }

  async transacao(fn) {
    return fn(this.tx());
  }

  async criarCobranca(payment) {
    return this.tx().criarPayment(payment);
  }

  async buscarPayment(provider, externalPaymentId) {
    return this.state.payments.find((p) => p.provider === provider && p.external_payment_id === externalPaymentId) || null;
  }

  async listarPaymentsMercadoPagoParaReconciliacao({ limite = 10, maxTentativas = 8, agora = new Date() } = {}) {
    const instante = new Date(agora).getTime();
    return this.state.payments
      .filter((p) => p.provider === "mercadopago")
      .filter((p) => ["created", "pending"].includes(p.status))
      .filter((p) => p.metadata?.mpOrderId)
      .filter((p) => !["manual_review", "exhausted", "finalized"].includes(p.metadata?.reconciliationStatus))
      .filter((p) => Number(p.metadata?.reconciliationAttempts || 0) < Number(maxTentativas || 8))
      .filter((p) => !p.metadata?.reconciliationNextAt || new Date(p.metadata.reconciliationNextAt).getTime() <= instante)
      .slice(0, Number(limite || 10));
  }

  async atualizarPaymentMetadata(paymentId, metadata = {}) {
    const payment = this.state.payments.find((p) => p.id === paymentId);
    if (!payment) return null;
    payment.metadata = clone(metadata);
    return payment;
  }

  async listarLedgerPendente(opcoes = {}) {
    const filtros = typeof opcoes === "object" ? opcoes : { limite: opcoes };
    return this.state.ledger
      .filter((l) => l.projection_status === "pending")
      .filter((l) => !filtros.provider || this.state.payments.find((p) => p.id === l.payment_id)?.provider === filtros.provider)
      .filter((l) => !filtros.externalPaymentId || this.state.payments.find((p) => p.id === l.payment_id)?.external_payment_id === filtros.externalPaymentId)
      .slice(0, Number(filtros.limite || 50));
  }

  async marcarLedgerProjetado(ledgerId) {
    const ledger = this.state.ledger.find((l) => l.id === ledgerId);
    if (!ledger) return;
    ledger.projection_status = "projected";
    ledger.projection_attempts += 1;
  }

  async marcarLedgerFalha(ledgerId, erro) {
    const ledger = this.state.ledger.find((l) => l.id === ledgerId);
    if (!ledger) return;
    ledger.projection_status = "pending";
    ledger.projection_attempts += 1;
    ledger.projection_error = String(erro || "erro");
  }

  tx() {
    const repo = this;
    return {
      async inserirEvento(evento) {
        if (repo.state.events.some((e) => e.provider === evento.provider && e.provider_event_id === evento.providerEventId)) {
          return null;
        }
        const row = {
          id: repo.id("evt"),
          provider: evento.provider,
          provider_event_id: evento.providerEventId,
          external_payment_id: evento.externalPaymentId,
          event_type: evento.type,
          cliente_id: evento.clienteId,
          plano_id: evento.planoId || null,
          amount_cents: evento.amountCents ?? null,
          currency: evento.currency || null,
          processing_status: "received",
          metadata: evento.metadata || {}
        };
        repo.state.events.push(row);
        return row;
      },
      async marcarEventoProcessado(id) {
        const evento = repo.state.events.find((e) => e.id === id);
        if (evento) evento.processing_status = "processed";
      },
      async marcarEventoIgnorado(id, motivo) {
        const evento = repo.state.events.find((e) => e.id === id);
        if (evento) {
          evento.processing_status = "ignored";
          evento.ignored_reason = motivo;
        }
      },
      async buscarPayment(provider, externalPaymentId) {
        return repo.buscarPayment(provider, externalPaymentId);
      },
      async criarPayment(payment) {
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
          plan_snapshot: clone(payment.planSnapshot || {}),
          plan_snapshot_captured_at: payment.planSnapshotCapturedAt || new Date().toISOString(),
          metadata: clone(payment.metadata || {})
        };
        repo.state.payments.push(row);
        return row;
      },
      async atualizarPayment(paymentId, campos = {}) {
        const payment = repo.state.payments.find((p) => p.id === paymentId);
        if (!payment) return null;
        if (campos.subscriptionId !== undefined) payment.subscription_id = campos.subscriptionId;
        if (campos.status !== undefined) payment.status = campos.status;
        if (campos.metadata !== undefined) payment.metadata = clone(campos.metadata);
        if (campos.approvedAt !== undefined) payment.approved_at = campos.approvedAt;
        if (campos.cancelledAt !== undefined) payment.cancelled_at = campos.cancelledAt;
        if (campos.refundedAt !== undefined) payment.refunded_at = campos.refundedAt;
        return payment;
      },
      async obterOuCriarSubscription(clienteId, planoId) {
        let subscription = repo.state.subscriptions.find((s) => s.cliente_id === clienteId);
        if (!subscription) {
          subscription = {
            id: repo.id("sub"),
            cliente_id: clienteId,
            plano_id: planoId,
            status: "pending_payment",
            metadata: {}
          };
          repo.state.subscriptions.push(subscription);
        }
        return subscription;
      },
      async atualizarSubscription(subscriptionId, campos = {}) {
        const subscription = repo.state.subscriptions.find((s) => s.id === subscriptionId);
        if (!subscription) return null;
        if (campos.planoId !== undefined) subscription.plano_id = campos.planoId;
        if (campos.status !== undefined) subscription.status = campos.status;
        if (campos.currentCycleStart !== undefined) subscription.current_cycle_start = campos.currentCycleStart;
        if (campos.currentCycleEnd !== undefined) subscription.current_cycle_end = campos.currentCycleEnd;
        if (campos.nextRenewalAt !== undefined) subscription.next_renewal_at = campos.nextRenewalAt;
        if (campos.lastPaymentId !== undefined) subscription.last_payment_id = campos.lastPaymentId;
        if (campos.metadata !== undefined) subscription.metadata = clone(campos.metadata);
        return subscription;
      },
      async inserirLedger(ledger = {}) {
        const row = {
          id: repo.id("led"),
          cliente_id: ledger.clienteId,
          subscription_id: ledger.subscriptionId,
          payment_id: ledger.paymentId,
          ledger_type: ledger.ledgerType,
          amount: ledger.amount,
          balance_policy: ledger.balancePolicy,
          reason: ledger.reason,
          idempotency_key: ledger.idempotencyKey,
          projection_status: "pending",
          projection_attempts: 0,
          metadata: clone(ledger.metadata || {})
        };
        if (repo.state.ledger.some((item) => item.idempotency_key === row.idempotency_key)) return null;
        repo.state.ledger.push(row);
        return row;
      }
    };
  }
}

class FakeMercadoPagoClient {
  constructor() {
    this.calls = [];
    this.orders = new Map();
  }

  async criarOrder(body, { idempotencyKey } = {}) {
    this.calls.push({ tipo: "criarOrder", body: clone(body), idempotencyKey });
    const order = {
      id: `ORDER_${this.calls.length}`,
      status: "created",
      total_amount: body.total_amount,
      external_reference: body.external_reference,
      currency_id: "BRL",
      transactions: {
        payments: [{
          amount: body.transactions.payments[0].amount,
          status: "created",
          status_detail: "",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: "000201FAKEPIX",
            qr_code_base64: "BASE64"
          }
        }]
      }
    };
    this.orders.set(order.id, clone(order));
    return clone(order);
  }

  async obterOrder(orderId) {
    this.calls.push({ tipo: "obterOrder", orderId });
    const order = this.orders.get(orderId);
    if (!order) throw new Error("order_nao_encontrada");
    return clone(order);
  }

  setOrder(orderId, patch = {}) {
    const atual = this.orders.get(orderId) || { id: orderId };
    this.orders.set(orderId, { ...atual, ...clone(patch) });
  }
}

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

function criarPlatformVariablesFake(valores = {}) {
  const store = new Map(Object.entries(valores));
  const fn = async (nome) => {
    if (!store.has(nome)) return { ok: false, source: "missing", value: null };
    return { ok: true, source: "platform_variables", nome, value: store.get(nome) };
  };
  fn.set = (nome, valor) => store.set(nome, valor);
  fn.delete = (nome) => store.delete(nome);
  return fn;
}

function assinatura(secret, dataId, requestId = "req_mp_1", ts = "1704908010") {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return {
    "x-signature": `ts=${ts},v1=${v1}`,
    "x-request-id": requestId
  };
}

async function criarCobranca({ repo = new RepoMemoria(), client = new FakeMercadoPagoClient(), env = {}, getPlatformVariableImpl } = {}) {
  return financeiro.criarCobrancaMercadoPagoPix({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro },
    usuario: { id: "cliente_1", email: "cliente@test.local" },
    externalPaymentId: "mp_pay_teste",
    repositorio: repo,
    client,
    env,
    getPlatformVariableImpl,
    agora: new Date("2026-08-22T10:00:00.000Z")
  });
}

(async () => {
  assert.ok(MERCADOPAGO_VARIAVEIS_HOMOLOGADAS.has(MERCADOPAGO_ACCESS_TOKEN));
  assert.ok(MERCADOPAGO_VARIAVEIS_HOMOLOGADAS.has(MERCADOPAGO_ENV));
  assert.ok(MERCADOPAGO_VARIAVEIS_HOMOLOGADAS.has(MERCADOPAGO_WEBHOOK_SECRET));
  assert.ok(!MERCADOPAGO_VARIAVEIS_HOMOLOGADAS.has("MERCADOPAGO_WEBHOOK_URL"));

  const painel = criarPlatformVariablesFake({
    MERCADOPAGO_ACCESS_TOKEN: "APP_USR_PAINEL",
    MERCADOPAGO_ENV: "production",
    MERCADOPAGO_WEBHOOK_SECRET: "SECRET_PAINEL"
  });
  const configPainel = await resolverConfigMercadoPago({
    env: {
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR_ENV",
      MERCADOPAGO_ENV: "test",
      MERCADOPAGO_WEBHOOK_SECRET: "SECRET_ENV"
    },
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(configPainel.accessToken, "APP_USR_PAINEL", "painel vence ENV no access token");
  assert.strictEqual(configPainel.ambiente, "production", "painel vence ENV no ambiente");
  assert.strictEqual(configPainel.webhookSecret, "SECRET_PAINEL", "painel vence ENV no webhook secret");

  painel.delete(MERCADOPAGO_ACCESS_TOKEN);
  painel.delete(MERCADOPAGO_ENV);
  painel.delete(MERCADOPAGO_WEBHOOK_SECRET);
  const configEnv = await resolverConfigMercadoPago({
    env: {
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR_ENV",
      MERCADOPAGO_ENV: "test",
      MERCADOPAGO_WEBHOOK_SECRET: "SECRET_ENV"
    },
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(configEnv.accessToken, "APP_USR_ENV", "fallback ENV no access token");
  assert.strictEqual(configEnv.ambiente, "test", "fallback ENV no ambiente");
  assert.strictEqual(configEnv.webhookSecret, "SECRET_ENV", "fallback ENV no webhook secret");

  const configAusente = await resolverConfigMercadoPago({ env: {}, getPlatformVariableImpl: painel });
  assert.strictEqual(configAusente.configurado, false, "sem token fica nao configurado");
  assert.strictEqual(configAusente.ambiente, "test", "default atual permanece test");

  painel.set(MERCADOPAGO_ENV, "staging");
  const configInvalido = await resolverConfigMercadoPago({
    env: { MERCADOPAGO_ACCESS_TOKEN: "APP_USR_ENV", MERCADOPAGO_ENV: "production" },
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(configInvalido.ambienteValido, false, "ambiente invalido nao passa silenciosamente");
  assert.strictEqual(configInvalido.configurado, false, "ambiente invalido nao permite Mercado Pago configurado");
  assert.strictEqual(configInvalido.codigo, "mercadopago_env_invalido");

  painel.set(MERCADOPAGO_ENV, "production");
  painel.set(MERCADOPAGO_ACCESS_TOKEN, "APP_USR_RUNTIME_1");
  const runtime1 = await resolverConfigMercadoPago({ env: {}, getPlatformVariableImpl: painel });
  painel.set(MERCADOPAGO_ACCESS_TOKEN, "APP_USR_RUNTIME_2");
  const runtime2 = await resolverConfigMercadoPago({ env: {}, getPlatformVariableImpl: painel });
  assert.strictEqual(runtime1.accessToken, "APP_USR_RUNTIME_1");
  assert.strictEqual(runtime2.accessToken, "APP_USR_RUNTIME_2", "mudanca runtime sem restart");

  const repo = new RepoMemoria();
  const client = new FakeMercadoPagoClient();
  const cobranca = await criarCobranca({ repo, client, getPlatformVariableImpl: painel, env: { MERCADOPAGO_WEBHOOK_URL: "https://go.optimuspromo.com.br/webhooks/mercadopago" } });
  assert.strictEqual(cobranca.ok, true);
  assert.strictEqual(client.calls[0].body.total_amount, "34.90", "production preserva valor comercial");
  assert.strictEqual("notification_url" in client.calls[0].body, false, "MERCADOPAGO_WEBHOOK_URL continua sem mudar Orders API");

  client.setOrder(cobranca.orderId, {
    status: "processed",
    status_detail: "accredited",
    total_amount: "34.90",
    currency_id: "BRL",
    external_reference: cobranca.externalPaymentId,
    transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "accredited" }] }
  });

  painel.set(MERCADOPAGO_WEBHOOK_SECRET, "SECRET_RUNTIME_1");
  const valido = await financeiro.processarWebhookMercadoPago({
    headers: assinatura("SECRET_RUNTIME_1", cobranca.orderId),
    query: { "data.id": cobranca.orderId },
    body: { id: "wh_runtime_1", data: { id: cobranca.orderId } },
    repositorio: repo,
    client,
    env: { MERCADOPAGO_WEBHOOK_SECRET: "SECRET_ENV_ERRADO" },
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(valido.ok, true, "webhook usa secret do painel com precedencia");
  assert.strictEqual(valido.type, "payment.approved");

  painel.set(MERCADOPAGO_WEBHOOK_SECRET, "SECRET_RUNTIME_2");
  const invalido = await financeiro.processarWebhookMercadoPago({
    headers: assinatura("SECRET_RUNTIME_1", cobranca.orderId, "req_mp_2"),
    query: { "data.id": cobranca.orderId },
    body: { id: "wh_runtime_2", data: { id: cobranca.orderId } },
    repositorio: repo,
    client,
    env: {},
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(invalido.ok, false);
  assert.strictEqual(invalido.codigo, "mercadopago_assinatura_invalida", "secret alterado em runtime invalida assinatura antiga");

  painel.delete(MERCADOPAGO_WEBHOOK_SECRET);
  const secretAusente = await financeiro.processarWebhookMercadoPago({
    headers: assinatura("QUALQUER", cobranca.orderId, "req_mp_3"),
    query: { "data.id": cobranca.orderId },
    body: { id: "wh_sem_secret", data: { id: cobranca.orderId } },
    repositorio: repo,
    client,
    env: {},
    getPlatformVariableImpl: painel
  });
  assert.strictEqual(secretAusente.statusHttp, 401);
  assert.strictEqual(secretAusente.codigo, "mercadopago_webhook_secret_ausente");

  const logs = [];
  const logOriginal = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    painel.set(MERCADOPAGO_WEBHOOK_SECRET, "SECRET_LOG_TEST");
    await financeiro.processarWebhookMercadoPago({
      headers: assinatura("SECRET_ERRADO", cobranca.orderId, "req_mp_4"),
      query: { "data.id": cobranca.orderId },
      body: { id: "wh_log", data: { id: cobranca.orderId } },
      repositorio: repo,
      client,
      env: {},
      getPlatformVariableImpl: painel
    });
  } finally {
    console.log = logOriginal;
  }
  assert.strictEqual(logs.join("\n").includes("SECRET_LOG_TEST"), false, "secret nao aparece em logs");

  const painelScheduler = criarPlatformVariablesFake({ MERCADOPAGO_ENV: "production" });
  const repoScheduler = new RepoMemoria();
  const clientScheduler = new FakeMercadoPagoClient();
  const cobrancaScheduler = await criarCobranca({
    repo: repoScheduler,
    client: clientScheduler,
    env: { MERCADOPAGO_ENV: "production", MERCADOPAGO_ACCESS_TOKEN: "APP_USR_BOOTSTRAP" }
  });
  clientScheduler.setOrder(cobrancaScheduler.orderId, {
    status: "processed",
    status_detail: "accredited",
    total_amount: "34.90",
    currency_id: "BRL",
    external_reference: cobrancaScheduler.externalPaymentId,
    transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "accredited" }] }
  });

  let tickCapturado = null;
  const timer = iniciarSchedulerReconciliacaoMercadoPago({
    getUsuarios: () => [{ id: "cliente_1", creditos: 0, plano: "free_beta" }],
    salvarUsuarios: async () => {},
    repositorio: repoScheduler,
    client: clientScheduler,
    env: {},
    getPlatformVariableImpl: painelScheduler,
    setIntervalImpl: (fn) => {
      tickCapturado = fn;
      return { unref() {}, close() {} };
    }
  });
  assert.ok(timer, "scheduler inicia mesmo sem token no startup");
  const chamadasAntes = clientScheduler.calls.length;
  await tickCapturado();
  assert.strictEqual(clientScheduler.calls.length, chamadasAntes, "tick sem token nao executa operacao financeira");

  painelScheduler.set(MERCADOPAGO_ACCESS_TOKEN, "APP_USR_RUNTIME_SCHEDULER");
  await tickCapturado();
  assert.ok(clientScheduler.calls.length > chamadasAntes, "tick posterior usa token cadastrado em runtime");
  assert.strictEqual(repoScheduler.state.payments[0].status, "approved", "reconciliacao preservada apos token runtime");

  console.log("mercadopago-platform-variables.test.js OK");
})();
