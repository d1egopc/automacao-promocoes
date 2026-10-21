const INTEGRATION_MATRIX = Object.freeze({
  scheduledMessages: {
    card: "scheduled",
    engine: "V3Store + V3Scheduler",
    status: "implemented_isolated",
    requiredProductionAdapters: ["route_programacoes_v3", "transport_authorizeSend", "transport_sendMessage"]
  },
  commands: {
    card: "commands",
    engine: "handler-bridge -> tratarMensagemGrupoComando",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_comandos_v3", "command_dispatcher", "session_authorization"]
  },
  attendance: {
    card: "attendance",
    engine: "handler-bridge -> tratarMensagemPrivadaAtendimento",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_atendimento_v3", "attendance_dispatcher", "profile_session_guard"]
  },
  groupManager: {
    card: "groupManager",
    engine: "handler-bridge -> tratarMensagemGrupoGerente",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_gerente_grupos_v3", "group_manager_dispatcher", "group_ownership_guard"]
  },
  welcome: {
    card: "welcome",
    engine: "handler-bridge -> tratarEventoGrupoMensageiro",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_boas_vindas_v3", "welcome_dispatcher", "profile_session_guard"]
  },
  farewell: {
    card: "farewell",
    engine: "handler-bridge -> tratarEventoGrupoMensageiro",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_despedida_v3", "farewell_dispatcher", "profile_session_guard"]
  },
  faq: {
    card: "faq",
    engine: "handler-bridge -> tratarMensagemPrivadaAtendimento",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_faq_v3", "attendance_dispatcher", "profile_session_guard"]
  },
  flows: {
    card: "flows",
    engine: "handler-bridge -> tratarMensagemPrivadaAtendimento",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_fluxos_v3", "attendance_dispatcher", "profile_session_guard"]
  },
  quickReplies: {
    card: "quickReplies",
    engine: "handler-bridge -> tratarMensagemPrivadaAtendimento",
    status: "v3_config_adapter_real_handler",
    requiredProductionAdapters: ["route_respostas_rapidas_v3", "attendance_dispatcher", "profile_session_guard"]
  }
});

function integrationReadiness() {
  return Object.fromEntries(Object.entries(INTEGRATION_MATRIX).map(([name, value]) => [name, value.status]));
}

module.exports = { INTEGRATION_MATRIX, integrationReadiness };
