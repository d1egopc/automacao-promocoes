"use strict";

const TAG_LOG = "[DEMAND-SCHEDULER]";

function texto(valor = "") {
  return String(valor || "").trim();
}

function numero(valor, fallback = 0) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : fallback;
}

function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function demandSchedulerAtivo(env = process.env) {
  const valor = texto(env?.DEMAND_SCHEDULER_ENABLED).toLowerCase();
  return valor === "1" || valor === "true";
}

function chaveDestinoSegura(destino = {}) {
  const item = destino && typeof destino === "object" ? destino : {};
  return texto(
    item.id ||
    item.destinoId ||
    item.destino_id ||
    item.conexaoId ||
    item.chatId ||
    item.nome ||
    item.tipo ||
    "destino"
  ).slice(0, 120);
}

function idOfertaSeguro(oferta = {}) {
  const item = oferta && typeof oferta === "object" ? oferta : {};
  return texto(item.id || item.filaItemId || item.engineOfertaId || item.ofertaId || "").slice(0, 120);
}

function calcularDemandaDestino(item = {}, agoraMs = Date.now()) {
  const intervalo = item?.intervalo && typeof item.intervalo === "object"
    ? item.intervalo
    : {};
  const intervaloMs = Math.max(
    1,
    numero(intervalo.intervaloMs, numero(intervalo.intervaloAplicadoMin, 0) * 60 * 1000)
  );
  const ultimoEnvio = Math.max(0, numero(intervalo.ultimoEnvio, numero(item.ultimoEnvio, 0)));
  const restanteMs = Math.max(0, numero(intervalo.restanteMs, 0));
  const liberado = intervalo.liberado === true || item.liberado === true;
  const esperaMs = ultimoEnvio > 0 ? Math.max(0, numero(agoraMs, Date.now()) - ultimoEnvio) : intervaloMs;
  const progresso = liberado
    ? 1 + limitar((esperaMs - intervaloMs) / intervaloMs, 0, 1)
    : limitar(1 - restanteMs / intervaloMs, 0, 0.999999);
  const turbo = intervalo.turboAplicado === true;

  return {
    valor: Number(progresso.toFixed(6)),
    nivel: liberado ? "alta" : (progresso >= 0.65 ? "crescente" : "baixa"),
    liberado,
    esperaMs,
    restanteMs,
    intervaloMs,
    turbo,
    faixa: turbo ? "turbo" : "normal",
    destinoChave: chaveDestinoSegura(item?.destino || item)
  };
}

function demandaDaAvaliacao(avaliacao = {}, agoraMs = Date.now()) {
  const destinos = Array.isArray(avaliacao.destinosLiberados) ? avaliacao.destinosLiberados : [];
  const demandas = destinos.map(item => calcularDemandaDestino(item, agoraMs));
  demandas.sort((a, b) => {
    if (a.turbo !== b.turbo) return a.turbo ? -1 : 1;
    if (b.valor !== a.valor) return b.valor - a.valor;
    if (b.esperaMs !== a.esperaMs) return b.esperaMs - a.esperaMs;
    return a.destinoChave.localeCompare(b.destinoChave);
  });

  return demandas[0] || {
    valor: 0,
    nivel: "baixa",
    liberado: false,
    esperaMs: 0,
    restanteMs: 0,
    intervaloMs: 0,
    turbo: false,
    faixa: "normal",
    destinoChave: ""
  };
}

function ordenarCandidatosPorDemanda(candidatos = [], contexto = {}, ordenarLegado = itens => [...itens]) {
  const agoraMs = numero(contexto.agora, Date.now());
  const elegiveis = (Array.isArray(candidatos) ? candidatos : []).filter(item => item?.elegivel !== false);
  const baseLegada = ordenarLegado(elegiveis, contexto);

  return baseLegada
    .map((candidato, indiceLegado) => ({
      candidato,
      indiceLegado,
      demanda: demandaDaAvaliacao(candidato, agoraMs)
    }))
    .sort((a, b) => {
      const fanoutUrgenteA = a.candidato?.ranking?.fanoutUrgente === true;
      const fanoutUrgenteB = b.candidato?.ranking?.fanoutUrgente === true;
      if (fanoutUrgenteA !== fanoutUrgenteB) return fanoutUrgenteA ? -1 : 1;
      if (a.demanda.turbo !== b.demanda.turbo) return a.demanda.turbo ? -1 : 1;
      const prioridadeA = numero(a.candidato?.ranking?.prioridade, 0);
      const prioridadeB = numero(b.candidato?.ranking?.prioridade, 0);
      if (prioridadeB !== prioridadeA) return prioridadeB - prioridadeA;
      const slackA = numero(a.candidato?.ranking?.deadlineSlackMs, NaN);
      const slackB = numero(b.candidato?.ranking?.deadlineSlackMs, NaN);
      if (Number.isFinite(slackA) && Number.isFinite(slackB) && slackA !== slackB) return slackA - slackB;
      if (Number.isFinite(slackA) !== Number.isFinite(slackB)) return Number.isFinite(slackA) ? -1 : 1;
      if (b.demanda.valor !== a.demanda.valor) return b.demanda.valor - a.demanda.valor;
      return a.indiceLegado - b.indiceLegado;
    })
    .map(item => ({
      ...item.candidato,
      demandScheduler: item.demanda
    }));
}

function ordenarDestinosPorDemanda(destinos = [], agoraMs = Date.now()) {
  return (Array.isArray(destinos) ? destinos : [])
    .map((item, indiceOriginal) => ({
      item,
      indiceOriginal,
      demanda: calcularDemandaDestino(item, agoraMs)
    }))
    .sort((a, b) => {
      if (a.demanda.liberado !== b.demanda.liberado) return a.demanda.liberado ? -1 : 1;
      if (a.demanda.turbo !== b.demanda.turbo) return a.demanda.turbo ? -1 : 1;
      if (b.demanda.valor !== a.demanda.valor) return b.demanda.valor - a.demanda.valor;
      if (b.demanda.esperaMs !== a.demanda.esperaMs) return b.demanda.esperaMs - a.demanda.esperaMs;
      const chave = a.demanda.destinoChave.localeCompare(b.demanda.destinoChave);
      return chave || a.indiceOriginal - b.indiceOriginal;
    })
    .map(item => ({
      ...item.item,
      demandScheduler: item.demanda
    }));
}

function criarDemandScheduler({ env = process.env, logger = console } = {}) {
  let cursorWorkspace = 0;

  function ativo() {
    return demandSchedulerAtivo(env);
  }

  function ordenarWorkspaces(workspaces = []) {
    const itens = Array.isArray(workspaces) ? [...workspaces] : [];
    if (!ativo() || itens.length < 2) return itens;
    try {
      const inicio = cursorWorkspace % itens.length;
      cursorWorkspace = (inicio + 1) % itens.length;
      return itens.slice(inicio).concat(itens.slice(0, inicio));
    } catch (_) {
      return itens;
    }
  }

  function ordenarCandidatos(candidatos = [], contexto = {}, ordenarLegado) {
    if (!ativo()) return ordenarLegado(candidatos, contexto);
    try {
      return ordenarCandidatosPorDemanda(candidatos, contexto, ordenarLegado);
    } catch (_) {
      return ordenarLegado(candidatos, contexto);
    }
  }

  function ordenarDestinos(destinos = [], agoraMs = Date.now()) {
    if (!ativo()) {
      return [...destinos].sort((a, b) => numero(a?.ultimoEnvio, 0) - numero(b?.ultimoEnvio, 0));
    }
    try {
      return ordenarDestinosPorDemanda(destinos, agoraMs);
    } catch (_) {
      return [...destinos].sort((a, b) => numero(a?.ultimoEnvio, 0) - numero(b?.ultimoEnvio, 0));
    }
  }

  function registrar(evento = "decisao", dados = {}) {
    if (!ativo() || !logger || typeof logger.log !== "function") return;
    const demanda = dados.demanda && typeof dados.demanda === "object" ? dados.demanda : {};
    try {
      logger.log(TAG_LOG, JSON.stringify({
        evento: texto(evento).slice(0, 80),
        workspace: texto(dados.workspace || dados.clienteId || "").slice(0, 120),
        destino: chaveDestinoSegura(dados.destino || { id: demanda.destinoChave }),
        demanda: texto(demanda.nivel || dados.nivel || "").slice(0, 40),
        elegivel: dados.elegivel === true,
        bloqueio: texto(dados.bloqueio || dados.motivo || "").slice(0, 120),
        oferta: idOfertaSeguro(dados.oferta),
        faixa: texto(demanda.faixa || dados.faixa || "normal").slice(0, 20),
        esperaMs: Math.max(0, numero(demanda.esperaMs, dados.esperaMs || 0)),
        resultado: texto(dados.resultado || "").slice(0, 80)
      }));
    } catch (_) {}
  }

  return {
    ativo,
    ordenarWorkspaces,
    ordenarCandidatos,
    ordenarDestinos,
    registrar
  };
}

module.exports = {
  TAG_LOG,
  calcularDemandaDestino,
  criarDemandScheduler,
  demandaDaAvaliacao,
  demandSchedulerAtivo,
  ordenarCandidatosPorDemanda,
  ordenarDestinosPorDemanda
};
