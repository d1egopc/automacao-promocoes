"use strict";

const express = require("express");
const {
  PROVIDER_MERCADOPAGO,
  criarCobrancaMercadoPagoPix,
  mercadoPagoConfig,
  processarWebhookMercadoPago
} = require("./mercadopago.adapter");
const { criarRepositorioFinanceiroPostgres } = require("./financeiro.repository");
const { reconciliarLedgerFinanceiroPendente } = require("./financeiro.service");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function erroHttp(res, erro, fallback = "mercadopago_falhou") {
  const codigo = erro?.codigo || fallback;
  const status = erro?.statusCode || erro?.status || (
    /nao_configurado/.test(codigo) ? 503 :
      /nao_encontrado/.test(codigo) ? 404 :
        /obrigatorio|invalido|nao_cobravel|nao_contratavel|sem_/.test(codigo) ? 400 : 500
  );
  return res.status(status).json({
    ok: false,
    codigo,
    erro: status < 500 ? (erro?.message || codigo) : "Falha no Mercado Pago"
  });
}

function criarRotasFinanceiroMercadoPago({
  getUsuarios = () => [],
  getPlanos = () => ({}),
  isAdminMaster = () => false,
  repositorio = criarRepositorioFinanceiroPostgres(),
  client = null,
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
  criarRotasFinanceiroMercadoPago,
  criarWebhookMercadoPago
};
