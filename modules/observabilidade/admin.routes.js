"use strict";

const express = require("express");
const service = require("./admin.service");

function usuarioAdminMaster(req = {}) {
  return req.usuario?.papel === "admin_master";
}

function erroAdmin(res) {
  return res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
}

function criarMiddlewareAdmin({ authNormal, isAdminMaster = usuarioAdminMaster } = {}) {
  return function exigirAdminObservabilidade(req, res, next) {
    const finalizar = () => {
      if (!isAdminMaster(req)) return erroAdmin(res);
      return next();
    };

    if (req.usuario || typeof authNormal !== "function") return finalizar();
    return authNormal(req, res, finalizar);
  };
}

function depsConsulta(opcoes = {}) {
  return {
    query: opcoes.query,
    usuarios: typeof opcoes.getUsuarios === "function" ? opcoes.getUsuarios() : [],
    configsPorCliente: typeof opcoes.getConfigsPorCliente === "function" ? opcoes.getConfigsPorCliente() : {},
    integracoesPorCliente: typeof opcoes.getIntegracoesPorCliente === "function" ? opcoes.getIntegracoesPorCliente() : {}
  };
}

function erroObservabilidade(res, erro) {
  return res.status(500).json({
    ok: false,
    erro: "observabilidade_indisponivel",
    motivo: erro?.message ? String(erro.message).slice(0, 160) : "erro_interno"
  });
}

function criarRotasObservabilidadeAdmin(opcoes = {}) {
  const router = express.Router();
  const autenticarAdmin = criarMiddlewareAdmin(opcoes);

  router.get("/workspaces", autenticarAdmin, async (req, res) => {
    try {
      const resultado = await service.buscarWorkspacesObservabilidade({
        ...depsConsulta(opcoes),
        busca: req.query.busca,
        status: req.query.status,
        limit: req.query.limit,
        janelaMinutos: req.query.janelaMinutos
      });
      return res.json(resultado);
    } catch (e) {
      return erroObservabilidade(res, e);
    }
  });

  router.get("/workspaces/:clienteId/resumo", autenticarAdmin, async (req, res) => {
    try {
      const resultado = await service.consultarResumoWorkspaceObservabilidade(req.params.clienteId, {
        ...depsConsulta(opcoes),
        janelaMinutos: req.query.janelaMinutos
      });
      return res.status(resultado.ok ? 200 : 404).json(resultado);
    } catch (e) {
      return erroObservabilidade(res, e);
    }
  });

  router.get("/workspaces/:clienteId/eventos", autenticarAdmin, async (req, res) => {
    try {
      const workspace = (depsConsulta(opcoes).usuarios || []).some(usuario =>
        String(usuario?.id || usuario?.clienteId || usuario?.workspaceId || "") === String(req.params.clienteId || "")
      );
      if (!workspace) return res.status(404).json({ ok: false, erro: "workspace_nao_encontrado" });

      const resultado = await service.consultarEventosWorkspaceObservabilidade(req.params.clienteId, {
        query: opcoes.query,
        janelaMinutos: req.query.janelaMinutos,
        marketplace: req.query.marketplace,
        tipoEvento: req.query.tipoEvento,
        motivoCodigo: req.query.motivoCodigo,
        eventoId: req.query.eventoId,
        jobId: req.query.jobId,
        ofertaId: req.query.ofertaId,
        destinoId: req.query.destinoId,
        limit: req.query.limit,
        cursor: req.query.cursor
      });
      return res.status(resultado.ok ? 200 : 503).json(resultado);
    } catch (e) {
      return erroObservabilidade(res, e);
    }
  });

  router.get("/problemas", autenticarAdmin, async (req, res) => {
    try {
      const resultado = await service.consultarProblemasObservabilidade({
        query: opcoes.query,
        janelaMinutos: req.query.janelaMinutos,
        clienteId: req.query.clienteId,
        marketplace: req.query.marketplace,
        motivoCodigo: req.query.motivoCodigo,
        limit: req.query.limit
      });
      return res.status(resultado.ok ? 200 : 503).json(resultado);
    } catch (e) {
      return erroObservabilidade(res, e);
    }
  });

  router.get("/rastrear/:eventoId", autenticarAdmin, async (req, res) => {
    try {
      const resultado = await service.rastrearEventoObservabilidade(req.params.eventoId);
      return res.status(resultado.ok ? 200 : 400).json(resultado);
    } catch (e) {
      return erroObservabilidade(res, e);
    }
  });

  return router;
}

module.exports = {
  criarRotasObservabilidadeAdmin,
  criarMiddlewareAdmin
};
