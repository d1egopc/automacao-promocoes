"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Client, Pool } = require("pg");

const { criarLocalWorkerRepository } = require("../modules/local-worker/local-worker.repository");
const { chaveIdentidadeMagalu } = require("../modules/local-worker/magalu-identity.contract");
const { acordarJobMagaluPorIdentidade } = require("../modules/engine/importer/importer.service");

const connectionString = String(process.env.MAGALU_GOLDEN_PG_URL || "").trim();
const required = process.env.MAGALU_GOLDEN_PG_REQUIRED === "1";

if (!connectionString && required) {
  throw new Error("MAGALU_GOLDEN_PG_REQUIRED=1 exige MAGALU_GOLDEN_PG_URL");
}

function assertDisposableConnection(value) {
  const parsed = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname),
    "PG17 Golden deve usar apenas loopback");
  assert.match(parsed.pathname, /fixture/i,
    "PG17 Golden deve apontar para banco descartável");
  assert.equal(String(process.env.DATABASE_URL || ""), "",
    "não herdar DATABASE_URL produtiva");
  return parsed;
}

function callbackResult({ sourceUrl, identityKey, collectedAt }) {
  const canonicalUrl = "https://www.magazinevoce.com.br/d1egopc/armario-de-cozinha-completa-300-cm-suspenso-crema-nice-madesa-06-xl/p/hafj2kk49h/mo/mcoz/";
  return {
    capability: "magalu_identity_v1",
    contractVersion: 1,
    marketplace: "magalu",
    identityKey,
    sourceUrl,
    finalUrl: canonicalUrl,
    canonicalUrl,
    observedProductId: "hafj2kk49h",
    tituloOficial: "Armário de Cozinha Completa 300 cm Suspenso Crema Nice Madesa 06 XL",
    identidadeValidada: true,
    collectedAt,
    provaTecnica: {
      capability: "magalu_identity_v1",
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.magalu_identity_v1",
      identityKey,
      observedProductId: "hafj2kk49h",
      redirected: true,
      finalUrl: canonicalUrl,
      statusHttp: 200,
      collectedAt
    }
  };
}

async function queryResult(pool, sql, params) {
  return { ok: true, resultado: await pool.query(sql, params) };
}

test("Magalu callback persistido acorda uma vez, respeita TTL e não ressuscita terminal", {
  skip: !connectionString ? "PG17 descartável não configurado localmente" : false
}, async () => {
  const parsed = assertDisposableConnection(connectionString);
  const expectedPort = Number(process.env.MAGALU_GOLDEN_PG_EXPECTED_SERVER_PORT || 0);
  const admin = new Client({ connectionString });
  let pool;
  let schema = "";

  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, parsed.pathname.slice(1));
    if (expectedPort) assert.equal(Number(identity.port), expectedPort);

    schema = `magalu_golden_${crypto.randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(__dirname, "../modules/engine/schema.sql"), "utf8"));

    pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema},public` });
    const repository = criarLocalWorkerRepository({ pool });
    assert.equal((await repository.ensureSchema()).ok, true);

    const sourceUrl = "https://magazineluiza.onelink.me/589508454/wdy9a64x";
    const identityKey = chaveIdentidadeMagalu(sourceUrl);
    assert.ok(identityKey);

    async function createJob(status = "pronto_para_importar", expiresAt = new Date(Date.now() + 300_000)) {
      const evento = (await pool.query(`INSERT INTO engine_eventos_brutos
        (origem, fonte, origem_tipo, marketplace_detectado, capturado_em, metadata)
        VALUES ('clonador_grupos','clonador_grupos','whatsapp','magalu',NOW() - INTERVAL '30 seconds','{}'::jsonb)
        RETURNING id`)).rows[0];
      const job = (await pool.query(`INSERT INTO engine_jobs_cliente
        (evento_id, cliente_id, marketplace, status, metadata)
        VALUES ($1,'user_pss60lus','magalu',$2,'{}'::jsonb) RETURNING id, evento_id`, [evento.id, status])).rows[0];
      return { ...job, expiresAt };
    }

    const primary = await createJob();
    const taskCreated = await repository.garantirTask({
      type: "identidade_oficial",
      marketplace: "magalu",
      productId: identityKey,
      sourceUrl,
      capability: "magalu_identity_v1",
      idempotencyKey: `magalu:golden:${primary.id}`,
      ttlMs: 300_000,
      vincularIdempotencia: true,
      deadline: Date.now() + 300_000
    });
    assert.equal(taskCreated.ok, true);
    const claimed = await repository.claim({ workerId: "golden-worker", capabilities: ["magalu_identity_v1"], leaseMs: 300_000 });
    assert.equal(claimed.ok, true);
    assert.ok(claimed.task);
    const collectedAt = new Date().toISOString();
    const result = callbackResult({ sourceUrl, identityKey, collectedAt });
    const completed = await repository.completarIdentidade({
      taskId: claimed.task.id,
      workerId: "golden-worker",
      leaseToken: claimed.task.leaseToken,
      resultado: result
    });
    assert.equal(completed.ok, true);
    const persisted = (await pool.query("SELECT status,result_metadata FROM local_worker_tasks WHERE id=$1", [claimed.task.id])).rows[0];
    assert.equal(persisted.status, "completed");
    assert.equal(persisted.result_metadata.identityKey, identityKey);
    assert.equal(persisted.result_metadata.identidadeValidada, true);

    const task = {
      ...completed.task,
      taskId: completed.task.id,
      jobId: String(primary.id),
      eventoId: String(primary.evento_id),
      workspaceId: "user_pss60lus",
      identityKey,
      createdAt: completed.task.createdAt,
      completedAt: completed.task.completedAt,
      expiresAt: completed.task.expiresAt
    };
    const taskExpiresAt = new Date(task.expiresAt).toISOString();
    await pool.query(`UPDATE engine_jobs_cliente SET metadata=jsonb_build_object(
      'localWorkerImageRetry', jsonb_build_object(
        'identidadeTask', jsonb_build_object(
          'taskId',$1::text,'jobId',$2::text,'eventoId',$3::text,
          'workspaceId','user_pss60lus','identityKey',$4::text,'expiresAt',$5::text)))
      WHERE id=$2`, [String(task.id), String(primary.id), String(primary.evento_id), identityKey, taskExpiresAt]);

    const first = await acordarJobMagaluPorIdentidade({
      task, resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params)
    });
    assert.equal(first.ok, true);
    assert.equal(first.acordado, true);
    const metadataAfter = (await pool.query("SELECT metadata FROM engine_jobs_cliente WHERE id=$1", [primary.id])).rows[0].metadata;
    assert.equal(metadataAfter.localWorkerImageRetry.resultadoAplicadoTaskId, String(task.id));

    const duplicate = await acordarJobMagaluPorIdentidade({
      task, resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params)
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.acordado, false);

    const race = await createJob();
    const raceTask = { ...task, jobId: String(race.id), eventoId: String(race.evento_id) };
    await pool.query(`UPDATE engine_jobs_cliente SET metadata=$1::jsonb WHERE id=$2`, [JSON.stringify({ localWorkerImageRetry: { identidadeTask: raceTask } }), race.id]);
    const concurrent = await Promise.all([
      acordarJobMagaluPorIdentidade({ task: raceTask, resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params) }),
      acordarJobMagaluPorIdentidade({ task: raceTask, resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params) })
    ]);
    assert.equal(concurrent.filter(item => item.acordado === true).length, 1);
    assert.equal(concurrent.filter(item => item.acordado === false).length, 1);

    const terminal = await createJob("oferta_criada");
    await pool.query(`UPDATE engine_jobs_cliente SET metadata=$1::jsonb WHERE id=$2`, [JSON.stringify({ localWorkerImageRetry: { identidadeTask: { ...task, jobId: String(terminal.id) } } }), terminal.id]);
    const terminalResult = await acordarJobMagaluPorIdentidade({
      task: { ...task, jobId: String(terminal.id), eventoId: String(terminal.evento_id) },
      resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params)
    });
    assert.equal(terminalResult.ok, true);
    assert.equal(terminalResult.acordado, false);

    const expired = await createJob("pronto_para_importar", new Date(Date.now() - 1_000));
    await pool.query(`UPDATE engine_jobs_cliente SET metadata=$1::jsonb WHERE id=$2`, [JSON.stringify({ localWorkerImageRetry: { identidadeTask: { ...task, jobId: String(expired.id), eventoId: String(expired.evento_id), expiresAt: expired.expiresAt.toISOString() } } }), expired.id]);
    const expiredResult = await acordarJobMagaluPorIdentidade({
      task: { ...task, jobId: String(expired.id), eventoId: String(expired.evento_id) },
      resultado: result, queryFn: (sql, params) => queryResult(pool, sql, params)
    });
    assert.equal(expiredResult.ok, true);
    assert.equal(expiredResult.acordado, false);
    assert.equal(expiredResult.motivo, "job_magalu_nao_elegivel_ou_ja_acordado");
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (schema) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
});
