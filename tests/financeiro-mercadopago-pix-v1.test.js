"use strict";

const assert = require("assert");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");

const financeiro = require("../modules/financeiro");
const { criarRotasFinanceiroMercadoPago } = require("../modules/financeiro/mercadopago.routes");

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
          amount_cents: evento.amountCents ?? null,
          currency: evento.currency || null,
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
        if (campos.metadata !== undefined) p.metadata = campos.metadata;
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

class FakeMercadoPagoClient {
  constructor() {
    this.calls = [];
    this.orders = new Map();
    this.seq = 1;
    this.obterChamadas = 0;
  }

  async criarOrder(body, { idempotencyKey } = {}) {
    this.calls.push({ body: clone(body), idempotencyKey });
    const id = `ORD_TEST_${this.seq}`;
    this.seq += 1;
    const order = {
      id,
      type: "online",
      status: "action_required",
      status_detail: "waiting_transfer",
      total_amount: body.total_amount,
      country_code: "BRA",
      external_reference: body.external_reference,
      transactions: {
        payments: [
          {
            id: `PAY_${id}`,
            amount: body.total_amount,
            status: "action_required",
            status_detail: "waiting_transfer",
            payment_method: {
              id: "pix",
              type: "bank_transfer",
              qr_code: `000201${id}`,
              qr_code_base64: "base64",
              ticket_url: `https://mp.test/ticket/${id}`
            }
          }
        ]
      }
    };
    this.orders.set(id, order);
    return clone(order);
  }

  setOrder(id, patch = {}) {
    const atual = this.orders.get(id) || { id, country_code: "BRA", transactions: { payments: [{}] } };
    this.orders.set(id, {
      ...atual,
      ...patch,
      transactions: patch.transactions || atual.transactions
    });
  }

  async obterOrder(orderId) {
    this.obterChamadas += 1;
    const order = this.orders.get(orderId);
    if (!order) throw new Error("order_nao_encontrada");
    return clone(order);
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

const planoProEmBreve = {
  ...planoPro,
  contratavel: false,
  emBreve: true
};

const planoPagoSemValor = {
  ...planoPro,
  id: "pro_sem_valor",
  preco: "R$ 0,00",
  amountCents: 0
};

const planoPagoSemRenovacao = {
  ...planoPro,
  id: "pro_sem_renovacao",
  entradaBeta: false,
  renovacaoCreditos: "sem_renovacao"
};

function assinatura(secret, dataId, requestId = "req_1", ts = "1787423000") {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

async function cobrarPix({
  repo,
  client,
  plano = planoPro,
  externalPaymentId = "mp_pay_pro",
  env = {},
  usuario = { id: "cliente_1", email: "cliente@test.local" }
} = {}) {
  return financeiro.criarCobrancaMercadoPagoPix({
    clienteId: "cliente_1",
    planoId: plano.id,
    planos: { [plano.id]: plano },
    usuario,
    externalPaymentId,
    repositorio: repo,
    client,
    env,
    agora: new Date("2026-08-22T10:00:00.000Z")
  });
}

async function webhook({ repo, client, orderId, secret = "secret", bodyId = "wh_1", patch = {}, env = {} } = {}) {
  if (Object.keys(patch).length) client.setOrder(orderId, patch);
  return financeiro.processarWebhookMercadoPago({
    headers: assinatura(secret, orderId),
    query: { "data.id": orderId },
    body: {
      id: bodyId,
      type: "order",
      action: "order.updated",
      data: { id: orderId }
    },
    repositorio: repo,
    client,
    env: { MERCADOPAGO_WEBHOOK_SECRET: secret, ...env },
    agora: new Date("2026-08-22T12:00:00.000Z")
  });
}

function escutar(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function fechar(server) {
  return new Promise((resolve, reject) => {
    server.close((erro) => erro ? reject(erro) : resolve());
  });
}

(async () => {
  const warnings = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const clientHttp = financeiro.criarMercadoPagoHttpClient({
      accessToken: "APP_USR_TOKEN_SECRETO",
      fetchImpl: async (url, options = {}) => ({
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            message: "Invalid payer cliente.real@test.local Authorization Bearer APP_USR_TOKEN_SECRETO",
            error: "bad_request",
            code: "invalid_order",
            access_token: "APP_USR_TOKEN_SECRETO",
            qr_code: "00020101021226880014br.gov.bcb.pix2566pix.example.invalid/chave-super-longa",
            cause: [
              {
                code: "invalid_payer",
                description: "payer.email cliente.real@test.local rejeitado; Authorization: Bearer APP_USR_TOKEN_SECRETO"
              }
            ],
            recebido: {
              authorization: options.headers?.authorization,
              jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.assinatura"
            },
            endpoint: url
          });
        }
      })
    });
    await assert.rejects(
      () => clientHttp.criarOrder({ teste: true }, { idempotencyKey: "idem_400" }),
      (erro) => {
        assert.strictEqual(erro.codigo, "mercadopago_api_falhou");
        assert.strictEqual(erro.status, 400);
        assert.strictEqual(erro.detalheMercadoPago.status, 400);
        assert.strictEqual(erro.detalheMercadoPago.message.includes("Invalid payer"), true, "message segura aparece");
        assert.strictEqual(erro.detalheMercadoPago.message.includes("[email_mascarado]"), true, "email completo e mascarado");
        assert.strictEqual(erro.detalheMercadoPago.error, "bad_request");
        assert.strictEqual(erro.detalheMercadoPago.code, "invalid_order");
        assert.deepStrictEqual(erro.detalheMercadoPago.cause, [
          {
            code: "invalid_payer",
            description: "payer.email [email_mascarado] rejeitado; authorization:[redacted]"
          }
        ]);
        const serializado = JSON.stringify(erro.detalheMercadoPago);
        assert.strictEqual(serializado.includes("APP_USR_TOKEN_SECRETO"), false, "token nao aparece no detalhe");
        assert.strictEqual(serializado.includes("cliente.real@test.local"), false, "email completo nao aparece no detalhe");
        assert.strictEqual(serializado.includes("000201010212"), false, "QR/copia-e-cola nao aparece no detalhe");
        return true;
      }
    );
    const logSeguro = warnings.join("\n");
    assert.strictEqual(logSeguro.includes("[MERCADOPAGO-API-ERRO-SEGURO]"), true, "telemetria sanitizada registrada");
    assert.strictEqual(logSeguro.includes("APP_USR_TOKEN_SECRETO"), false, "telemetria nao vaza access token");
    assert.strictEqual(logSeguro.includes("cliente.real@test.local"), false, "telemetria nao vaza email completo");
    assert.strictEqual(logSeguro.includes("000201010212"), false, "telemetria nao vaza QR");
  } finally {
    console.warn = warnOriginal;
  }

  const semEnv = await financeiro.criarCobrancaMercadoPagoPix({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoPro },
    repositorio: new RepoMemoria(),
    env: {}
  });
  assert.strictEqual(semEnv.ok, false);
  assert.strictEqual(semEnv.codigo, "mercadopago_nao_configurado", "adapter sem ENV nao derruba e fica nao_configurado");

  const repoFree = new RepoMemoria();
  const free = await cobrarPix({ repo: repoFree, client: new FakeMercadoPagoClient(), plano: planoFree, externalPaymentId: "mp_free" });
  assert.strictEqual(free.ok, false);
  assert.strictEqual(free.codigo, "plano_free_beta_nao_cobravel", "Free nao gera Order");
  assert.strictEqual(repoFree.state.payments.length, 0);

  const erroRota = new Error("mercadopago_api_falhou");
  erroRota.codigo = "mercadopago_api_falhou";
  erroRota.status = 400;
  erroRota.detalheMercadoPago = {
    status: 400,
    message: "invalid payment method",
    error: "bad_request",
    code: "invalid_payment_method",
    cause: [{ code: "invalid_payment_method", description: "payment_method.id invalido" }]
  };
  const appErro = express();
  appErro.use(express.json());
  appErro.use("/", criarRotasFinanceiroMercadoPago({
    getUsuarios: () => [{ id: "cliente_1", email: "cliente@test.local" }],
    getPlanos: () => ({ pro: planoPro }),
    isAdminMaster: () => true,
    repositorio: new RepoMemoria(),
    client: { criarOrder: async () => { throw erroRota; } },
    env: {}
  }));
  const serverErro = await escutar(appErro);
  try {
    const porta = serverErro.address().port;
    const respostaErro = await fetch(`http://127.0.0.1:${porta}/pix/cobrancas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clienteId: "cliente_1", planoId: "pro" })
    });
    const bodyErro = await respostaErro.json();
    assert.strictEqual(respostaErro.status, 400, "status HTTP Mercado Pago preservado na rota Admin");
    assert.strictEqual(bodyErro.codigo, "mercadopago_api_falhou");
    assert.strictEqual(bodyErro.statusMercadoPago, 400);
    assert.deepStrictEqual(bodyErro.detalheMercadoPago, erroRota.detalheMercadoPago);
  } finally {
    await fechar(serverErro);
  }

  const publicoEmBreve = await financeiro.criarCobrancaFinanceira({
    clienteId: "cliente_1",
    planoId: "pro",
    planos: { pro: planoProEmBreve },
    repositorio: new RepoMemoria(),
    provider: "public_checkout"
  });
  assert.strictEqual(publicoEmBreve.ok, false);
  assert.strictEqual(publicoEmBreve.codigo, "plano_nao_contratavel", "checkout publico futuro continua bloqueando plano Em breve");
  assert.strictEqual(planoProEmBreve.contratavel, false, "teste interno nao altera disponibilidade publica do plano");
  assert.strictEqual(planoProEmBreve.emBreve, true, "teste interno nao remove estado Em breve");

  const repoEmBreve = new RepoMemoria();
  const clientEmBreve = new FakeMercadoPagoClient();
  const cobrancaEmBreve = await cobrarPix({
    repo: repoEmBreve,
    client: clientEmBreve,
    plano: planoProEmBreve,
    externalPaymentId: "mp_pay_pro_em_breve"
  });
  assert.strictEqual(cobrancaEmBreve.ok, true, "rota Admin/internal Mercado Pago pode cobrar plano pago Em breve");
  assert.strictEqual(cobrancaEmBreve.planSnapshot.planoId, "pro");
  assert.strictEqual(cobrancaEmBreve.planSnapshot.amountCents, 3490);
  assert.strictEqual(cobrancaEmBreve.planSnapshot.creditosPorCiclo, 2000);
  assert.strictEqual(repoEmBreve.state.ledger.length, 0, "criacao interna de PIX Em breve nao concede credito");

  const semValor = await cobrarPix({
    repo: new RepoMemoria(),
    client: new FakeMercadoPagoClient(),
    plano: planoPagoSemValor,
    externalPaymentId: "mp_sem_valor"
  });
  assert.strictEqual(semValor.ok, false);
  assert.strictEqual(semValor.codigo, "plano_sem_valor_pago", "plano pago sem preco continua recusado");

  const semRenovacao = await cobrarPix({
    repo: new RepoMemoria(),
    client: new FakeMercadoPagoClient(),
    plano: planoPagoSemRenovacao,
    externalPaymentId: "mp_sem_renovacao"
  });
  assert.strictEqual(semRenovacao.ok, false);
  assert.strictEqual(semRenovacao.codigo, "plano_free_beta_nao_cobravel", "plano sem renovacao por pagamento continua recusado");

  const repo = new RepoMemoria();
  const client = new FakeMercadoPagoClient();
  const cobranca = await cobrarPix({ repo, client, externalPaymentId: "mp_pay_pro" });
  assert.strictEqual(cobranca.ok, true);
  assert.strictEqual(cobranca.provider, "mercadopago");
  assert.strictEqual(cobranca.planSnapshot.amountCents, 3490);
  assert.strictEqual(cobranca.planSnapshot.creditosPorCiclo, 2000);
  assert.strictEqual(cobranca.pix.qrCode.includes("ORD_TEST_1"), true);
  assert.strictEqual(repo.state.ledger.length, 0, "criacao PIX nao concede credito");
  assert.strictEqual(client.calls[0].body.total_amount, "34.90");
  assert.strictEqual(client.calls[0].body.transactions.payments[0].amount, "34.90");
  assert.strictEqual(client.calls[0].body.external_reference, "mp_pay_pro");
  assert.strictEqual(client.calls[0].idempotencyKey, "mp_order:mp_pay_pro");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(client.calls[0].body, "country_code"),
    false,
    "country_code nao deve ser enviado no request de criacao PIX"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(client.calls[0].body.payer, "first_name"),
    false,
    "ENV ausente nao deve acionar gatilho APRO implicitamente"
  );

  const repoSandbox = new RepoMemoria();
  const clientSandbox = new FakeMercadoPagoClient();
  const cobrancaSandbox = await cobrarPix({
    repo: repoSandbox,
    client: clientSandbox,
    externalPaymentId: "mp_pay_sandbox",
    env: { MERCADOPAGO_ENV: "test" }
  });
  assert.strictEqual(cobrancaSandbox.payment.amount_cents ?? cobrancaSandbox.payment.amountCents, 3490, "payment interno permanece com valor comercial");
  assert.strictEqual(cobrancaSandbox.planSnapshot.amountCents, 3490, "snapshot permanece com valor comercial");
  assert.strictEqual(cobrancaSandbox.planSnapshot.creditosPorCiclo, 2000, "snapshot permanece com creditos comerciais");
  assert.strictEqual(clientSandbox.calls[0].body.total_amount, "50.00", "sandbox usa total_amount predefinido oficial");
  assert.strictEqual(clientSandbox.calls[0].body.transactions.payments[0].amount, "50.00", "sandbox usa payment amount predefinido oficial");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(clientSandbox.calls[0].body, "country_code"),
    false,
    "country_code nao deve ser enviado no request sandbox"
  );
  assert.strictEqual(
    clientSandbox.calls[0].body.payer.first_name,
    "APRO",
    "ambiente test deve enviar gatilho oficial de sandbox PIX"
  );
  assert.strictEqual(
    clientSandbox.calls[0].body.payer.email,
    "test_user_br@testuser.com",
    "ambiente test deve usar email oficial de sandbox PIX"
  );
  assert.deepStrictEqual(
    repoSandbox.state.payments[0].metadata,
    {
      adapter: "mercadopago_pix_v1",
      origem: "financial_charge_v1",
      mercadopagoEnv: "test",
      pixSandboxPredefined: true,
      sandboxTestAmountCents: 5000,
      providerAmountCents: 5000,
      commercialAmountCents: 3490
    },
    "metadata financeira preserva valor provider sandbox separado do valor comercial"
  );
  assert.strictEqual(repoSandbox.state.ledger.length, 0, "sandbox PIX criado continua sem conceder credito");

  const approvedSandbox = await webhook({
    repo: repoSandbox,
    client: clientSandbox,
    orderId: cobrancaSandbox.orderId,
    bodyId: "wh_sandbox_approved",
    env: { MERCADOPAGO_ENV: "test" },
    patch: {
      total_amount: "50.00",
      currency_id: "BRL",
      transactions: { payments: [{ amount: "50.00", status: "processed", status_detail: "accredited" }] }
    }
  });
  assert.strictEqual(approvedSandbox.type, "payment.approved", "sandbox webhook com 5000 passa validacao");
  assert.strictEqual(repoSandbox.state.ledger.filter((l) => l.ledger_type === "cycle_credit").length, 1);
  assert.strictEqual(repoSandbox.state.ledger[0].amount, 2000, "credito sandbox aprovado vem do snapshot, nao dos R$50");

  const repoSandboxDiverg = new RepoMemoria();
  const clientSandboxDiverg = new FakeMercadoPagoClient();
  const cobrancaSandboxDiverg = await cobrarPix({
    repo: repoSandboxDiverg,
    client: clientSandboxDiverg,
    externalPaymentId: "mp_pay_sandbox_diverg",
    env: { MERCADOPAGO_ENV: "test" }
  });
  const divergSandbox = await webhook({
    repo: repoSandboxDiverg,
    client: clientSandboxDiverg,
    orderId: cobrancaSandboxDiverg.orderId,
    bodyId: "wh_sandbox_diverg",
    env: { MERCADOPAGO_ENV: "test" },
    patch: {
      total_amount: "51.00",
      currency_id: "BRL",
      transactions: { payments: [{ amount: "51.00", status: "processed", status_detail: "accredited" }] }
    }
  });
  assert.strictEqual(divergSandbox.manual, true, "sandbox webhook com valor diferente do providerAmountCents e bloqueado");
  assert.strictEqual(divergSandbox.codigo, "mercadopago_valor_divergente");
  assert.strictEqual(divergSandbox.esperado, 5000);
  assert.strictEqual(repoSandboxDiverg.state.ledger.length, 0);

  const repoProd = new RepoMemoria();
  const clientProd = new FakeMercadoPagoClient();
  await cobrarPix({
    repo: repoProd,
    client: clientProd,
    externalPaymentId: "mp_pay_prod",
    env: { MERCADOPAGO_ENV: "production" }
  });
  assert.strictEqual(clientProd.calls[0].body.total_amount, "34.90", "producao usa valor comercial do snapshot");
  assert.strictEqual(clientProd.calls[0].body.transactions.payments[0].amount, "34.90", "producao nunca usa 50.00 de sandbox");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(clientProd.calls[0].body.payer, "first_name"),
    false,
    "ambiente production nao pode forcar APRO"
  );
  assert.notStrictEqual(
    clientProd.calls[0].body.payer.email,
    "test_user_br@testuser.com",
    "ambiente production nao pode usar email oficial de sandbox"
  );

  const repoInject = new RepoMemoria();
  const clientInject = new FakeMercadoPagoClient();
  await cobrarPix({
    repo: repoInject,
    client: clientInject,
    externalPaymentId: "mp_pay_inject",
    env: { MERCADOPAGO_ENV: "test" },
    usuario: { id: "cliente_1", email: "cliente.real@test.local", first_name: "FAKE", firstName: "FAKE", nome: "FAKE" }
  });
  assert.strictEqual(
    clientInject.calls[0].body.payer.first_name,
    "APRO",
    "request/frontend nao consegue alterar first_name oficial de sandbox"
  );
  assert.strictEqual(
    clientInject.calls[0].body.payer.email,
    "test_user_br@testuser.com",
    "request/frontend nao consegue alterar email oficial de sandbox"
  );

  const replayCobranca = await cobrarPix({ repo, client, externalPaymentId: "mp_pay_pro" });
  assert.strictEqual(replayCobranca.ok, true);
  assert.strictEqual(client.calls[1].idempotencyKey, "mp_order:mp_pay_pro", "idempotencia de criacao deriva da cobranca interna");

  const logsWebhook = [];
  const logOriginal = console.log;
  console.log = (...args) => logsWebhook.push(args.join(" "));
  const assinaturaInvalida = "ts=1704908010,v1=1111111111111111111111111111111111111111111111111111111111111111";
  const segredoWebhook = "SUPER_SECRET_WEBHOOK";
  const dataIdAlfanumericoTeste = "ORDTST01M0QKD7X6KABB3C2J7VDEEG0F";
  let invalido;
  try {
    invalido = await financeiro.processarWebhookMercadoPago({
      headers: { "x-signature": assinaturaInvalida, "x-request-id": "req_1" },
      query: { "data.id": dataIdAlfanumericoTeste },
      body: {
        id: "wh_invalido",
        data: { id: dataIdAlfanumericoTeste },
        email: "cliente.real@test.local",
        token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.assinatura"
      },
      repositorio: repo,
      client,
      env: { MERCADOPAGO_WEBHOOK_SECRET: segredoWebhook }
    });
  } finally {
    console.log = logOriginal;
  }
  assert.strictEqual(invalido.ok, false);
  assert.strictEqual(invalido.codigo, "mercadopago_assinatura_invalida");
  const logAssinatura = logsWebhook.join("\n");
  assert.strictEqual(logAssinatura.includes("[MERCADOPAGO-WEBHOOK-ASSINATURA-DIAGNOSTICO]"), true, "telemetria segura de assinatura e registrada");
  assert.strictEqual(logAssinatura.includes("\"codigo\":\"mercadopago_assinatura_invalida\""), true, "codigo final da validacao aparece");
  assert.strictEqual(logAssinatura.includes("\"queryDataIdPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"bodyDataIdPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"xSignaturePresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"xRequestIdPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"tsPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"v1Presente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"secretPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"dataIdAlfanumerico\":true"), true);
  assert.strictEqual(logAssinatura.includes("\"requestIdPresente\":true"), true);
  assert.strictEqual(logAssinatura.includes("sha256_12"), true, "dataId normalizado e publicado apenas como hash curto");
  assert.strictEqual(logAssinatura.includes(segredoWebhook), false, "secret nao pode aparecer");
  assert.strictEqual(logAssinatura.includes(assinaturaInvalida), false, "x-signature completa nao pode aparecer");
  assert.strictEqual(logAssinatura.includes("1111111111111111111111111111111111111111111111111111111111111111"), false, "v1 nao pode aparecer");
  assert.strictEqual(logAssinatura.includes("cliente.real@test.local"), false, "body/email nao pode aparecer");
  assert.strictEqual(logAssinatura.includes("eyJhbGciOiJIUzI1NiJ9"), false, "JWT nao pode aparecer");

  const incompleta = await financeiro.processarWebhookMercadoPago({
    headers: { "x-signature": "ts=1704908010", "x-request-id": "" },
    query: { "data.id": cobranca.orderId },
    body: {},
    repositorio: repo,
    client,
    env: { MERCADOPAGO_WEBHOOK_SECRET: "secret" }
  });
  assert.strictEqual(incompleta.codigo, "mercadopago_assinatura_incompleta");

  const secretAusente = await financeiro.processarWebhookMercadoPago({
    headers: { "x-signature": assinaturaInvalida, "x-request-id": "req_1" },
    query: { "data.id": cobranca.orderId },
    body: {},
    repositorio: repo,
    client,
    env: {}
  });
  assert.strictEqual(secretAusente.codigo, "mercadopago_webhook_secret_ausente");

  const pending = await webhook({ repo, client, orderId: cobranca.orderId, bodyId: "wh_pending" });
  assert.strictEqual(pending.type, "payment.pending");
  assert.strictEqual(repo.state.ledger.length, 0, "pending nao concede credito");

  const divergValor = await webhook({
    repo,
    client,
    orderId: cobranca.orderId,
    bodyId: "wh_valor",
    patch: {
      total_amount: "35.90",
      transactions: { payments: [{ amount: "35.90", status: "processed", status_detail: "accredited" }] }
    }
  });
  assert.strictEqual(divergValor.manual, true);
  assert.strictEqual(divergValor.codigo, "mercadopago_valor_divergente");
  assert.strictEqual(repo.state.ledger.length, 0);

  client.setOrder(cobranca.orderId, {
    total_amount: "34.90",
    currency_id: "USD",
    transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "accredited" }] }
  });
  const divergMoeda = await webhook({ repo, client, orderId: cobranca.orderId, bodyId: "wh_moeda" });
  assert.strictEqual(divergMoeda.manual, true);
  assert.strictEqual(divergMoeda.codigo, "mercadopago_moeda_divergente");
  assert.strictEqual(repo.state.ledger.length, 0);

  client.setOrder(cobranca.orderId, {
    total_amount: "34.90",
    currency_id: "BRL",
    transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "accredited" }] }
  });
  const approved = await webhook({ repo, client, orderId: cobranca.orderId, bodyId: "wh_approved" });
  assert.strictEqual(approved.type, "payment.approved");
  assert.strictEqual(repo.state.ledger.filter((l) => l.ledger_type === "cycle_credit").length, 1, "approved gera exatamente 1 cycle_credit");
  assert.strictEqual(repo.state.ledger[0].amount, 2000);

  await webhook({ repo, client, orderId: cobranca.orderId, bodyId: "wh_approved" });
  await webhook({ repo, client, orderId: cobranca.orderId, bodyId: "wh_approved_outro" });
  assert.strictEqual(repo.state.ledger.filter((l) => l.ledger_type === "cycle_credit").length, 1, "webhook repetido/outro approved nao duplica");

  const repoExpired = new RepoMemoria();
  const clientExpired = new FakeMercadoPagoClient();
  const exp = await cobrarPix({ repo: repoExpired, client: clientExpired, externalPaymentId: "mp_expired" });
  const expired = await webhook({
    repo: repoExpired,
    client: clientExpired,
    orderId: exp.orderId,
    bodyId: "wh_expired",
    patch: {
      status: "expired",
      status_detail: "expired",
      transactions: { payments: [{ amount: "34.90", status: "expired", status_detail: "expired" }] }
    }
  });
  assert.strictEqual(expired.type, "payment.cancelled");
  assert.strictEqual(repoExpired.state.ledger.length, 0, "expired cancela sem credito");

  const repoFailed = new RepoMemoria();
  const clientFailed = new FakeMercadoPagoClient();
  const fail = await cobrarPix({ repo: repoFailed, client: clientFailed, externalPaymentId: "mp_failed" });
  const rejected = await webhook({
    repo: repoFailed,
    client: clientFailed,
    orderId: fail.orderId,
    bodyId: "wh_failed",
    patch: {
      status: "failed",
      status_detail: "failed",
      transactions: { payments: [{ amount: "34.90", status: "failed", status_detail: "processing_error" }] }
    }
  });
  assert.strictEqual(rejected.type, "payment.rejected");
  assert.strictEqual(repoFailed.state.ledger.length, 0, "failed/rejected sem credito");

  const repoRefund = new RepoMemoria();
  const clientRefund = new FakeMercadoPagoClient();
  const ref = await cobrarPix({ repo: repoRefund, client: clientRefund, externalPaymentId: "mp_refund" });
  await webhook({
    repo: repoRefund,
    client: clientRefund,
    orderId: ref.orderId,
    bodyId: "wh_ref_approved",
    patch: {
      total_amount: "34.90",
      currency_id: "BRL",
      transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "accredited" }] }
    }
  });
  const refunded = await webhook({
    repo: repoRefund,
    client: clientRefund,
    orderId: ref.orderId,
    bodyId: "wh_refunded",
    patch: {
      total_amount: "34.90",
      currency_id: "BRL",
      transactions: { payments: [{ amount: "34.90", status: "refunded", status_detail: "refunded" }] }
    }
  });
  assert.strictEqual(refunded.type, "payment.refunded");
  assert.strictEqual(repoRefund.state.ledger.some((l) => l.ledger_type === "refund_adjustment" && l.amount === -2000), true);

  const repoManual = new RepoMemoria();
  const clientManual = new FakeMercadoPagoClient();
  const man = await cobrarPix({ repo: repoManual, client: clientManual, externalPaymentId: "mp_manual" });
  const partial = await webhook({
    repo: repoManual,
    client: clientManual,
    orderId: man.orderId,
    bodyId: "wh_partial",
    patch: {
      transactions: { payments: [{ amount: "34.90", status: "processed", status_detail: "partially_refunded" }] }
    }
  });
  assert.strictEqual(partial.manual, true);
  assert.strictEqual(partial.codigo, "mercadopago_partial_refund_manual");
  assert.strictEqual(repoManual.state.ledger.length, 0);

  const chargeback = await webhook({
    repo: repoManual,
    client: clientManual,
    orderId: man.orderId,
    bodyId: "wh_chargeback",
    patch: {
      transactions: { payments: [{ amount: "34.90", status: "charged_back", status_detail: "in_process" }] }
    }
  });
  assert.strictEqual(chargeback.manual, true);
  assert.strictEqual(chargeback.codigo, "mercadopago_chargeback_manual");
  assert.strictEqual(repoManual.state.ledger.length, 0);

  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "created", status_detail: "created" }).type, "payment.created");
  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "action_required", status_detail: "waiting_transfer" }).type, "payment.pending");
  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "processed", status_detail: "accredited" }).type, "payment.approved");
  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "failed", status_detail: "failed" }).type, "payment.rejected");
  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "canceled", status_detail: "canceled" }).type, "payment.cancelled");
  assert.strictEqual(financeiro.mapearStatusMercadoPago({ status: "refunded", status_detail: "refunded" }).type, "payment.refunded");

  const indexFonte = fs.readFileSync(path.resolve(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.includes('"/admin/financeiro/mercadopago"'), "rota Admin Mercado Pago deve estar montada");
  assert.ok(indexFonte.includes('"/webhooks/mercadopago"'), "webhook Mercado Pago deve estar montado");
  assert.ok(indexFonte.includes('"/admin/financeiro/simulado"'), "adapter simulado permanece montado");

  console.log("financeiro-mercadopago-pix-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
