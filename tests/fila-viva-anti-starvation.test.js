"use strict";

const assert = require("assert");
const {
  calcularScoreFilaViva,
  ordenarOfertasFilaViva
} = require("../modules/executor/fila-viva.service");

const agora = Date.parse("2026-09-20T00:38:07.000Z");
const intervaloMs = 7 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function oferta(id, overrides = {}) {
  return {
    id,
    status: "pendente",
    capturadaEm: iso(agora - 5 * 60 * 1000),
    expiraEm: iso(agora + 30 * 60 * 1000),
    prioridadeEnvio: 40,
    score: 50,
    ...overrides
  };
}

function fanout(overrides = {}) {
  return {
    parcial: true,
    destinosEnviados: 4,
    destinosPendentes: [{
      chave: "workspace_destino",
      liberado: true,
      intervalo: {
        liberado: true,
        intervaloMs,
        intervaloAplicadoMin: 7,
        proximoEnvioPermitidoEm: iso(agora - 1000)
      },
      ...overrides
    }]
  };
}

function candidato(item, contexto = {}) {
  return {
    oferta: item,
    ranking: calcularScoreFilaViva(item, {
      agora,
      destinosCompativeis: 5,
      destinosDisponiveis: 1,
      destinoChaves: contexto.destinoChaves ||
        (contexto.fanout?.destinosPendentes || []).map(destino => destino.chave).filter(Boolean),
      ...contexto
    })
  };
}

{
  const parcialEmRisco = oferta("parcial_em_risco", {
    expiraEm: iso(agora + 7 * 60 * 1000 + 30 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const comercial = oferta("comercial", { score: 100, prioridadeEnvio: 100 });

  const ordenadas = ordenarOfertasFilaViva([
    candidato(comercial, { destinoChaves: ["workspace_destino"] }),
    candidato(parcialEmRisco, { fanout: fanout() })
  ], { agora });

  assert.strictEqual(ordenadas[0].oferta.id, "parcial_em_risco");
  assert.strictEqual(ordenadas[0].ranking.fanoutUrgente, true);
  assert(ordenadas[0].ranking.fanoutSlackMs <= intervaloMs);
}

{
  const parcialSemRisco = oferta("parcial_sem_risco", {
    expiraEm: iso(agora + 40 * 60 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const comercial = oferta("comercial", { score: 100, prioridadeEnvio: 100 });

  const ordenadas = ordenarOfertasFilaViva([
    candidato(parcialSemRisco, { fanout: fanout() }),
    candidato(comercial, { destinoChaves: ["workspace_destino"] })
  ], { agora });

  assert.strictEqual(ordenadas[0].oferta.id, "comercial");
  assert.strictEqual(
    candidato(parcialSemRisco, { fanout: fanout() }).ranking.fanoutUrgente,
    false
  );
}

{
  const parcial = oferta("recalculo", {
    expiraEm: iso(agora + 20 * 60 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const antes = candidato(parcial, { fanout: fanout() }).ranking;
  const depois = candidato(parcial, {
    fanout: fanout({
      liberado: false,
      intervalo: {
        liberado: false,
        intervaloMs,
        intervaloAplicadoMin: 7,
        proximoEnvioPermitidoEm: iso(agora + 14 * 60 * 1000)
      }
    })
  }).ranking;

  assert.strictEqual(antes.fanoutUrgente, false);
  assert.strictEqual(depois.fanoutUrgente, true);
  assert(depois.fanoutSlackMs < antes.fanoutSlackMs);
}

{
  const parcialUrgente = oferta("parcial_urgente_turbo", {
    expiraEm: iso(agora + 7 * 60 * 1000 + 30 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const turbo = oferta("turbo", {
    turbo: true,
    cupomTurbo: true,
    score: 90,
    prioridadeEnvio: 100
  });

  const ordenadas = ordenarOfertasFilaViva([
    candidato(turbo, { destinoChaves: ["workspace_destino"] }),
    candidato(parcialUrgente, { fanout: fanout() })
  ], { agora });
  assert.strictEqual(ordenadas[0].oferta.id, "parcial_urgente_turbo");

  const parcialNormal = oferta("parcial_normal_turbo", {
    expiraEm: iso(agora + 40 * 60 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const ordenadasSemRisco = ordenarOfertasFilaViva([
    candidato(turbo, { destinoChaves: ["workspace_destino"] }),
    candidato(parcialNormal, { fanout: fanout() })
  ], { agora });
  assert.strictEqual(ordenadasSemRisco[0].oferta.id, "turbo");
}

{
  const urgenteOutroDestino = oferta("urgente_outro_destino", {
    expiraEm: iso(agora + 7 * 60 * 1000 + 30 * 1000),
    score: 1,
    prioridadeEnvio: 1
  });
  const comercialMesmoDestino = oferta("comercial_destino_alvo", {
    score: 100,
    prioridadeEnvio: 100
  });
  const ordenadas = ordenarOfertasFilaViva([
    candidato(urgenteOutroDestino, {
      fanout: fanout({ chave: "destino_outro" }),
      destinoChaves: ["destino_outro"]
    }),
    candidato(comercialMesmoDestino, { destinoChaves: ["workspace_destino"] })
  ], { agora });
  assert.strictEqual(
    ordenadas[0].oferta.id,
    "comercial_destino_alvo",
    "anti-starvation so deve disputar ofertas do mesmo destino"
  );
}

{
  const parcialSemDestinoPendente = oferta("sem_pendente", {
    expiraEm: iso(agora + 2 * 60 * 1000)
  });
  const ranking = calcularScoreFilaViva(parcialSemDestinoPendente, {
    agora,
    destinosCompativeis: 1,
    destinosDisponiveis: 1,
    fanout: { parcial: true, destinosEnviados: 1, destinosPendentes: [] }
  });
  assert.strictEqual(ranking.fanoutParcial, true);
  assert.strictEqual(ranking.fanoutUrgente, false);

  const somenteIncompativel = calcularScoreFilaViva(parcialSemDestinoPendente, {
    agora,
    destinosCompativeis: 0,
    destinosDisponiveis: 0,
    fanout: { parcial: false, destinosEnviados: 1, destinosPendentes: [] }
  });
  assert.strictEqual(somenteIncompativel.fanoutUrgente, false);
}

console.log("fila-viva-anti-starvation.test.js: ok");
