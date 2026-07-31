const {
  ESTADO_OPERACIONAL,
  TEMPERATURA_OPERACIONAL,
  avaliarOportunidadeOperacional
} = require("./policy.service");

const LIMITE_AMOSTRA_OPERACIONAL = 20;

function incrementar(contadores, chave) {
  const nome = String(chave || "desconhecido");
  contadores[nome] = Number(contadores[nome] || 0) + 1;
}

function amostra(ids = [], limite = LIMITE_AMOSTRA_OPERACIONAL) {
  return ids.slice(0, limite);
}

function normalizarMarketplace(job = {}) {
  return String(job.marketplace || job.marketplace_detectado || "desconhecido").trim().toLowerCase() || "desconhecido";
}

function normalizarCliente(job = {}) {
  return String(job.cliente_id || job.clienteId || "sem_cliente").trim() || "sem_cliente";
}

function calcularPressaoOperacionalV2({ metricas = {}, filaAtiva = {}, analises = [] } = {}) {
  const pressao = metricas.pressao || {};
  const consumo = metricas.consumoReal || {};
  const totalAvaliado = Number(filaAtiva.quantidadeDisponivelAvaliada || analises.length || 0);
  const totalSelecionado = Number(filaAtiva.totalSelecionado || 0);
  const reserva = analises.filter(item => item.estado === ESTADO_OPERACIONAL.RESERVA).length;
  const expiradas = analises.filter(item => item.estado === ESTADO_OPERACIONAL.EXPIRADA).length;
  const aguaNova = analises.filter(item => item.aguaNova).length;

  return {
    backlogOperacional: Number(pressao.backlogOperacional || 0),
    pendentes: Number(pressao.pendentes || 0),
    prontosParaImportar: Number(pressao.prontosParaImportar || 0),
    consumoPorMinuto: Number(consumo.eventosPorMinuto || pressao.consumoPorMinuto || 0),
    activeQueuePreenchimentoPercentual: totalSelecionado > 0 && filaAtiva.tamanhoAlvo
      ? Number(((totalSelecionado / filaAtiva.tamanhoAlvo) * 100).toFixed(2))
      : 0,
    reservaOperacionalAvaliada: reserva,
    expiradasOperacionaisShadow: expiradas,
    aguaNovaAvaliada: aguaNova,
    quantidadeDisponivelAvaliada: totalAvaliado
  };
}

function calcularSaudeOperacional(pressao = {}) {
  const motivos = [];
  const backlog = Number(pressao.backlogOperacional || 0);
  const consumo = Number(pressao.consumoPorMinuto || 0);
  const expiradas = Number(pressao.expiradasOperacionaisShadow || 0);
  const preenchimento = Number(pressao.activeQueuePreenchimentoPercentual || 0);

  if (backlog > 0 && consumo <= 0) motivos.push("backlog_sem_consumo");
  if (preenchimento > 0 && preenchimento < 60) motivos.push("active_queue_incompleta");
  if (expiradas > 0) motivos.push("candidatas_expiracao_presentes");
  if (backlog > consumo * 30 && consumo > 0) motivos.push("backlog_acima_da_capacidade_30min");

  const nivel = motivos.includes("backlog_sem_consumo")
    ? "critica"
    : motivos.length
      ? "pressionada"
      : "saudavel";

  return {
    nivel,
    motivos
  };
}

function resumirAnalises(analises = [], jobsPorId = new Map()) {
  const temperaturas = {};
  const estados = {};
  const tipos = {};
  const activeQueuePorTemperatura = {};
  const reservaPorTemperatura = {};
  const expiracaoPorMotivo = {};
  const porMarketplaceAtiva = {};
  const porClienteAtiva = {};
  const idsAtivos = [];
  const idsReserva = [];
  const idsExpiracao = [];
  let somaTtlMs = 0;

  for (const item of analises) {
    incrementar(temperaturas, item.temperatura);
    incrementar(estados, item.estado);
    incrementar(tipos, item.tipoOperacional);
    somaTtlMs += Number(item.ttlMs || 0);

    const job = jobsPorId.get(String(item.id)) || {};
    if (item.estado === ESTADO_OPERACIONAL.ATIVA) {
      incrementar(activeQueuePorTemperatura, item.temperatura);
      incrementar(porMarketplaceAtiva, normalizarMarketplace(job));
      incrementar(porClienteAtiva, normalizarCliente(job));
      idsAtivos.push(item.id);
    }
    if (item.estado === ESTADO_OPERACIONAL.RESERVA) {
      incrementar(reservaPorTemperatura, item.temperatura);
      idsReserva.push(item.id);
    }
    if (item.candidataExpiracao) {
      incrementar(expiracaoPorMotivo, item.motivoExpiracao);
      idsExpiracao.push(item.id);
    }
  }

  return {
    temperaturas,
    estados,
    tiposOperacionais: tipos,
    ttlOperacional: {
      mediaMs: analises.length ? Math.round(somaTtlMs / analises.length) : 0
    },
    activeQueueDefinitiva: {
      total: estados[ESTADO_OPERACIONAL.ATIVA] || 0,
      porTemperatura: activeQueuePorTemperatura,
      porMarketplace: porMarketplaceAtiva,
      porCliente: porClienteAtiva,
      idsAmostra: amostra(idsAtivos)
    },
    reservaOperacional: {
      total: estados[ESTADO_OPERACIONAL.RESERVA] || 0,
      porTemperatura: reservaPorTemperatura,
      idsAmostra: amostra(idsReserva)
    },
    expiracaoOperacional: {
      candidatas: idsExpiracao.length,
      porMotivo: expiracaoPorMotivo,
      idsAmostra: amostra(idsExpiracao)
    }
  };
}

function criarPlanoOperacionalV2Shadow({ jobs = [], filaAtiva = {}, metricas = {}, agoraMs = Date.now() } = {}) {
  const selecionados = new Set((filaAtiva.idsSelecionados || []).map(id => String(id)));
  const jobsPorId = new Map(jobs.map(job => [String(job.id), job]));
  const analises = jobs.map(job => avaliarOportunidadeOperacional(job, {
    agoraMs,
    selecionada: selecionados.has(String(job.id))
  }));
  const resumo = resumirAnalises(analises, jobsPorId);
  const pressaoOperacional = calcularPressaoOperacionalV2({ metricas, filaAtiva, analises });
  const saudeOperacional = calcularSaudeOperacional(pressaoOperacional);
  const aguaNova = analises.filter(item => item.aguaNova);

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    totalAvaliado: jobs.length,
    pressaoOperacional,
    saudeOperacional,
    temperaturas: resumo.temperaturas,
    estados: resumo.estados,
    tiposOperacionais: resumo.tiposOperacionais,
    ttlOperacional: resumo.ttlOperacional,
    aguaNova: {
      total: aguaNova.length,
      selecionadas: aguaNova.filter(item => item.estado === ESTADO_OPERACIONAL.ATIVA).length,
      idsAmostra: amostra(aguaNova.map(item => item.id))
    },
    activeQueueDefinitiva: resumo.activeQueueDefinitiva,
    reservaOperacional: resumo.reservaOperacional,
    expiracaoOperacional: resumo.expiracaoOperacional
  };
}

module.exports = {
  calcularPressaoOperacionalV2,
  calcularSaudeOperacional,
  criarPlanoOperacionalV2Shadow,
  ESTADO_OPERACIONAL,
  TEMPERATURA_OPERACIONAL
};
