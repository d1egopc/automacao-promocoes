"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { projectionDdl } = require("../modules/engine/lifecycle-steady.candidate");
const { criarBootstrapLocalCandidato } =
  require("../modules/engine/universal-flow-local-bootstrap.candidate");
const { criarRepositorioClonadorGrupos } =
  require("../modules/clonador-grupos/repository");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_boot_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const admin = new Client(config);
  let lifecyclePool, commercialPool, clonePool, bootstrap, installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules",
        "engine", file), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_max_staleness)
      VALUES (1,25,0,'UNKNOWN',interval '1 minute')`);
    const opts = { ...config, options: `-c search_path=${schema},public` };
    lifecyclePool = new Pool({ ...opts, max: 1 });
    commercialPool = new Pool({ ...opts, max: 1 });
    clonePool = new Pool({ ...opts, max: 2 });
    const repo = criarRepositorioClonadorGrupos({ pool: clonePool,
      queryEngine: async (sql, params = []) => ({ ok: true,
        resultado: await clonePool.query(sql, params) }),
      pushWaitLimitPerWorkspace: 2 });
    await repo.prepararSchema();
    const capture = (id, minutes) => ({ clienteId: "ws_clone",
      sessaoId: "session", grupoJid: "group", mensagemId: id,
      textoOriginal: `offer ${id}`, links: [`https://example.invalid/${id}`],
      capturadoEm: new Date(Date.now() - minutes * 60000), metadata: {} });
    await repo.inserirBufferCaptura(capture("first", 20));
    await repo.inserirBufferCaptura(capture("second", 5));
    assert.equal((await admin.query(`SELECT health FROM engine_hot_admission_control`))
      .rows[0].health, "UNKNOWN");
    let replayCalls = 0, cloneCalls = 0;
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool,
      lifecycleLimit: 4, lifecycleIntervalMs: 300000,
      replayIntervalMs: 300000, cloneIntervalMs: 300000,
      persistWatchdog: async snapshot => {
        await admin.query(`UPDATE engine_hot_admission_control
          SET health=$1,lifecycle_last_success=$2 WHERE id=1`, [
          snapshot.lastSuccess ? "HEALTHY" : "UNKNOWN",
          snapshot.lastSuccess ? new Date(snapshot.lastSuccess) : null]);
      },
      runRadarReplay: async () => { replayCalls++; return { estado: "vazio" }; },
      runClonePass: async () => { cloneCalls++;
        return repo.expirarEsperaVencida({ limite: 2,
          agoraMs: Date.now() + 11 * 60000 }); }
    });
    // A busy commercial connection cannot starve the separately reserved lane.
    const commercial = await commercialPool.connect();
    await commercial.query("BEGIN");
    const started = await bootstrap.start();
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(bootstrap.lifecycleState(60000).health, "HEALTHY");
    assert.equal((await admin.query(`SELECT health FROM engine_hot_admission_control`))
      .rows[0].health, "HEALTHY");
    assert.equal(replayCalls, 1);
    assert.equal(cloneCalls, 1);
    assert.equal(started.clone.expiradas, 1);
    const cloneRows = (await admin.query(`SELECT mensagem_id,status
      FROM clonador_grupos_buffer ORDER BY mensagem_id`)).rows;
    assert.equal(cloneRows.find(row => row.mensagem_id === "first").status,
      "ignorada");
    assert.equal(cloneRows.find(row => row.mensagem_id === "second").status,
      "capturada");
    await commercial.query(`SELECT pg_advisory_xact_lock(
      hashtext('engine'),hashtext('steady_lifecycle'))`);
    const competing = await bootstrap.lifecycleTick();
    assert.equal(competing.skipped, true);
    assert.equal(bootstrap.lifecycleState(60000).health, "HEALTHY");
    await commercial.query("ROLLBACK");
    commercial.release();
    const event = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      VALUES ('radar','radar','whatsapp',now()) RETURNING id`)).rows[0].id;
    await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status)
      SELECT $1,'ws_fresh_'||g,'pendente'
      FROM generate_series(1,25) AS g`, [event]);
    const fresh = (await admin.query(`SELECT count(*)::int AS n FROM
      engine_jobs_cliente WHERE status='pendente'`)).rows[0].n;
    assert.equal(fresh, 25);
    // Historical terminal facts are excluded from the steady due index.
    const old = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      VALUES ('radar','radar','whatsapp',now()-interval '1 day')
      RETURNING id`)).rows[0].id;
    await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status)
      SELECT $1,'ws_legacy_'||g,'expirada_operacional'
      FROM generate_series(1,100000) AS g`, [old]);
    const bounded = await bootstrap.lifecycleTick();
    assert.equal(bounded.ok, true, JSON.stringify(bounded));
    assert.equal(bounded.selected, 0);
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`))
      .rows[0].hot_used, 25);
    console.log(JSON.stringify({ candidate: "local_bootstrap_reserved",
      startupUnknownThenHealthy: true, commercialConnectionBusy: true,
      lifecycleRanIndependently: true, cloneExpiryWithoutNewCapture: true,
      leasePreventsOverlappingInstance: true,
      replayOnStartup: replayCalls, freshJobs: fresh,
      historicalTerminalRows: 100000, lifecycleSelectedWithLegacy: bounded.selected,
      legacyDrainIntegrated: false, productionBootstrapChanged: false }));
  } finally {
    bootstrap?.stop();
    await lifecyclePool?.end().catch(() => {});
    await commercialPool?.end().catch(() => {});
    await clonePool?.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
