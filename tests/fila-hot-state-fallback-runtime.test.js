"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const inicioProcessarFila = fonteIndex.indexOf("async function processarFilaInterna(");
const fimProcessarFila = fonteIndex.indexOf("async function processarFila(", inicioProcessarFila);

assert.ok(inicioProcessarFila >= 0 && fimProcessarFila > inicioProcessarFila);

const fonteProcessarFila = fonteIndex.slice(inicioProcessarFila, fimProcessarFila);
const inicioSalvar = fonteProcessarFila.indexOf("const salvarFilaSeAlterada = async");
const fimSalvar = fonteProcessarFila.indexOf("\n\n  try {", inicioSalvar);

assert.ok(inicioSalvar >= 0 && fimSalvar > inicioSalvar);

const fonteSalvarFilaSeAlterada = fonteProcessarFila.slice(inicioSalvar, fimSalvar);
const prefixoSalvar = fonteProcessarFila.slice(0, inicioSalvar);
const declaracaoExterna = prefixoSalvar.match(/let fonteClienteHotStateSelecao\s*=\s*null\s*;/)?.[0] || "";
const atribuicaoHotState = fonteProcessarFila.slice(fimSalvar).match(
  /(?:const\s+)?fonteClienteHotStateSelecao\s*=\s*fonteClienteHotStateExecutorV2\(\s*clienteFila\s*,\s*reconciliacaoLeituraFilaV2\s*\);/
)?.[0];

assert.ok(atribuicaoHotState, "atribuicao real do hot state deve ser localizada");

const fonteHarness = `
async function executarFallbackRuntime() {
  ${declaracaoExterna}
  ${fonteSalvarFilaSeAlterada}

  try {
    ${atribuicaoHotState}
    const resultados = [];
    for (let tentativa = 0; tentativa < repeticoes; tentativa += 1) {
      if (tentativa > 0) filaAlterada = true;
      resultados.push(await salvarFilaSeAlterada(clienteFila));
    }
    return { resultados, filaAlterada };
  } catch (erro) {
    throw erro;
  }
}
executarFallbackRuntime();
`;

async function executarCenario(opcoes = {}) {
  const rastros = {
    checkpointDirty: 0,
    materializacoes: 0,
    saves: 0,
    sincronizacoes: [],
    filaGlobal: []
  };
  const hotState = Object.prototype.hasOwnProperty.call(opcoes, "hotState")
    ? opcoes.hotState
    : { conclusiva: true, itens: [{ id: "oferta-runtime" }] };

  const contexto = {
    clienteFila: "workspace_runtime",
    reconciliacaoLeituraFilaV2: { conclusiva: true },
    oferta: opcoes.comOferta === false ? null : { id: "oferta-runtime" },
    filaAlterada: opcoes.filaAlterada !== false,
    repeticoes: opcoes.repeticoes || 1,
    fonteClienteHotStateExecutorV2: () => hotState,
    perfilProcessarFila: {
      etapa: async (_nome, executar) => executar()
    },
    filaOperacionalV2: {
      deveUsarFilaV2Operacional: () => opcoes.v2 !== false
    },
    sincronizarItemFilaVivaAposMutacao: async (_clienteId, _oferta, motivo) => {
      rastros.sincronizacoes.push(motivo);
      return motivo === "executor_salvar_alterada_checkpoint_only"
        ? { confirmada: opcoes.syncConfirmado === true, generation: 7, dbState: {} }
        : { confirmada: true, generation: 8, dbState: {} };
    },
    syncVivaMutacaoConfirmada: (resultado) => resultado?.confirmada === true,
    checkpointFilaV2: {
      marcarDirty: () => {
        rastros.checkpointDirty += 1;
        return { mutacoes: 1, dirtyAgeMs: 0 };
      }
    },
    logFilaV22C: () => {},
    materializarFilaClienteHotStateNaGlobal: (_clienteId, itens) => {
      rastros.materializacoes += 1;
      rastros.filaGlobal = Array.isArray(itens) ? itens.map((item) => ({ ...item })) : [];
    },
    salvarFila: () => {
      rastros.saves += 1;
      if (opcoes.erroPersistencia) throw new Error("falha_persistencia_legitima");
      return true;
    },
    String,
    Boolean,
    Array,
    Date
  };

  const resultado = await vm.runInNewContext(fonteHarness, contexto, {
    filename: "fila-hot-state-fallback-runtime.js"
  });
  return { resultado, rastros };
}

(async () => {
  const fastPath = await executarCenario({ syncConfirmado: true });
  assert.deepStrictEqual(Array.from(fastPath.resultado.resultados), [true]);
  assert.strictEqual(fastPath.rastros.checkpointDirty, 1);
  assert.strictEqual(fastPath.rastros.materializacoes, 0);
  assert.strictEqual(fastPath.rastros.saves, 0);

  const fallback = await executarCenario({ syncConfirmado: false });
  assert.deepStrictEqual(Array.from(fallback.resultado.resultados), [true]);
  assert.strictEqual(fallback.rastros.materializacoes, 1);
  assert.strictEqual(fallback.rastros.saves, 1);
  assert.deepStrictEqual(fallback.rastros.filaGlobal.map((item) => item.id), ["oferta-runtime"]);

  const legado = await executarCenario({ v2: false, syncConfirmado: false });
  assert.strictEqual(legado.rastros.materializacoes, 0);
  assert.strictEqual(legado.rastros.saves, 1);

  const filaVazia = await executarCenario({ comOferta: false, filaAlterada: false });
  assert.deepStrictEqual(Array.from(filaVazia.resultado.resultados), [false]);
  assert.strictEqual(filaVazia.rastros.saves, 0);

  const semHotState = await executarCenario({ hotState: null, syncConfirmado: false });
  assert.strictEqual(semHotState.rastros.materializacoes, 0);
  assert.strictEqual(semHotState.rastros.saves, 1);

  await assert.rejects(
    executarCenario({ syncConfirmado: false, erroPersistencia: true }),
    /falha_persistencia_legitima/
  );

  const retry = await executarCenario({ syncConfirmado: false, repeticoes: 2 });
  assert.deepStrictEqual(Array.from(retry.resultado.resultados), [true, true]);
  assert.strictEqual(retry.rastros.materializacoes, 2);
  assert.strictEqual(retry.rastros.saves, 2);
  assert.deepStrictEqual(retry.rastros.filaGlobal.map((item) => item.id), ["oferta-runtime"]);

  console.log("fila-hot-state-fallback-runtime.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
