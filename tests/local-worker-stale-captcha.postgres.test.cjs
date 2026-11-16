"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { criarLocalWorkerRepository } = require("../modules/local-worker/local-worker.repository");

const connectionString = String(process.env.LOCAL_WORKER_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("LOCAL_WORKER_TEST_DATABASE_URL_REQUIRED");
if (process.env.DATABASE_URL) throw new Error("PRODUCTION_DATABASE_URL_FORBIDDEN");
const parsed = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("POSTGRES_URL_REQUIRED");
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error("DISPOSABLE_LOOPBACK_POSTGRES_REQUIRED");
}

const schema = `worker_stale_captcha_${randomUUID().replace(/-/g, "")}`;
const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
const pool = new Pool({
  connectionString,
  max: 4,
  connectionTimeoutMillis: 2000,
  options: `-c search_path=${schema},public`
});

async function main() {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const repo = criarLocalWorkerRepository({ pool });
  assert.equal((await repo.ensureSchema()).ok, true);

  const created = await repo.garantirTask({
    type: "identidade_oficial",
    marketplace: "mercadolivre",
    productId: "MLB7329175430",
    sourceUrl: "https://produto.mercadolivre.com.br/MLB7329175430-produto",
    capability: "ml_identity_v1",
    idempotencyKey: "fixture:stale-captcha:mlb7329175430",
    maxAttempts: 3,
    ttlMs: 10 * 60 * 1000
  });
  assert.equal(created.ok, true);
  assert.equal(created.task.status, "pending");

  const first = await repo.claim({ workerId: "worker-ml", capabilities: ["ml_identity_v1"], leaseMs: 60_000 });
  assert.equal(first.ok, true);
  assert.ok(first.task);
  const beat = await repo.heartbeat({ taskId: first.task.id, workerId: "worker-ml", leaseToken: first.task.leaseToken, leaseMs: 60_000 });
  assert.equal(beat.ok, true, "heartbeat deve manter o lease observável");

  const stale = await repo.falhar({
    taskId: first.task.id,
    workerId: "worker-ml",
    leaseToken: first.task.leaseToken,
    motivo: "ml_identity_resultado_stale_timestamp_expirado",
    metadata: { etapa: "envio_resultado", statusHttp: 422, retryable: true }
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.task.status, "pending", "stale permite nova coleta, não reenvio da coleta vencida");
  assert.equal(stale.task.resultMetadata.motivo, "ml_identity_resultado_stale_timestamp_expirado");

  const second = await repo.claim({ workerId: "worker-ml", capabilities: ["ml_identity_v1"], leaseMs: 60_000 });
  assert.equal(second.ok, true);
  assert.ok(second.task);
  const captcha = await repo.falhar({
    taskId: second.task.id,
    workerId: "worker-ml",
    leaseToken: second.task.leaseToken,
    motivo: "ml_pdp_captcha",
    metadata: { etapa: "consulta_pdp", statusHttp: 200, terminal: true, retryable: false }
  });
  assert.equal(captcha.ok, true);
  assert.equal(captcha.task.status, "failed", "CAPTCHA terminal não deve ser reenfileirado");
  assert.equal(captcha.task.resultMetadata.terminal, true);
  assert.equal(captcha.task.resultMetadata.retryable, false);

  console.log("local-worker-stale-captcha.postgres.test.cjs: ok");
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  });
