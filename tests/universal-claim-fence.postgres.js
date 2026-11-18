"use strict";

// Disposable PostgreSQL 17 proof. This test never connects to production.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const queue = require("../modules/engine/universal-queue.repository");
const fence = require("../modules/engine/universal-claim-fence.service");
const { prepararModoOperacionalReal } = require("../modules/engine/universal-runtime-bootstrap");
const { SQL_SCHEMA_FINANCEIRO_V1 } = require("../modules/financeiro/financeiro.schema");
const { openBalance } = require("../modules/engine/universal-credits.repository");

const config = {
  host: "127.0.0.1",
  port: Number(process.env.UF_TEST_PG_PORT || 55433),
  user: "postgres",
  database: "optimus_universal_fixture",
  connectionTimeoutMillis: 5000
};
const expectedServerHost = String(process.env.UF_TEST_PG_EXPECTED_SERVER_HOST || config.host);
const expectedServerPort = Number(process.env.UF_TEST_PG_EXPECTED_SERVER_PORT || config.port);
const expectedDataDir = String(process.env.UF_TEST_PG_EXPECTED_DATA_DIR || "");
const schema = `uf_claim_fence_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-18T12:00:00.000Z";

async function createOffer(client, workspace, suffix) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES ('radar','radar',$1,'{}'::jsonb)
    RETURNING id`, ["2026-10-18T12:05:00.000Z"])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada') RETURNING id`, [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { eventId, offerId, jobId, suffix };
}

async function main() {
  const admin = new Client(config);
  let pool;
  let created = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir,
      current_setting('server_version_num')::integer AS version`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, expectedServerHost);
    assert.equal(identity.port, expectedServerPort);
    if (expectedDataDir) assert.equal(identity.data_dir, expectedDataDir);
    assert.ok(identity.version >= 170000 && identity.version < 180000);

    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode, "LEGACY");
    // The additive migration is safe to replay before cutover.
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode, "LEGACY");
    const migrationObjects = (await admin.query(`SELECT
      to_regclass('engine_universal_claim_fence') AS fence_table,
      to_regclass('engine_universal_queue_destinations') AS destination_table,
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema()
          AND table_name='engine_universal_queue_destinations'
          AND column_name='claim_fence_generation') AS generation_column,
      EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid='engine_universal_queue_destinations'::regclass
          AND tgname='engine_universal_claim_fence_guard_trigger') AS guard_trigger`)).rows[0];
    assert.equal(migrationObjects.fence_table, "engine_universal_claim_fence");
    assert.equal(migrationObjects.destination_table, "engine_universal_queue_destinations");
    assert.equal(migrationObjects.generation_column, true);
    assert.equal(migrationObjects.guard_trigger, true);
    // The existing operation-state guard intentionally requires the prepared
    // cutover step; the claim fence must not bypass that contract.
    await assert.rejects(admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]),
    /UF_OPERATION_TRANSITION_FORBIDDEN/);
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    await admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    pool = new Pool({ ...config, max: 8, options: `-c search_path=${schema},public` });

    for (const workspace of ["ws_fence", "ws_race"]) {
      await openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: 10,
        sourceHash: crypto.createHash("sha256").update(workspace).digest("hex") });
    }

    const first = await createOffer(admin, "ws_fence", "first");
    const firstQueue = await queue.enqueue({ pool, workspaceId: "ws_fence",
      jobId: first.jobId, ofertaId: first.offerId,
      itemPayload: { clienteId: "ws_fence", engineOfertaId: first.offerId,
        marketplace: "mercadolivre", titulo: "Fence fixture" },
      destinations: [{ destinationId: "dest_fence", targetKey: "group_fence", channel: "whatsapp" }] });
    assert.equal(firstQueue.created, true);
    assert.equal((await queue.preflightWorkspace({ pool, workspaceId: "ws_fence" })).ok, true);

    const open = await fence.status({ pool });
    assert.equal(open.state, "OPEN");
    const requested = await fence.requestDrain({ pool, requestedBy: "admin_master" });
    assert.equal(requested.state, "DRAINING");
    assert.equal(requested.admissionOpen, false);
    const blocked = await queue.claimDestination({ pool, workspaceId: "ws_fence" });
    assert.equal(blocked.reason, "universal_claim_fence_active");

    const drained = await fence.confirmDrain({ pool });
    assert.equal(drained.ok, true);
    assert.equal(drained.state, "DRAINED");
    assert.equal(drained.open, 0);

    // Simulate the older image trying to claim while the persistent fence is
    // active. The database trigger is the rollback/restart compatibility gate.
    await assert.rejects(admin.query(`UPDATE engine_universal_queue_destinations
      SET status='claimed',lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()+interval '30 seconds'
      WHERE queue_item_id=$1`, [firstQueue.itemId]), error => error.code === "55P03");
    const blockedAfterRestart = await queue.claimDestination({ pool, workspaceId: "ws_fence" });
    assert.equal(blockedAfterRestart.reason, "universal_claim_fence_active");

    const released = await fence.releaseAdmission({ pool });
    assert.equal(released.ok, true);
    assert.equal(released.state, "OPEN");
    assert.equal((await queue.preflightWorkspace({ pool, workspaceId: "ws_fence" })).ok, true);
    const claim = await queue.claimDestination({ pool, workspaceId: "ws_fence" });
    assert.equal(claim.ok, true);
    assert.equal(claim.empty, false);
    assert.equal(Number.isInteger(claim.claimFenceGeneration), true);
    await queue.releaseUnstarted({ pool, destinationId: claim.id, leaseToken: claim.leaseToken });

    // A claim admitted before the fence may cross the provider boundary and
    // finish with its factual ACK; no new claim may enter meanwhile.
    const active = await createOffer(admin, "ws_fence", "active");
    const activeQueue = await queue.enqueue({ pool, workspaceId: "ws_fence",
      jobId: active.jobId, ofertaId: active.offerId,
      itemPayload: { clienteId: "ws_fence", engineOfertaId: active.offerId,
        marketplace: "mercadolivre", titulo: "Active send fixture" },
      destinations: [{ destinationId: "dest_active", targetKey: "group_active", channel: "whatsapp" }] });
    await queue.preflightWorkspace({ pool, workspaceId: "ws_fence" });
    const activeClaim = await queue.claimDestination({ pool, workspaceId: "ws_fence" });
    assert.equal(activeClaim.empty, false);
    const drainWithClaim = await fence.requestDrain({ pool, requestedBy: "admin_master" });
    assert.equal(drainWithClaim.state, "DRAINING");
    assert.equal(drainWithClaim.claimed >= 1, true);
    assert.equal((await fence.confirmDrain({ pool })).reason, "claims_still_open");
    assert.equal((await queue.markSendStarted({ pool, destinationId: activeClaim.id,
      leaseToken: activeClaim.leaseToken })).ok, true);
    assert.equal((await fence.confirmDrain({ pool })).reason, "claims_still_open");
    const confirmationKey = crypto.randomUUID();
    await admin.query(`INSERT INTO fila_checkpoints_entrega
      (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
       estado,provider_message_id,confirmado_em)
      VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
    ["ws_fence", `universal_${activeQueue.itemId}`, "whatsapp:dest_active",
      "grupo:group_active", confirmationKey, "provider-fence-ack"]);
    assert.equal((await queue.confirmSend({ pool, destinationId: activeClaim.id,
      leaseToken: activeClaim.leaseToken, confirmationKey,
      providerMessageId: "provider-fence-ack" })).ok, true);
    assert.equal((await fence.confirmDrain({ pool })).state, "DRAINED");

    // Race proof: either the claim linearizes before requestDrain (and is
    // included in its open count) or it is rejected after the fence commits.
    assert.equal((await fence.releaseAdmission({ pool })).state, "OPEN");
    const race = await createOffer(admin, "ws_race", "race");
    const raceQueue = await queue.enqueue({ pool, workspaceId: "ws_race",
      jobId: race.jobId, ofertaId: race.offerId,
      itemPayload: { clienteId: "ws_race", engineOfertaId: race.offerId,
        marketplace: "mercadolivre", titulo: "Race fixture" },
      destinations: [{ destinationId: "dest_race", targetKey: "group_race", channel: "whatsapp" }] });
    await queue.preflightWorkspace({ pool, workspaceId: "ws_race" });
    const [raceDrain, raceClaim] = await Promise.all([
      fence.requestDrain({ pool, requestedBy: "admin_master" }),
      queue.claimDestination({ pool, workspaceId: "ws_race" })
    ]);
    if (raceClaim.ok === true && raceClaim.empty === false) {
      assert.equal(raceDrain.claimed >= 1, true);
      assert.equal(raceClaim.claimFenceGeneration, raceDrain.generation - 1);
      await queue.releaseUnstarted({ pool, destinationId: raceClaim.id,
        leaseToken: raceClaim.leaseToken });
    } else {
      assert.equal(raceClaim.reason, "universal_claim_fence_active");
    }
    const raceConfirmed = await fence.confirmDrain({ pool });
    assert.equal(raceConfirmed.state, "DRAINED");
    assert.equal(raceConfirmed.open, 0);

    // A fresh pool simulates restart; the durable DRAINED state remains and
    // still blocks old-image claim SQL until explicit release.
    const restartedPool = new Pool({ ...config, max: 2, options: `-c search_path=${schema},public` });
    try {
      const afterRestart = await fence.status({ pool: restartedPool });
      assert.equal(afterRestart.state, "DRAINED");
      assert.equal(afterRestart.admissionOpen, false);
      assert.equal((await fence.releaseAdmission({ pool: restartedPool })).state, "OPEN");
    } finally {
      await restartedPool.end();
    }

    // A missing persistent row is an infrastructure failure, never an OPEN
    // default. Restore it afterwards because this is a disposable schema.
    await admin.query("DELETE FROM engine_universal_claim_fence WHERE id=1");
    await assert.rejects(queue.claimDestination({ pool, workspaceId: "ws_fence" }),
      /claim_fence_state_missing/);
    await admin.query(`INSERT INTO engine_universal_claim_fence
      (id,state,generation,operation_epoch_started_at)
      VALUES (1,'OPEN',99,$1)`, [epoch]);

    console.log("CLAIM_FENCE_PG17=PASS");
    console.log("CLAIM_RACE=PASS");
    console.log("SEND_DRAIN_ACK=PASS");
    console.log("RESTART_ROLLBACK_TRIGGER=PASS");
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
