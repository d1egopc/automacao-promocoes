"use strict";

const express = require("express");

function texto(valor = "") { return String(valor ?? "").trim(); }

function payloadErro(e, fallback = "local_worker_falhou") {
  const motivo = texto(e?.codigo || e?.motivo || e?.message || fallback) || fallback;
  return { ok: false, erro: motivo, motivo };
}

function tokenWorker(req) {
  const header = texto(req.get?.("authorization") || req.headers?.authorization);
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  return texto(req.get?.("x-local-worker-token") || req.headers?.["x-local-worker-token"]);
}

function criarRotasLocalWorker(deps = {}) {
  const router = express.Router();
  const service = deps.service;
  const auth = typeof deps.auth === "function" ? deps.auth : (_req, _res, next) => next();
  if (!service) throw new Error("local_worker_service_obrigatorio");

  async function workerAuth(req, res, next) {
    try {
      const autenticado = await service.autenticar(tokenWorker(req));
      if (!autenticado?.ok) return res.status(401).json({ ok: false, erro: "worker_nao_autenticado", motivo: "worker_nao_autenticado" });
      req.localWorker = autenticado;
      return next();
    } catch (e) { return res.status(401).json(payloadErro(e, "worker_nao_autenticado")); }
  }

  router.post("/register", auth, async (req, res) => {
    try {
      const resultado = await service.registrarWorker({
        ownerId: texto(req.clienteId || req.usuario?.id),
        workerId: texto(req.body?.workerId),
        capabilities: req.body?.capabilities
      });
      return res.status(resultado.ok ? 201 : 409).json(resultado);
    } catch (e) { return res.status(e.statusCode || 500).json(payloadErro(e)); }
  });

  router.post("/claim", workerAuth, async (req, res) => {
    try {
      const resultado = await service.claim({ worker: req.localWorker, capabilities: req.body?.capabilities });
      return res.json(resultado);
    } catch (e) { return res.status(e.statusCode || 400).json(payloadErro(e)); }
  });

  router.post("/heartbeat", workerAuth, async (req, res) => {
    try {
      const resultado = await service.heartbeat({ worker: req.localWorker, taskId: req.body?.taskId, leaseToken: req.body?.leaseToken });
      return res.status(resultado.ok ? 200 : 409).json(resultado);
    } catch (e) { return res.status(e.statusCode || 400).json(payloadErro(e)); }
  });

  router.post("/tasks/:id/result", workerAuth, async (req, res) => {
    try {
      const resultado = await service.resultado({
        worker: req.localWorker,
        taskId: req.params.id,
        leaseToken: req.body?.leaseToken,
        marketplace: req.body?.marketplace,
        productId: req.body?.productId,
        imagemOficialUrl: req.body?.imagemOficialUrl,
        provaTecnica: req.body?.provaTecnica,
        capability: req.body?.capability,
        accessible: req.body?.accessible,
        indicatorFound: req.body?.indicatorFound,
        finalUrl: req.body?.finalUrl,
        checkedAt: req.body?.checkedAt
      });
      return res.json(resultado);
    } catch (e) { return res.status(e.statusCode || 422).json(payloadErro(e, "resultado_invalido")); }
  });

  router.post("/tasks/:id/failure", workerAuth, async (req, res) => {
    try {
      const resultado = await service.falha({ worker: req.localWorker, taskId: req.params.id, leaseToken: req.body?.leaseToken, motivo: req.body?.motivo, metadata: req.body?.metadata });
      return res.status(resultado.ok ? 200 : 409).json(resultado);
    } catch (e) { return res.status(e.statusCode || 422).json(payloadErro(e)); }
  });

  router.post("/revoke", workerAuth, async (req, res) => {
    try {
      const resultado = await service.revogar({ worker: req.localWorker });
      return res.status(resultado.ok ? 200 : 404).json(resultado);
    } catch (e) { return res.status(e.statusCode || 400).json(payloadErro(e, "worker_revogacao_falhou")); }
  });

  router.get("/status", workerAuth, async (_req, res) => {
    try { return res.json(await service.status()); } catch (e) { return res.status(500).json(payloadErro(e)); }
  });

  return router;
}

module.exports = { criarRotasLocalWorker, tokenWorker };
