function motivosUnicos(motivos = []) {
  return [...new Set((Array.isArray(motivos) ? motivos : []).filter(Boolean).map(String))];
}

function resultadoTentouEnvio(resultado = {}) {
  return resultado?.tentouEnvio === true;
}

function motivoAguardandoPrioritario(motivos = [], destinosElegiveis = 0, destinosTentados = 0) {
  const lista = motivosUnicos(motivos);
  const prioridades = [
    ["fora_horario", "janela_fechada"],
    ["intervalo", "proxima_tentativa_futura"],
    ["limite_diario", "limite_diario_destino"],
    ["sessao_nao_encontrada", "sessao_whatsapp_indisponivel"],
    ["sessao_offline", "sessao_whatsapp_indisponivel"],
    ["nenhum_telegram_selecionado", "telegram_inativo_ou_nao_configurado"],
    ["telegram_nao_enviado", "telegram_inativo_ou_nao_configurado"],
    ["sem_grupos", "destino_whatsapp_sem_grupos"],
    ["sem_creditos", "aguardando_creditos"],
    ["credenciais_ausentes", "destino_sem_credenciais"]
  ];

  for (const [motivo, resumo] of prioridades) {
    if (lista.includes(motivo)) return resumo;
  }

  if (!destinosElegiveis) return "sem_destino_elegivel";
  if (!destinosTentados) return "nenhum_destino_realmente_tentado";
  return lista[0] || "aguardando_destino_disponivel";
}

function decidirStatusExecutorSemEnvio({
  destinosElegiveis = 0,
  destinosTentados = 0,
  houveFalhaReal = false,
  motivosSemEnvio = []
} = {}) {
  const elegiveis = Math.max(0, Number(destinosElegiveis) || 0);
  const tentados = Math.max(0, Number(destinosTentados) || 0);
  const todosElegiveisTentados = elegiveis > 0 && tentados >= elegiveis;
  const erroRealConfirmado = todosElegiveisTentados && houveFalhaReal === true;

  if (erroRealConfirmado) {
    return {
      statusFinal: "erro",
      motivoSemEnvio: "todos_destinos_falharam_apos_tentativa_real",
      todosElegiveisTentados,
      erroRealConfirmado
    };
  }

  return {
    statusFinal: "pendente",
    motivoSemEnvio: motivoAguardandoPrioritario(motivosSemEnvio, elegiveis, tentados),
    todosElegiveisTentados,
    erroRealConfirmado: false
  };
}

module.exports = {
  resultadoTentouEnvio,
  decidirStatusExecutorSemEnvio
};
