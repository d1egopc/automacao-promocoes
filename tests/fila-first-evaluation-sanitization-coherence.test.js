"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { criarFilaStore } = require("../modules/fila/fila-store");
const { executarPrimeiraAvaliacaoLane } = require("../modules/fila/fila-dual-read");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const inicio = fonteIndex.indexOf("async function sanearExpiradosFila(");
const fim = fonteIndex.indexOf("const filaInteligenteUltimoAbastecimento", inicio);

assert(inicio >= 0 && fim > inicio, "sanearExpiradosFila deve existir no runtime real");

const fonteSanear = fonteIndex.slice(inicio, fim);
assert(
  fonteSanear.includes("const fonteExpiracaoSelecao = await candidatosExpiracaoSelecaoFilaV2(cliente);"),
  "saneamento deve aguardar a fonte conclusiva"
);

function item(id, extra = {}) {
  return {
    id,
    clienteId: "workspace_incidente",
    status: "pendente",
    destinosEstado: [],
    ...extra
  };
}

function criarRuntime(itensIniciais, opcoes = {}) {
  let viva = itensIniciais;
  const filaStore = criarFilaStore(viva);
  const rastros = {
    consultasAuthority: 0,
    persistencias: 0,
    releiturasViva: 0,
    rebuilds: 0
  };

  const contexto = {
    fila: [],
    console: { log: () => {} },
    String,
    Array,
    Error,
    candidatosExpiracaoSelecaoFilaV2: async () => {
      rastros.consultasAuthority += 1;
      await Promise.resolve();
      return { fonte: "fila_viva", itens: [...viva] };
    },
    candidatosExpiracaoFilaV2: () => {
      rastros.releiturasViva += 1;
      return { fonte: "fila_viva", itens: [...viva] };
    },
    sanearExpiracaoOperacionalFilaItem: atual => {
      if (atual.expirarNoSaneamento !== true) return { alterou: false, expirou: false };
      atual.status = "expirada_operacional";
      return { alterou: true, expirou: true, ttlMs: 1, tipoFluxo: "normal" };
    },
    persistirExpiracaoFila: async (_cliente, alterados) => {
      rastros.persistencias += 1;
      viva = viva.filter(atual => !alterados.some(removido => removido.id === atual.id));
      return opcoes.persistencia || { ok: true, alterou: true, checkpointOnly: true };
    },
    reconstruirFilaStoreCliente: (cliente, _motivo, parametros) => {
      rastros.rebuilds += 1;
      filaStore.rebuildCliente(parametros.filaClienteHotState, cliente, { motivo: "teste" });
    }
  };

  vm.runInNewContext(`${fonteSanear}\nresultado = sanearExpiradosFila;`, contexto, {
    filename: "fila-first-evaluation-sanitization-runtime.js"
  });

  return {
    sanear: contexto.resultado,
    filaStore,
    rastros,
    removerExternamente(id) {
      viva = viva.filter(atual => atual.id !== id);
    }
  };
}

function candidato(oferta) {
  return {
    oferta,
    avaliacao: {
      elegivel: false,
      motivo: "sem_destino_liberado_agora",
      destinosLiberados: [],
      inspecaoDestinos: []
    }
  };
}

function depsLane(itens, persistirItem) {
  return {
    fonteClienteHotState: { conclusiva: true, itens },
    clienteId: "workspace_incidente",
    agora: Date.parse("2026-10-07T12:00:00.000Z"),
    relocalizarOferta: (colecao, referencia, opcoes = {}) => {
      const oferta = colecao.find(atual => atual.id === referencia.id && atual.clienteId === opcoes.clienteId);
      return oferta ? { ok: true, oferta } : { ok: false, oferta: null };
    },
    ofertaExpiradaParaEnvio: () => false,
    registrarDestinoEstado: () => null,
    persistirItem
  };
}

(async () => {
  {
    const removido = item("A", { expirarNoSaneamento: true });
    const vivo = item("B");
    const runtime = criarRuntime([removido, vivo]);

    assert.strictEqual(await runtime.sanear("workspace_incidente"), true);

    const fonteAtualizada = runtime.filaStore.itensPorCliente("workspace_incidente");
    assert.deepStrictEqual(fonteAtualizada.map(atual => atual.id), ["B"]);
    assert.strictEqual(runtime.rastros.consultasAuthority, 1, "authority deve ser consultada uma unica vez");
    assert.strictEqual(runtime.rastros.releiturasViva, 1, "VIVA deve ser relida somente apos mutacao");
    assert.strictEqual(runtime.rastros.rebuilds, 1, "filaStore deve ser reconstruido somente apos mutacao");

    const writerCalls = { A: 0, B: 0 };
    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane(fonteAtualizada, async preparado => {
        writerCalls[preparado.id] += 1;
        return { ok: true };
      }),
      candidatosInspecao: fonteAtualizada.map(candidato)
    });

    assert.strictEqual(writerCalls.A, 0, "item removido no saneamento nao pode chegar ao writer");
    assert.strictEqual(writerCalls.B, 1, "item vivo deve ser persistido exatamente uma vez");
    assert(resultado.candidatosSelecionados <= 2, "batch da Lane deve permanecer no maximo 2");
  }

  {
    const vivo = item("sem_mutacao");
    const runtime = criarRuntime([vivo]);

    assert.strictEqual(await runtime.sanear("workspace_incidente"), false);
    assert.strictEqual(runtime.rastros.persistencias, 0);
    assert.strictEqual(runtime.rastros.releiturasViva, 0, "sem mutacao nao deve reler VIVA");
    assert.strictEqual(runtime.rastros.rebuilds, 0, "sem mutacao nao deve reconstruir filaStore");
    assert.deepStrictEqual(runtime.filaStore.itensPorCliente("workspace_incidente").map(atual => atual.id), ["sem_mutacao"]);
  }

  {
    const removido = item("persistencia_inconclusiva", { expirarNoSaneamento: true });
    const runtime = criarRuntime([removido], {
      persistencia: { ok: false, motivo: "mutacao_viva_nao_confirmada" }
    });

    await assert.rejects(
      runtime.sanear("workspace_incidente"),
      /saneamento_hot_state_nao_confirmado:mutacao_viva_nao_confirmada/
    );
    assert.strictEqual(runtime.rastros.rebuilds, 0, "persistencia inconclusiva nao pode publicar hot-state conclusivo");
  }

  {
    const concorrente = item("concorrente");
    const runtime = criarRuntime([concorrente]);
    const fonteAtualizada = runtime.filaStore.itensPorCliente("workspace_incidente");
    let writerCalls = 0;

    const resultado = await executarPrimeiraAvaliacaoLane({
      ...depsLane(fonteAtualizada, async preparado => {
        writerCalls += 1;
        runtime.removerExternamente(preparado.id);
        return {
          ok: false,
          tipoFalha: "mutacao_nao_confirmada",
          motivo: "item_nao_encontrado_na_viva"
        };
      }),
      candidatosInspecao: [candidato(concorrente)]
    });

    assert.strictEqual(writerCalls, 1);
    assert.strictEqual(resultado.inspecionados, 0);
    assert.strictEqual(resultado.falhas, 1);
    assert.strictEqual(resultado.falhasPorMotivo.mutacao_nao_confirmada, 1);
    assert.deepStrictEqual(resultado.motivosPersistencia, ["item_nao_encontrado_na_viva"]);
    assert.strictEqual(concorrente.primeiraAvaliacaoDestinosEm, undefined, "concorrencia real deve permanecer fail-closed");
  }

  console.log("fila-first-evaluation-sanitization-coherence.test.js: PASS");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
