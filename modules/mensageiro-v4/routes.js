"use strict";
const express = require("express");
const { CARDS, CATALOG, DEFAULT_RESPONSES, fail } = require("./model");
function createV4Routes({
  repository,
  engine,
  diagnostics,
  getWorkspace,
  hasFeature,
  listSessions,
  listGroups,
  requireAdminMaster = (_req, res) => res.status(403).json({ ok: false, code: "admin_required" }),
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.usuario || !getWorkspace(req))
      return res.status(401).json({ ok: false, code: "auth_required" });
    if (!hasFeature(req, "mensageiro"))
      return res.status(403).json({ ok: false, code: "plan_blocked" });
    req.v4Workspace = getWorkspace(req);
    if (!engine.owns(req.v4Workspace))
      return res.status(503).json({ ok: false, code: "v4_off" });
    next();
  });
  const safe = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const known = new Set([
        "conflito_revisao",
        "perfis_conflitantes",
        "imagem_invalida",
        "programacao_invalida",
        "programacao_passada",
        "perfil_nao_encontrado",
        "nome_obrigatorio",
        "regra_invalida",
        "acao_invalida",
        "alvo_nao_autorizado",
        "diagnostico_existente",
        "limites_invalidos",
        "campo_invalido",
        "lista_invalida",
        "link_publico_invalido",
        "dominio_invalido",
        "regras_invalidas",
        "scope_invalid",
        "session_not_connected",
        "card_invalido",
        "revision_required",
      ]);
      const code = known.has(error.message) ? error.message : "v4_unavailable";
      res
        .status(
          code === "conflito_revisao"
            ? 409
            : code === "v4_unavailable"
              ? 503
              : 422,
        )
        .json({ ok: false, code });
    }
  };
  const scope = (w, sessionId, groups) => {
    const sessions = listSessions(w);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || session.connected !== true) fail("session_not_connected");
    const allowed = new Set(listGroups(w, sessionId).map((g) => g.id));
    if (!Array.isArray(groups) || groups.some((g) => !allowed.has(g)))
      fail("scope_invalid");
  };
  router.get(
    "/state",
    safe(async (req, res) =>
      res.json({
        ok: true,
        source: "mensageiro_v4",
        ...(await repository.call("state", { workspaceId: req.v4Workspace })),
        sessions: listSessions(req.v4Workspace),
        catalog: CATALOG,
        defaultResponses: DEFAULT_RESPONSES,
        diagnostic: diagnostics.status(req.v4Workspace),
        ...engine.stats(req.v4Workspace),
      }),
    ),
  );
  router.get(
    "/groups",
    safe(async (req, res) => {
      scope(req.v4Workspace, req.query.sessionId, []);
      res.json({
        ok: true,
        groups: listGroups(req.v4Workspace, req.query.sessionId),
      });
    }),
  );
  router.get(
    "/profiles/:id",
    safe(async (req, res) =>
      res.json({
        ok: true,
        profile: await repository.call("profile", {
          workspaceId: req.v4Workspace,
          profileId: req.params.id,
        }),
      }),
    ),
  );
  for (const [method, url] of [
    ["post", "/profiles"],
    ["patch", "/profiles/:id"],
  ])
    router[method](
      url,
      safe(async (req, res) => {
        const input = req.body || {};
        scope(req.v4Workspace, input.sessionId, input.destinations || []);
        if (req.params.id && !Number.isInteger(input.expectedRevision))
          fail("revision_required");
        if (req.params.id) {
          const previous = await repository.call("profile", {
            workspaceId: req.v4Workspace,
            profileId: req.params.id,
          });
          for (const card of Object.values(previous.cards))
            if (card.configuration?.grupos?.length)
              scope(
                req.v4Workspace,
                input.sessionId,
                card.configuration.grupos,
              );
          for (const command of previous.cards.commands.configuration
            ?.comandos || [])
            if (command.grupos?.length)
              scope(req.v4Workspace, input.sessionId, command.grupos);
          const schedules = await repository.call("schedules", {
            workspaceId: req.v4Workspace,
            profileId: previous.id,
          });
          for (const schedule of schedules)
            scope(
              req.v4Workspace,
              input.sessionId,
              schedule.destinations || [],
            );
        }
        res.json({
          ok: true,
          profile: await repository.call("save", {
            workspaceId: req.v4Workspace,
            profileId: req.params.id,
            input,
          }),
        });
      }),
    );
  router.post(
    "/profiles/:id/duplicate",
    safe(async (req, res) =>
      res.json({
        ok: true,
        profile: await repository.call("duplicate", {
          workspaceId: req.v4Workspace,
          profileId: req.params.id,
        }),
      }),
    ),
  );
  router.post(
    "/profiles/:id/migrate",
    safe(async (req, res) =>
      res.json({
        ok: true,
        ...(await repository.call("migrate", {
          workspaceId: req.v4Workspace,
          profileId: req.params.id,
          expectedRevision: req.body?.expectedRevision,
        })),
      }),
    ),
  );
  router.patch(
    "/profiles/:id/cards/:card",
    safe(async (req, res) => {
      if (!CARDS.includes(req.params.card)) fail("card_invalido");
      const w = req.v4Workspace,
        p = await repository.call("profile", {
          workspaceId: w,
          profileId: req.params.id,
        });
      const configuration = req.body.configuration || {};
      const effective = {
        ...p.cards[req.params.card].configuration,
        ...configuration,
      };
      scope(w, p.sessionId, effective.grupos || p.destinations);
      for (const command of effective.comandos || [])
        if (command.gruposConfigurados || command.grupos?.length)
          scope(w, p.sessionId, command.grupos || []);
      if (!Number.isInteger(req.body.expectedRevision))
        fail("revision_required");
      res.json({
        ok: true,
        profile: await repository.call("card", {
          workspaceId: w,
          profileId: p.id,
          card: req.params.card,
          active: req.body.active,
          configuration,
          expectedRevision: req.body.expectedRevision,
        }),
      });
    }),
  );
  router.get(
    "/profiles/:id/schedules",
    safe(async (req, res) =>
      res.json({
        ok: true,
        schedules: await repository.call("schedules", {
          workspaceId: req.v4Workspace,
          profileId: req.params.id,
        }),
      }),
    ),
  );
  for (const [method, url] of [
    ["post", "/profiles/:id/schedules"],
    ["patch", "/profiles/:id/schedules/:scheduleId"],
    ["delete", "/profiles/:id/schedules/:scheduleId"],
  ])
    router[method](
      url,
      safe(async (req, res) => {
        const w = req.v4Workspace,
          p = await repository.call("profile", {
            workspaceId: w,
            profileId: req.params.id,
          });
        if (method !== "delete")
          scope(w, p.sessionId, req.body.grupos || p.destinations);
        res.json({
          ok: true,
          schedule: await repository.call("schedule", {
            workspaceId: w,
            profileId: p.id,
            scheduleId: req.params.scheduleId,
            input: req.body,
            expectedRevision: req.body.expectedRevision,
            remove: method === "delete",
          }),
        });
      }),
    );
  router.get(
    "/diagnostics",
    requireAdminMaster,
    safe(async (req, res) =>
      res.json({ ok: true, ...diagnostics.status(req.v4Workspace) }),
    ),
  );
  router.post(
    "/diagnostics/start",
    requireAdminMaster,
    safe(async (req, res) => {
      const { sessionId, groupId } = req.body || {};
      scope(req.v4Workspace, sessionId, [groupId]);
      const target = engine.scope.match({ workspaceId: req.v4Workspace, sessionId, groupId });
      if (!target) fail("alvo_nao_autorizado");
      const profile = await repository.call("profile", { workspaceId: req.v4Workspace, profileId: target.profileId });
      if (!profile.active || profile.sessionId !== sessionId) fail("alvo_nao_autorizado");
      res.json({
        ok: true,
        ...diagnostics.start({
          workspaceId: req.v4Workspace,
          sessionId,
          groupId,
          durationMs: req.body.durationMs ?? 900000,
          maxEvents: req.body.maxEvents ?? 10,
        }),
      });
    }),
  );
  router.post(
    "/diagnostics/stop",
    requireAdminMaster,
    safe(async (req, res) =>
      res.json({ ok: true, ...diagnostics.stop(req.v4Workspace) }),
    ),
  );
  return router;
}
module.exports = { createV4Routes };
