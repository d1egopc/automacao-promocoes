"use strict";

const express = require("express");
const {
  PROVIDER_SIMULATED,
  criarCobrancaSimulada,
  emitirEventoPagamentoSimulado,
  normalizarTipoEventoSimulado
} = require("./simulado.adapter");
const {
  criarRepositorioFinanceiroPostgres
} = require("./financeiro.repository");
const {
  reconciliarLedgerFinanceiroPendente
} = require("./financeiro.service");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function erroHttp(res, erro, fallback = "financeiro_simulado_falhou") {
  const codigo = erro?.codigo || fallback;
  const status = erro?.statusCode || erro?.status || (
    /nao_encontrado/.test(codigo) ? 404 :
      /obrigatorio|invalido|nao_cobravel|nao_contratavel|sem_/.test(codigo) ? 400 : 500
  );
  return res.status(status).json({
    ok: false,
    codigo,
    erro: status < 500 ? (erro?.message || codigo) : "Falha no financeiro simulado"
  });
}

function criarRotasFinanceiroSimulado({
  getUsuarios = () => [],
  getPlanos = () => ({}),
  salvarUsuarios = () => {},
  isAdminMaster = () => false,
  repositorio = criarRepositorioFinanceiroPostgres()
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (isAdminMaster(req)) return next();
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  });

  router.post("/cobrancas", async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = texto(body.clienteId || body.usuarioId);
      const planoId = texto(body.planoId || body.plano);
      const usuario = getUsuarios().find((u) => texto(u?.id) === clienteId);
      if (!usuario) {
        return res.status(404).json({
          ok: false,
          codigo: "usuario_nao_encontrado",
          erro: "Usuario nao encontrado"
        });
      }

      const resultado = await criarCobrancaSimulada({
        clienteId,
        planoId,
        planos: getPlanos(),
        externalPaymentId: body.externalPaymentId,
        providerEventId: body.providerEventId,
        repositorio,
        agora: body.agora ? new Date(body.agora) : new Date(),
        metadata: {
          operador: req.usuario?.id || req.usuario?.email || "",
          origem: "admin_financeiro_simulado"
        }
      });

      if (!resultado.ok) {
        return res.status(400).json(resultado);
      }

      return res.status(201).json(resultado);
    } catch (erro) {
      return erroHttp(res, erro, "cobranca_simulada_falhou");
    }
  });

  router.post("/pagamentos/:externalPaymentId/eventos", async (req, res) => {
    try {
      const body = req.body || {};
      const type = normalizarTipoEventoSimulado(body.type || body.eventType || body.status || body.estado);
      const resultado = await emitirEventoPagamentoSimulado({
        type,
        externalPaymentId: req.params.externalPaymentId,
        providerEventId: body.providerEventId,
        clienteId: body.clienteId || body.usuarioId,
        planoId: body.planoId,
        repositorio,
        agora: body.agora ? new Date(body.agora) : new Date(),
        metadata: {
          operador: req.usuario?.id || req.usuario?.email || "",
          origem: "admin_financeiro_simulado"
        }
      });

      if (!resultado.ok) {
        return res.status(400).json(resultado);
      }

      const projetar = body.projetar !== false;
      const projecao = projetar
        ? await reconciliarLedgerFinanceiroPendente({
          repositorio,
          lerUsuarios: async () => getUsuarios(),
          salvarUsuarios: async () => salvarUsuarios(),
          limite: 20,
          filtro: {
            provider: PROVIDER_SIMULATED,
            externalPaymentId: resultado.externalPaymentId,
            clienteId: resultado.clienteId
          }
        })
        : { ok: true, pulada: true };

      return res.json({
        ...resultado,
        projecao
      });
    } catch (erro) {
      return erroHttp(res, erro, "evento_simulado_falhou");
    }
  });

  router.post("/reconciliar", async (req, res) => {
    try {
      const body = req.body || {};
      const resultado = await reconciliarLedgerFinanceiroPendente({
        repositorio,
        lerUsuarios: async () => getUsuarios(),
        salvarUsuarios: async () => salvarUsuarios(),
        limite: body.limite || 50,
        filtro: {
          provider: PROVIDER_SIMULATED,
          externalPaymentId: body.externalPaymentId,
          clienteId: body.clienteId || body.usuarioId
        }
      });
      return res.json(resultado);
    } catch (erro) {
      return erroHttp(res, erro, "reconciliacao_simulada_falhou");
    }
  });

  return router;
}

module.exports = criarRotasFinanceiroSimulado;
