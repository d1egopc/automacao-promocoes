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
const financialService = require("../modules/financeiro/financeiro.service");
const { criarRepositorioFinanceiroPostgres } =
  require("../modules/financeiro/financeiro.repository");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const credits = require("../modules/engine/universal-credits.repository");
const sources = require("../modules/engine/universal-credit-sources.repository");
const queue = require("../modules/engine/universal-queue.repository");
const manualCredits = require("../modules/manual-v2/manual-universal-credit");
const express = require("express");
const manualStorage = require("../modules/manual-v2/manual-offers.storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");

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
    // Reproduce the existing productive table before applying additive DDL.
    await admin.query(`CREATE TABLE engine_universal_credit_opening_intents (
      operation_epoch_started_at timestamptz NOT NULL,
      workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
      opening_balance integer NOT NULL CHECK (opening_balance >= 0),
      source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
      state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending','completed','orphaned')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      PRIMARY KEY (operation_epoch_started_at,workspace_id)
    )`);
    await admin.query(`INSERT INTO engine_universal_credit_opening_intents
      (operation_epoch_started_at,workspace_id,opening_balance,source_hash)
      VALUES ('2026-01-01T00:00:00Z','preexisting-intent',300,$1)`,
    ["a".repeat(64)]);
    await prepararModoOperacionalReal({ pool: admin });
    const migratedIntent = (await admin.query(`SELECT opening_balance,
      source_hash,state,opening_cycle_end FROM
      engine_universal_credit_opening_intents
      WHERE workspace_id='preexisting-intent'`)).rows[0];
    assert.deepEqual(migratedIntent, { opening_balance: 300,
      source_hash: "a".repeat(64), state: "pending", opening_cycle_end: null },
    "additive DDL preserves pre-existing intent and leaves expiry unknown");
    await admin.query(`ALTER TABLE engine_universal_credit_opening_intents
      ADD COLUMN IF NOT EXISTS opening_cycle_end timestamptz`);
    assert.equal((await admin.query(`SELECT COUNT(*)::int AS n FROM
      engine_universal_credit_opening_intents
      WHERE workspace_id='preexisting-intent' AND opening_balance=300
        AND opening_cycle_end IS NULL`)).rows[0].n, 1,
    "repeated DDL must preserve the previous row exactly");
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
      ["ws-segregated-new", 0], ["ws-v2-transition", 100]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: opening, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    // New SaaS workspaces have no historical ambiguity: registration opens
    // source authority atomically and never requires a manual SHADOW cutover.
    for (const [workspace, opening, plan, cycleEnd] of [
      ["ws-onboard-free", 12, "free-beta", new Date(now + 30 * 86400000).toISOString()],
      ["ws-onboard-free-expired", 300, "free-beta", new Date(now - 86400000).toISOString()],
      ["ws-onboard-paid", 0, "ultimate", null]]) {
      await credits.prepareRegistrationOpening({ pool, workspaceId: workspace,
        openingBalance: opening, planId: plan, openingCycleEnd: cycleEnd });
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

    const expiredFree = await credits.readBalance({ pool,
      workspaceId: "ws-onboard-free-expired" });
    assert.equal(expiredFree.balance, 300, "historical Free balance stays in ledger");
    assert.equal(expiredFree.available, 0,
      "expired Free opening cannot fund new sends even with positive aggregate");
    const financialRepo = criarRepositorioFinanceiroPostgres({ pool });
    const planPro = { id: "plano_loja", nome: "Pro", preco: "R$ 29,90",
      visivelPublicamente: true, contratavel: true, emBreve: false,
      entradaBeta: false, renovacaoCreditos: "pagamento",
      creditosModelo: "ciclo", limites: { creditosPorCiclo: 1500, cicloDias: 30 } };
    const charge = await financialService.criarCobrancaFinanceira({
      clienteId: "ws-onboard-free-expired", planoId: "plano_loja",
      planos: { plano_loja: planPro }, provider: "mercadopago",
      externalPaymentId: "pix-sintetico-free-pro", repositorio: financialRepo,
      agora: new Date()
    });
    assert.equal(charge.ok, true);
    const approval = await financialService.processarFinancialPaymentEvent({
      type: "payment.approved", provider: "mercadopago",
      providerEventId: "evt-sintetico-free-pro",
      externalPaymentId: "pix-sintetico-free-pro",
      clienteId: "ws-onboard-free-expired", planoId: "plano_loja",
      amountCents: charge.planSnapshot.amountCents, currency: "BRL",
      receivedAt: new Date()
    }, { repositorio: financialRepo, agora: new Date() });
    assert.equal(approval.ledgerInserido, true);
    assert.equal((await financialService.processarFinancialPaymentEvent({
      type: "payment.approved", provider: "mercadopago",
      providerEventId: "evt-sintetico-free-pro",
      externalPaymentId: "pix-sintetico-free-pro",
      clienteId: "ws-onboard-free-expired", planoId: "plano_loja",
      amountCents: charge.planSnapshot.amountCents, currency: "BRL",
      receivedAt: new Date()
    }, { repositorio: financialRepo, agora: new Date() })).idempotente, true);
    await credits.applyFinancialLedger({ pool, ledgerId: approval.ledgerId });
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: approval.ledgerId })).applied, false);
    const upgradedFree = await credits.readBalance({ pool,
      workspaceId: "ws-onboard-free-expired" });
    assert.equal(upgradedFree.available, 1500,
      "approved Pix opens only its own spendable source, not expired Free credits");
    await enqueueOne(admin, pool, "ws-onboard-free-expired", "upgrade-pro", 1);
    const upgradedClaim = await claimAndStart(pool, "ws-onboard-free-expired");
    const upgradedHold = (await admin.query(`SELECT s.source_kind,s.cycle_end
      FROM engine_universal_credit_holds h JOIN engine_universal_credit_sources s
        ON s.id=h.source_id WHERE h.target_id=$1`, [upgradedClaim.id])).rows[0];
    assert.equal(upgradedHold.source_kind, "cycle",
      "new reservation must bind to Pix cycle, never old Free opening");

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
    const noCurrentCycle = await manualCredits.reservarCreditoManualUniversal({
      pool, workspaceId: "ws-segregated", operationId: "before-courtesy",
      destinationId: "destination-a" });
    assert.equal(noCurrentCycle.ok, false,
      "historical segregated credit cannot fund a direct send");

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

    const directArgs = { pool, workspaceId: "ws-segregated",
      operationId: "extension-direct-once", destinationId: "destination-a" };
    const directRace = await Promise.all(Array.from({ length: 4 }, () =>
      manualCredits.reservarCreditoManualUniversal(directArgs)));
    assert.equal(directRace.filter(item => item.ok && !item.duplicate).length, 1);
    assert.equal(directRace.filter(item => item.ok && item.duplicate).length, 3);
    assert.ok(directRace[0].sourceId || directRace[0].duplicate);
    segregatedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-segregated" });
    assert.equal(segregatedBalance.spendable, 3999);
    assert.equal(segregatedBalance.legacySegregated, 15427);
    const directHold = (await admin.query(`SELECT universal_credit_source_id
      FROM financial_credit_ledger WHERE idempotency_key=$1`,
    [directRace[0].idempotencyKey])).rows[0];
    assert.ok(directHold.universal_credit_source_id);
    assert.equal((await manualCredits.liberarCreditoManualUniversal({
      pool, reserva: directRace[0] })).released, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-segregated" })).spendable, 4000);

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
    const directConfirmed = await manualCredits.reservarCreditoManualUniversal({
      pool, workspaceId: "ws-segregated-new", operationId: "manual-ack",
      destinationId: "destination-one" });
    assert.equal(directConfirmed.ok, true);
    assert.ok(directConfirmed.sourceId);
    assert.equal((await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: directConfirmed })).debited, true);
    assert.equal((await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: directConfirmed })).duplicate, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-segregated-new" })).spendable, 99);
    const activeManual = await manualCredits.reservarCreditoManualUniversal({
      pool, workspaceId: "ws-onboard-paid", operationId: "active-direct",
      destinationId: "destination-b" });
    assert.equal(activeManual.ok, true);
    assert.ok(activeManual.sourceId);
    assert.equal((await manualCredits.liberarCreditoManualUniversal({
      pool, reserva: activeManual })).returned, true);
    const directDebit = (await admin.query(`SELECT amount,universal_credit_source_id
      FROM financial_credit_ledger WHERE idempotency_key=$1`,
    [directConfirmed.idempotencyKey])).rows[0];
    assert.equal(Number(directDebit.amount), -1);
    assert.equal(directDebit.universal_credit_source_id, directConfirmed.sourceId);

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

    // The HTTP route used by the official extension must exercise the real
    // dispatcher and PostgreSQL authority together, without a live provider.
    const workspaceHttp = "ws-segregated";
    const memory = new Map();
    const storageOptions = {
      now: () => new Date().toISOString(),
      idFactory: () => "source_http_offer",
      readClienteJson: (workspace, file, fallback) =>
        memory.get(`${workspace}:${file}`) ?? fallback,
      writeClienteJson: (workspace, file, value) => {
        memory.set(`${workspace}:${file}`, value);
        return value;
      }
    };
    const offerHttp = manualStorage.criarOfertaManualV2(workspaceHttp, {
      marketplace: "mercadolivre", titulo: "Synthetic source route",
      urlOriginal: "https://produto.mercadolivre.com.br/MLB-123",
      urlAfiliada: "https://meli.la/source-route", precoAtual: 99.9
    }, storageOptions);
    let providerCalls = 0;
    const destination = { id: "wa_pg", nome: "WA synthetic", tipo: "whatsapp",
      ativo: true, conexaoId: "session_pg", gruposWhatsapp: ["synthetic@g.us"] };
    const app = express();
    app.use(express.json());
    app.use("/manual-v2", criarRotasManualV2({
      getClienteId: req => req.header("x-cliente-id"),
      storageOptions, destinosPorCliente: { [workspaceHttp]: [destination] },
      configsPorCliente: {}, sessoes: { session_pg: {} },
      statusSessao: { session_pg: "open" },
      getPlanoUsuario: () => ({ recursos: { whatsapp: true } }),
      enviarOfertaManualV2, montarMensagemOferta: offer => offer.titulo,
      enviarWhatsApp: async () => { providerCalls += 1; },
      reservarCreditoEnvio: entry => manualCredits.reservarCreditoManualUniversal({
        pool, workspaceId: entry.clienteId, operationId: entry.operationId,
        destinationId: entry.destinoId }),
      confirmarCreditoEnvio: reserva =>
        manualCredits.confirmarCreditoManualUniversal({ pool, reserva }),
      liberarCreditoEnvio: reserva =>
        manualCredits.liberarCreditoManualUniversal({ pool, reserva })
    }));
    const server = await new Promise(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
      const route = `/manual-v2/ofertas/${offerHttp.id}/enviar-agora`;
      const send = async workspace => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
          method: "POST", headers: { "content-type": "application/json",
            "x-cliente-id": workspace, "Idempotency-Key": "a".repeat(64) },
          body: JSON.stringify({ destinosIds: [destination.id] })
        });
        return { status: response.status, body: await response.json() };
      };
      const first = await send(workspaceHttp);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.envio.creditosDebitados, 1);
      assert.equal(providerCalls, 1);
      assert.equal((await credits.readBalance({ pool,
        workspaceId: workspaceHttp })).spendable, 3999);
      const retry = await send(workspaceHttp);
      assert.equal(retry.body.idempotencyReplayed, true);
      assert.equal(providerCalls, 1, "HTTP retry cannot send twice");
      const other = await send("ws-onboard-paid");
      assert.equal(other.status, 404, "other workspace cannot access the offer");
      assert.equal(providerCalls, 1);
      const ledgerRoute = (await admin.query(`SELECT universal_credit_source_id,
          universal_movement_type FROM financial_credit_ledger
        WHERE cliente_id=$1 AND universal_movement_type='TARGET_DEBIT'
        ORDER BY created_at DESC LIMIT 1`, [workspaceHttp])).rows[0];
      assert.ok(ledgerRoute.universal_credit_source_id,
        "HTTP debit must retain the original source");
      assert.equal(ledgerRoute.universal_movement_type, "TARGET_DEBIT");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    // Distinct operations must compete for the same source balance, even
    // when the caller retries concurrently from different destinations.
    await credits.prepareRegistrationOpening({ pool,
      workspaceId: "ws-ten-contenders", openingBalance: 0, planId: "ultimate" });
    await credits.reconcileRegistrationOpening({ pool,
      workspaceId: "ws-ten-contenders", userExists: true });
    const oneCredit = await insertCycle(admin, {
      workspace: "ws-ten-contenders", value: 1,
      origin: "financial_event_v1", suffix: "ten-contenders" });
    await credits.applyFinancialLedger({ pool, ledgerId: oneCredit });
    const contenders = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      manualCredits.reservarCreditoManualUniversal({ pool,
        workspaceId: "ws-ten-contenders", operationId: `offer-${index}`,
        destinationId: `destination-${index}` })));
    assert.equal(contenders.filter(item => item.ok && !item.duplicate).length, 1);
    assert.equal(contenders.filter(item => !item.ok).length, 9);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-ten-contenders" })).spendable, 0);
    const winner = contenders.find(item => item.ok);
    assert.equal((await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: winner })).debited, true);
    assert.equal((await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: winner })).duplicate, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-ten-contenders" })).balance, 0);
    const contenderNextCycle = await insertCycle(admin, {
      workspace: "ws-ten-contenders", value: 2,
      origin: "admin_courtesy", suffix: "concurrent-next-cycle" });
    const mixed = await Promise.all([
      credits.applyFinancialLedger({ pool, ledgerId: contenderNextCycle }),
      credits.addAdminBalance({ pool, workspaceId: "ws-ten-contenders",
        amount: 3, idempotencyKey: "concurrent-admin-topup",
        operatorId: "synthetic-admin" }),
      ...Array.from({ length: 10 }, (_, index) =>
        manualCredits.reservarCreditoManualUniversal({ pool,
          workspaceId: "ws-ten-contenders", operationId: `mixed-${index}`,
          destinationId: `destination-${index}` }))
    ]);
    assert.equal(mixed[0].ok, true);
    assert.equal(mixed[1].ok, true);
    const mixedHolds = mixed.slice(2).filter(item => item.ok);
    assert.ok(mixedHolds.length <= 5,
      "concurrent sends cannot reserve more than the new cycle and top-up");
    const mixedBalance = await credits.readBalance({ pool,
      workspaceId: "ws-ten-contenders" });
    assert.equal(mixedBalance.balance, 5);
    assert.equal(mixedBalance.reserved, mixedHolds.length);
    assert.equal(mixedBalance.spendable, 5 - mixedHolds.length);

    // Full migration path: a historical top-up proves that a grant happened,
    // not how much remains after unattributed legacy debits. Preserve it in
    // unclassified history until a new source is legitimately granted.
    await enqueueOne(admin, pool, "ws-v2-transition", "legacy-destination", 80);
    const historicalClaim = await claimAndStart(pool, "ws-v2-transition");
    await makeAmbiguous(admin, pool, "ws-v2-transition", historicalClaim);
    const historicalTopup = await credits.addAdminBalance({ pool,
      workspaceId: "ws-v2-transition", amount: 30,
      idempotencyKey: "v2-historical-topup", operatorId: "fixture" });
    assert.equal(historicalTopup.ok, true);
    const transitionShadow = (await prepareShadow(pool,
      "ws-v2-transition")).shadow;
    assert.equal(transitionShadow.reserved, 1);
    assert.equal(transitionShadow.unclassifiedAvailable, 129);
    await sources.activateWorkspaceSegregated({ pool,
      workspaceId: "ws-v2-transition",
      baselineHash: transitionShadow.baselineHash });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-v2-transition" })).spendable, 0);
    const currentCourtesy = await insertCycle(admin, {
      workspace: "ws-v2-transition", value: 4,
      origin: "admin_courtesy", suffix: "v2-current" });
    const [courtesyFirst, courtesyRetry, newTopup] = await Promise.all([
      credits.applyFinancialLedger({ pool, ledgerId: currentCourtesy }),
      credits.applyFinancialLedger({ pool, ledgerId: currentCourtesy }),
      credits.addAdminBalance({ pool, workspaceId: "ws-v2-transition",
        amount: 2, idempotencyKey: "v2-current-topup",
        operatorId: "fixture" })
    ]);
    assert.equal([courtesyFirst, courtesyRetry]
      .filter(item => item.applied === true).length, 1);
    assert.equal(newTopup.ok, true);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-v2-transition" })).spendable, 6);
    const migratedContenders = await Promise.all(Array.from({ length: 10 },
      (_, index) => manualCredits.reservarCreditoManualUniversal({ pool,
        workspaceId: "ws-v2-transition", operationId: `new-offer-${index}`,
        destinationId: `new-destination-${index}` })));
    const migratedHolds = migratedContenders.filter(item => item.ok);
    assert.ok(migratedHolds.length > 0 && migratedHolds.length <= 6);
    assert.ok(migratedHolds.every(item => item.sourceId));
    const migratedAck = await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: migratedHolds[0] });
    assert.equal(migratedAck.debited, true);
    const transitionOldAck = await durableAck(admin, historicalClaim,
      "provider-v2-historical-ack");
    await queue.confirmSend({ pool, destinationId: historicalClaim.id,
      leaseToken: historicalClaim.leaseToken, ...transitionOldAck });
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws-v2-transition" })).legacySegregated, 129);
    await assert.rejects(sources.rollbackSegregatedWorkspace({ pool,
      workspaceId: "ws-v2-transition",
      baselineHash: transitionShadow.baselineHash }),
    /rollback_balance_changed|rollback_movements_exist/);
    const pixWhileSending = await insertCycle(admin, {
      workspace: "ws-v2-transition", value: 3,
      origin: "financial_event_v1", suffix: "v2-pix" });
    const [pixResult, concurrentSend] = await Promise.all([
      credits.applyFinancialLedger({ pool, ledgerId: pixWhileSending }),
      manualCredits.reservarCreditoManualUniversal({ pool,
        workspaceId: "ws-v2-transition", operationId: "pix-race-offer",
        destinationId: "pix-race-destination" })
    ]);
    assert.equal(pixResult.ok, true);
    assert.ok(concurrentSend.ok === true ||
      concurrentSend.reason === "sem_creditos");
    const v2Conservation = (await admin.query(`SELECT COUNT(*)::int AS bad
      FROM engine_universal_credit_sources
      WHERE workspace_id='ws-v2-transition'
        AND granted<>available+reserved+consumed+expired`)).rows[0];
    assert.equal(v2Conservation.bad, 0);

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
      multiworkspaceIsolated: true,
      fullLegacyToSegregatedFlow: true
    }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
