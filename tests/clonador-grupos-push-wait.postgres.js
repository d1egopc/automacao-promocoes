"use strict";

// Opt-in candidate against an isolated schema in the disposable local database.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_clone_wait_${crypto.randomBytes(6).toString("hex")}`;

function capture(id, workspace = "ws_a", source = "group_a",
  capturedAt = new Date(Date.now() - 20 * 60 * 1000 + Number(id) * 1000)) {
  return { clienteId: workspace, sessaoId: "session_a", grupoJid: source,
    grupoNome: source, mensagemId: String(id), textoOriginal: `Oferta ${id}`,
    links: [`https://example.invalid/${id}`], capturadoEm: capturedAt,
    metadata: { fixture: true } };
}

async function run() {
  const admin = new Client(config);
  let pool;
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());

    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    pool = new Pool({ ...config, max: 8, options: `-c search_path=${schema},public` });
    const repo = criarRepositorioClonadorGrupos({
      pool,
      queryEngine: async (sql, params = []) => {
        try { return { ok: true, resultado: await pool.query(sql, params) }; }
        catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
      },
      pushWaitLimitPerWorkspace: 4
    });
    await repo.prepararSchema();

    for (let id = 1; id <= 4; id++) {
      const result = await repo.inserirBufferCaptura(capture(id, "ws_a", id === 4 ? "group_b" : "group_a"));
      assert.equal(result.inserido, true);
    }
    assert.equal((await repo.inserirBufferCaptura(capture(1))).inserido, false);
    const fifth = await repo.inserirBufferCaptura(capture(5, "ws_a", "group_b"));
    assert.equal(fifth.inserido, true);
    const afterOverflow = await pool.query(`SELECT mensagem_id,status,texto_original,links,
      metadata FROM clonador_grupos_buffer WHERE cliente_id='ws_a' ORDER BY id`);
    assert.equal(afterOverflow.rows.filter(row => row.status === "capturada").length, 4);
    const evicted = afterOverflow.rows.filter(row => row.status === "ignorada");
    assert.equal(evicted.length, 1);
    assert.equal(evicted[0].mensagem_id, "1");
    assert.equal(evicted[0].texto_original, "Oferta 1");
    assert.equal(evicted[0].links.length, 1);
    assert.equal(evicted[0].metadata.capacityDisposition.code, "CAPACITY_DISPLACED_TO_ACHADOS");

    const old = await repo.inserirBufferCaptura(capture(6, "ws_a", "group_a",
      new Date(Date.now() - 31 * 60 * 1000)));
    assert.equal(old.ignorado, true);
    assert.equal(old.item.status, "ignorada");
    assert.equal(old.item.textoOriginal, "");
    const delayed = await repo.inserirBufferCaptura(capture(8, "ws_a", "group_a",
      new Date(Date.now() - 25 * 60 * 1000)));
    assert.equal(delayed.ignorado, true);
    assert.equal(delayed.motivo, "CAPACITY_NEW_ITEM_TO_ACHADOS");
    assert.equal(delayed.item.textoOriginal, "Oferta 8");
    const afterDelayed = (await pool.query(`SELECT mensagem_id,status FROM clonador_grupos_buffer
      WHERE cliente_id='ws_a' AND status='capturada' ORDER BY id`)).rows;
    assert.equal(afterDelayed.length, 4);
    assert(!afterDelayed.some(row => row.mensagem_id === "8"));
    const otherWorkspace = await repo.inserirBufferCaptura(capture(7, "ws_b"));
    assert.equal(otherWorkspace.inserido, true);

    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      repo.inserirBufferCaptura(capture(100 + i, "ws_a", i % 2 ? "group_b" : "group_a"))));
    assert(concurrent.every(item => item.inserido));
    const counts = (await pool.query(`SELECT cliente_id,
      count(*) FILTER (WHERE status='capturada')::int AS waiting,
      count(*) FILTER (WHERE status='ignorada')::int AS not_admitted
      FROM clonador_grupos_buffer GROUP BY cliente_id ORDER BY cliente_id`)).rows;
    assert.equal(counts.find(row => row.cliente_id === "ws_a").waiting, 4);
    assert.equal(counts.find(row => row.cliente_id === "ws_b").waiting, 1);
    const turboExpired = await repo.inserirBufferCaptura({ ...capture(201, "ws_b"),
      capturadoEm: new Date(Date.now() - 15 * 60 * 1000),
      metadata: { cupomTurbo: true } });
    assert.equal(turboExpired.ignorado, true);
    assert.equal(turboExpired.motivo, "EXPIRED_BEFORE_ADMISSION");
    const manualOutside = await repo.inserirBufferCaptura({ ...capture(202, "ws_b"),
      metadata: { manualV2: true } });
    assert.equal(manualOutside.ignorado, true);
    assert.equal(manualOutside.motivo, "manual_v2_fora_buffer_automatico");
    await pool.query(`UPDATE clonador_grupos_buffer
      SET metadata='{"cupomTurbo":true}'::jsonb,
          capturado_em=NOW()-interval '15 minutes'
      WHERE cliente_id='ws_b' AND status='capturada'`);
    const afterTurboSweep = await repo.inserirBufferCaptura(capture(203, "ws_b"));
    assert.equal(afterTurboSweep.inserido, true);
    const wsB = (await pool.query(`SELECT mensagem_id,status FROM clonador_grupos_buffer
      WHERE cliente_id='ws_b' ORDER BY id`)).rows;
    assert.equal(wsB.find(row => row.mensagem_id === "7").status, "ignorada");
    assert.equal(wsB.find(row => row.mensagem_id === "203").status, "capturada");
    const testedLimits = [1, 2, 4, 8];
    for (const limit of [1, 2, 8]) {
      const scoped = criarRepositorioClonadorGrupos({
        pool,
        queryEngine: async (sql, params = []) => {
          try { return { ok: true, resultado: await pool.query(sql, params) }; }
          catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
        },
        pushWaitLimitPerWorkspace: limit
      });
      await scoped.prepararSchema();
      const workspace = `ws_limit_${limit}`;
      for (let i = 0; i < limit * 2; i++) {
        await scoped.inserirBufferCaptura(capture(300 + i, workspace,
          i % 2 ? "group_b" : "group_a"));
      }
      const count = (await pool.query(`SELECT count(*)::int AS n
        FROM clonador_grupos_buffer WHERE cliente_id=$1 AND status='capturada'`,
      [workspace])).rows[0].n;
      assert.equal(count, limit);
    }
    const clockBefore = Date.now();
    assert.equal((await repo.inserirBufferCaptura(capture(401, "ws_expiry", "group_a",
      new Date(clockBefore - 20 * 60 * 1000)))).inserido, true);
    assert.equal((await repo.inserirBufferCaptura({ ...capture(402, "ws_expiry", "group_a",
      new Date(clockBefore - 5 * 60 * 1000)), metadata: { cupomTurbo: true } })).inserido, true);
    const independentExpiry = await repo.expirarEsperaVencida({
      limite: 2, agoraMs: clockBefore + 11 * 60 * 1000
    });
    assert.equal(independentExpiry.expiradas, 2);
    const expiredRows = (await pool.query(`SELECT mensagem_id,status,texto_original,links,
      capturado_em,metadata FROM clonador_grupos_buffer
      WHERE cliente_id='ws_expiry' ORDER BY mensagem_id`)).rows;
    assert(expiredRows.every(row => row.status === "ignorada" && row.texto_original === ""));
    assert(expiredRows.every(row => row.links.length === 0));
    assert.equal(new Date(expiredRows[0].capturado_em).getTime(), clockBefore - 20 * 60 * 1000);
    assert.equal(expiredRows[1].metadata.admissionWait.tipoFluxo, "cupom_turbo");
    const indexNames = (await pool.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname=current_schema() AND tablename='clonador_grupos_buffer'`))
      .rows.map(row => row.indexname);
    assert(indexNames.includes("idx_clonador_push_wait_age_candidate"));
    assert(indexNames.includes("idx_clonador_push_wait_turbo_age_candidate"));
    console.log(JSON.stringify({ candidate: "clone_bounded_capture_opt_in",
      maxWaitingPerWorkspace: 4, counts, duplicateAdmitted: false,
      expiredCompactFact: true, overloadCompactFact: true, concurrentCaptures: 8,
      turboExpiredBeforeInsert: true, manualV2OutsideAutomaticBuffer: true,
      storedTurboExpiredOnNextCapture: true, independentExpiry: true,
      independentExpiryCount: independentExpiry.expiradas, testedLimits }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
