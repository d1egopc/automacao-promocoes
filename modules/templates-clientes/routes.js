const express = require("express");
const service = require("./service");

function statusErro(e) {
  return e.statusCode || (e.codigo ? 400 : 500);
}

function payloadErro(e) {
  return {
    ok: false,
    erro: e.codigo || e.message || "templates_ofertas_erro",
    detalhes: e.detalhes || undefined
  };
}

function criarRotasTemplatesClientes(deps = {}) {
  const router = express.Router();
  const getClienteId = typeof deps.getClienteId === "function" ? deps.getClienteId : () => "admin";

  function cliente(req) {
    return getClienteId(req) || "admin";
  }

  router.get("/", (req, res) => {
    try {
      return res.json(service.listarTemplates(cliente(req)));
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.post("/", (req, res) => {
    try {
      const resultado = service.criarTemplate(cliente(req), req.body?.template || req.body || {});
      return res.status(201).json(resultado);
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.post("/preview", (req, res) => {
    try {
      const resultado = service.previewTemplate(cliente(req), req.body || {});
      return res.status(resultado.ok ? 200 : 400).json(resultado);
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.get("/:id", (req, res) => {
    try {
      return res.json({ ok: true, template: service.buscarTemplate(cliente(req), req.params.id) });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.put("/:id", (req, res) => {
    try {
      return res.json(service.atualizarTemplate(cliente(req), req.params.id, req.body?.template || req.body || {}));
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.post("/:id/duplicar", (req, res) => {
    try {
      return res.status(201).json(service.duplicarTemplate(cliente(req), req.params.id));
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      return res.json(service.excluirTemplate(cliente(req), req.params.id));
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  return router;
}

module.exports = criarRotasTemplatesClientes;
