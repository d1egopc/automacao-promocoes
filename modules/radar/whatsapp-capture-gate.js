const TIME_ZONE = "America/Sao_Paulo";
const FORMATADOR_LOCAL = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function minutosHora(valor) {
  if (!/^\d{2}:\d{2}$/.test(String(valor || ""))) return null;
  const [hora, minuto] = String(valor).split(":").map(Number);
  return hora <= 23 && minuto <= 59 ? hora * 60 + minuto : null;
}

function dataHoraLocal(data) {
  const partes = FORMATADOR_LOCAL.formatToParts(data);
  const campos = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return {
    ano: Number(campos.year),
    mes: Number(campos.month),
    dia: Number(campos.day),
    minutos: Number(campos.hour) * 60 + Number(campos.minute)
  };
}

function chaveLocal({ ano, mes, dia, minutos }) {
  return (((ano * 100 + mes) * 100 + dia) * 1440) + minutos;
}

function diaAnterior({ ano, mes, dia }) {
  const anterior = new Date(Date.UTC(ano, mes - 1, dia - 1));
  return { ano: anterior.getUTCFullYear(), mes: anterior.getUTCMonth() + 1, dia: anterior.getUTCDate() };
}

function avaliarJanela(config = {}, agora = new Date()) {
  const inicio = minutosHora(config.monitoramento?.horaInicial);
  const fim = minutosHora(config.monitoramento?.horaFinal);
  if (inicio === null || fim === null || !Number.isFinite(agora.getTime())) {
    return { dentroJanela: false, inicioJanela: null };
  }
  const local = dataHoraLocal(agora);
  const dentroJanela = inicio === fim || (inicio < fim
    ? local.minutos >= inicio && local.minutos <= fim
    : local.minutos >= inicio || local.minutos <= fim);
  if (inicio === fim) return { dentroJanela: true, inicioJanela: 0 };
  const diaInicio = inicio > fim && local.minutos <= fim ? diaAnterior(local) : local;
  return {
    dentroJanela,
    inicioJanela: chaveLocal({ ...diaInicio, minutos: inicio })
  };
}

function timestampMensagemMs(valor) {
  const numero = Number(String(valor ?? ""));
  return Number.isSafeInteger(numero) && numero > 0 ? numero * 1000 : null;
}

function avaliarGateCapturaRadarWhatsapp({
  config = {}, sessaoId = "", grupoId = "", grupoNome = "",
  agora = new Date(), bootAtMs = 0, mensagemTimestamp,
  exigirMensagemNova = false, upsertType,
  idsSessao, grupoMonitorado
} = {}) {
  if (config.monitoramentoAtivo !== true) {
    return { ok: false, motivo: "radar_monitoramento_inativo" };
  }
  const janela = avaliarJanela(config, agora);
  if (!janela.dentroJanela) {
    return { ok: false, motivo: "fora_do_horario_monitoramento" };
  }
  const sessoes = Array.isArray(config.sessoesWhatsappMonitoradas) ? config.sessoesWhatsappMonitoradas : [];
  const idsEntrada = typeof idsSessao === "function" ? idsSessao(sessaoId) : new Set([String(sessaoId || "")]);
  const sessao = sessoes.find(item => {
    const idsPermitidos = typeof idsSessao === "function" ? idsSessao(item?.sessaoId) : new Set([String(item?.sessaoId || "")]);
    return [...idsEntrada].some(id => idsPermitidos.has(id));
  });
  if (!sessao) return { ok: false, motivo: "sessao_whatsapp_nao_monitorada" };
  const grupoOk = typeof grupoMonitorado === "function"
    ? grupoMonitorado(sessao, grupoId, grupoNome) === true
    : (sessao.gruposMonitorados || []).some(grupo => String(grupo?.grupoId || "") === String(grupoId || ""));
  if (!grupoOk) return { ok: false, motivo: "grupo_whatsapp_nao_monitorado" };

  if (exigirMensagemNova) {
    if (upsertType !== "notify") return { ok: false, motivo: "whatsapp_upsert_historico" };
    const mensagemMs = timestampMensagemMs(mensagemTimestamp);
    if (mensagemMs === null) return { ok: false, motivo: "whatsapp_timestamp_ausente" };
    const ativadoEm = config.monitoramentoAtivadoEm;
    const ativadoMs = ativadoEm ? Date.parse(ativadoEm) : 0;
    if (ativadoEm && !Number.isFinite(ativadoMs)) return { ok: false, motivo: "radar_ativacao_invalida" };
    if (mensagemMs < bootAtMs || mensagemMs <= ativadoMs) {
      return { ok: false, motivo: "whatsapp_mensagem_anterior_ativacao" };
    }
    const localMensagem = dataHoraLocal(new Date(mensagemMs));
    if (chaveLocal(localMensagem) < janela.inicioJanela) {
      return { ok: false, motivo: "whatsapp_mensagem_anterior_janela" };
    }
  }
  return { ok: true, motivo: "permitido" };
}

module.exports = { avaliarGateCapturaRadarWhatsapp, avaliarJanela };
