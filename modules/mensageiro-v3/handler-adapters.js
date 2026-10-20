"use strict";

// V3 configuration adapters.  The existing handlers still contain the
// transport, cooldown and audit logic used in production, but they must not
// read the legacy mensageiro-config.json after a workspace crosses the V3
// fence.  This module projects one authenticated V3 profile into the small
// handler contract and passes it explicitly to those handlers.

function card(profile, name) {
  const raw = profile?.cards?.[name];
  const configuration = raw?.configuration && typeof raw.configuration === "object"
    ? raw.configuration
    : {};
  return { ...(raw || {}), ...configuration, active: raw?.active === true };
}

function buildV3HandlerConfig(profile) {
  if (!profile?.workspaceId || !profile?.id) return null;
  const commands = card(profile, "commands");
  const attendance = card(profile, "attendance");
  const faq = card(profile, "faq");
  const flows = card(profile, "flows");
  const quickReplies = card(profile, "quickReplies");
  const manager = card(profile, "groupManager");
  const welcome = card(profile, "welcome");
  const farewell = card(profile, "farewell");
  const atendimento = {
    ...attendance,
    ativo: attendance.active === true,
    atendimentoAtivo: attendance.active === true,
    faqAtivo: faq.active === true,
    fluxosAtivo: flows.active === true,
    respostasRapidasAtivo: quickReplies.active === true,
    escopo: attendance.escopo || quickReplies.escopo || "privado",
    cooldownMinutos: attendance.cooldownMinutos ?? quickReplies.cooldownMinutos ?? 10,
    delaySegundos: attendance.delaySegundos ?? quickReplies.delaySegundos ?? 0,
    respostasRapidas: Array.isArray(attendance.respostasRapidas)
      ? attendance.respostasRapidas
      : (Array.isArray(quickReplies.respostasRapidas) ? quickReplies.respostasRapidas : []),
    gatilhos: [
      ...(Array.isArray(attendance.gatilhos) ? attendance.gatilhos : []).map(item => ({ ...item, categoria: item.categoria || "atendimento" })),
      ...(Array.isArray(faq.gatilhos) ? faq.gatilhos : []).map(item => ({ ...item, categoria: item.categoria || "faq" })),
      ...(Array.isArray(flows.gatilhos) ? flows.gatilhos : []).map(item => ({ ...item, categoria: item.categoria || "fluxos" }))
    ],
    sessaoId: String(attendance.sessaoId || profile.sessionId || ""),
    sessaoAtendimentoId: String(attendance.sessaoId || profile.sessionId || ""),
    configurado: true
  };
  const perfil = {
    id: profile.id,
    workspaceId: profile.workspaceId,
    nome: profile.name,
    ativo: profile.active === true,
    active: profile.active === true,
    sessaoId: profile.sessionId,
    grupos: Array.isArray(profile.destinations) ? profile.destinations.slice() : [],
    atendimento,
    modulos: {
      comandos: { ...commands, ativo: commands.active === true, comandos: commands.commands || commands.comandos || [] },
      gerente: { ...manager, ativo: manager.active === true, configuracao: manager.configuracao || manager },
      boasVindas: { ...welcome, ativo: welcome.active === true, conteudoConfigurado: true, configuracao: welcome.configuration || welcome },
      despedida: { ...farewell, ativo: farewell.active === true, conteudoConfigurado: true, configuracao: farewell.configuration || farewell },
      atendimento
    }
  };
  return {
    clienteId: profile.workspaceId,
    workspaceId: profile.workspaceId,
    ativo: profile.active === true,
    sessaoId: profile.sessionId,
    grupos: perfil.grupos,
    perfis: [perfil],
    comandos: perfil.modulos.comandos.comandos,
    atendimento,
    profileId: profile.id,
    __v3: true
  };
}

function createV3HandlerAdapters({ store } = {}) {
  if (!store || typeof store.getProfile !== "function") throw new Error("store_v3_obrigatorio");
  const configFor = args => {
    const workspaceId = String(args?.workspaceId || args?.clienteId || "").trim();
    const profileId = String(args?.profileId || "").trim();
    if (!workspaceId || !profileId) return null;
    store.reload?.();
    return buildV3HandlerConfig(store.getProfile(workspaceId, profileId));
  };
  const withConfig = args => ({ ...args, clienteId: args.workspaceId || args.clienteId, configOverride: configFor(args) });
  return {
    commands: args => require("../mensageiro/service").tratarMensagemGrupoComando(withConfig(args)),
    attendance: args => require("../mensageiro/service").tratarMensagemPrivadaAtendimento(withConfig(args)),
    groupManager: args => require("../mensageiro/gerente.service").tratarMensagemGrupoGerente(withConfig(args)),
    welcome: args => require("../mensageiro/service").tratarEventoGrupoMensageiro(withConfig(args)),
    farewell: args => require("../mensageiro/service").tratarEventoGrupoMensageiro(withConfig(args)),
    faq: args => require("../mensageiro/service").tratarMensagemPrivadaAtendimento(withConfig(args)),
    flows: args => require("../mensageiro/service").tratarMensagemPrivadaAtendimento(withConfig(args)),
    quickReplies: args => require("../mensageiro/service").tratarMensagemPrivadaAtendimento(withConfig(args))
  };
}

module.exports = { buildV3HandlerConfig, createV3HandlerAdapters };
