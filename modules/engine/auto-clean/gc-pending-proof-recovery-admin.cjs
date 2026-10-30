"use strict";

// One-shot, explicitly authorized repair of a hashless VIVA proof on an
// already-pending checkpoint. Never imported by the scheduler or backend.
const fs = require("node:fs");
const path = require("node:path");
const fila = require("../../fila/fila-operacional-v2");
const mutationIntent = require("../../fila/viva-mutation-intent");
const repoPadrao = require("../../fila/fila-manifest-state.repository");

const CLIENT_RE = /^user_[a-z0-9]+$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const REVISION_RE = /^[a-f0-9-]{36}$/;
const PROOF_FIELDS = ["clienteId", "arquivo", "generation", "fileRevision",
  "size", "mtimeMs", "ctimeMs", "ino", "dev"];

function filePath(dataDir, client, name) {
  return path.join(path.resolve(dataDir), "clientes", client, name);
}
function identity(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("pending_proof_source_not_regular");
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
    ino: stat.ino, dev: stat.dev };
}
function sameIdentity(a, b) {
  return Boolean(a && b) && ["size", "mtimeMs", "ctimeMs", "ino", "dev"]
    .every(key => a[key] === b[key]);
}
function sameProofIdentity(a, b) {
  return Boolean(a && b) && PROOF_FIELDS.every(key => a[key] === b[key]);
}
function writeJsonAtomic(dataDir, client, name, value) {
  const target = filePath(dataDir, client, name);
  const temporary = `${target}.pending-proof-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
  fs.renameSync(temporary, target);
  return true;
}
function parseCliArgs(argv = [], env = process.env) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === "--execute") { values.execute = true; continue; }
    const match = arg.match(/^--(workspace|expected-db-revision|pending-revision|target-generation|expected-viva-hash)=(.+)$/);
    if (match) { values[match[1]] = match[2]; continue; }
    const key = arg.match(/^--(workspace|expected-db-revision|pending-revision|target-generation|expected-viva-hash)$/)?.[1];
    if (key && argv[i + 1] && !String(argv[i + 1]).startsWith("--")) { values[key] = String(argv[++i]); continue; }
    return { ok: false, motivo: "pending_proof_cli_argumento_invalido" };
  }
  if (!CLIENT_RE.test(String(values.workspace || "")) ||
      !/^\d+$/.test(String(values["expected-db-revision"] || "")) ||
      !REVISION_RE.test(String(values["pending-revision"] || "")) ||
      !/^\d+$/.test(String(values["target-generation"] || "")) ||
      !HASH_RE.test(String(values["expected-viva-hash"] || ""))) {
    return { ok: false, motivo: "pending_proof_cli_guard_invalido" };
  }
  return { ok: true, options: {
    clienteId: values.workspace,
    expectedDbRevision: Number(values["expected-db-revision"]),
    expectedPendingRevision: values["pending-revision"],
    expectedTargetGeneration: Number(values["target-generation"]),
    expectedVivaHash: values["expected-viva-hash"],
    execute: values.execute === true,
    authorization: env.CHECKPOINT_PENDING_PROOF_RECOVERY_EXECUTE
  } };
}

async function recuperarProofFilaVivaPendente(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "/data");
  const client = String(options.clienteId || "");
  const expectedRevision = Number(options.expectedDbRevision);
  const target = Number(options.expectedTargetGeneration);
  const pending = String(options.expectedPendingRevision || "");
  const expectedHash = String(options.expectedVivaHash || "");
  if (!CLIENT_RE.test(client) || !Number.isSafeInteger(expectedRevision) ||
      !Number.isSafeInteger(target) || !REVISION_RE.test(pending) || !HASH_RE.test(expectedHash)) {
    return { ok: false, stage: "guards", motivo: "pending_proof_guard_invalido" };
  }
  const dir = path.join(dataDir, "clientes", client);
  if (fs.realpathSync(dir) !== dir) return { ok: false, stage: "guards", motivo: "pending_proof_directory_symlink" };
  const viva = filePath(dataDir, client, "fila-viva.json");
  const proofPath = filePath(dataDir, client, "fila-viva.proof.json");
  const repo = options.manifestStateRepository || repoPadrao;
  const deps = { dataDir, logger: options.logger || console,
    getClienteJsonPath: (id, name) => filePath(dataDir, id, name),
    writeClienteJson: (id, name, value) => writeJsonAtomic(dataDir, id, name, value) };
  if (options.pool) deps.pool = options.pool;
  const beforeResult = await repo.lerStateObservacional(client, deps);
  const state = beforeResult?.state;
  const oldProof = state?.vivaFileProof;
  if (beforeResult?.ok !== true || state.revision !== expectedRevision ||
      state.vivaGeneration !== target || state.durableCheckpointGeneration >= target ||
      state.pendingCheckpointRevision !== pending || state.pendingCheckpointTargetGeneration !== target ||
      state.dirtyGeneration === null || state.authorityReady === true ||
      !oldProof || oldProof.clienteId !== client || oldProof.arquivo !== "fila-viva.json" ||
      oldProof.generation !== target || oldProof.contentHash) {
    return { ok: false, stage: "preflight", motivo: "pending_proof_state_divergente" };
  }
  const proofIdentity = identity(proofPath);
  const fileProof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const before = identity(viva);
  const hash = mutationIntent.hashArquivo(viva);
  const after = identity(viva);
  if (!sameProofIdentity(oldProof, fileProof) ||
      (fileProof.contentHash && fileProof.contentHash !== expectedHash) ||
      !sameIdentity(before, after) || !sameIdentity(before, oldProof) ||
      hash !== expectedHash || !sameIdentity(proofIdentity, identity(proofPath))) {
    return { ok: false, stage: "preflight", motivo: "pending_proof_source_divergente" };
  }
  if (options.execute !== true) return { ok: true, dryRun: true, stage: "preflight", clienteId: client, target };
  if (String(options.authorization || "").toLowerCase() !== "true") {
    return { ok: false, stage: "authorization", motivo: "pending_proof_execute_not_authorized" };
  }
  const recovered = await repo.recuperarProofFilaVivaPendente(client, {
    expectedRevision, expectedGeneration: target, expectedPendingRevision: pending,
    expectedFileRevision: oldProof.fileRevision,
    publicarProofCoordenado: async () => {
      if (!sameIdentity(before, identity(viva)) || mutationIntent.hashArquivo(viva) !== expectedHash ||
          !sameIdentity(proofIdentity, identity(proofPath)) ||
          !sameProofIdentity(fileProof, JSON.parse(fs.readFileSync(proofPath, "utf8")))) {
        return { ok: false, motivo: "pending_proof_source_changed" };
      }
      const published = fila.publicarProofFilaViva(client, {
        generation: target, fileRevision: oldProof.fileRevision, contentHash: expectedHash
      }, deps);
      if (published.ok !== true || !sameIdentity(before, identity(viva))) {
        return { ok: false, motivo: "pending_proof_source_changed_after_publish" };
      }
      return published;
    }
  }, deps);
  if (recovered?.ok !== true || recovered.recuperado !== true) {
    return { ok: false, stage: "proof", motivo: recovered?.motivo || "pending_proof_recovery_failed" };
  }
  const finalResult = await repo.lerStateObservacional(client, deps);
  const final = finalResult?.state;
  const ok = finalResult?.ok === true && final.revision === expectedRevision + 1 &&
    final.pendingCheckpointRevision === pending && final.pendingCheckpointTargetGeneration === target &&
    final.authorityReady === false && final.vivaFileProof?.contentHash === expectedHash &&
    sameIdentity(before, identity(viva));
  return { ok, stage: "proof", motivo: ok ? "pending_proof_recovered" : "pending_proof_revalidation_failed",
    clienteId: client, target };
}

module.exports = { recuperarProofFilaVivaPendente, parseCliArgs, sameIdentity, sameProofIdentity };
if (require.main === module) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, stage: "cli", motivo: parsed.motivo })}\n`);
    process.exitCode = 2;
  } else recuperarProofFilaVivaPendente(parsed.options)
    .then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok ? 0 : 1; })
    .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, motivo: error.code || error.message })}\n`); process.exitCode = 1; });
}
