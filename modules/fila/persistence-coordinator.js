"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  RESPONSE_OK,
  flagWorkerAtiva,
  decisaoPersistenciaWorkspace,
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

function rejeicao(motivo, detalhe = "", extras = {}) {
  return { ok: false, motivo, motivoDetalhado: detalhe || motivo, ...extras };
}

function numeroLimite(env, chave, padrao) {
  const valor = Number(env?.[chave]);
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : padrao;
}

function hashWorkspace(workspace) {
  return crypto.createHash("sha256").update(String(workspace)).digest("hex").slice(0, 12);
}

// The existing wall-clock timestamps are retained for log correlation with the
// process panel. They are not used for scheduling, timeout, ACK, or retry logic.
function metricasJob(job = {}, finishedAt = agoraMs()) {
  const terminou = Number(finishedAt) || agoraMs();
  const queuedAt = Number(job.queuedAt) || terminou;
  const startedAt = Number(job.startedAt) || queuedAt;
  return {
    checkpointKey: hashWorkspace(job.checkpointRevision),
    queuedAt,
    startedAt,
    finishedAt: terminou,
    queueWaitMs: Math.max(0, startedAt - queuedAt),
    workerServiceMs: Math.max(0, terminou - startedAt),
    jobTotalMs: Math.max(0, terminou - queuedAt)
  };
}

function erroGlobalWorker(motivo = "") {
  return new Set([
    "worker_error",
    "worker_exit",
    "worker_timeout",
    "worker_post_message_error",
    "worker_terminated_for_test",
    "WORKER_BUSY",
    "persistence_job_invalido",
    "persistence_operation_invalida",
    "persistence_worker_parent_port_indisponivel"
  ]).has(String(motivo));
}

function criarCoordenadorPersistencia(opcoes = {}) {
  const env = opcoes.env || process.env;
  const logger = opcoes.logger || console;
  const workerPath = opcoes.workerPath || path.join(__dirname, "persistence-worker.js");
  const estado = {
    worker: null,
    workerEnding: null,
    lanes: new Map(),
    readyWorkspaces: [],
    readySet: new Set(),
    ativo: null,
    seq: 0,
    aberto: false,
    falhas: 0,
    ultimaFalha: null,
    encerrando: false,
    signalHandlers: [],
    backpressureRejections: 0,
    loggedRoutingReasons: new Set(),
    completedByWorkspace: new Map(),
    maxQueueWaitByWorkspace: new Map(),
    errorsByWorkspace: new Map()
  };

  function globalAtivo() {
    return flagWorkerAtiva(env);
  }

  function decisao(clienteId = "admin") {
    return decisaoPersistenciaWorkspace(env, clienteId);
  }

  function modoFor(clienteId = "admin") {
    return decisao(clienteId).mode;
  }

  function log(payload = {}) {
    try {
      if (typeof logger.log === "function") logger.log("[FILA-PERSISTENCIA-WORKER]", JSON.stringify(payload));
    } catch {}
  }

  function logRoteamento(decisaoAtual) {
    if (decisaoAtual.motivo === "worker_canary_match") return;
    if (estado.loggedRoutingReasons.has(decisaoAtual.motivo)) return;
    estado.loggedRoutingReasons.add(decisaoAtual.motivo);
    log({ evento: decisaoAtual.motivo });
  }

  function obterLane(clienteId, criar = true) {
    const cliente = workspaceSeguro(clienteId);
    let lane = estado.lanes.get(cliente);
    if (!lane && criar) {
      lane = {
        clienteId: cliente,
        workspaceKey: hashWorkspace(cliente),
        fila: [],
        circuitoAberto: false,
        falhas: 0,
        ultimaFalha: null,
        bytesPendentes: 0
      };
      estado.lanes.set(cliente, lane);
    }
    return lane;
  }

  function profundidadeLane(lane) {
    return lane.fila.length + (estado.ativo?.lane === lane ? 1 : 0);
  }

  function profundidadeGlobal() {
    let total = estado.ativo ? 1 : 0;
    for (const lane of estado.lanes.values()) total += lane.fila.length;
    return total;
  }

  function bytesPendentesGlobal() {
    let total = Number(estado.ativo?.bytesEstimados || 0);
    for (const lane of estado.lanes.values()) total += lane.bytesPendentes;
    return total;
  }

  function estimarBytes(job) {
    return Buffer.byteLength(JSON.stringify({
      operation: job.operation,
      clienteId: job.clienteId,
      checkpointRevision: job.checkpointRevision,
      targetGeneration: job.targetGeneration,
      expectedSourceRevisions: job.expectedSourceRevisions,
      tempIdentity: job.tempIdentity,
      dataDir: job.dataDir,
      nowMs: job.nowMs
    }), "utf8");
  }

  function marcarPronto(lane) {
    if (!lane || !lane.fila.length || lane.circuitoAberto) return;
    if (estado.readySet.has(lane.clienteId)) return;
    estado.readySet.add(lane.clienteId);
    estado.readyWorkspaces.push(lane.clienteId);
  }

  function rejeitarFilaLane(lane, motivo) {
    if (!lane) return;
    const pendentes = lane.fila.splice(0);
    lane.bytesPendentes = 0;
    estado.readySet.delete(lane.clienteId);
    for (const item of pendentes) {
      item.resolve(rejeicao(motivo, motivo, {
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey
      }));
    }
  }

  function rejeitarFilas(motivo) {
    for (const lane of estado.lanes.values()) rejeitarFilaLane(lane, motivo);
  }

  function registrarFalhaGlobal(motivo, erro = null) {
    estado.aberto = true;
    estado.falhas += 1;
    estado.ultimaFalha = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    log({ estado: "circuit_open", escopo: "global", motivo, falhas: estado.falhas });
    rejeitarFilas(motivo);
  }

  function registrarFalhaLocal(lane, motivo, erro = null) {
    if (!lane) return;
    lane.circuitoAberto = true;
    lane.falhas += 1;
    lane.ultimaFalha = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    estado.errorsByWorkspace.set(lane.workspaceKey, (estado.errorsByWorkspace.get(lane.workspaceKey) || 0) + 1);
    log({
      estado: "circuit_open",
      escopo: "workspace",
      workspaceKey: lane.workspaceKey,
      motivo,
      falhas: lane.falhas
    });
    rejeitarFilaLane(lane, motivo);
  }

  function estadoPublico() {
    const queueDepthByWorkspace = {};
    const circuitByWorkspace = {};
    const lanes = [];
    for (const lane of estado.lanes.values()) {
      queueDepthByWorkspace[lane.workspaceKey] = profundidadeLane(lane);
      circuitByWorkspace[lane.workspaceKey] = lane.circuitoAberto;
      lanes.push({
        workspaceKey: lane.workspaceKey,
        queued: lane.fila.length,
        queueDepth: profundidadeLane(lane),
        circuitOpen: lane.circuitoAberto,
        failures: lane.falhas,
        lastFailure: lane.ultimaFalha
      });
    }
    const completedByWorkspace = Object.fromEntries(estado.completedByWorkspace);
    const maxQueueWaitByWorkspace = Object.fromEntries(estado.maxQueueWaitByWorkspace);
    const errorsByWorkspace = Object.fromEntries(estado.errorsByWorkspace);
    return {
      enabled: globalAtivo(),
      workerCreated: Boolean(estado.worker),
      busy: Boolean(estado.ativo),
      queued: estado.lanes.size ? [...estado.lanes.values()].reduce((total, lane) => total + lane.fila.length, 0) : 0,
      queueDepthGlobal: profundidadeGlobal(),
      queueDepthByWorkspace,
      pendingBytes: bytesPendentesGlobal(),
      circuitOpen: estado.aberto,
      globalCircuitOpen: estado.aberto,
      circuitByWorkspace,
      failures: estado.falhas,
      lastFailure: estado.ultimaFalha,
      backpressureRejections: estado.backpressureRejections,
      completedByWorkspace,
      maxQueueWaitByWorkspace,
      errorsByWorkspace,
      retries: 0,
      lanes
    };
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
        const metricas = metricasJob(atual.job);
        const previousMaxWait = estado.maxQueueWaitByWorkspace.get(atual.lane.workspaceKey) || 0;
        estado.maxQueueWaitByWorkspace.set(
          atual.lane.workspaceKey,
          Math.max(previousMaxWait, metricas.queueWaitMs)
        );
        estado.completedByWorkspace.set(
          atual.lane.workspaceKey,
          (estado.completedByWorkspace.get(atual.lane.workspaceKey) || 0) + 1
        );
        log({
          evento: "job_ok",
          operacao: atual.job.operation,
          jobKey: hashWorkspace(atual.job.jobId),
          workspaceKey: atual.lane.workspaceKey,
          ...(mensagem.result?.metrics || {}),
          ...metricas
        });
        atual.resolve({
          ...(mensagem.result || {}),
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey,
          coordinatorMetrics: metricas
        });
      } else {
        const motivo = mensagem.error?.code || "worker_job_failed";
        log({
          evento: "job_error",
          operacao: atual.job.operation,
          jobKey: hashWorkspace(atual.job.jobId),
          workspaceKey: atual.lane.workspaceKey,
          motivo,
          ...metricasJob(atual.job)
        });
        if (erroGlobalWorker(motivo)) {
          estado.errorsByWorkspace.set(atual.lane.workspaceKey, (estado.errorsByWorkspace.get(atual.lane.workspaceKey) || 0) + 1);
          registrarFalhaGlobal(motivo, mensagem.error);
        } else {
          registrarFalhaLocal(atual.lane, motivo, mensagem.error);
        }
        atual.resolve(rejeicao(motivo, mensagem.error?.message, {
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey
        }));
      }
      bombear();
    });
    worker.on("error", erro => {
      const atual = estado.ativo;
      if (atual) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao("worker_error", erro?.message, {
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey
        }));
      }
      registrarFalhaGlobal("worker_error", erro);
      void encerrarWorker(worker);
    });
    worker.on("exit", code => {
      const esperado = estado.encerrando || estado.workerEnding === worker;
      if (estado.worker === worker) estado.worker = null;
      if (estado.workerEnding === worker) estado.workerEnding = null;
      const atual = estado.ativo;
      if (atual && atual.worker === worker) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao(esperado ? "worker_terminated" : "worker_exit", "", {
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey
        }));
      }
      if (!esperado) {
        registrarFalhaGlobal("worker_exit", { code });
        rejeitarFilas("worker_exit");
      }
      bombear();
    });
    return worker;
  }

  async function encerrarWorker(workerAtual = estado.worker) {
    const worker = workerAtual;
    if (!worker) return;
    if (estado.worker === worker) estado.worker = null;
    estado.workerEnding = worker;
    try { await worker.terminate(); } catch {}
    if (estado.workerEnding === worker) estado.workerEnding = null;
  }

  function proximoItem() {
    while (estado.readyWorkspaces.length) {
      const cliente = estado.readyWorkspaces.shift();
      estado.readySet.delete(cliente);
      const lane = estado.lanes.get(cliente);
      if (!lane || lane.circuitoAberto || !lane.fila.length) continue;
      const item = lane.fila.shift();
      lane.bytesPendentes = Math.max(0, lane.bytesPendentes - item.bytesEstimados);
      if (lane.fila.length) marcarPronto(lane);
      return item;
    }
    return null;
  }

  function bombear() {
    if (estado.ativo || estado.encerrando || estado.aberto) return;
    const atual = proximoItem();
    if (!atual) return;
    const worker = criarWorker();
    if (!worker) {
      atual.resolve(rejeicao("worker_encerrando", "", {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      return;
    }
    const timeout = timeoutWorkerMs(env);
    const timer = setTimeout(() => {
      if (!estado.ativo || estado.ativo.job.jobId !== atual.job.jobId) return;
      estado.ativo = null;
      registrarFalhaGlobal("worker_timeout");
      atual.resolve(rejeicao("worker_timeout", "", {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      void encerrarWorker(worker);
      bombear();
    }, timeout);
    atual.job.queuedAt = Number(atual.job.queuedAt || agoraMs());
    atual.job.startedAt = agoraMs();
    estado.ativo = { ...atual, worker, timer };
    try {
      worker.postMessage(atual.job);
    } catch (erro) {
      clearTimeout(timer);
      estado.ativo = null;
      registrarFalhaGlobal("worker_post_message_error", erro);
      atual.resolve(rejeicao("worker_post_message_error", erro?.message, {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      void encerrarWorker(worker);
      bombear();
    }
  }

  function enfileirar(operation, payload = {}) {
    let workspace;
    let revision;
    try {
      workspace = workspaceSeguro(payload.clienteId);
      revision = revisionSegura(payload.checkpointRevision);
    } catch (erro) {
      return Promise.resolve(rejeicao(erro.message || "payload_invalido"));
    }
    const persistenceMode = payload.persistenceMode || modoFor(workspace);
    const route = payload.persistenceMode ? { mode: persistenceMode, motivo: "checkpoint_mode_pinned" } : decisao(workspace);
    if (persistenceMode !== "worker") {
      logRoteamento(route);
      return Promise.resolve(rejeicao(
        globalAtivo() ? "persistence_worker_canary_not_selected" : "persistence_worker_disabled",
        route.motivo,
        { persistenceMode: "legacy", workspaceKey: hashWorkspace(workspace) }
      ));
    }
    if (estado.encerrando) return Promise.resolve(rejeicao("persistence_worker_shutting_down"));
    if (estado.aberto) return Promise.resolve(rejeicao("persistence_worker_circuit_open"));
    const lane = obterLane(workspace);
    if (lane.circuitoAberto) {
      return Promise.resolve(rejeicao("persistence_worker_workspace_circuit_open", "", {
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey
      }));
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
      nowMs: Number(payload.nowMs) || agoraMs(),
      persistenceMode: "worker",
      queuedAt: agoraMs()
    };
    const bytesEstimados = estimarBytes(job);
    const maxGlobal = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_JOBS", 100);
    const maxWorkspace = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE", 25);
    const maxBytes = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_BYTES", 8 * 1024 * 1024);
    const maxWorkspaceBytes = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_BYTES_WORKSPACE", 1024 * 1024);
    if (
      profundidadeGlobal() >= maxGlobal ||
      profundidadeLane(lane) >= maxWorkspace ||
      bytesPendentesGlobal() + bytesEstimados > maxBytes ||
      lane.bytesPendentes + bytesEstimados > maxWorkspaceBytes
    ) {
      estado.backpressureRejections += 1;
      return Promise.resolve(rejeicao("persistence_worker_backpressure_retryable", "fila_persistencia_backpressure", {
        retryable: true,
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey,
        queueDepthGlobal: profundidadeGlobal(),
        queueDepthWorkspace: profundidadeLane(lane)
      }));
    }
    return new Promise(resolve => {
      const item = { job, resolve, reject: resolve, lane, bytesEstimados };
      lane.fila.push(item);
      lane.bytesPendentes += bytesEstimados;
      marcarPronto(lane);
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
    rejeitarFilas("persistence_worker_shutdown");
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

  function recover(clienteId = null) {
    if (estado.ativo) return rejeicao("persistence_worker_recovery_busy");
    if (clienteId) {
      let lane;
      try { lane = obterLane(clienteId, false); } catch { return rejeicao("workspace_invalido"); }
      if (!lane || lane.fila.length || estado.worker) return rejeicao("persistence_worker_recovery_busy");
      lane.circuitoAberto = false;
      lane.ultimaFalha = null;
      log({ estado: "circuit_recovery_manual", escopo: "workspace", workspaceKey: lane.workspaceKey });
      return { ok: true, motivo: "persistence_worker_recovery_manual", persistenceMode: "worker" };
    }
    if (estado.readyWorkspaces.length || estado.worker) return rejeicao("persistence_worker_recovery_busy");
    estado.aberto = false;
    estado.ultimaFalha = null;
    log({ estado: "circuit_recovery_manual", escopo: "global" });
    return { ok: true, motivo: "persistence_worker_recovery_manual" };
  }

  return {
    enabled: globalAtivo,
    enabledFor: clienteId => modoFor(clienteId) === "worker",
    modeFor: modoFor,
    getState: estadoPublico,
    prepare: payload => enfileirar(OP_PREPARE, payload),
    publish: payload => enfileirar(OP_PUBLISH, payload),
    cleanup: payload => enfileirar(OP_CLEANUP, payload),
    revalidarSources,
    shutdown,
    recover,
    terminateForTest: async () => {
      if (estado.worker) await encerrarWorker();
      registrarFalhaGlobal("worker_terminated_for_test");
    }
  };
}

module.exports = { criarCoordenadorPersistencia };
