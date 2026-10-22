"use strict";

// One-shot administrative checkpoint recovery. This module is intentionally not
// imported by the regular scheduler. It can only resume an already-pending
// revision after reading the authoritative state from PostgreSQL.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const fila = require("../modules/fila/fila-operacional-v2");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const manifestRepo = require("../modules/fila/fila-manifest-state.repository");
const { buildOrLoadReferenceIndex, discoverSources } = require("../modules/engine/auto-clean/gc-reference-index-builder");

const CLIENT_RE = /^[a-zA-Z0-9_.-]+$/;

function texto(value) { return String(value == null ? "" : value).trim(); }

function expectedFromState(state, expected = {}) {
  const revision = texto(state?.pendingCheckpointRevision);
  const target = Number(state?.pendingCheckpointTargetGeneration);
  if (!revision || !Number.isSafeInteger(target)) {
    throw new Error("checkpoint_pending_state_invalido");
  }
  if (expected.revision && expected.revision !== revision) {
    throw new Error("checkpoint_pending_revision_diferente_da_expectativa");
  }
  if (expected.target !== undefined && Number(expected.target) !== target) {
    throw new Error("checkpoint_pending_target_diferente_da_expectativa");
  }
  if (state.vivaGeneration !== target || state.durableCheckpointGeneration >= target ||
      state.authorityReady === true) {
    throw new Error("checkpoint_pending_state_nao_elegivel");
  }
  return { revision, target };
}

function identity(file) {
  const stat = fs.statSync(file);
  return {
    size: Number(stat.size), mtimeMs: Number(stat.mtimeMs),
    dev: Number(stat.dev), ino: Number(stat.ino)
  };
}

function sameIdentity(a, b) {
  return Boolean(a && b) && a.size === b.size && a.mtimeMs === b.mtimeMs &&
    a.dev === b.dev && a.ino === b.ino;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceSnapshot(dataDir, clienteId) {
  const dir = path.join(path.resolve(dataDir), "clientes", clienteId);
  const viva = path.join(dir, "fila-viva.json");
  const legacy = path.join(dir, "fila.json");
  return {
    dir,
    viva,
    legacy,
    vivaProof: path.join(dir, "fila-viva.proof.json"),
    legacyProof: path.join(dir, "fila.proof.json"),
    vivaIdentity: identity(viva),
    legacyIdentity: identity(legacy),
    vivaHash: sha256(viva),
    legacyHash: sha256(legacy)
  };
}

function proofCoversFile(proofDb, proofPath, filePath, clienteId, arquivo, generation) {
  if (!proofDb || !fs.existsSync(proofPath) || !fs.existsSync(filePath)) return false;
  let proofArquivo;
  try { proofArquivo = JSON.parse(fs.readFileSync(proofPath, "utf8")); }
  catch { return false; }
  const stat = identity(filePath);
  const hash = sha256(filePath);
  const campos = ["clienteId", "arquivo", "generation", "fileRevision", "contentHash", "size", "mtimeMs"];
  return campos.every(campo => proofDb[campo] === proofArquivo?.[campo]) &&
    proofDb.clienteId === clienteId && proofDb.arquivo === arquivo &&
    Number(proofDb.generation) === Number(generation) &&
    proofDb.contentHash === hash && Number(proofDb.size) === stat.size &&
    Math.abs(Number(proofDb.mtimeMs) - stat.mtimeMs) <= 1;
}

function validateConfirmedState(stateBefore, stateAfter, sources, clienteId, target) {
  if (!stateAfter || !Number.isSafeInteger(Number(stateAfter.revision)) ||
      Number(stateAfter.revision) <= Number(stateBefore?.revision || 0)) {
    return { ok: false, motivo: "checkpoint_revision_nao_avancou" };
  }
  if (Number(stateAfter.vivaGeneration) !== Number(target) ||
      Number(stateAfter.durableCheckpointGeneration) !== Number(target) ||
      stateAfter.pendingCheckpointRevision || stateAfter.pendingCheckpointTargetGeneration !== null ||
      stateAfter.authorityReady === true) {
    return { ok: false, motivo: "checkpoint_confirmado_state_invalido" };
  }
  const vivaProof = proofCoversFile(
    stateAfter.vivaFileProof, sources.vivaProof, sources.viva, clienteId, "fila-viva.json", target
  );
  const legacyProof = proofCoversFile(
    stateAfter.legacyFileProof, sources.legacyProof, sources.legacy, clienteId, "fila.json", target
  );
  if (!vivaProof || !legacyProof) return { ok: false, motivo: "checkpoint_proof_fisico_invalido", vivaProof, legacyProof };
  return { ok: true, revision: Number(stateAfter.revision), vivaProof, legacyProof };
}

function parseCliArgs(argv = [], env = process.env) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--execute") { values.execute = true; continue; }
    const match = arg.match(/^--(workspace|pending-revision|target-generation|expected-reference-count|protected-hash)=(.+)$/);
    if (match) { values[match[1]] = match[2]; continue; }
    const key = arg.match(/^--(workspace|pending-revision|target-generation|expected-reference-count|protected-hash)$/)?.[1];
    if (key && argv[i + 1] && !String(argv[i + 1]).startsWith("--")) { values[key] = String(argv[++i]); continue; }
    return { ok: false, motivo: "checkpoint_cli_argumento_invalido" };
  }
  const required = ["workspace", "pending-revision", "target-generation", "expected-reference-count", "protected-hash"];
  if (required.some(key => !texto(values[key]))) return { ok: false, motivo: "checkpoint_cli_guard_incompleto" };
  if (!/^user_[a-z0-9]+$/.test(values.workspace) ||
      !/^[a-f0-9-]{36}$/.test(values["pending-revision"]) ||
      !/^\d+$/.test(values["target-generation"]) ||
      !/^\d+$/.test(values["expected-reference-count"]) ||
      !/^[a-f0-9]{64}$/.test(values["protected-hash"])) {
    return { ok: false, motivo: "checkpoint_cli_guard_invalido" };
  }
  return {
    ok: true,
    options: {
      clienteId: values.workspace,
      expectedRevision: values["pending-revision"],
      expectedTargetGeneration: Number(values["target-generation"]),
      expectedReferenceCount: Number(values["expected-reference-count"]),
      expectedProtectedHash: values["protected-hash"],
      execute: values.execute === true,
      authorization: env.CHECKPOINT_ADMIN_EXECUTE
    }
  };
}

function buildReferenceValidator({ dataDir, logger }) {
  return async ({ clienteId, agora }) => {
    const descoberta = await discoverSources({
      dataDir,
      workspaceId: clienteId,
      nowMs: agora,
      fsApi: fs.promises
    });
    if (descoberta.error) {
      return { ok: false, motivo: descoberta.error.reasonCode || "reference_sources_incomplete", descoberta };
    }
    return { ok: true, descoberta, logger };
  };
}

async function runAdminCheckpointResume(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const clienteId = texto(options.clienteId || process.env.CHECKPOINT_CLIENTE_ID);
  if (!CLIENT_RE.test(clienteId) || clienteId.includes("..")) {
    throw new Error("checkpoint_workspace_invalida");
  }
  const expected = {
    revision: texto(options.expectedRevision || process.env.CHECKPOINT_PENDING_REVISION),
    target: options.expectedTargetGeneration ?? process.env.CHECKPOINT_TARGET_GENERATION
  };
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    FILA_V2_OPERACIONAL_ATIVA: "true",
    FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_PERSISTENCE_WORKER: "true",
    FILA_PERSISTENCIA_CANARY_CLIENTES: clienteId
  };
  const logger = options.logger || console;
  const api = options.api || {
    fila,
    repo: manifestRepo,
    buildIndex: buildOrLoadReferenceIndex
  };
  const repo = options.manifestStateRepository || api.repo || manifestRepo;
  const deps = { env, dataDir, logger, manifestStateRepository: repo };
  if (options.pool) deps.pool = options.pool;
  const readState = options.readState || (async () => repo.lerStateObservacional(clienteId, deps));
  const stateBeforeResult = await readState();
  if (stateBeforeResult?.ok !== true) {
    return { ok: false, stage: "preflight", motivo: stateBeforeResult?.motivo || "manifest_state_indisponivel" };
  }
  const stateBefore = stateBeforeResult.state;
  let pending;
  try {
    pending = expectedFromState(stateBefore, expected);
  } catch (error) {
    return { ok: false, stage: "preflight", motivo: error.message };
  }
  const before = sourceSnapshot(dataDir, clienteId);

  if (options.execute !== true) {
    return {
      ok: true, dryRun: true, clienteId, revision: pending.revision,
      targetGeneration: pending.target, state: stateBefore,
      sources: before
    };
  }
  if (String(options.authorization || process.env.CHECKPOINT_ADMIN_EXECUTE || "").toLowerCase() !== "true") {
    return { ok: false, stage: "authorization", motivo: "checkpoint_admin_execute_not_authorized" };
  }

  const capture = options.capture || ((dados, captureDeps) =>
    api.fila.capturarTargetCheckpointCoordenado(clienteId, dados, captureDeps));
  const captured = await capture({
    checkpointRevision: pending.revision,
    expectedTargetGeneration: pending.target,
    motivo: "checkpoint_admin_resume"
  }, deps);
  if (captured?.ok !== true || captured.retomado !== true ||
      captured.checkpointRevision !== pending.revision ||
      Number(captured.targetGeneration) !== pending.target) {
    return { ok: false, stage: "capture", motivo: captured?.motivo || "checkpoint_pending_not_resumed", captured };
  }

  const afterCapture = sourceSnapshot(dataDir, clienteId);
  if (!sameIdentity(before.vivaIdentity, afterCapture.vivaIdentity) ||
      before.vivaHash !== afterCapture.vivaHash ||
      !sameIdentity(before.legacyIdentity, afterCapture.legacyIdentity)) {
    return { ok: false, stage: "source_revalidation", motivo: "checkpoint_source_changed_before_prepare" };
  }

  const persistence = options.persistence || criarCoordenadorPersistencia({ env, logger });
  let prepared;
  try {
    prepared = await persistence.prepare({
      clienteId,
      dataDir,
      checkpointRevision: pending.revision,
      targetGeneration: pending.target,
      expectedVivaHash: before.vivaHash,
      nowMs: Date.now(),
      persistenceMode: "worker"
    });
  } catch (error) {
    await persistence.shutdown?.();
    return { ok: false, stage: "prepare", motivo: "checkpoint_prepare_failed", erro: error.message };
  }
  if (prepared?.ok !== true || !prepared.tempIdentity || !prepared.checkpointProjection) {
    await persistence.shutdown?.();
    return { ok: false, stage: "prepare", motivo: prepared?.motivo || "checkpoint_prepare_invalid" };
  }

  let confirmed;
  try {
    confirmed = await api.fila.confirmarCheckpointCoordenado(clienteId, {
      targetGeneration: pending.target,
      expectedVivaGeneration: pending.target,
      checkpointRevision: pending.revision,
      motivo: "checkpoint_admin_resume",
      itemCount: prepared.itens,
      publicarCheckpoint: async () => persistence.publish({
        clienteId,
        dataDir,
        checkpointRevision: pending.revision,
        targetGeneration: pending.target,
        expectedSourceRevisions: prepared.sourceRevisions,
        tempIdentity: prepared.tempIdentity,
        persistenceMode: "worker"
      })
    }, deps);
  } catch (error) {
    confirmed = { ok: false, motivo: "checkpoint_confirm_exception", erro: error.message };
  }
  if (confirmed?.ok !== true || Number(confirmed.dbState?.durableCheckpointGeneration) !== pending.target ||
      confirmed.dbState?.pendingCheckpointRevision) {
    await persistence.cleanup?.({ clienteId, dataDir, checkpointRevision: pending.revision, persistenceMode: "worker" });
    await persistence.shutdown?.();
    return { ok: false, stage: "confirm", motivo: confirmed?.motivo || "checkpoint_confirm_failed", confirmed };
  }

  const stateAfterConfirmResult = await readState();
  const stateAfterConfirm = stateAfterConfirmResult?.state;
  const sourcesAfterConfirm = sourceSnapshot(dataDir, clienteId);
  const confirmedState = stateAfterConfirmResult?.ok === true
    ? validateConfirmedState(stateBefore, stateAfterConfirm, sourcesAfterConfirm, clienteId, pending.target)
    : { ok: false, motivo: "checkpoint_state_releitura_falhou" };
  if (!confirmedState.ok) {
    await persistence.shutdown?.();
    return { ok: false, stage: "confirm_revalidation", motivo: confirmedState.motivo, confirmedState, state: stateAfterConfirm };
  }

  const rebuild = await api.fila.reconstruirProjecaoLeveAposCheckpoint(clienteId, {
    checkpointRevision: pending.revision,
    targetGeneration: pending.target,
    checkpointSnapshot: prepared.checkpointProjection,
    agora: Date.now()
  }, {
    ...deps,
    validarProjecaoAposCheckpoint: buildReferenceValidator({ dataDir, logger })
  });
  if (rebuild?.ok !== true) {
    await persistence.shutdown?.();
    return { ok: false, stage: "projection", motivo: rebuild?.motivo || "projection_rebuild_failed", rebuild };
  }
  const index = await api.buildIndex({
    dataDir, workspaceId: clienteId, nowMs: Date.now(),
    maxBytesPerRun: Number(options.maxBytesPerRun || 256 * 1024 * 1024),
    maxDurationMs: Number(options.maxDurationMs || 5000), logger
  });
  if (index?.complete !== true) {
    await persistence.shutdown?.();
    return { ok: false, stage: "reference_index", motivo: index?.reasonCode || "reference_index_incomplete", rebuild, index };
  }
  const expectedReferenceCount = Number(options.expectedReferenceCount ?? (process.env.CHECKPOINT_EXPECTED_REFERENCE_COUNT || 0));
  if (expectedReferenceCount > 0 && Number(index.refsCount || index.refs?.size || 0) < expectedReferenceCount) {
    await persistence.shutdown?.();
    return { ok: false, stage: "reference_index", motivo: "reference_coverage_incomplete", expectedReferenceCount, index };
  }
  if (options.expectedProtectedHash && !(index.refs instanceof Map && index.refs.has(options.expectedProtectedHash))) {
    await persistence.shutdown?.();
    return { ok: false, stage: "reference_index", motivo: "protected_reference_missing", expectedProtectedHash, index };
  }
  const readiness = await api.fila.prepararReadinessAutoridadeRecovery(clienteId, {
    ...deps,
    expectedRevision: confirmedState.revision
  });
  await persistence.shutdown?.();
  const stateAfterResult = await readState();
  const stateAfter = stateAfterResult?.state;
  return {
    ok: stateAfterResult?.ok === true && readiness?.ready === true && stateAfter?.authorityReady === true,
    clienteId, revision: pending.revision, targetGeneration: pending.target,
    rebuild, index, readiness, state: stateAfter,
    motivo: stateAfter?.authorityReady === true ? "checkpoint_admin_resume_complete" : "authority_not_ready"
  };
}

module.exports = {
  runAdminCheckpointResume,
  expectedFromState,
  sourceSnapshot,
  sameIdentity,
  proofCoversFile,
  validateConfirmedState,
  parseCliArgs
};

if (require.main === module) {
  const parsed = parseCliArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, stage: "cli", motivo: parsed.motivo })}\n`);
    process.exitCode = 2;
  } else runAdminCheckpointResume(parsed.options)
    .then(result => {
      process.stdout.write(`${JSON.stringify({ ok: result.ok, stage: result.stage || "complete", motivo: result.motivo || "", clienteId: result.clienteId || "" })}\n`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch(error => {
      process.stderr.write(`${JSON.stringify({ ok: false, motivo: error.message })}\n`);
      process.exitCode = 1;
    });
}
