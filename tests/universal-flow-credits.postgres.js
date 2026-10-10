"use strict";

// Disposable PostgreSQL 17 only. This test deliberately never accepts an
// environment-supplied database URL or a production fallback.
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
const saas = require("../utils/saas-fundacao");
const queue = require("../modules/engine/universal-queue.repository");
const { consultarHistoricoUniversal } =
  require("../modules/engine/universal-history.read-model");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_credit_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-09T12:00:00.000Z";
const sourceHash = crypto.createHash("sha256").update("local-opening-snapshot")
  .digest("hex");

async function offer(client, workspace) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata)
    VALUES ('radar','radar',$1,'{}'::jsonb) RETURNING id`,
  ["2026-10-09T12:05:00.000Z"])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada') RETURNING id`,
  [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { offerId, jobId };
}

async function addTargets(client, pool, workspace, count) {
  const { offerId, jobId } = await offer(client, workspace);
  await queue.enqueue({ pool, workspaceId: workspace, jobId, ofertaId: offerId,
    itemPayload: { title: "fixture" },
    destinations: Array.from({ length: count }, (_, n) => ({
      destinationId: `${workspace}_destination_${n}`,
      targetKey: `${workspace}_target_${n}`, channel: "whatsapp" })) });
  assert.equal((await queue.preflightWorkspace({ pool, workspaceId: workspace })).ok,
    true);
  const claims = [];
  for (let n = 0; n < count; n++) {
    const claim = await queue.claimDestination({ pool, workspaceId: workspace });
    assert.equal(claim.ok, true);
    assert.equal(claim.empty, false);
    claims.push(claim);
  }
  return claims;
}

async function checkpoint(client, claim) {
  const attemptId = crypto.randomUUID();
  const messageId = `provider_${claim.id}`;
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id, `universal_${claim.queue_item_id}`,
    `${claim.channel}:${claim.destination_id}`, `grupo:${claim.target_key}`,
    attemptId, messageId]);
  return { attemptId, messageId };
}

async function counts(client, workspace) {
  const result = await client.query(`SELECT universal_movement_type,count(*)::int AS total
    FROM financial_credit_ledger WHERE cliente_id=$1
      AND operation_epoch_started_at=$2
    GROUP BY universal_movement_type`, [workspace, epoch]);
  return Object.fromEntries(result.rows.map(row =>
    [row.universal_movement_type, row.total]));
}

async function main() {
  const admin = new Client(config);
  let pool;
  let created = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
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
    for (const [workspace, balance] of [["ws_A", 2], ["ws_B", 1],
      ["ws_C", 2], ["ws_D", 1]]) {
      const first = await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: balance, sourceHash });
      assert.equal(first.created, true);
      const again = await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: balance, sourceHash });
      assert.equal(again.created, false);
      assert.equal((await counts(admin, workspace)).OPENING_BALANCE, 1);
    }
    await assert.rejects(credits.openBalance({ pool, workspaceId: "ws_A",
      operationEpochStartedAt: epoch, openingBalance: 3, sourceHash }),
    /opening_conflict/);
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    // Registration intent survives the JSON/PG boundary. No opening exists
    // before the account is actually persisted; recovery opens it once.
    const signupUsers = [];
    let persistedSignup = null;
    await assert.rejects(saas.executarCadastroAtomico({
      body: { nome: "Local", email: "local@example.com",
        senha: "12345678", plano: "Local" },
      planos: { local: { nome: "Local", visivelPublicamente: true,
        contratavel: true, entradaBeta: true, renovacaoCreditos: "sem_renovacao",
        creditosModelo: "ciclo", marketplaces: ["amazon"],
        recursos: { whatsapp: true },
        limites: { creditosPorCiclo: 4, cicloDias: 30 } } },
      usuarios: signupUsers, configsPorCliente: {},
      saasConfig: { cadastroPublicoAtivo: true, betaAtivo: false },
      gerarId: () => "ws_signup", gerarSenhaHash: async () => "fixture_hash",
      salvarUsuarios: () => { persistedSignup = structuredClone(signupUsers); },
      salvarConfigsClientes: () => {},
      antesDePersistir: async user => {
        await credits.prepareRegistrationOpening({ pool,
          workspaceId: user.id, openingBalance: user.creditos,
          planId: user.plano });
        delete user.creditos;
      },
      depoisDePersistir: async () => {
        throw new Error("fixture_crash_after_json");
      }
    }), /fixture_crash_after_json/);
    assert.equal(persistedSignup.length, 1);
    assert.equal(Object.hasOwn(persistedSignup[0], "creditos"), false);
    await credits.prepareRegistrationOpening({ pool, workspaceId: "ws_signup",
      openingBalance: 4, planId: "Local" });
    assert.equal((await credits.recoverRegistrationOpenings({ pool,
      userExists: () => false })).completed, 0);
    await assert.rejects(credits.readBalance({ pool,
      workspaceId: "ws_signup" }), /opening_missing/);
    assert.equal((await credits.recoverRegistrationOpenings({ pool,
      userExists: workspace => workspace === "ws_signup" })).completed, 1);
    assert.equal((await credits.recoverRegistrationOpenings({ pool,
      userExists: () => true })).completed, 0);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_signup" })).balance, 4);
    assert.equal((await counts(admin, "ws_signup")).OPENING_BALANCE, 1);
    await assert.rejects(credits.prepareRegistrationOpening({ pool,
      workspaceId: "ws_signup", openingBalance: 5, planId: "Local" }),
    /opening_conflict/);

    const cycle = await credits.registerSimulatedCycle({ pool,
      workspaceId: "ws_signup", paymentId: "local_pay_1", planId: "Local",
      amount: 8, cycleStart: "2026-10-10T00:00:00Z",
      cycleEnd: "2026-11-10T00:00:00Z" });
    assert.equal(cycle.duplicate, false);
    const duplicateCycle = await credits.registerSimulatedCycle({ pool,
      workspaceId: "ws_signup", paymentId: "local_pay_1", planId: "Local",
      amount: 8, cycleStart: "2026-10-10T00:00:00Z",
      cycleEnd: "2026-11-10T00:00:00Z" });
    assert.equal(duplicateCycle.ledgerId, cycle.ledgerId);
    assert.equal(duplicateCycle.duplicate, true);
    await assert.rejects(credits.registerSimulatedCycle({ pool,
      workspaceId: "ws_signup", paymentId: "local_pay_1", planId: "Other",
      amount: 8, cycleStart: "2026-10-10T00:00:00Z",
      cycleEnd: "2026-11-10T00:00:00Z" }), /idempotency_conflict/);
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: cycle.ledgerId })).applied, true);
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: cycle.ledgerId })).applied, false);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "ws_signup" })).balance, 8);
    assert.equal((await counts(admin, "ws_signup")).FINANCIAL_MOVEMENT, 1);
    assert.equal((await credits.registerSimulatedCycle({ pool,
      workspaceId: "ws_signup", paymentId: "local_pay_1", planId: "Local",
      amount: 3, allowCreate: false })).duplicate, true);
    assert.equal((await credits.registerSimulatedCycle({ pool,
      workspaceId: "ws_signup", paymentId: "legacy_pay_1", planId: "Local",
      amount: 8, allowCreate: false })).previousEpoch, true);
    assert.equal((await counts(admin, "ws_signup")).FINANCIAL_MOVEMENT, 1);

    const [a1, a2] = await addTargets(admin, pool, "ws_A", 2);
    for (const claim of [a1, a2]) {
      assert.equal((await queue.markSendStarted({ pool, destinationId: claim.id,
        leaseToken: claim.leaseToken,
        commercialCta: claim.id === a1.id ? {
          linkFinal: "https://go.optimuspromo.com.br/r/fixture-a"
        } : {} })).ok, true);
    }
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_A" })).balance, 2);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_A" })).available, 0);
    await assert.rejects(queue.confirmSend({ pool, destinationId: a1.id,
      leaseToken: a1.leaseToken, confirmationKey: crypto.randomUUID(),
      providerMessageId: "not_durable" }), /not_durable/);
    const firstAck = await checkpoint(admin, a1);
    const confirmed = await queue.confirmSend({ pool, destinationId: a1.id,
      leaseToken: a1.leaseToken, confirmationKey: firstAck.attemptId,
      providerMessageId: firstAck.messageId });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.duplicate, false);
    assert.equal((await queue.confirmSend({ pool, destinationId: a1.id,
      leaseToken: a1.leaseToken, confirmationKey: firstAck.attemptId,
      providerMessageId: firstAck.messageId })).duplicate, true);
    assert.equal((await counts(admin, "ws_A")).TARGET_DEBIT, 1);

    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [a2.id]);
    const ambiguous = await queue.preflightWorkspace({ pool, workspaceId: "ws_A" });
    assert.equal(ambiguous.health, "AMBIGUOUS");
    assert.equal((await counts(admin, "ws_A")).TARGET_DEBIT, 1);
    const secondAck = await checkpoint(admin, a2);
    const recovered = await queue.preflightWorkspace({ pool, workspaceId: "ws_A" });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recoveredAcks, 1);
    assert.equal((await counts(admin, "ws_A")).TARGET_DEBIT, 2);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_A" })).balance, 0);
    assert.equal((await queue.confirmSend({ pool, destinationId: a2.id,
      leaseToken: a2.leaseToken, confirmationKey: secondAck.attemptId,
      providerMessageId: secondAck.messageId })).duplicate, true);
    assert.equal((await credits.rollbackBalanceProjection({ pool,
      workspaceId: "ws_A" })).rollbackBalance, 0);

    const [b1] = await addTargets(admin, pool, "ws_B", 1);
    await queue.completeWithoutSend({ pool, destinationId: b1.id,
      leaseToken: b1.leaseToken, reason: "fixture_no_send" });
    assert.equal((await counts(admin, "ws_B")).TARGET_DEBIT, undefined);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_B" })).balance, 1);
    const cycleLedger = (await admin.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,idempotency_key,
       projection_status,metadata)
      VALUES ('ws_B','cycle_credit',3,'replace_cycle',
        'local-cycle-ws-b','pending','{}'::jsonb) RETURNING id`)).rows[0].id;
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: cycleLedger })).applied, true);
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: cycleLedger })).applied, false);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_B" })).balance, 3);
    const refundLedger = (await admin.query(`INSERT INTO financial_credit_ledger
      (cliente_id,ledger_type,amount,balance_policy,idempotency_key,
       projection_status,metadata)
      VALUES ('ws_B','refund_adjustment',-1,'add',
        'local-refund-ws-b','pending','{}'::jsonb) RETURNING id`)).rows[0].id;
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: refundLedger })).applied, true);
    assert.equal((await credits.rollbackBalanceProjection({ pool,
      workspaceId: "ws_B" })).rollbackBalance, 2);
    // Financial projection may update plan metadata in JSON, but must not
    // project the post-epoch balance back into the legacy credit field.
    const previousUrl = process.env.DATABASE_URL;
    const previousSslMode = process.env.PGSSLMODE;
    process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:55433/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
    process.env.PGSSLMODE = "disable";
    const { reconciliarLedgerFinanceiroPendente } =
      require("../modules/financeiro/financeiro.service");
    const { criarRepositorioFinanceiroPostgres } =
      require("../modules/financeiro/financeiro.repository");
    const { getEnginePool } = require("../modules/engine/database");
    const legacyUser = { id: "ws_B", creditos: 99, plano: "old_plan" };
    let jsonSaves = 0;
    const financialRepository = {
      listarLedgerPendente: async () => (await admin.query(`SELECT * FROM
        financial_credit_ledger WHERE cliente_id='ws_B'
        AND projection_status='pending' ORDER BY created_at,id`)).rows,
      marcarLedgerProjetado: async id => admin.query(`UPDATE financial_credit_ledger
        SET projection_status='projected' WHERE id=$1`, [id]),
      marcarLedgerFalha: async (id, error) => admin.query(`UPDATE
        financial_credit_ledger SET projection_error=$2 WHERE id=$1`, [id, error])
    };
    try {
      const projection = await reconciliarLedgerFinanceiroPendente({
        repositorio: financialRepository,
        lerUsuarios: async () => [legacyUser],
        salvarUsuarios: async () => { jsonSaves += 1; }
      });
      assert.equal(projection.falhas, 0);
      assert.equal(projection.projetados, 2);
      assert.equal(legacyUser.creditos, 99);
      assert.equal((await credits.readBalance({ pool, workspaceId: "ws_B" })).balance, 2);
      assert.equal(jsonSaves, 2);
      const signupUser = { id: "ws_signup", creditos: 999,
        plano: "before_payment" };
      const simulatedProjection = await reconciliarLedgerFinanceiroPendente({
        repositorio: criarRepositorioFinanceiroPostgres({ pool }),
        lerUsuarios: async () => [signupUser],
        salvarUsuarios: async () => { jsonSaves += 1; },
        limite: 1, filtro: { ledgerId: cycle.ledgerId }
      });
      assert.equal(simulatedProjection.projetados, 1);
      assert.equal(simulatedProjection.falhas, 0);
      assert.equal(signupUser.creditos, 999);
      assert.equal(signupUser.plano, "Local");
      assert.equal(signupUser.ultimoCicloCreditoId, "local_pay_1");
      assert.equal(signupUser.auditoriaAssinatura.length, 1);
      assert.equal((await admin.query(`SELECT projection_status FROM
        financial_credit_ledger WHERE id=$1`, [cycle.ledgerId])).rows[0]
        .projection_status, "projected");
    } finally {
      await getEnginePool().end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousSslMode === undefined) delete process.env.PGSSLMODE;
      else process.env.PGSSLMODE = previousSslMode;
    }
    assert.equal((await credits.setAdminBalance({ pool, workspaceId: "ws_B",
      amount: 5, idempotencyKey: "universal:admin:fixture-ws-b" })).duplicate,
    false);
    assert.equal((await credits.setAdminBalance({ pool, workspaceId: "ws_B",
      amount: 5, idempotencyKey: "universal:admin:fixture-ws-b" })).duplicate,
    true);
    assert.equal((await credits.rollbackBalanceProjection({ pool,
      workspaceId: "ws_B" })).rollbackBalance, 5);

    const [c1, c2] = await addTargets(admin, pool, "ws_C", 2);
    for (const claim of [c1, c2]) {
      await queue.markSendStarted({ pool, destinationId: claim.id,
        leaseToken: claim.leaseToken });
    }
    const [cAck1, cAck2] = await Promise.all([checkpoint(admin, c1),
      checkpoint(admin, c2)]);
    await Promise.all([[c1, cAck1], [c2, cAck2]].map(([claim, ack]) =>
      queue.confirmSend({ pool, destinationId: claim.id,
        leaseToken: claim.leaseToken, confirmationKey: ack.attemptId,
        providerMessageId: ack.messageId })));
    assert.equal((await counts(admin, "ws_C")).TARGET_DEBIT, 2);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_C" })).balance, 0);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_B" })).balance, 5);
    const historyA = await consultarHistoricoUniversal({ pool,
      workspaceId: "ws_A", from: epoch, to: "2099-01-01T00:00:00.000Z" });
    assert.equal(historyA.metrics.enviadas, 1);
    assert.equal(historyA.items[0].resultadoFinalPublico, "enviada");
    assert.equal(historyA.items[0].destinos.filter(target =>
      target.status === "sent" && target.credit_debited === true).length, 2);
    const vitrineA = await queue.claimVitrineProjection({ pool });
    assert.equal(vitrineA.empty, false);
    assert.equal(vitrineA.workspaceId, "ws_A");
    assert.equal(vitrineA.confirmed, 2);
    assert.equal(vitrineA.commercialCta.linkFinal,
      "https://go.optimuspromo.com.br/r/fixture-a");
    assert.equal((await queue.finishVitrineProjection({ pool,
      claim: vitrineA, result: "completed" })).state, "completed");
    const vitrineC = await queue.claimVitrineProjection({ pool });
    assert.equal(vitrineC.workspaceId, "ws_C");
    await queue.finishVitrineProjection({ pool, claim: vitrineC,
      result: "skipped", reason: "vitrine_inativa" });
    assert.equal((await queue.claimVitrineProjection({ pool })).empty, true);

    // Force a failure after the ledger + target updates but before the item
    // summary update. PostgreSQL must roll back all effects; the same durable
    // ACK is then recovered without another provider call.
    const [d1] = await addTargets(admin, pool, "ws_D", 1);
    await queue.markSendStarted({ pool, destinationId: d1.id,
      leaseToken: d1.leaseToken });
    const dAck = await checkpoint(admin, d1);
    await admin.query(`CREATE FUNCTION fail_universal_summary_fixture()
      RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        RAISE EXCEPTION 'fixture_summary_crash';
      END$$`);
    await admin.query(`CREATE TRIGGER fail_universal_summary_fixture
      BEFORE UPDATE ON engine_universal_queue_items FOR EACH ROW
      EXECUTE FUNCTION fail_universal_summary_fixture()`);
    await assert.rejects(queue.confirmSend({ pool, destinationId: d1.id,
      leaseToken: d1.leaseToken, confirmationKey: dAck.attemptId,
      providerMessageId: dAck.messageId }), /fixture_summary_crash/);
    assert.equal((await counts(admin, "ws_D")).TARGET_DEBIT, undefined);
    assert.equal((await admin.query(`SELECT status FROM
      engine_universal_queue_destinations WHERE id=$1`, [d1.id])).rows[0].status,
    "send_started");
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_D" })).balance, 1);
    await admin.query(`DROP TRIGGER fail_universal_summary_fixture
      ON engine_universal_queue_items`);
    await admin.query(`DROP FUNCTION fail_universal_summary_fixture()`);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [d1.id]);
    const recoveredD = await queue.preflightWorkspace({ pool, workspaceId: "ws_D" });
    assert.equal(recoveredD.recoveredAcks, 1);
    assert.equal((await counts(admin, "ws_D")).TARGET_DEBIT, 1);
    assert.equal((await credits.readBalance({ pool, workspaceId: "ws_D" })).balance, 0);
    assert.equal((await queue.claimDestination({ pool, workspaceId: "ws_D" })).empty,
      true);
    const historyD = await consultarHistoricoUniversal({ pool,
      workspaceId: "ws_D", from: epoch, to: "2099-01-01T00:00:00.000Z" });
    assert.equal(historyD.metrics.enviadas, 1);
    const vitrineD = await queue.claimVitrineProjection({ pool });
    assert.equal(vitrineD.workspaceId, "ws_D");
    await admin.query(`UPDATE engine_universal_vitrine_outbox
      SET lease_until=clock_timestamp()-interval '1 second'
      WHERE operation_epoch_started_at=$1 AND queue_item_id=$2`,
    [epoch, vitrineD.queueItemId]);
    const vitrineRecovered = await queue.claimVitrineProjection({ pool });
    assert.equal(vitrineRecovered.queueItemId, vitrineD.queueItemId);
    assert.notEqual(vitrineRecovered.leaseToken, vitrineD.leaseToken);
    assert.equal((await queue.finishVitrineProjection({ pool,
      claim: vitrineRecovered, result: "skipped",
      reason: "vitrine_inativa" })).state, "skipped");
    assert.equal((await queue.claimVitrineProjection({ pool })).empty, true);
    console.log("UNIVERSAL_CREDIT_TEST_PASS", JSON.stringify({ schema,
      openingIdempotent: true, targetDebitIdempotent: true,
      ackRecoveryWithoutResend: true, ambiguousFailClosed: true,
      concurrentTargets: true, workspaceIsolation: true,
      atomicCrashRollbackAndRecovery: true, historyTerminalFactual: true,
      postEpochFinancialMovement: true, rollbackProjection: true,
      vitrineProjectionAfterTerminalSend: true,
      vitrineProjectionLeaseRecovery: true }));
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
