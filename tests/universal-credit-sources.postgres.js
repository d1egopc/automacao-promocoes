"use strict";

// Disposable PostgreSQL 17 proof for source-scoped credit projection. It
// refuses DATABASE_URL and never connects to production.
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
const sources = require("../modules/engine/universal-credit-sources.repository");
const queue = require("../modules/engine/universal-queue.repository");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1",
  port: Number(process.env.UF_TEST_PG_PORT || 55433), user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const expectedHost = process.env.UF_TEST_PG_EXPECTED_SERVER_HOST || config.host;
const expectedPort = Number(process.env.UF_TEST_PG_EXPECTED_SERVER_PORT || config.port);
const expectedDataDir = process.env.UF_TEST_PG_EXPECTED_DATA_DIR ||
  path.join(root, ".local-postgres", "data");
const schema = `credit_sources_${crypto.randomBytes(6).toString("hex")}`;
const now = Date.now();
const epoch = new Date(now - 60 * 60 * 1000).toISOString();
const sourceHash = crypto.createHash("sha256").update("source-fixture")
  .digest("hex");

async function createOffer(client, workspace, destination, minute) {
  const capturedAt = new Date(new Date(epoch).getTime() + minute * 60_000)
    .toISOString();
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata)
    VALUES ('radar','radar',$1,'{}'::jsonb) RETURNING id`,
  [capturedAt])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada') RETURNING id`,
  [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { offerId, jobId, destination };
}

async function enqueueOne(client, pool, workspace, destination, minute) {
  const offer = await createOffer(client, workspace, destination, minute);
  await queue.enqueue({ pool, workspaceId: workspace, jobId: offer.jobId,
    ofertaId: offer.offerId, itemPayload: { title: `source-${minute}` },
    destinations: [{ destinationId: destination,
      targetKey: `group-${destination}`, channel: "whatsapp" }] });
  return offer;
}

async function claimAndStart(pool, workspace) {
  assert.equal((await queue.preflightWorkspace({ pool,
    workspaceId: workspace })).ok, true);
  const claim = await queue.claimDestination({ pool, workspaceId: workspace });
  assert.equal(claim.ok, true);
  assert.equal(claim.empty, false);
  assert.equal((await queue.markSendStarted({ pool, destinationId: claim.id,
    leaseToken: claim.leaseToken })).ok, true);
  return claim;
}

async function makeAmbiguous(client, pool, workspace, claim) {
  await client.query(`UPDATE engine_universal_queue_destinations
    SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
  [claim.id]);
  const result = await queue.preflightWorkspace({ pool, workspaceId: workspace });
  assert.equal(result.health, "AMBIGUOUS");
}

async function durableAck(client, claim, messageId) {
  const confirmationKey = crypto.randomUUID();
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id, `universal_${claim.queue_item_id}`,
    `${claim.channel}:${claim.destination_id}`, `grupo:${claim.target_key}`,
    confirmationKey, messageId]);
  return { confirmationKey, providerMessageId: messageId };
}

async function insertCycle(client, { workspace, value, origin, suffix,
  startOffsetDays = 0 }) {
  const start = new Date(now + startOffsetDays * 86400000);
  const end = new Date(start.getTime() + 30 * 86400000);
  return (await client.query(`INSERT INTO financial_credit_ledger
    (cliente_id,ledger_type,amount,balance_policy,cycle_start,cycle_end,
     reason,idempotency_key,projection_status,metadata)
    VALUES ($1,'cycle_credit',$2,'replace_cycle',$3,$4,$5,$6,'pending',$7::jsonb)
    RETURNING id`, [workspace, value, start.toISOString(), end.toISOString(),
    origin === "admin_courtesy" ? "admin_courtesy_cycle" : "payment_approved",
    `fixture-cycle:${workspace}:${suffix}`,
    JSON.stringify({ authority: "postgresql_universal", origin,
      planSnapshot: { planoId: "ultimate", creditosPorCiclo: value,
        cicloDias: 30 } })])).rows[0].id;
}

async function prepareActiveWorkspace(pool, workspace, policy = "expire") {
  const shadow = await sources.prepareShadowWorkspace({ pool,
    workspaceId: workspace });
  assert.equal(shadow.ok, true);
  if (shadow.unclassifiedSources) {
    await sources.classifyLegacyAvailable({ pool, workspaceId: workspace,
      baselineHash: shadow.baselineHash, policy,
      reason: `fixture_${policy}_approved` });
  }
  const active = await sources.activateWorkspaceSources({ pool,
    workspaceId: workspace, baselineHash: shadow.baselineHash });
  assert.equal(active.ok, true);
  return shadow;
}

async function main() {
  assert.ok(!process.env.DATABASE_URL,
    "Disposable source test refuses inherited DATABASE_URL");
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
    assert.equal(identity.host, expectedHost);
    assert.equal(Number(identity.port), expectedPort);
    assert.match(identity.version, /^17\./);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.normalize(expectedDataDir).toLowerCase());

    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query(`UPDATE engine_operation_state SET mode='CUTOVER_PREPARED'
      WHERE id=1`);
    pool = new Pool({ ...config, max: 12,
      options: `-c search_path=${schema},public` });
    for (const [workspace, opening] of [["ws-cycle", 100],
      ["ws-pix", 10], ["ws-blocked", 7], ["ws-admin-only", 20],
      ["ws-other", 25]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: opening, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    await enqueueOne(admin, pool, "ws-cycle", "old-a", 2);
    await enqueueOne(admin, pool, "ws-cycle", "old-b", 3);
    await enqueueOne(admin, pool, "ws-cycle", "new-c", 4);
    const oldA = await claimAndStart(pool, "ws-cycle");
    await makeAmbiguous(admin, pool, "ws-cycle", oldA);
    const oldB = await claimAndStart(pool, "ws-cycle");
    await makeAmbiguous(admin, pool, "ws-cycle", oldB);

    const shadow = await sources.prepareShadowWorkspace({ pool,
      workspaceId: "ws-cycle" });
    assert.equal(shadow.reserved, 2);
    assert.equal(shadow.unclassifiedAvailable, 98);
    await assert.rejects(sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-cycle", baselineHash: shadow.baselineHash }),
    /legacy_unclassified/);
    await sources.classifyLegacyAvailable({ pool, workspaceId: "ws-cycle",
      baselineHash: shadow.baselineHash, policy: "expire",
      reason: "fixture_expired_cycle" });
    await sources.activateWorkspaceSources({ pool, workspaceId: "ws-cycle",
      baselineHash: shadow.baselineHash });

    const courtesyId = await insertCycle(admin, { workspace: "ws-cycle",
      value: 300, origin: "admin_courtesy", suffix: "courtesy" });
    const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
      credits.applyFinancialLedger({ pool, ledgerId: courtesyId })));
    assert.equal(concurrent.filter(item => item.applied === true).length, 1);
    let balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 302);
    assert.equal(balance.reserved, 2);
    assert.equal(balance.available, 300);

    const current = await claimAndStart(pool, "ws-cycle");
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.available, 299);
    assert.equal(balance.reserved, 3);

    const oldAck = await durableAck(admin, oldA, "provider-old-a");
    await queue.confirmSend({ pool, destinationId: oldA.id,
      leaseToken: oldA.leaseToken, ...oldAck });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 301);
    assert.equal(balance.reserved, 2);
    assert.equal(balance.available, 299,
      "late ACK from old source must not consume current-cycle availability");

    await queue.confirmFailure({ pool, destinationId: oldB.id,
      leaseToken: oldB.leaseToken, reason: "provider_no_effect_confirmed",
      evidence: "provider_no_effect_confirmed" });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 300);
    assert.equal(balance.reserved, 1);
    assert.equal(balance.available, 299,
      "expired hold release must not return credit to the new cycle");

    const currentAck = await durableAck(admin, current, "provider-new-c");
    await queue.confirmSend({ pool, destinationId: current.id,
      leaseToken: current.leaseToken, ...currentAck });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 299);
    assert.equal(balance.reserved, 0);

    const topup = await credits.addAdminBalance({ pool,
      workspaceId: "ws-cycle", amount: 50,
      idempotencyKey: "fixture-admin-topup", operatorId: "fixture" });
    assert.equal(topup.balance, 349);
    assert.equal((await credits.addAdminBalance({ pool,
      workspaceId: "ws-cycle", amount: 50,
      idempotencyKey: "fixture-admin-topup", operatorId: "fixture" })).duplicate,
    true);
    const nextCycle = await insertCycle(admin, { workspace: "ws-cycle",
      value: 200, origin: "admin_courtesy", suffix: "next",
      startOffsetDays: 31 });
    await credits.applyFinancialLedger({ pool, ledgerId: nextCycle });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 250,
      "new cycle replaces old cycle availability but preserves admin source");
    assert.equal(balance.available, 250);

    await enqueueOne(admin, pool, "ws-pix", "pix-old", 5);
    const pixOld = await claimAndStart(pool, "ws-pix");
    await makeAmbiguous(admin, pool, "ws-pix", pixOld);
    await prepareActiveWorkspace(pool, "ws-pix", "expire");
    const pixLedger = await insertCycle(admin, { workspace: "ws-pix",
      value: 75, origin: "financial_event_v1", suffix: "pix" });
    await credits.applyFinancialLedger({ pool, ledgerId: pixLedger });
    const pixBalance = await credits.readBalance({ pool,
      workspaceId: "ws-pix" });
    assert.equal(pixBalance.reserved, 1);
    assert.equal(pixBalance.available, 75);

    await enqueueOne(admin, pool, "ws-admin-only", "admin-only", 6);
    await prepareActiveWorkspace(pool, "ws-admin-only", "preserve_admin");
    const adminTarget = (await admin.query(`SELECT id FROM
      engine_universal_queue_destinations
      WHERE workspace_id='ws-admin-only' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    const sourceClient = await pool.connect();
    try {
      await sourceClient.query("BEGIN");
      const adminOnlyHold = await sources.holdForTargetTx(sourceClient, {
        epoch, workspaceId: "ws-admin-only", targetId: adminTarget.id
      });
      assert.deepEqual({ ok: adminOnlyHold.ok, reason: adminOnlyHold.reason },
        { ok: false, reason: "workspace_credits_unavailable" },
        "administrative credits alone must not create send entitlement");
      await sourceClient.query("ROLLBACK");
    } finally {
      sourceClient.release();
    }

    const blockedShadow = await sources.prepareShadowWorkspace({ pool,
      workspaceId: "ws-blocked" });
    await assert.rejects(sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-blocked", baselineHash: blockedShadow.baselineHash }),
    /legacy_unclassified/);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-other" })).balance, 25,
    "unrelated workspace must remain on legacy authority unchanged");

    const conservation = (await admin.query(`SELECT COUNT(*)::int AS bad
      FROM engine_universal_credit_sources
      WHERE granted<>available+reserved+consumed+expired`)).rows[0];
    assert.equal(conservation.bad, 0);
    const expiredRelease = (await admin.query(`SELECT COUNT(*)::int AS n
      FROM financial_credit_ledger
      WHERE universal_movement_type='HOLD_EXPIRED_RELEASE'`)).rows[0];
    assert.equal(expiredRelease.n, 1);
    const oldEscrow = (await admin.query(`SELECT consumed,expired,reserved,state
      FROM engine_universal_credit_sources
      WHERE workspace_id='ws-cycle' AND source_kind='legacy_escrow'`)).rows[0];
    assert.deepEqual({ consumed: Number(oldEscrow.consumed),
      expired: Number(oldEscrow.expired), reserved: Number(oldEscrow.reserved),
      state: oldEscrow.state },
    { consumed: 1, expired: 1, reserved: 0, state: "closed" });

    await pool.end();
    pool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-cycle" })).balance, 250,
    "restart must preserve source projection exactly");

    console.log("UNIVERSAL_CREDIT_SOURCES_PG17_PASS", JSON.stringify({
      sourceScopedHolds: true,
      oldEscrowPreserved: true,
      lateAckOriginalSource: true,
      expiredReleaseNotReturned: true,
      courtesyWithOldHolds: true,
      pixWithOldHolds: true,
      adminTopupIndependent: true,
      adminTopupDoesNotCreateEntitlement: true,
      concurrentIdempotency: true,
      shadowDivergenceBlocksCutover: true,
      restartSafe: true,
      multiworkspaceIsolated: true
    }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
