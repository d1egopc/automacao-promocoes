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
      ["ws-race-concurrent", 0], ["ws-segregated", 15427],
      ["ws-segregated-rollback", 9], ["ws-segregated-diverged", 10],
      ["ws-segregated-new", 0]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: opening, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    // New SaaS workspaces have no historical ambiguity: registration opens
    // source authority atomically and never requires a manual SHADOW cutover.
    for (const [workspace, opening, plan] of [["ws-onboard-free", 12, "free-beta"],
      ["ws-onboard-paid", 0, "ultimate"]]) {
      await credits.prepareRegistrationOpening({ pool, workspaceId: workspace,
        openingBalance: opening, planId: plan });
      await credits.reconcileRegistrationOpening({ pool, workspaceId: workspace,
        userExists: true });
      await credits.reconcileRegistrationOpening({ pool, workspaceId: workspace,
        userExists: true });
      const state = (await admin.query(`SELECT mode FROM
        engine_universal_credit_source_workspaces
        WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
      [epoch, workspace])).rows[0];
      assert.equal(state.mode, "ACTIVE");
      assert.equal(Number((await admin.query(`SELECT COUNT(*)::int AS n FROM
        engine_universal_credit_sources WHERE operation_epoch_started_at=$1
          AND workspace_id=$2 AND source_kind='opening'`,
      [epoch, workspace])).rows[0].n), 1,
      "registration retry must not duplicate the opening source");
    }
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-onboard-free" })).available, 12);
    await enqueueOne(admin, pool, "ws-onboard-free", "onboard-free", 1);
    const onboardClaim = await claimAndStart(pool, "ws-onboard-free");
    assert.ok(onboardClaim.id, "new workspace must reach source-scoped hold");

    await credits.addAdminBalance({ pool, workspaceId: "ws-onboard-paid",
      amount: 25, idempotencyKey: "onboard-paid-admin-only",
      operatorId: "fixture" });
    let onboardPaid = await credits.readBalance({ pool,
      workspaceId: "ws-onboard-paid" });
    assert.equal(onboardPaid.aggregateAvailable, 25);
    assert.equal(onboardPaid.available, 0,
      "zero opening plus admin top-up does not create plan entitlement");
    const onboardPix = await insertCycle(admin, { workspace: "ws-onboard-paid",
      value: 40, origin: "financial_event_v1", suffix: "onboard-pix" });
    await credits.applyFinancialLedger({ pool, ledgerId: onboardPix });
    onboardPaid = await credits.readBalance({ pool,
      workspaceId: "ws-onboard-paid" });
    assert.equal(onboardPaid.available, 65,
      "valid Pix entitlement makes its cycle and preserved admin source eligible");
    assert.equal((await sources.inspectShadowWorkspace({ pool,
      workspaceId: "ws-other" })).mode, "LEGACY",
    "an existing unmigrated workspace remains independently legacy");

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
    assert.equal(balance.aggregateAvailable, 250);
    assert.equal(balance.available, 0,
      "future cycle cannot make administrative value spendable before its window");

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

    // R1.5: indeterminate history remains fully backed but cannot fund new
    // sends. A legitimate later cycle is independently spendable.
    const segregatedClaims = [];
    for (let index = 0; index < 19; index += 1) {
      await enqueueOne(admin, pool, "ws-segregated", `legacy-${index + 1}`,
        index + 40);
      const claim = await claimAndStart(pool, "ws-segregated");
      await makeAmbiguous(admin, pool, "ws-segregated", claim);
      segregatedClaims.push(claim);
    }
    const segregatedShadow = (await prepareShadow(pool, "ws-segregated")).shadow;
    assert.equal(segregatedShadow.reserved, 19);
    assert.equal(segregatedShadow.unclassifiedAvailable, 15408);
    const segregatedActivation = await sources.activateWorkspaceSegregated({
      pool, workspaceId: "ws-segregated",
      baselineHash: segregatedShadow.baselineHash
    });
    assert.equal(segregatedActivation.mode, "ACTIVE_SEGREGATED");
    let segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.deepEqual({ balance: segregatedBalance.balance,
      reserved: segregatedBalance.reserved,
      spendable: segregatedBalance.spendable,
      legacy: segregatedBalance.legacySegregated,
      mode: segregatedBalance.sourceMode },
    { balance: 15427, reserved: 19, spendable: 0,
      legacy: 15427, mode: "ACTIVE_SEGREGATED" });

    const segregatedCourtesy = await insertCycle(admin, {
      workspace: "ws-segregated", value: 4000, origin: "admin_courtesy",
      suffix: "segregated-courtesy" });
    const courtesyRace = await Promise.all(Array.from({ length: 8 }, () =>
      credits.applyFinancialLedger({ pool, ledgerId: segregatedCourtesy })));
    assert.equal(courtesyRace.filter(item => item.applied === true).length, 1);
    segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.deepEqual({ balance: segregatedBalance.balance,
      reserved: segregatedBalance.reserved,
      spendable: segregatedBalance.spendable,
      legacy: segregatedBalance.legacySegregated },
    { balance: 19427, reserved: 19, spendable: 4000, legacy: 15427 });

    await enqueueOne(admin, pool, "ws-segregated", "new-courtesy", 70);
    const segregatedCurrent = await claimAndStart(pool, "ws-segregated");
    segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.equal(segregatedBalance.spendable, 3999);
    assert.equal(segregatedBalance.reserved, 20);

    const lateAck = await durableAck(admin, segregatedClaims[0],
      "provider-segregated-old-ack");
    await queue.confirmSend({ pool, destinationId: segregatedClaims[0].id,
      leaseToken: segregatedClaims[0].leaseToken, ...lateAck });
    await queue.confirmFailure({ pool, destinationId: segregatedClaims[1].id,
      leaseToken: segregatedClaims[1].leaseToken,
      reason: "provider_no_effect_confirmed",
      evidence: "provider_no_effect_confirmed" });
    segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.deepEqual({ balance: segregatedBalance.balance,
      reserved: segregatedBalance.reserved,
      spendable: segregatedBalance.spendable,
      legacy: segregatedBalance.legacySegregated },
    { balance: 19426, reserved: 18, spendable: 3999, legacy: 15426 },
    "late legacy ACK debits escrow; factual failure preserves nonspendable history");

    const segregatedCurrentAck = await durableAck(admin, segregatedCurrent,
      "provider-segregated-current-ack");
    await queue.confirmSend({ pool, destinationId: segregatedCurrent.id,
      leaseToken: segregatedCurrent.leaseToken, ...segregatedCurrentAck });
    const segregatedPix = await insertCycle(admin, {
      workspace: "ws-segregated", value: 4000, origin: "financial_event_v1",
      suffix: "segregated-pix" });
    const pixRace = await Promise.all(Array.from({ length: 8 }, () =>
      credits.applyFinancialLedger({ pool, ledgerId: segregatedPix })));
    assert.equal(pixRace.filter(item => item.applied === true).length, 1);
    segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.deepEqual({ balance: segregatedBalance.balance,
      reserved: segregatedBalance.reserved,
      spendable: segregatedBalance.spendable,
      legacy: segregatedBalance.legacySegregated },
    { balance: 19426, reserved: 17, spendable: 4000, legacy: 15426 });

    const rollbackShadow = (await prepareShadow(pool,
      "ws-segregated-rollback")).shadow;
    await sources.activateWorkspaceSegregated({ pool,
      workspaceId: "ws-segregated-rollback",
      baselineHash: rollbackShadow.baselineHash });
    const rolledSegregated = await sources.rollbackSegregatedWorkspace({ pool,
      workspaceId: "ws-segregated-rollback",
      baselineHash: rollbackShadow.baselineHash });
    assert.equal(rolledSegregated.legacyAuthorityRestored, true);
    assert.deepEqual(await credits.readBalance({ pool,
      workspaceId: "ws-segregated-rollback" }).then(item => ({
      balance: item.balance, reserved: item.reserved, sourceMode: item.sourceMode
    })), { balance: 9, reserved: 0, sourceMode: null });

    const divergentShadow = (await prepareShadow(pool,
      "ws-segregated-diverged")).shadow;
    await credits.addAdminBalance({ pool, workspaceId: "ws-segregated-diverged",
      amount: 2, idempotencyKey: "segregated-diverged-write",
      operatorId: "fixture" });
    await assert.rejects(sources.activateWorkspaceSegregated({ pool,
      workspaceId: "ws-segregated-diverged",
      baselineHash: divergentShadow.baselineHash }), /snapshot_changed/);
    await sources.rollbackShadowWorkspace({ pool,
      workspaceId: "ws-segregated-diverged",
      baselineHash: divergentShadow.baselineHash });

    const newShadow = (await prepareShadow(pool, "ws-segregated-new")).shadow;
    await sources.activateWorkspaceSegregated({ pool,
      workspaceId: "ws-segregated-new", baselineHash: newShadow.baselineHash });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-segregated-new" })).spendable, 0);
    const newCourtesy = await insertCycle(admin, {
      workspace: "ws-segregated-new", value: 100,
      origin: "admin_courtesy", suffix: "new-workspace-courtesy" });
    await credits.applyFinancialLedger({ pool, ledgerId: newCourtesy });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-segregated-new" })).spendable, 100);

    const conservation = (await admin.query(`SELECT COUNT(*)::int AS bad
      FROM engine_universal_credit_sources
      WHERE granted<>available+reserved+consumed+expired`)).rows[0];
    assert.equal(conservation.bad, 0);
    const aggregateConservation = (await admin.query(`SELECT COUNT(*)::int AS bad
      FROM engine_universal_credit_source_workspaces w
      JOIN engine_universal_credit_balances b
        USING (operation_epoch_started_at,workspace_id)
      JOIN LATERAL (SELECT COALESCE(SUM(available+reserved),0)::int AS backed,
        COALESCE(SUM(reserved),0)::int AS reserved
        FROM engine_universal_credit_sources s
        WHERE s.operation_epoch_started_at=w.operation_epoch_started_at
          AND s.workspace_id=w.workspace_id) totals ON true
      WHERE w.mode IN ('ACTIVE','ACTIVE_SEGREGATED')
        AND (b.balance<>totals.backed OR b.reserved<>totals.reserved)`)).rows[0];
    assert.equal(aggregateConservation.bad, 0,
      "aggregate compatibility projection must equal the single source authority");
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
    const segregatedAfterRestart = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.deepEqual({ balance: segregatedAfterRestart.balance,
      reserved: segregatedAfterRestart.reserved,
      spendable: segregatedAfterRestart.spendable,
      legacy: segregatedAfterRestart.legacySegregated,
      mode: segregatedAfterRestart.sourceMode },
    { balance: 19426, reserved: 17, spendable: 4000,
      legacy: 15426, mode: "ACTIVE_SEGREGATED" },
    "restart must preserve segregated legacy and eligible new source exactly");

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
      newWorkspaceAutomaticActive: true,
      newWorkspaceRegistrationIdempotent: true,
      legacyAndActiveCoexist: true,
      zeroOpeningAdminFailClosed: true,
      segregatedLegacyNonspendable: true,
      segregatedNewCycleSpendable: true,
      segregatedLateResolutionSafe: true,
      segregatedRollbackBeforeMovement: true,
      segregatedPixAndCourtesyIdempotent: true,
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
