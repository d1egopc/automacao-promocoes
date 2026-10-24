"use strict";

function createGerenteObservabilityV2Routes({ express = require("express"), requireAdminMaster, controller } = {}) {
  if (!express || typeof express.Router !== "function") throw new Error("express_router_obrigatorio");
  if (typeof requireAdminMaster !== "function") throw new Error("admin_master_middleware_obrigatorio");
  if (!controller || typeof controller.start !== "function" || typeof controller.stop !== "function") {
    throw new Error("observability_controller_obrigatorio");
  }

  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    const authorization = String(req.headers?.authorization || "");
    if (!/^Bearer\s+\S+$/i.test(authorization)) return res.status(401).json({ ok: false, code: "bearer_required" });
    return next();
  });

  router.post("/start", requireAdminMaster, (req, res) => {
    const result = controller.start(req.body || {});
    return res.status(result.ok ? 201 : 409).json(result);
  });

  router.get("/status", requireAdminMaster, (req, res) => {
    const runId = String(req.query?.runId || "");
    const result = controller.status(runId);
    if (runId && result.runId !== runId) return res.status(404).json({ ok: false, code: "run_not_found" });
    return res.json({ ok: true, status: result });
  });

  router.get("/events", requireAdminMaster, (req, res) => {
    const runId = String(req.query?.runId || "");
    if (!runId) return res.status(400).json({ ok: false, code: "run_id_required" });
    const status = controller.status(runId);
    if (status.runId !== runId) return res.status(404).json({ ok: false, code: "run_not_found" });
    return res.json({ ok: true, status, events: controller.readEvents(runId) });
  });

  router.post("/stop", requireAdminMaster, (req, res) => {
    const runId = String(req.body?.runId || "");
    if (!runId) return res.status(400).json({ ok: false, code: "run_id_required" });
    const result = controller.stop(runId);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  return router;
}

module.exports = { createGerenteObservabilityV2Routes };
