"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const { performance } = require("perf_hooks");

const raiz = path.resolve(__dirname, "..");
const runnerPath = path.join(raiz, "modules", "engine", "orchestrator.runner.js");

function criarDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function aguardar(condicao, mensagem, tentativas = 300) {
  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    if (condicao()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(mensagem);
}

function criarAgendadorImediatoControlado() {
  const fila = [];
  return {
    fila,
    setImmediateFn(callback) {
      fila.push(callback);
      return fila.length;
    },
    executarProximo() {
      const callback = fila.shift();
      assert.strictEqual(typeof callback, "function", "deve existir rerun imediato agendado");
      callback();
    }
  };
}

function criarMedidorCiclo() {
  return {
    clock: () => Date.now(),
    medir: async (_nome, fn) => fn(),
    registrarEtapa() {},
    finalizar: () => ({ etapasMs: {} })
  };
}

function carregarRunnerIsolado({ executarObservabilidadeOfc, registrarLogs = false } = {}) {
  const requireReal = createRequire(runnerPath);
  const logs = [];
  const stubs = {
    "./ofc": {
      executarObservabilidadeOfc: executarObservabilidadeOfc || (async () => ({ ok: true }))
    },
    "../auto-gate/auto-gate-shadow.service": {
      createAutoGateShadow: () => ({ observe: async () => ({ ok: true }) })
    },
    "./auto-clean/auto-clean.service": {
      autoCleanShadowAtivo: () => false,
      executarAutoCleanShadowSeguro: async () => ({ ok: true })
    },
    "../telemetria/engine-memory-stage": {
      criarMedidorEngineMemoryStage: () => ({ fim() {} }),
      registrarPontoEngineMemoryStage() {},
      resumirJobsPorEtapaEngineMemory: () => ({})
    },
    "../telemetria/ciclo-observabilidade": { criarMedidorCiclo },
    "../../utils/painel-latencia": { alterarEtapaEngine() {} },
    "../solenoide/solenoide.service": { solenoideGlobal: criarSolenoideOff() }
  };
  const contexto = {
    module: { exports: {} },
    require: nome => stubs[nome] || requireReal(nome),
    console: {
      log: (...args) => {
        if (registrarLogs) logs.push(args);
      }
    },
    process,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate
  };

  vm.runInNewContext(fs.readFileSync(runnerPath, "utf8"), contexto, { filename: runnerPath });
  return { runner: contexto.module.exports, logs };
}

function criarSolenoideOff() {
  return {
    avaliar: () => ({ modo: "off", estado: "ABERTO", aplicouMudancas: false }),
    planoColetor: (_decisao, { limite }) => ({
      executar: true,
      limite,
      limiteOriginal: limite,
      motivo: "coleta_normal"
    })
  };
}

function depsEngineBase(overrides = {}) {
  const noop = async () => ({ ok: true, processados: 0 });
  return {
    processarJobsPendentesEngine: noop,
    validarJobsDiagnosticadosEngine: noop,
    importarJobsProntosEngine: noop,
    distribuirOfertasEngine: noop,
    getClientesValidos: () => [],
    getIntegracoesPorCliente: () => ({}),
    getMarketplacesAtivosPorCliente: () => ({}),
    getContextoDistribuidor: () => ({}),
    getDepsImportador: () => ({}),
    getDepsDistribuidor: () => ({}),
    solenoide: criarSolenoideOff(),
    ...overrides
  };
}

function criarProcessadorControlado() {
  const gates = [];
  const contextos = [];
  let chamadas = 0;
  let ativos = 0;
  let maxAtivos = 0;

  return {
    gates,
    contextos,
    get chamadas() { return chamadas; },
    get maxAtivos() { return maxAtivos; },
    async executar(args = {}) {
      chamadas += 1;
      ativos += 1;
      maxAtivos = Math.max(maxAtivos, ativos);
      contextos.push(args.clientesValidos?.[0]?.id || "sem_contexto");
      const gate = criarDeferred();
      gates.push(gate);
      try {
        await gate.promise;
      } finally {
        ativos -= 1;
      }
      return { ok: true, processados: 0 };
    }
  };
}

async function testarOrcamentoUmCoalescenciaECorridaEncerramento() {
  const { runner } = carregarRunnerIsolado();
  const agendador = criarAgendadorImediatoControlado();
  const processador = criarProcessadorControlado();
  let consultaContexto = 0;
  const opcoes = depsEngineBase({
    processarJobsPendentesEngine: args => processador.executar(args),
    getClientesValidos: () => [{ id: `contexto_${++consultaContexto}` }],
    setImmediateFn: agendador.setImmediateFn
  });

  const primeira = runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  await aguardar(() => processador.chamadas === 1, "primeira rodada deve alcançar o processador");

  for (let indice = 0; indice < 12; indice += 1) {
    const pulado = await runner.executarRodadaEngineOrquestrador({
      ...opcoes,
      origemRodadaEngine: "timer",
      workspaceTrigger: `workspace_${indice % 4}`
    });
    assert.strictEqual(pulado.pulado, true);
    assert.strictEqual(pulado.rerunPendente, true, "burst deve manter um único pending rerun");
  }
  assert.strictEqual(runner.obterEstadoOrquestradorEngine().rerunPendente, true);
  assert.strictEqual(agendador.fila.length, 0, "wake só pode ser publicado no encerramento");

  processador.gates[0].resolve();
  assert.strictEqual((await primeira).ok, true);
  assert.strictEqual(agendador.fila.length, 1, "múltiplos triggers devem gerar um único wake");
  assert.strictEqual(runner.obterEstadoOrquestradorEngine().wakeAgendado, true);

  const corridaEncerramento = await runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  assert.strictEqual(corridaEncerramento.coalescido, true, "trigger entre fim e setImmediate não pode perder wake");
  assert.strictEqual(agendador.fila.length, 1, "corrida de encerramento não agenda segundo wake");

  agendador.executarProximo();
  await aguardar(() => processador.chamadas === 2, "rerun imediato deve reconstruir e executar o contexto");
  assert.strictEqual(runner.obterEstadoOrquestradorEngine().rerunImediatoAtivo, true);
  assert.notStrictEqual(processador.contextos[0], processador.contextos[1], "rerun deve consultar contexto novo");

  for (let indice = 0; indice < 12; indice += 1) {
    const pulado = await runner.executarRodadaEngineOrquestrador({
      ...opcoes,
      origemRodadaEngine: "timer"
    });
    assert.strictEqual(pulado.pulado, true);
    assert.strictEqual(pulado.rerunPendente, false, "rerun ativo não pode armar terceiro ciclo");
    assert.strictEqual(pulado.orcamentoConsumido, true);
  }

  processador.gates[1].resolve();
  await aguardar(() => !runner.obterEstadoOrquestradorEngine().ativo, "rerun imediato deve encerrar");
  assert.strictEqual(agendador.fila.length, 0, "triggers durante rerun não podem encadear outro wake");
  assert.strictEqual(processador.chamadas, 2, "cadeia imediata deve ser limitada a rodada normal + um rerun");
  assert.strictEqual(processador.maxAtivos, 1, "não pode existir sobreposição de rodadas");

  const proximoTimer = runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  await aguardar(() => processador.chamadas === 3, "próximo timer deve iniciar nova rodada normal");
  assert.strictEqual(runner.obterEstadoOrquestradorEngine().rerunImediatoConsumido, false,
    "somente novo ciclo do timer renova o orçamento");
  const triggerNovoCiclo = await runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  assert.strictEqual(triggerNovoCiclo.rerunPendente, true);
  processador.gates[2].resolve();
  await proximoTimer;
  assert.strictEqual(agendador.fila.length, 1, "novo timer deve poder consumir um novo orçamento");

  agendador.executarProximo();
  await aguardar(() => processador.chamadas === 4, "segundo rerun orçado deve iniciar");
  processador.gates[3].resolve();
  await aguardar(() => !runner.obterEstadoOrquestradorEngine().ativo, "segundo rerun deve terminar");
  assert.strictEqual(agendador.fila.length, 0);
  assert.strictEqual(processador.maxAtivos, 1);

  const { runner: runnerReiniciado } = carregarRunnerIsolado();
  const estadoReiniciado = runnerReiniciado.obterEstadoOrquestradorEngine();
  assert.strictEqual(estadoReiniciado.rerunPendente, false);
  assert.strictEqual(estadoReiniciado.wakeAgendado, false);
  assert.strictEqual(estadoReiniciado.rerunImediatoConsumido, false,
    "restart não deve persistir pending ou orçamento em memória");
}

async function testarExcecaoNaoEncadeiaRerun() {
  const gatesOfc = [criarDeferred(), criarDeferred()];
  let chamadasOfc = 0;
  const { runner } = carregarRunnerIsolado({
    executarObservabilidadeOfc: async () => {
      chamadasOfc += 1;
      if (chamadasOfc <= 2) {
        await gatesOfc[chamadasOfc - 1].promise;
        throw new Error(`falha_controlada_${chamadasOfc}`);
      }
      return { ok: true };
    }
  });
  const agendador = criarAgendadorImediatoControlado();
  const opcoes = depsEngineBase({ setImmediateFn: agendador.setImmediateFn });

  const primeira = runner.executarRodadaEngineOrquestrador({ ...opcoes, origemRodadaEngine: "timer" });
  await aguardar(() => chamadasOfc === 1, "primeira rodada deve entrar no OFC");
  await runner.executarRodadaEngineOrquestrador({ ...opcoes, origemRodadaEngine: "timer" });
  gatesOfc[0].resolve();
  assert.strictEqual((await primeira).ok, false);
  assert.strictEqual(agendador.fila.length, 1, "exceção da rodada normal preserva o rerun pendente");

  agendador.executarProximo();
  await aguardar(() => chamadasOfc === 2, "rerun deve iniciar após a exceção normal");
  const duranteRerun = await runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  assert.strictEqual(duranteRerun.rerunPendente, false);
  gatesOfc[1].resolve();
  await aguardar(() => !runner.obterEstadoOrquestradorEngine().ativo, "rerun com erro deve liberar lock");
  assert.strictEqual(agendador.fila.length, 0, "erro no rerun não pode criar cadeia imediata");

  const fallbackTimer = await runner.executarRodadaEngineOrquestrador({
    ...opcoes,
    origemRodadaEngine: "timer"
  });
  assert.strictEqual(fallbackTimer.ok, true, "próximo timer permanece fallback após erro");
  assert.strictEqual(chamadasOfc, 3);
}

async function testarTimerOficialPermaneceEm120Segundos() {
  const { runner } = carregarRunnerIsolado();
  let callbackTimer = null;
  let intervaloRegistrado = 0;
  let chamadasProcessar = 0;
  const retorno = runner.iniciarOrquestradorEngine(depsEngineBase({
    processarJobsPendentesEngine: async () => {
      chamadasProcessar += 1;
      return { ok: true, processados: 0 };
    },
    setIntervalFn: (callback, intervaloMs) => {
      callbackTimer = callback;
      intervaloRegistrado = intervaloMs;
      return { unref() {} };
    }
  }));

  assert.strictEqual(retorno.intervaloMs, 120000);
  assert.strictEqual(intervaloRegistrado, 120000, "timer oficial deve continuar em 120 segundos");
  assert.strictEqual(typeof callbackTimer, "function");
  callbackTimer();
  await aguardar(() => chamadasProcessar === 1 && !runner.obterEstadoOrquestradorEngine().ativo,
    "callback oficial deve executar rodada normal completa");
}

function simularOrcamentoUm({ duracaoRodadaMs, horizonteMs = 1200, intervaloMs = 120 }) {
  let tipoAtivo = "";
  let fimAtivo = Infinity;
  let pending = false;
  let orcamentoConsumido = false;
  let cadeiaAtual = 0;
  let cadeiaMaxima = 0;
  let rodadasNormais = 0;
  let reruns = 0;

  const iniciar = (tipo, agora) => {
    tipoAtivo = tipo;
    fimAtivo = agora + duracaoRodadaMs;
    cadeiaAtual = tipo === "normal" ? 1 : cadeiaAtual + 1;
    cadeiaMaxima = Math.max(cadeiaMaxima, cadeiaAtual);
    if (tipo === "normal") rodadasNormais += 1;
    else reruns += 1;
  };

  for (let agora = 0; agora <= horizonteMs; agora += 1) {
    if (tipoAtivo && agora === fimAtivo) {
      if (tipoAtivo === "normal" && pending && !orcamentoConsumido) {
        pending = false;
        orcamentoConsumido = true;
        iniciar("rerun", agora);
      } else {
        tipoAtivo = "";
        fimAtivo = Infinity;
        pending = false;
        cadeiaAtual = 0;
      }
    }

    if (agora % intervaloMs !== 0) continue;
    if (!tipoAtivo) {
      orcamentoConsumido = false;
      iniciar("normal", agora);
    } else if (tipoAtivo === "normal" && !orcamentoConsumido) {
      pending = true;
    }
  }

  return { cadeiaMaxima, rodadasNormais, reruns, tipoAtivo, pending };
}

function testarSimulacaoDuracaoSuperiorAoTimer() {
  const longa = simularOrcamentoUm({ duracaoRodadaMs: 200 });
  assert.strictEqual(longa.cadeiaMaxima, 2, "rodada >120s não pode sustentar cadeia infinita");
  assert.ok(longa.reruns > 0, "trabalho chegado durante rodada longa deve ganhar um rerun");
  assert.ok(longa.rodadasNormais > 1, "timer deve retomar depois da pausa obrigatória");

  const curta = simularOrcamentoUm({ duracaoRodadaMs: 10 });
  assert.strictEqual(curta.reruns, 0, "rodada curta sem trigger concorrente não deve criar rerun");
  assert.strictEqual(curta.cadeiaMaxima, 1);

  console.log("ENGINE_PENDING_RERUN_SIMULATION", JSON.stringify({ longa, curta }));
}

async function testarBenchmarkBurstO1() {
  const { runner } = carregarRunnerIsolado();
  const agendador = criarAgendadorImediatoControlado();
  const bloqueio = criarDeferred();
  let chamadasProcessar = 0;
  const opcoes = depsEngineBase({
    setImmediateFn: agendador.setImmediateFn,
    processarJobsPendentesEngine: async () => {
      chamadasProcessar += 1;
      if (chamadasProcessar === 1) await bloqueio.promise;
      return { ok: true, processados: 0 };
    }
  });

  const primeira = runner.executarRodadaEngineOrquestrador({ ...opcoes, origemRodadaEngine: "timer" });
  await aguardar(() => chamadasProcessar === 1, "benchmark deve bloquear a rodada normal");

  const amostrasMs = [];
  for (let indice = 0; indice < 2000; indice += 1) {
    const inicio = performance.now();
    await runner.executarRodadaEngineOrquestrador({
      ...opcoes,
      origemRodadaEngine: "timer",
      workspaceTrigger: `workspace_${indice % 25}`
    });
    amostrasMs.push(performance.now() - inicio);
  }
  assert.strictEqual(runner.obterEstadoOrquestradorEngine().rerunPendente, true);
  bloqueio.resolve();
  await primeira;
  assert.strictEqual(agendador.fila.length, 1, "2.000 triggers continuam representados por um booleano");
  agendador.executarProximo();
  await aguardar(() => chamadasProcessar === 2 && !runner.obterEstadoOrquestradorEngine().ativo,
    "benchmark deve drenar apenas um rerun");
  assert.strictEqual(agendador.fila.length, 0);

  const ordenadas = [...amostrasMs].sort((a, b) => a - b);
  const percentil = valor => ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * valor))];
  console.log("ENGINE_PENDING_RERUN_BENCHMARK", JSON.stringify({
    triggers: amostrasMs.length,
    p50Ms: Number(percentil(0.5).toFixed(4)),
    p95Ms: Number(percentil(0.95).toFixed(4)),
    wakes: 1,
    rodadasExecutadas: chamadasProcessar
  }));
}

async function main() {
  await testarOrcamentoUmCoalescenciaECorridaEncerramento();
  await testarExcecaoNaoEncadeiaRerun();
  await testarTimerOficialPermaneceEm120Segundos();
  testarSimulacaoDuracaoSuperiorAoTimer();
  await testarBenchmarkBurstO1();
  console.log("engine-orchestrator-pending-rerun.test.js OK");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
