"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const manifestStateRepository = require("../modules/fila/fila-manifest-state.repository");
const vivaProofTelemetry = require("../modules/fila/viva-proof-telemetry");

function criarStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-viva-proof-writer-"));
  const getClienteJsonPath = (clienteId, arquivo) => path.join(dir, clienteId, arquivo);
  return { dir, getClienteJsonPath };
}

function escreverJson(storage, clienteId, arquivo, valor) {
  const destino = storage.getClienteJsonPath(clienteId, arquivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(valor), "utf8");
  return destino;
}

function criarFsObservavel() {
  let statCalls = 0;
  let readCalls = 0;
  return {
    fs: {
      existsSync: (...args) => fs.existsSync(...args),
      statSync: (...args) => {
        statCalls += 1;
        return fs.statSync(...args);
      },
      readFileSync: (...args) => {
        readCalls += 1;
        return fs.readFileSync(...args);
      },
      mkdirSync: (...args) => fs.mkdirSync(...args),
      appendFileSync: (...args) => fs.appendFileSync(...args),
      readdirSync: (...args) => fs.readdirSync(...args),
      renameSync: (...args) => fs.renameSync(...args),
      writeFileSync: (...args) => fs.writeFileSync(...args),
      unlinkSync: (...args) => fs.unlinkSync(...args)
    },
    stats() {
      return { statCalls, readCalls };
    }
  };
}

function criarLogger() {
  const eventos = [];
  return {
    eventos,
    log(tag, payload) {
      if (tag === vivaProofTelemetry.TAG_VIVA_PROOF_TELEMETRIA) {
        eventos.push(JSON.parse(payload));
      }
    }
  };
}

function contar(eventos, evento) {
  return eventos.filter(item => item.evento === evento);
}

function criarPoolManifestFake(opcoes = {}) {
  const estados = new Map();

  function estado(clienteId) {
    return estados.get(clienteId) || {
      revision: 0,
      viva_generation: 0,
      durable_checkpoint_generation: 0,
      dirty_generation: null,
      authority_ready: false,
      authority_ready_generation: null,
      authority_ready_revision: null,
      authority_ready_at: null,
      viva_file_proof: null,
      legacy_file_proof: null,
      pending_checkpoint_revision: null,
      pending_checkpoint_target_generation: null,
      pending_checkpoint_started_at: null
    };
  }

  function row(clienteId) {
    const valor = estado(clienteId);
    return {
      cliente_id: clienteId,
      ...valor
    };
  }

  return {
    async connect() {
      return {
        async query(sql, params = []) {
          const texto = String(sql).replace(/\s+/g, " ").trim();
          if (texto === "BEGIN" || texto === "ROLLBACK") return { rows: [], rowCount: 0 };
          if (texto === "COMMIT") {
            if (opcoes.falharCommit) throw new Error("commit_falhou");
            return { rows: [], rowCount: 0 };
          }
          if (/^CREATE TABLE IF NOT EXISTS queue_manifest_state/i.test(texto)) {
            return { rows: [], rowCount: 0 };
          }
          if (/^INSERT INTO queue_manifest_state/i.test(texto)) {
            const [clienteId, viva, durable, dirty] = params;
            if (!estados.has(clienteId)) {
              estados.set(clienteId, {
                ...estado(clienteId),
                viva_generation: Number(viva || 0),
                durable_checkpoint_generation: Number(durable || 0),
                dirty_generation: dirty ?? null
              });
            }
            return { rows: [], rowCount: 1 };
          }
          if (/^SELECT .* FROM queue_manifest_state/i.test(texto)) {
            const clienteId = params[0];
            return { rows: [row(clienteId)], rowCount: 1 };
          }
          if (/^UPDATE queue_manifest_state/i.test(texto)) {
            if (opcoes.falharUpdate) throw new Error("update_falhou");
            const [clienteId, viva, durable, dirty, authorityReady, authorityReadyGeneration,
              vivaFileProof, legacyFileProof, pendingRevision, pendingTarget, pendingStarted] = params;
            const anterior = estado(clienteId);
            const revision = Number(anterior.revision || 0) + 1;
            estados.set(clienteId, {
              ...anterior,
              revision,
              viva_generation: Number(viva || 0),
              durable_checkpoint_generation: Number(durable || 0),
              dirty_generation: dirty ?? null,
              authority_ready: authorityReady === true,
              authority_ready_generation: authorityReady === true ? Number(authorityReadyGeneration || 0) : null,
              authority_ready_revision: authorityReady === true ? revision : null,
              authority_ready_at: null,
              viva_file_proof: vivaFileProof || null,
              legacy_file_proof: legacyFileProof || null,
              pending_checkpoint_revision: pendingRevision || null,
              pending_checkpoint_target_generation: pendingTarget ?? null,
              pending_checkpoint_started_at: pendingStarted || null
            });
            return { rows: [row(clienteId)], rowCount: 1 };
          }
          throw new Error(`sql_nao_suportado:${texto}`);
        },
        release() {}
      };
    }
  };
}

async function main() {
  vivaProofTelemetry.resetarParaTeste();
  const cliente = "user_b2oogwwl";
  const storage = criarStorage();
  const observavel = criarFsObservavel();
  const logger = criarLogger();
  const env = {
    FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "1",
    FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES: cliente
  };
  escreverJson(storage, cliente, "fila-viva.json", [{ id: "oferta-1" }]);
  const writeCalls = [];
  const deps = {
    env,
    logger,
    fs: observavel.fs,
    getClienteJsonPath: storage.getClienteJsonPath,
    getClientePath: clienteId => path.join(storage.dir, clienteId),
    writeClienteJson(clienteId, arquivo, dados, hooks) {
      writeCalls.push({ clienteId, arquivo, dados, hooks });
      if (arquivo === filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO && hooks) {
        const antesDoRename = logger.eventos.length;
        hooks.beforeRename?.({ file: arquivo, bytes: 1 });
        assert.strictEqual(logger.eventos.length, antesDoRename, "beforeRename nao pode emitir log");
        hooks.afterRename?.({ file: arquivo, bytes: 1, renameMs: 0 });
        assert.ok(logger.eventos.length > antesDoRename, "rename deve preceder a emissao correspondente");
      }
      return true;
    }
  };

  const normal = filaOperacionalV2.publicarProofFilaViva(cliente, {
    generation: 7,
    fileRevision: "rev-7"
  }, deps);
  assert.strictEqual(normal.ok, true);
  const seguinte = filaOperacionalV2.publicarProofFilaViva(cliente, {
    generation: 8,
    fileRevision: "rev-8"
  }, deps);
  assert.strictEqual(seguinte.ok, true);
  const regressao = filaOperacionalV2.publicarProofFilaViva(cliente, {
    generation: 7,
    fileRevision: "rev-7-regressao"
  }, deps);
  assert.strictEqual(regressao.ok, true, "telemetria nao pode bloquear publicacao");

  const mutationBegin = contar(logger.eventos, "viva_proof_writer_telemetry")
    .filter(item => item.etapa === "proof_publish_begin");
  const proofDone = logger.eventos.filter(item => item.etapa === "proof_publish_done");
  const renameEvents = logger.eventos.filter(item => item.etapa === "proof_rename");
  assert.strictEqual(mutationBegin.length, 3);
  assert.strictEqual(proofDone.length, 3);
  assert.strictEqual(renameEvents.length, 3);
  assert.ok(renameEvents.every(item => item.diagnostico.renameStartedMonotonicNs));
  assert.ok(renameEvents.every(item => item.diagnostico.renameDoneMonotonicNs));
  assert.strictEqual(proofDone[0].generation, 7);
  assert.strictEqual(proofDone[1].generation, 8);
  assert.strictEqual(contar(logger.eventos, "viva_proof_generation_regression_attempt").length, 1);
  const regressaoEvento = contar(logger.eventos, "viva_proof_generation_regression_attempt")[0];
  assert.strictEqual(regressaoEvento.diagnostico.previousGeneration, 8);
  assert.strictEqual(regressaoEvento.generation, 7);
  assert.strictEqual(regressaoEvento.sucesso, false);
  assert.strictEqual(proofDone[2].generation, 7);
  assert.strictEqual(writeCalls.length, 3);
  assert.strictEqual(observavel.stats().readCalls, 0, "writer telemetry nao pode ler proof/fila fisicamente");
  assert.ok(observavel.stats().statCalls >= 3, "stat existente da publicacao deve permanecer");

  const escritaViva = filaOperacionalV2.escreverFilaViva(cliente, [{ id: "oferta-2" }], {
    ...deps,
    generation: 9,
    fileRevision: "rev-9",
    publicarFileProof: false
  });
  assert.strictEqual(escritaViva.ok, true);
  assert.ok(logger.eventos.some(item => item.etapa === "viva_write_begin" && item.generation === 9));
  assert.ok(logger.eventos.some(item => item.etapa === "viva_write_done" && item.generation === 9));

  const terminalDeps = {
    ...deps,
    generation: 10,
    fileRevision: "rev-terminal-10",
    publicarFileProof: true,
    agora: Date.now(),
    env,
    thumbnailService: {
      imagemFontePublicavel() { return { ok: false, motivo: "teste_sem_thumbnail" }; },
      agendarThumbnail() { return { ok: true, agendada: false }; }
    }
  };
  escreverJson(storage, cliente, "fila-viva.json", [{
    id: "terminal-1",
    status: "pendente",
    marketplace: "mercadolivre"
  }]);
  const terminal = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, {
    id: "terminal-1",
    status: "enviado",
    marketplace: "mercadolivre"
  }, terminalDeps);
  assert.strictEqual(terminal.ok, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(terminal, "vivaFileProof"), false);
  const terminalEvento = logger.eventos.find(item => item.etapa === "terminal_transition");
  assert.ok(terminalEvento, "transicao terminal deve ser observada");
  assert.strictEqual(terminalEvento.diagnostico.vivaFileProofProduzido, true);
  assert.strictEqual(terminalEvento.diagnostico.vivaFileProofRetornadoNoResultado, false);

  const antesOffCanary = logger.eventos.length;
  const offCanary = filaOperacionalV2.publicarProofFilaViva(cliente, {
    generation: 11,
    fileRevision: "rev-off"
  }, {
    ...deps,
    env: { ...env, FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "0" }
  });
  assert.strictEqual(offCanary.ok, true);
  assert.strictEqual(logger.eventos.length, antesOffCanary, "fora do canario nao deve gerar telemetria nova");

  const antesForaCanario = logger.eventos.length;
  const foraCanario = filaOperacionalV2.publicarProofFilaViva(cliente, {
    generation: 12,
    fileRevision: "rev-fora-canario"
  }, {
    ...deps,
    env: {
      FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "1",
      FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES: "outro_workspace"
    }
  });
  assert.strictEqual(foraCanario.ok, true);
  assert.strictEqual(logger.eventos.length, antesForaCanario, "workspace fora do canario nao deve gerar telemetria");

  const clienteCoordenado = "user_pss60lus";
  const storageCoordenado = criarStorage();
  const loggerCoordenado = criarLogger();
  escreverJson(storageCoordenado, clienteCoordenado, "fila-viva.json", [{ id: "coordenada" }]);
  const depsCoordenadas = {
    env: {
      FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "1",
      FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES: clienteCoordenado
    },
    logger: loggerCoordenado,
    fs: fs,
    getClienteJsonPath: storageCoordenado.getClienteJsonPath,
    getClientePath: clienteId => path.join(storageCoordenado.dir, clienteId),
    writeClienteJson() { return true; }
  };
  const poolCoordenado = criarPoolManifestFake();
  const resultadoCoordenado = await manifestStateRepository.registrarMutacaoDuravel(
    clienteCoordenado,
    {
      fileRevision: "coordenada-rev-1",
      motivo: "insert_viva",
      escreverArquivo: async ({ nextGeneration, fileRevision, vivaProofTelemetry: contexto }) =>
        filaOperacionalV2.escreverFilaViva(clienteCoordenado, [{ id: "coordenada" }], {
          ...depsCoordenadas,
          generation: nextGeneration,
          fileRevision,
          publicarFileProof: true,
          vivaProofTelemetry: contexto
        })
    },
    { ...depsCoordenadas, pool: poolCoordenado }
  );
  assert.strictEqual(resultadoCoordenado.ok, true);
  const estagiosCoordenados = loggerCoordenado.eventos.map(item => item.etapa);
  assert.ok(estagiosCoordenados.includes("mutation_begin"));
  assert.ok(estagiosCoordenados.includes("generation_calculated"));
  assert.ok(estagiosCoordenados.includes("viva_write_begin"));
  assert.ok(estagiosCoordenados.includes("proof_publish_begin"));
  assert.ok(estagiosCoordenados.includes("proof_publish_done"));
  assert.ok(estagiosCoordenados.includes("db_update"));
  assert.ok(estagiosCoordenados.includes("db_commit"));
  assert.strictEqual(new Set(loggerCoordenado.eventos.map(item => item.correlationId)).size, 1);
  assert.strictEqual(loggerCoordenado.eventos.find(item => item.etapa === "db_update").generation, 1);

  const loggerRollback = criarLogger();
  const resultadoRollback = await manifestStateRepository.registrarMutacaoDuravel(
    clienteCoordenado,
    { fileRevision: "coordenada-rev-rollback", motivo: "insert_viva" },
    {
      ...depsCoordenadas,
      logger: loggerRollback,
      pool: criarPoolManifestFake({ falharCommit: true })
    }
  );
  assert.strictEqual(resultadoRollback.ok, false);
  assert.ok(loggerRollback.eventos.some(item => item.etapa === "db_rollback" && item.sucesso === false));

  const clienteConcorrente = "user_b2oogwwl";
  const storageConcorrente = criarStorage();
  const loggerConcorrente = criarLogger();
  escreverJson(storageConcorrente, clienteConcorrente, "fila-viva.json", [{ id: "concorrente" }]);
  const envConcorrente = {
    FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "1",
    FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES: clienteConcorrente
  };
  let iniciouB;
  const bIniciado = new Promise(resolve => { iniciouB = resolve; });
  let liberaB;
  const gateB = new Promise(resolve => { liberaB = resolve; });
  const depsConcorrente = {
    env: envConcorrente,
    logger: loggerConcorrente,
    fs,
    getClienteJsonPath: storageConcorrente.getClienteJsonPath,
    getClientePath: clienteId => path.join(storageConcorrente.dir, clienteId),
    writeClienteJson() { return true; }
  };
  const poolConcorrente = criarPoolManifestFake();
  function escreverConcorrente(contexto) {
    return filaOperacionalV2.escreverFilaViva(clienteConcorrente, [{ id: "concorrente" }], {
      ...depsConcorrente,
      generation: contexto.nextGeneration,
      fileRevision: contexto.fileRevision,
      vivaProofTelemetry: contexto.vivaProofTelemetry,
      publicarFileProof: false
    });
  }
  const mutacaoA = manifestStateRepository.registrarMutacaoDuravel(
    clienteConcorrente,
    {
      fileRevision: "concorrente-a",
      motivo: "normal_mutation",
      mutationId: "mutacao-A",
      escreverArquivo: async contexto => {
        await bIniciado;
        liberaB();
        return escreverConcorrente({ ...contexto, vivaProofTelemetry: contexto.vivaProofTelemetry });
      }
    },
    { ...depsConcorrente, mutationId: "mutacao-A", pool: poolConcorrente }
  );
  const mutacaoB = manifestStateRepository.registrarMutacaoDuravel(
    clienteConcorrente,
    {
      fileRevision: "concorrente-b",
      motivo: "normal_mutation",
      mutationId: "mutacao-B",
      escreverArquivo: async contexto => {
        iniciouB();
        await gateB;
        return escreverConcorrente({ ...contexto, vivaProofTelemetry: contexto.vivaProofTelemetry });
      }
    },
    { ...depsConcorrente, mutationId: "mutacao-B", pool: poolConcorrente }
  );
  await Promise.all([mutacaoA, mutacaoB]);
  const eventosConcorrentes = loggerConcorrente.eventos.filter(item => item.clienteId === clienteConcorrente);
  assert.ok(eventosConcorrentes.some(item => item.mutationId === "mutacao-A"));
  assert.ok(eventosConcorrentes.some(item => item.mutationId === "mutacao-B"));
  assert.ok(eventosConcorrentes
    .filter(item => item.mutationId === "mutacao-A")
    .every(item => item.transactionId === "mutacao-A" && item.correlationId === "mutacao-A"));
  assert.ok(eventosConcorrentes
    .filter(item => item.mutationId === "mutacao-B")
    .every(item => item.transactionId === "mutacao-B" && item.correlationId === "mutacao-B"));
  assert.strictEqual(vivaProofTelemetry.obterContextoAtivo(clienteConcorrente), null);

  console.log("fila-viva-proof-writer-telemetry.test.js OK");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
