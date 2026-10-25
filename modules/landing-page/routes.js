"use strict";

const express = require("express");
const { MAX_UPLOAD } = require("./service");

function createLandingPageRoutes({
  service,
  publicRoutes = false,
  getClienteId,
  usuarioTemRecurso,
}) {
  const router = express.Router();
  const safe = (handler) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.statusCode || 503;
      res
        .status(status)
        .json({
          ok: false,
          erro: error.statusCode ? error.message : "landing_indisponivel",
        });
    }
  };
  if (publicRoutes) {
    router.get("/public/landing-domain", safe(async (req, res) =>
      res.json({ ok: true, page: await service.publicDomain(req.query.host) }),
    ));
    router.get(
      "/public/landing/:pageId",
      safe(async (req, res) =>
        res.json({
          ok: true,
          page: await service.publicPage(req.params.pageId),
        }),
      ),
    );
    router.get(
      "/public/landing/:pageId/assets/:name",
      safe(async (req, res) => {
        const file = await service.asset(
          req.params.pageId,
          req.params.name,
          true,
        );
        res.type("webp").sendFile(file, (error) => {
          if (error && !res.headersSent) res.status(404).end();
        });
      }),
    );
    return router;
  }
  router.use("/landing-page", (req, res, next) => {
    if (!req.usuario || !req.clienteId)
      return res.status(401).json({ ok: false, erro: "nao_autorizado" });
    if (!usuarioTemRecurso(req, "landing_page"))
      return res
        .status(403)
        .json({
          ok: false,
          erro: "recurso_nao_disponivel_no_plano",
          recurso: "landing_page",
        });
    next();
  });
  router.get(
    "/landing-page/slug-availability",
    safe(async (req, res) => res.json({ ok: true, ...await service.slugAvailability(getClienteId(req), req.query.slug) })),
  );
  for (const [action, method] of [["connect", "connectDomain"], ["verify", "verifyDomain"], ["disconnect", "disconnectDomain"]]) {
    router.post(`/landing-page/domain/${action}`, safe(async (req, res) =>
      res.json({ ok: true, page: await service[method](getClienteId(req), req.body?.revision, req.body?.hostname) }),
    ));
  }
  router.get(
    "/landing-page",
    safe(async (req, res) =>
      res.json({ ok: true, page: await service.get(getClienteId(req)) }),
    ),
  );
  router.put(
    "/landing-page",
    express.json({ limit: "64kb" }),
    safe(async (req, res) =>
      res.json({
        ok: true,
        page: await service.save(
          getClienteId(req),
          req.body?.revision,
          req.body?.config,
        ),
      }),
    ),
  );
  for (const action of ["publish", "unpublish"]) {
    router.post(
      `/landing-page/${action}`,
      safe(async (req, res) =>
        res.json({
          ok: true,
          page: await service[action](getClienteId(req), req.body?.revision),
        }),
      ),
    );
  }
  router.post(
    "/landing-page/assets/:kind",
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: MAX_UPLOAD,
    }),
    safe(async (req, res) => {
      const revision = Number(req.get("X-Landing-Revision"));
      if (!req.get("X-Landing-Revision"))
        return res.status(400).json({ ok: false, erro: "revisao_obrigatoria" });
      res.json({
        ok: true,
        page: await service.upload(
          getClienteId(req),
          revision,
          req.params.kind,
          req.body,
          req.get("Content-Type"),
        ),
      });
    }),
  );
  router.get(
    "/landing-page/assets/:name",
    safe(async (req, res) => {
      const file = await service.asset(getClienteId(req), req.params.name);
      res.type("webp").sendFile(file, (error) => {
        if (error && !res.headersSent) res.status(404).end();
      });
    }),
  );
  router.use((error, req, res, next) => {
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ ok: false, erro: "arquivo_ou_configuracao_muito_grande" });
    next(error);
  });
  return router;
}

module.exports = { createLandingPageRoutes };
