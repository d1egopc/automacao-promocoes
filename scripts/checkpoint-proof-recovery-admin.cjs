"use strict";

// One-shot recovery for an already-confirmed checkpoint whose VIVA proof lacks
// contentHash. It is never imported by the regular scheduler.

const fs = require("node:fs");
const path = require("node:path");

const fila = require("../modules/fila/fila-operacional-v2");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const repoPadrao = require("../modules/fila/fila-manifest-state.repository");
const { buildOrLoadReferenceIndex, discoverSources } = require("../modules/engine/auto-clean/gc-reference-index-builder");

const CLIENT_RE = /^user_[a-z0-9]+$/;
const HASH_RE = /^[a-f0-9]{64}$/;

function texto(value) { return String(value == null ? "" : value).trim(); }
function caminho(dataDir, clienteId, arquivo) {
  return path.join(path.resolve(dataDir), "clientes", clienteId, arquivo);
}
function identidade(file) {
  const stat = fs.statSync(file);
  return { size: Number(stat.size), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs),
    dev: Number(stat.dev), ino: Number(stat.ino) };
}
function mesmaIdentidade(a, b) {
  return Boolean(a && b) && a.size === b.size && a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs && a.dev === b.dev && a.ino === b.ino;
}
function escreverJsonAtomic(dataDir, clienteId, arquivo, valor) {
  const destino = caminho(dataDir, clienteId, arquivo);
  const temp = `${destino}.proof-recovery-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(valor, null, 2));
  fs.renameSync(temp, destino);
  return true;
}

function parseCliArgs(argv = [], env = process.env) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--execute") { values.execute = true; continue; }
    const match = arg.match(/^--(workspace|expected-db-revision|target-generation|expected-reference-count|protected-hash)=(.+)$/);
    if (match) { values[match[1]] = match[2]; continue; }
    const key = arg.match(/^--(workspace|expected-db-revision|target-generation|expected-reference-count|protected-hash)$/)?.[1];
    if (key && argv[i + 1] && !String(argv[i + 1]).startsWith("--")) {
      values[key] = String(argv[++i]); continue;
    }
    return { ok: false, motivo: "proof_recovery_cli_argumento_invalido" };
  }
  const required = ["workspace", "expected-db-revision", "target-generation", "expected-reference-count", "protected-hash"];
  if (required.some(key => !texto(values[key]))) return { ok: false, motivo: "proof_recovery_cli_guard_incompleto" };
  if (!CLIENT_RE.test(values.workspace) || !/^\d+$/.test(values["expected-db-revision"]) ||
      !/^\d+$/.test(values["target-generation"]) || !/^\d+$/.test(values["expected-reference-count"]) ||
      !HASH_RE.test(values["protected-hash"])) {
    return { ok: false, motivo: "proof_recovery_cli_guard_invalido" };
  }
  return { ok: true, options: {
    clienteId: values.workspace,
    expectedDbRevision: Number(values["expected-db-revision"]),
    expectedTargetGeneration: Number(values["target-generation"]),
    expectedReferenceCount: Number(values["expected-reference-count"]),
    expectedProtectedHash: values["protected-hash"],
    execute: values.execute === true,
    authorization: env.CHECKPOINT_PROOF_RECOVERY_EXECUTE
  } };
}

async function executarRecoveryProofPosConfirmacao(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const clienteId = texto(options.clienteId);
  const expectedRevision = Number(options.expectedDbRevision);
  const generation = Number(options.expectedTargetGeneration);
  if (!CLIENT_RE.test(clienteId) || !Number.isSafeInteger(expectedRevision) || !Number.isSafeInteger(generation) ||
      !HASH_RE.test(texto(options.expectedProtectedHash)) || Number(options.expectedReferenceCount) < 1) {
    return { ok: false, stage: "guards", motivo: "proof_recovery_guard_invalido" };
  }
  const logger = options.logger || console;
  const repo = options.manifestStateRepository || repoPadrao;
  const api = options.api || { fila, buildIndex: buildOrLoadReferenceIndex };
  const env = { ...process.env, DATA_DIR: dataDir,
    FILA_V2_OPERACIONAL_ATIVA: "true", FILA_V2_OPERACIONAL_ROLLOUT: "global",
    FILA_PERSISTENCE_WORKER: "true",
    FILA_PERSISTENCIA_CANARY_CLIENTES: clienteId };
  const deps = { env, dataDir, logger, manifestStateRepository: repo,
    getClienteJsonPath: (id, arquivo) => caminho(dataDir, id, arquivo),
    writeClienteJson: (id, arquivo, valor) => escreverJsonAtomic(dataDir, id, arquivo, valor) };
  if (options.pool) deps.pool = options.pool;
  const lerState = options.readState || (() => repo.lerStateObservacional(clienteId, deps));
  const beforeResult = await lerState();
  const before = beforeResult?.state;
  if (beforeResult?.ok !== true || Number(before?.revision) !== expectedRevision ||
      Number(before?.vivaGeneration) !== generation || Number(before?.durableCheckpointGeneration) !== generation ||
      before?.dirtyGeneration !== null || before?.pendingCheckpointRevision ||
      before?.pendingCheckpointTargetGeneration !== null || before?.authorityReady === true) {
    return { ok: false, stage: "preflight", motivo: "proof_recovery_state_divergente", state: before };
  }
  const viva = caminho(dataDir, clienteId, "fila-viva.json");
  const legacyProof = before.legacyFileProof;
  if (!legacyProof || !HASH_RE.test(texto(legacyProof.contentHash)) || Number(legacyProof.generation) !== generation) {
    return { ok: false, stage: "preflight", motivo: "proof_recovery_legacy_proof_invalido" };
  }
  if (options.execute !== true) return { ok: true, dryRun: true, state: before };
  if (String(options.authorization || "").toLowerCase() !== "true") {
    return { ok: false, stage: "authorization", motivo: "proof_recovery_execute_not_authorized" };
  }

  const persistence = options.persistence || criarCoordenadorPersistencia({ env, logger });
  try {
    const probe = await persistence.probeVivaSnapshot({ clienteId, dataDir, probeViva: true, persistenceMode: "worker" });
    if (probe?.ok !== true || !HASH_RE.test(texto(probe.currentHash)) || !probe.currentIdentity) {
      return { ok: false, stage: "probe", motivo: probe?.motivo || "proof_recovery_probe_invalido" };
    }
    const recuperado = await repo.recuperarProofFilaVivaPosConfirmacao(clienteId, {
      expectedRevision, expectedGeneration: generation,
      publicarProofCoordenado: async ({ state }) => {
        if (Number(state.revision) !== expectedRevision || !mesmaIdentidade(probe.currentIdentity, identidade(viva))) {
          return { ok: false, motivo: "proof_recovery_fonte_alterada" };
        }
        const publicado = api.fila.publicarProofFilaViva(clienteId, {
          generation, fileRevision: before.vivaFileProof?.fileRevision || `viva-proof-recovery-${generation}`,
          contentHash: probe.currentHash
        }, deps);
        if (publicado.ok !== true || !mesmaIdentidade(probe.currentIdentity, identidade(viva))) {
          return { ok: false, motivo: "proof_recovery_fonte_alterada_apos_publicacao" };
        }
        return publicado;
      }
    }, deps);
    if (recuperado?.ok !== true || recuperado?.recuperado !== true) {
      return { ok: false, stage: "proof", motivo: recuperado?.motivo || "proof_recovery_falhou", recuperado };
    }
    const afterProofResult = await lerState();
    const afterProof = afterProofResult?.state;
    if (afterProofResult?.ok !== true || Number(afterProof.revision) !== expectedRevision + 1 ||
        afterProof.authorityReady === true || afterProof.vivaFileProof?.contentHash !== probe.currentHash) {
      return { ok: false, stage: "proof_revalidation", motivo: "proof_recovery_db_invalido", state: afterProof };
    }

    const prepared = await persistence.prepare({ clienteId, dataDir,
      checkpointRevision: legacyProof.fileRevision, targetGeneration: generation,
      expectedVivaHash: probe.currentHash, nowMs: Date.now(), persistenceMode: "worker" });
    if (prepared?.ok !== true || !prepared.checkpointProjection) {
      return { ok: false, stage: "projection_prepare", motivo: prepared?.motivo || "projection_prepare_failed" };
    }
    const rebuild = await api.fila.reconstruirProjecaoLeveAposCheckpoint(clienteId, {
      checkpointRevision: legacyProof.fileRevision, targetGeneration: generation,
      checkpointSnapshot: prepared.checkpointProjection, agora: Date.now()
    }, { ...deps, validarProjecaoAposCheckpoint: async ({ agora }) => {
      const descoberta = await discoverSources({ dataDir, workspaceId: clienteId, nowMs: agora, fsApi: fs.promises });
      return descoberta.error ? { ok: false, motivo: descoberta.error.reasonCode } : { ok: true, descoberta };
    } });
    await persistence.cleanup?.({ clienteId, dataDir, checkpointRevision: legacyProof.fileRevision, persistenceMode: "worker" });
    if (rebuild?.ok !== true) return { ok: false, stage: "projection", motivo: rebuild?.motivo || "projection_failed" };

    const index = await api.buildIndex({ dataDir, workspaceId: clienteId, nowMs: Date.now(),
      maxBytesPerRun: Number(options.maxBytesPerRun || 256 * 1024 * 1024),
      maxDurationMs: Number(options.maxDurationMs || 5000), logger });
    const refsCount = Number(index?.refsCount || index?.refs?.size || 0);
    if (index?.complete !== true || refsCount < Number(options.expectedReferenceCount) ||
        !(index.refs instanceof Map && index.refs.has(options.expectedProtectedHash))) {
      return { ok: false, stage: "index", motivo: "proof_recovery_reference_coverage_incomplete", index };
    }
    const readiness = await api.fila.prepararReadinessAutoridadeRecovery(clienteId, {
      ...deps, expectedRevision: Number(afterProof.revision)
    });
    const finalResult = await lerState();
    return { ok: readiness?.ready === true && finalResult?.state?.authorityReady === true,
      stage: "complete", proof: recuperado.proof, rebuild, index, readiness, state: finalResult?.state,
      motivo: readiness?.ready === true ? "proof_recovery_complete" : "authority_not_ready" };
  } finally {
    await persistence.shutdown?.();
  }
}

module.exports = { executarRecoveryProofPosConfirmacao, parseCliArgs, mesmaIdentidade };

if (require.main === module) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, stage: "cli", motivo: parsed.motivo })}\n`);
    process.exitCode = 2;
  } else executarRecoveryProofPosConfirmacao(parsed.options).then(result => {
    process.stdout.write(`${JSON.stringify({ ok: result.ok, stage: result.stage, motivo: result.motivo || "" })}\n`);
    process.exitCode = result.ok ? 0 : 1;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, motivo: error.message })}\n`);
    process.exitCode = 1;
  });
}
