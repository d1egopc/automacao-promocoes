"use strict";

const express = require("express");
const path = require("node:path");
const { V3Store } = require("./src/v3/store");
const { buildViewModel } = require("./src/v3/view-model");
const { createPersistentWorkspaceFence } = require("./workspace-fence");

const CARD_NAMES = new Set(["scheduled", "commands", "attendance", "groupManager", "welcome", "farewell", "faq", "flows", "quickReplies"]);

function criarRotasMensageiroV3(deps = {}) {
  const router = express.Router();
  const store = deps.store || new V3Store({
    filePath: deps.filePath || process.env.MENSAGEIRO_V3_STATE_PATH || path.join(process.cwd(), "data", "mensageiro-v3", "state.json")
  });
  const fence = deps.fence || createPersistentWorkspaceFence({
    filePath: deps.fencePath || process.env.MENSAGEIRO_V3_FENCE_PATH || path.join(process.cwd(), "data", "mensageiro-v3", "workspace-fence.json")
  });

  function workspace(req) {
    const value = typeof deps.getClienteId === "function" ? deps.getClienteId(req) : "";
    return String(value || "").trim();
  }

  function allowed(req, res) {
    const id = workspace(req);
    if (!id || (typeof deps.usuarioTemRecurso === "function" && !deps.usuarioTemRecurso(req, "mensageiro"))) {
      res.status(403).json({ ok: false, codigo: "mensageiro_v3_acesso_negado" });
      return null;
    }
    return id;
  }

  function profileOr404(res, workspaceId, profileId) {
    const profile = store.getProfile(workspaceId, profileId);
    if (!profile) {
      res.status(404).json({ ok: false, codigo: "perfil_v3_nao_encontrado" });
      return null;
    }
    return profile;
  }

  function view(workspaceId) {
    const snapshot = store.snapshot();
    if (!snapshot.workspaces?.[workspaceId]) return { workspaceId, profiles: [], schedules: [] };
    return buildViewModel(store, workspaceId);
  }

  router.get("/state", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    return res.json({ ok: true, source: "mensageiro_v3", migrated: fence.isMigrated(id), ...view(id) });
  });

  router.get("/profiles", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    return res.json({ ok: true, source: "mensageiro_v3", profiles: view(id).profiles });
  });

  router.post("/profiles", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const profile = store.createProfile({ workspaceId: id, sessionId: body.sessionId, name: body.name });
      return res.status(201).json({ ok: true, source: "mensageiro_v3", profile });
    } catch (error) {
      return res.status(422).json({ ok: false, codigo: error.code || error.message || "perfil_v3_invalido" });
    }
  });

  router.get("/profiles/:profileId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profile = profileOr404(res, id, req.params.profileId); if (!profile) return;
    return res.json({ ok: true, source: "mensageiro_v3", profile });
  });

  router.patch("/profiles/:profileId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profile = profileOr404(res, id, req.params.profileId); if (!profile) return;
    try {
      const next = store.updateProfile(id, profile.id, req.body || {}, { expectedRevision: req.body?.expectedRevision });
      return res.json({ ok: true, source: "mensageiro_v3", profile: next });
    } catch (error) {
      return res.status(409).json({ ok: false, codigo: error.code || error.message || "perfil_v3_conflito" });
    }
  });

  router.delete("/profiles/:profileId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const result = store.deleteProfile(id, req.params.profileId, { expectedRevision: req.body?.expectedRevision });
    return res.json({ ok: true, source: "mensageiro_v3", ...result });
  });

  router.patch("/profiles/:profileId/cards/:card", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profile = profileOr404(res, id, req.params.profileId); if (!profile) return;
    if (!CARD_NAMES.has(req.params.card)) return res.status(422).json({ ok: false, codigo: "card_v3_invalido" });
    try {
      const card = store.saveCard(id, profile.id, req.params.card, req.body || {}, { expectedRevision: req.body?.expectedRevision });
      return res.json({ ok: true, source: "mensageiro_v3", card });
    } catch (error) {
      return res.status(409).json({ ok: false, codigo: error.code || error.message || "card_v3_conflito" });
    }
  });

  router.get("/profiles/:profileId/schedules", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profile = profileOr404(res, id, req.params.profileId); if (!profile) return;
    return res.json({ ok: true, source: "mensageiro_v3", schedules: store.listSchedules(id, { includeInactive: true }).filter(item => item.profileId === profile.id) });
  });

  router.post("/profiles/:profileId/schedules", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profile = profileOr404(res, id, req.params.profileId); if (!profile) return;
    try {
      const body = { ...(req.body || {}) };
      delete body.workspaceId;
      delete body.profileId;
      const schedule = store.createSchedule(id, profile.id, body);
      return res.status(201).json({ ok: true, source: "mensageiro_v3", schedule });
    } catch (error) {
      return res.status(422).json({ ok: false, codigo: error.code || error.message || "programacao_v3_invalida" });
    }
  });

  router.patch("/schedules/:scheduleId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const current = store.getSchedule(id, req.params.scheduleId);
    if (!current) return res.status(404).json({ ok: false, codigo: "programacao_v3_nao_encontrada" });
    try {
      const body = { ...(req.body || {}) };
      delete body.workspaceId;
      delete body.profileId;
      const schedule = store.updateSchedule(id, current.id, body, { expectedRevision: body.expectedRevision });
      return res.json({ ok: true, source: "mensageiro_v3", schedule });
    } catch (error) {
      return res.status(409).json({ ok: false, codigo: error.code || error.message || "programacao_v3_conflito" });
    }
  });

  router.delete("/schedules/:scheduleId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    return res.json({ ok: true, source: "mensageiro_v3", ...store.deleteSchedule(id, req.params.scheduleId, { expectedRevision: req.body?.expectedRevision }) });
  });

  router.get("/destinations", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const sessions = typeof deps.listSessoes === "function" ? deps.listSessoes(id) : [];
    const destinations = [];
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const sessionId = String(session?.id || session?.sessaoId || session || "");
      if (!sessionId) continue;
      const groups = typeof deps.listGrupos === "function" ? deps.listGrupos(id, sessionId) : [];
      for (const group of Array.isArray(groups) ? groups : []) {
        const groupId = String(group?.id || group?.jid || group?.grupoId || "");
        if (groupId) destinations.push({ sessionId, id: groupId, name: String(group?.name || group?.nome || groupId) });
      }
    }
    return res.json({ ok: true, source: "mensageiro_v3", destinations });
  });

  router.get("/status", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const current = view(id);
    return res.json({ ok: true, source: "mensageiro_v3", workspaceId: id, migrated: fence.isMigrated(id), profiles: current.profiles.map(profile => ({
      id: profile.id,
      active: profile.active,
      cards: profile.cards,
      scheduleCount: current.schedules.filter(schedule => schedule.profileId === profile.id).length
    })) });
  });

  return { router, store, fence };
}

module.exports = criarRotasMensageiroV3;
