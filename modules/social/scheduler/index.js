const {
  executarAutomaticoTodosClientes,
  executarAgendamentosPendentesTodosClientes
} = require("../automatico.service");
const { logSocial, logErroSocial } = require("../logs");

let intervaloScheduler = null;
let executando = false;

function payloadAgendamentoSocialPadrao() {
  return {
    nome: "",
    ativo: false,
    redes: ["instagram"],
    horario: "",
    timezone: "America/Sao_Paulo",
    regras: {}
  };
}

function intervaloMsScheduler() {
  const minutos = Number(process.env.SOCIAL_AGENDAMENTOS_INTERVALO_MINUTOS || 1);
  const seguro = Number.isFinite(minutos) ? Math.max(1, Math.min(60, minutos)) : 1;
  return seguro * 60 * 1000;
}

function schedulerAgendamentosAtivo() {
  return String(process.env.SOCIAL_AGENDAMENTOS_SCHEDULER || "true").trim().toLowerCase() !== "false";
}

async function executarRodadaSchedulerAgendamentosSocial({
  agora = new Date(),
  renderizadorArte,
  httpClient,
  polling
} = {}) {
  if (executando) {
    logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-SKIP]", { motivo: "rodada_em_execucao" });
    return { ok: false, motivo: "rodada_em_execucao" };
  }

  executando = true;
  try {
    logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-INICIO]", { agora: agora.toISOString() });
    const automatico = await executarAutomaticoTodosClientes({ agora });
    const agendamentos = await executarAgendamentosPendentesTodosClientes({
      agora,
      renderizadorArte,
      httpClient,
      polling
    });
    const resultado = {
      ok: automatico.ok !== false && agendamentos.ok !== false,
      clientes: agendamentos.clientes,
      totalAgendadosAutomatico: automatico.totalAgendados || 0,
      totalExecutados: agendamentos.totalExecutados || 0,
      automatico,
      agendamentos
    };
    logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-FIM]", {
      clientes: resultado.clientes,
      totalAgendadosAutomatico: resultado.totalAgendadosAutomatico,
      totalExecutados: resultado.totalExecutados
    });
    return resultado;
  } catch (e) {
    logErroSocial({ erro: e.message, origem: "SOCIAL-AGENDAMENTOS-SCHEDULER" });
    return { ok: false, erro: e.message || "social_scheduler_agendamentos_falhou" };
  } finally {
    executando = false;
  }
}

function iniciarSchedulerAgendamentosSocial() {
  if (!schedulerAgendamentosAtivo()) {
    logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-DESATIVADO]", { motivo: "env" });
    return null;
  }
  if (intervaloScheduler) return intervaloScheduler;

  const intervaloMs = intervaloMsScheduler();
  intervaloScheduler = setInterval(() => {
    executarRodadaSchedulerAgendamentosSocial().catch(erro => {
      logErroSocial({ erro: erro.message, origem: "SOCIAL-AGENDAMENTOS-SCHEDULER" });
    });
  }, intervaloMs);
  if (typeof intervaloScheduler.unref === "function") intervaloScheduler.unref();

  logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-ATIVO]", { intervaloMs });
  return intervaloScheduler;
}

function pararSchedulerAgendamentosSocial() {
  if (!intervaloScheduler) return false;
  clearInterval(intervaloScheduler);
  intervaloScheduler = null;
  executando = false;
  logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-PARADO]", {});
  return true;
}

module.exports = {
  payloadAgendamentoSocialPadrao,
  executarRodadaSchedulerAgendamentosSocial,
  iniciarSchedulerAgendamentosSocial,
  pararSchedulerAgendamentosSocial
};
