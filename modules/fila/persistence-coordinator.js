"use strict";

const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  RESPONSE_OK,
  RESPONSE_ERROR,
  flagWorkerAtiva,
  timeoutWorkerMs,
  normalizarDataDir,
  workspaceSeguro,
  revisionSegura,
  jobId,
  erroSanitizado,
  sameIdentity
} = require("./persistence-protocol");

function agoraMs() {
  return Date.now();
}

function rejeicao(motivo, detalhe = "") {
  return { ok: false, motivo, motivoDetalhado: detalhe || motivo };
}

function criarCoordenadorPersistencia(opcoes = {}) {
  const env = opcoes.env || process.env;
  const logger = opcoes.logger || console;
  const workerPath = opcoes.workerPath || path.join(__dirname, "persistence-worker.js");
  const estado = {
    worker: null,
    fila: [],
    ativo: null,
    seq: 0,
    aberto: false,
    falhas: 0,
    ultimaFalha: null,
    encerrando: false,
    signalHandlers: []
  };

  function ativo() {
    return flagWorkerAtiva(env);
  }

  function log(payload = {}) {
    try {
      if (typeof logger.log === "function") logger.log("[FILA-PERSISTENCIA-WORKER]", JSON.stringify(payload));
    } catch {}
  }

  function estadoPublico() {
    return {
      enabled: ativo(),
      workerCreated: Boolean(estado.worker),
      busy: Boolean(estado.ativo),
      queued: estado.fila.length,
      circuitOpen: estado.aberto,
      failures: estado.falhas,
      lastFailure: estado.ultimaFalha
    };
  }

  function rejeitarFila(motivo) {
    const pendentes = estado.fila.splice(0);
    for (const item of pendentes) item.reject(rejeicao(motivo));
  }

  function abrirCircuito(motivo, erro = null) {
    estado.aberto = true;
    estado.falhas += 1;
    estado.ultimaFalha = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    log({ estado: "circuit_open", motivo, falhas: estado.falhas });
    rejeitarFila(motivo);
  }

  function instalarSinais() {
    if (estado.signalHandlers.length) return;
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const handler = () => {
        process.removeListener(signal, handler);
        estado.signalHandlers = estado.signalHandlers.filter(item => item.signal !== signal);
        void shutdown({ timeoutMs: timeoutWorkerMs(env) }).finally(() => {
          process.kill(process.pid, signal);
        });
      };
      process.once(signal, handler);
      estado.signalHandlers.push({ signal, handler });
    }
  }

  function criarWorker() {
    if (estado.worker || estado.encerrando) return estado.worker;
    const worker = new Worker(workerPath, { env: { ...process.env, ...env } });
    estado.worker = worker;
    instalarSinais();
    worker.on("message", mensagem => {
      const atual = estado.ativo;
      if (!atual || mensagem?.jobId !== atual.job.jobId) {
        log({ evento: "resposta_ignorada", motivo: "job_id_desconhecido" });
        return;
      }
      clearTimeout(atual.timer);
      estado.ativo = null;
      if (mensagem.type === RESPONSE_OK) {
        log({ evento: "job_ok", operacao: atual.job.operation, jobId: atual.job.jobId, ...(mensagem.result?.metrics || {}) });
        atual.resolve(mensagem.result);
      } else {
        abrirCircuito(mensagem.error?.code || "worker_job_failed", mensagem.error);
        atual.resolve(rejeicao(mensagem.error?.code || "worker_job_failed", mensagem.error?.message));
      }
      bombear();
    });
    worker.on("error", erro => {
      const atual = estado.ativo;
      if (atual) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao("worker_error", erro?.message));
      }
      abrirCircuito("worker_error", erro);
      void encerrarWorker();
    });
    worker.on("exit", code => {
      const inesperado = !estado.encerrando;
      const atual = estado.ativo;
      estado.worker = null;
      if (atual) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao(inesperado ? "worker_exit" : "worker_terminated"));
      }
      if (inesperado) abrirCircuito("worker_exit", { code });
      if (!estado.encerrando) rejeitarFila("worker_exit");
    });
    return worker;
  }

  async function encerrarWorker() {
    const worker = estado.worker;
    estado.worker = null;
    if (!worker) return;
    try { await worker.terminate(); } catch {}
  }

  function bombear() {
    if (estado.ativo || estado.encerrando || !estado.fila.length) return;
    if (estado.aberto) {
      rejeitarFila("persistence_worker_circuit_open");
      return;
    }
    const atual = estado.fila.shift();
    const worker = criarWorker();
    if (!worker) {
      atual.resolve(rejeicao("worker_encerrando"));
      return;
    }
    const timeout = timeoutWorkerMs(env);
    const timer = setTimeout(() => {
      if (!estado.ativo || estado.ativo.job.jobId !== atual.job.jobId) return;
      estado.ativo = null;
      abrirCircuito("worker_timeout");
      atual.resolve(rejeicao("worker_timeout"));
      void encerrarWorker();
    }, timeout);
    estado.ativo = { ...atual, timer };
    try {
      worker.postMessage(atual.job);
    } catch (erro) {
      clearTimeout(timer);
      estado.ativo = null;
      abrirCircuito("worker_post_message_error", erro);
      atual.resolve(rejeicao("worker_post_message_error", erro?.message));
      void encerrarWorker();
    }
  }

  function enfileirar(operation, payload = {}) {
    if (!ativo()) return Promise.resolve(rejeicao("persistence_worker_disabled"));
    if (estado.encerrando) return Promise.resolve(rejeicao("persistence_worker_shutting_down"));
    if (estado.aberto) return Promise.resolve(rejeicao("persistence_worker_circuit_open"));
    let workspace;
    let revision;
    try {
      workspace = workspaceSeguro(payload.clienteId);
      revision = revisionSegura(payload.checkpointRevision);
    } catch (erro) {
      return Promise.resolve(rejeicao(erro.message || "payload_invalido"));
    }
    const seq = ++estado.seq;
    const job = {
      operation,
      jobId: jobId(seq, workspace, payload.targetGeneration || 0),
      clienteId: workspace,
      checkpointRevision: revision,
      targetGeneration: Number(payload.targetGeneration || 0),
      expectedSourceRevisions: payload.expectedSourceRevisions || undefined,
      tempIdentity: payload.tempIdentity || undefined,
      dataDir: normalizarDataDir(payload.dataDir || env.DATA_DIR || "/data"),
      nowMs: Number(payload.nowMs) || agoraMs()
    };
    return new Promise(resolve => {
      estado.fila.push({ job, resolve, reject: resolve });
      bombear();
    });
  }

  function identidadeArquivo(file) {
    try {
      const stat = fs.statSync(file);
      return {
        pathKind: path.basename(file),
        dev: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
        ino: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null,
        size: Number(stat.size || 0),
        mtimeMs: Number(stat.mtimeMs || 0),
        ctimeMs: Number.isFinite(Number(stat.ctimeMs)) ? Number(stat.ctimeMs) : null,
        mtimeNs: stat.mtimeNs == null ? null : String(stat.mtimeNs),
        ctimeNs: stat.ctimeNs == null ? null : String(stat.ctimeNs)
      };
    } catch (erro) {
      if (erro?.code === "ENOENT") return null;
      return { erro: erroSanitizado(erro) };
    }
  }

  function revalidarSources(clienteId = "admin", sourceRevisions = {}, { incluirLegacy = true, dataDir } = {}) {
    let cliente;
    try {
      cliente = workspaceSeguro(clienteId);
      const raiz = path.resolve(normalizarDataDir(dataDir || env.DATA_DIR || "/data"));
      const diretorio = path.resolve(raiz, "clientes", cliente);
      const atuais = {
        legacy: incluirLegacy ? identidadeArquivo(path.join(diretorio, "fila.json")) : null,
        viva: identidadeArquivo(path.join(diretorio, "fila-viva.json"))
      };
      const mesmaOuAusente = (esperada, atual) =>
        !esperada && !atual ? true : sameIdentity(esperada, atual);
      const legacyOk = !incluirLegacy || mesmaOuAusente(sourceRevisions.legacy, atuais.legacy);
      const vivaOk = mesmaOuAusente(sourceRevisions.viva, atuais.viva);
      return {
        ok: legacyOk && vivaOk,
        motivo: legacyOk && vivaOk ? "revisao_confirmada" : "checkpoint_source_revision_changed",
        atuais,
        esperadas: sourceRevisions
      };
    } catch (erro) {
      return { ok: false, motivo: "checkpoint_source_revision_error", erro: erroSanitizado(erro), clienteId: cliente || "" };
    }
  }

  async function shutdown({ timeoutMs = timeoutWorkerMs(env) } = {}) {
    estado.encerrando = true;
    rejeitarFila("persistence_worker_shutdown");
    const started = agoraMs();
    while (estado.ativo && agoraMs() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (estado.ativo) {
      clearTimeout(estado.ativo.timer);
      estado.ativo.resolve(rejeicao("persistence_worker_shutdown_timeout"));
      estado.ativo = null;
    }
    await encerrarWorker();
    for (const item of estado.signalHandlers) process.removeListener(item.signal, item.handler);
    estado.signalHandlers = [];
    return { ok: true };
  }

  function recover() {
    if (estado.ativo || estado.fila.length || estado.worker) {
      return rejeicao("persistence_worker_recovery_busy");
    }
    estado.aberto = false;
    estado.ultimaFalha = null;
    log({ estado: "circuit_recovery_manual" });
    return { ok: true, motivo: "persistence_worker_recovery_manual" };
  }

  return {
    enabled: ativo,
    getState: estadoPublico,
    prepare: payload => enfileirar(OP_PREPARE, payload),
    publish: payload => enfileirar(OP_PUBLISH, payload),
    cleanup: payload => enfileirar(OP_CLEANUP, payload),
    revalidarSources,
    shutdown,
    recover,
    // Exclusivo para testes/diagnóstico local; não é usado pelo fluxo produtivo.
    terminateForTest: async () => {
      if (estado.worker) await encerrarWorker();
      abrirCircuito("worker_terminated_for_test");
    }
  };
}

module.exports = { criarCoordenadorPersistencia };
