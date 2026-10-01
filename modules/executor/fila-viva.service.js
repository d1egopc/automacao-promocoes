"use strict";

const TTL_COMERCIAL_PADRAO_MS = 30 * 60 * 1000;
const AGUA_NOVA_MS = 5 * 60 * 1000;
const FRESCA_EM_RISCO_MS = 22 * 60 * 1000;

function limitarNumero(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return minimo;
  return Math.max(minimo, Math.min(maximo, numero));
}

function timestampFilaViva(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;

  const texto = String(valor || "").trim();
  if (!texto) return NaN;

  const brasileiro = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (brasileiro) {
    const [, dia, mes, ano, hora, minuto, segundo] = brasileiro;
    return new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo || 0)
    ).getTime();
  }

  const direto = Date.parse(texto);
  return Number.isFinite(direto) ? direto : NaN;
}

function timestampReferenciaOfertaFilaViva(oferta = {}) {
  const candidatos = [
    oferta.capturadoEm,
    oferta.capturadaEm,
    oferta.dataCaptura,
    oferta.radarCapturadoEm,
    oferta.criadoEmRadar,
    oferta.dataEntradaFila,
    oferta.criadoEm,
    oferta.dataCriacao
  ];

  for (const candidato of candidatos) {
    const ms = timestampFilaViva(candidato);
    if (Number.isFinite(ms)) return ms;
  }

  return 0;
}

function motivoSlotComDeadline(motivo, proximoElegivelEm, deadlineMs) {
  return Number.isFinite(proximoElegivelEm) &&
    Number.isFinite(deadlineMs) &&
    proximoElegivelEm > deadlineMs
    ? "sem_slot_antes_ttl"
    : motivo;
}

function proximoSlotElegivel(destino = {}, oferta = {}, agoraMs = Date.now(), opcoes = {}) {
  const agora = Number(agoraMs);
  const instanteAgora = Number.isFinite(agora) ? agora : Date.now();
  const intervalo = opcoes.intervalo && typeof opcoes.intervalo === "object"
    ? opcoes.intervalo
    : {};
  const deadlineMs = timestampFilaViva(oferta.expiraEm);

  if (opcoes.limiteDiarioOk === false) {
    return {
      liberadoAgora: false,
      proximoElegivelEm: NaN,
      deadlineMs,
      slackMs: NaN,
      motivoBloqueio: "limite_diario",
      slotAntesDoDeadline: null
    };
  }

  if (opcoes.dentroHorario !== true) {
    const proximoHorarioMs = Number(opcoes.proximoHorarioEm);
    return {
      liberadoAgora: false,
      proximoElegivelEm: Number.isFinite(proximoHorarioMs) ? proximoHorarioMs : NaN,
      deadlineMs,
      slackMs: Number.isFinite(proximoHorarioMs) && Number.isFinite(deadlineMs)
        ? deadlineMs - proximoHorarioMs
        : NaN,
      motivoBloqueio: motivoSlotComDeadline("fora_horario", proximoHorarioMs, deadlineMs),
      slotAntesDoDeadline: Number.isFinite(proximoHorarioMs) && Number.isFinite(deadlineMs)
        ? proximoHorarioMs <= deadlineMs
        : null
    };
  }

  if (intervalo.liberado === true) {
    return {
      liberadoAgora: true,
      proximoElegivelEm: instanteAgora,
      deadlineMs,
      slackMs: Number.isFinite(deadlineMs) ? deadlineMs - instanteAgora : NaN,
      motivoBloqueio: "",
      slotAntesDoDeadline: Number.isFinite(deadlineMs) ? instanteAgora <= deadlineMs : null
    };
  }

  const proximoIntervaloMs = timestampFilaViva(intervalo.proximoEnvioPermitidoEm);
  const restanteMs = Number(intervalo.restanteMs);
  const fallbackRestanteMs = Number.isFinite(restanteMs) && restanteMs >= 0
    ? instanteAgora + restanteMs
    : NaN;
  const cadenciaMs = Number(intervalo.intervaloMs);
  const fallbackCadenciaMs = Number.isFinite(cadenciaMs) && cadenciaMs >= 0
    ? instanteAgora + cadenciaMs
    : NaN;
  const proximoElegivelEm = Number.isFinite(proximoIntervaloMs)
    ? proximoIntervaloMs
    : Number.isFinite(fallbackRestanteMs)
      ? fallbackRestanteMs
      : fallbackCadenciaMs;

  return {
    liberadoAgora: false,
    proximoElegivelEm,
    deadlineMs,
    slackMs: Number.isFinite(proximoElegivelEm) && Number.isFinite(deadlineMs)
      ? deadlineMs - proximoElegivelEm
      : NaN,
    motivoBloqueio: motivoSlotComDeadline("intervalo", proximoElegivelEm, deadlineMs),
    slotAntesDoDeadline: Number.isFinite(proximoElegivelEm) && Number.isFinite(deadlineMs)
      ? proximoElegivelEm <= deadlineMs
      : null
  };
}

function cupomComercialFilaViva(oferta = {}) {
  if (oferta.cupomConfirmado === true || oferta.cupomValidado === true) return true;
  if (oferta.cupomDetectado === true || oferta.cupomDetectadoTexto === true) return true;

  const tipo = String(oferta.cupomTipo || oferta.tipoCupom || "").toLowerCase();
  if (["real", "detectado", "radar", "explicito"].includes(tipo)) return true;

  const cupom = String(oferta.cupom || oferta.codigoCupom || oferta.cupomCodigo || "").trim();
  if (!cupom) return false;

  return !/(pagina|p[a\u00e1]gina|api|prov[a\u00e1]vel|indispon[i\u00ed]vel|sem cupom)/i.test(cupom);
}

function prioridadeComercialFilaViva(oferta = {}) {
  const prioridade = limitarNumero(
    oferta.prioridadeEnvio ??
    oferta.prioridadeFila ??
    oferta.prioridade ??
    oferta.inteligenciaUniversalV2?.prioridade ??
    40,
    0,
    100
  );
  const turbo = oferta.turbo === true || oferta.cupomTurbo === true || oferta.turboElegivel === true;
  const cupom = cupomComercialFilaViva(oferta);

  return limitarNumero(prioridade + (cupom ? 18 : 0) + (turbo ? 10 : 0), 0, 100);
}

function scoreComercialFilaViva(oferta = {}) {
  return limitarNumero(
    oferta.radarScore ??
    oferta.score ??
    oferta.scoreFinal ??
    oferta.inteligenciaUniversalV2?.score ??
    0,
    0,
    100
  );
}

function laneFrescorFilaViva(idadeMs, ttlMs = TTL_COMERCIAL_PADRAO_MS) {
  if (!Number.isFinite(idadeMs) || idadeMs < 0) return "agua_nova";
  if (idadeMs >= ttlMs) return "expirada";
  if (idadeMs <= AGUA_NOVA_MS) return "agua_nova";
  if (idadeMs >= FRESCA_EM_RISCO_MS) return "fresca_em_risco";
  return "fresca_circulavel";
}

function calcularScoreFilaViva(oferta = {}, contexto = {}) {
  const agora = Number(contexto.agora || Date.now());
  const ttlMs = Number(contexto.ttlMs || TTL_COMERCIAL_PADRAO_MS);
  const referenciaMs = timestampReferenciaOfertaFilaViva(oferta);
  const idadeMs = referenciaMs > 0 ? Math.max(0, agora - referenciaMs) : ttlMs;
  const lane = laneFrescorFilaViva(idadeMs, ttlMs);

  const destinosCompativeis = Math.max(0, Number(contexto.destinosCompativeis || 0));
  const destinosDisponiveis = Math.max(0, Number(contexto.destinosDisponiveis || 0));
  const compatibilidade = destinosCompativeis > 0
    ? limitarNumero((destinosDisponiveis / destinosCompativeis) * 100, 0, 100)
    : 0;

  const frescor = limitarNumero((1 - idadeMs / ttlMs) * 100, 0, 100);
  const prioridade = prioridadeComercialFilaViva(oferta);
  const score = scoreComercialFilaViva(oferta);
  const turboComercial = oferta.turbo === true ||
    oferta.cupomTurbo === true ||
    oferta.turboElegivel === true ||
    oferta.tipoFluxo === "cupom_turbo" ||
    oferta.tipoOperacional === "cupom_turbo";
  const penalidadeIdade = idadeMs > ttlMs * 0.55
    ? Math.pow((idadeMs - ttlMs * 0.55) / (ttlMs * 0.45), 2) * 70
    : 0;

  const scoreFinal =
    frescor * 0.48 +
    prioridade * 0.26 +
    score * 0.16 +
    compatibilidade * 0.10 -
    penalidadeIdade;

  const urgenciaFanout = calcularUrgenciaFanoutParcial(oferta, {
    ...contexto,
    agora,
    ttlMs
  });
  const deadlineMs = timestampFilaViva(oferta.expiraEm);
  const proximoSlotMs = Number(contexto.proximoSlotMs);
  const deadlineSlackMs = Number.isFinite(Number(contexto.deadlineSlackMs))
    ? Number(contexto.deadlineSlackMs)
    : Number.isFinite(proximoSlotMs) && Number.isFinite(deadlineMs)
      ? deadlineMs - proximoSlotMs
      : Number.isFinite(deadlineMs)
        ? deadlineMs - agora
        : Infinity;

  return {
    scoreFinal,
    lane,
    idadeMs,
    frescor,
    prioridade,
    turboComercial,
    score,
    compatibilidade,
    destinosCompativeis,
    destinosDisponiveis,
    cupomComercial: cupomComercialFilaViva(oferta),
    fanoutParcial: urgenciaFanout.parcial,
    fanoutUrgente: urgenciaFanout.urgente,
    fanoutSlackMs: urgenciaFanout.slackMs,
    fanoutDeadlineMs: urgenciaFanout.deadlineMs,
    fanoutProximoSlotMs: urgenciaFanout.proximoSlotMs,
    fanoutDestinoChave: urgenciaFanout.destinoChave,
    deadlineMs,
    proximoSlotMs: Number.isFinite(proximoSlotMs) ? proximoSlotMs : NaN,
    deadlineSlackMs,
    destinoChaves: Array.isArray(contexto.destinoChaves)
      ? contexto.destinoChaves.map(valor => String(valor || "")).filter(Boolean)
      : []
  };
}

function calcularUrgenciaFanoutParcial(oferta = {}, contexto = {}) {
  const fanout = contexto.fanout || contexto.fanoutParcial || {};
  const parcial = fanout.parcial === true;
  const destinosPendentes = Array.isArray(fanout.destinosPendentes)
    ? fanout.destinosPendentes
    : [];
  const agora = Number(contexto.agora || Date.now());
  const deadlineMs = timestampFilaViva(oferta.expiraEm);

  if (!parcial || !destinosPendentes.length || !Number.isFinite(deadlineMs)) {
    return {
      parcial,
      urgente: false,
      slackMs: Infinity,
      deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : NaN,
      proximoSlotMs: NaN,
      destinoChave: ""
    };
  }

  const slots = destinosPendentes.map(item => {
    const intervalo = item?.intervalo || item || {};
    const intervaloMs = Number(intervalo.intervaloMs);
    const cadenciaMs = Number.isFinite(intervaloMs) && intervaloMs >= 0
      ? intervaloMs
      : Math.max(0, Number(intervalo.intervaloAplicadoMin || 0)) * 60 * 1000;
    const permitidoMs = timestampFilaViva(intervalo.proximoEnvioPermitidoEm);
    const liberado = item?.liberado === true || intervalo.liberado === true ||
      (Number.isFinite(permitidoMs) && permitidoMs <= agora);

    // Se o slot atual está aberto, perdê-lo empurra a próxima oportunidade
    // para depois de uma cadência. Se ainda está fechado, a próxima
    // oportunidade é o horário já calculado pelo controle do destino.
    const proximoSlotMs = liberado
      ? agora + cadenciaMs
      : (Number.isFinite(permitidoMs) ? permitidoMs : agora + cadenciaMs);

    return {
      proximoSlotMs,
      slackMs: deadlineMs - proximoSlotMs,
      destinoChave: String(item?.chave || intervalo.chaveControle || ""),
      cadenciaMs
    };
  }).filter(item => Number.isFinite(item.proximoSlotMs));

  if (!slots.length) {
    return {
      parcial: true,
      urgente: false,
      slackMs: Infinity,
      deadlineMs,
      proximoSlotMs: NaN,
      destinoChave: ""
    };
  }

  slots.sort((a, b) => a.slackMs - b.slackMs || a.proximoSlotMs - b.proximoSlotMs);
  const menor = slots[0];
  // A margem menor que uma cadência significa que uma oferta concorrente
  // pode consumir o slot e empurrar a entrega para depois do deadline.
  const margemDeRiscoMs = Math.max(menor.cadenciaMs, 60 * 1000);

  return {
    parcial: true,
    urgente: menor.slackMs <= margemDeRiscoMs,
    slackMs: menor.slackMs,
    deadlineMs,
    proximoSlotMs: menor.proximoSlotMs,
    destinoChave: menor.destinoChave
  };
}

function ordenarOfertasFilaViva(candidatos = [], contexto = {}) {
  return [...candidatos].map((candidato, indice) => ({ candidato, indice })).sort((aItem, bItem) => {
    const a = aItem.candidato;
    const b = bItem.candidato;
    const rankingA = a.ranking || calcularScoreFilaViva(a.oferta || a, contexto);
    const rankingB = b.ranking || calcularScoreFilaViva(b.oferta || b, contexto);
    const urgenteA = rankingA.fanoutUrgente === true;
    const urgenteB = rankingB.fanoutUrgente === true;
    const chaveUrgenteA = String(rankingA.fanoutDestinoChave || "");
    const chaveUrgenteB = String(rankingB.fanoutDestinoChave || "");
    const destinosB = new Set(Array.isArray(rankingB.destinoChaves) ? rankingB.destinoChaves : []);
    const destinosA = new Set(Array.isArray(rankingA.destinoChaves) ? rankingA.destinoChaves : []);
    const disputaA = urgenteA && chaveUrgenteA && destinosB.has(chaveUrgenteA);
    const disputaB = urgenteB && chaveUrgenteB && destinosA.has(chaveUrgenteB);

    if (disputaA !== disputaB) {
      return disputaA ? -1 : 1;
    }
    if (disputaA && disputaB) {
      if (rankingA.fanoutSlackMs !== rankingB.fanoutSlackMs) {
        return rankingA.fanoutSlackMs - rankingB.fanoutSlackMs;
      }
      if (rankingA.fanoutDeadlineMs !== rankingB.fanoutDeadlineMs) {
        return rankingA.fanoutDeadlineMs - rankingB.fanoutDeadlineMs;
      }
    }
    const slackA = Number(rankingA.deadlineSlackMs);
    const slackB = Number(rankingB.deadlineSlackMs);
    const deadlineAware = Number.isFinite(slackA) || Number.isFinite(slackB);
    if (deadlineAware) {
      if (rankingB.turboComercial !== rankingA.turboComercial) return rankingA.turboComercial ? -1 : 1;
      if (rankingB.prioridade !== rankingA.prioridade) return rankingB.prioridade - rankingA.prioridade;
      if (Number.isFinite(slackA) && Number.isFinite(slackB) && slackA !== slackB) return slackA - slackB;
      if (Number.isFinite(slackA) !== Number.isFinite(slackB)) return Number.isFinite(slackA) ? -1 : 1;
    }
    if (rankingB.scoreFinal !== rankingA.scoreFinal) return rankingB.scoreFinal - rankingA.scoreFinal;
    if (rankingA.idadeMs !== rankingB.idadeMs) return rankingA.idadeMs - rankingB.idadeMs;
    const idA = String((a.oferta || a).id || "");
    const idB = String((b.oferta || b).id || "");
    return idA.localeCompare(idB) || (aItem.indice - bItem.indice);
  }).map(item => item.candidato);
}

module.exports = {
  TTL_COMERCIAL_PADRAO_MS,
  AGUA_NOVA_MS,
  FRESCA_EM_RISCO_MS,
  calcularScoreFilaViva,
  calcularUrgenciaFanoutParcial,
  proximoSlotElegivel,
  cupomComercialFilaViva,
  laneFrescorFilaViva,
  ordenarOfertasFilaViva,
  prioridadeComercialFilaViva,
  scoreComercialFilaViva,
  timestampReferenciaOfertaFilaViva,
  timestampFilaViva
};
