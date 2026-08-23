"use strict";

const express = require("express");
const {
  PROVIDER_MERCADOPAGO,
  criarCobrancaMercadoPagoPix,
  mercadoPagoConfig,
  processarWebhookMercadoPago,
  reconciliarOrdersMercadoPagoPendentes
} = require("./mercadopago.adapter");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");
const { reconciliarLedgerFinanceiroPendente } = require("./financeiro.service");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function resumoPixSeguro(order = {}) {
  const payments = order?.transactions?.payments;
  const primeiroPagamento = Array.isArray(payments) ? payments[0] : null;
  const metodo = primeiroPagamento?.payment_method || {};
  return {
    qrCode: Boolean(metodo.qr_code || metodo.qrCode || primeiroPagamento?.qr_code || primeiroPagamento?.qrCode),
    copiaECola: Boolean(metodo.qr_code || metodo.qrCode || primeiroPagamento?.qr_code || primeiroPagamento?.qrCode),
    ticketUrl: Boolean(metodo.ticket_url || metodo.ticketUrl || primeiroPagamento?.ticket_url || primeiroPagamento?.ticketUrl)
  };
}

function statusErroSdkMercadoPago(erro = {}) {
  return Number(
    erro.status ||
    erro.statusCode ||
    erro.httpStatus ||
    erro.apiResponse?.status ||
    erro.apiResponse?.statusCode ||
    erro.response?.status ||
    0
  ) || 0;
}

function payloadErroSdkMercadoPago(erro = {}) {
  const candidatos = [
    erro.payload,
    erro.apiResponse?.content,
    erro.apiResponse?.data,
    erro.response?.data,
    erro.response?.body,
    erro.cause,
    erro
  ];
  for (const candidato of candidatos) {
    if (candidato && typeof candidato === "object") return candidato;
  }
  return { message: texto(erro.message || "mercadopago_api_falhou") };
}

function sanitizarErroMercadoPagoLocal(payload = {}, status = 0) {
  const seguro = {
    status: Number(status) || Number(payload.status) || 0
  };
  for (const campo of ["message", "error", "code"]) {
    if (payload[campo]) seguro[campo] = texto(payload[campo]).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  }
  if (Array.isArray(payload.cause)) {
    seguro.cause = payload.cause.map((item) => ({
      code: texto(item?.code),
      description: texto(item?.description).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    }));
  }
  return seguro;
}

function criarMercadoPagoSdkOrderClientLocal({ accessToken = "" } = {}) {
  if (!texto(accessToken)) {
    const erro = new Error("mercadopago_nao_configurado");
    erro.codigo = "mercadopago_nao_configurado";
    throw erro;
  }

  let MercadoPagoConfig = null;
  let MercadoPagoOrder = null;
  try {
    ({ MercadoPagoConfig, Order: MercadoPagoOrder } = require("mercadopago"));
  } catch {
    const erro = new Error("mercadopago_sdk_indisponivel");
    erro.codigo = "mercadopago_sdk_indisponivel";
    throw erro;
  }

  const sdkClient = new MercadoPagoConfig({ accessToken });
  const orderClient = new MercadoPagoOrder(sdkClient);
  return {
    async criarOrder(body, { idempotencyKey } = {}) {
      try {
        return await orderClient.create({
          body,
          requestOptions: { idempotencyKey }
        });
      } catch (erroOriginal) {
        const status = statusErroSdkMercadoPago(erroOriginal);
        const detalheMercadoPago = sanitizarErroMercadoPagoLocal(payloadErroSdkMercadoPago(erroOriginal), status);
        const erro = new Error("mercadopago_api_falhou");
        erro.codigo = "mercadopago_api_falhou";
        erro.status = status;
        erro.detalheMercadoPago = detalheMercadoPago;
        throw erro;
      }
    }
  };
}

function erroHttp(res, erro, fallback = "mercadopago_falhou") {
  const codigo = erro?.codigo || fallback;
  const status = erro?.statusCode || erro?.status || (
    /nao_configurado/.test(codigo) ? 503 :
      /nao_encontrado/.test(codigo) ? 404 :
        /obrigatorio|invalido|nao_cobravel|nao_contratavel|sem_/.test(codigo) ? 400 : 500
  );
  const resposta = {
    ok: false,
    codigo,
    erro: status < 500 ? (erro?.message || codigo) : "Falha no Mercado Pago"
  };
  if (codigo === "mercadopago_api_falhou" && erro?.detalheMercadoPago) {
    resposta.statusMercadoPago = Number(erro.status) || Number(erro.detalheMercadoPago.status) || status;
    resposta.detalheMercadoPago = erro.detalheMercadoPago;
  }
  return res.status(status).json(resposta);
}

async function executarReconciliacaoOrdersMercadoPago({
  getUsuarios = () => [],
  salvarUsuarios = () => {},
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env,
  limite = 10,
  agora = new Date()
} = {}) {
  const resultado = await reconciliarOrdersMercadoPagoPendentes({
    repositorio,
    client,
    env,
    limite,
    agora
  });

  let projecao = { ok: true, pulada: true };
  if (resultado.aprovados > 0) {
    projecao = await reconciliarLedgerFinanceiroPendente({
      repositorio,
      lerUsuarios: async () => getUsuarios(),
      salvarUsuarios: async () => salvarUsuarios(),
      limite: 20,
      filtro: {
        provider: PROVIDER_MERCADOPAGO
      }
    });
  }

  return {
    ...resultado,
    projecao
  };
}

function iniciarSchedulerReconciliacaoMercadoPago({
  getUsuarios = () => [],
  salvarUsuarios = () => {},
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env,
  intervaloMs = Number(env.MERCADOPAGO_RECONCILIATION_INTERVAL_MS || 60000),
  limite = Number(env.MERCADOPAGO_RECONCILIATION_BATCH || 10)
} = {}) {
  const config = mercadoPagoConfig(env);
  if (env.MERCADOPAGO_RECONCILIATION_SCHEDULER === "false" || !config.configurado) {
    return null;
  }

  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const resultado = await executarReconciliacaoOrdersMercadoPago({
        getUsuarios,
        salvarUsuarios,
        repositorio,
        client,
        env,
        limite
      });
      if (resultado.processados || resultado.manuais || resultado.falhas || resultado.expirados) {
        console.log("[MERCADOPAGO-RECONCILIACAO-SCHEDULER]", JSON.stringify({
          processados: resultado.processados,
          aprovados: resultado.aprovados,
          manuais: resultado.manuais,
          falhas: resultado.falhas,
          expirados: resultado.expirados,
          projecao: resultado.projecao?.ok === true
        }));
      }
    } catch (erro) {
      console.log("[MERCADOPAGO-RECONCILIACAO-SCHEDULER-ERRO]", {
        codigo: erro.codigo || "mercadopago_reconciliacao_scheduler_falhou"
      });
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(tick, Math.max(30000, Number(intervaloMs) || 60000));
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

function criarRotasFinanceiroMercadoPago({
  getUsuarios = () => [],
  getPlanos = () => ({}),
  salvarUsuarios = () => {},
  isAdminMaster = () => false,
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  sdkOrderClientFactory = criarMercadoPagoSdkOrderClientLocal,
  env = process.env
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (isAdminMaster(req)) return next();
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  });

  router.get("/status", (req, res) => {
    const config = mercadoPagoConfig(env);
    return res.json({
      ok: true,
      provider: PROVIDER_MERCADOPAGO,
      status: config.configurado ? "configurado" : "nao_configurado",
      webhook: config.webhookConfigurado ? "configurado" : "nao_configurado",
      ambiente: config.ambiente
    });
  });

  router.post("/pix/cobrancas", async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = texto(body.clienteId || body.usuarioId);
      const planoId = texto(body.planoId || body.plano);

      if (!clienteId || !planoId) {
        return res.status(400).json({
          ok: false,
          codigo: !clienteId ? "cliente_id_obrigatorio" : "plano_id_obrigatorio"
        });
      }

      const usuario = getUsuarios().find((u) => texto(u?.id || u?.clienteId || u?.usuarioId) === clienteId);
      if (!usuario) {
        return res.status(404).json({
          ok: false,
          codigo: "usuario_nao_encontrado",
          erro: "Usuario nao encontrado"
        });
      }

      const resultado = await criarCobrancaMercadoPagoPix({
        clienteId,
        planoId,
        planos: getPlanos(),
        usuario,
        repositorio,
        client,
        env,
        permitirPlanoPagoEmBreveInterno: true,
        metadata: {
          operador: req.usuario?.id || req.usuario?.email || "",
          origem: "admin_financeiro_mercadopago_pix"
        }
      });

      if (!resultado.ok) {
        return res.status(/nao_configurado/.test(resultado.codigo || "") ? 503 : 400).json(resultado);
      }

      return res.status(201).json({
        ok: true,
        provider: resultado.provider,
        externalPaymentId: resultado.externalPaymentId,
        orderId: resultado.orderId,
        status: resultado.status,
        statusDetail: resultado.statusDetail,
        pix: resultado.pix,
        planSnapshot: resultado.planSnapshot
      });
    } catch (erro) {
      return erroHttp(res, erro, "mercadopago_pix_cobranca_falhou");
    }
  });

  router.post("/pix/cobrancas-sdk-diagnostico", async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = texto(body.clienteId);
      const planoId = texto(body.planoId);
      const externalPaymentId = "mp_pay_user_4ap7aetj_pro_sdk_order_diagnostico_v1";

      if (clienteId !== "user_4ap7aetj" || planoId !== "pro") {
        return res.status(400).json({
          ok: false,
          codigo: "mercadopago_sdk_diagnostico_escopo_invalido"
        });
      }

      const existente = typeof repositorio.buscarPayment === "function"
        ? await repositorio.buscarPayment(PROVIDER_MERCADOPAGO, externalPaymentId)
        : null;
      if (existente) {
        return res.status(409).json({
          ok: false,
          codigo: "mercadopago_sdk_diagnostico_ja_executado",
          externalPaymentId,
          orderId: texto(existente.metadata?.mpOrderId || ""),
          status: existente.status || ""
        });
      }

      const usuario = getUsuarios().find((u) => texto(u?.id || u?.clienteId || u?.usuarioId) === clienteId);
      if (!usuario) {
        return res.status(404).json({
          ok: false,
          codigo: "usuario_nao_encontrado",
          erro: "Usuario nao encontrado"
        });
      }

      const config = mercadoPagoConfig(env);
      const sdkClient = sdkOrderClientFactory({ accessToken: config.accessToken });
      const resultado = await criarCobrancaMercadoPagoPix({
        clienteId,
        planoId,
        planos: getPlanos(),
        usuario,
        externalPaymentId,
        repositorio,
        client: sdkClient,
        env,
        permitirPlanoPagoEmBreveInterno: false,
        metadata: {
          operador: req.usuario?.id || req.usuario?.email || "",
          origem: "admin_financeiro_mercadopago_sdk_order_diagnostico"
        }
      });

      if (!resultado.ok) {
        return res.status(/nao_configurado/.test(resultado.codigo || "") ? 503 : 400).json(resultado);
      }

      return res.status(201).json({
        ok: true,
        provider: resultado.provider,
        externalPaymentId: resultado.externalPaymentId,
        orderId: resultado.orderId,
        status: resultado.status,
        statusDetail: resultado.statusDetail,
        pixPresente: {
          qrCode: !!resultado.pix?.qrCode,
          copiaECola: !!resultado.pix?.copiaECola,
          ticketUrl: !!resultado.pix?.ticketUrl
        },
        planSnapshot: resultado.planSnapshot
      });
    } catch (erro) {
      return erroHttp(res, erro, "mercadopago_sdk_diagnostico_falhou");
    }
  });

  router.post("/pix/orders-minimo-producao-diagnostico", async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = texto(body.clienteId);
      const planoId = texto(body.planoId);
      const externalReference = "mp_order_min_user_4ap7aetj_pro_suporte_minimo_v1";
      const idempotencyKey = "mp-order-min-user-4ap7aetj-pro-suporte-minimo-v1";

      if (clienteId !== "user_4ap7aetj" || planoId !== "pro") {
        return res.status(400).json({
          ok: false,
          codigo: "mercadopago_order_minimo_escopo_invalido"
        });
      }

      const usuario = getUsuarios().find((u) => texto(u?.id || u?.clienteId || u?.usuarioId) === clienteId);
      if (!usuario) {
        return res.status(404).json({
          ok: false,
          codigo: "usuario_nao_encontrado",
          erro: "Usuario nao encontrado"
        });
      }

      const config = mercadoPagoConfig(env);
      if (!config.configurado && !client) {
        return res.status(503).json({
          ok: false,
          codigo: "mercadopago_nao_configurado"
        });
      }

      const mpClient = client || sdkOrderClientFactory({ accessToken: config.accessToken });
      const orderBody = {
        type: "online",
        processing_mode: "automatic",
        total_amount: 2.00,
        external_reference: externalReference,
        payer: {
          email: texto(usuario.email || usuario.emailUsuario)
        },
        transactions: {
          payments: [
            {
              amount: 2.00,
              payment_method: {
                id: "pix",
                type: "bank_transfer"
              }
            }
          ]
        }
      };

      const order = await mpClient.criarOrder(orderBody, { idempotencyKey });

      return res.status(201).json({
        ok: true,
        provider: PROVIDER_MERCADOPAGO,
        externalReference,
        orderId: texto(order.id || order.order_id || ""),
        status: texto(order.status || ""),
        statusDetail: texto(order.status_detail || order.statusDetail || ""),
        pixPresente: resumoPixSeguro(order)
      });
    } catch (erro) {
      return erroHttp(res, erro, "mercadopago_order_minimo_diagnostico_falhou");
    }
  });

  router.post("/reconciliar-orders", async (req, res) => {
    try {
      const resultado = await executarReconciliacaoOrdersMercadoPago({
        getUsuarios,
        salvarUsuarios,
        repositorio,
        client,
        env,
        limite: req.body?.limite || 10
      });
      return res.json(resultado);
    } catch (erro) {
      return erroHttp(res, erro, "mercadopago_reconciliacao_orders_falhou");
    }
  });

  return router;
}

function criarWebhookMercadoPago({
  getUsuarios = () => [],
  salvarUsuarios = () => {},
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env
} = {}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      const resultado = await processarWebhookMercadoPago({
        headers: req.headers || {},
        query: req.query || {},
        body: req.body || {},
        repositorio,
        client,
        env
      });

      if (!resultado.ok) {
        return res.status(resultado.statusHttp || 400).json(resultado);
      }

      let projecao = { ok: true, pulada: true };
      if (resultado.type === "payment.approved" || resultado.type === "payment.refunded") {
        projecao = await reconciliarLedgerFinanceiroPendente({
          repositorio,
          lerUsuarios: async () => getUsuarios(),
          salvarUsuarios: async () => salvarUsuarios(),
          limite: 20,
          filtro: {
            provider: PROVIDER_MERCADOPAGO,
            externalPaymentId: resultado.externalPaymentId,
            clienteId: resultado.clienteId
          }
        });
      }

      return res.status(200).json({
        ...resultado,
        projecao
      });
    } catch (erro) {
      return erroHttp(res, erro, "mercadopago_webhook_falhou");
    }
  });

  return router;
}

module.exports = {
  executarReconciliacaoOrdersMercadoPago,
  criarRotasFinanceiroMercadoPago,
  criarWebhookMercadoPago,
  iniciarSchedulerReconciliacaoMercadoPago
};
