"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcularScoreFilaViva,
  ordenarOfertasFilaViva,
  proximoSlotElegivel
} = require("../modules/executor/fila-viva.service");
const {
  destinoDentroHorario,
  proximoInstanteDentroHorario
} = require("../utils/destinos");

const agora = Date.parse("2026-09-20T12:30:00.000Z");
const deadline = agora + 30 * 60 * 1000;

function oferta(id, overrides = {}) {
  return {
    id,
    status: "pendente",
    expiraEm: new Date(deadline).toISOString(),
    imagem: "https://cdn.example/imagem.jpg",
    linkAfiliado: "https://example.test/produto",
    ...overrides
  };
}

function intervalo({ liberado = false, minutos = 5, proximoEm = agora + minutos * 60 * 1000, restanteMs } = {}) {
  const resultado = {
    liberado,
    intervaloMs: minutos * 60 * 1000,
    intervaloAplicadoMin: minutos
  };
  if (proximoEm !== null) resultado.proximoEnvioPermitidoEm = new Date(proximoEm).toISOString();
  if (restanteMs !== undefined) resultado.restanteMs = restanteMs;
  return resultado;
}

function candidato(id, ranking) {
  return { oferta: oferta(id), elegivel: true, destinosLiberados: [], ranking };
}

{
  const bloqueado = proximoSlotElegivel({}, oferta("caso_a"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: agora + 2 * 60 * 1000 })
  });
  assert.strictEqual(bloqueado.liberadoAgora, false);
  assert.strictEqual(bloqueado.proximoElegivelEm, agora + 2 * 60 * 1000);
  assert.strictEqual(bloqueado.slotAntesDoDeadline, true);

  const noSlot = proximoSlotElegivel({}, oferta("caso_a"), agora + 2 * 60 * 1000, {
    dentroHorario: true,
    intervalo: intervalo({ liberado: true, proximoEm: agora + 2 * 60 * 1000 })
  });
  assert.strictEqual(noSlot.liberadoAgora, true, "o slot deve ser ocupado quando chegar, sem antecipar envio");
}

{
  const parcial = proximoSlotElegivel({}, oferta("caso_a_restantems"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: null, minutos: 5, restanteMs: 40 * 1000 })
  });
  assert.strictEqual(
    parcial.proximoElegivelEm,
    agora + 40 * 1000,
    "sem proximoEnvioPermitidoEm, o restante real deve vencer a cadencia total"
  );
}

{
  const urgente = candidato("menor_slack", { prioridade: 40, deadlineSlackMs: 2_000, score: 1, scoreFinal: 1 });
  const folgada = candidato("maior_slack", { prioridade: 40, deadlineSlackMs: 20_000, score: 99, scoreFinal: 99 });
  assert.strictEqual(ordenarOfertasFilaViva([folgada, urgente])[0].oferta.id, "menor_slack");

  const comercial = candidato("prioridade_comercial", { prioridade: 90, deadlineSlackMs: 20_000, score: 1, scoreFinal: 1 });
  assert.strictEqual(
    ordenarOfertasFilaViva([urgente, comercial])[0].oferta.id,
    "prioridade_comercial",
    "prioridade comercial explicita vence menor slack"
  );
}

{
  const aposTtl = proximoSlotElegivel({}, oferta("caso_c", { expiraEm: new Date(agora + 60_000).toISOString() }), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: agora + 2 * 60 * 1000 })
  });
  assert.strictEqual(aposTtl.liberadoAgora, false);
  assert.strictEqual(aposTtl.motivoBloqueio, "sem_slot_antes_ttl");
  assert.strictEqual(aposTtl.slotAntesDoDeadline, false);
}

{
  const livre = proximoSlotElegivel({}, oferta("caso_d"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ liberado: true })
  });
  const bloqueado = proximoSlotElegivel({}, oferta("caso_d"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: agora + 5 * 60 * 1000 })
  });
  assert.strictEqual(livre.liberadoAgora, true);
  assert.strictEqual(bloqueado.liberadoAgora, false);
}

{
  const destino = { horarioInicio: "10:00", horarioFim: "22:00" };
  assert.strictEqual(destinoDentroHorario(destino, agora), false);
  const proximo = proximoInstanteDentroHorario(destino, agora);
  assert.strictEqual(proximo, Date.parse("2026-09-20T13:00:00.000Z"));
  const horario = proximoSlotElegivel(destino, oferta("caso_e"), agora, {
    dentroHorario: false,
    proximoHorarioEm: proximo,
    intervalo: intervalo({ liberado: true })
  });
  assert.strictEqual(horario.slotAntesDoDeadline, true);
}

{
  const repetida = oferta("caso_f", { destinosEstado: [{ estado: "bloqueado_repeticao_2h" }] });
  const slot = proximoSlotElegivel({}, repetida, agora, {
    dentroHorario: true,
    intervalo: intervalo({ liberado: true })
  });
  assert.strictEqual(slot.liberadoAgora, true, "a decisao de repeticao continua pertencendo ao gate oficial");
  assert.strictEqual(repetida.destinosEstado[0].estado, "bloqueado_repeticao_2h");
}

{
  const primeiroDestino = proximoSlotElegivel({}, oferta("caso_multi_1"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: agora + 2 * 60 * 1000 })
  });
  const segundoDestino = proximoSlotElegivel({}, oferta("caso_multi_2"), agora, {
    dentroHorario: true,
    intervalo: intervalo({ proximoEm: agora + 7 * 60 * 1000 })
  });
  const primeiroSlot = Math.min(primeiroDestino.proximoElegivelEm, segundoDestino.proximoElegivelEm);
  assert.strictEqual(primeiroSlot, agora + 2 * 60 * 1000, "fanout deve considerar o menor slot entre destinos");
}

{
  const semMidia = oferta("caso_g", { imagem: "", linkAfiliado: "" });
  const comMidia = oferta("caso_g_2");
  const contexto = { dentroHorario: true, intervalo: intervalo({ liberado: true }) };
  assert.deepStrictEqual(
    proximoSlotElegivel({}, semMidia, agora, contexto),
    proximoSlotElegivel({}, comMidia, agora, contexto),
    "imagem e link nao interferem no gate de slot"
  );
}

{
  const congelada = Object.freeze({ intervaloMinutos: 5 });
  const item = Object.freeze(oferta("caso_h"));
  assert.doesNotThrow(() => proximoSlotElegivel(congelada, item, agora, {
    dentroHorario: true,
    intervalo: intervalo({ liberado: true })
  }));
}

{
  const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(fonteIndex.includes("proximoSlotElegivel"), "index deve usar o helper oficial de slot");
  assert(fonteIndex.includes("destinosUtils.proximoInstanteDentroHorario"), "horario futuro deve reutilizar helper de destino");
  assert(fonteIndex.includes("destinoJaEnviadoFanout(oferta, destino)"), "fanout deve continuar antes da selecao de slot");
  assert(fonteIndex.includes("const restanteMs = Math.max(0, intervaloMs - (agora - ultimoEnvio));"), "intervaloDestinoInfo deve expor o restante real");
  assert(fonteIndex.includes("const proximoEnvioPermitidoEm = ultimoEnvio"), "intervaloDestinoInfo deve derivar o proximo slot do ultimo envio");
}

{
  const semDeadline = [
    { oferta: { id: "zeta" }, ranking: { scoreFinal: 10, score: 999, idadeMs: 2 } },
    { oferta: { id: "beta" }, ranking: { scoreFinal: 20, score: 1, idadeMs: 3 } },
    { oferta: { id: "alpha" }, ranking: { scoreFinal: 20, score: 999, idadeMs: 1 } },
    { oferta: { id: "gamma" }, ranking: { scoreFinal: 10, score: 1, idadeMs: 2 } }
  ];
  const legado = [...semDeadline].sort((a, b) => {
    if (b.ranking.scoreFinal !== a.ranking.scoreFinal) return b.ranking.scoreFinal - a.ranking.scoreFinal;
    if (a.ranking.idadeMs !== b.ranking.idadeMs) return a.ranking.idadeMs - b.ranking.idadeMs;
    return String(a.oferta.id || "").localeCompare(String(b.oferta.id || ""));
  });
  assert.deepStrictEqual(
    ordenarOfertasFilaViva(semDeadline).map(item => item.oferta.id),
    legado.map(item => item.oferta.id),
    "sem deadline a ordem deve permanecer exatamente scoreFinal, idadeMs e id lexical"
  );
}

{
  const candidatos = Array.from({ length: 9 }, (_, indice) => {
    const item = oferta(`sim_${indice}`, {
      expiraEm: new Date(agora + (indice + 1) * 60 * 1000).toISOString()
    });
    return {
      oferta: item,
      ranking: calcularScoreFilaViva(item, {
        agora,
        prioridade: 0,
        proximoSlotMs: agora,
        deadlineSlackMs: (indice + 1) * 60 * 1000,
        destinosCompativeis: 1,
        destinosDisponiveis: 1
      })
    };
  });
  const ordenarLegado = itens => [...itens].sort((a, b) => b.ranking.scoreFinal - a.ranking.scoreFinal);
  const inicioLegado = process.hrtime.bigint();
  let legado;
  for (let rodada = 0; rodada < 2000; rodada += 1) {
    legado = ordenarLegado(candidatos);
  }
  const legadoMs = Number(process.hrtime.bigint() - inicioLegado) / 1e6;
  const inicio = process.hrtime.bigint();
  let ordenadas;
  for (let rodada = 0; rodada < 2000; rodada += 1) {
    ordenadas = ordenarOfertasFilaViva(candidatos);
  }
  const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  assert.strictEqual(ordenadas[0].oferta.id, "sim_0");
  assert(legado.length === candidatos.length);
  assert(duracaoMs < 5000, "simulacao deadline-aware deve permanecer barata");
  console.log(`[FILA-VIVA-DEADLINE-BENCH] pendentes=9 rodadas=2000 legadoMs=${legadoMs.toFixed(2)} deadlineMs=${duracaoMs.toFixed(2)} avaliacoesPorRodada=9`);
}

console.log("fila-viva-deadline-aware.test.js: ok");
