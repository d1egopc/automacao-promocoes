"use strict";

// Compatibilidade de contrato para a tela original do Mensageiro.
// Este módulo não consulta nem grava o storage legado. Ele somente projeta e
// persiste a configuração V3 nos nomes de rota que a interface existente já
// conhece. O scheduler/handlers legados continuam fora do runtime universal.

const express = require("express");

const CARD_BY_MODULE = Object.freeze({
  boasVindas: "welcome",
  despedida: "farewell",
  comandos: "commands",
  programacoes: "scheduled",
  gerente: "groupManager"
});

const CARD_NAMES = new Set([
  "scheduled", "commands", "attendance", "groupManager", "welcome", "farewell",
  "faq", "flows", "quickReplies"
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = "") { return value === undefined || value === null ? fallback : String(value); }
function bool(value, fallback = false) { return value === undefined ? fallback : value === true; }

function card(profile, name) {
  const raw = profile?.cards?.[name] || {};
  const configuration = asObject(raw.configuration);
  return { raw, configuration };
}

function moduleMessage(profile, moduleName) {
  const { raw, configuration } = card(profile, CARD_BY_MODULE[moduleName]);
  const mensagem = text(configuration.mensagem ?? configuration.texto ?? configuration.conteudo);
  const imagem = text(configuration.imagem ?? configuration.imagemUrl ?? "");
  const grupos = asArray(configuration.grupos || configuration.destinations).map(String).filter(Boolean);
  return {
    ativo: raw.active === true,
    grupos,
    gruposConfigurados: configuration.gruposConfigurados === true,
    conteudoConfigurado: Boolean(mensagem || imagem || configuration.configured === true),
    configuracao: { ...clone(configuration), mensagem, imagem, envio: clone(configuration.envio || {}) }
  };
}

function moduleScope(profile, moduleName) {
  const { raw, configuration } = card(profile, CARD_BY_MODULE[moduleName]);
  return {
    ativo: raw.active === true,
    grupos: asArray(configuration.grupos || configuration.destinations).map(String).filter(Boolean),
    gruposConfigurados: configuration.gruposConfigurados === true,
    configuracao: clone(configuration)
  };
}

function legacyCommand(command, profileId) {
  const raw = asObject(command);
  return {
    ...clone(raw),
    id: text(raw.id),
    perfilId: text(raw.perfilId || profileId),
    nome: text(raw.nome || raw.name, "Comando"),
    ativo: raw.active === undefined ? bool(raw.ativo, true) : raw.active === true,
    gatilhos: asArray(raw.gatilhos || raw.triggers).map(String).filter(Boolean),
    resposta: clone(raw.resposta || { tipo: "texto", texto: text(raw.texto || raw.mensagem) })
  };
}

function legacySchedule(schedule) {
  const content = asObject(schedule.content);
  const contents = asArray(content.conteudos || content.contents);
  const fallbackContent = Object.keys(content).length ? content : { tipo: "texto", texto: "" };
  const intervalMs = Number(schedule.intervalMs || content.intervaloMinutos * 60_000 || 0) || 0;
  return {
    ...clone(content),
    id: schedule.id,
    perfilId: schedule.profileId,
    ativo: schedule.active === true,
    nome: text(schedule.name || content.nome, "Programação"),
    tipo: intervalMs > 0 ? "intervalo" : (content.tipo === "intervalo" ? "intervalo" : "horario"),
    grupos: asArray(schedule.destinations).map(String).filter(Boolean),
    gruposConfigurados: true,
    timezone: text(schedule.timezone, "America/Sao_Paulo"),
    intervaloMinutos: intervalMs > 0 ? Math.max(1, Math.round(intervalMs / 60_000)) : Number(content.intervaloMinutos || 30),
    nextRunAt: schedule.nextRunAt || "",
    conteudos: contents.length ? clone(contents) : [clone(fallbackContent)],
    conteudo: clone(fallbackContent),
    status: schedule.active === true ? "pendente" : "inativo"
  };
}

function legacyProfile(profile, schedules) {
  const commandsCard = card(profile, "commands");
  const manager = moduleScope(profile, "gerente");
  return {
    id: profile.id,
    workspaceId: profile.workspaceId,
    nome: profile.name,
    ativo: profile.active === true,
    sessaoId: profile.sessionId,
    sessaoWhatsappId: profile.sessionId,
    sessaoGruposId: profile.sessionId,
    grupos: clone(profile.destinations || []),
    criadoEm: profile.createdAt,
    atualizadoEm: profile.updatedAt,
    modulos: {
      boasVindas: moduleMessage(profile, "boasVindas"),
      despedida: moduleMessage(profile, "despedida"),
      comandos: {
        ...moduleScope(profile, "comandos"),
        comandos: asArray(commandsCard.configuration.commands || commandsCard.configuration.comandos).map(item => legacyCommand(item, profile.id))
      },
      programacoes: { ativo: card(profile, "scheduled").raw.active === true },
      gerente: manager
    },
    programacoes: schedules.map(legacySchedule)
  };
}

function attendanceConfig(profile) {
  if (!profile) return { ativo: false, faqAtivo: false, fluxosAtivo: false, respostasRapidasAtivo: false, gatilhos: [], respostasRapidas: [] };
  const attendance = card(profile, "attendance");
  const faq = card(profile, "faq");
  const flows = card(profile, "flows");
  const quick = card(profile, "quickReplies");
  const a = attendance.configuration;
  const gatilhos = [
    ...asArray(a.gatilhos).map(item => ({ ...clone(item), categoria: item?.categoria || "atendimento" })),
    ...asArray(faq.configuration.gatilhos).map(item => ({ ...clone(item), categoria: item?.categoria || "faq" })),
    ...asArray(flows.configuration.gatilhos).map(item => ({ ...clone(item), categoria: item?.categoria || "fluxos" }))
  ];
  return {
    ativo: attendance.raw.active === true,
    atendimentoAtivo: attendance.raw.active === true,
    faqAtivo: faq.raw.active === true,
    fluxosAtivo: flows.raw.active === true,
    respostasRapidasAtivo: quick.raw.active === true,
    sessaoId: text(a.sessaoId || profile.sessionId),
    sessaoAtendimentoId: text(a.sessaoId || profile.sessionId),
    atendimentoSessaoId: text(a.sessaoId || profile.sessionId),
    escopo: text(a.escopo, "privado"),
    delaySegundos: Number(a.delaySegundos || 0) || 0,
    cooldownMinutos: Number(a.cooldownMinutos ?? 10) || 0,
    gatilhos,
    respostasRapidas: clone(a.respostasRapidas || quick.configuration.respostasRapidas || []),
    contatos: clone(a.contatos || [])
  };
}

function stateFor(store, workspaceId) {
  store.reload?.();
  const profiles = listProfilesSafe(store, workspaceId);
  const schedules = listSchedulesSafe(store, workspaceId);
  const legacySchedules = schedules.map(legacySchedule);
  const legacyProfiles = profiles.map(profile => legacyProfile(profile, schedules.filter(item => item.profileId === profile.id)));
  const first = profiles.find(profile => profile.active === true) || profiles[0] || null;
  const attendance = attendanceConfig(first);
  const commands = legacyProfiles.flatMap(profile => profile.modulos.comandos.comandos || []);
  return {
    ok: true,
    source: "mensageiro_v3_compat",
    v3: true,
    clienteId: String(workspaceId),
    workspaceId: String(workspaceId),
    ativo: legacyProfiles.some(profile => profile.ativo),
    sessaoId: first?.sessionId || "",
    sessaoWhatsappId: first?.sessionId || "",
    grupos: clone(first?.destinations || []),
    gruposIds: clone(first?.destinations || []),
    perfis: legacyProfiles,
    comandos: commands,
    programacoes: legacySchedules,
    atendimento: attendance,
    boasVindas: moduleMessage(first, "boasVindas"),
    despedida: moduleMessage(first, "despedida")
  };
}

function errorCode(error, fallback = "mensageiro_v3_compat_erro") {
  return error?.code || error?.message || fallback;
}

function listProfilesSafe(store, workspaceId) {
  const workspace = store.snapshot()?.workspaces?.[String(workspaceId)];
  return workspace ? store.listProfiles(workspaceId) : [];
}

function listSchedulesSafe(store, workspaceId) {
  const workspace = store.snapshot()?.workspaces?.[String(workspaceId)];
  return workspace ? store.listSchedules(workspaceId, { includeInactive: true }) : [];
}

function patchMessageCard(store, workspaceId, profileId, moduleName, value) {
  const cardName = CARD_BY_MODULE[moduleName];
  const current = store.getProfile(workspaceId, profileId);
  if (!current) throw new Error("perfil_v3_nao_encontrado");
  const incoming = asObject(value);
  const config = { ...clone(card(current, cardName).configuration) };
  Object.assign(config, clone(incoming.configuracao || {}));
  if (incoming.mensagem !== undefined) config.mensagem = incoming.mensagem;
  if (incoming.texto !== undefined) config.mensagem = incoming.texto;
  if (incoming.imagem !== undefined) config.imagem = incoming.imagem;
  if (incoming.envio !== undefined) config.envio = clone(incoming.envio);
  if (incoming.grupos !== undefined) { config.grupos = clone(incoming.grupos); config.gruposConfigurados = incoming.gruposConfigurados === true; }
  return store.saveCard(workspaceId, profileId, cardName, { active: incoming.ativo === true, configuration: config });
}

function patchScopeCard(store, workspaceId, profileId, moduleName, value) {
  const cardName = CARD_BY_MODULE[moduleName];
  const current = store.getProfile(workspaceId, profileId);
  if (!current) throw new Error("perfil_v3_nao_encontrado");
  const incoming = asObject(value);
  const config = { ...clone(card(current, cardName).configuration) };
  if (incoming.grupos !== undefined) { config.grupos = clone(incoming.grupos); config.gruposConfigurados = incoming.gruposConfigurados === true; }
  if (incoming.configuracao !== undefined) Object.assign(config, clone(incoming.configuracao));
  return store.saveCard(workspaceId, profileId, cardName, { active: incoming.ativo === true, configuration: config });
}

function applyProfile(store, workspaceId, input) {
  const raw = asObject(input);
  const existing = listProfilesSafe(store, workspaceId);
  let profile = raw.id ? existing.find(item => item.id === String(raw.id)) || null : null;
  if (!profile) {
    profile = store.createProfile({ workspaceId, sessionId: raw.sessaoId || raw.sessaoWhatsappId || raw.sessaoGruposId, name: raw.nome || "Novo perfil" });
  }
  profile = store.updateProfile(workspaceId, profile.id, {
    name: raw.nome,
    sessionId: raw.sessaoId || raw.sessaoWhatsappId || raw.sessaoGruposId,
    active: raw.ativo === true,
    destinations: asArray(raw.grupos || raw.gruposIds).map(String).filter(Boolean)
  });
  const modules = asObject(raw.modulos);
  for (const moduleName of ["boasVindas", "despedida"]) if (modules[moduleName]) patchMessageCard(store, workspaceId, profile.id, moduleName, modules[moduleName]);
  for (const moduleName of ["comandos", "programacoes", "gerente"]) if (modules[moduleName]) patchScopeCard(store, workspaceId, profile.id, moduleName, modules[moduleName]);
  return store.getProfile(workspaceId, profile.id);
}

function scheduleInput(item) {
  const raw = asObject(item);
  const contents = asArray(raw.conteudos);
  const content = {
    ...clone(raw),
    conteudos: contents,
    texto: contents[0]?.texto || raw.texto || raw.mensagem || "",
    imagem: contents[0]?.imagem || raw.imagem || ""
  };
  const intervalMs = raw.tipo === "intervalo" ? Math.max(0, Number(raw.intervaloMinutos || 0) * 60_000) : 0;
  return {
    name: text(raw.nome, "Programação"),
    timezone: text(raw.timezone, "America/Sao_Paulo"),
    nextRunAt: raw.nextRunAt || null,
    intervalMs,
    destinations: asArray(raw.grupos).map(String).filter(Boolean),
    content,
    artifactId: raw.artifactId || null,
    allowInactive: true
  };
}

function applySchedules(store, workspaceId, profileId, items) {
  const incoming = asArray(items).filter(item => text(item?.perfilId) === String(profileId));
  const current = store.listSchedules(workspaceId, { includeInactive: true }).filter(item => item.profileId === String(profileId));
  const seen = new Set();
  for (const item of incoming) {
    const id = text(item.id);
    const patch = scheduleInput(item);
    if (id && store.getSchedule(workspaceId, id)) {
      store.updateSchedule(workspaceId, id, { ...patch, active: item.ativo === true });
      seen.add(id);
    } else {
      // The card itself is an execution guard. Configuration can be saved
      // before activation, so the V3 store receives an explicit compat flag.
      const created = store.createSchedule(workspaceId, profileId, patch);
      if (item.ativo === true) store.updateSchedule(workspaceId, created.id, { active: true });
      seen.add(created.id);
    }
  }
  for (const old of current) if (!seen.has(old.id)) store.deleteSchedule(workspaceId, old.id);
}

function applyCommands(store, workspaceId, profileId, items) {
  const profile = store.getProfile(workspaceId, profileId);
  if (!profile) throw new Error("perfil_v3_nao_encontrado");
  const current = card(profile, "commands");
  const commands = asArray(items).filter(item => text(item?.perfilId) === String(profileId)).map(item => ({ ...clone(item), active: item.ativo === true }));
  const config = { ...clone(current.configuration), commands, comandos: commands };
  store.saveCard(workspaceId, profileId, "commands", { active: current.raw.active === true, configuration: config });
}

function createLegacyCompatRoutes(deps = {}) {
  const router = express.Router();
  if (!deps.store) throw new Error("store_v3_obrigatorio");
  const store = deps.store;
  const workspace = req => String(typeof deps.getClienteId === "function" ? deps.getClienteId(req) : "").trim();
  const allowed = (req, res) => {
    const id = workspace(req);
    if (!id || (typeof deps.usuarioTemRecurso === "function" && !deps.usuarioTemRecurso(req, "mensageiro"))) {
      res.status(403).json({ ok: false, codigo: "mensageiro_v3_acesso_negado" });
      return null;
    }
    return id;
  };
  const profile = (res, id, profileId) => {
    const value = store.getProfile(id, profileId);
    if (!value) { res.status(404).json({ ok: false, codigo: "perfil_v3_nao_encontrado" }); return null; }
    return value;
  };

  router.get("/", (req, res) => { const id = allowed(req, res); if (id) res.json(stateFor(store, id)); });
  router.post("/", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    try {
      const body = asObject(req.body);
      const profileIdMap = new Map();
      for (const item of asArray(body.perfis)) {
        const saved = applyProfile(store, id, item);
        if (item?.id) profileIdMap.set(String(item.id), saved.id);
      }
      const profiles = listProfilesSafe(store, id);
      const commands = asArray(body.comandos);
      const commandsByProfile = commands.map(item => ({ ...item, perfilId: profileIdMap.get(text(item?.perfilId)) || text(item?.perfilId) }));
      const schedulesByProfile = asArray(body.programacoes).map(item => ({ ...item, perfilId: profileIdMap.get(text(item?.perfilId)) || text(item?.perfilId) }));
      for (const p of profiles) if (commandsByProfile.some(item => text(item?.perfilId) === p.id)) applyCommands(store, id, p.id, commandsByProfile);
      for (const p of profiles) if (schedulesByProfile.some(item => text(item?.perfilId) === p.id)) {
        const current = store.getProfile(id, p.id);
        if (current.cards.scheduled.active !== true && schedulesByProfile.some(item => text(item?.perfilId) === p.id)) {
          store.saveCard(id, p.id, "scheduled", { active: false, configuration: current.cards.scheduled.configuration || {} });
        }
        applySchedules(store, id, p.id, schedulesByProfile);
      }
      return res.json(stateFor(store, id));
    } catch (error) { return res.status(422).json({ ok: false, codigo: errorCode(error) }); }
  });

  router.delete("/perfis/:profileId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    try { return res.json({ ok: true, source: "mensageiro_v3_compat", ...store.deleteProfile(id, req.params.profileId) }); }
    catch (error) { return res.status(409).json({ ok: false, codigo: errorCode(error) }); }
  });

  router.get("/perfis/:profileId/atendimento", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = profile(res, id, req.params.profileId); if (!p) return;
    return res.json({ ok: true, source: "mensageiro_v3_compat", ...attendanceConfig(p) });
  });
  router.post("/perfis/:profileId/atendimento", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = profile(res, id, req.params.profileId); if (!p) return;
    try {
      const body = asObject(req.body);
      const a = asObject(body.atendimento);
      const base = { ...asObject(card(p, "attendance").configuration), ...clone(a), contatos: asArray(a.contatos || card(p, "attendance").configuration.contatos) };
      store.saveCard(id, p.id, "attendance", { active: body.ativo === true || body.atendimentoAtivo === true || a.ativo === true, configuration: { ...base, gatilhos: asArray(body.gatilhos || a.gatilhos).filter(item => item?.categoria !== "faq" && item?.categoria !== "fluxos") } });
      store.saveCard(id, p.id, "faq", { active: body.faqAtivo === true, configuration: { ...asObject(card(p, "faq").configuration), gatilhos: asArray(body.gatilhos || a.gatilhos).filter(item => item?.categoria === "faq") } });
      store.saveCard(id, p.id, "flows", { active: body.fluxosAtivo === true, configuration: { ...asObject(card(p, "flows").configuration), gatilhos: asArray(body.gatilhos || a.gatilhos).filter(item => item?.categoria === "fluxos") } });
      store.saveCard(id, p.id, "quickReplies", { active: body.respostasRapidasAtivo === true, configuration: { ...asObject(card(p, "quickReplies").configuration), respostasRapidas: clone(body.respostasRapidas || a.respostasRapidas || []) } });
      const next = store.getProfile(id, p.id);
      return res.json({ ok: true, source: "mensageiro_v3_compat", ...attendanceConfig(next) });
    } catch (error) { return res.status(422).json({ ok: false, codigo: errorCode(error) }); }
  });

  router.get("/config", (req, res) => { const id = allowed(req, res); if (id) res.json({ ok: true, source: "mensageiro_v3_compat", ...attendanceConfig(listProfilesSafe(store, id)[0]) }); });
  router.post("/config", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = listProfilesSafe(store, id)[0];
    if (!p) return res.status(409).json({ ok: false, codigo: "perfil_v3_obrigatorio" });
    req.params.profileId = p.id;
    const body = req.body;
    try {
      const a = asObject(body?.atendimento);
      store.saveCard(id, p.id, "attendance", { active: body?.atendimentoAtivo === true || a.ativo === true, configuration: { ...asObject(card(p, "attendance").configuration), ...clone(a), gatilhos: clone(body?.gatilhos || a.gatilhos || []) } });
      return res.json({ ok: true, source: "mensageiro_v3_compat", ...attendanceConfig(store.getProfile(id, p.id)) });
    } catch (error) { return res.status(422).json({ ok: false, codigo: errorCode(error) }); }
  });

  router.get("/historico", (req, res) => { const id = allowed(req, res); if (id) res.json({ ok: true, source: "mensageiro_v3_compat", historico: [] }); });
  router.post("/testar-gatilho", (req, res) => { const id = allowed(req, res); if (id) res.json({ ok: true, source: "mensageiro_v3_compat", dryRun: true, workspaceId: id, texto: text(req.body?.texto) }); });

  router.get("/perfis/:profileId/contatos", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = profile(res, id, req.params.profileId); if (!p) return;
    const vinculos = clone(card(p, "attendance").configuration.contatos || []);
    return res.json({ ok: true, source: "mensageiro_v3_compat", contatos: vinculos, vinculos });
  });
  router.post("/perfis/:profileId/contatos", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = profile(res, id, req.params.profileId); if (!p) return;
    const current = asArray(card(p, "attendance").configuration.contatos);
    const item = clone(req.body || {});
    const contatoId = text(item.contatoId || item.id || item.jid);
    if (!contatoId) return res.status(422).json({ ok: false, codigo: "contato_id_obrigatorio" });
    const next = [...current.filter(value => text(value?.contatoId || value?.id || value?.jid) !== contatoId), { ...item, contatoId }];
    store.saveCard(id, p.id, "attendance", { active: p.cards.attendance.active === true, configuration: { ...card(p, "attendance").configuration, contatos: next } });
    return res.json({ ok: true, source: "mensageiro_v3_compat", contatos: next, vinculos: next });
  });
  router.delete("/perfis/:profileId/contatos/:contatoId", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const p = profile(res, id, req.params.profileId); if (!p) return;
    const next = asArray(card(p, "attendance").configuration.contatos).filter(value => text(value?.contatoId || value?.id || value?.jid) !== text(req.params.contatoId));
    store.saveCard(id, p.id, "attendance", { active: p.cards.attendance.active === true, configuration: { ...card(p, "attendance").configuration, contatos: next } });
    return res.json({ ok: true, source: "mensageiro_v3_compat", contatos: next, vinculos: next });
  });

  router.get("/gerente/infracoes", (req, res) => { const id = allowed(req, res); if (id) res.json({ ok: true, source: "mensageiro_v3_compat", infracoes: [] }); });
  router.get("/gerente/status", (req, res) => {
    const id = allowed(req, res); if (!id) return;
    const profiles = listProfilesSafe(store, id).map(p => ({ perfilId: p.id, estado: p.cards.groupManager?.active === true ? "pronto_para_moderar" : "gerente_inativo", permissaoResumo: "nao_verificado" }));
    return res.json({ ok: true, source: "mensageiro_v3_compat", perfis: profiles });
  });
  router.post("/gerente/infracoes/reset", (req, res) => { const id = allowed(req, res); if (id) res.json({ ok: true, source: "mensageiro_v3_compat", infracoes: [] }); });

  return { router, stateFor };
}

module.exports = { createLegacyCompatRoutes, stateFor, attendanceConfig, legacyProfile, legacySchedule };
