"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const {
  FILA_VIVA_ARQUIVO,
  FILA_PROJECAO_LEVE_ARQUIVO
} = require("../modules/fila/fila-v2-shadow");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");

function iso(ms) {
  return new Date(ms).toISOString();
}

function oferta(id, extra = {}) {
  return {
    id,
    ofertaId: id,
    clienteId: extra.clienteId || "cliente_integracao_publica",
    titulo: extra.titulo || `Oferta ${id}`,
    marketplace: extra.marketplace || "amazon",
    preco: "R$ 99,90",
    dataEntradaFila: extra.dataEntradaFila || iso(AGORA - 60 * 1000),
    status: extra.status || "pendente",
    statusPublico: extra.statusPublico,
    statusOperacional: extra.statusOperacional,
    canal: "telegram",
    destinoNome: "Canal principal",
    enviadoEm: extra.enviadoEm || "",
    finalizadoEm: extra.finalizadoEm || "",
    destinosEstado: extra.destinosEstado,
    progresso: extra.progresso,
    motivo: extra.motivo || "",
    ...extra
  };
}

function storageArquivo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-read-model-integracao-"));
  function arquivo(cliente, nome) {
    return path.join(root, cliente, nome);
  }
  function garantirDir(cliente) {
    fs.mkdirSync(path.join(root, cliente), { recursive: true });
  }
  return {
    root,
    getClienteJsonPath(cliente, nome) {
      return arquivo(cliente, nome);
    },
    getClientePath(cliente) {
      return path.join(root, cliente);
    },
    readClienteJson(cliente, nome, fallback = null) {
      try {
        return JSON.parse(fs.readFileSync(arquivo(cliente, nome), "utf8"));
      } catch {
        return fallback;
      }
    },
    writeClienteJson(cliente, nome, valor) {
      garantirDir(cliente);
      fs.writeFileSync(arquivo(cliente, nome), JSON.stringify(valor, null, 2), "utf8");
      return true;
    },
    read(cliente, nome) {
      return JSON.parse(fs.readFileSync(arquivo(cliente, nome), "utf8"));
    },
    exists(cliente, nome) {
      return fs.existsSync(arquivo(cliente, nome));
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function manifestStateFake() {
  let generation = 0;
  return {
    async registrarMutacaoDuravel(cliente, payload = {}) {
      const nextGeneration = generation + 1;
      const state = {
        vivaGeneration: generation,
        durableCheckpointGeneration: generation,
        dirtyGeneration: null,
        authorityReady: true
      };
      const escrita = await payload.escreverArquivo({
        state,
        nextGeneration,
        fileRevision: payload.fileRevision || `rev_${nextGeneration}`
      });
      if (escrita?.ok === false) {
        return { ok: false, motivo: escrita.motivo || "writer_falhou", state };
      }
      generation = nextGeneration;
      return {
        ok: true,
        motivo: "fake_manifest_state",
        state: {
          ...state,
          vivaGeneration: generation,
          durableCheckpointGeneration: payload.checkpointSincronizado === true ? generation : state.durableCheckpointGeneration,
          dirtyGeneration: payload.checkpointSincronizado === true ? null : generation
        }
      };
    },
    compararDbJson() {
      return { resultado: "teste_sem_db_real" };
    }
  };
}

(async () => {
  {
    const fonteOperacional = fs.readFileSync(path.join(__dirname, "..", "modules", "fila", "fila-operacional-v2.js"), "utf8");
    const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert(
      fonteOperacional.includes("atualizarProjecaoLeveIncremental(clienteId, resultado.item || item, deps)"),
      "insert/update coordenado deve chamar upsert da projecao HOT publica"
    );
    assert(
      fonteOperacional.includes("removerProjecaoLeveIncremental(clienteId, resultado.item || item, deps)"),
      "remove coordenado deve limpar projecao HOT publica"
    );
    assert(
      fonteIndex.includes("filaOperacionalV2.reconciliarProjecaoHotPublicaCliente(clienteId, {"),
      "startup carregarFila deve reconciliar projecao HOT publica"
    );
  }

  {
    const store = storageArquivo();
    const cliente = "cliente_integracao_publica";
    const logger = { log() {}, warn() {}, error() {} };
    const deps = {
      getClienteJsonPath: store.getClienteJsonPath,
      getClientePath: store.getClientePath,
      readClienteJson: store.readClienteJson,
      writeClienteJson: store.writeClienteJson,
      manifestStateRepository: manifestStateFake(),
      env: { FILA_V2_OPERACIONAL_ATIVA: "true" },
      flushProjecaoLeveSincrono: true,
      logger,
      agora: AGORA
    };
    filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(cliente);
    try {
      const inicial = oferta("exec_real", { clienteId: cliente, status: "pendente" });
      const insert = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, inicial, deps);
      assert.strictEqual(insert.ok, true, "insercao HOT real deve persistir");
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 1, "insercao HOT real alimenta projecao");

      const atualizado = oferta("exec_real", { clienteId: cliente, status: "processando", titulo: "Oferta atualizada" });
      const update = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, atualizado, deps);
      assert.strictEqual(update.ok, true, "atualizacao HOT real deve persistir");
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens[0].titulo, "Oferta atualizada", "atualizacao HOT faz upsert");

      const emCursoComStatusOperacionalEnviado = oferta("exec_real", {
        clienteId: cliente,
        status: "enviado",
        statusPublico: "em_distribuicao",
        progresso: { enviados: 1, total: 2, pendentes: 1, erros: 0 }
      });
      const parcialEmCurso = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, emCursoComStatusOperacionalEnviado, {
        ...deps,
        permitirRegressaoStatus: true
      });
      assert.strictEqual(parcialEmCurso.ok, true);
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 1, "statusPublico em_distribuicao preserva HOT");

      const terminal = oferta("exec_real", {
        clienteId: cliente,
        status: "enviado",
        statusPublico: "enviado",
        enviadoEm: iso(AGORA),
        finalizadoEm: iso(AGORA),
        progresso: { enviados: 2, total: 2, pendentes: 0, erros: 0 }
      });
      const terminalUpdate = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, terminal, {
        ...deps,
        permitirRegressaoStatus: true
      });
      assert.strictEqual(terminalUpdate.ok, true, "terminal real deve persistir");
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 0, "terminal real remove da projecao HOT");

      const removivel = oferta("exec_remove", { clienteId: cliente, status: "pendente" });
      const insertRemove = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, removivel, deps);
      assert.strictEqual(insertRemove.ok, true);
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 1);
      const remove = await filaOperacionalV2.removerItemFilaVivaCoordenado(cliente, removivel, deps);
      assert.strictEqual(remove.ok, true, "remove coordenado deve persistir");
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 0, "remove coordenado nao deixa HOT stale");
      assert(store.exists(cliente, FILA_VIVA_ARQUIVO), "teste passou pelos writers reais da fila viva");
    } finally {
      filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(cliente);
      store.cleanup();
    }
  }

  {
    const store = storageArquivo();
    const cliente = "cliente_restart_publico";
    const logger = { log() {}, warn() {}, error() {} };
    let leiturasFilaJson = 0;
    const fsContador = {
      ...fs,
      readFileSync(file, ...args) {
        if (String(file).endsWith(`${path.sep}fila.json`) || String(file).endsWith("/fila.json")) {
          leiturasFilaJson += 1;
        }
        return fs.readFileSync(file, ...args);
      }
    };
    filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(cliente);
    try {
      const reconcile = filaOperacionalV2.reconciliarProjecaoHotPublicaCliente(cliente, {
        fila: [
          oferta("hot_restart", { clienteId: cliente, status: "pendente" }),
          oferta("terminal_restart", { clienteId: cliente, status: "enviado", statusPublico: "enviado", enviadoEm: iso(AGORA), finalizadoEm: iso(AGORA) })
        ],
        agora: AGORA
      }, {
        getClienteJsonPath: store.getClienteJsonPath,
        writeClienteJson: store.writeClienteJson,
        fs: fsContador,
        logger
      });
      assert.strictEqual(reconcile.ok, true);
      assert.strictEqual(reconcile.projectionReady, true);
      assert.strictEqual(filaOperacionalV2.projectionReadyProjecaoHotPublica(cliente), true);
      assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, 1, "restart reconcilia somente HOT em memoria");
      assert.strictEqual(leiturasFilaJson, 0, "reconcile nao reler fila.json");
    } finally {
      filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(cliente);
      store.cleanup();
    }
  }

  console.log("fila-read-model-publico-integracao.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
