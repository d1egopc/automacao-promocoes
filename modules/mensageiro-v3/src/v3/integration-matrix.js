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
  }
});

function integrationReadiness() {
  return Object.fromEntries(Object.entries(INTEGRATION_MATRIX).map(([name, value]) => [name, value.status]));
}

module.exports = { INTEGRATION_MATRIX, integrationReadiness };
