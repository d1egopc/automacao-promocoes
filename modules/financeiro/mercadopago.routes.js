"use strict";

const crypto = require("crypto");
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

function textoSeguroMercadoPago(valor = "") {
  return texto(valor)
    .replace(/authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;}]+/gi, "authorization:[redacted]")
    .replace(/authorization\s+bearer\s+[^\s,;}]+/gi, "authorization:[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/APP_(?:USR|TEST|PUBLIC)_[A-Za-z0-9._~+/=-]+/gi, "[mp_token]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}

function sanitizarValorMercadoPagoLocal(valor, profundidade = 0) {
  if (profundidade > 6) return "[max_depth]";
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return textoSeguroMercadoPago(valor);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) {
    return valor.slice(0, 20).map((item) => sanitizarValorMercadoPagoLocal(item, profundidade + 1));
  }
  if (typeof valor === "object") {
    const seguro = {};
    for (const [chave, item] of Object.entries(valor)) {
      const chaveNormalizada = texto(chave).toLowerCase();
      if (/authorization|access_token|client_secret|secret|cookie|token/.test(chaveNormalizada)) {
        seguro[chave] = "[redacted]";
        continue;
      }
      seguro[chave] = sanitizarValorMercadoPagoLocal(item, profundidade + 1);
    }
    return seguro;
  }
  return textoSeguroMercadoPago(valor);
}

function lerHeaderSeguroMercadoPago(headers = {}, nome = "") {
  if (!headers || !nome) return "";
  if (typeof headers.get === "function") return texto(headers.get(nome));
  return texto(headers[nome] || headers[nome.toLowerCase()] || headers[nome.toUpperCase()]);
}

function headersSegurosMercadoPago(headers = {}) {
  const seguro = {};
  for (const nome of ["x-request-id", "content-type", "retry-after"]) {
    const valor = lerHeaderSeguroMercadoPago(headers, nome);
    if (valor) seguro[nome] = textoSeguroMercadoPago(valor);
  }
  return seguro;
}

function headersErroSdkMercadoPago(erro = {}) {
  return (
    erro.headers ||
    erro.apiResponse?.headers ||
    erro.apiResponse?.response?.headers ||
    erro.response?.headers ||
    {}
  );
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
  for (const campo of ["message", "error", "code", "cause", "details", "errors"]) {
    if (payload[campo] !== undefined) {
      seguro[campo] = sanitizarValorMercadoPagoLocal(payload[campo]);
    }
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
        const headersSeguros = headersSegurosMercadoPago(headersErroSdkMercadoPago(erroOriginal));
        const detalheMercadoPago = sanitizarErroMercadoPagoLocal(payloadErroSdkMercadoPago(erroOriginal), status);
        if (Object.keys(headersSeguros).length) detalheMercadoPago.headers = headersSeguros;
        if (headersSeguros["x-request-id"]) detalheMercadoPago.xRequestId = headersSeguros["x-request-id"];
        const erro = new Error("mercadopago_api_falhou");
        erro.codigo = "mercadopago_api_falhou";
        erro.status = status;
        erro.detalheMercadoPago = detalheMercadoPago;
        erro.xRequestId = headersSeguros["x-request-id"] || "";
        throw erro;
      }
    }
  };
}

function fingerprintCurto(valor = "") {
  return crypto.createHash("sha256").update(texto(valor)).digest("hex").slice(0, 12);
}

function gerarIdsDiagnosticoOrderMinimo(agora = new Date()) {
  const runId = crypto.randomUUID();
  const uuidCompacto = runId.replace(/-/g, "");
  const timestamp = new Date(agora).toISOString().replace(/\D/g, "").slice(0, 14);
  const externalReference = `mp_diag_${timestamp}_${uuidCompacto.slice(0, 12)}`;
  const idempotencyKey = `mp-diag-${runId}`;
  return {
    runId,
    externalReference,
    idempotencyKey,
    idempotencyKeyLength: idempotencyKey.length,
    idempotencyKeyFingerprint: fingerprintCurto(idempotencyKey)
  };
}

function validarIdempotencyDiagnostico(idempotencyKey = "") {
  const tamanho = texto(idempotencyKey).length;
  return tamanho >= 1 && tamanho <= 64;
}

function classificarEmailPagadorMercadoPago(email = "") {
  const normalizado = texto(email).toLowerCase();
  if (!normalizado || normalizado === "test@testuser.com") return "fallback_test";
  if (normalizado === "test_user_br@testuser.com") return "testuser";
  return "real";
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
    let diagnostico = null;
    try {
      const body = req.body || {};
      const clienteId = texto(body.clienteId);
      const planoId = texto(body.planoId);
      diagnostico = gerarIdsDiagnosticoOrderMinimo();
      const { externalReference, idempotencyKey } = diagnostico;

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

      if (!validarIdempotencyDiagnostico(idempotencyKey)) {
        return res.status(500).json({
          ok: false,
          codigo: "mercadopago_order_minimo_idempotency_invalida",
          externalReference,
          idempotencyKeyLength: diagnostico.idempotencyKeyLength,
          idempotencyKeyFingerprint: diagnostico.idempotencyKeyFingerprint
        });
      }

      const order = await mpClient.criarOrder(orderBody, { idempotencyKey });

      return res.status(201).json({
        ok: true,
        provider: PROVIDER_MERCADOPAGO,
        externalReference,
        idempotencyKeyLength: diagnostico.idempotencyKeyLength,
        idempotencyKeyFingerprint: diagnostico.idempotencyKeyFingerprint,
        amountType: typeof orderBody.transactions.payments[0].amount,
        totalAmountType: typeof orderBody.total_amount,
        payerEmailTipo: classificarEmailPagadorMercadoPago(orderBody.payer.email),
        orderId: texto(order.id || order.order_id || ""),
        status: texto(order.status || ""),
        statusDetail: texto(order.status_detail || order.statusDetail || ""),
        pixPresente: resumoPixSeguro(order)
      });
    } catch (erro) {
      const codigo = erro?.codigo || "mercadopago_order_minimo_diagnostico_falhou";
      const statusSdk = statusErroSdkMercadoPago(erro);
      const status = erro?.statusCode || erro?.status || statusSdk || (
        /nao_configurado/.test(codigo) ? 503 :
          /nao_encontrado/.test(codigo) ? 404 :
            /obrigatorio|invalido|nao_cobravel|nao_contratavel|sem_/.test(codigo) ? 400 : 500
      );
      const headersSeguros = headersSegurosMercadoPago(headersErroSdkMercadoPago(erro));
      const detalheMercadoPago = erro?.detalheMercadoPago || (
        statusSdk ? sanitizarErroMercadoPagoLocal(payloadErroSdkMercadoPago(erro), status) : undefined
      );
      if (detalheMercadoPago && Object.keys(headersSeguros).length && !detalheMercadoPago.headers) {
        detalheMercadoPago.headers = headersSeguros;
      }
      if (detalheMercadoPago && headersSeguros["x-request-id"] && !detalheMercadoPago.xRequestId) {
        detalheMercadoPago.xRequestId = headersSeguros["x-request-id"];
      }
      return res.status(status).json({
        ok: false,
        codigo,
        erro: status < 500 ? (erro?.message || codigo) : "Falha no Mercado Pago",
        statusMercadoPago: detalheMercadoPago ? (Number(erro.status) || Number(detalheMercadoPago.status) || status) : undefined,
        detalheMercadoPago,
        xRequestId: erro?.xRequestId || detalheMercadoPago?.xRequestId || detalheMercadoPago?.headers?.["x-request-id"] || "",
        externalReference: diagnostico?.externalReference || "",
        idempotencyKeyLength: diagnostico?.idempotencyKeyLength || 0,
        idempotencyKeyFingerprint: diagnostico?.idempotencyKeyFingerprint || ""
      });
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
