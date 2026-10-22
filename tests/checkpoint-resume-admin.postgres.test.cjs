"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Pool } = require("pg");
const queue = require("../modules/fila/fila-operacional-v2");
const manifest = require("../modules/fila/fila-manifest-state.repository");
const refs = require("../modules/fila/fila-gc-references");
const { runAdminCheckpointResume } = require("../scripts/checkpoint-resume-admin.cjs");

const databaseUrl = String(process.env.TEST_DATABASE_URL || "");
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL must point to disposable PostgreSQL on loopback");
}

const workspace = "user_b2oogwwl";
const revision = "f9d58827-784e-466f-b290-e0df0cbb6842";
const protectedHash = "3ef0ca2dde2f527613a9565d9855cbba6830ef61606e273776df063840fb30cc";
const quiet = { log() {}, warn() {}, error() {} };
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

test("runner real retoma pending revision em PostgreSQL 17 isolado", async () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const version = await admin.query("SHOW server_version");
  assert.equal(version.rows[0].server_version.split(".")[0], "17");
  const schema = `checkpoint_admin_runner_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-admin-runner-pg17-"));
  const dir = path.join(root, "clientes", workspace);
  const file = name => path.join(dir, name);
  const put = (name, value) => {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value));
  };
  let beforeDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = databaseUrl;
    fs.mkdirSync(dir, { recursive: true });
    const live = Array.from({ length: 876 }, (_, i) => ({
      id: `live_${i}`, clienteId: workspace, status: "pendente",
      imagem: `/identidade-visual-ofertas/public/clientes/${workspace}/renderizados/${sha(`media_${i % 664}`)}.png`
    }));
    const exclusive = { id: "engine_105447_1791732816360", engineOfertaId: "105447", engineJobId: "606927",
      clienteId: workspace, status: "pendente", expiraEm: "2026-10-11T15:57:16Z",
      imagem: `/identidade-visual-ofertas/public/clientes/${workspace}/renderizados/${protectedHash}.png`,
      destinosEstado: { first: { estado: "enviado" }, second: { estado: "aguardando" } } };
    put("fila.json", [...live, exclusive]);
    put("fila-viva.json", live.map(item => ({ item, bucket: "viva", id: item.id })));
    put("fila-historico.json", [{ id: "history-protected", status: "enviado" }]);
    const storageDeps = {
      getClienteJsonPath: (_, name) => file(name),
      writeClienteJson: (_, name, value) => { put(name, value); return true; },
      fs, logger: quiet
    };
    const vivaProof = queue.publicarProofFilaViva(workspace,
      { generation: 85681, fileRevision: "viva-85681", contentHash: sha(fs.readFileSync(file("fila-viva.json"))) },
      { ...storageDeps, agora: Date.now() });
    const legacyProof = queue.publicarProofFilaLegada(workspace,
      { targetGeneration: 85675, fileRevision: revision, contentHash: sha(fs.readFileSync(file("fila.json"))) },
      { ...storageDeps, agora: Date.now() });
    assert(vivaProof.ok && legacyProof.ok);
    put(refs.FILA_GC_REFERENCES_ARQUIVO,
      refs.projetarReferenciasFilaViva(JSON.parse(fs.readFileSync(file("fila-viva.json"), "utf8")), workspace,
        fs.lstatSync(file("fila-viva.json"), { bigint: true })));
    put("fila-v2-manifest.json", { manifestVersion: 2, clienteId: workspace,
      vivaGeneration: 85681, durableCheckpointGeneration: 85675, dirtyGeneration: 85676 });

    await admin.query(`CREATE SCHEMA ${schema}`);
    await manifest.inicializarSchemaQueueManifestState(pool);
    await pool.query(`INSERT INTO queue_manifest_state(
      cliente_id,revision,viva_generation,durable_checkpoint_generation,dirty_generation,
      authority_ready,viva_file_proof,legacy_file_proof,pending_checkpoint_revision,
      pending_checkpoint_target_generation) VALUES($1,113520,85681,85675,85676,false,$2,$3,$4,85681)`,
    [workspace, vivaProof.proof, legacyProof.proof, revision]);

    queue.resetarEstadoProjecaoLeveParaTeste(workspace);
    const result = await runAdminCheckpointResume({
      dataDir: root, clienteId: workspace, expectedRevision: revision,
      expectedTargetGeneration: 85681, expectedReferenceCount: 665,
      expectedProtectedHash: protectedHash, execute: true, authorization: "true",
      pool, logger: quiet
    });
    assert.equal(result.ok, true, JSON.stringify({ stage: result.stage, motivo: result.motivo, readiness: result.readiness }));
    assert.equal(Number(result.state.vivaGeneration), 85681);
    assert.equal(Number(result.state.durableCheckpointGeneration), 85681);
    assert.equal(result.state.pendingCheckpointRevision, "");
    assert.equal(result.state.authorityReady, true);
    assert.equal(Number(result.index.refsCount), 665);
    assert(result.index.refs.has(protectedHash));
    assert.equal(result.confirmedState.vivaProof, true);
    assert.equal(result.confirmedState.legacyProof, true);
  } finally {
    process.env.DATABASE_URL = beforeDatabaseUrl;
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
