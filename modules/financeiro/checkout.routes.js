"use strict";

const express = require("express");
const { buscarEntradaPlano } = require("../../utils/saas-fundacao");
const { resolverFinanceiroUsuarioSaas } = require("../../utils/saas-financeiro-estado");
const { capturarPlanSnapshot } = require("./financeiro.service");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");
const {
  PROVIDER_MERCADOPAGO,
  criarCobrancaMercadoPagoPix
} = require("./mercadopago.adapter");

const CHECKOUT_PIX_PENDING_WINDOW_MS = 30 * 60 * 1000;
const checkoutLocks = new Map();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function numeroInteiro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : fallback;
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function erroHttp(res, erro = "checkout_pix_falhou", status = 400) {
  const codigo = typeof erro === "object" && erro
    ? erro.codigo || "checkout_pix_falhou"
    : texto(erro) || "checkout_pix_falhou";
  const statusHttp = typeof erro === "object" && erro
    ? erro.statusCode || erro.status || status
    : status;
  const resposta = {
    ok: false,
    codigo,
    erro: statusHttp >= 500 ? "Falha ao iniciar checkout PIX" : codigo
  };
  if (codigo === "mercadopago_api_falhou" && erro?.detalheMercadoPago) {
    resposta.statusMercadoPago = Number(erro.status) || Number(erro.detalheMercadoPago.status) || statusHttp;
    resposta.detalheMercadoPago = erro.detalheMercadoPago;
  }
  return res.status(statusHttp).json(resposta);
}

async function executarComLockCheckout(chave = "", fn = async () => null) {
  const lockKey = texto(chave) || "checkout";
  const anterior = checkoutLocks.get(lockKey) || Promise.resolve();
  let liberar = () => {};
  const atual = new Promise((resolve) => {
    liberar = resolve;
  });
  const encadeado = anterior.catch(() => {}).then(() => atual);
  checkoutLocks.set(lockKey, encadeado);

  await anterior.catch(() => {});
  try {
    return await fn();
  } finally {
    liberar();
    if (checkoutLocks.get(lockKey) === encadeado) {
      checkoutLocks.delete(lockKey);
    }
  }
}

function statusErroPlano(codigo = "") {
  if (codigo === "plano_nao_encontrado") return 404;
  if (codigo === "plano_nao_contratavel") return 403;
  if (codigo === "plano_free_beta_nao_cobravel") return 403;
  return 400;
}

function planSnapshot(payment = {}) {
  const snapshot = payment.plan_snapshot || payment.planSnapshot || {};
  return objeto(snapshot);
}

function planoSanitizado(snapshot = {}, planoId = "") {
  return {
    id: texto(snapshot.planoId || snapshot.plano_id || planoId),
    nome: texto(snapshot.nomeComercial || snapshot.nome || snapshot.nome_comercial || planoId)
  };
}

function valorSanitizado(payment = {}, snapshot = {}) {
  return {
    amountCents: numeroInteiro(payment.amount_cents ?? payment.amountCents ?? snapshot.amountCents, 0),
    currency: texto(payment.currency || snapshot.currency || "BRL").toUpperCase()
  };
}

function pixSanitizado(pix = {}) {
  const fonte = objeto(pix);
  return {
    qrCode: texto(fonte.qrCode),
    qrCodeBase64: texto(fonte.qrCodeBase64),
    ticketUrl: texto(fonte.ticketUrl),
    expiracao: texto(fonte.expiracao)
  };
}

function assinaturaStatusSanitizada(subscription = null) {
  if (!subscription) return null;
  return {
    status: texto(subscription.status),
    cicloAtualFim: texto(subscription.current_cycle_end || subscription.currentCycleEnd || "")
  };
}

function respostaPaymentStatus({ payment = {}, projection = null, subscription = null } = {}) {
  const snapshot = planSnapshot(payment);
  return {
    ok: true,
    externalPaymentId: texto(payment.external_payment_id || payment.externalPaymentId),
    status: texto(payment.status),
    plano: planoSanitizado(snapshot, payment.plano_id || payment.planoId),
    valor: valorSanitizado(payment, snapshot),
    projection: texto(projection?.projection_status || projection?.projectionStatus || "none"),
    assinatura: assinaturaStatusSanitizada(subscription)
  };
}

function financeiroUsuarioSanitizado({ usuario = {}, planos = {}, resolverFinanceiroUsuario = null } = {}) {
  if (typeof resolverFinanceiroUsuario === "function") {
    return resolverFinanceiroUsuario(usuario);
  }
  return resolverFinanceiroUsuarioSaas({ usuario, planos });
}

function respostaCobrancaCriada(resultado = {}, reutilizada = false) {
  const snapshot = objeto(resultado.planSnapshot);
  return {
    ok: true,
    provider: resultado.provider || PROVIDER_MERCADOPAGO,
    externalPaymentId: texto(resultado.externalPaymentId),
    orderId: texto(resultado.orderId),
    status: texto(resultado.status),
    statusDetail: texto(resultado.statusDetail),
    plano: planoSanitizado(snapshot, resultado.planoId),
    valor: {
      amountCents: numeroInteiro(snapshot.amountCents, 0),
      currency: texto(snapshot.currency || "BRL").toUpperCase()
    },
    pix: pixSanitizado(resultado.pix),
    reutilizada: reutilizada === true
  };
}

function respostaCobrancaExistente(payment = {}) {
  const snapshot = planSnapshot(payment);
  const metadata = objeto(payment.metadata);
  return {
    ok: true,
    provider: PROVIDER_MERCADOPAGO,
    externalPaymentId: texto(payment.external_payment_id || payment.externalPaymentId),
    orderId: texto(metadata.mpOrderId),
    status: texto(payment.status),
    statusDetail: "",
    plano: planoSanitizado(snapshot, payment.plano_id || payment.planoId),
    valor: valorSanitizado(payment, snapshot),
    pix: pixSanitizado({}),
    reutilizada: true
  };
}

function criarRotasCheckoutFinanceiro({
  getPlanos = () => ({}),
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env,
  agora = () => new Date(),
  renovarFinanceiroUsuario = null,
  resolverFinanceiroUsuario = null
} = {}) {
  const router = express.Router();

  router.post("/checkout/pix", async (req, res) => {
    try {
      const clienteId = texto(req.clienteId);
      const usuario = req.usuario;
      if (!clienteId || !usuario || usuario.ativo === false) {
        return erroHttp(res, "usuario_nao_autenticado", 401);
      }

      const planoId = texto(req.body?.planoId);
      if (!planoId) return erroHttp(res, "plano_id_obrigatorio", 400);

      return await executarComLockCheckout(`${clienteId}:${planoId}`, async () => {
        const entrada = buscarEntradaPlano(getPlanos(), planoId);
        if (!entrada) return erroHttp(res, "plano_nao_encontrado", 404);

        let snapshot;
        try {
          snapshot = capturarPlanSnapshot(entrada.plano, entrada.chave, agora(), {
            permitirPlanoPagoEmBreveInterno: false
          });
        } catch (e) {
          return erroHttp(res, e.codigo || "plano_invalido_para_cobranca", statusErroPlano(e.codigo));
        }

        const existente = typeof repositorio.buscarPaymentPendenteClientePlano === "function"
          ? await repositorio.buscarPaymentPendenteClientePlano({
            provider: PROVIDER_MERCADOPAGO,
            clienteId,
            planoId: snapshot.planoId,
            janelaMs: CHECKOUT_PIX_PENDING_WINDOW_MS,
            agora: agora()
          })
          : null;

        if (existente) {
          return res.status(200).json(respostaCobrancaExistente(existente));
        }

        const resultado = await criarCobrancaMercadoPagoPix({
          clienteId,
          planoId,
          planos: getPlanos(),
          usuario,
          repositorio,
          client,
          env,
          agora: agora(),
          permitirPlanoPagoEmBreveInterno: false,
          metadata: {
            origemCheckout: "checkout_publico_pix_v1"
          }
        });

        if (!resultado.ok) {
          return erroHttp(res, resultado.codigo || "checkout_pix_falhou", statusErroPlano(resultado.codigo));
        }

        return res.status(201).json(respostaCobrancaCriada(resultado, false));
      });
    } catch (e) {
      return erroHttp(res, e, e.statusCode || e.status || 500);
    }
  });

  router.get("/pagamentos/:externalPaymentId/status", async (req, res) => {
    try {
      const clienteId = texto(req.clienteId);
      const externalPaymentId = texto(req.params.externalPaymentId);
      if (!clienteId || !req.usuario || req.usuario.ativo === false) {
        return erroHttp(res, "usuario_nao_autenticado", 401);
      }
      if (!externalPaymentId) return erroHttp(res, "external_payment_id_obrigatorio", 400);

      const payment = typeof repositorio.buscarPaymentCliente === "function"
        ? await repositorio.buscarPaymentCliente(PROVIDER_MERCADOPAGO, externalPaymentId, clienteId)
        : null;
      if (!payment) return erroHttp(res, "pagamento_nao_encontrado", 404);

      const projection = typeof repositorio.obterProjectionPayment === "function"
        ? await repositorio.obterProjectionPayment(payment.id)
        : null;
      const subscription = typeof repositorio.buscarSubscriptionCliente === "function"
        ? await repositorio.buscarSubscriptionCliente(clienteId)
        : null;

      return res.json(respostaPaymentStatus({ payment, projection, subscription }));
    } catch (e) {
      return erroHttp(res, e.codigo || "status_pagamento_falhou", e.statusCode || e.status || 500);
    }
  });

  router.get("/assinatura", (req, res) => {
    const usuario = req.usuario;
    if (!req.clienteId || !usuario || usuario.ativo === false) {
      return erroHttp(res, "usuario_nao_autenticado", 401);
    }

    if (typeof renovarFinanceiroUsuario === "function") {
      renovarFinanceiroUsuario(usuario);
    }

    return res.json({
      ok: true,
      clienteId: "self",
      plano: texto(usuario.plano),
      planoAssinatura: texto(usuario.planoAssinatura || usuario.plano),
      assinaturaStatus: texto(usuario.assinaturaStatus),
      creditos: numeroInteiro(usuario.creditos, 0),
      cicloAtualInicio: texto(usuario.cicloAtualInicio),
      cicloAtualFim: texto(usuario.cicloAtualFim),
      proximaRenovacao: texto(usuario.proximaRenovacao),
      pagamentoUltimoStatus: texto(usuario.pagamentoUltimoStatus),
      financeiro: financeiroUsuarioSanitizado({
        usuario,
        planos: getPlanos(),
        resolverFinanceiroUsuario
      })
    });
  });

  return router;
}

module.exports = criarRotasCheckoutFinanceiro;
module.exports.CHECKOUT_PIX_PENDING_WINDOW_MS = CHECKOUT_PIX_PENDING_WINDOW_MS;
module.exports.respostaPaymentStatus = respostaPaymentStatus;
