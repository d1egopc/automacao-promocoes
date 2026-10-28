"use strict";
const express = require("express");
const crypto = require("node:crypto");
const { CARDS, CATALOG, DEFAULT_RESPONSES, fail } = require("./model");
const { MODULES, stateOf, media } = require("./module-contract");
const { catalog } = require("./templates");
const { contactRef } = require("./module-runtime");
function createV4Routes({
  repository,
  engine,
  diagnostics,
  getWorkspace,
  hasFeature,
  listSessions,
  listGroups,
  requireAdminMaster = (_req, res) => res.status(403).json({ ok: false, code: "admin_required" }),
  canary,
  universal = false,
  onConfigurationChange = async () => {},
  canUseTarget = (workspaceId, req) => workspaceId === getWorkspace(req) && hasFeature(req, "mensageiro"),
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.usuario || !getWorkspace(req))
      return res.status(401).json({ ok: false, code: "auth_required" });
    req.v4Workspace = getWorkspace(req);
    req.body ||= {};
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
        "plan_blocked",
        "canary_busy",
        "legacy_busy",
        "canary_not_found",
        "test_authorization_invalid",
        "migration_required",
        "activation_confirmation_required",
        "active_card_required",
        "legacy_review_required",
        "configuracao_invalida", "midia_invalida", "resposta_vazia", "horario_invalido", "comando_invalido",
        "comando_duplicado", "gatilho_invalido", "fluxo_invalido", "modelo_nao_encontrado",
        "desative_perfil_para_modelo", "contato_invalido", "runtime_limit", "programacao_nao_encontrada",
        "configuracao_grande",
      ]);
      const code = known.has(error.message) ? error.message : "v4_unavailable";
      res
        .status(
          code === "plan_blocked"
            ? 403
            : code === "conflito_revisao"
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
  // Only these Admin Master control paths are available while business V4 is
  // OFF. Preparing the existing authority never enables dispatch by itself.
  const validateCanary = async (req) => {
    if (!canUseTarget(req.v4Workspace, req)) fail("plan_blocked");
    if (!canary || engine.scope.targets.length) fail("alvo_nao_autorizado");
    const { sessionId, groupId, profileId, expectedRevision } = req.body || {};
    scope(req.v4Workspace, sessionId, [groupId]);
    if (!Number.isInteger(expectedRevision)) fail("revision_required");
    const selected = await repository.call("select", { workspaceId: req.v4Workspace,
      sessionId, groupId, card: "groupManager" });
    const p = selected.profile;
    if (!p || p.id !== profileId || !p.active || !p.cards.groupManager.active || p.sessionId !== sessionId)
      fail("alvo_nao_autorizado");
    if (p.revision !== expectedRevision) fail("conflito_revisao");
    if (!canary.authorizeTarget({ workspaceId: req.v4Workspace, sessionId, groupId, profileId })) fail("alvo_nao_autorizado");
    // Recheck volatile session/group authorization after the worker await.
    scope(req.v4Workspace, sessionId, [groupId]);
    return p;
  };
  // Admin Master controls a nominated target; never rewrite req.clienteId or
  // let a customer nominate a foreign workspace on business endpoints.
  const controlWorkspace = (req, res, next) => {
    const w = req.body?.workspaceId || req.query.workspaceId || getWorkspace(req);
    if (typeof w !== "string" || !/^[\w-]{1,100}$/.test(w))
      return res.status(422).json({ ok: false, code: "alvo_nao_autorizado" });
    req.v4Workspace = w;
    next();
  };
  router.get("/canary/target", requireAdminMaster, controlWorkspace, safe(async (req, res) => {
    if (!canUseTarget(req.v4Workspace, req)) fail("plan_blocked");
    if (!canary || engine.scope.targets.length) fail("alvo_nao_autorizado");
    const sessionId = req.query.sessionId;
    const groupHash = req.query.groupHash;
    if (typeof sessionId !== "string" || typeof groupHash !== "string" || !/^[a-f0-9]{64}$/.test(groupHash))
      fail("scope_invalid");
    scope(req.v4Workspace, sessionId, []);
    const matches = listGroups(req.v4Workspace, sessionId).filter(g =>
      crypto.createHash("sha256").update(String(g.id || "")).digest("hex") === groupHash);
    if (matches.length !== 1) fail("scope_invalid");
    const groupId = matches[0].id;
    const selected = await repository.call("select", { workspaceId: req.v4Workspace,
      sessionId, groupId, card: "groupManager" });
    const p = selected.profile;
    if (!p || !p.active || !p.cards?.groupManager?.active || p.sessionId !== sessionId ||
        !canary.authorizeTarget({ workspaceId: req.v4Workspace, sessionId, groupId, profileId: p.id }))
      fail("alvo_nao_autorizado");
    scope(req.v4Workspace, sessionId, [groupId]);
    res.json({ ok: true, target: { workspaceId: req.v4Workspace, sessionId, groupId,
      groupName: matches[0].name || "Grupo autorizado", profileId: p.id,
      expectedRevision: p.revision,
      readyForObservation: p.cards.groupManager.configuration?.v4?.migrationVersion === 4 } });
  }));
  router.get("/canary", requireAdminMaster, controlWorkspace, safe(async (req, res) => res.json({ ok: true,
    canary: canary?.status(req.v4Workspace) || { state: "off" },
    diagnostic: diagnostics.status(req.v4Workspace) })));
  router.post("/canary/prepare", requireAdminMaster, controlWorkspace, safe(async (req, res) => {
    const p = await validateCanary(req);
    if (canary.run?.active || canary.run?.inFlight || canary.run?.transports) fail("canary_busy");
    const result = await repository.call("migrate", { workspaceId: req.v4Workspace,
      profileId: p.id, expectedRevision: p.revision, strictRevision: true });
    res.json({ ok: true, ...result, canary: canary.status(req.v4Workspace) });
  }));
  router.post("/canary/start", requireAdminMaster, controlWorkspace, safe(async (req, res) => {
    const p = await validateCanary(req);
    if (p.cards.groupManager.configuration?.v4?.migrationVersion !== 4) fail("migration_required");
    if (req.body.mode === "controlled_test" && req.body.authorization !== "single_test_delete") fail("test_authorization_invalid");
    const target = { workspaceId: req.v4Workspace, sessionId: p.sessionId,
      groupId: req.body.groupId, profileId: p.id };
    canary.start({ target, mode: req.body.mode, durationMs: req.body.durationMs,
      maxEvents: req.body.maxEvents });
    canary.run.profileRevision = p.revision;
    try {
      diagnostics.start({ ...target, durationMs: req.body.durationMs, maxEvents: req.body.maxEvents });
    } catch (error) { canary.stop("diagnostic_unavailable"); throw error; }
    res.json({ ok: true, canary: canary.status(req.v4Workspace) });
  }));
  router.post("/canary/arm", requireAdminMaster, controlWorkspace, safe(async (req, res) => {
    if (!canUseTarget(req.v4Workspace, req)) fail("plan_blocked");
    res.json({ ok: true, canary: canary.arm({ ...req.body, workspaceId: req.v4Workspace }) });
  }));
  router.post("/canary/stop", requireAdminMaster, controlWorkspace, safe(async (req, res) => {
    const current = canary?.status(req.v4Workspace);
    if (!current?.runId || current.runId !== req.body?.runId) fail("canary_not_found");
    canary.stop("manual");
    res.json({ ok: true, canary: canary.status(req.v4Workspace), diagnostic: diagnostics.status(req.v4Workspace) });
  }));
  router.use((req, res, next) => {
    if (!hasFeature(req, "mensageiro")) return res.status(403).json({ ok: false, code: "plan_blocked" });
    if (!engine.owns(req.v4Workspace)) return res.status(503).json({ ok: false, code: "v4_off" });
    next();
  });
  router.get(
    "/state",
    safe(async (req, res) =>
      res.json({
        ok: true,
        source: "mensageiro_v4",
        universal: universal === true,
        ...(await repository.call("state", { workspaceId: req.v4Workspace })),
        sessions: listSessions(req.v4Workspace),
        catalog: CATALOG,
        defaultResponses: DEFAULT_RESPONSES,
        diagnostic: diagnostics.status(req.v4Workspace),
        ...engine.stats(req.v4Workspace),
      }),
    ),
  );
  router.get("/templates",safe(async(_req,res)=>res.json({ok:true,templates:catalog()})));
  router.get("/sessions",safe(async(req,res)=>res.json({ok:true,sessions:listSessions(req.v4Workspace)})));
  router.get("/profiles",safe(async(req,res)=>res.json({ok:true,...await repository.call("state",{workspaceId:req.v4Workspace})})));
  router.get("/profiles/:id/modules/:module",safe(async(req,res)=> {
    if(!MODULES.includes(req.params.module)) fail("card_invalido");
    const p=await repository.call("profile",{workspaceId:req.v4Workspace,profileId:req.params.id});
    const name=req.params.module, card=p.cards[name], session=listSessions(req.v4Workspace).find(s=>s.id===p.sessionId);
    res.json({ok:true,profileId:p.id,revision:p.revision,module:name,active:card.active,
      state:stateOf(p,name,session),configuration:card.configuration?.universal||null,
      legacyConfiguration:card.configuration?.universal?undefined:card.configuration||{}});
  }));
  router.post("/profiles/:id/template",safe(async(req,res)=> {
    const result=await repository.call("apply_template",{workspaceId:req.v4Workspace,profileId:req.params.id,
      templateId:req.body.templateId,expectedRevision:req.body.expectedRevision});
    res.json({ok:true,profile:result});
  }));
  router.get("/profiles/:id/modules",safe(async(req,res)=> {
    const p=await repository.call("profile",{workspaceId:req.v4Workspace,profileId:req.params.id});
    const session=listSessions(req.v4Workspace).find(s=>s.id===p.sessionId);
    res.json({ok:true,profileId:p.id,revision:p.revision,niche:p.niche||"",modules:Object.fromEntries(MODULES.map(name=>[name,{
      active:p.cards[name].active,revision:p.cards[name].revision,state:stateOf(p,name,session),
      configuration:p.cards[name].configuration?.universal || null,legacyConfiguration:p.cards[name].configuration?.universal ? undefined:p.cards[name].configuration||{}}]))});
  }));
  router.put("/profiles/:id/modules/:module",safe(async(req,res)=> {
    const w=req.v4Workspace, p=await repository.call("profile",{workspaceId:w,profileId:req.params.id});
    scope(w,p.sessionId,p.destinations);
    const saved=await repository.call("module",{workspaceId:w,profileId:p.id,card:req.params.module,
      configuration:req.body.configuration,active:req.body.active,expectedRevision:req.body.expectedRevision});
    res.json({ok:true,profile:saved});
  }));
  router.post("/profiles/:id/media",safe(async(req,res)=> {
    await repository.call("profile",{workspaceId:req.v4Workspace,profileId:req.params.id});
    res.json({ok:true,media:media(req.body.media),storage:"profile_configuration",persisted:false});
  }));
  router.get("/profiles/:id/history",safe(async(req,res)=>res.json({ok:true,source:"mensageiro_v3_audit",
    records:await repository.call("history",{workspaceId:req.v4Workspace,profileId:req.params.id,limit:req.query.limit})})));
  router.get("/profiles/:id/diagnostic",safe(async(req,res)=> {
    const p=await repository.call("profile",{workspaceId:req.v4Workspace,profileId:req.params.id});
    const session=listSessions(req.v4Workspace).find(s=>s.id===p.sessionId);
    res.json({ok:true,readOnly:true,profileId:p.id,revision:p.revision,session:session||null,
      modules:Object.fromEntries(MODULES.map(name=>[name,stateOf(p,name,session)])),adminPermission:"desconhecido_ate_verificacao_runtime",
      workspaceTotals:engine.stats(req.v4Workspace),source:"mensageiro_v4_state_and_v3_audit",
      records:await repository.call("history",{workspaceId:req.v4Workspace,profileId:p.id,limit:10})});
  }));
  router.post("/profiles/:id/human",safe(async(req,res)=> {
    const p=await repository.call("profile",{workspaceId:req.v4Workspace,profileId:req.params.id});
    if(!/^[A-Za-z0-9_:-]+@(?:s\.whatsapp\.net|lid)$/.test(req.body.contactId||"")) fail("contato_invalido");
    res.json({ok:true,...await repository.call("human",{workspaceId:p.workspaceId,profileId:p.id,sessionId:p.sessionId,
      expectedRevision:req.body.expectedRevision,contactRef:contactRef(p,p.sessionId,req.body.contactId),
      paused:req.body.paused===true,minutes:req.body.minutes})});
  }));
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
        const saved = await repository.call("save", {
            workspaceId: req.v4Workspace,
            profileId: req.params.id,
            input,
            universal,
          });
        if (universal) await onConfigurationChange();
        res.json({ ok: true, profile: saved });
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
          universal,
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
