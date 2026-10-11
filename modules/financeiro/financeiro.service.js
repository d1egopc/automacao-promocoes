"use strict";

const crypto = require("crypto");
const {
  buscarEntradaPlano,
  normalizarPlanoSaasComId,
  politicaCreditosPlano
} = require("../../utils/saas-fundacao");
const {
  FINANCIAL_LEDGER_TYPES,
  FINANCIAL_PAYMENT_EVENT_TYPES,
  FINANCIAL_PAYMENT_STATUSES
} = require("./financeiro.schema");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
}

function numeroInteiro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : fallback;
}

function uuid() {
  return crypto.randomUUID();
}

function iso(data = new Date()) {
  return new Date(data).toISOString();
}

function adicionarDias(data = new Date(), dias = 30) {
  const d = new Date(data);
  d.setUTCDate(d.getUTCDate() + Math.max(1, numeroInteiro(dias, 30)));
  return d;
}

function normalizarMoeda(valor = "BRL") {
  const moeda = texto(valor || "BRL").toUpperCase();
  return /^[A-Z]{3}$/.test(moeda) ? moeda : "BRL";
}

function amountCentsPlano(plano = {}) {
  const candidatos = [
    plano.amountCents,
    plano.precoCentavos,
    plano.valorCentavos,
    plano.precoCents,
    plano.priceCents
  ];

  for (const candidato of candidatos) {
    const n = numeroInteiro(candidato, NaN);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const preco = texto(plano.preco || plano.valor || plano.price);
  if (!preco) return 0;
  const limpo = preco
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function validarPlanoPagoContratavel(plano = {}, planoId = "", opcoes = {}) {
  const normalizado = normalizarPlanoSaasComId(plano, planoId);
  const politica = politicaCreditosPlano(normalizado);
  const amountCents = amountCentsPlano(normalizado);
  const permitirPlanoPagoEmBreveInterno = opcoes.permitirPlanoPagoEmBreveInterno === true;

  if (normalizado.entradaBeta === true || politica.renovacaoCreditos === "sem_renovacao") {
    return { ok: false, codigo: "plano_free_beta_nao_cobravel" };
  }
  if (
    !permitirPlanoPagoEmBreveInterno &&
    (normalizado.visivelPublicamente !== true || normalizado.contratavel !== true || normalizado.emBreve === true)
  ) {
    return { ok: false, codigo: "plano_nao_contratavel" };
  }
  if (politica.creditosModelo !== "ciclo" || politica.creditosPorCiclo <= 0) {
    return { ok: false, codigo: "plano_sem_credito_ciclico" };
  }
  if (amountCents <= 0) {
    return { ok: false, codigo: "plano_sem_valor_pago" };
  }

  return { ok: true, normalizado, politica, amountCents };
}

function capturarPlanSnapshot(plano = {}, planoId = "", agora = new Date(), opcoes = {}) {
  const validacao = validarPlanoPagoContratavel(plano, planoId, opcoes);
  if (!validacao.ok) {
    const erro = new Error(validacao.codigo);
    erro.codigo = validacao.codigo;
    throw erro;
  }

  const { normalizado, politica, amountCents } = validacao;
  const capturedAt = iso(agora);
  const currency = normalizarMoeda(normalizado.currency || normalizado.moeda || "BRL");
  return {
    planoId: texto(normalizado.id || planoId),
    nomeComercial: texto(normalizado.nome || planoId),
    amountCents,
    currency,
    creditosPorCiclo: politica.creditosPorCiclo,
    cicloDias: politica.cicloDias,
    renovacaoCreditos: politica.renovacaoCreditos,
    capturedAt
  };
}

async function criarCobrancaFinanceira({
  clienteId = "",
  planoId = "",
  planos = {},
  provider = "simulated",
  externalPaymentId = "",
  repositorio = criarRepositorioFinanceiroPostgres(),
  agora = new Date(),
  metadata = {},
  permitirPlanoPagoEmBreveInterno = false
} = {}) {
  const cliente = texto(clienteId);
  const planoIdentidade = texto(planoId);
  if (!cliente) return { ok: false, codigo: "cliente_id_obrigatorio" };
  if (!planoIdentidade) return { ok: false, codigo: "plano_id_obrigatorio" };

  const entrada = buscarEntradaPlano(planos, planoIdentidade);
  if (!entrada) return { ok: false, codigo: "plano_nao_encontrado" };

  let snapshot;
  try {
    snapshot = capturarPlanSnapshot(entrada.plano, entrada.chave, agora, {
      permitirPlanoPagoEmBreveInterno
    });
  } catch (e) {
    return { ok: false, codigo: e.codigo || "plano_invalido_para_cobranca" };
  }

  const payment = {
    provider: textoLower(provider || "simulated") || "simulated",
    externalPaymentId: texto(externalPaymentId || `sim_${uuid()}`),
    clienteId: cliente,
    planoId: snapshot.planoId,
    amountCents: snapshot.amountCents,
    currency: snapshot.currency,
    status: "created",
    planSnapshot: snapshot,
    planSnapshotCapturedAt: snapshot.capturedAt,
    metadata: {
      ...metadata,
      origem: "financial_charge_v1"
    }
  };

  const criado = await repositorio.criarCobranca(payment);
  return { ok: true, payment: criado || payment, planSnapshot: snapshot };
}

function normalizarFinancialPaymentEvent(evento = {}) {
  const type = texto(evento.type || evento.eventType || evento.tipo);
  if (!FINANCIAL_PAYMENT_EVENT_TYPES.includes(type)) {
    const erro = new Error("financial_event_type_invalido");
    erro.codigo = "financial_event_type_invalido";
    throw erro;
  }

  const provider = textoLower(evento.provider || "simulated") || "simulated";
  const providerEventId = texto(evento.providerEventId || evento.provider_event_id || evento.eventId || evento.id);
  const externalPaymentId = texto(evento.externalPaymentId || evento.external_payment_id || evento.pagamentoId);
  const clienteId = texto(evento.clienteId || evento.usuarioId || evento.cliente_id);

  if (!providerEventId) {
    const erro = new Error("provider_event_id_obrigatorio");
    erro.codigo = "provider_event_id_obrigatorio";
    throw erro;
  }
  if (!externalPaymentId) {
    const erro = new Error("external_payment_id_obrigatorio");
    erro.codigo = "external_payment_id_obrigatorio";
    throw erro;
  }
  if (!clienteId) {
    const erro = new Error("cliente_id_obrigatorio");
    erro.codigo = "cliente_id_obrigatorio";
    throw erro;
  }

  return {
    type,
    provider,
    providerEventId,
    externalPaymentId,
    clienteId,
    planoId: texto(evento.planoId || evento.plano_id),
    amountCents: evento.amountCents === undefined ? undefined : numeroInteiro(evento.amountCents, 0),
    currency: evento.currency ? normalizarMoeda(evento.currency) : undefined,
    occurredAt: evento.occurredAt ? iso(evento.occurredAt) : null,
    receivedAt: evento.receivedAt ? iso(evento.receivedAt) : iso(new Date()),
    metadata: evento.metadata && typeof evento.metadata === "object" ? evento.metadata : {},
    planSnapshot: evento.planSnapshot && typeof evento.planSnapshot === "object" ? evento.planSnapshot : null,
    planSnapshotCapturedAt: evento.planSnapshotCapturedAt ? iso(evento.planSnapshotCapturedAt) : null
  };
}

function statusFromEvent(type = "") {
  return texto(type).replace(/^payment\./, "");
}

function validarTransicaoPagamento(statusAtual = "created", statusNovo = "created") {
  const atual = FINANCIAL_PAYMENT_STATUSES.includes(statusAtual) ? statusAtual : "created";
  const novo = FINANCIAL_PAYMENT_STATUSES.includes(statusNovo) ? statusNovo : "created";
  if (atual === novo) return { acao: "idempotente", status: atual };

  const permitidas = {
    created: ["pending", "approved", "rejected", "cancelled"],
    pending: ["approved", "rejected", "cancelled"],
    approved: ["refunded"],
    rejected: [],
    cancelled: [],
    refunded: []
  };

  if ((permitidas[atual] || []).includes(novo)) {
    return { acao: "processar", status: novo };
  }

  return {
    acao: "ignorar",
    status: atual,
    motivo: `transicao_invalida_${atual}_para_${novo}`
  };
}

function normalizarLinhaPayment(row = {}) {
  const snapshot = row.plan_snapshot || row.planSnapshot || {};
  return {
    id: row.id,
    provider: row.provider,
    externalPaymentId: row.external_payment_id || row.externalPaymentId,
    clienteId: row.cliente_id || row.clienteId,
    subscriptionId: row.subscription_id || row.subscriptionId,
    planoId: row.plano_id || row.planoId || snapshot.planoId,
    amountCents: row.amount_cents ?? row.amountCents,
    currency: row.currency,
    status: row.status || "created",
    planSnapshot: snapshot,
    planSnapshotCapturedAt: row.plan_snapshot_captured_at || row.planSnapshotCapturedAt,
    metadata: row.metadata || {}
  };
}

function normalizarLinhaSubscription(row = {}) {
  return {
    id: row.id,
    clienteId: row.cliente_id || row.clienteId,
    planoId: row.plano_id || row.planoId,
    status: row.status,
    metadata: row.metadata || {}
  };
}

function metadataCiclo(payment, snapshot, evento) {
  return {
    provider: payment.provider,
    externalPaymentId: payment.externalPaymentId,
    providerEventId: evento.providerEventId,
    planoId: snapshot.planoId,
    planoNome: snapshot.nomeComercial,
    amountCents: snapshot.amountCents,
    currency: snapshot.currency,
    paymentStatus: "approved",
    planSnapshot: snapshot
  };
}

async function processarFinancialPaymentEvent(eventoBruto = {}, {
  repositorio = criarRepositorioFinanceiroPostgres(),
  agora = new Date()
} = {}) {
  let evento;
  try {
    evento = normalizarFinancialPaymentEvent(eventoBruto);
  } catch (e) {
    return { ok: false, codigo: e.codigo || "evento_financeiro_invalido" };
  }

  return repositorio.transacao(async (tx) => {
    const eventoInserido = await tx.inserirEvento(evento);
    if (!eventoInserido) {
      return { ok: true, idempotente: true, motivo: "evento_duplicado" };
    }

    try {
      let payment = normalizarLinhaPayment(await tx.buscarPayment(evento.provider, evento.externalPaymentId));

      if (!payment.id) {
        if (!evento.planSnapshot || !["payment.created", "payment.pending"].includes(evento.type)) {
          await tx.marcarEventoIgnorado(eventoInserido.id, "payment_nao_encontrado");
          return { ok: true, ignorado: true, motivo: "payment_nao_encontrado" };
        }

        payment = normalizarLinhaPayment(await tx.criarPayment({
          provider: evento.provider,
          externalPaymentId: evento.externalPaymentId,
          clienteId: evento.clienteId,
          planoId: evento.planSnapshot.planoId || evento.planoId,
          amountCents: evento.planSnapshot.amountCents,
          currency: evento.planSnapshot.currency,
          status: statusFromEvent(evento.type),
          planSnapshot: evento.planSnapshot,
          planSnapshotCapturedAt: evento.planSnapshotCapturedAt || evento.planSnapshot.capturedAt || evento.receivedAt,
          metadata: { origem: "financial_event_v1" }
        }));
      }

      const novoStatus = statusFromEvent(evento.type);
      const transicao = validarTransicaoPagamento(payment.status, novoStatus);
      if (transicao.acao === "ignorar") {
        await tx.marcarEventoIgnorado(eventoInserido.id, transicao.motivo);
        return { ok: true, ignorado: true, motivo: transicao.motivo, status: payment.status };
      }

      const subscription = normalizarLinhaSubscription(await tx.obterOuCriarSubscription(payment.clienteId, payment.planoId));
      if (!payment.subscriptionId && subscription.id) {
        payment = normalizarLinhaPayment(await tx.atualizarPayment(payment.id, { subscriptionId: subscription.id })) || payment;
      }

      if (transicao.acao === "idempotente") {
        await tx.marcarEventoProcessado(eventoInserido.id);
        return { ok: true, idempotente: true, motivo: "status_ja_aplicado", status: payment.status };
      }

      const camposPayment = { status: novoStatus };
      if (novoStatus === "approved") camposPayment.approvedAt = iso(agora);
      if (novoStatus === "cancelled") camposPayment.cancelledAt = iso(agora);
      if (novoStatus === "refunded") camposPayment.refundedAt = iso(agora);

      const paymentAtualizado = normalizarLinhaPayment(await tx.atualizarPayment(payment.id, camposPayment)) || payment;

      let ledger = null;
      if (novoStatus === "approved") {
        const snapshot = paymentAtualizado.planSnapshot || {};
        const cicloInicio = iso(agora);
        const cicloFim = adicionarDias(agora, snapshot.cicloDias || 30).toISOString();
        const ledgerKey = `cycle_credit:${paymentAtualizado.provider}:${paymentAtualizado.externalPaymentId}`;

        ledger = await tx.inserirLedger({
          clienteId: paymentAtualizado.clienteId,
          subscriptionId: subscription.id,
          paymentId: paymentAtualizado.id,
          ledgerType: "cycle_credit",
          amount: numeroInteiro(snapshot.creditosPorCiclo, 0),
          balancePolicy: "replace_cycle",
          cycleStart: cicloInicio,
          cycleEnd: cicloFim,
          reason: "payment_approved",
          idempotencyKey: ledgerKey,
          metadata: metadataCiclo(paymentAtualizado, snapshot, evento)
        });

        await tx.atualizarSubscription(subscription.id, {
          planoId: snapshot.planoId || paymentAtualizado.planoId,
          status: "active",
          currentCycleStart: cicloInicio,
          currentCycleEnd: cicloFim,
          nextRenewalAt: cicloFim,
          lastPaymentId: paymentAtualizado.id,
          metadata: {
            ...(subscription.metadata || {}),
            ultimoProvider: paymentAtualizado.provider,
            ultimoExternalPaymentId: paymentAtualizado.externalPaymentId
          }
        });
      } else if (novoStatus === "pending") {
        await tx.atualizarSubscription(subscription.id, { status: "pending_payment" });
      } else if (novoStatus === "rejected") {
        await tx.atualizarSubscription(subscription.id, { status: "pending_payment" });
      } else if (novoStatus === "cancelled") {
        await tx.atualizarSubscription(subscription.id, { status: "cancelled" });
      } else if (novoStatus === "refunded") {
        const snapshot = paymentAtualizado.planSnapshot || {};
        ledger = await tx.inserirLedger({
          clienteId: paymentAtualizado.clienteId,
          subscriptionId: subscription.id,
          paymentId: paymentAtualizado.id,
          ledgerType: "refund_adjustment",
          amount: -Math.abs(numeroInteiro(snapshot.creditosPorCiclo, 0)),
          balancePolicy: "add",
          reason: "payment_refunded",
          idempotencyKey: `refund_adjustment:${paymentAtualizado.provider}:${paymentAtualizado.externalPaymentId}`,
          metadata: metadataCiclo(paymentAtualizado, snapshot, evento)
        });
        await tx.atualizarSubscription(subscription.id, { status: "refunded" });
      }

      await tx.marcarEventoProcessado(eventoInserido.id);
      return {
        ok: true,
        status: novoStatus,
        paymentId: paymentAtualizado.id,
        ledgerInserido: Boolean(ledger),
        ledgerId: ledger?.id || null
      };
    } catch (e) {
      await tx.marcarEventoFalha(eventoInserido.id, e.codigo || e.message || "processamento_financeiro_falhou");
      throw e;
    }
  });
}

function ledgerJaProjetado(usuario = {}, ledgerId = "") {
  const ids = Array.isArray(usuario.ledgerFinanceiroProjetadoIds)
    ? usuario.ledgerFinanceiroProjetadoIds
    : [];
  return ids.includes(ledgerId);
}

function registrarLedgerProjetado(usuario = {}, ledgerId = "") {
  usuario.ledgerFinanceiroProjetadoIds = Array.isArray(usuario.ledgerFinanceiroProjetadoIds)
    ? usuario.ledgerFinanceiroProjetadoIds
    : [];
  if (ledgerId && !usuario.ledgerFinanceiroProjetadoIds.includes(ledgerId)) {
    usuario.ledgerFinanceiroProjetadoIds.push(ledgerId);
  }
  if (usuario.ledgerFinanceiroProjetadoIds.length > 200) {
    usuario.ledgerFinanceiroProjetadoIds = usuario.ledgerFinanceiroProjetadoIds.slice(-200);
  }
}

function projetarLedgerEmUsuario(usuario = {}, ledger = {}, agora = new Date()) {
  const ledgerId = texto(ledger.id);
  if (!ledgerId) return { ok: false, codigo: "ledger_id_obrigatorio" };
  if (ledgerJaProjetado(usuario, ledgerId)) {
    return { ok: true, idempotente: true, motivo: "ledger_ja_projetado" };
  }

  const tipo = ledger.ledger_type || ledger.ledgerType;
  if (!FINANCIAL_LEDGER_TYPES.includes(tipo)) {
    return { ok: false, codigo: "ledger_tipo_invalido" };
  }

  const amount = numeroInteiro(ledger.amount, 0);
  const metadata = ledger.metadata || {};
  const snapshot = metadata.planSnapshot || metadata.plan_snapshot || {};

  if (tipo === "cycle_credit") {
    usuario.creditos = Math.max(0, amount);
    usuario.creditosModelo = "ciclo";
    usuario.plano = snapshot.planoId || metadata.planoId || usuario.plano;
    usuario.planoAssinatura = snapshot.planoId || metadata.planoId || usuario.planoAssinatura || usuario.plano;
    usuario.assinaturaStatus = "ativa";
    usuario.statusConta = "ativa";
    usuario.pagamentoUltimoId = metadata.externalPaymentId || metadata.pagamentoId || usuario.pagamentoUltimoId || "";
    usuario.pagamentoUltimoStatus = metadata.paymentStatus || "approved";
    usuario.cicloAtualInicio = ledger.cycle_start || ledger.cycleStart || usuario.cicloAtualInicio || iso(agora);
    usuario.cicloAtualFim = ledger.cycle_end || ledger.cycleEnd || usuario.cicloAtualFim;
    usuario.proximaRenovacao = ledger.cycle_end || ledger.cycleEnd || usuario.proximaRenovacao;
    usuario.ultimoCicloCreditoId = ledger.idempotency_key || ledger.idempotencyKey || ledgerId;
    usuario.ultimoCicloCreditoIdempotencyKey = ledger.idempotency_key || ledger.idempotencyKey || ledgerId;
  } else if (tipo === "admin_credit" || tipo === "adjustment" || tipo === "refund_adjustment") {
    const atual = numeroInteiro(usuario.creditos, 0);
    usuario.creditos = Math.max(0, atual + amount);
  }

  registrarLedgerProjetado(usuario, ledgerId);
  usuario.financeiroUltimaProjecaoEm = iso(agora);
  return { ok: true, alterou: true };
}

async function reconciliarLedgerFinanceiroPendente({
  repositorio = criarRepositorioFinanceiroPostgres(),
  lerUsuarios,
  salvarUsuarios,
  limite = 50,
  filtro = {},
  agora = new Date()
} = {}) {
  if (typeof lerUsuarios !== "function") {
    return { ok: false, codigo: "ler_usuarios_obrigatorio" };
  }
  if (typeof salvarUsuarios !== "function") {
    return { ok: false, codigo: "salvar_usuarios_obrigatorio" };
  }

  const pendentes = await repositorio.listarLedgerPendente({ ...filtro, limite });
  let projetados = 0;
  let falhas = 0;

  for (const ledger of pendentes) {
    try {
      const usuarios = await lerUsuarios();
      const lista = Array.isArray(usuarios) ? usuarios : [];
      const clienteId = ledger.cliente_id || ledger.clienteId;
      const usuario = lista.find((u) => texto(u?.id || u?.clienteId || u?.usuarioId) === texto(clienteId));
      if (!usuario) {
        await repositorio.marcarLedgerFalha(ledger.id, "usuario_nao_encontrado");
        falhas += 1;
        continue;
      }

      projetarLedgerEmUsuario(usuario, ledger, agora);
      await salvarUsuarios(lista);
      await repositorio.marcarLedgerProjetado(ledger.id);
      projetados += 1;
    } catch (e) {
      await repositorio.marcarLedgerFalha(ledger.id, e.codigo || e.message || "falha_projecao");
      falhas += 1;
    }
  }

  return { ok: true, processados: pendentes.length, projetados, falhas };
}

module.exports = {
  amountCentsPlano,
  capturarPlanSnapshot,
  criarCobrancaFinanceira,
  normalizarFinancialPaymentEvent,
  processarFinancialPaymentEvent,
  projetarLedgerEmUsuario,
  reconciliarLedgerFinanceiroPendente,
  validarPlanoPagoContratavel,
  validarTransicaoPagamento
};
