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
  startOffsetDays = 0, durationDays = 30 }) {
  const start = new Date(now + startOffsetDays * 86400000);
  const end = new Date(start.getTime() + durationDays * 86400000);
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

async function prepareShadow(pool, workspace) {
  const inspection = await sources.inspectShadowWorkspace({ pool,
    workspaceId: workspace });
  assert.equal(inspection.readOnly, true);
  const shadow = await sources.prepareShadowWorkspace({ pool,
    workspaceId: workspace, expectedSnapshotHash: inspection.snapshotHash });
  assert.equal(shadow.ok, true);
  assert.equal(shadow.legacyAuthorityUntouched, true);
  return { inspection, shadow };
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
    for (const [workspace, opening] of [["ws-cycle", 0],
      ["ws-pix", 0], ["ws-blocked", 7], ["ws-admin-only", 0],
      ["ws-other", 25], ["ws-race-pix", 0],
      ["ws-race-courtesy", 0], ["ws-race-prepare", 0],
      ["ws-race-concurrent", 0]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: opening, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    const expiredCourtesy = await insertCycle(admin, { workspace: "ws-cycle",
      value: 100, origin: "admin_courtesy", suffix: "expired-courtesy",
      startOffsetDays: -60 });
    await credits.applyFinancialLedger({ pool, ledgerId: expiredCourtesy });
    const expiredPix = await insertCycle(admin, { workspace: "ws-pix",
      value: 10, origin: "financial_event_v1", suffix: "expired-pix",
      startOffsetDays: -60 });
    await credits.applyFinancialLedger({ pool, ledgerId: expiredPix });
    await credits.addAdminBalance({ pool, workspaceId: "ws-admin-only",
      amount: 20, idempotencyKey: "fixture-admin-only", operatorId: "fixture" });
    const adminOnlyLedger = (await admin.query(`SELECT id FROM
      financial_credit_ledger WHERE idempotency_key='fixture-admin-only'`)).rows[0];

    const beforeReadOnly = (await admin.query(`SELECT
      (SELECT COUNT(*) FROM engine_universal_credit_sources)::int AS sources,
      (SELECT COUNT(*) FROM engine_universal_credit_source_workspaces)::int AS states,
      (SELECT COUNT(*) FROM engine_universal_credit_shadow_hold_sources)::int AS maps`)).rows[0];
    const readOnly = await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-cycle" });
    const afterReadOnly = (await admin.query(`SELECT
      (SELECT COUNT(*) FROM engine_universal_credit_sources)::int AS sources,
      (SELECT COUNT(*) FROM engine_universal_credit_source_workspaces)::int AS states,
      (SELECT COUNT(*) FROM engine_universal_credit_shadow_hold_sources)::int AS maps`)).rows[0];
    assert.deepEqual(afterReadOnly, beforeReadOnly,
      "read-only preflight must not create any shadow state");

    const oldClaims = [];
    for (let index = 0; index < 19; index += 1) {
      await enqueueOne(admin, pool, "ws-cycle", `old-${index + 1}`, index + 2);
    }
    await enqueueOne(admin, pool, "ws-cycle", "new-current", 30);
    for (let index = 0; index < 19; index += 1) {
      const claim = await claimAndStart(pool, "ws-cycle");
      await makeAmbiguous(admin, pool, "ws-cycle", claim);
      oldClaims.push(claim);
    }
    const cycleInspection = await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-cycle" });
    assert.notEqual(cycleInspection.snapshotHash, readOnly.snapshotHash,
      "new reservations must invalidate an earlier read-only snapshot");
    const { shadow } = await prepareShadow(pool, "ws-cycle");
    assert.equal(shadow.reserved, 19);
    assert.equal(shadow.unclassifiedAvailable, 81);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-cycle" })).balance, 100);
    assert.equal(Number((await admin.query(`SELECT COUNT(*)::int AS n FROM
      engine_universal_credit_holds WHERE workspace_id='ws-cycle'
        AND state='held' AND source_id IS NOT NULL`)).rows[0].n), 0,
    "SHADOW must not bind live holds");
    await assert.rejects(sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-cycle", baselineHash: shadow.baselineHash }),
    /legacy_unclassified/);
    await sources.classifyLegacyAvailable({ pool, workspaceId: "ws-cycle",
      baselineHash: shadow.baselineHash, classification: "expired_cycle",
      evidenceLedgerIds: [expiredCourtesy],
      reason: "fixture_expired_cycle" });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-cycle" })).balance, 100,
    "classification must not mutate legacy aggregate balance");

    await pool.end();
    pool = new Pool({ ...config, max: 12,
      options: `-c search_path=${schema},public` });
    const afterRestart = await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-cycle" });
    assert.equal(afterRestart.mode, "SHADOW");
    const activation = await sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-cycle",
      baselineHash: shadow.baselineHash });
    assert.equal(activation.cutoverDelta, -81);
    assert.equal(Number((await admin.query(`SELECT COUNT(*)::int AS n FROM
      engine_universal_credit_holds WHERE workspace_id='ws-cycle'
        AND state='held' AND source_id IS NOT NULL`)).rows[0].n), 19);

    const courtesyId = await insertCycle(admin, { workspace: "ws-cycle",
      value: 300, origin: "admin_courtesy", suffix: "courtesy" });
    const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
      credits.applyFinancialLedger({ pool, ledgerId: courtesyId })));
    assert.equal(concurrent.filter(item => item.applied === true).length, 1);
    let balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 319);
    assert.equal(balance.reserved, 19);
    assert.equal(balance.available, 300);

    const current = await claimAndStart(pool, "ws-cycle");
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.available, 299);
    assert.equal(balance.reserved, 20);

    const oldA = oldClaims[0];
    const oldB = oldClaims[1];
    const oldAck = await durableAck(admin, oldA, "provider-old-a");
    await queue.confirmSend({ pool, destinationId: oldA.id,
      leaseToken: oldA.leaseToken, ...oldAck });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 318);
    assert.equal(balance.reserved, 19);
    assert.equal(balance.available, 299,
      "late ACK from old source must not consume current-cycle availability");

    await queue.confirmFailure({ pool, destinationId: oldB.id,
      leaseToken: oldB.leaseToken, reason: "provider_no_effect_confirmed",
      evidence: "provider_no_effect_confirmed" });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 317);
    assert.equal(balance.reserved, 18);
    assert.equal(balance.available, 299,
      "expired hold release must not return credit to the new cycle");

    const currentAck = await durableAck(admin, current, "provider-new-c");
    await queue.confirmSend({ pool, destinationId: current.id,
      leaseToken: current.leaseToken, ...currentAck });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 316);
    assert.equal(balance.reserved, 17);

    const topup = await credits.addAdminBalance({ pool,
      workspaceId: "ws-cycle", amount: 50,
      idempotencyKey: "fixture-admin-topup", operatorId: "fixture" });
    assert.equal(topup.balance, 366);
    assert.equal((await credits.addAdminBalance({ pool,
      workspaceId: "ws-cycle", amount: 50,
      idempotencyKey: "fixture-admin-topup", operatorId: "fixture" })).duplicate,
    true);
    const nextCycle = await insertCycle(admin, { workspace: "ws-cycle",
      value: 200, origin: "admin_courtesy", suffix: "next",
      startOffsetDays: 31 });
    await credits.applyFinancialLedger({ pool, ledgerId: nextCycle });
    balance = await credits.readBalance({ pool, workspaceId: "ws-cycle" });
    assert.equal(balance.balance, 267,
      "new cycle replaces old cycle availability but preserves admin source");
    assert.equal(balance.available, 250);

    await enqueueOne(admin, pool, "ws-pix", "pix-old", 5);
    const pixOld = await claimAndStart(pool, "ws-pix");
    await makeAmbiguous(admin, pool, "ws-pix", pixOld);
    const pixShadow = (await prepareShadow(pool, "ws-pix")).shadow;
    await sources.classifyLegacyAvailable({ pool, workspaceId: "ws-pix",
      baselineHash: pixShadow.baselineHash, classification: "expired_cycle",
      evidenceLedgerIds: [expiredPix], reason: "fixture_expired_pix_cycle" });
    await sources.activateWorkspaceSources({ pool, workspaceId: "ws-pix",
      baselineHash: pixShadow.baselineHash });
    const pixLedger = await insertCycle(admin, { workspace: "ws-pix",
      value: 75, origin: "financial_event_v1", suffix: "pix" });
    await credits.applyFinancialLedger({ pool, ledgerId: pixLedger });
    const pixBalance = await credits.readBalance({ pool,
      workspaceId: "ws-pix" });
    assert.equal(pixBalance.reserved, 1);
    assert.equal(pixBalance.available, 75);

    await enqueueOne(admin, pool, "ws-admin-only", "admin-only", 31);
    const adminShadow = (await prepareShadow(pool, "ws-admin-only")).shadow;
    await sources.classifyLegacyAvailable({ pool, workspaceId: "ws-admin-only",
      baselineHash: adminShadow.baselineHash, classification: "admin_topup",
      evidenceLedgerIds: [adminOnlyLedger.id], reason: "fixture_admin_proven" });
    await sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-admin-only", baselineHash: adminShadow.baselineHash });
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

    const blockedShadow = (await prepareShadow(pool, "ws-blocked")).shadow;
    await assert.rejects(sources.classifyLegacyAvailable({ pool,
      workspaceId: "ws-blocked", baselineHash: blockedShadow.baselineHash,
      classification: "admin_topup", evidenceLedgerIds: [adminOnlyLedger.id],
      reason: "must_not_cross_workspace" }), /provenance_missing/);
    await assert.rejects(sources.activateWorkspaceSources({ pool,
      workspaceId: "ws-blocked", baselineHash: blockedShadow.baselineHash }),
    /legacy_unclassified/);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-other" })).balance, 25,
    "unrelated workspace must remain on legacy authority unchanged");

    const prepareRaceInspection = await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-race-prepare" });
    await credits.addAdminBalance({ pool, workspaceId: "ws-race-prepare",
      amount: 3, idempotencyKey: "race-before-prepare", operatorId: "fixture" });
    await assert.rejects(sources.prepareShadowWorkspace({ pool,
      workspaceId: "ws-race-prepare",
      expectedSnapshotHash: prepareRaceInspection.snapshotHash }),
    /snapshot_changed/);

    const concurrentInspection = await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-race-concurrent" });
    const concurrentPrepare = sources.prepareShadowWorkspace({ pool,
      workspaceId: "ws-race-concurrent",
      expectedSnapshotHash: concurrentInspection.snapshotHash });
    const concurrentLegacyWrite = credits.addAdminBalance({ pool,
      workspaceId: "ws-race-concurrent", amount: 4,
      idempotencyKey: "race-during-prepare", operatorId: "fixture" });
    const [prepareOutcome, writeOutcome] = await Promise.allSettled([
      concurrentPrepare, concurrentLegacyWrite
    ]);
    assert.equal(writeOutcome.status, "fulfilled");
    if (prepareOutcome.status === "fulfilled") {
      await assert.rejects(sources.activateWorkspaceSources({ pool,
        workspaceId: "ws-race-concurrent",
        baselineHash: prepareOutcome.value.baselineHash }), /snapshot_changed/);
      await sources.rollbackShadowWorkspace({ pool,
        workspaceId: "ws-race-concurrent",
        baselineHash: prepareOutcome.value.baselineHash });
    } else {
      assert.match(String(prepareOutcome.reason?.message), /snapshot_changed/);
    }

    for (const [workspace, origin] of [["ws-race-pix", "financial_event_v1"],
      ["ws-race-courtesy", "admin_courtesy"]]) {
      const raceShadow = (await prepareShadow(pool, workspace)).shadow;
      const concurrentLedger = await insertCycle(admin, { workspace, value: 40,
        origin, suffix: `concurrent-${origin}` });
      await credits.applyFinancialLedger({ pool, ledgerId: concurrentLedger });
      await assert.rejects(sources.activateWorkspaceSources({ pool, workspaceId: workspace,
        baselineHash: raceShadow.baselineHash }), /snapshot_changed/);
      const rolledBack = await sources.rollbackShadowWorkspace({ pool,
        workspaceId: workspace, baselineHash: raceShadow.baselineHash });
      assert.equal(rolledBack.legacyAuthorityUntouched, true);
      assert.equal(rolledBack.snapshotDiverged, true);
      assert.equal((await credits.readBalance({ pool, workspaceId: workspace })).balance, 40);
    }

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
    { consumed: 1, expired: 1, reserved: 17, state: "escrow" });

    await pool.end();
    pool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-cycle" })).balance, 267,
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
      readOnlyPreflightNoWrites: true,
      shadowDoesNotBindLiveHolds: true,
      classificationDoesNotMutateLegacyBalance: true,
      nineteenSyntheticHoldsPreserved: true,
      paymentAndCourtesyRaceBlockCutover: true,
      preActiveRollbackSafe: true,
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
