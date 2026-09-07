"use strict";

const express = require("express");
const {
  criarServicoIdentidadeVisualOfertas
} = require("./service");

function statusErro(erro) {
  return erro.statusCode || 500;
}

function payloadErro(erro) {
  return {
    ok: false,
    erro: erro.codigo || erro.message || "identidade_visual_ofertas_erro",
    codigo: erro.codigo || erro.message || "identidade_visual_ofertas_erro"
  };
}

function criarRotasIdentidadeVisualOfertas(deps = {}) {
  const router = express.Router();
  const service = deps.service || criarServicoIdentidadeVisualOfertas(deps);
  const getClienteId = typeof deps.getClienteId === "function" ? deps.getClienteId : () => "admin";
  const getPlanoUsuario = typeof deps.getPlanoUsuario === "function" ? deps.getPlanoUsuario : () => ({});

  function cliente(req) {
    return getClienteId(req) || req.clienteId || req.usuario?.id || "admin";
  }

  function opcoes(req) {
    return {
      plano: getPlanoUsuario(req) || {}
    };
  }

  router.get("/config", (req, res) => {
    try {
      return res.json({
        ok: true,
        ...service.resolverConfig(cliente(req), opcoes(req))
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.patch("/config", (req, res) => {
    try {
      return res.json({
        ok: true,
        ...service.atualizarConfig(cliente(req), req.body?.config || req.body || {}, opcoes(req))
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.post("/config", (req, res) => {
    try {
      return res.json({
        ok: true,
        ...service.atualizarConfig(cliente(req), req.body?.config || req.body || {}, opcoes(req))
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  return router;
}

module.exports = criarRotasIdentidadeVisualOfertas;
