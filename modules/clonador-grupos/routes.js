"use strict";

const express = require("express");
const { criarRepositorioClonadorGrupos } = require("./repository");
const { criarServicoClonadorGrupos } = require("./service");

function statusErro(erro) {
  return erro.statusCode || 500;
}

function payloadErro(erro, fallback = "clonador_grupos_erro") {
  return {
    ok: false,
    erro: erro.codigo || erro.message || fallback,
    codigo: erro.codigo || erro.message || fallback,
    ...(erro.detalhes && typeof erro.detalhes === "object" ? erro.detalhes : {})
  };
}

function criarRotasClonadorGrupos(deps = {}) {
  const router = express.Router();
  const repository = deps.repository || criarRepositorioClonadorGrupos(deps);
  const service = deps.service || criarServicoClonadorGrupos({ ...deps, repository });

  const responder = (handler) => async (req, res) => {
    try {
      const resultado = await handler(req);
      return res.json(resultado);
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  };

  router.get("/config", responder((req) => service.obterConfig(req)));
  router.put("/config", responder((req) => service.salvarConfig(req, req.body || {})));
  router.patch("/config", responder((req) => service.salvarConfig(req, req.body || {})));

  router.get("/grupos", responder((req) => service.obterGruposDisponiveis(req, req.query?.sessaoId || "")));

  router.get("/fontes", responder((req) => service.listarFontes(req)));
  router.put("/fontes", responder((req) => service.salvarFontes(req, req.body || {})));

  router.get("/destinos", responder((req) => service.listarDestinosElegiveis(req)));
  router.get("/destinos/selecionados", responder((req) => service.listarDestinosSelecionados(req)));
  router.put("/destinos", responder((req) => service.salvarDestinos(req, req.body || {})));

  router.get("/buffer", responder((req) => service.listarBuffer(req, req.query || {})));

  return router;
}

module.exports = criarRotasClonadorGrupos;
