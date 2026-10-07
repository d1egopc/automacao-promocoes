"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { criarFilaStore } = require("../modules/fila/fila-store");
const { executarPrimeiraAvaliacaoLane } = require("../modules/fila/fila-dual-read");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const inicio = fonteIndex.indexOf("function candidatosExpiracaoFilaV2(");
const fim = fonteIndex.indexOf("const filaInteligenteUltimoAbastecimento", inicio);

assert(inicio >= 0 && fim > inicio, "runtime de saneamento deve existir no index real");

const fonteSanear = fonteIndex.slice(inicio, fim);
assert(
  fonteSanear.includes("Object.prototype.hasOwnProperty.call(") &&
    fonteSanear.includes('"reconciliacaoLeituraFilaV2"') &&
    fonteSanear.includes('estado: "inconclusiva"') &&
    fonteSanear.includes("saneamento_expiracao_fail_closed"),
  "saneamento deve reutilizar prova explicita e discriminar fail-closed"
);
assert(
  !fonteSanear.includes("executorGenerationAuthority"),
  "saneamento nao pode obter override dedicado de authority"
);

const inicioProcessar = fonteIndex.indexOf("async function processarFilaInterna(");
const fimProcessar = fonteIndex.indexOf("async function processarFila(", inicioProcessar);
const fonteProcessar = fonteIndex.slice(inicioProcessar, fimProcessar);
assert(
  fonteProcessar.includes("sanearExpiradosFila(clienteFila, {") &&
    fonteProcessar.includes("reconciliacaoLeituraFilaV2") &&
    fonteProcessar.includes("saneamentoExpiracaoExecutado: true"),
  "executor deve propagar sua prova e evitar segundo saneamento na mesma rodada"
);

const WORKSPACE = "workspace_incidente";

function item(id, extra = {}) {
  return {
    id,
    clienteId: WORKSPACE,
    status: "pendente",
    destinosEstado: [],
    ...extra
  };
}

function provaExecutor(extra = {}) {
  return {
    ok: true,
    clienteId: WORKSPACE,
    autoridadeUsada: "generation",
    generationConclusiva: true,
    fastPathExecutor: true,
    motivo: "generation_viva_mais_nova",
    ...extra
  };
}

function criarRuntime(itensIniciais, opcoes = {}) {
  let viva = itensIniciais;
  const filaLegada = Array.isArray(opcoes.filaLegada) ? opcoes.filaLegada : [];
  const filaStore = criarFilaStore(viva);
  const rastros = {
    reconciliacoesGenericas: 0,
    leiturasViva: 0,
    persistencias: 0,
    rebuilds: 0
  };

  const filaOperacionalV2 = {
    deveUsarFilaV2Operacional: () => opcoes.v2Ativo !== false,
    reconciliarFilaV2ParaLeitura: async () => {
      rastros.reconciliacoesGenericas += 1;
      return opcoes.decisaoGlobal || {
        ok: true,
        clienteId: WORKSPACE,
        autoridadeUsada: "mtime",
        generationConclusiva: false,
        fallbackMtime: true,
        motivo: "authority_not_ready"
      };
    },
    lerFilaVivaParaMerge: () => {
      rastros.leiturasViva += 1;
      if (opcoes.falharLeituraVivaNumero === rastros.leiturasViva) {
        return { ok: false, motivo: "viva_indisponivel" };
      }
      return {
        ok: true,
        motivo: "ok",
        bytes: viva.length * 10,
        entradas: viva.map(atual => ({ bucket: "viva", item: atual }))
      };
    }
  };

  const contexto = {
    fila: filaLegada,
    filaOperacionalV2,
    console: { log: () => {} },
    String,
    Array,
    Error,
    Object,
    sanearExpiracaoOperacionalFilaItem: atual => {
      if (atual.expirarNoSaneamento !== true) return { alterou: false, expirou: false };
      atual.status = "expirada_operacional";
      return { alterou: true, expirou: true, ttlMs: 1, tipoFluxo: "normal" };
    },
    persistirExpiracaoFila: async (_cliente, alterados) => {
      rastros.persistencias += 1;
      const resultado = opcoes.persistencia || { ok: true, alterou: true, checkpointOnly: true };
      if (resultado.ok === true && resultado.fallbackLegado !== true) {
        viva = viva.filter(atual => !alterados.some(removido => removido.id === atual.id));
      }
      return resultado;
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
    clienteId: WORKSPACE,
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

    assert.strictEqual(
      await runtime.sanear(WORKSPACE, { reconciliacaoLeituraFilaV2: provaExecutor() }),
      true
    );

    const fonteAtualizada = runtime.filaStore.itensPorCliente(WORKSPACE);
    assert.deepStrictEqual(fonteAtualizada.map(atual => atual.id), ["B"]);
    assert.strictEqual(
      runtime.rastros.reconciliacoesGenericas,
      0,
      "global mtime nao pode contradizer a prova conclusiva do executor"
    );
    assert.strictEqual(runtime.rastros.leiturasViva, 2, "deve ler VIVA antes e uma vez depois da mutacao");
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

    assert.strictEqual(
      await runtime.sanear(WORKSPACE, { reconciliacaoLeituraFilaV2: provaExecutor() }),
      false
    );
    assert.strictEqual(runtime.rastros.reconciliacoesGenericas, 0);
    assert.strictEqual(runtime.rastros.persistencias, 0);
    assert.strictEqual(runtime.rastros.leiturasViva, 1, "sem mutacao deve haver somente a leitura factual inicial");
    assert.strictEqual(runtime.rastros.rebuilds, 0, "sem mutacao nao deve reconstruir filaStore");
  }

  {
    const legado = item("legado", { expirarNoSaneamento: true });
    const runtime = criarRuntime([], { v2Ativo: false, filaLegada: [legado] });

    assert.strictEqual(await runtime.sanear(WORKSPACE), true, "V2 OFF deve preservar saneamento legado");
    assert.strictEqual(runtime.rastros.reconciliacoesGenericas, 0);
    assert.strictEqual(runtime.rastros.leiturasViva, 0);
    assert.strictEqual(runtime.rastros.rebuilds, 0);
  }

  {
    const runtime = criarRuntime([item("inconclusiva")]);
    await assert.rejects(
      runtime.sanear(WORKSPACE, {
        reconciliacaoLeituraFilaV2: provaExecutor({ generationConclusiva: false, motivo: "authority_not_ready" })
      }),
      /saneamento_expiracao_fail_closed:authority_not_ready/
    );
    assert.deepStrictEqual(runtime.rastros, {
      reconciliacoesGenericas: 0,
      leiturasViva: 0,
      persistencias: 0,
      rebuilds: 0
    });
  }

  {
    const runtime = criarRuntime([item("outra_workspace")]);
    await assert.rejects(
      runtime.sanear(WORKSPACE, {
        reconciliacaoLeituraFilaV2: provaExecutor({ clienteId: "workspace_diferente" })
      }),
      /saneamento_expiracao_fail_closed:authority_workspace_divergente/
    );
    assert.strictEqual(runtime.rastros.leiturasViva, 0);
  }

  {
    const runtime = criarRuntime([item("sem_prova")]);
    await assert.rejects(
      runtime.sanear(WORKSPACE),
      /saneamento_expiracao_fail_closed:authority_not_ready/
    );
    assert.strictEqual(runtime.rastros.reconciliacoesGenericas, 1, "caller sem prova usa politica global existente");
    assert.strictEqual(runtime.rastros.leiturasViva, 0);
  }

  {
    const runtime = criarRuntime([item("policy_global_conclusiva")], {
      decisaoGlobal: provaExecutor({ fastPathExecutor: false })
    });
    assert.strictEqual(await runtime.sanear(WORKSPACE), false);
    assert.strictEqual(runtime.rastros.reconciliacoesGenericas, 1);
    assert.strictEqual(runtime.rastros.leiturasViva, 1);
    assert.strictEqual(runtime.rastros.rebuilds, 0);
  }

  {
    const runtime = criarRuntime([item("viva_indisponivel")], { falharLeituraVivaNumero: 1 });
    await assert.rejects(
      runtime.sanear(WORKSPACE, { reconciliacaoLeituraFilaV2: provaExecutor() }),
      /saneamento_expiracao_fail_closed:leitura_viva_indisponivel/
    );
    assert.strictEqual(runtime.rastros.persistencias, 0);
    assert.strictEqual(runtime.rastros.rebuilds, 0);
  }

  {
    const removido = item("persistencia_inconclusiva", { expirarNoSaneamento: true });
    const runtime = criarRuntime([removido], {
      persistencia: { ok: false, motivo: "mutacao_viva_nao_confirmada" }
    });

    await assert.rejects(
      runtime.sanear(WORKSPACE, { reconciliacaoLeituraFilaV2: provaExecutor() }),
      /saneamento_hot_state_nao_confirmado:mutacao_viva_nao_confirmada/
    );
    assert.strictEqual(runtime.rastros.leiturasViva, 1, "persistencia inconclusiva aborta antes da releitura");
    assert.strictEqual(runtime.rastros.rebuilds, 0);
  }

  {
    const removido = item("releitura_inconclusiva", { expirarNoSaneamento: true });
    const runtime = criarRuntime([removido], { falharLeituraVivaNumero: 2 });

    await assert.rejects(
      runtime.sanear(WORKSPACE, { reconciliacaoLeituraFilaV2: provaExecutor() }),
      /saneamento_hot_state_nao_confirmado:releitura_viva_inconclusiva/
    );
    assert.strictEqual(runtime.rastros.rebuilds, 0, "releitura inconclusiva nao publica hot-state");
  }

  {
    const concorrente = item("concorrente");
    const runtime = criarRuntime([concorrente]);
    const fonteAtualizada = runtime.filaStore.itensPorCliente(WORKSPACE);
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
    assert.strictEqual(concorrente.primeiraAvaliacaoDestinosEm, undefined);
  }

  console.log("fila-first-evaluation-sanitization-coherence.test.js: PASS");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
