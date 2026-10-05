"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const runnerPath = path.join(raiz, "modules", "engine", "orchestrator.runner.js");

function carregarRunnerLimpo() {
  delete require.cache[require.resolve(runnerPath)];
  return require(runnerPath);
}

function criarDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function aguardar(condicao, mensagem, tentativas = 100) {
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
      assert.strictEqual(typeof callback, "function", "deve existir wake agendado");
      callback();
    }
  };
}

function depsEngineBase(overrides = {}) {
  const noop = async () => ({ ok: true });
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
    ...overrides
  };
}

function recortarChamadaBalanceada(fonte, assinatura) {
  const inicio = fonte.indexOf(assinatura);
  assert.ok(inicio >= 0, `${assinatura} deve existir`);

  const abre = fonte.indexOf("(", inicio);
  let profundidadeParenteses = 0;
  let profundidadeChaves = 0;
  let emString = "";
  let escape = false;

  for (let i = abre; i < fonte.length; i += 1) {
    const char = fonte[i];

    if (emString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === emString) {
        emString = "";
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      emString = char;
      continue;
    }
    if (char === "(") profundidadeParenteses += 1;
    if (char === ")") profundidadeParenteses -= 1;
    if (char === "{") profundidadeChaves += 1;
    if (char === "}") profundidadeChaves -= 1;

    if (profundidadeParenteses === 0 && profundidadeChaves === 0) {
      return fonte.slice(inicio, i + 1);
    }
  }

  throw new Error(`chamada_nao_encontrada:${assinatura}`);
}

async function testarCicloClonadorIndependenteDaFlagGlobal() {
  const runner = carregarRunnerLimpo();
  const bloqueioEngine = criarDeferred();
  let processarChamado = false;
  let clonadorChamadas = 0;

  const rodadaGlobal = runner.executarRodadaEngineOrquestrador(depsEngineBase({
    processarJobsPendentesEngine: async () => {
      processarChamado = true;
      await bloqueioEngine.promise;
      return { ok: true };
    },
    processarEntradasClonador: async () => {
      throw new Error("nao_deve_ser_chamado_pela_rodada_global");
    }
  }));

  while (!processarChamado) {
    await new Promise(resolve => setImmediate(resolve));
  }

  const segundaRodadaGlobal = await runner.executarRodadaEngineOrquestrador(depsEngineBase());
  assert.strictEqual(segundaRodadaGlobal.pulado, true, "flag global do Engine deve estar ativa durante rodada pesada");

  const resultadoClonador = await runner.executarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      return { processadas: 1 };
    }
  });

  assert.strictEqual(resultadoClonador.ok, true);
  assert.strictEqual(clonadorChamadas, 1, "ciclo do Clonador deve rodar mesmo com Engine global ocupado");

  bloqueioEngine.resolve();
  await rodadaGlobal;
}

async function testarTimerDoClonadorNaoDependeDaRodadaPesada() {
  const runner = carregarRunnerLimpo();
  const bloqueioEngine = criarDeferred();
  let processarChamado = false;
  let callbackIntervalo = null;
  let intervaloRegistrado = 0;
  let clonadorChamadas = 0;

  runner.iniciarCicloEntradaClonador({
    intervaloMs: 120000,
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      return { processadas: 1 };
    },
    setIntervalFn: (fn, ms) => {
      callbackIntervalo = fn;
      intervaloRegistrado = ms;
      return { unref() {} };
    }
  });

  assert.strictEqual(intervaloRegistrado, 120000, "cadencia inicial deve permanecer 120000ms");
  assert.strictEqual(typeof callbackIntervalo, "function");

  const rodadaGlobal = runner.executarRodadaEngineOrquestrador(depsEngineBase({
    processarJobsPendentesEngine: async () => {
      processarChamado = true;
      await bloqueioEngine.promise;
      return { ok: true };
    }
  }));

  while (!processarChamado) {
    await new Promise(resolve => setImmediate(resolve));
  }

  callbackIntervalo();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(clonadorChamadas, 1, "tick do Clonador deve executar durante rodada pesada do Engine");

  bloqueioEngine.resolve();
  await rodadaGlobal;
}

async function testarLockProprioImpedeOverlap() {
  const runner = carregarRunnerLimpo();
  const bloqueioClonador = criarDeferred();
  let clonadorChamadas = 0;
  let primeiraEntrou = false;

  const primeira = runner.executarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      primeiraEntrou = true;
      await bloqueioClonador.promise;
      return { processadas: 1 };
    }
  });

  while (!primeiraEntrou) {
    await new Promise(resolve => setImmediate(resolve));
  }

  const segunda = await runner.executarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      return { processadas: 1 };
    }
  });

  assert.strictEqual(segunda.pulado, true);
  assert.strictEqual(clonadorChamadas, 1, "lock proprio nao deve permitir overlap do Clonador");

  bloqueioClonador.resolve();
  await primeira;
}

async function testarExcecaoLiberaLockViaFinally() {
  const runner = carregarRunnerLimpo();
  let clonadorChamadas = 0;

  const falha = await runner.executarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      throw new Error("falha_controlada");
    }
  });

  assert.strictEqual(falha.ok, false);

  const sucesso = await runner.executarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      clonadorChamadas += 1;
      return { processadas: 1 };
    }
  });

  assert.strictEqual(sucesso.ok, true);
  assert.strictEqual(clonadorChamadas, 2, "finally deve liberar lock para a rodada seguinte");
}

async function testarWakeCoalesceBurstAntesDaExecucao() {
  const runner = carregarRunnerLimpo();
  const agendador = criarAgendadorImediatoControlado();
  let callbackPoll = null;
  let chamadas = 0;

  runner.iniciarCicloEntradaClonador({
    intervaloMs: 120000,
    processarEntradasClonador: async () => {
      chamadas += 1;
      return { processadas: 0 };
    },
    setImmediateFn: agendador.setImmediateFn,
    setIntervalFn: (callback) => {
      callbackPoll = callback;
      return { unref() {} };
    }
  });

  const primeira = runner.solicitarCicloEntradaClonador();
  const segunda = runner.solicitarCicloEntradaClonador();
  const terceira = runner.solicitarCicloEntradaClonador();
  assert.strictEqual(primeira.agendado, true);
  assert.strictEqual(segunda.coalescido, true);
  assert.strictEqual(terceira.coalescido, true);
  assert.strictEqual(agendador.fila.length, 1, "burst deve gerar somente um callback imediato");

  agendador.executarProximo();
  await aguardar(() => chamadas === 1, "wake coalescido deve executar bridge uma vez");
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(agendador.fila.length, 0);

  callbackPoll();
  await aguardar(() => chamadas === 2, "poll de 120s deve permanecer como fallback");
}

async function testarWakeDuranteRodadaGeraUmRerun() {
  const runner = carregarRunnerLimpo();
  const agendador = criarAgendadorImediatoControlado();
  const liberarPrimeira = criarDeferred();
  let primeiraEntrou = false;
  let chamadas = 0;

  runner.iniciarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        primeiraEntrou = true;
        await liberarPrimeira.promise;
        return { processadas: 1 };
      }
      return { processadas: 0 };
    },
    setImmediateFn: agendador.setImmediateFn,
    setIntervalFn: () => ({ unref() {} })
  });

  runner.solicitarCicloEntradaClonador();
  agendador.executarProximo();
  await aguardar(() => primeiraEntrou, "primeira rodada wake deve iniciar");

  const duranteA = runner.solicitarCicloEntradaClonador({ motivo: "burst_a" });
  const duranteB = runner.solicitarCicloEntradaClonador({ motivo: "burst_b" });
  assert.strictEqual(duranteA.rerunPendente, true);
  assert.strictEqual(duranteB.rerunPendente, true);
  assert.strictEqual(agendador.fila.length, 0, "rodada ocupada registra estado, nao dispara overlap");

  liberarPrimeira.resolve();
  await aguardar(() => agendador.fila.length === 1, "encerramento deve publicar exatamente um rerun");
  agendador.executarProximo();
  await aguardar(() => chamadas === 2, "rerun pendente deve executar");
  assert.strictEqual(agendador.fila.length, 0, "rerun vazio encerra drenagem");
}

async function testarBurstMultiworkspaceDrenaSemDuplicar() {
  const runner = carregarRunnerLimpo();
  const agendador = criarAgendadorImediatoControlado();
  const pendentes = Array.from({ length: 12 }, (_, indice) => ({
    id: `oferta_${indice + 1}`,
    workspace: indice % 2 === 0 ? "workspace_a" : "workspace_b"
  }));
  const processados = [];
  let rodadas = 0;

  runner.iniciarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      rodadas += 1;
      const lote = pendentes.splice(0, 5);
      processados.push(...lote);
      return { processadas: lote.length };
    },
    setImmediateFn: agendador.setImmediateFn,
    setIntervalFn: () => ({ unref() {} })
  });

  for (let i = 0; i < 12; i += 1) runner.solicitarCicloEntradaClonador({ motivo: "burst_multiworkspace" });
  while (processados.length < 12 || agendador.fila.length > 0) {
    if (agendador.fila.length) agendador.executarProximo();
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.strictEqual(rodadas, 4, "lotes 5+5+2 devem terminar com uma sondagem vazia");
  assert.strictEqual(new Set(processados.map(item => item.id)).size, 12, "nenhuma oferta pode duplicar");
  assert.deepStrictEqual(new Set(processados.map(item => item.workspace)), new Set(["workspace_a", "workspace_b"]));
}

async function testarExcecaoNoWakeMantemFallbackDisponivel() {
  const runner = carregarRunnerLimpo();
  const agendador = criarAgendadorImediatoControlado();
  let callbackPoll = null;
  let chamadas = 0;

  runner.iniciarCicloEntradaClonador({
    processarEntradasClonador: async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error("falha_fast_path");
      return { processadas: 0 };
    },
    setImmediateFn: agendador.setImmediateFn,
    setIntervalFn: callback => {
      callbackPoll = callback;
      return { unref() {} };
    }
  });

  runner.solicitarCicloEntradaClonador();
  agendador.executarProximo();
  await aguardar(() => chamadas === 1, "wake com excecao deve concluir sem prender lock");
  await new Promise(resolve => setImmediate(resolve));
  callbackPoll();
  await aguardar(() => chamadas === 2, "poll deve recuperar depois da excecao do fast path");
}

function testarSemDuplaExecucaoNoBootstrap() {
  const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
  assert.ok(indexFonte.includes("iniciarCicloEntradaClonador({"), "bootstrap deve iniciar ciclo proprio do Clonador");
  const chamadaEngine = recortarChamadaBalanceada(indexFonte, "iniciarOrquestradorEngine");

  assert.ok(!chamadaEngine.includes("processarEntradasClonador"), "rodada global nao deve executar clonador_grupos_entrada");
}

async function main() {
  await testarCicloClonadorIndependenteDaFlagGlobal();
  await testarTimerDoClonadorNaoDependeDaRodadaPesada();
  await testarLockProprioImpedeOverlap();
  await testarExcecaoLiberaLockViaFinally();
  await testarWakeCoalesceBurstAntesDaExecucao();
  await testarWakeDuranteRodadaGeraUmRerun();
  await testarBurstMultiworkspaceDrenaSemDuplicar();
  await testarExcecaoNoWakeMantemFallbackDisponivel();
  testarSemDuplaExecucaoNoBootstrap();
  console.log("clonador-grupos-entrada-runner.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
