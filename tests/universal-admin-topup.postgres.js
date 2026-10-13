"use strict";

// Disposable PostgreSQL 17 only. This test never accepts DATABASE_URL and
// never connects to a production database.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const credits = require("../modules/engine/universal-credits.repository");
const queue = require("../modules/engine/universal-queue.repository");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `admin_topup_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-13T12:00:00.000Z";
const sourceHash = crypto.createHash("sha256")
  .update("admin-topup-fixture").digest("hex");

async function createOffer(client, workspace, suffix) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata)
    VALUES ('radar','radar',$1,'{}'::jsonb) RETURNING id`,
  ["2026-10-13T12:05:00.000Z"])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada') RETURNING id`,
  [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { offerId, jobId, suffix };
}

async function createAmbiguousTarget(admin, pool, workspace, suffix) {
  const source = await createOffer(admin, workspace, suffix);
  const destinationId = `telegram_${suffix}`;
  const targetKey = `grupo_${suffix}`;
  const enqueued = await queue.enqueue({ pool, workspaceId: workspace,
    jobId: source.jobId, ofertaId: source.offerId,
    itemPayload: { title: "Topup fixture" },
    destinations: [{ destinationId, targetKey, channel: "telegram" }] });
  assert.equal((await queue.preflightWorkspace({ pool, workspaceId: workspace })).ok,
    true);
  const claim = await queue.claimDestination({ pool, workspaceId: workspace });
  assert.equal(claim.ok, true);
  assert.equal((await queue.markSendStarted({ pool,
    destinationId: claim.id, leaseToken: claim.leaseToken })).ok, true);
  await admin.query(`UPDATE engine_universal_queue_destinations
    SET status='ambiguous',revision=revision+1,updated_at=clock_timestamp()
    WHERE id=$1`, [claim.id]);
  return { ...claim, queueItemId: enqueued.itemId, targetKey };
}

async function insertAck(admin, claim) {
  const attemptId = crypto.randomUUID();
  const providerMessageId = `provider_${claim.id}`;
  await admin.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id, `universal_${claim.queueItemId}`,
    `telegram:${claim.destination_id}`, claim.targetKey,
    attemptId, providerMessageId]);
  return { attemptId, providerMessageId };
}

async function main() {
  const admin = new Client(config);
  let pool;
  let created = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir,
      current_setting('server_version') AS version`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.match(identity.version, /^17\./);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());

    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    await prepararModoOperacionalReal({ pool: admin });
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    pool = new Pool({ ...config, max: 8,
      options: `-c search_path=${schema},public` });
    await credits.openBalance({ pool, workspaceId: "ws_topup",
      operationEpochStartedAt: epoch, openingBalance: 1, sourceHash });
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    const ambiguous = await createAmbiguousTarget(admin, pool, "ws_topup", "a");
    const before = await credits.readBalance({ pool, workspaceId: "ws_topup" });
    assert.deepEqual({ balance: before.balance, reserved: before.reserved,
      available: before.available }, { balance: 1, reserved: 1, available: 0 });
    const topup = await credits.addAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 1,
      idempotencyKey: "universal:admin:topup:fixture-a",
      reason: "fixture_topup", operatorId: "admin_fixture" });
    assert.equal(topup.duplicate, false);
    assert.deepEqual({ balance: topup.balance, reserved: topup.reserved,
      available: topup.available }, { balance: 2, reserved: 1, available: 1 });
    assert.deepEqual((await admin.query(`SELECT status FROM
      engine_universal_queue_destinations WHERE id=$1`, [ambiguous.id])).rows[0],
      { status: "ambiguous" });
    assert.deepEqual((await admin.query(`SELECT state FROM
      engine_universal_credit_holds WHERE target_id=$1`, [ambiguous.id])).rows[0],
      { state: "held" });

    const duplicate = await credits.addAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 1,
      idempotencyKey: "universal:admin:topup:fixture-a",
      reason: "fixture_topup", operatorId: "admin_fixture" });
    assert.equal(duplicate.duplicate, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_topup" })).balance, 2);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      financial_credit_ledger WHERE cliente_id='ws_topup' AND
      reason='fixture_topup'`)).rows[0].n, 1);

    const ack = await insertAck(admin, ambiguous);
    const confirmed = await queue.confirmSend({ pool,
      destinationId: ambiguous.id, leaseToken: ambiguous.leaseToken,
      confirmationKey: ack.attemptId, providerMessageId: ack.providerMessageId });
    assert.equal(confirmed.ok, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_topup" })).balance, 1);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      financial_credit_ledger WHERE cliente_id='ws_topup' AND
      universal_movement_type='TARGET_DEBIT'`)).rows[0].n, 1);
    const duplicateAck = await queue.confirmSend({ pool,
      destinationId: ambiguous.id, leaseToken: ambiguous.leaseToken,
      confirmationKey: ack.attemptId, providerMessageId: ack.providerMessageId });
    assert.equal(duplicateAck.duplicate, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_topup" })).balance, 1);

    const failed = await createAmbiguousTarget(admin, pool, "ws_topup", "b");
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_topup" })).reserved, 1);
    const failure = await queue.confirmFailure({ pool,
      destinationId: failed.id, leaseToken: failed.leaseToken,
      reason: "provider_no_effect", evidence: "provider_no_effect_confirmed" });
    assert.equal(failure.ok, true);
    const afterRelease = await credits.readBalance({ pool,
      workspaceId: "ws_topup" });
    assert.deepEqual({ balance: afterRelease.balance,
      reserved: afterRelease.reserved }, { balance: 1, reserved: 0 });

    const concurrent = await Promise.all([
      credits.addAdminBalance({ pool, workspaceId: "ws_topup", amount: 1,
        idempotencyKey: "universal:admin:topup:fixture-c1" }),
      credits.addAdminBalance({ pool, workspaceId: "ws_topup", amount: 1,
        idempotencyKey: "universal:admin:topup:fixture-c2" })
    ]);
    assert.equal(concurrent.filter(item => item.duplicate).length, 0);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_topup" })).balance, 3);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      financial_credit_ledger WHERE cliente_id='ws_topup' AND
      universal_movement_type='FINANCIAL_MOVEMENT' AND balance_policy='add'`)).rows[0].n, 3);

    await assert.rejects(credits.addAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 0,
      idempotencyKey: "universal:admin:topup:invalid-zero" }),
    /topup_amount_invalid/);
    await assert.rejects(credits.addAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 1.5,
      idempotencyKey: "universal:admin:topup:invalid-fraction" }),
    /topup_amount_invalid/);
    await assert.rejects(credits.addAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 2147483648,
      idempotencyKey: "universal:admin:topup:invalid-range" }),
    /topup_amount_invalid/);
    const openHold = await createAmbiguousTarget(admin, pool, "ws_topup", "c");
    await assert.rejects(credits.setAdminBalance({ pool,
      workspaceId: "ws_topup", amount: 9,
      idempotencyKey: "universal:admin:absolute-with-hold" }),
    /universal_admin_credit_holds_open/);
    await queue.confirmFailure({ pool, destinationId: openHold.id,
      leaseToken: openHold.leaseToken, reason: "provider_no_effect",
      evidence: "provider_no_effect_confirmed" });

    const rollback = await credits.rollbackBalanceProjection({ pool,
      workspaceId: "ws_topup" });
    assert.equal(rollback.rollbackBalance, 3);
    console.log("UNIVERSAL_ADMIN_TOPUP_POSTGRES17_PASS", JSON.stringify({
      balance: 3, reserved: 0, available: 3, holdPreserved: true,
      ackDebitedOnce: true, failureReleased: true, duplicateTopup: true,
      concurrentTopups: 2, rollbackBalance: rollback.rollbackBalance
    }));
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
