"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const {
  LIMITE_PRIMEIRA_AVALIACAO_POR_WORKSPACE,
  criarControladorFilaDualRead,
  executarPrimeiraAvaliacaoLane,
  selecionarCandidatosPrimeiraAvaliacao,
  selecionarFilaReadOnly
} = require("../modules/fila/fila-dual-read");

const AGORA = Date.parse("2026-10-05T15:00:00.000Z");

function oferta(id, minutosAtras = 1, extra = {}) {
  return {
    id,
    clienteId: extra.clienteId || "workspace_a",
    status: "pendente",
    dataEntradaFila: new Date(AGORA - minutosAtras * 60_000).toISOString(),
    destinosEstado: [],
    ...extra
  };
}

function candidato(item, inspecaoDestinos = [], extraAvaliacao = {}) {
  return {
    oferta: item,
    avaliacao: {
      elegivel: false,
      motivo: "sem_destino_liberado_agora",
      destinosLiberados: [],
      inspecaoDestinos,
      ...extraAvaliacao
    }
  };
}

function registrarDestinoEstado(item, destino, estado, dados = {}) {
  item.destinosEstado = Array.isArray(item.destinosEstado) ? item.destinosEstado : [];
  const chave = `${destino.tipo || "destino"}:${destino.id || destino.nome || "sem_id"}`;
  const indice = item.destinosEstado.findIndex(atual => atual.chave === chave);
  const proximo = {
    ...(indice >= 0 ? item.destinosEstado[indice] : {}),
    chave,
    destinoId: destino.id || "",
    nome: destino.nome || "",
    estado,
    motivo: dados.motivo || "",
    atualizadoEm: dados.data || "",
    proximoEnvioPermitidoEm: dados.proximoEnvioPermitidoEm || ""
  };
  if (indice >= 0) item.destinosEstado[indice] = proximo;
  else item.destinosEstado.push(proximo);
  return proximo;
}

function relocalizar(itens, referencia, opcoes = {}) {
  const atual = itens.find(item => item.id === referencia.id && item.clienteId === opcoes.clienteId);
  return atual ? { ok: true, oferta: atual } : { ok: false, oferta: null };
}

function depsLane(itens, persistirItem) {
  return {
    fonteClienteHotState: { conclusiva: true, itens },
    clienteId: itens[0]?.clienteId || "workspace_a",
    agora: AGORA,
    relocalizarOferta: relocalizar,
    ofertaExpiradaParaEnvio: item => item.expirada === true,
    registrarDestinoEstado,
    persistirItem
  };
}

function carregarAvaliadorReal(overrides = {}) {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf("function avaliarOfertaParaSelecaoFilaViva");
  const fim = fonte.indexOf("function selecionarProximaOfertaFilaCore", inicio);
  assert(inicio >= 0 && fim > inicio, "avaliador real deve existir");

  const destinoGeral = { id: "geral", tipo: "whatsapp", nome: "Geral" };
  const sandbox = {
    config: {},
    analisarDestinosCompativeisFila: () => ({ compativeis: [{ destino: destinoGeral, analise: { aceita: true } }], rejeitados: [] }),
    motivoCoberturaDestino: motivo => ({ categoria: "categoria_incompativel", marketplace: "marketplace_nao_permitido" }[motivo] || motivo),
    ofertaExpiradaParaEnvio: () => false,
    diagnosticarDisponibilidadeEnvioWorkspace: () => ({ ok: true }),
    destinoOperacionalValido: destino => Boolean(destino && typeof destino === "object"),
    destinoOperacionalSeguro: destino => destino && typeof destino === "object" ? destino : {},
    destinoJaEnviadoFanout: () => false,
    obterDestinoEstadoFanout: () => null,
    destinoDentroHorario: () => true,
    intervaloDestinoInfo: () => ({ liberado: true, intervaloMs: 150_000, restanteMs: 0, proximoEnvioPermitidoEm: "" }),
    proximoSlotElegivel: (destino, item, agora, opcoes) => ({
      liberadoAgora: opcoes.dentroHorario === true && opcoes.limiteDiarioOk !== false && opcoes.intervalo?.liberado === true,
      proximoElegivelEm: agora + 60_000,
      slackMs: 60_000,
      motivoBloqueio: opcoes.dentroHorario === false ? "fora_horario" : "intervalo"
    }),
    destinosUtils: { proximoInstanteDentroHorario: () => AGORA + 60_000 },
    destinoLimiteDiarioDisponivel: () => ({ ok: true, limite: 0, usados: 0 }),
    destinoChaveControle: (clienteId, destino) => `${clienteId}_${destino.id}`,
    calcularScoreFilaViva: () => ({ scoreFinal: 1, idadeMs: 1, lane: "agua_nova", turboComercial: false }),
    ...overrides
  };
  vm.runInNewContext(`${fonte.slice(inicio, fim)}\nresultado = avaliarOfertaParaSelecaoFilaViva;`, sandbox);
  return { avaliar: sandbox.resultado, destinoGeral };
}

(async () => {
  assert.strictEqual(LIMITE_PRIMEIRA_AVALIACAO_POR_WORKSPACE, 2);

  {
    const controlador = criarControladorFilaDualRead({ env: {}, logger: console });
    assert.strictEqual(
      typeof controlador.executarPrimeiraAvaliacaoLane,
      "function",
      "runtime_wiring_first_evaluation_lane_invalido"
    );

    const itens = [oferta("facade_a", 3), oferta("facade_b", 2), oferta("facade_c", 1)];
    let writes = 0;
    const resultado = await controlador.executarPrimeiraAvaliacaoLane({
      ...depsLane(itens, async () => {
        writes += 1;
        return { ok: true };
      }),
      candidatosInspecao: itens.map(item => candidato(item))
    });

    assert.strictEqual(resultado.inspecionados, 2);
    assert.strictEqual(writes, 2, "facade runtime deve preservar o batch maximo da Lane");
  }

  {
    const turboAntigo = candidato(oferta("turbo_antigo", 10, { turbo: true }));
    const comumNovo = candidato(oferta("comum_novo", 1));
    const turboNovo = candidato(oferta("turbo_novo", 2, { turbo: true }));
    const selecionados = selecionarCandidatosPrimeiraAvaliacao([turboAntigo, comumNovo, turboNovo], 99);
    assert.deepStrictEqual(selecionados.map(item => item.oferta.id), ["comum_novo", "turbo_antigo"]);
  }

  {
    let chamadasLimite = 0;
    const { avaliar, destinoGeral } = carregarAvaliadorReal({
      destinoDentroHorario: () => false,
      destinoLimiteDiarioDisponivel: () => { chamadasLimite += 1; return { ok: true }; }
    });
    const item = oferta("fora_horario");
    const avaliacao = avaliar(item, item.clienteId, { automacaoAtiva: true }, { agora: AGORA, cacheLimiteDiario: new Map() });
    assert.strictEqual(avaliacao.inspecaoDestinos[0].destino, destinoGeral);
    assert.strictEqual(avaliacao.inspecaoDestinos[0].estado, "aguardando");
    assert.strictEqual(avaliacao.inspecaoDestinos[0].motivo, "fora_horario");
    assert.strictEqual(chamadasLimite, 0, "fora da janela nao deve consultar limite");
  }

  {
    let chamadasLimite = 0;
    const { avaliar } = carregarAvaliadorReal({
      intervaloDestinoInfo: () => ({ liberado: false, intervaloMs: 150_000, restanteMs: 60_000, proximoEnvioPermitidoEm: new Date(AGORA + 60_000).toISOString() }),
      destinoLimiteDiarioDisponivel: () => { chamadasLimite += 1; return { ok: true }; }
    });
    const item = oferta("intervalo");
    const avaliacao = avaliar(item, item.clienteId, { automacaoAtiva: true }, { agora: AGORA, cacheLimiteDiario: new Map() });
    assert.strictEqual(avaliacao.inspecaoDestinos[0].motivo, "intervalo");
    assert.strictEqual(chamadasLimite, 1, "avaliacao existente consulta limite uma unica vez");
  }

  {
    const { avaliar } = carregarAvaliadorReal({ destinoLimiteDiarioDisponivel: () => ({ ok: false, limite: 1, usados: 1 }) });
    const item = oferta("limite");
    const avaliacao = avaliar(item, item.clienteId, { automacaoAtiva: true }, { agora: AGORA, cacheLimiteDiario: new Map() });
    assert.strictEqual(avaliacao.inspecaoDestinos[0].motivo, "limite_diario");
  }

  {
    const seletivo = { id: "seletivo", tipo: "telegram", nome: "Seletivo" };
    const { avaliar } = carregarAvaliadorReal({
      analisarDestinosCompativeisFila: () => ({
        compativeis: [{ destino: { id: "geral", tipo: "whatsapp", nome: "Geral" }, analise: { aceita: true } }],
        rejeitados: [{ destino: seletivo, analise: { aceita: false, motivo: "categoria" } }]
      })
    });
    const item = oferta("geral_e_seletivo");
    const avaliacao = avaliar(item, item.clienteId, { automacaoAtiva: true }, { agora: AGORA, cacheLimiteDiario: new Map() });
    assert(avaliacao.inspecaoDestinos.some(plano => plano.destino.id === "geral" && plano.motivo === "destino_compativel"));
    assert(avaliacao.inspecaoDestinos.some(plano => plano.destino.id === "seletivo" && plano.estado === "nao_compativel"));
  }

  {
    const { avaliar } = carregarAvaliadorReal({ analisarDestinosCompativeisFila: () => ({ compativeis: [], rejeitados: [] }) });
    const item = oferta("sem_destinos");
    const avaliacao = avaliar(item, item.clienteId, { automacaoAtiva: true }, { agora: AGORA });
    let persistidos = 0;
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async preparado => { persistidos += 1; assert.strictEqual(preparado.destinosEstado.length, 0); return { ok: true }; }),
      candidatosInspecao: [candidato(item, avaliacao.inspecaoDestinos)]
    });
    assert.strictEqual(resultado.inspecionados, 1);
    assert.strictEqual(persistidos, 1);
    assert(item.primeiraAvaliacaoDestinosEm, "zero destinos ainda precisa de marcador duravel");
  }

  {
    const itens = [oferta("a", 3), oferta("b", 2), oferta("c", 1)];
    let writes = 0;
    const planos = itens.map(item => candidato(item, [{ destino: { id: "d", tipo: "whatsapp" }, estado: "aguardando", motivo: "intervalo" }]));
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane(itens, async preparado => { writes += 1; assert(preparado.primeiraAvaliacaoDestinosEm); return { ok: true }; }),
      candidatosInspecao: planos
    });
    assert.strictEqual(resultado.inspecionados, 2);
    assert.strictEqual(writes, 2, "batch nunca pode exceder duas mutacoes");
    assert.strictEqual(itens.filter(item => item.primeiraAvaliacaoDestinosEm).length, 2);
  }

  {
    const item = oferta("crash_antes");
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async () => { throw new Error("crash"); }),
      candidatosInspecao: [candidato(item)]
    });
    assert.strictEqual(resultado.falhas, 1);
    assert.strictEqual(item.primeiraAvaliacaoDestinosEm, undefined, "falha antes do write nao pode marcar item local");
  }

  {
    const destino = { id: "duravel", tipo: "whatsapp", nome: "Duravel" };
    const item = oferta("crash_depois");
    let snapshotDuravel = null;
    let checkpointsDirty = 0;
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async preparado => {
        assert(preparado.primeiraAvaliacaoDestinosEm, "marcador deve estar no mesmo write dos estados");
        assert.strictEqual(preparado.destinosEstado.length, 1);
        snapshotDuravel = JSON.parse(JSON.stringify(preparado));
        checkpointsDirty += 1;
        return { ok: true };
      }),
      candidatosInspecao: [candidato(item, [{ destino, estado: "aguardando", motivo: "fora_horario" }])]
    });
    assert.strictEqual(resultado.inspecionados, 1);
    assert.strictEqual(checkpointsDirty, 1, "uma mutacao confirmada deve marcar um checkpoint dirty");
    assert(snapshotDuravel.primeiraAvaliacaoDestinosEm && snapshotDuravel.destinosEstado.length === 1);

    let avaliacoes = 0;
    const reinicio = selecionarFilaReadOnly({
      fila: [snapshotDuravel],
      clienteIdAlvo: "workspace_a",
      agora: AGORA,
      configPadrao: { automacaoAtiva: true },
      configsPorCliente: { workspace_a: { automacaoAtiva: true } },
      ordenarPendentesPorPrioridade: valores => valores,
      ofertaExpiradaParaEnvio: () => false,
      avaliarOfertaParaSelecaoFilaViva: ofertaAtual => {
        avaliacoes += 1;
        return { elegivel: false, motivo: "sem_destino_liberado_agora", oferta: ofertaAtual, destinosLiberados: [], inspecaoDestinos: [] };
      },
      ordenarOfertasFilaViva: valores => valores
    });
    assert.strictEqual(avaliacoes, 1, "a rodada deve avaliar cada item uma unica vez");
    assert.strictEqual(reinicio.candidatosInspecao.length, 0, "write duravel nao pode reinspecionar apos restart");
  }

  {
    const destino = { id: "sem_duplicar", tipo: "telegram", nome: "Sem duplicar" };
    const item = oferta("dupla_inspecao");
    let writes = 0;
    const executar = () => executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async preparado => { writes += 1; return { ok: true, preparado }; }),
      candidatosInspecao: [candidato(item, [
        { destino, estado: "aguardando", motivo: "intervalo" },
        { destino, estado: "aguardando", motivo: "destino_compativel" }
      ])]
    });
    const primeira = await executar();
    const segunda = await executar();
    assert.strictEqual(primeira.inspecionados, 1);
    assert.strictEqual(segunda.ignorados, 1);
    assert.strictEqual(writes, 1, "segunda tentativa deve observar o marcador duravel");
    assert.strictEqual(item.destinosEstado.length, 1, "upsert nao pode duplicar o mesmo destino");
    assert.strictEqual(item.destinosEstado[0].motivo, "destino_compativel");
  }

  {
    const item = oferta("expirado_concorrente", 1, { expirada: true });
    let writes = 0;
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async () => { writes += 1; return { ok: true }; }),
      candidatosInspecao: [candidato(item)]
    });
    assert.strictEqual(resultado.ignorados, 1);
    assert.strictEqual(writes, 0, "item expirado entre read e write nao pode ser persistido");
    assert.strictEqual(item.primeiraAvaliacaoDestinosEm, undefined);
  }

  {
    const item = oferta("terminal_concorrente");
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async () => ({ ok: false, terminalHistorico: true })),
      candidatosInspecao: [candidato(item)]
    });
    assert.strictEqual(resultado.falhas, 1);
    assert.strictEqual(item.primeiraAvaliacaoDestinosEm, undefined, "terminal concorrente nao pode ser ressuscitado");
  }

  {
    const item = oferta("sem_authority");
    let writes = 0;
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane([item], async () => { writes += 1; return { ok: true }; }),
      fonteClienteHotState: { conclusiva: false, itens: [item] },
      candidatosInspecao: [candidato(item)]
    });
    assert.strictEqual(resultado.failClosed, true);
    assert.strictEqual(writes, 0);
  }

  {
    const itens = Array.from({ length: 5 }, (_, indice) => oferta(`backlog_${indice}`, 5 - indice));
    let rodadas = 0;
    while (itens.some(item => !item.primeiraAvaliacaoDestinosEm)) {
      rodadas += 1;
      const selecao = selecionarFilaReadOnly({
        fila: itens,
        clienteIdAlvo: "workspace_a",
        agora: AGORA,
        configPadrao: { automacaoAtiva: true },
        configsPorCliente: { workspace_a: { automacaoAtiva: true } },
        ordenarPendentesPorPrioridade: valores => valores,
        ofertaExpiradaParaEnvio: () => false,
        avaliarOfertaParaSelecaoFilaViva: item => ({ elegivel: false, motivo: "sem_destino_liberado_agora", oferta: item, destinosLiberados: [], inspecaoDestinos: [] }),
        ordenarOfertasFilaViva: valores => valores
      });
      await executarPrimeiraAvaliacaoLane({
        ...depsLane(itens, async () => ({ ok: true })),
        candidatosInspecao: selecao.candidatosInspecao
      });
    }
    assert.strictEqual(rodadas, 3, "backlog de cinco itens deve drenar em lotes 2, 2 e 1");
  }

  {
    const workspaceA = oferta("ws_a", 2, { clienteId: "workspace_a" });
    const workspaceB = oferta("ws_b", 2, { clienteId: "workspace_b" });
    const resultadoA = await executarPrimeiraAvaliacaoLane({ ...depsLane([workspaceA], async () => ({ ok: true })), candidatosInspecao: [candidato(workspaceA)] });
    const resultadoB = await executarPrimeiraAvaliacaoLane({ ...depsLane([workspaceB], async () => ({ ok: true })), candidatosInspecao: [candidato(workspaceB)] });
    assert.strictEqual(resultadoA.inspecionados, 1);
    assert.strictEqual(resultadoB.inspecionados, 1);
    assert(workspaceA.primeiraAvaliacaoDestinosEm && workspaceB.primeiraAvaliacaoDestinosEm);
  }

  {
    const enviavel = oferta("enviavel", 2, { prioridadeEnvio: 100 });
    const bloqueada = oferta("bloqueada", 3, { prioridadeEnvio: 500 });
    const parametros = {
      fila: [bloqueada, enviavel],
      clienteIdAlvo: "workspace_a",
      agora: AGORA,
      configPadrao: { automacaoAtiva: true },
      configsPorCliente: { workspace_a: { automacaoAtiva: true } },
      ordenarPendentesPorPrioridade: valores => [...valores].sort((a, b) => b.prioridadeEnvio - a.prioridadeEnvio),
      ofertaExpiradaParaEnvio: () => false,
      avaliarOfertaParaSelecaoFilaViva: item => item.id === "enviavel"
        ? { elegivel: true, oferta: item, destinosLiberados: [{}], ranking: { scoreFinal: 100, idadeMs: 1 } }
        : { elegivel: false, motivo: "sem_destino_liberado_agora", oferta: item, destinosLiberados: [], inspecaoDestinos: [] },
      ordenarOfertasFilaViva: valores => valores
    };
    const antes = selecionarFilaReadOnly({ ...parametros, fila: parametros.fila.map(item => ({ ...item, primeiraAvaliacaoDestinosEm: new Date(AGORA).toISOString() })) });
    const depois = selecionarFilaReadOnly(parametros);
    assert.strictEqual(antes.selecionada.oferta.id, depois.selecionada.oferta.id, "lane nao altera candidato de envio");
    assert.strictEqual(depois.candidatosVivos.length, antes.candidatosVivos.length);
  }

  {
    const comum = oferta("comum_inspecao", 1, { prioridadeEnvio: 10 });
    const turbo = oferta("turbo_envio", 2, { prioridadeEnvio: 110, turbo: true });
    let avaliacoes = 0;
    const resultado = selecionarFilaReadOnly({
      fila: [comum, turbo],
      clienteIdAlvo: "workspace_a",
      agora: AGORA,
      configPadrao: { automacaoAtiva: true },
      configsPorCliente: { workspace_a: { automacaoAtiva: true } },
      ordenarPendentesPorPrioridade: valores => [...valores].sort((a, b) => b.prioridadeEnvio - a.prioridadeEnvio),
      ofertaExpiradaParaEnvio: () => false,
      avaliarOfertaParaSelecaoFilaViva: item => {
        avaliacoes += 1;
        return {
          elegivel: true,
          oferta: item,
          destinosLiberados: [{}],
          inspecaoDestinos: [],
          ranking: { turboComercial: item.turbo === true }
        };
      },
      ordenarOfertasFilaViva: valores => valores
    });
    assert.strictEqual(avaliacoes, 2, "a First Evaluation Lane nao pode recalcular destinos");
    assert.strictEqual(resultado.selecionada.oferta.id, "turbo_envio", "prioridade comercial Turbo deve continuar vencendo no envio");
    assert.strictEqual(resultado.candidatosInspecao[0].oferta.id, "comum_inspecao", "item comum deve ter protecao contra starvation na inspecao");
    assert.strictEqual(resultado.totalCandidatosInspecao, 2);
  }

  const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioLane = fonteIndex.indexOf('perfilProcessarFila.etapa("primeiraAvaliacaoDestinos"');
  const fimLane = fonteIndex.indexOf("if (!oferta)", inicioLane);
  const trechoLane = fonteIndex.slice(inicioLane, fimLane);
  assert(inicioLane >= 0 && fimLane > inicioLane, "lane deve executar antes do retorno sem oferta");
  assert(trechoLane.includes("sincronizarItemFilaVivaAposMutacao"), "lane deve usar mutacao VIVA oficial");
  assert(trechoLane.includes("checkpointFilaV2.marcarDirty"), "lane deve marcar checkpoint dirty");
  for (const proibido of [
    "reservarOfertaProcessandoFila",
    "claim",
    "debitar",
    "consumirLimite",
    "registrarTentativa",
    "provider",
    "destino_candidato",
    "processarEnvioAutomaticoDestino",
    "terminalizar"
  ]) {
    assert(!trechoLane.includes(proibido), `lane nao pode chamar ${proibido}`);
  }

  console.log("fila-first-evaluation-lane.test.js: PASS");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
