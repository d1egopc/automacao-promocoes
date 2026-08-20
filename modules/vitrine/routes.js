"use strict";

const express = require("express");
const storage = require("./storage");
const socialMediaStorage = require("../social/social-media-storage");

const VITRINE_LOGO_UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp"];
const VITRINE_LOGO_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;

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
        const vitrine = storage.buscarVitrinePublicaPorSlug(req.params.slug, deps, {
          page: req.query.page,
          limit: req.query.limit
        });
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

  router.post(
    "/vitrine/logo/upload",
    express.raw({ type: VITRINE_LOGO_UPLOAD_MIMES, limit: VITRINE_LOGO_UPLOAD_MAX_BYTES }),
    (req, res) => {
      if (!exigirRecursoVitrine(req, res)) return;

      try {
        const clienteId = clienteAtual(req, deps);
        const resultado = socialMediaStorage.salvar({
          clienteId,
          buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          mimeType: req.headers["content-type"] || "",
          nomeLogico: "vitrine_logo"
        });
        return res.json({
          ok: true,
          clienteId,
          logoUrl: resultado.url,
          midia: {
            url: resultado.url,
            mimeType: resultado.mimeType,
            tipo: resultado.tipo,
            bytes: resultado.bytes,
            hash: String(resultado.hash || "").slice(0, 12)
          }
        });
      } catch (erro) {
        const codigo =
          erro?.message === "social_media_arquivo_muito_grande"
            ? "vitrine_logo_tamanho_excedido"
            : erro?.message === "social_media_tipo_invalido"
              ? "vitrine_logo_tipo_invalido"
              : erro?.message === "social_media_arquivo_obrigatorio"
                ? "vitrine_logo_arquivo_obrigatorio"
                : erro?.message || "vitrine_logo_upload_falhou";
        const status = erro?.message === "social_media_storage_nao_configurado" ? 501 : 400;
        return res.status(status).json({ ok: false, erro: codigo, codigo });
      }
    },
    (erro, req, res, next) => {
      if (erro?.type === "entity.too.large") {
        return res.status(413).json({
          ok: false,
          erro: "vitrine_logo_tamanho_excedido",
          codigo: "vitrine_logo_tamanho_excedido"
        });
      }
      return next(erro);
    }
  );

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
