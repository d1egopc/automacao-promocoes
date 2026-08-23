"use strict";

const crypto = require("crypto");
const {
  criarCobrancaFinanceira,
  processarFinancialPaymentEvent
} = require("./financeiro.service");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");

const PROVIDER_MERCADOPAGO = "mercadopago";
const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";
const MERCADOPAGO_PIX_SANDBOX_AMOUNT_CENTS = 5000;
const MERCADOPAGO_PIX_SANDBOX_PAYER = {
  firstName: "APRO",
  email: "test_user_br@testuser.com"
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
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

function iso(data = new Date()) {
  return new Date(data).toISOString();
}

function normalizarMoeda(valor = "") {
  const moeda = texto(valor).toUpperCase();
  return /^[A-Z]{3}$/.test(moeda) ? moeda : "";
}

function centsParaValor(cents = 0) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
}

function valorParaCents(valor) {
  if (valor === undefined || valor === null || valor === "") return 0;
  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function numeroInteiro(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : padrao;
}

function ambienteMercadoPagoTeste(env = {}) {
  return textoLower(env.MERCADOPAGO_ENV) === "test";
}

function metadataObjeto(valor = {}) {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) {
    try {
      const parsed = JSON.parse(valor);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function resolverProviderAmountCentsMercadoPago({ planSnapshot = {}, sandboxTeste = false } = {}) {
  if (sandboxTeste === true) return MERCADOPAGO_PIX_SANDBOX_AMOUNT_CENTS;
  return numeroInteiro(planSnapshot.amountCents, 0);
}

function sanitizarTextoMercadoPago(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  return bruto
    .replace(/authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;}]+/gi, "authorization:[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt_mascarado]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email_mascarado]")
    .replace(/000201[0-9A-Za-z./:+-]{30,}/g, "[pix_mascarado]")
    .slice(0, 500);
}

function sanitizarCauseMercadoPago(cause) {
  const causas = Array.isArray(cause) ? cause : (cause ? [cause] : []);
  return causas.slice(0, 10).map((item) => {
    if (item && typeof item === "object") {
      return {
        code: sanitizarTextoMercadoPago(item.code || item.error_code || ""),
        description: sanitizarTextoMercadoPago(item.description || item.message || "")
      };
    }
    return {
      code: "",
      description: sanitizarTextoMercadoPago(item)
    };
  }).filter((item) => item.code || item.description);
}

function sanitizarErroMercadoPago(payload = null, status = 0) {
  const origem = payload && typeof payload === "object" ? payload : { message: payload };
  const detalhe = {
    status: Number(status) || Number(origem.status) || 0
  };

  const message = sanitizarTextoMercadoPago(origem.message || origem.mensagem || origem.raw || "");
  const error = sanitizarTextoMercadoPago(origem.error || origem.errorType || "");
  const code = sanitizarTextoMercadoPago(origem.code || origem.error_code || origem.status_code || "");
  const cause = sanitizarCauseMercadoPago(origem.cause || origem.causes);

  if (message) detalhe.message = message;
  if (error) detalhe.error = error;
  if (code) detalhe.code = code;
  if (cause.length) detalhe.cause = cause;
  return detalhe;
}

function mercadoPagoConfig(env = process.env) {
  const accessToken = texto(env.MERCADOPAGO_ACCESS_TOKEN);
  const webhookSecret = texto(env.MERCADOPAGO_WEBHOOK_SECRET);
  const ambiente = textoLower(env.MERCADOPAGO_ENV || "test") || "test";
  return {
    configurado: Boolean(accessToken),
    webhookConfigurado: Boolean(webhookSecret),
    accessToken,
    webhookSecret,
    ambiente
  };
}

function criarExternalPaymentIdMercadoPago(clienteId = "", planoId = "") {
  const cliente = slug(clienteId) || "cliente";
  const plano = slug(planoId) || "plano";
  return `mp_pay_${cliente}_${plano}_${idCurto()}`;
}

function criarProviderEventIdMercadoPago(prefixo = "event", externalPaymentId = "") {
  return `mp_${slug(prefixo) || "event"}_${slug(externalPaymentId) || "payment"}_${idCurto()}`;
}

function idempotencyKeyOrder(externalPaymentId = "") {
  return `mp_order:${texto(externalPaymentId)}`;
}

function extrairPrimeiroPagamento(order = {}) {
  const pagamentos = order?.transactions?.payments;
  return Array.isArray(pagamentos) ? (pagamentos[0] || {}) : {};
}

function extrairStatusOrder(order = {}) {
  const pagamento = extrairPrimeiroPagamento(order);
  const status = textoLower(pagamento.status || order.status);
  const statusDetail = textoLower(pagamento.status_detail || order.status_detail);
  return { status, statusDetail };
}

function extrairAmountCentsOrder(order = {}) {
  const pagamento = extrairPrimeiroPagamento(order);
  return valorParaCents(pagamento.amount ?? order.total_amount ?? order.totalAmount);
}

function extrairMoedaOrder(order = {}) {
  const pagamento = extrairPrimeiroPagamento(order);
  const direta = normalizarMoeda(
    pagamento.currency ||
    pagamento.currency_id ||
    order.currency ||
    order.currency_id ||
    order.currencyId
  );
  if (direta) return direta;
  if (texto(order.country_code || order.countryCode).toUpperCase() === "BRA") return "BRL";
  return "";
}

function extrairExternalReference(order = {}) {
  return texto(order.external_reference || order.externalReference);
}

function extrairQrPix(order = {}) {
  const pagamento = extrairPrimeiroPagamento(order);
  const metodo = pagamento.payment_method || {};
  const point = order.point_of_interaction || {};
  const transactionData = point.transaction_data || {};
  return {
    qrCode: texto(metodo.qr_code || transactionData.qr_code),
    qrCodeBase64: texto(metodo.qr_code_base64 || transactionData.qr_code_base64),
    ticketUrl: texto(metodo.ticket_url || transactionData.ticket_url),
    expiracao: texto(order.expiration_date || order.expires_at || pagamento.expiration_date || pagamento.expires_at)
  };
}

function mapearStatusMercadoPago(order = {}) {
  const { status, statusDetail } = extrairStatusOrder(order);

  if (statusDetail === "partially_refunded" || status === "charged_back") {
    return {
      suportado: false,
      manual: true,
      codigo: status === "charged_back" ? "mercadopago_chargeback_manual" : "mercadopago_partial_refund_manual",
      status,
      statusDetail
    };
  }

  if (status === "created") return { suportado: true, type: "payment.created", status, statusDetail };
  if (status === "processed" && statusDetail === "accredited") {
    return { suportado: true, type: "payment.approved", status, statusDetail };
  }
  if (["action_required", "processing", "pending", "in_review"].includes(status)) {
    return { suportado: true, type: "payment.pending", status, statusDetail };
  }
  if (["failed", "rejected"].includes(status)) {
    return { suportado: true, type: "payment.rejected", status, statusDetail };
  }
  if (["canceled", "cancelled", "expired"].includes(status)) {
    return { suportado: true, type: "payment.cancelled", status, statusDetail };
  }
  if (status === "refunded") return { suportado: true, type: "payment.refunded", status, statusDetail };

  return {
    suportado: false,
    manual: true,
    codigo: "mercadopago_status_nao_mapeado",
    status,
    statusDetail
  };
}

function providerEventIdWebhook({ webhook = {}, order = {}, mapeamento = {} } = {}) {
  const bodyId = texto(webhook.id || webhook.body?.id);
  if (bodyId) return `mp:wh:${bodyId}`;
  const orderId = texto(order.id || webhook.dataId);
  const status = slug(mapeamento.status || order.status);
  const detail = slug(mapeamento.statusDetail || order.status_detail);
  const updated = slug(order.last_updated_date || order.updated_at || webhook.receivedAt || "");
  return `mp:order:${orderId}:${status}:${detail}:${updated}`;
}

function parseSignatureHeader(header = "") {
  const partes = {};
  for (const parte of texto(header).split(",")) {
    const [chave, ...resto] = parte.split("=");
    if (!chave || !resto.length) continue;
    partes[texto(chave)] = texto(resto.join("="));
  }
  return partes;
}

function safeEqualHex(a = "", b = "") {
  const aa = Buffer.from(texto(a), "hex");
  const bb = Buffer.from(texto(b), "hex");
  return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function validarAssinaturaWebhookMercadoPago({
  xSignature = "",
  xRequestId = "",
  dataId = "",
  secret = ""
} = {}) {
  const assinatura = parseSignatureHeader(xSignature);
  const ts = assinatura.ts;
  const hash = assinatura.v1;
  const requestId = texto(xRequestId);
  const id = texto(dataId).toLowerCase();
  const segredo = texto(secret);

  if (!segredo) return { ok: false, codigo: "mercadopago_webhook_secret_ausente" };
  if (!ts || !hash || !requestId || !id) {
    return { ok: false, codigo: "mercadopago_assinatura_incompleta" };
  }

  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const calculada = crypto.createHmac("sha256", segredo).update(manifest).digest("hex");
  if (!safeEqualHex(calculada, hash)) {
    return { ok: false, codigo: "mercadopago_assinatura_invalida" };
  }

  return { ok: true };
}

function criarMercadoPagoHttpClient({
  accessToken = "",
  baseUrl = MERCADOPAGO_API_BASE,
  fetchImpl = globalThis.fetch
} = {}) {
  async function request(path, { method = "GET", body, headers = {} } = {}) {
    if (!texto(accessToken)) {
      const erro = new Error("mercadopago_nao_configurado");
      erro.codigo = "mercadopago_nao_configurado";
      throw erro;
    }
    if (typeof fetchImpl !== "function") {
      const erro = new Error("fetch_indisponivel");
      erro.codigo = "fetch_indisponivel";
      throw erro;
    }

    const resposta = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const textoResposta = await resposta.text();
    let payload = null;
    try {
      payload = textoResposta ? JSON.parse(textoResposta) : null;
    } catch {
      payload = { raw: textoResposta };
    }
    if (!resposta.ok) {
      const detalheMercadoPago = sanitizarErroMercadoPago(payload, resposta.status);
      console.warn("[MERCADOPAGO-API-ERRO-SEGURO]", JSON.stringify({
        status: resposta.status,
        method,
        endpoint: path,
        detalheMercadoPago
      }));
      const erro = new Error("mercadopago_api_falhou");
      erro.codigo = "mercadopago_api_falhou";
      erro.status = resposta.status;
      erro.payload = payload;
      erro.detalheMercadoPago = detalheMercadoPago;
      throw erro;
    }
    return payload || {};
  }

  return {
    criarOrder: (body, { idempotencyKey }) => request("/v1/orders", {
      method: "POST",
      body,
      headers: { "X-Idempotency-Key": idempotencyKey }
    }),
    obterOrder: (orderId) => request(`/v1/orders/${encodeURIComponent(orderId)}`)
  };
}

function montarOrderPix({ payment = {}, planSnapshot = {}, usuario = {}, notificationUrl = "", sandboxTeste = false, providerAmountCents = null } = {}) {
  const amount = centsParaValor(providerAmountCents ?? planSnapshot.amountCents);
  const body = {
    type: "online",
    processing_mode: "automatic",
    total_amount: amount,
    external_reference: payment.externalPaymentId,
    payer: {
      email: texto(usuario.email || usuario.emailUsuario || "test@testuser.com")
    },
    transactions: {
      payments: [
        {
          amount,
          payment_method: {
            id: "pix",
            type: "bank_transfer"
          }
        }
      ]
    }
  };

  if (sandboxTeste === true) {
    body.payer.email = MERCADOPAGO_PIX_SANDBOX_PAYER.email;
    body.payer.first_name = MERCADOPAGO_PIX_SANDBOX_PAYER.firstName;
  }

  if (texto(notificationUrl)) body.notification_url = texto(notificationUrl);
  return body;
}

function metadataProviderMercadoPago({ metadata = {}, planSnapshot = {}, sandboxTeste = false, providerAmountCents = 0 } = {}) {
  const base = {
    ...metadata,
    adapter: "mercadopago_pix_v1"
  };
  if (sandboxTeste !== true) return base;
  return {
    ...base,
    mercadopagoEnv: "test",
    pixSandboxPredefined: true,
    sandboxTestAmountCents: MERCADOPAGO_PIX_SANDBOX_AMOUNT_CENTS,
    providerAmountCents,
    commercialAmountCents: numeroInteiro(planSnapshot.amountCents, 0)
  };
}

async function persistirMetadataPaymentMercadoPago({ repositorio, payment = {}, metadata = {} } = {}) {
  const paymentId = texto(payment.id);
  if (!paymentId || typeof repositorio?.transacao !== "function") {
    return { ...payment, metadata };
  }
  return repositorio.transacao(async (tx) => {
    if (typeof tx.atualizarPayment !== "function") return { ...payment, metadata };
    const atualizado = await tx.atualizarPayment(paymentId, { metadata });
    return atualizado || { ...payment, metadata };
  });
}

async function criarCobrancaMercadoPagoPix({
  clienteId = "",
  planoId = "",
  planos = {},
  usuario = {},
  externalPaymentId = "",
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env,
  agora = new Date(),
  metadata = {}
} = {}) {
  const config = mercadoPagoConfig(env);
  const sandboxTeste = ambienteMercadoPagoTeste(env);
  if (!config.configurado && !client) {
    return { ok: false, codigo: "mercadopago_nao_configurado", status: "nao_configurado" };
  }

  const ext = texto(externalPaymentId) || criarExternalPaymentIdMercadoPago(clienteId, planoId);
  const cobranca = await criarCobrancaFinanceira({
    clienteId,
    planoId,
    planos,
    provider: PROVIDER_MERCADOPAGO,
    externalPaymentId: ext,
    repositorio,
    agora,
    permitirPlanoPagoEmBreveInterno: true,
    metadata: {
      ...metadata,
      adapter: "mercadopago_pix_v1"
    }
  });

  if (!cobranca.ok) return cobranca;

  const payment = {
    ...cobranca.payment,
    externalPaymentId: ext
  };
  const planSnapshot = cobranca.planSnapshot;
  const providerAmountCents = resolverProviderAmountCentsMercadoPago({ planSnapshot, sandboxTeste });
  const metadataPayment = metadataProviderMercadoPago({
    metadata: metadataObjeto(cobranca.payment?.metadata),
    planSnapshot,
    sandboxTeste,
    providerAmountCents
  });
  const paymentAtualizado = await persistirMetadataPaymentMercadoPago({
    repositorio,
    payment: cobranca.payment,
    metadata: metadataPayment
  });
  payment.metadata = metadataPayment;
  if (paymentAtualizado && typeof paymentAtualizado === "object") {
    payment.id = paymentAtualizado.id || payment.id;
  }
  const mpClient = client || criarMercadoPagoHttpClient({ accessToken: config.accessToken });
  const orderBody = montarOrderPix({
    payment,
    planSnapshot,
    usuario,
    notificationUrl: env.MERCADOPAGO_WEBHOOK_URL,
    sandboxTeste,
    providerAmountCents
  });
  const idempotencyKey = idempotencyKeyOrder(ext);
  const order = await mpClient.criarOrder(orderBody, { idempotencyKey });

  const eventoCreated = await processarFinancialPaymentEvent({
    type: "payment.created",
    provider: PROVIDER_MERCADOPAGO,
    providerEventId: `mp:created:${ext}`,
    externalPaymentId: ext,
    clienteId,
    planoId: planSnapshot.planoId,
    amountCents: planSnapshot.amountCents,
    currency: planSnapshot.currency,
    receivedAt: agora,
    metadata: {
      adapter: "mercadopago_pix_v1",
      mpOrderId: order.id || "",
      idempotencyKey,
      providerAmountCents,
      commercialAmountCents: planSnapshot.amountCents
    }
  }, { repositorio, agora });

  const qr = extrairQrPix(order);
  return {
    ok: true,
    provider: PROVIDER_MERCADOPAGO,
    externalPaymentId: ext,
    orderId: order.id || "",
    status: order.status || "",
    statusDetail: order.status_detail || "",
    idempotencyKey,
    pix: qr,
    planSnapshot,
    payment,
    evento: eventoCreated
  };
}

async function processarWebhookMercadoPago({
  headers = {},
  query = {},
  body = {},
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
  env = process.env,
  agora = new Date()
} = {}) {
  const config = mercadoPagoConfig(env);
  const dataId = texto(query["data.id"] || query.data_id || body?.data?.id || body?.resource);
  const assinatura = validarAssinaturaWebhookMercadoPago({
    xSignature: headers["x-signature"] || headers["X-Signature"],
    xRequestId: headers["x-request-id"] || headers["X-Request-Id"],
    dataId,
    secret: config.webhookSecret
  });

  if (!assinatura.ok) return { ok: false, statusHttp: 401, codigo: assinatura.codigo };
  if (!dataId) return { ok: false, statusHttp: 400, codigo: "mercadopago_data_id_obrigatorio" };
  if (!config.configurado && !client) {
    return { ok: false, statusHttp: 503, codigo: "mercadopago_nao_configurado" };
  }

  const mpClient = client || criarMercadoPagoHttpClient({ accessToken: config.accessToken });
  const order = await mpClient.obterOrder(dataId);
  const externalReference = extrairExternalReference(order);
  if (!externalReference) {
    return { ok: true, manual: true, codigo: "mercadopago_external_reference_ausente", orderId: dataId };
  }

  const payment = await repositorio.buscarPayment(PROVIDER_MERCADOPAGO, externalReference);
  if (!payment) {
    return { ok: true, manual: true, codigo: "mercadopago_payment_nao_encontrado", externalPaymentId: externalReference };
  }

  const amountCentsOrder = extrairAmountCentsOrder(order);
  const currencyOrder = extrairMoedaOrder(order);
  const amountCentsPayment = Number(payment.amount_cents ?? payment.amountCents);
  const currencyPayment = normalizarMoeda(payment.currency);
  const metadataPayment = metadataObjeto(payment.metadata);
  const usarValorProviderSandbox = ambienteMercadoPagoTeste(env) &&
    metadataPayment.pixSandboxPredefined === true &&
    numeroInteiro(metadataPayment.providerAmountCents, 0) > 0;
  const amountCentsEsperado = usarValorProviderSandbox
    ? numeroInteiro(metadataPayment.providerAmountCents, amountCentsPayment)
    : amountCentsPayment;

  if (amountCentsOrder !== amountCentsEsperado) {
    return {
      ok: true,
      manual: true,
      codigo: "mercadopago_valor_divergente",
      externalPaymentId: externalReference,
      esperado: amountCentsEsperado,
      recebido: amountCentsOrder
    };
  }
  if (!currencyOrder || currencyOrder !== currencyPayment) {
    return {
      ok: true,
      manual: true,
      codigo: "mercadopago_moeda_divergente",
      externalPaymentId: externalReference,
      esperado: currencyPayment,
      recebido: currencyOrder
    };
  }

  const mapeamento = mapearStatusMercadoPago(order);
  if (!mapeamento.suportado) {
    return {
      ok: true,
      manual: true,
      codigo: mapeamento.codigo,
      externalPaymentId: externalReference,
      status: mapeamento.status,
      statusDetail: mapeamento.statusDetail
    };
  }

  const providerEventId = providerEventIdWebhook({
    webhook: { id: body.id, body, dataId, receivedAt: iso(agora) },
    order,
    mapeamento
  });
  const resultado = await processarFinancialPaymentEvent({
    type: mapeamento.type,
    provider: PROVIDER_MERCADOPAGO,
    providerEventId,
    externalPaymentId: externalReference,
    clienteId: payment.cliente_id || payment.clienteId,
    planoId: payment.plano_id || payment.planoId,
    amountCents: amountCentsOrder,
    currency: currencyOrder,
    occurredAt: body.date_created || order.last_updated_date || null,
    receivedAt: agora,
    metadata: {
      adapter: "mercadopago_pix_v1",
      mpOrderId: order.id || dataId,
      mpStatus: mapeamento.status,
      mpStatusDetail: mapeamento.statusDetail,
      providerAmountCents: amountCentsOrder,
      commercialAmountCents: amountCentsPayment,
      webhookId: body.id || "",
      webhookAction: body.action || ""
    }
  }, { repositorio, agora });

  return {
    ok: true,
    provider: PROVIDER_MERCADOPAGO,
    externalPaymentId: externalReference,
    providerEventId,
    orderId: order.id || dataId,
    type: mapeamento.type,
    status: mapeamento.status,
    statusDetail: mapeamento.statusDetail,
    clienteId: payment.cliente_id || payment.clienteId,
    resultado
  };
}

module.exports = {
  PROVIDER_MERCADOPAGO,
  criarCobrancaMercadoPagoPix,
  criarExternalPaymentIdMercadoPago,
  criarMercadoPagoHttpClient,
  idempotencyKeyOrder,
  mapearStatusMercadoPago,
  mercadoPagoConfig,
  montarOrderPix,
  processarWebhookMercadoPago,
  sanitizarErroMercadoPago,
  validarAssinaturaWebhookMercadoPago
};
