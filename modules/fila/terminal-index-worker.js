"use strict";

const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("string_decoder");
const { lerArrayJsonIncremental } = require("./json-array-incremental");
const {
  workspaceSeguro,
  revisionSegura,
  normalizarDataDir,
  sameIdentity
} = require("./persistence-protocol");
const {
  TERMINAL_INDEX_VERSION,
  TERMINAL_INDEX_PROOF_VERSION,
  TERMINAL_INDEX_FILE,
  TERMINAL_INDEX_PROOF_FILE,
  TERMINAL_INDEX_INCREMENTAL_DIR,
  TERMINAL_INDEX_LEGACY_FILE,
  hashConteudo,
  identityFromStat,
  statOptional,
  capturarSourceProof,
  sourceProofIgual
} = require("./terminal-index-shadow");

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;

function erroCodigo(code, message = code) {
  const erro = new Error(message);
  erro.code = code;
  return erro;
}

function caminhosWorker(dataDir, clienteId) {
  const raiz = path.resolve(normalizarDataDir(dataDir));
  const cliente = workspaceSeguro(clienteId);
  const clientesDir = path.resolve(raiz, "clientes");
  const diretorio = path.resolve(clientesDir, cliente);
  if (!diretorio.startsWith(`${clientesDir}${path.sep}`)) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
  const resolver = nome => {
    const result = path.resolve(diretorio, nome);
    if (path.dirname(result) !== diretorio) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
    return result;
  };
  return {
    cliente,
    diretorio,
    legacy: resolver(TERMINAL_INDEX_LEGACY_FILE),
    incrementalDir: resolver(TERMINAL_INDEX_INCREMENTAL_DIR),
    index: resolver(TERMINAL_INDEX_FILE),
    proof: resolver(TERMINAL_INDEX_PROOF_FILE)
  };
}

function sourceProofWorker(paths) {
  return capturarSourceProof(paths.cliente, {
    fs,
    getClientePath: () => paths.diretorio
  });
}

function garantirSourceEstavel(inicial, atual, motivo = "terminal_index_source_changed") {
  if (!atual?.ok || !sourceProofIgual(inicial?.proof, atual?.proof) || inicial?.sourceRevision !== atual?.sourceRevision) {
    throw erroCodigo("STALE_REVISION", motivo);
  }
}

function lerArrayEstavel(file, identidadeEsperada, onItem) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    if (!sameIdentity(inicial, identidadeEsperada)) throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_before_read");
    const leitura = lerArrayJsonIncremental(fd, { onItem });
    const finalFd = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPath = statOptional(file, fs);
    if (!finalPath || !sameIdentity(inicial, finalFd) || !sameIdentity(inicial, finalPath)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_during_read");
    }
    return leitura;
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function lerJsonlEstavel(file, identidadeEsperada, onItem, opcoes = {}) {
  const chunkBytes = Math.max(1024, Number(opcoes.chunkBytes || DEFAULT_CHUNK_BYTES));
  const maxLineBytes = Math.max(1024, Number(opcoes.maxLineBytes || DEFAULT_MAX_JSONL_LINE_BYTES));
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let fd;
  let pendente = "";
  let bytes = 0;
  let linhas = 0;
  let readMs = 0;
  let parseMs = 0;

  function processarLinha(linha) {
    const limpa = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    if (!limpa.trim()) return;
    const inicio = process.hrtime.bigint();
    let valor;
    try {
      valor = JSON.parse(limpa);
    } finally {
      parseMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    }
    linhas += 1;
    onItem(valor, linhas - 1);
  }

  function processarTexto(texto) {
    pendente += texto;
    if (Buffer.byteLength(pendente, "utf8") > maxLineBytes && !pendente.includes("\n")) {
      throw erroCodigo("JSONL_LINE_TOO_LARGE", "terminal_index_jsonl_line_too_large");
    }
    let quebra;
    while ((quebra = pendente.indexOf("\n")) >= 0) {
      const linha = pendente.slice(0, quebra);
      pendente = pendente.slice(quebra + 1);
      processarLinha(linha);
    }
    if (Buffer.byteLength(pendente, "utf8") > maxLineBytes) {
      throw erroCodigo("JSONL_LINE_TOO_LARGE", "terminal_index_jsonl_line_too_large");
    }
  }

  try {
    fd = fs.openSync(file, "r");
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    if (!sameIdentity(inicial, identidadeEsperada)) throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_before_read");
    while (true) {
      const inicio = process.hrtime.bigint();
      const lidos = fs.readSync(fd, buffer, 0, buffer.length, null);
      readMs += Number(process.hrtime.bigint() - inicio) / 1e6;
      if (!lidos) break;
      bytes += lidos;
      processarTexto(decoder.write(buffer.subarray(0, lidos)));
    }
    processarTexto(decoder.end());
    if (pendente.trim()) processarLinha(pendente);
    pendente = "";
    const finalFd = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPath = statOptional(file, fs);
    if (!finalPath || !sameIdentity(inicial, finalFd) || !sameIdentity(inicial, finalPath)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_during_read");
    }
    return { bytes, linhas, readMs, parseMs };
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function escreverArquivoCompleto(file, conteudo) {
  const fd = fs.openSync(file, "wx");
  try {
    const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
    let offset = 0;
    while (offset < buffer.length) {
      const escritos = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
      if (!escritos) throw erroCodigo("TERMINAL_INDEX_WRITE_ZERO");
      offset += escritos;
    }
    fs.fsyncSync(fd);
    return buffer.length;
  } finally {
    fs.closeSync(fd);
  }
}

function removerSeExiste(file) {
  try { fs.unlinkSync(file); } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
}

function construirTerminalIndex(job = {}, deps = {}) {
  const started = process.hrtime.bigint();
  const paths = caminhosWorker(job.dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const operacional = deps.operacional;
  if (!operacional || typeof operacional.normalizarEntradasViva !== "function" ||
      typeof operacional.identidadePrimariaExataFilaV2 !== "function") {
    throw erroCodigo("TERMINAL_INDEX_OPERATIONAL_API_MISSING");
  }
  const hooks = deps.hooks || {};
  const nowMs = Number(job.nowMs) || Date.now();
  const generation = Number(job.targetGeneration) > 0 ? Number(job.targetGeneration) : nowMs;
  const indexPartial = `${paths.index}.partial.${revision}`;
  const proofPartial = `${paths.proof}.partial.${revision}`;
  removerSeExiste(indexPartial);
  removerSeExiste(proofPartial);

  const memoriaAntes = process.memoryUsage();
  const sourceInicial = sourceProofWorker(paths);
  if (!sourceInicial.ok) throw erroCodigo("TERMINAL_INDEX_SOURCE_MISSING", sourceInicial.motivo);
  const entradas = new Map();
  let legadoTerminais = 0;
  let incrementalTerminais = 0;
  let duplicados = 0;

  function adicionar(raw, sourceMask) {
    const item = raw?.item && typeof raw.item === "object" ? raw.item : raw;
    const entrada = operacional.normalizarEntradasViva([item], nowMs)[0];
    if (!entrada || entrada.bucket !== "historico") return false;
    const identidade = operacional.identidadePrimariaExataFilaV2(item);
    if (!identidade) return false;
    const status = String(entrada.status || item?.status || item?.estado || "").trim().toLowerCase();
    const atual = entradas.get(identidade);
    if (!atual) {
      entradas.set(identidade, [status, sourceMask]);
      return true;
    }
    duplicados += 1;
    const rankAtual = operacional.rankStatusFilaV2(atual[0]);
    const rankNovo = operacional.rankStatusFilaV2(status);
    if (rankNovo > rankAtual) atual[0] = status;
    atual[1] |= sourceMask;
    return true;
  }

  let readMs = 0;
  let parseMs = 0;
  let sourceBytes = 0;
  const legacyRead = lerArrayEstavel(paths.legacy, sourceInicial.proof.legacy, item => {
    if (adicionar(item, 1)) legadoTerminais += 1;
  });
  readMs += legacyRead.readMs;
  parseMs += legacyRead.parseMs;
  sourceBytes += legacyRead.bytes;

  for (const source of sourceInicial.proof.incremental) {
    const file = path.resolve(paths.incrementalDir, source.name);
    if (path.dirname(file) !== paths.incrementalDir) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
    const leitura = lerJsonlEstavel(file, source.identity, registro => {
      const item = registro?.item && typeof registro.item === "object" ? registro.item : registro;
      if (adicionar(item, 2)) incrementalTerminais += 1;
    });
    readMs += leitura.readMs;
    parseMs += leitura.parseMs;
    sourceBytes += leitura.bytes;
  }

  if (typeof hooks.afterScan === "function") hooks.afterScan({ paths, sourceInicial, entradas });
  const sourceDepoisScan = sourceProofWorker(paths);
  garantirSourceEstavel(sourceInicial, sourceDepoisScan, "terminal_index_source_changed_during_scan");

  const entries = Object.create(null);
  for (const identidade of [...entradas.keys()].sort()) entries[identidade] = entradas.get(identidade);
  const builtAt = new Date(nowMs).toISOString();
  const index = {
    version: TERMINAL_INDEX_VERSION,
    complete: true,
    authorityEligible: false,
    mode: "shadow",
    generation,
    revision,
    builtAt,
    totalTerminais: entradas.size,
    sourceRevision: sourceInicial.sourceRevision,
    entries
  };
  const stringifyStarted = process.hrtime.bigint();
  const indexBuffer = Buffer.from(JSON.stringify(index), "utf8");
  const stringifyMs = Number(process.hrtime.bigint() - stringifyStarted) / 1e6;

  try {
    escreverArquivoCompleto(indexPartial, indexBuffer);
    if (typeof hooks.afterIndexPartial === "function") hooks.afterIndexPartial({ paths, indexPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_before_publish");
    if (typeof hooks.beforeIndexRename === "function") hooks.beforeIndexRename({ paths, indexPartial });
    fs.renameSync(indexPartial, paths.index);
    const indexIdentity = statOptional(paths.index, fs);
    if (!indexIdentity) throw erroCodigo("TERMINAL_INDEX_PUBLISH_FAILED");
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_after_index_publish");

    const proof = {
      proofVersion: TERMINAL_INDEX_PROOF_VERSION,
      indexVersion: TERMINAL_INDEX_VERSION,
      complete: true,
      authorityEligible: false,
      mode: "shadow",
      generation,
      revision,
      builtAt,
      totalTerminais: entradas.size,
      sourceRevision: sourceInicial.sourceRevision,
      sources: sourceInicial.proof,
      indexIdentity,
      indexSha256: hashConteudo(indexBuffer)
    };
    escreverArquivoCompleto(proofPartial, JSON.stringify(proof));
    if (typeof hooks.beforeProofRename === "function") hooks.beforeProofRename({ paths, proofPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_before_proof_publish");
    fs.renameSync(proofPartial, paths.proof);
    const sourceFinal = sourceProofWorker(paths);
    if (!sourceFinal.ok || !sourceProofIgual(sourceInicial.proof, sourceFinal.proof)) {
      removerSeExiste(paths.proof);
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_after_publish");
    }
    if (typeof hooks.afterPublish === "function") hooks.afterPublish({ paths, index, proof });

    const memoriaDepois = process.memoryUsage();
    return {
      ok: true,
      operation: "terminal_index_bootstrap",
      clienteId: paths.cliente,
      checkpointRevision: revision,
      generation,
      totalTerminais: entradas.size,
      legadoTerminais,
      incrementalTerminais,
      duplicados,
      bytes: indexBuffer.length,
      sourceRevision: sourceInicial.sourceRevision,
      metrics: {
        messageBytes: Buffer.byteLength(JSON.stringify(job), "utf8"),
        sourceBytes,
        readMs,
        parseMs,
        stringifyMs: Math.max(0, stringifyMs),
        totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
        processRssBytesAtJob: memoriaDepois.rss,
        workerHeapUsedBytes: memoriaDepois.heapUsed,
        heapDeltaBytes: memoriaDepois.heapUsed - memoriaAntes.heapUsed,
        indexBytes: indexBuffer.length
      }
    };
  } catch (erro) {
    removerSeExiste(indexPartial);
    removerSeExiste(proofPartial);
    throw erro;
  }
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  DEFAULT_MAX_JSONL_LINE_BYTES,
  caminhosWorker,
  lerJsonlEstavel,
  construirTerminalIndex
};
