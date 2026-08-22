"use strict";

const crypto = require("crypto");
const {
  criarCobrancaFinanceira,
  processarFinancialPaymentEvent
} = require("./financeiro.service");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");
const { FINANCIAL_PAYMENT_EVENT_TYPES } = require("./financeiro.schema");

const PROVIDER_SIMULATED = "simulated";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function slug(valor = "") {
  return texto(valor)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function idCurto() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function criarExternalPaymentIdSimulado(clienteId = "", planoId = "") {
  const cliente = slug(clienteId) || "cliente";
  const plano = slug(planoId) || "plano";
  return `sim_pay_${cliente}_${plano}_${idCurto()}`;
}

function criarProviderEventIdSimulado(tipo = "payment.created", externalPaymentId = "") {
  const evento = slug(tipo.replace(/^payment\./, "")) || "event";
  const pagamento = slug(externalPaymentId) || "payment";
  return `sim_evt_${evento}_${pagamento}_${idCurto()}`;
}

function normalizarTipoEventoSimulado(valor = "") {
  const entrada = texto(valor);
  const tipo = entrada.startsWith("payment.") ? entrada : `payment.${entrada}`;
  return FINANCIAL_PAYMENT_EVENT_TYPES.includes(tipo) ? tipo : "";
}

async function criarCobrancaSimulada({
  clienteId = "",
  planoId = "",
  planos = {},
  externalPaymentId = "",
  providerEventId = "",
  repositorio = criarRepositorioFinanceiroPostgres(),
  agora = new Date(),
  metadata = {}
} = {}) {
  const ext = texto(externalPaymentId) || criarExternalPaymentIdSimulado(clienteId, planoId);
  const evt = texto(providerEventId) || criarProviderEventIdSimulado("payment.created", ext);

  const cobranca = await criarCobrancaFinanceira({
    clienteId,
    planoId,
    planos,
    provider: PROVIDER_SIMULATED,
    externalPaymentId: ext,
    repositorio,
    agora,
    metadata: {
      ...metadata,
      adapter: "simulated_v1"
    }
  });

  if (!cobranca.ok) return cobranca;

  const evento = await processarFinancialPaymentEvent({
    type: "payment.created",
    provider: PROVIDER_SIMULATED,
    providerEventId: evt,
    externalPaymentId: ext,
    clienteId,
    planoId: cobranca.planSnapshot?.planoId || planoId,
    amountCents: cobranca.planSnapshot?.amountCents,
    currency: cobranca.planSnapshot?.currency,
    receivedAt: agora,
    metadata: {
      adapter: "simulated_v1",
      acao: "criar_cobranca"
    }
  }, { repositorio, agora });

  return {
    ok: true,
    provider: PROVIDER_SIMULATED,
    externalPaymentId: ext,
    providerEventId: evt,
    payment: cobranca.payment,
    planSnapshot: cobranca.planSnapshot,
    evento
  };
}

async function emitirEventoPagamentoSimulado({
  type = "",
  externalPaymentId = "",
  providerEventId = "",
  clienteId = "",
  planoId = "",
  repositorio = criarRepositorioFinanceiroPostgres(),
  agora = new Date(),
  metadata = {}
} = {}) {
  const tipo = normalizarTipoEventoSimulado(type);
  if (!tipo) {
    return { ok: false, codigo: "evento_simulado_invalido" };
  }

  const ext = texto(externalPaymentId);
  if (!ext) {
    return { ok: false, codigo: "external_payment_id_obrigatorio" };
  }

  let payment = null;
  if (typeof repositorio.buscarPayment === "function") {
    payment = await repositorio.buscarPayment(PROVIDER_SIMULATED, ext);
  }

  const cliente = texto(clienteId || payment?.cliente_id || payment?.clienteId);
  if (!cliente) {
    return { ok: false, codigo: "cliente_id_obrigatorio" };
  }

  const evt = texto(providerEventId) || criarProviderEventIdSimulado(tipo, ext);
  const snapshot = payment?.plan_snapshot || payment?.planSnapshot || {};
  const resultado = await processarFinancialPaymentEvent({
    type: tipo,
    provider: PROVIDER_SIMULATED,
    providerEventId: evt,
    externalPaymentId: ext,
    clienteId: cliente,
    planoId: planoId || payment?.plano_id || payment?.planoId || snapshot.planoId,
    amountCents: payment?.amount_cents || payment?.amountCents || snapshot.amountCents,
    currency: payment?.currency || snapshot.currency,
    receivedAt: agora,
    metadata: {
      ...metadata,
      adapter: "simulated_v1"
    }
  }, { repositorio, agora });

  return {
    ok: resultado.ok !== false,
    provider: PROVIDER_SIMULATED,
    externalPaymentId: ext,
    providerEventId: evt,
    type: tipo,
    clienteId: cliente,
    resultado
  };
}

module.exports = {
  PROVIDER_SIMULATED,
  criarCobrancaSimulada,
  criarExternalPaymentIdSimulado,
  criarProviderEventIdSimulado,
  emitirEventoPagamentoSimulado,
  normalizarTipoEventoSimulado
};
