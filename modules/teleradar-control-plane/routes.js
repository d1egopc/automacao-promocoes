"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { createTelegramTeleRadarControlPlane } = require("./control-plane.service");

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "api_hash",
  "apihash",
  "session",
  "sessionstring",
  "string_session",
  "authkey",
  "phonecodehash",
  "code",
  "password",
  "phone"
]);

function sanitizeResponse(value) {
  if (Array.isArray(value)) return value.map(sanitizeResponse);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");
    if (FORBIDDEN_RESPONSE_KEYS.has(normalized)) continue;
    result[key] = sanitizeResponse(item);
  }
  return result;
}

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "RATE_LIMIT_EXCEEDED" }
  });
}

function clearRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) req.rawBody.fill(0);
  req.rawBody = undefined;
}

function createTelegramTeleRadarAdminRoutes({
  service = createTelegramTeleRadarControlPlane(),
  requireAdmin,
  authStartLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 5 }),
  authStepLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 12 })
} = {}) {
  if (typeof requireAdmin !== "function") throw new Error("TELERADAR_ADMIN_MIDDLEWARE_REQUIRED");
  const router = express.Router();
  router.use(requireAdmin);

  function actor(req) {
    return req.usuario || req.user || null;
  }

  function route(handler) {
    return async (req, res) => {
      try {
        const result = await handler(req);
        const sanitized = sanitizeResponse(result);
        return res.json(Array.isArray(sanitized)
          ? { ok: true, data: sanitized }
          : { ok: true, ...sanitized });
      } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        const publicCode = error?.code && error?.statusCode ? String(error.code) : "CONTROL_PLANE_OPERATION_FAILED";
        return res.status(statusCode).json({ ok: false, error: publicCode });
      }
    };
  }

  router.get("/telegram-account/status", route(req => service.getTelegramStatus(actor(req))));

  router.post("/telegram-account/auth/start", authStartLimiter, route(async req => {
    let phone = req.body?.phone;
    if (req.body && typeof req.body === "object") delete req.body.phone;
    clearRawBody(req);
    try {
      return await service.authStart(actor(req), { phone });
    } finally {
      phone = undefined;
    }
  }));

  router.post("/telegram-account/auth/code", authStepLimiter, route(async req => {
    const authFlowId = req.body?.authFlowId;
    let code = req.body?.code;
    if (req.body && typeof req.body === "object") delete req.body.code;
    clearRawBody(req);
    try {
      return await service.authCode(actor(req), { authFlowId, code });
    } finally {
      code = undefined;
    }
  }));

  router.post("/telegram-account/auth/2fa", authStepLimiter, route(async req => {
    const authFlowId = req.body?.authFlowId;
    let password = req.body?.password;
    if (req.body && typeof req.body === "object") delete req.body.password;
    clearRawBody(req);
    try {
      return await service.auth2fa(actor(req), { authFlowId, password });
    } finally {
      password = undefined;
    }
  }));

  router.post("/telegram-account/auth/cancel", authStepLimiter, route(req => service.authCancel(actor(req), {
    authFlowId: req.body?.authFlowId
  })));

  router.delete("/telegram-account", route(req => service.removeAccount(actor(req))));
  router.get("/teleradar/sources/available", route(req => service.listAvailableSources(actor(req))));
  router.get("/teleradar/sources", route(req => service.listSelectedSources(actor(req))));
  router.put("/teleradar/sources", route(req => service.replaceSelectedSources(actor(req), { chatKeys: req.body?.chatKeys })));
  router.post("/teleradar/start", route(req => service.startTeleRadar(actor(req))));
  router.post("/teleradar/stop", route(req => service.stopTeleRadar(actor(req))));
  router.get("/teleradar/status", route(req => service.getTeleRadarStatus(actor(req))));

  return router;
}

module.exports = { createTelegramTeleRadarAdminRoutes, sanitizeResponse };
