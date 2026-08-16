"use strict";

const express = require("express");
const storage = require("./storage");

function statusErro(erro) {
  return erro.statusCode || 500;
}

function payloadErro(erro, fallback = "ajuda_contextual_erro") {
  return {
    ok: false,
    erro: erro.message || fallback
  };
}

function criarRotasAjudaContextual(deps = {}) {
  const router = express.Router();
  const readGlobalJson = deps.readGlobalJson;
  const writeGlobalJson = deps.writeGlobalJson;
  const isAdminMaster = typeof deps.isAdminMaster === "function"
    ? deps.isAdminMaster
    : (req) => req.usuario?.papel === "admin_master";

  function exigirAdminMaster(req, res) {
    if (isAdminMaster(req)) return true;
    res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
    return false;
  }

  router.get("/ajuda-contextual", (_req, res) => {
    try {
      const envelope = storage.lerAjudaContextual({ readGlobalJson, writeGlobalJson });
      const ajudas = storage.ajudasAtivas(envelope);
      return res.json({
        ok: true,
        escopo: "oficial",
        ajudas,
        lista: Object.values(ajudas)
      });
    } catch (erro) {
      return res.json({
        ok: false,
        escopo: "oficial",
        ajudas: {},
        lista: [],
        erro: erro.message || "ajuda_contextual_indisponivel"
      });
    }
  });

  router.get("/admin/ajuda-contextual", (req, res) => {
    if (!exigirAdminMaster(req, res)) return;

    try {
      const envelope = storage.lerAjudaContextual({ readGlobalJson, writeGlobalJson });
      return res.json({
        ok: true,
        escopo: "oficial",
        helpIds: storage.HELP_IDS_PILOTO,
        ajudas: envelope.ajudas,
        lista: storage.HELP_IDS_PILOTO.map((id) => envelope.ajudas[id])
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.put("/admin/ajuda-contextual/:helpId", (req, res) => {
    if (!exigirAdminMaster(req, res)) return;

    try {
      const { ajuda } = storage.salvarAjudaContextual(req.params.helpId, req.body || {}, {
        readGlobalJson,
        writeGlobalJson
      });

      return res.json({
        ok: true,
        escopo: "oficial",
        ajuda
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  return router;
}

module.exports = criarRotasAjudaContextual;
