"use strict";

// Run explicitly with a disposable PostgreSQL 17: TEST_DATABASE_URL=postgresql://... node --test this-file.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Pool } = require("pg");
const queue = require("../modules/fila/fila-operacional-v2");
const manifest = require("../modules/fila/fila-manifest-state.repository");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const refs = require("../modules/fila/fila-gc-references");
const index = require("../modules/engine/auto-clean/gc-reference-index-builder");
const { runMediaPhysical, RETENTION_MS } = require("../modules/engine/auto-clean/gc-media-physical.service");

const workspace = "user_b2oogwwl";
const revision = "f9d58827-784e-466f-b290-e0df0cbb6842";
const itemId = "engine_105447_1791732816360";
const imageHash = "3ef0ca2dde2f527613a9565d9855cbba6830ef61606e273776df063840fb30cc";
const now = Date.parse("2026-10-22T17:00:00Z");
const quiet = { log() {}, warn() {}, error() {} };
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL must point to disposable PostgreSQL on loopback");
}

test("checkpoint 85681: proof, protected reference, pending revision and GC", async () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const version = await admin.query("SHOW server_version");
  assert.equal(version.rows[0].server_version.split(".")[0], "17");
  const schema = `checkpoint_fixture_${process.pid}_${Date.now()}`;
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-checkpoint-85681-"));
  const dir = path.join(root, "clientes", workspace);
  const file = name => path.join(dir, name);
  const put = (name, value) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value));
  };
  const get = name => JSON.parse(fs.readFileSync(file(name), "utf8"));
  let pool;
  let worker;
  try {
    const live = Array.from({ length: 876 }, (_, i) => ({
      id: `live_${i}`, clienteId: workspace, status: "pendente",
      imagem: `/identidade-visual-ofertas/public/clientes/${workspace}/renderizados/${sha(`media_${i % 664}`)}.png`
    }));
    const exclusive = { id: itemId, engineOfertaId: "105447", engineJobId: "606927",
      clienteId: workspace, status: "pendente", expiraEm: "2026-10-11T15:57:16Z",
      imagem: `/identidade-visual-ofertas/public/clientes/${workspace}/renderizados/${imageHash}.png`,
      destinosEstado: { first: { estado: "enviado" }, second: { estado: "aguardando" } } };
    put("fila.json", [...live, exclusive]);
    put("fila-viva.json", live.map(item => ({ item, bucket: "viva", id: item.id })));
    put("fila-historico.json", [{ id: "history-protected", status: "enviado" }]);
    put("dedup-fixture.json", { [itemId]: ["first"] });
    const protectedBytes = Object.fromEntries(["fila-viva.json", "fila-historico.json", "dedup-fixture.json"]
      .map(name => [name, sha(fs.readFileSync(file(name)))]));
    const deps = { getClienteJsonPath: (_, name) => file(name),
      writeClienteJson: (_, name, value) => { put(name, value); return true; }, fs, logger: quiet };
    const vivaProof = queue.publicarProofFilaViva(workspace,
      { generation: 85681, fileRevision: "079a59e9-74a7-4a1f-a64f-091153ce79ba" }, deps);
    const legacyProof = queue.publicarProofFilaLegada(workspace,
      { targetGeneration: 85675, fileRevision: "495d22fd-24c8-4091-aa67-2fff20ee3486" }, deps);
    assert(vivaProof.ok && legacyProof.ok);
    fs.appendFileSync(file("fila.json"), " "); // stale old proof, as in the incident
    put(refs.FILA_GC_REFERENCES_ARQUIVO,
      refs.projetarReferenciasFilaViva(get("fila-viva.json"), workspace,
        fs.lstatSync(file("fila-viva.json"), { bigint: true })));
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await manifest.inicializarSchemaQueueManifestState(pool);
    await pool.query(`INSERT INTO queue_manifest_state(cliente_id,revision,viva_generation,durable_checkpoint_generation,
      dirty_generation,authority_ready,viva_file_proof,legacy_file_proof,pending_checkpoint_revision,
      pending_checkpoint_target_generation) VALUES($1,113520,85681,85675,85676,false,$2,$3,$4,85681)`,
    [workspace, vivaProof.proof, legacyProof.proof, revision]);
    await pool.query("CREATE TABLE ack_fixture(item_id text,dest text,status text,provider_id text,PRIMARY KEY(item_id,dest))");
    await pool.query("INSERT INTO ack_fixture VALUES($1,'first','enviado','fixture-provider'),($1,'second','aguardando',NULL)", [itemId]);
    const ackBefore = (await pool.query("SELECT * FROM ack_fixture ORDER BY dest")).rows;
    const state = async () => (await pool.query("SELECT * FROM queue_manifest_state WHERE cliente_id=$1", [workspace])).rows[0];
    const blocked = await manifest.capturarTargetCheckpoint(workspace,
      { checkpointRevision: "different-revision" }, { pool });
    assert.equal(blocked.ok, false);
    assert.equal((await state()).pending_checkpoint_revision, revision);
    const resumed = await manifest.capturarTargetCheckpoint(workspace,
      { checkpointRevision: revision, expectedTargetGeneration: 85681 },
      { pool, validarRetomadaCheckpoint: current => current.vivaFileProof.generation === 85681 });
    assert(resumed.retomado);

    worker = criarCoordenadorPersistencia({ env: { ...process.env, DATA_DIR: root,
      FILA_PERSISTENCE_WORKER: "1", FILA_PERSISTENCIA_CANARY_CLIENTES: workspace }, logger: quiet });
    const prepare = () => worker.prepare({ clienteId: workspace, checkpointRevision: revision,
      targetGeneration: 85681, dataDir: root, nowMs: now });
    const publish = prepared => worker.publish({ clienteId: workspace, checkpointRevision: revision,
      targetGeneration: 85681, dataDir: root, tempIdentity: prepared.tempIdentity,
      expectedSourceRevisions: prepared.sourceRevisions });
    let prepared = await prepare();
    assert.equal(prepared.itens, 877);
    fs.renameSync(prepared.tempPath, file("fila.json")); // interrupted after rename, before proof
    await worker.shutdown();
    worker = criarCoordenadorPersistencia({ env: { ...process.env, DATA_DIR: root,
      FILA_PERSISTENCE_WORKER: "1", FILA_PERSISTENCIA_CANARY_CLIENTES: workspace }, logger: quiet });
    prepared = await prepare();
    const published = await publish(prepared);
    assert(published.ok);
    const proof = published.legacyFileProof || published.proof;
    assert.equal(proof.contentHash, sha(fs.readFileSync(file("fila.json"))));
    const confirm = () => manifest.confirmarCheckpointDuravel(workspace,
      { targetGeneration: 85681, checkpointRevision: revision, legacyFileProof: proof },
      { pool, logger: quiet, validarCheckpointConfirmado: value =>
        value.contentHash === sha(fs.readFileSync(file("fila.json"))) });
    assert((await confirm()).ok);
    assert((await confirm()).jaConfirmado);
    assert.equal(Number((await state()).durable_checkpoint_generation), 85681);
    assert.equal((await state()).authority_ready, false);
    const readinessWithoutManifest = await manifest.prepararReadinessAutoridade(workspace, {}, { pool });
    assert.equal(readinessWithoutManifest.ready, false);
    assert.equal((await state()).authority_ready, false);
    const rebuilt = await queue.reconstruirProjecaoLeveAposCheckpoint(workspace,
      { checkpointRevision: revision, targetGeneration: 85681, agora: now,
        checkpointSnapshot: prepared.checkpointProjection },
      { ...deps, pool, validarProjecaoAposCheckpoint: async () => ({ ok: true }) });
    assert(rebuilt.ok, rebuilt.motivo);
    const projection = get("fila-projecao-leve.json");
    assert.equal(projection.itens.length, 877);
    assert.equal(projection.gcCoverage.hashes.length, 665);
    assert(projection.gcCoverage.hashes.includes(imageHash));
    let built = await index.buildOrLoadReferenceIndex({ dataDir: root, workspaceId: workspace,
      nowMs: now, maxDurationMs: 2000, logger: quiet });
    if (!built.complete || !built.refs.has(imageHash)) {
      const discovered = await index.discoverSources({ dataDir: root, workspaceId: workspace,
        nowMs: now, fsApi: fs.promises });
      const guards = ["fila.json", "fila-historico.json", "fila-projecao-leve.json",
        "fila-viva.json", "fila-gc-references.json"].map(name => ({
        name, size: fs.statSync(file(name)).size,
        mtimeMs: Math.trunc(fs.statSync(file(name)).mtimeMs)
      }));
      assert.fail(JSON.stringify({ reasonCode: built.reasonCode, discoveryError: discovered.error,
        complete: built.complete, hasReference: built.refs.has(imageHash), guards }));
    }
    const mediaDir = path.join(root, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
    fs.mkdirSync(mediaDir, { recursive: true });
    const image = path.join(mediaDir, `${imageHash}.png`);
    fs.writeFileSync(image, "fixture-only");
    fs.utimesSync(image, new Date(now - RETENTION_MS - 3600000), new Date(now - RETENTION_MS - 3600000));
    const gc = await runMediaPhysical({ dataDir: root, nowMs: now, execute: true,
      mediaDeleteEnabled: true, maxDelete: 2, maxScan: 5, logger: quiet });
    assert.equal(gc.removed, 0);
    assert(gc.referenced >= 1 && fs.existsSync(image));
    projection.gcCoverage.hashes = projection.gcCoverage.hashes.filter(hash => hash !== imageHash);
    put("fila-projecao-leve.json", projection);
    built = await index.buildOrLoadReferenceIndex({ dataDir: root, workspaceId: workspace,
      nowMs: now, maxDurationMs: 2000, logger: quiet });
    assert.equal(built.complete, false);
    // A newer live generation cannot reuse the projection of the confirmed 85681 snapshot.
    await pool.query("UPDATE queue_manifest_state SET viva_generation=85682,dirty_generation=85682,revision=revision+1 WHERE cliente_id=$1", [workspace]);
    const staleGeneration = await queue.reconstruirProjecaoLeveAposCheckpoint(workspace,
      { checkpointRevision: revision, targetGeneration: 85681, agora: now,
        checkpointSnapshot: prepared.checkpointProjection },
      { ...deps, pool, validarProjecaoAposCheckpoint: async () => ({ ok: true }) });
    assert.equal(staleGeneration.ok, false);
    assert.equal(staleGeneration.motivo, "checkpoint_projecao_autoridade_invalida");
    assert.equal(Number((await state()).viva_generation), 85682);
    assert.equal((await state()).authority_ready, false);
    for (const [name, hash] of Object.entries(protectedBytes)) assert.equal(sha(fs.readFileSync(file(name))), hash);
    assert.equal(get("fila.json").find(item => item.id === itemId).destinosEstado.second.estado, "aguardando");
    assert.deepEqual((await pool.query("SELECT * FROM ack_fixture ORDER BY dest")).rows, ackBefore);
  } finally {
    if (worker) await worker.shutdown();
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    if (path.resolve(root).startsWith(path.resolve(process.cwd()) + path.sep)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
