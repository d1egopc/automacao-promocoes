"use strict";

const express = require("express");
const { createOperationalView, project } = require("./operational-view");
const { createAuditRequests } = require("./auditoria-request");
const {
  autenticarTokenAuditoria,
  criarAuditoriaTemporaria,
  escopoDaRequisicao,
  listarAuditoriasSanitizadas,
  consultarEventosTelemetria,
  consultarRastreioTelemetria,
  consultarSaudeTelemetria,
  revogarAuditoriaTemporaria
} = require("./telemetria.service");

function usuarioAdminMaster(req = {}) {
  return req.usuario?.papel === "admin_master";
}

function erroAdmin(res) {
  return res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
}

function erroPublicoTelemetria(res) {
  return res.status(500).json({ ok: false, erro: "telemetria_indisponivel" });
}

function pareceTokenAuditoria(req = {}) {
  const header = String(req.headers?.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return bearer.startsWith("tel_") || Boolean(req.headers?.["x-telemetria-auditoria"]);
}

function criarMiddlewareTelemetria({ authNormal, isAdminMaster = usuarioAdminMaster } = {}) {
  const buckets = new Map();
  return function autenticarTelemetria(req, res, next) {
    if (req.query?.auditoriaToken) return res.status(400).json({ ok: false, erro: "token_em_url_nao_permitido" });
    const auditoria = autenticarTokenAuditoria(req);
    if (auditoria.ok) {
      const now = Date.now();
      for (const [id, bucket] of buckets) if (now - bucket.since >= 60000) buckets.delete(id);
      const id = auditoria.auditoria.auditoriaId;
      const bucket = buckets.get(id) || { since: now, count: 0, active: 0 };
      if (bucket.count >= 30 || bucket.active >= 2) return res.status(429).set("Retry-After", "5").json({ ok: false, erro: "limite_consultas" });
      bucket.count++; bucket.active++; buckets.set(id, bucket);
      let released = false;
      const release = () => { if (!released) { released = true; bucket.active--; } };
      res.once("finish", release); res.once("close", release);
      req.telemetriaAuditoria = auditoria.auditoria;
      return next();
    }
    if (pareceTokenAuditoria(req)) return res.status(401).json({ ok: false, erro: auditoria.motivo });

    if (typeof authNormal !== "function") {
      return res.status(401).json({ ok: false, erro: auditoria.motivo || "nao_autorizado" });
    }

    return authNormal(req, res, () => {
      if (!isAdminMaster(req)) return erroAdmin(res);
      return next();
    });
  };
}

function criarMiddlewareAdminTelemetria({ authNormal, isAdminMaster = usuarioAdminMaster } = {}) {
  return function autenticarAdminTelemetria(req, res, next) {
    if (pareceTokenAuditoria(req)) return erroAdmin(res);

    if (typeof authNormal !== "function") {
      return res.status(401).json({ ok: false, erro: "auth_indisponivel" });
    }

    return authNormal(req, res, () => {
      if (!isAdminMaster(req)) return erroAdmin(res);
      return next();
    });
  };
}

function criarRotasTelemetria(opcoes = {}) {
  const router = express.Router();
  const autenticarLeitura = criarMiddlewareTelemetria(opcoes);
  const autenticarAdmin = criarMiddlewareAdminTelemetria(opcoes);
  const operational = createOperationalView(opcoes);
  const requests = createAuditRequests({
    createGrant: criarAuditoriaTemporaria,
    grantActive: token => autenticarTokenAuditoria({ method: "GET", path: "/saude", headers: { authorization: `Bearer ${token}` } }, { registrarUso: false }).ok
  });
  const requestBuckets = new Map();
  const adminReads = new Map();
  function budgetAdminRead(req, res, next) {
    if (req.telemetriaAuditoria) return next();
    const now = Date.now();
    for (const [key, b] of adminReads) if (now - b.at >= 60000) adminReads.delete(key);
    const id = req.usuario?.id || "admin_master";
    const b = adminReads.get(id) || { at: now, count: 0, active: 0 };
    if (adminReads.size >= 100 || b.count >= 12 || b.active >= 2) return res.status(429).set("Retry-After", "5").json({ ok: false, erro: "limite_consultas" });
    b.count++; b.active++; adminReads.set(id, b);
    let released = false;
    const release = () => { if (!released) { released = true; b.active--; } };
    res.once("finish", release); res.once("close", release);
    next();
  }
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    next();
  });
  router.post("/auditoria/solicitar", (req, res) => {
    const now = Date.now();
    for (const [key, b] of requestBuckets) if (now - b.at > 60000) requestBuckets.delete(key);
    const ip = req.ip || "unknown";
    const bucket = requestBuckets.get(ip) || { at: now, count: 0 };
    if (requestBuckets.size >= 100 || bucket.count >= 3) return res.status(429).json({ ok: false, error: "request_rate_limited" });
    bucket.count++; requestBuckets.set(ip, bucket);
    const result = requests.request(req.body?.challenge);
    return res.status(result.ok ? 201 : 400).json(result);
  });
  router.post("/auditoria/autorizar", autenticarAdmin, (req, res) => {
    try {
      const result = requests.approve(req.body?.requestId, { ttlMinutos: req.body?.ttlMinutos ?? 15, escopo: req.body?.escopo, clienteId: req.body?.clienteId, criadoPor: req.usuario?.id });
      return res.status(result.ok ? 201 : 400).json(result);
    } catch { return erroPublicoTelemetria(res); }
  });
  router.post("/auditoria/coletor", (req, res) => {
    const result = requests.collect(req.body?.requestId, req.body?.verifier);
    return res.status(result.ok ? 200 : result.error === "poll_too_frequent" ? 429 : 400).json(result);
  });

  router.get("/saude", autenticarLeitura, async (req, res) => {
    try {
      if (req.telemetriaAuditoria) return res.json(await operational.snapshot(req.query, escopoDaRequisicao(req)));
      const resultado = await consultarSaudeTelemetria({
        janelaMinutos: req.query.janelaMinutos,
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 503).json(req.telemetriaAuditoria ? project(resultado) : resultado);
    } catch (e) {
      return erroPublicoTelemetria(res);
    }
  });

  router.get("/eventos", autenticarLeitura, async (req, res) => {
    try {
      if (req.telemetriaAuditoria) return res.json(await operational.events(req.query, escopoDaRequisicao(req)));
      const resultado = await consultarEventosTelemetria({
        janelaMinutos: req.query.janelaMinutos,
        clienteId: req.query.clienteId,
        marketplace: req.query.marketplace,
        etapa: req.query.etapa,
        status: req.query.status,
        limit: req.query.limit,
        cursor: req.query.cursor,
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 503).json(req.telemetriaAuditoria ? project(resultado) : resultado);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        erro: "telemetria_indisponivel",
        items: [],
        cursorProximo: null
      });
    }
  });

  router.get("/rastrear/:eventoId", autenticarLeitura, async (req, res) => {
    try {
      if (req.telemetriaAuditoria) {
        const result = await operational.trace("evento", req.params.eventoId, req.query, escopoDaRequisicao(req));
        return res.status(result.ok ? 200 : 400).json(result);
      }
      const resultado = await consultarRastreioTelemetria(req.params.eventoId, {
        escopo: escopoDaRequisicao(req)
      });
      return res.status(resultado.ok ? 200 : 400).json(req.telemetriaAuditoria ? project(resultado) : resultado);
    } catch (e) {
      return erroPublicoTelemetria(res);
    }
  });

  router.post("/auditoria/ativar", autenticarAdmin, (req, res) => {
    const resultado = criarAuditoriaTemporaria({
      ttlMinutos: req.body?.ttlMinutos,
      escopo: req.body?.escopo,
      clienteId: req.body?.clienteId,
      criadoPor: req.usuario?.id || req.clienteId || ""
    });
    return res.status(resultado.ok ? 201 : 400).json(resultado);
  });

  router.post("/auditoria/revogar", autenticarAdmin, (req, res) => {
    const resultado = revogarAuditoriaTemporaria({
      auditoriaId: req.body?.auditoriaId
    });
    return res.status(resultado.ok ? 200 : 404).json(resultado);
  });

  router.get("/auditorias", autenticarAdmin, (req, res) => {
    return res.json({ ok: true, auditorias: listarAuditoriasSanitizadas() });
  });

  for (const [path, method] of [["/operacional", "snapshot"], ["/workspaces", "workspaces"], ["/problemas", "problems"]]) {
    router.get(path, autenticarLeitura, budgetAdminRead, async (req, res) => {
      try { return res.json(await operational[method](req.query, escopoDaRequisicao(req))); }
      catch { return erroPublicoTelemetria(res); }
    });
  }
  router.get("/rastreio/:tipo/:id", autenticarLeitura, budgetAdminRead, async (req, res) => {
    try {
      const result = await operational.trace(req.params.tipo, req.params.id, req.query, escopoDaRequisicao(req));
      return res.status(result.ok ? 200 : 400).json(result);
    } catch { return erroPublicoTelemetria(res); }
  });
  router.get("/sonda-radar", autenticarLeitura, budgetAdminRead, (req, res) => {
    try { return res.json(operational.probe(escopoDaRequisicao(req))); }
    catch { return erroPublicoTelemetria(res); }
  });
  for (const [path, action] of [["/sonda-radar/iniciar", "start"], ["/sonda-radar/encerrar", "stop"]]) {
    router.post(path, autenticarAdmin, (req, res) => {
      try { const result = operational.controlProbe(action); return res.status(result.ok === false ? 409 : 200).json(result); }
      catch { return erroPublicoTelemetria(res); }
    });
  }

  return router;
}

module.exports = {
  criarRotasTelemetria,
  criarMiddlewareTelemetria,
  criarMiddlewareAdminTelemetria
};
