"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const filaDualRead = require("../modules/fila/fila-dual-read");

const WORKSPACE = "workspace_expiration_local";
const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function trecho(inicio, fim) {
  const a = fonteIndex.indexOf(inicio);
  const b = fonteIndex.indexOf(fim, a + inicio.length);
  assert(a >= 0 && b > a, `trecho_invalido:${inicio}`);
  return fonteIndex.slice(a, b);
}

const fontePersistencia = trecho(
  "async function persistirExpiracaoFila",
  "function candidatosExpiracaoFilaV2"
);
const fonteSaneamento = trecho(
  "function candidatosExpiracaoFilaV2",
  "const filaInteligenteUltimoAbastecimento"
);
const fonteAuthority = trecho(
  "function fonteClienteHotStateExecutorV2",
  "function avaliarOfertaParaSelecaoFilaViva"
);
const fonteSelecao = trecho(
  "function selecionarProximaOfertaFilaCore",
  "function aplicarDiversidadeFila"
);

function oferta(id, expiraEm, extra = {}) {
  return {
    id,
    clienteId: WORKSPACE,
    status: "pendente",
    expiraEm,
    primeiraAvaliacaoDestinosEm: "",
    destinosEstado: [],
    ...extra
  };
}

function reconciliacao(motivo, extra = {}) {
  return {
    motivo,
    fastPathExecutor: false,
    generationConclusiva: false,
    ...extra
  };
}

function criarRuntime(itensIniciais, opcoes = {}) {
  let viva = itensIniciais.map(item => ({ ...item }));
  let store = viva.map(item => ({ ...item }));
  const filaLegada = (opcoes.filaLegada || itensIniciais).map(item => ({ ...item }));
  const rastros = {
    persistencias: 0,
    releituras: 0,
    rebuilds: 0,
    fallbackLegado: 0,
    laneWrites: [],
    provider: [],
    opcoesPersistencia: []
  };

  const filaOperacionalV2 = {
    deveUsarFilaV2Operacional: () => opcoes.v2 !== false,
    lerFilaVivaParaMerge: () => {
      rastros.releituras += 1;
      return {
        ok: true,
        motivo: "ok",
        bytes: viva.length * 10,
        entradas: viva.map(item => ({ bucket: "viva", item: { ...item } }))
      };
    }
  };

  const contexto = {
    fila: filaLegada,
    filaOperacionalV2,
    filaDualRead,
    filaStore: { itensPorCliente: () => store },
    config: { automacaoAtiva: true },
    configsPorCliente: { [WORKSPACE]: { automacaoAtiva: true } },
    demandScheduler: { ativo: () => false },
    diagnosticosFilaPorCliente: new Map(),
    console: { log: () => {} },
    process: { env: {} },
    String,
    Array,
    Error,
    Object,
    Map,
    Date,
    ordenarPendentesPorPrioridade: itens => [...itens],
    ordenarOfertasFilaViva: candidatos => candidatos,
    ofertaExpiradaParaEnvio: (item, agora = Date.now()) => Date.parse(item.expiraEm) < Number(agora),
    sanearExpiracaoOperacionalFilaItem: item => {
      if (Date.parse(item.expiraEm) >= Date.now()) return { alterou: false, expirou: false };
      item.status = "expirada_operacional";
      return { alterou: true, expirou: true, ttlMs: 1, tipoFluxo: "teste" };
    },
    marcarOfertaExpirada: item => {
      item.status = "expirada_operacional";
      item.expiradaEm = new Date().toISOString();
    },
    persistirExpiracaoFila: async (_cliente, alterados, _motivo, parametros = {}) => {
      rastros.persistencias += 1;
      rastros.opcoesPersistencia.push(parametros);
      if (opcoes.writerConcorrente === true) {
        viva = viva.filter(item => !alterados.some(removido => removido.id === item.id));
        return { ok: false, alterou: false, fallbackLegado: false, motivo: "item_nao_encontrado_na_viva" };
      }
      viva = viva.filter(item => !alterados.some(removido => removido.id === item.id));
      return { ok: true, alterou: true, checkpointOnly: true };
    },
    reconstruirFilaStoreCliente: (_cliente, _motivo, parametros = {}) => {
      rastros.rebuilds += 1;
      store = parametros.filaClienteHotState.map(item => ({ ...item }));
    },
    diagnosticarFilaCliente: (_cliente, parametros = {}) => ({
      pendentesTotal: (parametros.filaClienteHotState || filaLegada).filter(item => item.status === "pendente").length,
      motivoPrincipal: "teste"
    }),
    deveLogarThrottle: () => false,
    modoDualRead: () => false,
    avaliarOfertaParaSelecaoFilaViva: item => ({
      elegivel: true,
      motivo: "destino_liberado",
      oferta: item,
      destinosCompativeis: 1,
      destinosLiberados: [{}],
      inspecaoDestinos: [],
      ranking: { lane: "normal", scoreFinal: 1, idadeMs: 1 }
    })
  };

  vm.runInNewContext(
    `${fonteSaneamento}\n${fonteAuthority}\n${fonteSelecao}\n` +
      "resultado = { sanearExpiradosFila, fonteClienteHotStateExecutorV2, selecionarProximaOfertaFila };",
    contexto,
    { filename: "fila-expiration-cleanup-runtime.js" }
  );

  return {
    ...contexto.resultado,
    rastros,
    idsViva: () => viva.map(item => item.id),
    idsStore: () => store.map(item => item.id),
    expirar(id) {
      const data = new Date(Date.now() - 60_000).toISOString();
      for (const colecao of [viva, store, filaLegada]) {
        const item = colecao.find(atual => atual.id === id);
        if (item) item.expiraEm = data;
      }
    }
  };
}

async function executarCiclo(runtime, decisao, opcoes = {}) {
  let fonte = runtime.fonteClienteHotStateExecutorV2(WORKSPACE, decisao);
  const saneamento = await runtime.sanearExpiradosFila(WORKSPACE, {
    fonteClienteHotState: fonte
  });
  fonte = saneamento.fonteClienteHotState || fonte;
  if (opcoes.expirarAposSaneamento) runtime.expirar(opcoes.expirarAposSaneamento);

  const selecao = await runtime.selecionarProximaOfertaFila(WORKSPACE, {
    fonteClienteHotState: fonte,
    saneamentoExpiracaoExecutado: true,
    retornarResultado: true
  });
  fonte = selecao.fonteClienteHotState || fonte;

  const lane = await filaDualRead.executarPrimeiraAvaliacaoLane({
    candidatosInspecao: selecao.resultadoSelecao.candidatosInspecao || [],
    fonteClienteHotState: fonte,
    clienteId: WORKSPACE,
    relocalizarOferta: (itens, referencia) => {
      const atual = itens.find(item => item.id === referencia.id);
      return atual ? { ok: true, oferta: atual } : { ok: false, oferta: null };
    },
    ofertaExpiradaParaEnvio: item => Date.parse(item.expiraEm) < Date.now(),
    registrarDestinoEstado: () => null,
    persistirItem: async item => {
      runtime.rastros.laneWrites.push(item.id);
      return { ok: true };
    }
  });

  if (selecao.oferta) runtime.rastros.provider.push(selecao.oferta.id);
  return { saneamento, selecao, lane, fonte };
}

async function provarSemFailStop(motivo, decisao) {
  const agora = Date.now();
  const expirado = oferta(`${motivo}_expirado`, new Date(agora - 60_000).toISOString());
  const valido = oferta(`${motivo}_valido`, new Date(agora + 60_000).toISOString());
  const runtime = criarRuntime([expirado, valido]);
  const resultado = await executarCiclo(runtime, decisao);

  assert.strictEqual(resultado.saneamento.mutacaoPulada, true, `${motivo}: cleanup deve ser local`);
  assert.strictEqual(runtime.rastros.persistencias, 0, `${motivo}: nao deve persistir`);
  assert.strictEqual(runtime.rastros.releituras, 0, `${motivo}: nao deve reler VIVA`);
  assert.strictEqual(runtime.rastros.rebuilds, 0, `${motivo}: nao deve rebuildar`);
  assert.strictEqual(resultado.selecao.oferta.id, valido.id, `${motivo}: executor deve continuar`);
  assert(!resultado.selecao.resultadoSelecao.candidatosVivos.some(item => item.oferta.id === expirado.id));
  assert(!resultado.selecao.resultadoSelecao.candidatosInspecao.some(item => item.oferta.id === expirado.id));
  assert(!runtime.rastros.laneWrites.includes(expirado.id));
  assert(!runtime.rastros.provider.includes(expirado.id));
}

async function provarPersistenciaSemFallbackLegado() {
  const rastros = { materializacoes: 0, saves: 0, dirty: 0 };
  const contexto = {
    filaOperacionalV2: { deveUsarFilaV2Operacional: () => true },
    sincronizarItemFilaVivaAposMutacao: async () => ({ ok: false, motivo: "item_nao_encontrado_na_viva" }),
    syncVivaMutacaoConfirmada: () => false,
    checkpointFilaV2: { marcarDirty: () => { rastros.dirty += 1; return { mutacoes: 1, dirtyAgeMs: 0 }; } },
    logFilaV22C: () => {},
    materializarFilaClienteHotStateNaGlobal: () => { rastros.materializacoes += 1; },
    salvarFila: () => { rastros.saves += 1; return true; },
    registrarHistoricoLeveTerminalLegadoAposSave: () => {},
    String,
    Array,
    Date
  };
  vm.runInNewContext(`${fontePersistencia}\nresultado = persistirExpiracaoFila;`, contexto);
  const resultado = await contexto.resultado(WORKSPACE, [{ id: "concorrente" }], "expiracao_teste", {
    filaClienteHotState: [{ id: "concorrente" }],
    permitirFallbackLegado: false
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "item_nao_encontrado_na_viva");
  assert.strictEqual(rastros.materializacoes, 0);
  assert.strictEqual(rastros.saves, 0);
}

(async () => {
  await provarSemFailStop("authority_mtime", reconciliacao("authority_mtime"));
  await provarSemFailStop("pending_ambiguo", reconciliacao("pending_ambiguo"));
  await provarSemFailStop("dirty_local", reconciliacao("dirty_local"));

  const agoraLegado = Date.now();
  const runtimeLegado = criarRuntime([
    oferta("legado_expirado", new Date(agoraLegado - 60_000).toISOString()),
    oferta("legado_valido", new Date(agoraLegado + 60_000).toISOString())
  ], { v2: false });
  const legado = await executarCiclo(runtimeLegado, reconciliacao("v2_off"));
  assert.strictEqual(runtimeLegado.rastros.persistencias, 1);
  assert.strictEqual(legado.selecao.oferta.id, "legado_valido");
  assert(!runtimeLegado.rastros.provider.includes("legado_expirado"));

  const agora = Date.now();
  const runtimeConclusivo = criarRuntime([
    oferta("A", new Date(agora - 60_000).toISOString()),
    oferta("B", new Date(agora + 60_000).toISOString())
  ]);
  const generation = reconciliacao("generation_viva_mais_nova", {
    fastPathExecutor: true,
    generationConclusiva: true
  });
  const conclusivo = await executarCiclo(runtimeConclusivo, generation);
  assert.deepStrictEqual(runtimeConclusivo.idsViva(), ["B"]);
  assert.deepStrictEqual(runtimeConclusivo.idsStore(), ["B"]);
  assert.deepStrictEqual(conclusivo.fonte.itens.map(item => item.id), ["B"]);
  assert.strictEqual(runtimeConclusivo.rastros.persistencias, 1);
  assert.strictEqual(runtimeConclusivo.rastros.releituras, 1);
  assert.strictEqual(runtimeConclusivo.rastros.rebuilds, 1);
  assert.strictEqual(runtimeConclusivo.rastros.opcoesPersistencia[0].permitirFallbackLegado, false);

  const runtimeSegunda = criarRuntime([
    oferta("B", new Date(agora + 60_000).toISOString()),
    oferta("C", new Date(agora + 120_000).toISOString())
  ]);
  const segunda = await executarCiclo(runtimeSegunda, generation, { expirarAposSaneamento: "B" });
  assert.deepStrictEqual(runtimeSegunda.idsViva(), ["C"]);
  assert.deepStrictEqual(segunda.fonte.itens.map(item => item.id), ["C"]);
  assert.deepStrictEqual(segunda.selecao.resultadoSelecao.candidatosVivos.map(item => item.oferta.id), ["C"]);
  assert(!runtimeSegunda.rastros.laneWrites.includes("B"));

  const runtimeSegundaSemAuthority = criarRuntime([
    oferta("B", new Date(agora + 60_000).toISOString()),
    oferta("C", new Date(agora + 120_000).toISOString())
  ]);
  const segundaSemAuthority = await executarCiclo(
    runtimeSegundaSemAuthority,
    reconciliacao("authority_mtime"),
    { expirarAposSaneamento: "B" }
  );
  assert.strictEqual(runtimeSegundaSemAuthority.rastros.persistencias, 0);
  assert.strictEqual(segundaSemAuthority.selecao.oferta.id, "C");
  assert(!runtimeSegundaSemAuthority.rastros.laneWrites.includes("B"));

  const runtimeConcorrente = criarRuntime([
    oferta("C", new Date(agora - 60_000).toISOString())
  ], { writerConcorrente: true });
  const concorrente = await executarCiclo(runtimeConcorrente, generation);
  assert.strictEqual(concorrente.saneamento.mutacaoConfirmada, false);
  assert.strictEqual(concorrente.saneamento.motivo, "item_nao_encontrado_na_viva");
  assert.strictEqual(runtimeConcorrente.rastros.fallbackLegado, 0);
  assert.strictEqual(runtimeConcorrente.rastros.releituras, 0);
  assert.strictEqual(runtimeConcorrente.rastros.rebuilds, 0);
  assert.deepStrictEqual(runtimeConcorrente.idsViva(), []);
  assert.deepStrictEqual(concorrente.fonte.itens.map(item => item.id), ["C"]);
  assert.strictEqual(concorrente.selecao.oferta, null);
  assert.strictEqual(runtimeConcorrente.rastros.laneWrites.length, 0);
  assert.strictEqual(runtimeConcorrente.rastros.provider.length, 0);

  const runtimeDivergente = criarRuntime([]);
  await assert.rejects(
    runtimeDivergente.sanearExpiradosFila(WORKSPACE, {
      fonteClienteHotState: { conclusiva: true, clienteId: "outra_workspace", itens: [] }
    }),
    /hot_state_v2_workspace_divergente/
  );

  await provarPersistenciaSemFallbackLegado();
  console.log("fila-expiration-cleanup-local-fail-closed.test.js: PASS");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
