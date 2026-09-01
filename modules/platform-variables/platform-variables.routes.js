"use strict";

const express = require("express");
const {
  criarPlatformVariablesService,
  platformVariablesServicePadrao
} = require("./platform-variables.service");

function statusErro(erro) {
  return Number(erro?.statusCode || erro?.status || 500);
}

function payloadErro(erro) {
  const status = statusErro(erro);
  return {
    ok: false,
    codigo: erro?.codigo || (status >= 500 ? "platform_variables_falhou" : "requisicao_invalida"),
    erro: status >= 500 ? "Configuracao global indisponivel" : (erro?.message || "Requisicao invalida")
  };
}

function criarRotasPlatformVariables({ service = platformVariablesServicePadrao } = {}) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const variaveis = await service.listar();
      return res.json({ ok: true, variaveis });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.get("/:nome", async (req, res) => {
    try {
      const variavel = await service.obterPublico(req.params.nome);
      return res.json({ ok: true, variavel });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.post("/", async (req, res) => {
    try {
      const variavel = await service.salvar({
        nome: req.body?.nome,
        tipo: req.body?.tipo,
        valor: req.body?.valor,
        description: req.body?.description,
        usuarioId: req.usuario?.id || req.usuario?.clienteId || null
      });
      return res.status(201).json({ ok: true, variavel });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.put("/:nome", async (req, res) => {
    try {
      const variavel = await service.salvar({
        nome: req.params.nome,
        tipo: req.body?.tipo,
        valor: req.body?.valor,
        description: req.body?.description,
        usuarioId: req.usuario?.id || req.usuario?.clienteId || null
      });
      return res.json({ ok: true, variavel });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.delete("/:nome", async (req, res) => {
    try {
      await service.excluir(req.params.nome, req.usuario?.id || req.usuario?.clienteId || null);
      return res.json({ ok: true });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  return router;
}

module.exports = criarRotasPlatformVariables;
module.exports.criarRotasPlatformVariables = criarRotasPlatformVariables;
module.exports.criarPlatformVariablesService = criarPlatformVariablesService;
