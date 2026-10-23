"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Pool } = require("pg");
const fila = require("../modules/fila/fila-operacional-v2");
const manifest = require("../modules/fila/fila-manifest-state.repository");
const refs = require("../modules/fila/fila-gc-references");
const { executarRecoveryProofPosConfirmacao } = require("../scripts/checkpoint-proof-recovery-admin.cjs");

const databaseUrl = String(process.env.TEST_DATABASE_URL || "");
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL must point to disposable PostgreSQL on loopback");
}

const workspace = "user_b2oogwwl";
const target = 85681;
const protectedHash = "3ef0ca2dde2f527613a9565d9855cbba6830ef61606e273776df063840fb30cc";
const quiet = { log() {}, warn() {}, error() {} };
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

test("recovery pos-confirmacao publica hash real e restaura cobertura 665/665", async () => {
  const admin = new Pool({ connectionString: databaseUrl });
  assert.equal((await admin.query("SHOW server_version")).rows[0].server_version.split(".")[0], "17");
  const schema = `proof_recovery_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proof-recovery-pg17-"));
  const dir = path.join(root, "clientes", workspace);
  const file = name => path.join(dir, name);
  const put = (name, value) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(name), JSON.stringify(value)); };
  try {
    const live = Array.from({ length: 876 }, (_, i) => ({ id: `live_${i}`, clienteId: workspace,
      status: "pendente", imagem: `/data/clientes/${workspace}/renderizados/${sha(`media_${i % 664}`)}.png` }));
    const exclusive = { id: "engine_105447_1791732816360", engineOfertaId: "105447", engineJobId: "606927",
      clienteId: workspace, status: "expirado",
      imagem: `/data/clientes/${workspace}/renderizados/${protectedHash}.png`,
      destinosEstado: { first: { estado: "enviado", ack: "duravel" }, second: { estado: "aguardando" } } };
    put("fila.json", [...live, exclusive]);
    put("fila-viva.json", live.map(item => ({ id: item.id, item, bucket: "viva" })));
    put("fila-historico.json", [{ id: "historico_ack", status: "enviado", ack: "duravel" }]);
    const storage = { getClienteJsonPath: (_, name) => file(name),
      writeClienteJson: (_, name, value) => { put(name, value); return true; }, fs, logger: quiet };
    const legacyProof = fila.publicarProofFilaLegada(workspace, { targetGeneration: target,
      fileRevision: "f9d58827-784e-466f-b290-e0df0cbb6842",
      contentHash: sha(fs.readFileSync(file("fila.json"))) }, storage);
    assert.equal(legacyProof.ok, true);
    const stat = fs.statSync(file("fila-viva.json"));
    const vivaProofSemHash = { proofVersion: 1, clienteId: workspace, arquivo: "fila-viva.json",
      generation: target, targetGeneration: target, fileRevision: "079a59e9-74a7-4a1f-a64f-091153ce79ba",
      size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
    put("fila-viva.proof.json", vivaProofSemHash);
    put(refs.FILA_GC_REFERENCES_ARQUIVO,
      refs.projetarReferenciasFilaViva(JSON.parse(fs.readFileSync(file("fila-viva.json"), "utf8")), workspace,
        fs.lstatSync(file("fila-viva.json"), { bigint: true })));
    put("fila-v2-manifest.json", { manifestVersion: 2, clienteId: workspace,
      vivaGeneration: target, durableCheckpointGeneration: target, dirtyGeneration: null });

    await admin.query(`CREATE SCHEMA ${schema}`);
    await manifest.inicializarSchemaQueueManifestState(pool);
    await pool.query(`INSERT INTO queue_manifest_state(
      cliente_id,revision,viva_generation,durable_checkpoint_generation,dirty_generation,
      authority_ready,viva_file_proof,legacy_file_proof,pending_checkpoint_revision,
      pending_checkpoint_target_generation) VALUES($1,113521,$2,$2,NULL,false,$3,$4,NULL,NULL)`,
    [workspace, target, vivaProofSemHash, legacyProof.proof]);

    const interrupted = await manifest.recuperarProofFilaVivaPosConfirmacao(workspace, {
      expectedRevision: 113521, expectedGeneration: target,
      publicarProofCoordenado: async () => {
        const proof = fila.publicarProofFilaViva(workspace, { generation: target,
          fileRevision: vivaProofSemHash.fileRevision,
          contentHash: sha(fs.readFileSync(file("fila-viva.json"))) }, storage);
        assert.equal(proof.ok, true);
        throw new Error("interrupcao_apos_proof_fisico");
      }
    }, { pool });
    assert.equal(interrupted.ok, false);
    assert.equal(Number((await manifest.lerStateObservacional(workspace, { pool })).state.revision), 113521);

    fila.resetarEstadoProjecaoLeveParaTeste(workspace);
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    const result = await executarRecoveryProofPosConfirmacao({ dataDir: root, clienteId: workspace,
      expectedDbRevision: 113521, expectedTargetGeneration: target, expectedReferenceCount: 665,
      expectedProtectedHash: protectedHash, execute: true, authorization: "true", pool, logger: quiet });
    clearInterval(timer);
    assert.equal(result.ok, true, JSON.stringify({ stage: result.stage, motivo: result.motivo }));
    assert.match(result.proof.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(result.proof.contentHash, sha(fs.readFileSync(file("fila-viva.json"))));
    assert.equal(Number(result.index.refsCount), 665);
    assert.equal(result.index.refs.has(protectedHash), true);
    assert.equal(result.state.authorityReady, true);
    assert.equal(result.state.pendingCheckpointRevision, "");
    assert(ticks > 0, "operacao pesada deve ceder o event loop ao worker");
    const finalLegacy = JSON.parse(fs.readFileSync(file("fila.json"), "utf8"));
    const finalExclusive = finalLegacy.find(item => item.id === exclusive.id);
    assert.equal(finalExclusive.destinosEstado.first.ack, "duravel");
    assert.equal(finalExclusive.destinosEstado.second.estado, "aguardando");

    let concorrenteChamouEscrita = false;
    const concorrente = await manifest.recuperarProofFilaVivaPosConfirmacao(workspace, {
      expectedRevision: 113521, expectedGeneration: target,
      publicarProofCoordenado: async () => { concorrenteChamouEscrita = true; return { ok: false }; }
    }, { pool });
    assert.equal(concorrente.ok, false);
    assert.equal(concorrente.motivo, "revision_stale");
    assert.equal(concorrenteChamouEscrita, false);

    const retry = await executarRecoveryProofPosConfirmacao({ dataDir: root, clienteId: workspace,
      expectedDbRevision: 113521, expectedTargetGeneration: target, expectedReferenceCount: 665,
      expectedProtectedHash: protectedHash, execute: true, authorization: "true", pool, logger: quiet });
    assert.equal(retry.ok, false);
    assert.equal(retry.motivo, "proof_recovery_state_divergente");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("proof oficial rejeita publicacao sem hash calculavel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proof-recovery-guards-"));
  try {
    const dir = path.join(root, "clientes", workspace);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
    const rejected = fila.publicarProofFilaViva(workspace, { generation: target, fileRevision: "rev" }, {
      getClienteJsonPath: (_, name) => path.join(dir, name),
      writeClienteJson: () => { throw new Error("nao_deveria_escrever"); },
      hashArquivo: () => ""
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.motivo, "content_hash_invalido");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
