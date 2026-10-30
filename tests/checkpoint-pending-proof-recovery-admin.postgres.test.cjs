"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Pool } = require("pg");
const fila = require("../modules/fila/fila-operacional-v2");
const repo = require("../modules/fila/fila-manifest-state.repository");
const { recuperarProofFilaVivaPendente, parseCliArgs } =
  require("../modules/engine/auto-clean/gc-pending-proof-recovery-admin.cjs");

const databaseUrl = String(process.env.TEST_DATABASE_URL || "");
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL must point to disposable PostgreSQL on loopback");
}
const workspace = "user_pendingproof";
const generation = 117;
const pendingRevision = "f9d58827-784e-466f-b290-e0df0cbb6842";
const fileRevision = "079a59e9-74a7-4a1f-a64f-091153ce79ba";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const quiet = { log() {}, warn() {}, error() {} };

test("pending proof recovery preserves pending checkpoint and allows guarded resume", async () => {
  const admin = new Pool({ connectionString: databaseUrl });
  assert.equal((await admin.query("SHOW server_version")).rows[0].server_version.split(".")[0], "17");
  const schema = `pending_proof_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pending-proof-pg17-"));
  const dir = path.join(root, "clientes", workspace);
  const at = name => path.join(dir, name);
  const put = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value));
  try {
    fs.mkdirSync(dir, { recursive: true });
    put("fila-viva.json", [{ id: "live", item: { id: "live", status: "pendente" } }]);
    put("fila.json", [{ id: "live", status: "pendente" }]);
    const stat = fs.statSync(at("fila-viva.json"));
    const hashless = { proofVersion: 1, clienteId: workspace, arquivo: "fila-viva.json",
      generation, targetGeneration: generation, fileRevision,
      size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
    put("fila-viva.proof.json", hashless);
    put("fila-v2-manifest.json", { manifestVersion: 2, clienteId: workspace,
      vivaGeneration: generation, durableCheckpointGeneration: generation - 2,
      dirtyGeneration: generation - 1 });
    const expectedVivaHash = sha(fs.readFileSync(at("fila-viva.json")));
    await admin.query(`CREATE SCHEMA ${schema}`);
    await repo.inicializarSchemaQueueManifestState(pool);
    await pool.query(`INSERT INTO queue_manifest_state(
      cliente_id,revision,viva_generation,durable_checkpoint_generation,dirty_generation,
      authority_ready,viva_file_proof,pending_checkpoint_revision,pending_checkpoint_target_generation)
      VALUES($1,42,$2,$3,$4,false,$5,$6,$2)`,
    [workspace, generation, generation - 2, generation - 1, hashless, pendingRevision]);
    const args = { dataDir: root, clienteId: workspace, expectedDbRevision: 42,
      expectedTargetGeneration: generation, expectedPendingRevision: pendingRevision,
      expectedVivaHash, pool, logger: quiet };
    const stateBefore = (await repo.lerStateObservacional(workspace, { pool })).state;
    assert.equal((await recuperarProofFilaVivaPendente(args)).dryRun, true);
    assert.equal((await recuperarProofFilaVivaPendente({ ...args, execute: true })).motivo,
      "pending_proof_execute_not_authorized");
    assert.deepEqual((await repo.lerStateObservacional(workspace, { pool })).state, stateBefore);
    const wrongHash = await recuperarProofFilaVivaPendente({ ...args, expectedVivaHash: "a".repeat(64),
      execute: true, authorization: "true" });
    assert.equal(wrongHash.motivo, "pending_proof_source_divergente");
    const interrupted = await repo.recuperarProofFilaVivaPendente(workspace, {
      expectedRevision: 42, expectedGeneration: generation, expectedPendingRevision: pendingRevision,
      expectedFileRevision: fileRevision,
      publicarProofCoordenado: async () => {
        const published = fila.publicarProofFilaViva(workspace, {
          generation, fileRevision, contentHash: expectedVivaHash
        }, { getClienteJsonPath: (_, name) => at(name),
          writeClienteJson: (_, name, value) => { put(name, value); return true; }, logger: quiet });
        assert.equal(published.ok, true);
        throw new Error("interrupted_after_physical_proof");
      }
    }, { pool });
    assert.equal(interrupted.ok, false);
    assert.equal((await repo.lerStateObservacional(workspace, { pool })).state.revision, 42);
    const result = await recuperarProofFilaVivaPendente({ ...args, execute: true, authorization: "true" });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = (await repo.lerStateObservacional(workspace, { pool })).state;
    assert.equal(after.revision, 43);
    assert.equal(after.pendingCheckpointRevision, pendingRevision);
    assert.equal(after.durableCheckpointGeneration, generation - 2);
    assert.equal(after.authorityReady, false);
    assert.equal(after.vivaFileProof.contentHash, expectedVivaHash);
    assert.equal(JSON.parse(fs.readFileSync(at("fila-viva.proof.json"), "utf8")).contentHash, expectedVivaHash);
    const storage = { dataDir: root, pool, logger: quiet, manifestStateRepository: repo, env: {
      DATA_DIR: root, FILA_V2_OPERACIONAL_ATIVA: "true", FILA_V2_OPERACIONAL_ROLLOUT: "global",
      FILA_PERSISTENCE_WORKER: "true", FILA_PERSISTENCIA_CANARY_CLIENTES: workspace },
      getClienteJsonPath: (_, name) => at(name) };
    const resumed = await fila.capturarTargetCheckpointCoordenado(workspace, {
      checkpointRevision: pendingRevision, expectedTargetGeneration: generation
    }, storage);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.retomado, true);
    const retry = await recuperarProofFilaVivaPendente({ ...args, execute: true, authorization: "true" });
    assert.equal(retry.ok, false);
    assert.equal(retry.motivo, "pending_proof_state_divergente");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI requires exact workspace, revisions and content hash", () => {
  assert.equal(parseCliArgs(["--workspace", workspace]).ok, false);
  const valid = ["--workspace", workspace, "--expected-db-revision", "42",
    "--pending-revision", pendingRevision, "--target-generation", String(generation),
    "--expected-viva-hash", "a".repeat(64)];
  assert.equal(parseCliArgs(valid).ok, true);
  assert.equal(parseCliArgs([...valid, "--execute"]).options.authorization, undefined);
  assert.equal(parseCliArgs(valid.map(value => value === workspace ? "admin" : value)).ok, false);
});
