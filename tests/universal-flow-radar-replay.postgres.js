"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { persistirCapturaComIntencoes, promoverProximaIntencao } =
  require("../modules/engine/radar-replay.candidate");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_radar_replay_${crypto.randomBytes(6).toString("hex")}`;
const root = path.join(__dirname, "..");

async function run() {
  const db = new Client(config);
  let installed = false;
  try {
    await db.connect();
    const identity = (await db.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await db.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql", "radar-replay.candidate.sql"]) {
      await db.query(fs.readFileSync(path.join(root, "modules", "engine", file), "utf8"));
    }
    await db.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,1,0,'HEALTHY',now(),interval '5 minutes')`);
    const now = Date.now();
    const capture = (hashEvento, clientes, ageMinutes = 1) => ({ hashEvento, clientes,
      capturadoEm: new Date(now - ageMinutes * 60000).toISOString(),
      textoOriginal: `fixture ${hashEvento}`,
      linksExtraidos: ["https://example.test/product"],
      validarWorkspace: id => /^ws_[a-z]+$/.test(id) });
    const counts = async hash => (await db.query(`SELECT
      (SELECT count(*)::int FROM engine_eventos_brutos WHERE hash_evento=$1) AS events,
      (SELECT count(*)::int FROM engine_radar_replay_intents_candidate i
        JOIN engine_eventos_brutos e ON e.id=i.evento_id WHERE e.hash_evento=$1) AS intents`,
    [hash])).rows[0];
    const fail = async () => { throw new Error("simulated_crash"); };
    await assert.rejects(persistirCapturaComIntencoes(db,
      capture("unverified", ["admin"])), /radar_intent_workspace_unverified/);

    await assert.rejects(persistirCapturaComIntencoes(db, capture("crash_A", ["ws_a"]),
      { afterEvent: fail }), /simulated_crash/);
    assert.deepEqual(await counts("crash_A"), { events: 0, intents: 0 });
    await assert.rejects(persistirCapturaComIntencoes(db, capture("crash_B", ["ws_a"]),
      { afterIntent: fail }), /simulated_crash/);
    assert.deepEqual(await counts("crash_B"), { events: 0, intents: 0 });

    const accepted = await persistirCapturaComIntencoes(db,
      capture("accepted", ["ws_a", "ws_b"]));
    assert.equal(accepted.intencoesNovas, 2);
    const first = await promoverProximaIntencao(db, { agoraMs: now });
    assert.equal(first.estado, "criada");
    assert.equal(first.clienteId, "ws_a");
    assert.equal((await promoverProximaIntencao(db, { agoraMs: now })).estado,
      "admission_negada");
    assert.equal((await db.query(`SELECT status FROM engine_radar_replay_intents_candidate
      WHERE evento_id=$1 AND cliente_id='ws_b'`, [accepted.eventoId])).rows[0].status,
      "pendente");
    const deniedOriginal = (await db.query(`SELECT capturado_em FROM engine_eventos_brutos
      WHERE id=$1`, [accepted.eventoId])).rows[0].capturado_em.toISOString();
    const duplicate = await persistirCapturaComIntencoes(db,
      capture("accepted", ["ws_c"], 0));
    assert.equal(duplicate.eventoId, accepted.eventoId);
    assert.equal(duplicate.novoEvento, false);
    assert.equal((await db.query(`SELECT capturado_em FROM engine_eventos_brutos
      WHERE id=$1`, [accepted.eventoId])).rows[0].capturado_em.toISOString(),
      deniedOriginal);

    // Crash D inside the replay transaction rolls the new job back while
    // preserving the committed intent. A separately committed job with a
    // pending intent is also recognized and completed by replay.
    await db.query(`UPDATE engine_jobs_cliente SET status='expirada_operacional'
      WHERE id=$1`, [first.jobId]);
    await assert.rejects(promoverProximaIntencao(db,
      { agoraMs: now, hooks: { afterJob: fail } }), /simulated_crash/);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE evento_id=$1 AND cliente_id='ws_b'`, [accepted.eventoId])).rows[0].n, 0);
    const second = await promoverProximaIntencao(db, { agoraMs: now });
    assert.equal(second.estado, "criada");
    await db.query(`UPDATE engine_jobs_cliente SET status='expirada_operacional'
      WHERE id=$1`, [second.jobId]);
    const insertedOutside = await db.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status) VALUES ($1,'ws_c','pendente') RETURNING id`,
    [accepted.eventoId]);
    const recovered = await promoverProximaIntencao(db, { agoraMs: now });
    assert.equal(recovered.estado, "existente");
    assert.equal(recovered.jobId, insertedOutside.rows[0].id);
    for (let i = 0; i < 10; i++) {
      assert.equal((await promoverProximaIntencao(db, { agoraMs: now })).estado,
        "vazio");
    }
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE evento_id=$1 AND cliente_id='ws_c'`, [accepted.eventoId])).rows[0].n, 1);

    const expired = await persistirCapturaComIntencoes(db,
      capture("expired", ["ws_expired"], 100));
    const expiry = await promoverProximaIntencao(db, { agoraMs: now });
    assert.equal(expiry.estado, "expirada");
    assert.equal(expiry.eventoId, expired.eventoId);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE evento_id=$1`, [expired.eventoId])).rows[0].n, 0);
    const pending = await persistirCapturaComIntencoes(db,
      capture("pending_gc", ["ws_pending"]));
    await assert.rejects(db.query(`DELETE FROM engine_eventos_brutos WHERE id=$1`,
      [pending.eventoId]), /UF_RADAR_INTENT_PENDING_GC/);
    assert.equal((await counts("pending_gc")).intents, 1);
    const protectedCount = (await db.query(`SELECT count(*)::int AS n
      FROM engine_eventos_brutos e
      WHERE e.id=$1 AND NOT EXISTS (SELECT 1
        FROM engine_radar_replay_intents_candidate i
        WHERE i.evento_id=e.id AND i.status='pendente')`,
    [pending.eventoId])).rows[0].n;
    assert.equal(protectedCount, 0);
    const hot = (await db.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used;
    assert.equal(hot, 1);
    console.log(JSON.stringify({ candidate: "radar_replay_durable_fixture",
      crashAEventAndIntentRolledBack: true, crashBEventAndIntentRolledBack: true,
      admissionDeniedIntentPending: true, crashDAfterJobRolledBack: true,
      committedJobBeforeMarkerRecovered: true, tenReplaysOneJob: true,
      originalCaptureImmutable: true, expiredWithoutJob: true,
      pendingEventGcBlocked: true, hotUsed: hot }));
  } finally {
    if (installed) await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
