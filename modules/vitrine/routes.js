"use strict";

const express = require("express");
const storage = require("./storage");

function statusErro(erro) {
  return erro.statusCode || 500;
}

function payloadErro(erro, fallback = "vitrine_erro") {
  return {
    ok: false,
    erro: erro.message || fallback,
    codigo: erro.message || fallback
  };
}

function clienteAtual(req, deps = {}) {
  if (typeof deps.getClienteId === "function") return deps.getClienteId(req);
  return req.clienteId || req.usuario?.id || "admin";
}

function criarRotasVitrine(deps = {}) {
  const router = express.Router();
  const publico = deps.publico === true;

  if (publico) {
    router.get("/v/:slug", (req, res) => {
      try {
        const vitrine = storage.buscarVitrinePublicaPorSlug(req.params.slug, deps);
        if (!vitrine) {
          return res.status(404).json({ ok: false, erro: "vitrine_nao_encontrada" });
        }

        return res.json({ ok: true, vitrine });
      } catch (erro) {
        const status = erro.statusCode === 400 ? 404 : statusErro(erro);
        return res.status(status).json(payloadErro(erro, "vitrine_nao_encontrada"));
      }
    });

    return router;
  }

  function exigirRecursoVitrine(req, res) {
    const permitido = typeof deps.usuarioTemRecurso === "function"
      ? deps.usuarioTemRecurso(req, "vitrine")
      : req.usuario?.papel === "admin_master";

    if (permitido) return true;

    res.status(403).json({
      ok: false,
      erro: "recurso_nao_disponivel_no_plano",
      codigo: "recurso_nao_disponivel_no_plano",
      recurso: "vitrine"
    });
    return false;
  }

  router.get("/vitrine", (req, res) => {
    if (!exigirRecursoVitrine(req, res)) return;

    try {
      const clienteId = clienteAtual(req, deps);
      const vitrine = storage.lerVitrineWorkspace(clienteId, deps);
      return res.json({
        ok: true,
        config: storage.payloadConfig(vitrine.config || {}),
        totalOfertas: storage.aplicarRetencaoOfertas(vitrine.ofertas || []).length
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.put("/vitrine/config", (req, res) => {
    if (!exigirRecursoVitrine(req, res)) return;

    try {
      const clienteId = clienteAtual(req, deps);
      const { config } = storage.salvarConfigVitrine(clienteId, req.body || {}, deps);
      return res.json({
        ok: true,
        config: storage.payloadConfig(config)
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  return router;
}

module.exports = criarRotasVitrine;
