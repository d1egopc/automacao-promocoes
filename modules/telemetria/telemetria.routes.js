"use strict";

const express = require("express");
const {
  autenticarTokenAuditoria,
  criarAuditoriaTemporaria,
  escopoDaRequisicao,
  listarAuditoriasSanitizadas,
  consultarEventosTelemetria,
  consultarRastreioTelemetria,
  consultarSaudeTelemetria,
  revogarAuditoriaTemporaria
} = require("./telemetria.service");

function usuarioAdminMaster(req = {}) {
  return req.usuario?.papel === "admin_master";
}

function erroAdmin(res) {
  return res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
}

function erroPublicoTelemetria(res) {
  return res.status(500).json({ ok: false, erro: "telemetria_indisponivel" });
}

function pareceTokenAuditoria(req = {}) {
  const header = String(req.headers?.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return bearer.startsWith("tel_") || Boolean(req.headers?.["x-telemetria-auditoria"]);
}

function criarMiddlewareTelemetria({ authNormal, isAdminMaster = usuarioAdminMaster } = {}) {
  return function autenticarTelemetria(req, res, next) {
    const auditoria = autenticarTokenAuditoria(req);
    if (auditoria.ok) {
      req.telemetriaAuditoria = auditoria.auditoria;
      return next();
    }

    if (typeof authNormal !== "function") {
      return res.status(401).json({ ok: false, erro: auditoria.motivo || "nao_autorizado" });
    }

    return authNormal(req, res, () => {
      if (!isAdminMaster(req)) return erroAdmin(res);
      return next();
    });
  };
}

function criarMiddlewareAdminTelemetria({ authNormal, isAdminMaster = usuarioAdminMaster } = {}) {
  return function autenticarAdminTelemetria(req, res, next) {
    if (pareceTokenAuditoria(req)) return erroAdmin(res);

    if (typeof authNormal !== "function") {
      return res.status(401).json({ ok: false, erro: "auth_indisponivel" });
    }

    return authNormal(req, res, () => {
      if (!isAdminMaster(req)) return erroAdmin(res);
      return next();
    });
  };
}

function criarRotasTelemetria(opcoes = {}) {
  const router = express.Router();
  const autenticarLeitura = criarMiddlewareTelemetria(opcoes);
  const autenticarAdmin = criarMiddlewareAdminTelemetria(opcoes);

  router.get("/saude", autenticarLeitura, async (req, res) => {
    try {
      const resultado = await consultarSaudeTelemetria({
        janelaMinutos: req.query.janelaMinutos,
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 503).json(resultado);
    } catch (e) {
      return erroPublicoTelemetria(res);
    }
  });

  router.get("/eventos", autenticarLeitura, async (req, res) => {
    try {
      const resultado = await consultarEventosTelemetria({
        janelaMinutos: req.query.janelaMinutos,
        clienteId: req.query.clienteId,
        marketplace: req.query.marketplace,
        etapa: req.query.etapa,
        status: req.query.status,
        limit: req.query.limit,
        cursor: req.query.cursor,
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 503).json(resultado);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        erro: "telemetria_indisponivel",
        items: [],
        cursorProximo: null
      });
    }
  });

  router.get("/rastrear/:eventoId", autenticarLeitura, async (req, res) => {
    try {
      const resultado = await consultarRastreioTelemetria(req.params.eventoId, {
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 400).json(resultado);
    } catch (e) {
      return erroPublicoTelemetria(res);
    }
  });

  router.post("/auditoria/ativar", autenticarAdmin, (req, res) => {
    const resultado = criarAuditoriaTemporaria({
      ttlMinutos: req.body?.ttlMinutos,
      escopo: req.body?.escopo,
      clienteId: req.body?.clienteId,
      criadoPor: req.usuario?.id || req.clienteId || ""
    });
    return res.status(resultado.ok ? 201 : 400).json(resultado);
  });

  router.post("/auditoria/revogar", autenticarAdmin, (req, res) => {
    const resultado = revogarAuditoriaTemporaria({
      auditoriaId: req.body?.auditoriaId
    });
    return res.status(resultado.ok ? 200 : 404).json(resultado);
  });

  router.get("/auditorias", autenticarAdmin, (req, res) => {
    return res.json({ ok: true, auditorias: listarAuditoriasSanitizadas() });
  });

  return router;
}

module.exports = {
  criarRotasTelemetria,
  criarMiddlewareTelemetria,
  criarMiddlewareAdminTelemetria
};
