"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = require("../modules/fila/fila-manifest-state.repository");
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarPoolFake(opcoes = {}) {
  const state = new Map();
  const locks = new Map();
  const chamadas = [];
  let nextConnectionId = 1;

  function row(clienteId) {
    const atual = state.get(clienteId);
    if (!atual) return null;
    return {
      cliente_id: clienteId,
      revision: atual.revision,
      viva_generation: atual.viva_generation,
      durable_checkpoint_generation: atual.durable_checkpoint_generation,
      dirty_generation: atual.dirty_generation,
      updated_at: atual.updated_at || new Date("2026-08-28T00:00:00.000Z")
    };
  }

  async function acquireLock(clienteId, client) {
    const anterior = locks.get(clienteId) || Promise.resolve();
    let liberar;
    const atual = new Promise(resolve => {
      liberar = resolve;
    });
    locks.set(clienteId, anterior.then(() => atual));
    await anterior;
    client.locks.push({ clienteId, liberar });
  }

  function releaseLocks(client) {
    for (const lock of client.locks.splice(0)) {
      lock.liberar();
    }
  }

  return {
    state,
    chamadas,
    connectCount: () => nextConnectionId - 1,
    async connect() {
      const client = {
        id: nextConnectionId,
        snapshot: null,
        locks: [],
        async query(sql, params = []) {
          const texto = String(sql || "").replace(/\s+/g, " ").trim();
          chamadas.push({ clientId: client.id, sql: texto, params: clonar(params) });

          if (texto === "BEGIN") {
            client.snapshot = clonar([...state.entries()]);
            return { rows: [], rowCount: 0 };
          }
          if (texto === "COMMIT") {
            if (opcoes.falharCommit) throw new Error("commit_falhou");
            client.snapshot = null;
            releaseLocks(client);
            return { rows: [], rowCount: 0 };
          }
          if (texto === "ROLLBACK") {
            if (client.snapshot) {
              state.clear();
              for (const [chave, valor] of client.snapshot) state.set(chave, valor);
            }
            client.snapshot = null;
            releaseLocks(client);
            return { rows: [], rowCount: 0 };
          }
          if (/^CREATE TABLE IF NOT EXISTS queue_manifest_state/i.test(texto)) {
            return { rows: [], rowCount: 0 };
          }
          if (/^INSERT INTO queue_manifest_state/i.test(texto)) {
            const [clienteId, viva, durable, dirty] = params;
            if (!state.has(clienteId)) {
              state.set(clienteId, {
                revision: 0,
                viva_generation: Number(viva || 0),
                durable_checkpoint_generation: Number(durable || 0),
                dirty_generation: dirty === null || dirty === undefined ? null : Number(dirty),
                updated_at: new Date("2026-08-28T00:00:00.000Z")
              });
            }
            return { rows: [], rowCount: 1 };
          }
          if (/^SELECT .* FROM queue_manifest_state .* FOR UPDATE$/i.test(texto)) {
            const clienteId = params[0];
            await acquireLock(clienteId, client);
            return { rows: state.has(clienteId) ? [row(clienteId)] : [], rowCount: state.has(clienteId) ? 1 : 0 };
          }
          if (/^SELECT .* FROM queue_manifest_state/i.test(texto)) {
            const clienteId = params[0];
            return { rows: state.has(clienteId) ? [row(clienteId)] : [], rowCount: state.has(clienteId) ? 1 : 0 };
          }
          if (/^UPDATE queue_manifest_state/i.test(texto)) {
            if (opcoes.falharUpdate) throw new Error("update_falhou");
            const [clienteId, viva, durable, dirty] = params;
            const atual = state.get(clienteId) || {
              revision: 0,
              viva_generation: 0,
              durable_checkpoint_generation: 0,
              dirty_generation: null
            };
            state.set(clienteId, {
              revision: Number(atual.revision || 0) + 1,
              viva_generation: Number(viva || 0),
              durable_checkpoint_generation: Number(durable || 0),
              dirty_generation: dirty === null || dirty === undefined ? null : Number(dirty),
              updated_at: new Date("2026-08-28T00:00:01.000Z")
            });
            return { rows: [row(clienteId)], rowCount: 1 };
          }
          throw new Error(`sql_nao_suportado: ${texto}`);
        },
        release() {
          releaseLocks(client);
        }
      };
      nextConnectionId += 1;
      return client;
    }
  };
}

function criarStorageTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-manifest-state-"));
  const getClienteJsonPath = (clienteId, arquivo) => path.join(dir, clienteId, arquivo);
  const writeJson = (clienteId, arquivo, dados) => {
    const file = getClienteJsonPath(clienteId, arquivo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(dados), "utf8");
    return file;
  };
  return { dir, getClienteJsonPath, writeJson };
}

function aguardarFilaAsync() {
  return new Promise(resolve => setTimeout(resolve, 10));
}

(async () => {
  assert(repo.SQL_SCHEMA_QUEUE_MANIFEST_STATE.includes("PRIMARY KEY"));
  assert(repo.SQL_SCHEMA_QUEUE_MANIFEST_STATE.includes("durable_checkpoint_generation <= viva_generation"));

  assert.strictEqual(repo.bootstrapValido({
    manifestVersion: 1,
    vivaGeneration: 10,
    durableCheckpointGeneration: 10,
    dirtyGeneration: null
  }), null, "manifest v1 nao pode inicializar autoridade duravel");

  assert.deepStrictEqual(repo.estadoBootstrap("cliente_boot", {
    manifestVersion: 2,
    vivaGeneration: 3,
    durableCheckpointGeneration: 1,
    dirtyGeneration: 2
  }), {
    clienteId: "cliente_boot",
    revision: 0,
    vivaGeneration: 3,
    durableCheckpointGeneration: 1,
    dirtyGeneration: 2,
    updatedAt: null
  });

  {
    const pool = criarPoolFake();
    const ordem = [];
    const a = repo.registrarMutacaoDuravel("cliente_a", {
      motivo: "processo_a",
      escreverArquivo: async ({ nextGeneration }) => {
        ordem.push(`a:${nextGeneration}`);
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ok: true };
      }
    }, { pool });
    const b = repo.registrarMutacaoDuravel("cliente_a", {
      motivo: "processo_b",
      escreverArquivo: ({ nextGeneration }) => {
        ordem.push(`b:${nextGeneration}`);
        return { ok: true };
      }
    }, { pool });
    const [ra, rb] = await Promise.all([a, b]);
    const leitura = await repo.lerStateObservacional("cliente_a", { pool });

    assert.strictEqual(ra.ok, true);
    assert.strictEqual(rb.ok, true);
    assert.deepStrictEqual(ordem.sort(), ["a:1", "b:2"], "SELECT FOR UPDATE deve serializar nextGeneration por cliente");
    assert.strictEqual(leitura.state.vivaGeneration, 2);
    assert.strictEqual(leitura.state.revision, 2);
    assert.strictEqual(leitura.state.durableCheckpointGeneration, 0);
    assert.strictEqual(leitura.state.dirtyGeneration, 1);
  }

  {
    const pool = criarPoolFake();
    const [a, b] = await Promise.all([
      repo.registrarMutacaoDuravel("cliente_a", { motivo: "a" }, { pool }),
      repo.registrarMutacaoDuravel("cliente_b", { motivo: "b" }, { pool })
    ]);
    assert.strictEqual(a.state.vivaGeneration, 1);
    assert.strictEqual(b.state.vivaGeneration, 1, "clientes diferentes nao compartilham geracao");
  }

  {
    const pool = criarPoolFake();
    await repo.registrarMutacaoDuravel("cliente_checkpoint", { motivo: "insert_1" }, { pool });
    const target = await repo.capturarTargetCheckpoint("cliente_checkpoint", {}, { pool });
    await repo.registrarMutacaoDuravel("cliente_checkpoint", { motivo: "insert_durante_checkpoint" }, { pool });
    const checkpoint = await repo.confirmarCheckpointDuravel("cliente_checkpoint", {
      targetGeneration: target.targetGeneration,
      motivo: "checkpoint"
    }, { pool });

    assert.strictEqual(target.targetGeneration, 1);
    assert.strictEqual(checkpoint.state.vivaGeneration, 2);
    assert.strictEqual(checkpoint.state.durableCheckpointGeneration, 1);
    assert.strictEqual(checkpoint.state.dirtyGeneration, 2, "mutacao posterior ao target continua dirty");
  }

  {
    const pool = criarPoolFake();
    await repo.registrarMutacaoDuravel("cliente_dois_checkpoints", {}, { pool });
    await repo.registrarMutacaoDuravel("cliente_dois_checkpoints", {}, { pool });
    const recente = await repo.confirmarCheckpointDuravel("cliente_dois_checkpoints", { targetGeneration: 2 }, { pool });
    const antigo = await repo.confirmarCheckpointDuravel("cliente_dois_checkpoints", { targetGeneration: 1 }, { pool });

    assert.strictEqual(recente.state.durableCheckpointGeneration, 2);
    assert.strictEqual(antigo.state.durableCheckpointGeneration, 2, "checkpoint antigo terminando depois nao regride durable");
    assert.strictEqual(antigo.state.dirtyGeneration, null);
  }

  {
    const pool = criarPoolFake();
    const invalido = await repo.confirmarCheckpointDuravel("cliente_target_invalido", {
      targetGeneration: null
    }, { pool });
    const leitura = await repo.lerStateObservacional("cliente_target_invalido", { pool });
    assert.strictEqual(invalido.ok, false);
    assert.strictEqual(invalido.motivo, "target_generation_invalido");
    assert.strictEqual(leitura.ok, false, "target invalido nao deve criar linha nem virar generation 0");
  }

  {
    const pool = criarPoolFake();
    const sync = await repo.registrarLegacySyncDuravel("cliente_legacy_sync", {
      motivo: "executor_salvar_alterada"
    }, { pool });
    assert.strictEqual(sync.state.vivaGeneration, 1);
    assert.strictEqual(sync.state.durableCheckpointGeneration, 1);
    assert.strictEqual(sync.state.dirtyGeneration, null, "sync legado ja representa fila.json salva");
  }

  {
    const pool = criarPoolFake();
    const falhaArquivo = await repo.registrarMutacaoDuravel("cliente_arquivo_falha", {
      escreverArquivo: () => ({ ok: false, motivo: "write_viva_falhou" })
    }, { pool });
    const leitura = await repo.lerStateObservacional("cliente_arquivo_falha", { pool });
    assert.strictEqual(falhaArquivo.ok, false);
    assert.strictEqual(leitura.ok, false, "falha de arquivo deve rollbackar linha criada na transacao");
  }

  {
    const pool = criarPoolFake({ falharUpdate: true });
    const falhaSql = await repo.registrarMutacaoDuravel("cliente_sql_falha", {}, { pool });
    const leitura = await repo.lerStateObservacional("cliente_sql_falha", { pool });
    assert.strictEqual(falhaSql.ok, false);
    assert.strictEqual(leitura.ok, false, "falha SQL deve manter DB conservador");
  }

  {
    const semPool = await repo.registrarMutacaoDuravel("cliente_sem_db", {}, { pool: null });
    assert.strictEqual(semPool.ok, false);
    assert.strictEqual(semPool.motivo, "pool_indisponivel");
  }

  {
    const state = {
      clienteId: "cliente_cmp",
      revision: 3,
      vivaGeneration: 5,
      durableCheckpointGeneration: 4,
      dirtyGeneration: 5
    };
    assert.strictEqual(repo.compararDbJson(state, {
      manifestVersion: 2,
      vivaGeneration: 5,
      durableCheckpointGeneration: 4,
      dirtyGeneration: 5
    }).resultado, "db_json_equivalente");
    assert.strictEqual(repo.compararDbJson(state, {
      manifestVersion: 2,
      vivaGeneration: 4,
      durableCheckpointGeneration: 4,
      dirtyGeneration: null
    }).resultado, "db_json_divergente");
  }

  {
    const storage = criarStorageTemp();
    const cliente = "cliente_integracao_db";
    const chamadas = [];
    const logs = [];
    const fakeRepo = {
      compararDbJson: repo.compararDbJson,
      async lerStateObservacional(clienteId) {
        chamadas.push({ tipo: "read", clienteId });
        return {
          ok: true,
          state: {
            clienteId,
            revision: 1,
            vivaGeneration: 1,
            durableCheckpointGeneration: 0,
            dirtyGeneration: 1
          }
        };
      }
    };

    storage.writeJson(cliente, "fila.json", []);
    storage.writeJson(cliente, "fila-viva.json", []);
    storage.writeJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, {
      manifestVersion: 2,
      vivaGeneration: 1,
      durableCheckpointGeneration: 0,
      dirtyGeneration: 1
    });
    fs.utimesSync(storage.getClienteJsonPath(cliente, "fila.json"), new Date(1000), new Date(1000));
    fs.utimesSync(storage.getClienteJsonPath(cliente, "fila-viva.json"), new Date(2000), new Date(2000));

    filaOperacionalV2.resetarThrottleManifestStateParaTeste();
    const resultado = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: fakeRepo,
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: (...args) => logs.push(args.join(" ")) }
    });
    await aguardarFilaAsync();

    assert.strictEqual(resultado.maisNova, true, "mtime continua autoridade operacional");
    assert.strictEqual(chamadas.length, 1, "canario V2 deve consultar DB observacional pequeno");
    assert(logs.some(linha => linha.includes("[FILA-V2-MANIFEST-STATE]")));
  }

  {
    const storage = criarStorageTemp();
    const cliente = "cliente_off_canary_db";
    const chamadas = [];
    storage.writeJson(cliente, "fila.json", []);
    storage.writeJson(cliente, "fila-viva.json", []);
    storage.writeJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, {
      manifestVersion: 2,
      vivaGeneration: 1,
      durableCheckpointGeneration: 0,
      dirtyGeneration: 1
    });

    filaOperacionalV2.resetarThrottleManifestStateParaTeste();
    filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: {
        async lerStateObservacional() {
          chamadas.push("read");
          return { ok: true };
        },
        compararDbJson: repo.compararDbJson
      },
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: "outro_cliente"
      },
      logger: { log: () => {} }
    });
    await aguardarFilaAsync();

    assert.strictEqual(chamadas.length, 0, "workspace off-canary nao deve consultar Postgres observacional");
    assert.strictEqual(filaOperacionalV2.tamanhoThrottleManifestStateParaTeste(), 0);
  }

  {
    const storage = criarStorageTemp();
    const cliente = "cliente_manifest_write_db";
    const chamadas = [];
    const fakeRepo = {
      compararDbJson: repo.compararDbJson,
      async registrarMutacaoDuravel(clienteId, dados) {
        chamadas.push({ tipo: "mutacao", clienteId, dados });
        return {
          ok: true,
          state: {
            clienteId,
            revision: 1,
            vivaGeneration: 1,
            durableCheckpointGeneration: 0,
            dirtyGeneration: 1
          }
        };
      }
    };

    const resultado = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
      itemCount: 1,
      motivo: "insert_viva"
    }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: (clienteId, arquivo, dados) => {
        storage.writeJson(clienteId, arquivo, dados);
        return true;
      },
      manifestStateRepository: fakeRepo,
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    await aguardarFilaAsync();

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(chamadas.length, 1, "manifesto JSON escrito deve agendar estado Postgres observacional para canario");
    assert.strictEqual(chamadas[0].dados.bootstrapManifest.vivaGeneration, 0);
  }

  console.log("fila-manifest-state-repository.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
