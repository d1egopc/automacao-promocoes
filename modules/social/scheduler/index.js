const {
  executarAutomaticoTodosClientes,
  executarAgendamentosPendentesTodosClientes
} = require("../automatico.service");
const { logSocial, logErroSocial } = require("../logs");

let intervaloScheduler = null;
let executando = false;
let proximoIdRodadaBackground = 1;
const PERF_BACKGROUND_MIN_MS = Number(process.env.PERF_BACKGROUND_MIN_MS || 200);
const perfBackgroundAtivos = new Map();

function memoriaPerfResumo() {
  const memoria = process.memoryUsage();
  return {
    heapUsedMb: Math.round(memoria.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memoria.heapTotal / 1024 / 1024),
    rssMb: Math.round(memoria.rss / 1024 / 1024)
  };
}

function logPerfBackground(tag, payload) {
  console.log(`${tag} ${JSON.stringify(payload || {})}`);
}

function iniciarPerfBackground(rotina = "background") {
  const nomeRotina = String(rotina || "background");
  const rodadaId = `bg_${Date.now()}_${proximoIdRodadaBackground++}`;
  const inicioHr = process.hrtime.bigint();
  const cpuInicio = process.cpuUsage();
  const chamadasAtivas = (perfBackgroundAtivos.get(nomeRotina) || 0) + 1;
  let finalizado = false;
  let inicioLogado = false;

  perfBackgroundAtivos.set(nomeRotina, chamadasAtivas);

  if (chamadasAtivas > 1) {
    logPerfBackground("[PERF BACKGROUND SOBREPOSICAO]", {
      rotina: nomeRotina,
      chamadasAtivas
    });
  }

  const timerInicio = setTimeout(() => {
    if (finalizado) return;
    inicioLogado = true;
    logPerfBackground("[PERF BACKGROUND INICIO]", {
      rotina: nomeRotina,
      rodadaId,
      chamadasAtivas,
      iniciadoEm: new Date().toISOString()
    });
  }, Math.max(1, PERF_BACKGROUND_MIN_MS));
  timerInicio.unref?.();

  return function finalizarPerfBackground(ok = true, extra = {}) {
    if (finalizado) return;
    finalizado = true;
    clearTimeout(timerInicio);
    const atuais = Math.max(0, (perfBackgroundAtivos.get(nomeRotina) || 1) - 1);
    if (atuais > 0) {
      perfBackgroundAtivos.set(nomeRotina, atuais);
    } else {
      perfBackgroundAtivos.delete(nomeRotina);
    }

    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicioHr) / 1e6);
    if (!inicioLogado && duracaoMs < PERF_BACKGROUND_MIN_MS) return;

    const cpu = process.cpuUsage(cpuInicio);
    logPerfBackground("[PERF BACKGROUND FIM]", {
      rotina: nomeRotina,
      rodadaId,
      duracaoMs,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      chamadasAtivas: atuais,
      memoria: memoriaPerfResumo(),
      ok: ok !== false,
      ...extra
    });
  };
}

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
  const finalizarPerf = iniciarPerfBackground("social_agendamentos_scheduler");
  let okPerf = true;
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
    okPerf = false;
    logErroSocial({ erro: e.message, origem: "SOCIAL-AGENDAMENTOS-SCHEDULER" });
    return { ok: false, erro: e.message || "social_scheduler_agendamentos_falhou" };
  } finally {
    executando = false;
    finalizarPerf(okPerf);
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
