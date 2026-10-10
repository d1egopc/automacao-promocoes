"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", ".local-test-tmp", `achados-outbox-${process.pid}`);
process.env.DATA_DIR = dataDir;

const { Client, Pool } = require("pg");
const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");
const { projetarIntencoesAchados } = require("../modules/clonador-grupos/service");
const { criarBridgeClonadorGrupos } = require("../modules/clonador-grupos/bridge");
const { registrarAchadoCapacidadeClonador, listarAchados } =
  require("../modules/manual-v2/ofertas-v2-achados");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_clone_outbox_${crypto.randomBytes(6).toString("hex")}`;

function criarRepo(pool, limite = 1) {
  return criarRepositorioClonadorGrupos({ pool,
    queryEngine: async (sql, params = []) => {
      try { return { ok: true, resultado: await pool.query(sql, params) }; }
      catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
    }, pushWaitLimitPerWorkspace: limite });
}

function captura(clienteId, id) {
  const url = `https://www.amazon.com.br/dp/B0${String(id).padStart(8, "0")}`;
  const titulo = `Fone Bluetooth Modelo ${id}`;
  return { clienteId, sessaoId: "session_a", grupoJid: "group_a@g.us",
    mensagemId: String(id), textoOriginal: `${titulo}\nPor R$ 99,90\n${url}`,
    links: [url], capturadoEm: new Date(Date.now() - (10 - id) * 60000),
    metadata: { achadosCapacidade: { marketplace: "amazon", titulo,
      precoAtual: 99.9, urlOriginal: url, urlAfiliada: url } } };
}

async function estado(pool, id) {
  const result = await pool.query(`SELECT status,texto_original,links,metadata
    FROM clonador_grupos_buffer WHERE id=$1`, [Number(id)]);
  return result.rows[0];
}

async function run() {
  const admin = new Client(config);
  let pool;
  let installed = false;
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
    pool = new Pool({ ...config, max: 4, options: `-c search_path=${schema},public` });
    const repo = criarRepo(pool);
    await repo.prepararSchema();

    const first = await repo.inserirBufferCaptura(captura("ws_a", 1));
    const second = await repo.inserirBufferCaptura(captura("ws_a", 2));
    assert.equal(first.inserido, true);
    assert.equal(second.inserido, true);
    const pendingA = second.itensParaAchados[0];
    const before = await estado(pool, pendingA.id);
    assert.equal(before.status, "ignorada");
    assert.equal(before.metadata.capacityDisposition.projectionStatus, "pending");
    assert.equal(before.metadata.capacityDisposition.code, "CAPACITY_DISPLACED_TO_ACHADOS");
    assert(before.texto_original.length > 0 && before.links.length === 1);
    assert.equal(listarAchados("ws_a").length, 0);

    // Crash A: only PostgreSQL committed; a fresh repository instance recovers.
    const afterRestart = criarRepo(pool, 0);
    const recoveredA = await projetarIntencoesAchados({ repository: afterRestart, limite: 1 });
    assert.equal(recoveredA.length, 1);
    assert.equal(recoveredA[0].ok, true);
    assert.equal((await estado(pool, pendingA.id)).metadata.capacityDisposition.projectionStatus,
      "MATERIALIZED");
    assert.equal(listarAchados("ws_a").length, 1);

    // Crash B: filesystem write succeeded, but acknowledgement was lost.
    const third = await repo.inserirBufferCaptura(captura("ws_a", 3));
    const pendingB = third.itensParaAchados[0];
    const afterWriteCrash = await projetarIntencoesAchados({ repository: repo,
      bufferIds: [pendingB.id], registrarAchado: input => {
        registrarAchadoCapacidadeClonador(input);
        throw new Error("fixture_crash_before_ack");
      }, logger: { warn() {} } });
    assert.equal(afterWriteCrash[0].ok, false);
    assert.equal((await estado(pool, pendingB.id)).metadata.capacityDisposition.projectionStatus,
      "PROJECTION_RETRYABLE_ERROR");
    assert.equal(listarAchados("ws_a").length, 2);
    const recoveredB = await projetarIntencoesAchados({ repository: afterRestart, limite: 1 });
    assert.equal(recoveredB[0].ok, true);
    assert.equal(listarAchados("ws_a").length, 2);
    assert.equal((await estado(pool, pendingB.id)).metadata.capacityDisposition.projectionStatus,
      "MATERIALIZED");

    // Crash C: filesystem temporarily unavailable; the durable intent remains.
    const fourth = await repo.inserirBufferCaptura(captura("ws_a", 4));
    const pendingC = fourth.itensParaAchados[0];
    const failedFs = await projetarIntencoesAchados({ repository: repo,
      bufferIds: [pendingC.id], registrarAchado: () => {
        throw new Error("fixture_filesystem_unavailable");
      }, logger: { warn() {} } });
    assert.equal(failedFs[0].ok, false);
    assert.equal((await estado(pool, pendingC.id)).metadata.capacityDisposition.projectionStatus,
      "PROJECTION_RETRYABLE_ERROR");
    const recoveredC = await projetarIntencoesAchados({ repository: afterRestart, limite: 1 });
    assert.equal(recoveredC[0].ok, true);
    assert.equal(listarAchados("ws_a").length, 3);

    // Concurrent projections for one workspace serialize the JSON read/write.
    const fifth = await repo.inserirBufferCaptura(captura("ws_a", 5));
    const sixth = await repo.inserirBufferCaptura(captura("ws_a", 6));
    const concurrent = await Promise.all([fifth, sixth].map(result =>
      projetarIntencoesAchados({ repository: afterRestart,
        bufferIds: [result.itensParaAchados[0].id] })));
    assert(concurrent.every(result => result[0].ok));
    assert.equal(listarAchados("ws_a").length, 5);

    // Same commercial/message identity in another workspace cannot cross tenants.
    await repo.inserirBufferCaptura(captura("ws_b", 1));
    await repo.inserirBufferCaptura(captura("ws_b", 2));
    const bridge = criarBridgeClonadorGrupos({ repository: {
      ...afterRestart, reivindicarProximaCaptura: async () => null
    }, logger: { warn() {}, log() {} } });
    const cycle = await bridge.processarCapturasPendentes({ limite: 1 });
    assert.equal(cycle.achadosProjection[0].ok, true);
    assert.equal(listarAchados("ws_a").length, 5);
    assert.equal(listarAchados("ws_b").length, 1);
    const pending = await repo.listarIntencoesAchadosPendentes({ limite: 5 });
    assert.deepEqual(pending, []);
    // Normal live projection, without a simulated crash.
    await repo.inserirBufferCaptura(captura("ws_live", 7));
    const liveSource = await repo.inserirBufferCaptura(captura("ws_live", 8));
    const liveId = liveSource.itensParaAchados[0].id;
    const live = await projetarIntencoesAchados({ repository: repo,
      bufferIds: [liveId] });
    assert.equal(live[0].ok, true);
    assert.equal(live[0].projectionStatus, "MATERIALIZED");
    assert.equal(listarAchados("ws_live").length, 1);
    // An intent may wait longer than the 48h Achados surface. Replay must
    // terminalize it without reporting materialization or resetting T0.
    await repo.inserirBufferCaptura(captura("ws_exp", 7));
    const expiredSource = await repo.inserirBufferCaptura(captura("ws_exp", 8));
    const expiredId = expiredSource.itensParaAchados[0].id;
    const oldT0 = new Date(Date.now() - 49 * 3600000);
    await pool.query(`UPDATE clonador_grupos_buffer SET capturado_em=$2
      WHERE id=$1`, [expiredId, oldT0]);
    const expired = await projetarIntencoesAchados({ repository: afterRestart,
      bufferIds: [expiredId] });
    assert.equal(expired[0].ok, false);
    assert.equal(expired[0].projectionStatus, "EXPIRED_BEFORE_ACHADOS_PROJECTION");
    assert.equal(listarAchados("ws_exp").length, 0);
    assert.equal((await estado(pool, expiredId)).metadata.capacityDisposition.projectionStatus,
      "EXPIRED_BEFORE_ACHADOS_PROJECTION");
    const expiredReplay = await projetarIntencoesAchados({ repository: afterRestart,
      bufferIds: [expiredId] });
    assert.equal(expiredReplay[0].ok, false);
    assert.equal(expiredReplay[0].projectionStatus,
      "EXPIRED_BEFORE_ACHADOS_PROJECTION");
    assert.deepEqual(await repo.listarIntencoesAchadosPendentes({ limite: 5 }), []);

    // INVALID_TECHNICAL is terminal, but remains auditable until retention.
    await repo.inserirBufferCaptura(captura("ws_rejected", 7));
    const rejectedSource = await repo.inserirBufferCaptura(captura("ws_rejected", 8));
    const rejectedId = rejectedSource.itensParaAchados[0].id;
    const rejected = await projetarIntencoesAchados({ repository: repo,
      bufferIds: [rejectedId], registrarAchado: () => ({
        ok: false, motivo: "INVALID_TECHNICAL"
      }) });
    assert.equal(rejected[0].ok, false);
    assert.equal(rejected[0].projectionStatus, "rejected");
    assert.equal((await repo.limparIntencoesAchadosTerminais({ limite: 5 })).removidas, 0);
    assert.equal((await estado(pool, rejectedId)).metadata.capacityDisposition.projectionStatus,
      "rejected");

    // Cleanup is bounded and indexed; pending/retryable intents remain untouched.
    await repo.inserirBufferCaptura(captura("ws_pending", 7));
    const pendingSource = await repo.inserirBufferCaptura(captura("ws_pending", 8));
    const pendingId = pendingSource.itensParaAchados[0].id;
    await repo.inserirBufferCaptura(captura("ws_retryable", 7));
    const retryableSource = await repo.inserirBufferCaptura(captura("ws_retryable", 8));
    const retryableId = retryableSource.itensParaAchados[0].id;
    const retryable = await projetarIntencoesAchados({ repository: repo,
      bufferIds: [retryableId], registrarAchado: () => {
        throw new Error("fixture_retryable_cleanup_guard");
      }, logger: { warn() {} } });
    assert.equal(retryable[0].projectionStatus, "PROJECTION_RETRYABLE_ERROR");
    await pool.query(`UPDATE clonador_grupos_buffer
      SET updated_at=NOW()-INTERVAL '8 days'
      WHERE id=ANY($1::bigint[])`, [[expiredId, liveId, rejectedId, pendingId, retryableId]]);
    const cleanup = await repo.limparIntencoesAchadosTerminais({ limite: 3 });
    assert.equal(cleanup.removidas, 3);
    assert.equal(await estado(pool, expiredId), undefined);
    assert.equal(await estado(pool, liveId), undefined);
    assert.equal(await estado(pool, rejectedId), undefined);
    assert.equal((await estado(pool, pendingId)).metadata.capacityDisposition.projectionStatus,
      "pending");
    assert.equal((await estado(pool, retryableId)).metadata.capacityDisposition.projectionStatus,
      "PROJECTION_RETRYABLE_ERROR");
    const hot = (await pool.query(`SELECT cliente_id,count(*)::int AS n
      FROM clonador_grupos_buffer WHERE status='capturada'
      GROUP BY cliente_id ORDER BY cliente_id`)).rows;
    assert.deepEqual(hot, [{ cliente_id: "ws_a", n: 1 }, { cliente_id: "ws_b", n: 1 },
      { cliente_id: "ws_exp", n: 1 }, { cliente_id: "ws_live", n: 1 },
      { cliente_id: "ws_pending", n: 1 },
      { cliente_id: "ws_rejected", n: 1 }, { cliente_id: "ws_retryable", n: 1 }]);
    const index = (await pool.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname=current_schema() AND tablename='clonador_grupos_buffer'
        AND indexname IN ('idx_clonador_achados_projection_retryable',
          'idx_clonador_achados_projection_terminal_cleanup')`)).rows;
    assert.equal(index.length, 2);
    const terminalIndex = (await pool.query(`SELECT indexdef FROM pg_indexes
      WHERE schemaname=current_schema() AND tablename='clonador_grupos_buffer'
        AND indexname='idx_clonador_achados_projection_terminal_cleanup'`)).rows[0].indexdef;
    assert(terminalIndex.includes("MATERIALIZED"));
    assert(terminalIndex.includes("EXPIRED_BEFORE_ACHADOS_PROJECTION"));
    assert(terminalIndex.includes("rejected"));
    assert(!terminalIndex.includes("PROJECTION_RETRYABLE_ERROR"));

    console.log(JSON.stringify({ candidate: "clonador_achados_outbox",
      intentAtomicWithCapacityDecision: true, crashAfterCommitRecovers: true,
      crashAfterWriteNoDuplicate: true, filesystemFailureRetryable: true,
      achadosDuplicates: 0, workspaceIsolated: true, concurrentProjectionSafe: true,
      hotNotIncreased: true, pendingFinal: pending.length,
      falseProjectionSuccess: 0, expiredProjection: 0, terminalCleanupBounded: true,
      rejectedIsTerminal: true, rejectedTerminalCleanup: true,
      materializedCleanupPreserved: true, expiredCleanupPreserved: true,
      pendingCleanupWrong: 0, retryableCleanupWrong: 0, globalScanCreated: false }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
