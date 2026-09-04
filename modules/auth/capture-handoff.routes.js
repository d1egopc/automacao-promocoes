"use strict";

const express = require("express");
const {
  criarCaptureHandoffService
} = require("./capture-handoff.service");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function statusErro(e) {
  return e?.statusCode || e?.status || 500;
}

function payloadErro(e, fallback = "capture_handoff_falhou") {
  const codigo = e?.codigo || e?.motivo || e?.message || fallback;
  return {
    ok: false,
    erro: codigo,
    motivo: codigo
  };
}

function usuarioPublico(usuario = {}) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    plano: usuario.plano,
    ativo: usuario.ativo
  };
}

function criarRotasCaptureHandoff(deps = {}) {
  const router = express.Router();
  const service = deps.service || criarCaptureHandoffService();
  const auth = typeof deps.auth === "function" ? deps.auth : (_req, _res, next) => next();
  const getUsuarioById = typeof deps.getUsuarioById === "function" ? deps.getUsuarioById : () => null;
  const emitirJwtOptimusUsuario = typeof deps.emitirJwtOptimusUsuario === "function" ? deps.emitirJwtOptimusUsuario : null;

  router.post("/iniciar", (req, res) => {
    try {
      const resultado = service.iniciarHandoff({
        state: req.body?.state,
        codeChallenge: req.body?.codeChallenge
      });
      return res.status(201).json({ ok: true, ...resultado });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.post("/autorizar", auth, (req, res) => {
    try {
      const clienteId = texto(req.clienteId || req.usuario?.id);
      const resultado = service.autorizarHandoff({
        handoffId: req.body?.handoffId,
        state: req.body?.state,
        clienteId
      });
      return res.json({ ok: true, ...resultado });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  router.post("/trocar", (req, res) => {
    try {
      const validacao = service.validarTrocaHandoff({
        handoffId: req.body?.handoffId,
        state: req.body?.state,
        codeVerifier: req.body?.codeVerifier
      });
      const usuario = getUsuarioById(validacao.clienteId);
      if (!usuario || usuario.ativo === false) {
        return res.status(403).json({
          ok: false,
          erro: "usuario_inativo_ou_inexistente",
          motivo: "usuario_inativo_ou_inexistente"
        });
      }
      if (!emitirJwtOptimusUsuario) {
        return res.status(503).json({
          ok: false,
          erro: "emissor_jwt_indisponivel",
          motivo: "emissor_jwt_indisponivel"
        });
      }
      service.consumirHandoff(validacao.handoffId);
      const token = [REDACTED_SECRET]
      return res.json({
        ok: true,
        token,
        usuario: usuarioPublico(usuario)
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e));
    }
  });

  return router;
}

module.exports = {
  criarRotasCaptureHandoff,
  usuarioPublico
};
