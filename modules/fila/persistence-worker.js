"use strict";

const fs = require("fs");
const path = require("path");
const { parentPort, threadId } = require("worker_threads");
const {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  RESPONSE_OK,
  RESPONSE_ERROR,
  workspaceSeguro,
  revisionSegura,
  normalizarDataDir,
  erroSanitizado,
  sameIdentity
} = require("./persistence-protocol");

let filaOperacionalV2 = null;

function agoraMs() {
  return Date.now();
}

function obterFilaOperacionalV2(dataDir) {
  if (!filaOperacionalV2) {
    process.env.DATA_DIR = normalizarDataDir(dataDir);
    filaOperacionalV2 = require("./fila-operacional-v2");
  }
  return filaOperacionalV2;
}

function caminhoWorkspace(dataDir, workspace) {
  const raiz = path.resolve(normalizarDataDir(dataDir));
  const cliente = workspaceSeguro(workspace);
  const diretorio = path.resolve(raiz, "clientes", cliente);
  const arquivo = path.resolve(diretorio, "fila.json");
  const viva = path.resolve(diretorio, "fila-viva.json");
  const proof = path.resolve(diretorio, "fila.proof.json");
  if (!diretorio.startsWith(`${path.resolve(raiz, "clientes")}${path.sep}`) ||
      path.dirname(arquivo) !== diretorio ||
      path.dirname(viva) !== diretorio ||
      path.dirname(proof) !== diretorio) {
    throw new Error("caminho_workspace_inseguro");
  }
  return { raiz, cliente, diretorio, arquivo, viva, proof };
}

function statIdentity(file) {
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
}

function statOptional(file) {
  try {
    return statIdentity(file);
  } catch (erro) {
    if (erro?.code === "ENOENT") return null;
    throw erro;
  }
}

function sameOptionalIdentity(esperada, atual) {
  return !esperada && !atual ? true : sameIdentity(esperada, atual);
}

function readArray(file, { absentOk = false } = {}) {
  const readStarted = process.hrtime.bigint();
  let texto;
  try {
    texto = fs.readFileSync(file, "utf8");
  } catch (erro) {
    if (erro?.code === "ENOENT" && absentOk) {
      return { value: [], identity: null, bytes: 0, parseMs: 0, readMs: Number(process.hrtime.bigint() - readStarted) / 1e6 };
    }
    throw erro;
  }
  const readMs = Number(process.hrtime.bigint() - readStarted) / 1e6;
  const bytes = Buffer.byteLength(texto, "utf8");
  const parseStarted = process.hrtime.bigint();
  const value = JSON.parse(texto);
  const parseMs = Number(process.hrtime.bigint() - parseStarted) / 1e6;
  if (!Array.isArray(value)) throw new Error(`${path.basename(file)}_nao_array`);
  return {
    value,
    identity: statIdentity(file),
    bytes,
    parseMs,
    readMs
  };
}

function backupFileAtomic(file) {
  const storage = require("../../utils/storage");
  return storage.criarBackupArquivoAtomic(file, `${file}.bak`, { preferirHardlink: true });
}

function writeTempAtomic(tempPath, value) {
  const started = process.hrtime.bigint();
  const stringifyStarted = process.hrtime.bigint();
  const content = JSON.stringify(value, null, 2);
  const stringifyMs = Number(process.hrtime.bigint() - stringifyStarted) / 1e6;
  const bytes = Buffer.byteLength(content, "utf8");
  fs.writeFileSync(tempPath, content, "utf8");
  return {
    bytes,
    stringifyMs,
    writeMs: Number(process.hrtime.bigint() - started) / 1e6
  };
}

function ensureRevisionTemp(paths, revision) {
  const tempPath = path.resolve(paths.diretorio, `fila.json.tmp.${revision}`);
  if (path.dirname(tempPath) !== paths.diretorio || path.basename(tempPath) !== `fila.json.tmp.${revision}`) {
    throw new Error("checkpoint_temp_inseguro");
  }
  return tempPath;
}

function sourceRead(paths, nowMs, dataDir) {
  const legacy = readArray(paths.arquivo, { absentOk: true });
  const viva = readArray(paths.viva, { absentOk: true });
  const legacyAfter = statOptional(paths.arquivo);
  const vivaAfter = statOptional(paths.viva);
  const legacyChanged = !sameOptionalIdentity(legacy.identity, legacyAfter);
  const vivaChanged = !sameOptionalIdentity(viva.identity, vivaAfter);
  if (legacyChanged || vivaChanged) {
    const erro = new Error("checkpoint_source_changed_during_read");
    erro.code = "STALE_REVISION";
    throw erro;
  }
  const operacional = obterFilaOperacionalV2(dataDir);
  const mergeStarted = process.hrtime.bigint();
  const merge = operacional.mesclarFilaLegadaComViva(paths.cliente, legacy.value, viva.value, { agora: nowMs });
  return {
    filaCliente: merge.filaCliente,
    sourceRevisions: { legacy: legacyAfter, viva: vivaAfter },
    sourceBytes: { legacy: legacy.bytes, viva: viva.bytes },
    sourceReadMs: legacy.readMs + viva.readMs,
    sourceParseMs: legacy.parseMs + viva.parseMs,
    calculateMs: Number(process.hrtime.bigint() - mergeStarted) / 1e6,
    merge
  };
}

function prepare(job) {
  const started = process.hrtime.bigint();
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  fs.mkdirSync(paths.diretorio, { recursive: true });
  const source = sourceRead(paths, Number(job.nowMs) || agoraMs(), dataDir);
  const currentLegacy = statOptional(paths.arquivo);
  const currentViva = statOptional(paths.viva);
  if (!sameOptionalIdentity(source.sourceRevisions.legacy, currentLegacy) ||
      !sameOptionalIdentity(source.sourceRevisions.viva, currentViva)) {
    const erro = new Error("checkpoint_source_changed_before_backup");
    erro.code = "STALE_REVISION";
    throw erro;
  }
  const backup = currentLegacy
    ? backupFileAtomic(paths.arquivo)
    : { backupOk: true, backupMetodo: "arquivo_ausente", backupMs: 0 };
  if (currentLegacy && backup.backupOk !== true) {
    const erro = new Error("checkpoint_backup_failed");
    erro.code = "BACKUP_FAILED";
    throw erro;
  }
  const tempPath = ensureRevisionTemp(paths, revision);
  const escrita = writeTempAtomic(tempPath, source.filaCliente);
  const tempIdentity = statIdentity(tempPath);
  return {
    ok: true,
    operation: OP_PREPARE,
    clienteId: paths.cliente,
    checkpointRevision: revision,
    tempPath,
    tempIdentity,
    sourceRevisions: source.sourceRevisions,
    itens: source.filaCliente.length,
    bytes: escrita.bytes,
    merge: {
      itensInseridos: source.merge.itensInseridos || 0,
      itensAtualizados: source.merge.itensAtualizados || 0,
      duplicatasEvitadas: source.merge.duplicatasEvitadas || 0,
      statusPreservados: source.merge.statusPreservados || 0,
      totalLegado: source.merge.totalLegado || 0,
      totalViva: source.merge.totalViva || 0,
      totalFinal: source.merge.totalFinal || 0
    },
    metrics: {
      workerThreadId: threadId,
      processRssBytesAtJob: process.memoryUsage().rss,
      workerHeapUsedBytes: process.memoryUsage().heapUsed,
      readMs: source.sourceReadMs,
      parseMs: source.sourceParseMs,
      calculateMs: source.calculateMs,
      stringifyMs: escrita.stringifyMs,
      writeMs: escrita.writeMs,
      backupMs: backup.backupMs,
      backupMetodo: backup.backupMetodo,
      totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
      bytes: escrita.bytes
    }
  };
}

function publish(job) {
  const started = process.hrtime.bigint();
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const tempPath = ensureRevisionTemp(paths, revision);
  const tempIdentity = statOptional(tempPath);
  if (!tempIdentity || (job.tempIdentity && !sameIdentity(tempIdentity, job.tempIdentity))) {
    return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_temp_stale" };
  }
  const vivaCurrent = statOptional(paths.viva);
  if (job.expectedSourceRevisions &&
      !sameOptionalIdentity(job.expectedSourceRevisions.viva, vivaCurrent)) {
    return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_source_revision_changed" };
  }
  const renameStarted = process.hrtime.bigint();
  fs.renameSync(tempPath, paths.arquivo);
  const renameMs = Number(process.hrtime.bigint() - renameStarted) / 1e6;
  const finalStat = statIdentity(paths.arquivo);
  const operacional = obterFilaOperacionalV2(dataDir);
  const proof = operacional.publicarProofFilaLegada(paths.cliente, {
    targetGeneration: job.targetGeneration,
    fileRevision: revision
  }, { agora: agoraMs(), logger: console });
  if (proof.ok !== true) {
    return {
      ok: false,
      operation: OP_PUBLISH,
      motivo: proof.motivo || "checkpoint_proof_write_error",
      motivoDetalhado: proof.motivo || "checkpoint_proof_write_error"
    };
  }
  return {
    ok: true,
    operation: OP_PUBLISH,
    clienteId: paths.cliente,
    checkpointRevision: revision,
    legacyFileProof: proof.proof,
    proof: proof.proof,
    sourceRevisions: { viva: statOptional(paths.viva) },
    finalIdentity: finalStat,
    bytes: Number(finalStat.size || 0),
    metrics: {
      workerThreadId: threadId,
      processRssBytesAtJob: process.memoryUsage().rss,
      workerHeapUsedBytes: process.memoryUsage().heapUsed,
      renameMs,
      proofMs: Number(process.hrtime.bigint() - started) / 1e6,
      bytes: Number(finalStat.size || 0)
    }
  };
}

function cleanup(job) {
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const tempPath = ensureRevisionTemp(paths, revision);
  try {
    fs.unlinkSync(tempPath);
    return { ok: true, operation: OP_CLEANUP, removed: true };
  } catch (erro) {
    if (erro?.code === "ENOENT") return { ok: true, operation: OP_CLEANUP, removed: false };
    throw erro;
  }
}

async function executar(job) {
  if (!job || typeof job !== "object") throw new Error("persistence_job_invalido");
  if (job.operation === OP_PREPARE) return prepare(job);
  if (job.operation === OP_PUBLISH) return publish(job);
  if (job.operation === OP_CLEANUP) return cleanup(job);
  throw new Error("persistence_operation_invalida");
}

if (!parentPort) throw new Error("persistence_worker_parent_port_indisponivel");

let jobEmAndamento = false;
parentPort.on("message", message => {
  if (jobEmAndamento) {
    parentPort.postMessage({
      type: RESPONSE_ERROR,
      jobId: message?.jobId || "",
      error: { code: "WORKER_BUSY", message: "persistence_worker_busy" }
    });
    return;
  }
  jobEmAndamento = true;
  Promise.resolve()
    .then(() => executar(message))
    .then(resultado => {
      parentPort.postMessage({ type: RESPONSE_OK, jobId: message.jobId, result: resultado });
    })
    .catch(erro => {
      parentPort.postMessage({
        type: RESPONSE_ERROR,
        jobId: message?.jobId || "",
        error: { ...erroSanitizado(erro), code: erro?.code || erro?.codigo || "WORKER_JOB_FAILED" }
      });
    })
    .finally(() => {
      jobEmAndamento = false;
    });
});
