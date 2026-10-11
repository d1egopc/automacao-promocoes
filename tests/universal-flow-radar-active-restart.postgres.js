"use strict";

// Disposable PostgreSQL and child-process restart. The real Engine inbox and
// job writer are used; workspace/image inputs are fixture-controlled.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client, Pool } = require("pg");
const { projectionDdl } = require("../modules/engine/lifecycle-steady.candidate");
const { criarBootstrapLocalCandidato } =
  require("../modules/engine/universal-flow-local-bootstrap.candidate");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const root = path.join(__dirname, "..");
const schema = process.argv[3] || `uf_radar_active_${crypto.randomBytes(6).toString("hex")}`;

function configureFixtureRuntime() {
  process.env.PGSSLMODE = "disable";
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:55433/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
  const workspace = require("../modules/workspace");
  workspace.avaliarWorkspaceParaEngine = id => ({ elegivelEngine: /^ws_[a-z]+$/.test(id) });
  const images = require("../modules/imagens/cache-canonico-evento");
  images.resolverImagemCanonicaEvento = async () => ({
    imagemStatus: "nao_resolvida", imagemEnviavel: false });
}

const input = (hash, ageMinutes) => ({ origem: "radar", fonte: "radar",
  origemTipo: "whatsapp", sessaoId: "fixture_session", grupoId: "fixture_group",
  textoOriginal: `fixture ${hash}`,
  linksExtraidos: ["https://example.invalid/item"], hashEvento: hash,
  capturadoEm: new Date(Date.now() - ageMinutes * 60000).toISOString(),
  metadata: { fixture: true, unicode: `Caf\u00e9 \ud83d\ude80 ${String.fromCharCode(0xDC00)}` } });

async function crashChild() {
  configureFixtureRuntime();
  const { getEnginePool } = require("../modules/engine/database");
  const pool = getEnginePool();
  const originalConnect = pool.connect.bind(pool);
  let calls = 0;
  pool.connect = async () => {
    calls += 1;
    // The first client commits event+links+intent. Exit before admission.
    if (calls === 2) process.exit(77);
    return originalConnect();
  };
  const { registrarEventoBruto } = require("../modules/engine/inbox.service");
  await registrarEventoBruto(input("active_crash", 5), {
    clientes: ["ws_alpha"], radarReplayCandidate: true,
    validarWorkspaceRadarCandidate: id => id === "ws_alpha"
  });
  process.exit(78);
}

async function run() {
  const admin = new Client(config);
  let installed = false;
  let pool, lifecyclePool, bootstrap;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql",
      "radar-replay.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
        file), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,1,0,'UNKNOWN',NULL,interval '5 minutes')`);
    const child = spawnSync(process.execPath, [__filename, "--crash", schema], {
      env: { ...process.env }, encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 77, `child=${child.status} ${child.stderr}`);
    const durable = (await admin.query(`SELECT e.id,e.capturado_em,e.metadata,
      (SELECT count(*)::int FROM engine_links l WHERE l.evento_id=e.id) AS links,
      (SELECT count(*)::int FROM engine_radar_replay_intents_candidate i
        WHERE i.evento_id=e.id AND i.status='pendente') AS intents,
      (SELECT count(*)::int FROM engine_jobs_cliente j
        WHERE j.evento_id=e.id) AS jobs
      FROM engine_eventos_brutos e WHERE e.hash_evento='active_crash'`)).rows[0];
    assert(durable);
    assert.deepEqual([durable.links,durable.intents,durable.jobs], [1,1,0]);
    assert.equal(durable.metadata.unicode, "Caf\u00e9 \ud83d\ude80 \uFFFD");

    configureFixtureRuntime();
    const { getEnginePool } = require("../modules/engine/database");
    const { criarJobsParaClientes } = require("../modules/engine/jobs.service");
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    const { promoverProximaIntencao } = require("../modules/engine/radar-replay.candidate");
    pool = getEnginePool();
    const replay = async (eventoId, agoraMs = Date.now()) => {
      const worker = await pool.connect();
      try {
        return await promoverProximaIntencao(worker, {
          eventoId, agoraMs,
          criarJob: intent => criarJobsParaClientes({
            eventoId: intent.evento_id, clientes: [intent.cliente_id],
            marketplaceDetectado: intent.marketplace_detectado,
            linksExtraidos: intent.links_extraidos,
            metadataEvento: intent.metadata
          })
        });
      } finally { worker.release(); }
    };
    lifecyclePool = new Pool({ ...config, max: 1,
      options: `-c search_path=${schema},public` });
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool,
      lifecycleLimit: 4, lifecycleIntervalMs: 300000,
      replayIntervalMs: 300000, cloneIntervalMs: 300000,
      persistWatchdog: async snapshot => {
        await admin.query(`UPDATE engine_hot_admission_control
          SET health=$1,lifecycle_last_success=$2 WHERE id=1`, [
          snapshot.lastSuccess ? "HEALTHY" : "UNKNOWN",
          snapshot.lastSuccess ? new Date(snapshot.lastSuccess) : null]);
      },
      runRadarReplay: () => replay(durable.id)
    });
    const started = await bootstrap.start();
    assert.equal(started.ok, true, JSON.stringify(started));
    const recovered = started.replay;
    assert.equal(recovered.estado, "criada", JSON.stringify(recovered));
    for (let i = 0; i < 10; i++) {
      assert.equal((await replay(durable.id)).estado, "vazio");
    }
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_jobs_cliente WHERE evento_id=$1`, [durable.id])).rows[0].n, 1);
    const originalClock = new Date(durable.capturado_em).toISOString();
    const duplicate = await registrarEventoBruto({ ...input("active_crash", 0),
      capturadoEm: new Date().toISOString() }, {
      clientes: ["ws_alpha"], radarReplayCandidate: true,
      validarWorkspaceRadarCandidate: id => id === "ws_alpha"
    });
    assert.equal(duplicate.id, durable.id);
    assert.equal(duplicate.jobsExistentes, 0);
    assert.equal((await admin.query(`SELECT capturado_em FROM engine_eventos_brutos
      WHERE id=$1`, [durable.id])).rows[0].capturado_em.toISOString(), originalClock);
    const crossBucket = await registrarEventoBruto({ ...input("active_crash", 0),
      hashEvento: "different_capture_bucket" }, {
      clientes: ["ws_alpha"], radarReplayCandidate: true,
      validarWorkspaceRadarCandidate: id => id === "ws_alpha"
    });
    assert.equal(crossBucket.id, durable.id);
    assert.equal(crossBucket.duplicado, true);

    const denied = await registrarEventoBruto(input("active_denied", 29), {
      clientes: ["ws_beta"], radarReplayCandidate: true,
      validarWorkspaceRadarCandidate: id => id === "ws_beta"
    });
    assert.equal(denied.motivo, "hot_admission_denied", JSON.stringify(denied));
    const deniedRow = (await admin.query(`SELECT e.id,i.status
      FROM engine_eventos_brutos e JOIN engine_radar_replay_intents_candidate i
        ON i.evento_id=e.id WHERE e.hash_evento='active_denied'`)).rows[0];
    assert.equal(deniedRow.status, "pendente");
    const expired = await replay(deniedRow.id, Date.now() + 5 * 60000);
    assert.equal(expired.estado, "expirada");
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE evento_id=$1`, [deniedRow.id])).rows[0].n, 0);
    console.log(JSON.stringify({ candidate: "radar_active_restart",
      childCrashAfterDurableCommit: true, linksDurable: durable.links,
      pendingIntentsAfterCrash: durable.intents, jobsAfterCrash: durable.jobs,
      recoveredJob: true, recoveredByBootstrap: true, tenReplaysOneJob: true,
      originalCaptureUnchanged: true, contentDedupePreserved: true,
      denialPending: true,
      age29Plus5ExpiredWithoutJob: true }));
  } finally {
    bootstrap?.stop();
    if (lifecyclePool) await lifecyclePool.end().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

if (process.argv[2] === "--crash") {
  crashChild().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
