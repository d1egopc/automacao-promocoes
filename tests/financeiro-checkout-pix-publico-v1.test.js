"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");

const financeiro = require("../modules/financeiro");
const criarRotasCheckoutFinanceiro = require("../modules/financeiro/checkout.routes");

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
      const resultado = await fn(this.tx(draft));
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

  async buscarPaymentCliente(provider, externalPaymentId, clienteId) {
    return this.state.payments.find((p) =>
      p.provider === provider &&
      p.external_payment_id === externalPaymentId &&
      p.cliente_id === clienteId
    ) || null;
  }

  async buscarPaymentPendenteClientePlano({ provider, clienteId, planoId, janelaMs = 30 * 60 * 1000, agora = new Date() } = {}) {
    const minimo = new Date(agora).getTime() - Number(janelaMs || 0);
    return this.state.payments
      .filter((p) => p.provider === provider)
      .filter((p) => p.cliente_id === clienteId)
      .filter((p) => p.plano_id === planoId)
      .filter((p) => ["created", "pending"].includes(p.status))
      .filter((p) => p.metadata?.mpOrderId)
      .filter((p) => !["manual_review", "exhausted", "finalized"].includes(p.metadata?.reconciliationStatus))
      .filter((p) => new Date(p.created_at).getTime() >= minimo)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
  }

  async buscarSubscriptionCliente(clienteId) {
    return this.state.subscriptions.find((s) => s.cliente_id === clienteId) || null;
  }

  async obterProjectionPayment(paymentId) {
    return this.state.ledger
      .filter((l) => l.payment_id === paymentId)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] || null;
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
    const item = this.state.ledger.find((l) => l.id === ledgerId);
    if (!item) return null;
    item.projection_status = "projected";
    item.projected_at = "2026-08-23T10:05:00.000Z";
    item.projection_attempts += 1;
    item.projection_error = null;
    return item;
  }

  async marcarLedgerFalha(ledgerId, erro) {
    const item = this.state.ledger.find((l) => l.id === ledgerId);
    if (!item) return null;
    item.projection_status = "pending";
    item.projection_attempts += 1;
    item.projection_error = String(erro || "erro_projecao");
    return item;
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
          metadata: clone(evento.metadata || {})
        };
        state.events.push(row);
        return row;
      },
      async marcarEventoProcessado(id) {
        const item = state.events.find((e) => e.id === id);
        item.processing_status = "processed";
        item.processed_at = "2026-08-23T10:05:00.000Z";
      },
      async marcarEventoIgnorado(id, motivo) {
        const item = state.events.find((e) => e.id === id);
        item.processing_status = "ignored";
        item.ignored_reason = motivo;
      },
      async marcarEventoFalha(id, motivo) {
        const item = state.events.find((e) => e.id === id);
        item.processing_status = "failed";
        item.ignored_reason = motivo;
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
          metadata: clone(payment.metadata || {}),
          created_at: "2026-08-23T10:00:00.000Z"
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
        if (campos.metadata !== undefined) p.metadata = clone(campos.metadata);
        return p;
      },
      async obterOuCriarSubscription(clienteId, planoId) {
        let sub = state.subscriptions.find((s) => s.cliente_id === clienteId);
        if (sub) return sub;
        sub = { id: repo.id("sub"), cliente_id: clienteId, plano_id: planoId, status: "pending_payment", metadata: {} };
        state.subscriptions.push(sub);
        return sub;
      },
      async atualizarSubscription(id, campos) {
        const sub = state.subscriptions.find((s) => s.id === id);
        if (!sub) return null;
        if (campos.planoId) sub.plano_id = campos.planoId;
        if (campos.status) sub.status = campos.status;
        if (campos.currentCycleStart !== undefined) sub.current_cycle_start = campos.currentCycleStart;
        if (campos.currentCycleEnd !== undefined) sub.current_cycle_end = campos.currentCycleEnd;
        if (campos.nextRenewalAt !== undefined) sub.next_renewal_at = campos.nextRenewalAt;
        if (campos.lastPaymentId !== undefined) sub.last_payment_id = campos.lastPaymentId;
        if (campos.metadata !== undefined) sub.metadata = clone(campos.metadata);
        return sub;
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
          metadata: clone(ledger.metadata || {}),
          created_at: "2026-08-23T10:05:00.000Z"
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
    this.seq = 1;
  }

  async criarOrder(body, { idempotencyKey } = {}) {
    this.calls.push({ body: clone(body), idempotencyKey });
    const id = `ORD_PUBLIC_${this.seq}`;
    this.seq += 1;
    return {
      id,
      status: "action_required",
      status_detail: "waiting_transfer",
      total_amount: body.total_amount,
      external_reference: body.external_reference,
      transactions: {
        payments: [{
          amount: body.total_amount,
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: `000201${id}`,
            qr_code_base64: "base64",
            ticket_url: `https://mp.test/${id}`
          }
        }]
      }
    };
  }
}

class FakeMercadoPagoClientFalha {
  constructor(erro) {
    this.calls = [];
    this.erro = erro;
  }

  async criarOrder(body, { idempotencyKey } = {}) {
    this.calls.push({ body: clone(body), idempotencyKey });
    throw this.erro;
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
  emBreve: false,
  entradaBeta: false,
  renovacaoCreditos: "pagamento",
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 2000, cicloDias: 30 }
};

const planoUltimate = {
  ...planoPro,
  id: "ultimate",
  nome: "Ultimate",
  preco: "R$ 69,90",
  limites: { creditosPorCiclo: 4000, cicloDias: 30 }
};

function criarApp({ repo = new RepoMemoria(), client = new FakeMercadoPagoClient(), usuarios = [], planos = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const clienteId = String(req.headers["x-cliente-id"] || "").trim();
    if (clienteId) {
      req.clienteId = clienteId;
      req.usuario = usuarios.find((u) => u.id === clienteId) || null;
    }
    next();
  });
  app.use("/financeiro", criarRotasCheckoutFinanceiro({
    getPlanos: () => planos,
    repositorio: repo,
    client,
    agora: () => new Date("2026-08-23T10:00:00.000Z")
  }));
  return { app, repo, client, usuarios, planos };
}

function escutar(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, method, path, { clienteId = "user_a", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      method,
      path,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-cliente-id": clienteId
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function fechar(server) {
  return new Promise((resolve, reject) => {
    server.close((erro) => erro ? reject(erro) : resolve());
  });
}

(async () => {
  const usuarios = [
    { id: "user_a", nome: "Ana", email: "ana@test.local", ativo: true, plano: "free_beta", creditos: 300, assinaturaStatus: "nao_aplicavel" },
    { id: "user_b", nome: "Bia", email: "bia@test.local", ativo: true, plano: "free_beta", creditos: 300, assinaturaStatus: "nao_aplicavel" },
    { id: "user_c", nome: "Caio", email: "caio@test.local", ativo: true, plano: "free_beta", creditos: 300, assinaturaStatus: "nao_aplicavel" },
    { id: "user_pro", nome: "Pro", email: "pro@test.local", ativo: true, plano: "pro", planoAssinatura: "pro", creditos: 900, assinaturaStatus: "ativa" }
  ];
  const planos = {
    free_beta: planoFree,
    pro: planoPro,
    ultimate: planoUltimate,
    pro_em_breve: { ...planoPro, id: "pro_em_breve", contratavel: false, emBreve: true },
    pro_oculto: { ...planoPro, id: "pro_oculto", visivelPublicamente: false },
    pro_sem_valor: { ...planoPro, id: "pro_sem_valor", preco: "R$ 0,00", amountCents: 0 }
  };

  const env = criarApp({ usuarios, planos });
  const server = await escutar(env.app);
  try {
    const pro = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_a",
      body: { planoId: "pro" }
    });
    assert.strictEqual(pro.status, 201, "Free -> Pro publico/contratavel cria PIX");
    assert.strictEqual(pro.body.ok, true);
    assert.strictEqual(pro.body.plano.id, "pro");
    assert.strictEqual(pro.body.valor.amountCents, 3490);
    assert.strictEqual(pro.body.pix.qrCode.startsWith("000201"), true);
    assert.strictEqual(env.repo.state.payments[0].cliente_id, "user_a");
    assert.strictEqual(env.client.calls[0].body.total_amount, "34.90");

    const duplo = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_a",
      body: { planoId: "pro" }
    });
    assert.strictEqual(duplo.status, 200, "clique duplo retorna cobranca existente");
    assert.strictEqual(duplo.body.reutilizada, true);
    assert.strictEqual(duplo.body.externalPaymentId, pro.body.externalPaymentId);
    assert.strictEqual(duplo.body.orderId, pro.body.orderId);
    assert.strictEqual(env.client.calls.length, 1, "clique duplo nao cria segunda Order");

    env.repo.state.payments[0].status = "cancelled";
    const aposCancelado = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_a",
      body: { planoId: "pro" }
    });
    assert.strictEqual(aposCancelado.status, 201, "payment cancelado permite nova cobranca");
    assert.strictEqual(env.client.calls.length, 2);

    const injetado = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_b",
      body: {
        planoId: "pro",
        clienteId: "user_a",
        usuarioId: "user_a",
        amountCents: 1,
        creditosPorCiclo: 1,
        cicloDias: 1,
        payer: { email: "injetado@test.local", first_name: "INJETADO" }
      }
    });
    assert.strictEqual(injetado.status, 201, "clienteId/preco/payer no body sao ignorados");
    const paymentB = env.repo.state.payments.find((p) => p.external_payment_id === injetado.body.externalPaymentId);
    assert.strictEqual(paymentB.cliente_id, "user_b");
    assert.strictEqual(paymentB.amount_cents, 3490);
    assert.strictEqual(env.client.calls.at(-1).body.payer.email, "bia@test.local");
    assert.notStrictEqual(env.client.calls.at(-1).body.payer.email, "injetado@test.local");

    const chamadasAntesConcorrencia = env.client.calls.length;
    const concorrentes = await Promise.all([
      request(server, "POST", "/financeiro/checkout/pix", { clienteId: "user_c", body: { planoId: "pro" } }),
      request(server, "POST", "/financeiro/checkout/pix", { clienteId: "user_c", body: { planoId: "pro" } })
    ]);
    assert.strictEqual(env.client.calls.length, chamadasAntesConcorrencia + 1, "POSTs concorrentes criam somente uma Order");
    assert.deepStrictEqual(
      concorrentes.map((r) => r.status).sort(),
      [200, 201],
      "concorrencia retorna uma cobranca nova e uma reutilizada"
    );
    assert.strictEqual(concorrentes[0].body.externalPaymentId, concorrentes[1].body.externalPaymentId);

    const ultimate = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_pro",
      body: { planoId: "ultimate" }
    });
    assert.strictEqual(ultimate.status, 201, "Pro -> Ultimate cria cobranca pelo snapshot Ultimate");
    assert.strictEqual(ultimate.body.plano.id, "ultimate");
    assert.strictEqual(ultimate.body.valor.amountCents, 6990);

    const mesmoPlano = await request(server, "POST", "/financeiro/checkout/pix", {
      clienteId: "user_pro",
      body: { planoId: "pro" }
    });
    assert.strictEqual(mesmoPlano.status, 201, "mesmo plano pode iniciar renovacao se nao houver PIX pendente");
    assert.strictEqual(mesmoPlano.body.plano.id, "pro");

    for (const [planoId, codigo] of [
      ["pro_em_breve", "plano_nao_contratavel"],
      ["pro_oculto", "plano_nao_contratavel"],
      ["free_beta", "plano_free_beta_nao_cobravel"],
      ["pro_sem_valor", "plano_sem_valor_pago"]
    ]) {
      const bloqueado = await request(server, "POST", "/financeiro/checkout/pix", {
        clienteId: "user_a",
        body: { planoId }
      });
      assert.strictEqual(bloqueado.body.codigo, codigo, `${planoId} deve ser bloqueado`);
    }

    const erroMercadoPago = new Error("mercadopago_api_falhou");
    erroMercadoPago.codigo = "mercadopago_api_falhou";
    erroMercadoPago.status = 400;
    erroMercadoPago.detalheMercadoPago = {
      status: 400,
      message: "invalid payer [email_mascarado]",
      error: "bad_request",
      code: "invalid_order",
      cause: [{ code: "invalid_payer", description: "payer.email [email_mascarado] rejeitado" }]
    };
    const repoFalha = new RepoMemoria();
    const envFalha = criarApp({
      repo: repoFalha,
      client: new FakeMercadoPagoClientFalha(erroMercadoPago),
      usuarios: [{ id: "user_falha", nome: "Falha", email: "falha@test.local", ativo: true, plano: "free_beta", creditos: 300 }],
      planos
    });
    const serverFalha = await escutar(envFalha.app);
    try {
      const falha = await request(serverFalha, "POST", "/financeiro/checkout/pix", {
        clienteId: "user_falha",
        body: { planoId: "pro" }
      });
      assert.strictEqual(falha.status, 400, "checkout publico preserva status Mercado Pago");
      assert.strictEqual(falha.body.codigo, "mercadopago_api_falhou");
      assert.strictEqual(falha.body.statusMercadoPago, 400);
      assert.deepStrictEqual(falha.body.detalheMercadoPago, erroMercadoPago.detalheMercadoPago);
      const serializadoFalha = JSON.stringify(falha.body);
      assert.strictEqual(serializadoFalha.includes("falha@test.local"), false, "checkout publico nao vaza email completo");
      assert.strictEqual(repoFalha.state.payments.length, 1, "payment interno permanece auditavel");
      assert.strictEqual(repoFalha.state.payments[0].metadata?.mpOrderId, undefined, "falha externa nao cria mpOrderId");
      assert.strictEqual(repoFalha.state.events.length, 0, "falha externa nao cria evento financeiro");
      assert.strictEqual(repoFalha.state.ledger.length, 0, "falha externa nao cria ledger");
    } finally {
      await fechar(serverFalha);
    }

    const ext = aposCancelado.body.externalPaymentId;
    const outroCliente = await request(server, "GET", `/financeiro/pagamentos/${encodeURIComponent(ext)}/status`, {
      clienteId: "user_b"
    });
    assert.strictEqual(outroCliente.status, 404, "payment de outro cliente retorna 404");

    await financeiro.processarFinancialPaymentEvent({
      type: "payment.approved",
      provider: "mercadopago",
      providerEventId: "evt_public_approved",
      externalPaymentId: ext,
      clienteId: "user_a",
      planoId: "pro",
      amountCents: 3490,
      currency: "BRL",
      receivedAt: new Date("2026-08-23T10:05:00.000Z")
    }, {
      repositorio: env.repo,
      agora: new Date("2026-08-23T10:05:00.000Z")
    });
    await financeiro.reconciliarLedgerFinanceiroPendente({
      repositorio: env.repo,
      lerUsuarios: async () => usuarios,
      salvarUsuarios: async () => {},
      filtro: {
        provider: "mercadopago",
        externalPaymentId: ext,
        clienteId: "user_a"
      }
    });

    const status = await request(server, "GET", `/financeiro/pagamentos/${encodeURIComponent(ext)}/status`, {
      clienteId: "user_a"
    });
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.status, "approved");
    assert.strictEqual(status.body.projection, "projected");
    assert.strictEqual(status.body.assinatura.status, "active");
    assert.strictEqual(JSON.stringify(status.body).includes("metadata"), false);
    assert.strictEqual(JSON.stringify(status.body).includes("providerEventId"), false);
    assert.strictEqual(JSON.stringify(status.body).includes("ledger"), false);
    assert.strictEqual(JSON.stringify(status.body).includes("mpOrderId"), false);
    assert.strictEqual(JSON.stringify(status.body).includes("idempotencyKey"), false);

    const assinatura = await request(server, "GET", "/financeiro/assinatura", { clienteId: "user_a" });
    assert.strictEqual(assinatura.status, 200);
    assert.deepStrictEqual(
      {
        clienteId: assinatura.body.clienteId,
        plano: assinatura.body.plano,
        planoAssinatura: assinatura.body.planoAssinatura,
        assinaturaStatus: assinatura.body.assinaturaStatus,
        creditos: assinatura.body.creditos
      },
      {
        clienteId: "self",
        plano: "pro",
        planoAssinatura: "pro",
        assinaturaStatus: "ativa",
        creditos: 2000
      },
      "assinatura reflete estado projetado do usuario autenticado"
    );

    const semAuth = await request(server, "GET", "/financeiro/assinatura", { clienteId: "" });
    assert.strictEqual(semAuth.status, 401);

    console.log("financeiro-checkout-pix-publico-v1.test.js OK");
  } finally {
    await fechar(server);
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
