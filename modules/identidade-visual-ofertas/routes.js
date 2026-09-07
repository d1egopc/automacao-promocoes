"use strict";

const express = require("express");
const {
  criarServicoIdentidadeVisualOfertas
} = require("./service");
const {
  LIMITE_UPLOAD_LOGO_BYTES,
  MIMES_IMAGEM_PERMITIDOS
} = require("./renderer");

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

  router.post("/preview", async (req, res) => {
    try {
      return res.json({
        ok: true,
        ...(await service.gerarPreview(cliente(req), req.body?.config || req.body || {}, opcoes(req)))
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.post(
    "/logo/upload",
    express.raw({
      type: Array.from(MIMES_IMAGEM_PERMITIDOS),
      limit: LIMITE_UPLOAD_LOGO_BYTES
    }),
    async (req, res) => {
      try {
        return res.json({
          ok: true,
          ...(await service.uploadLogo(cliente(req), {
            buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            mimeType: req.headers["content-type"] || ""
          }, opcoes(req)))
        });
      } catch (erro) {
        return res.status(statusErro(erro)).json(payloadErro(erro));
      }
    },
    (erro, req, res, next) => {
      if (erro?.type === "entity.too.large") {
        return res.status(413).json(payloadErro({
          codigo: "identidade_visual_logo_tamanho_excedido",
          message: "identidade_visual_logo_tamanho_excedido",
          statusCode: 413
        }));
      }
      return next(erro);
    }
  );

  return router;
}

module.exports = criarRotasIdentidadeVisualOfertas;
