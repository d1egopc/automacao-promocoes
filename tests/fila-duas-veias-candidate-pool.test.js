"use strict";

const assert = require("assert");
const {
  calcularScoreFilaViva,
  ordenarOfertasFilaViva
} = require("../modules/executor/fila-viva.service");
const {
  selecionarFilaReadOnly
} = require("../modules/fila/fila-dual-read");

const agora = Date.parse("2026-09-09T15:00:00.000Z");

function minutosAtras(minutos) {
  return new Date(agora - minutos * 60 * 1000).toISOString();
}

function oferta(id, overrides = {}) {
  return {
    id,
    clienteId: "workspace_duas_veias",
    status: "pendente",
    dataEntradaFila: minutosAtras(2),
    marketplace: "mercadolivre",
    categoria: "eletronicos",
    prioridadeEnvio: 40,
    score: 60,
    ...overrides
  };
}

function selecionar(fila) {
  return selecionarFilaReadOnly({
    fila,
    clienteIdAlvo: "workspace_duas_veias",
    agora,
    configPadrao: { automacaoAtiva: true },
    configsPorCliente: { workspace_duas_veias: { automacaoAtiva: true } },
    ordenarPendentesPorPrioridade: itens => [...itens].sort((a, b) => Number(b.prioridadeEnvio || 0) - Number(a.prioridadeEnvio || 0)),
    ofertaExpiradaParaEnvio: item => item.expirada === true,
    avaliarOfertaParaSelecaoFilaViva: item => {
      if (item.bloqueadaPorDestino) {
        return { elegivel: false, motivo: "sem_destino_liberado_agora", destinosLiberados: [] };
      }
      return {
        elegivel: true,
        motivo: "destino_liberado",
        oferta: item,
        destinosCompativeis: 1,
        destinosLiberados: [{ id: "destino_apto" }],
        ranking: calcularScoreFilaViva(item, {
          agora,
          destinosCompativeis: 1,
          destinosDisponiveis: 1
        })
      };
    },
    ordenarOfertasFilaViva
  });
}

function ids(pool = []) {
  return pool.map(item => item.oferta.id);
}

{
  const optimus = Array.from({ length: 100 }, (_, indice) => oferta(`optimus_${indice}`, {
    origemFluxo: "optimus",
    prioridadeEnvio: 100,
    score: 100,
    dataEntradaFila: minutosAtras(1)
  }));
  const clone = oferta("clone_elegivel", {
    origemFluxo: "clonador_grupos",
    prioridadeEnvio: 1,
    score: 1,
    dataEntradaFila: minutosAtras(10)
  });
  const resultado = selecionar([...optimus, clone]);

  assert.strictEqual(resultado.selecionada, resultado.candidatosOrdenados[0], "baseline operacional deve continuar sendo o primeiro ranking atual");
  assert(String(resultado.selecionada.oferta.id).startsWith("optimus_"), "baseline pode continuar Optimus forte");
  assert(ids(resultado.candidatePool).includes("clone_elegivel"), "pool shadow deve conter a melhor head Clone elegivel");
  assert(resultado.candidatePool.length <= 3, "pool shadow deve permanecer bounded em tres itens");
}

{
  const clones = Array.from({ length: 100 }, (_, indice) => oferta(`clone_${indice}`, {
    origemFluxo: "clonador_grupos",
    prioridadeEnvio: 100,
    score: 100,
    dataEntradaFila: minutosAtras(1)
  }));
  const optimus = oferta("optimus_elegivel", {
    origemFluxo: "optimus",
    prioridadeEnvio: 1,
    score: 1,
    dataEntradaFila: minutosAtras(10)
  });
  const resultado = selecionar([...clones, optimus]);

  assert(String(resultado.selecionada.oferta.id).startsWith("clone_"), "baseline pode continuar Clone forte");
  assert(ids(resultado.candidatePool).includes("optimus_elegivel"), "pool shadow deve conter a melhor head Optimus elegivel");
}

{
  const resultadoOptimus = selecionar([
    oferta("optimus_unico", { origemFluxo: "optimus", prioridadeEnvio: 90 })
  ]);
  assert.deepStrictEqual(ids(resultadoOptimus.candidatePool), ["optimus_unico"], "origem unica deve manter somente o baseline sem head artificial");

  const resultadoClone = selecionar([
    oferta("clone_unico", { origemFluxo: "clonador_grupos", prioridadeEnvio: 90 })
  ]);
  assert.deepStrictEqual(ids(resultadoClone.candidatePool), ["clone_unico"], "origem unica deve manter somente o baseline sem head artificial");
}

{
  const legacy = oferta("legacy_vencedora", { prioridadeEnvio: 100, score: 100 });
  const optimus = oferta("optimus_head", { origemFluxo: "optimus", prioridadeEnvio: 50 });
  const resultado = selecionar([legacy, optimus]);
  assert.strictEqual(resultado.selecionada.oferta.id, "legacy_vencedora", "legacy continua elegivel pelo baseline atual");
  assert.deepStrictEqual(ids(resultado.candidatePool), ["legacy_vencedora", "optimus_head"], "legacy nao cria terceira head protegida");
}

{
  const optimus = oferta("optimus_vencedor", { origemFluxo: "optimus", prioridadeEnvio: 100, score: 100 });
  const cloneBloqueado = oferta("clone_bloqueado", {
    origemFluxo: "clonador_grupos",
    bloqueadaPorDestino: true,
    prioridadeEnvio: 100
  });
  const cloneExpirado = oferta("clone_expirado", {
    origemFluxo: "clonador_grupos",
    expirada: true,
    prioridadeEnvio: 100
  });
  const resultado = selecionar([optimus, cloneBloqueado, cloneExpirado]);
  assert.deepStrictEqual(ids(resultado.candidatePool), ["optimus_vencedor"], "itens bloqueados ou expirados nao podem virar heads shadow");
}

{
  const optimus = oferta("optimus_baseline", { origemFluxo: "optimus", prioridadeEnvio: 100, score: 100 });
  const clone = oferta("clone_head", { origemFluxo: "clonador_grupos", prioridadeEnvio: 1, score: 1, dataEntradaFila: minutosAtras(10) });
  const resultado = selecionar([optimus, clone]);
  const headOptimusOrdenada = resultado.candidatosOrdenados.find(item => item.oferta.origemFluxo === "optimus");
  const headCloneOrdenada = resultado.candidatosOrdenados.find(item => item.oferta.origemFluxo === "clonador_grupos");
  assert.strictEqual(resultado.candidatePool[0], resultado.selecionada, "pool inicia pelo baseline sem alterar vencedor");
  assert.strictEqual(resultado.candidatePool[0], headOptimusOrdenada, "head que coincide com baseline deve ser deduplicada por identidade");
  assert.strictEqual(resultado.candidatePool[1], headCloneOrdenada, "head da origem oposta deve respeitar a mesma ordenacao Fila Viva");
  assert.strictEqual(new Set(ids(resultado.candidatePool)).size, resultado.candidatePool.length, "pool nao pode duplicar a mesma oferta");
}

console.log("OK: candidate pool shadow da fila preserva baseline e expoe somente heads elegiveis por origem");
