"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { criarRepositorioFinanceiroPostgres } =
  require("../modules/financeiro/financeiro.repository");
const { registrarCicloCortesia } =
  require("../modules/financeiro/cortesia.service");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const credits = require("../modules/engine/universal-credits.repository");
const queue = require("../modules/engine/universal-queue.repository");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1",
  port: Number(process.env.UF_TEST_PG_PORT || 55433), user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const expectedServerHost = process.env.UF_TEST_PG_EXPECTED_SERVER_HOST || config.host;
const expectedServerPort = Number(process.env.UF_TEST_PG_EXPECTED_SERVER_PORT || config.port);
const expectedDataDir = process.env.UF_TEST_PG_EXPECTED_DATA_DIR ||
  path.join(root, ".local-postgres", "data");
const schema = `saas_courtesy_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-11-03T12:00:00.000Z";
const now = new Date("2026-11-03T13:00:00.000Z");
const sourceHash = crypto.createHash("sha256").update("courtesy-pg17-fixture")
  .digest("hex");
const plan = { id: "ultimate", nome: "Ultimate", creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento", creditosPorCiclo: 300, cicloDias: 17 };

async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function offer(client, workspace) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata)
    VALUES ('radar','radar',$1,'{}'::jsonb) RETURNING id`,
  ["2026-11-03T12:05:00.000Z"])).rows[0].id;
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
    itemPayload: { title: "courtesy fixture" },
    destinations: Array.from({ length: count }, (_, index) => ({
      destinationId: `${workspace}_destination_${index}`,
      targetKey: `${workspace}_target_${index}`, channel: "whatsapp"
    })) });
  assert.equal((await queue.preflightWorkspace({ pool,
    workspaceId: workspace })).ok, true);
  const claims = [];
  for (let index = 0; index < count; index++) {
    const claim = await queue.claimDestination({ pool, workspaceId: workspace });
    assert.equal(claim.ok, true);
    assert.equal(claim.empty, false);
    claims.push(claim);
  }
  return claims;
}

async function main() {
  assert.ok(!process.env.DATABASE_URL,
    "Disposable PostgreSQL test refuses inherited DATABASE_URL");
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
    assert.equal(identity.host, expectedServerHost);
    assert.equal(identity.port, expectedServerPort);
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
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    pool = new Pool({ ...config, max: 12,
      options: `-c search_path=${schema},public` });

    for (const [workspace, balance] of [["diego-fixture", 15427],
      ["new-workspace", 0], ["paid-normal", 40], ["free-beta", 25]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: balance, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    const targets = (await addTargets(admin, pool, "diego-fixture", 19))
      .map(claim => claim.id);
    await transaction(pool, async client => {
      for (const targetId of targets) {
        const held = await credits.holdForTargetTx(client, {
          epoch, workspaceId: "diego-fixture", targetId
        });
        assert.equal(held.ok, true);
      }
    });

    const repository = criarRepositorioFinanceiroPostgres({ pool });
    const user = { id: "diego-fixture", plano: "ultimate",
      cortesiaAutomatica: true, cicloAtualFim: "2026-10-01T00:00:00.000Z" };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
      registrarCicloCortesia({ repositorio: repository, usuario: user,
        plano: plan, agora: now, operador: "pg17-fixture" })));
    const ledgerIds = new Set(concurrent.map(item => item.ledgerId).filter(Boolean));
    assert.equal(ledgerIds.size, 1, "concurrency must converge on one ledger");
    const ledgerId = [...ledgerIds][0];
    assert.ok(ledgerId);

    const before = await credits.readBalance({ pool,
      workspaceId: "diego-fixture" });
    assert.equal(before.balance, 15427);
    assert.equal(before.reserved, 19);
    const deferred = await credits.applyFinancialLedger({ pool, ledgerId });
    assert.equal(deferred.ok, false);
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.reason, "universal_financial_holds_or_balance_conflict");
    const pending = (await pool.query(`SELECT projection_status FROM
      financial_credit_ledger WHERE id=$1`, [ledgerId])).rows[0];
    assert.equal(pending.projection_status, "pending");

    const schedulerRetry = await registrarCicloCortesia({ repositorio: repository,
      usuario: user, plano: plan, agora: now, operador: "scheduler-restart" });
    assert.equal(schedulerRetry.ledgerId, ledgerId);
    assert.equal((await pool.query(`SELECT count(*)::int AS total FROM
      financial_credit_ledger WHERE cliente_id='diego-fixture'
        AND metadata->>'origin'='admin_courtesy'`)).rows[0].total, 1);

    // Resolve holds only through their factual contracts: ten ACK-confirmed
    // debits and nine safe releases. No fixture balance is overwritten.
    await transaction(pool, async client => {
      for (const targetId of targets.slice(0, 10)) {
        await credits.settleConfirmedTx(client, {
          epoch, workspaceId: "diego-fixture", targetId
        });
      }
      for (const targetId of targets.slice(10)) {
        await credits.releaseForTargetTx(client, {
          epoch, workspaceId: "diego-fixture", targetId
        });
      }
    });
    const resolved = await credits.readBalance({ pool,
      workspaceId: "diego-fixture" });
    assert.equal(resolved.balance, 15417);
    assert.equal(resolved.reserved, 0);
    const applied = await credits.applyFinancialLedger({ pool, ledgerId });
    assert.equal(applied.ok, true);
    assert.equal(applied.applied, true);
    await repository.marcarLedgerProjetado(ledgerId);
    const after = await credits.readBalance({ pool, workspaceId: "diego-fixture" });
    assert.equal(after.balance, 300);
    assert.equal(after.reserved, 0);

    const restart = await registrarCicloCortesia({ repositorio: repository,
      usuario: { ...user, cicloAtualFim: concurrent[0].cycleEnd }, plano: plan,
      agora: now, operador: "scheduler-after-restart" });
    assert.equal(restart.created, false);
    assert.equal(restart.reason, "courtesy_cycle_current");

    const newWorkspace = await registrarCicloCortesia({ repositorio: repository,
      usuario: { id: "new-workspace", plano: "ultimate",
        cortesiaAutomatica: true, cicloAtualFim: "" }, plano: plan, agora: now });
    assert.equal(newWorkspace.created, true);
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: newWorkspace.ledgerId })).applied, true);
    await repository.marcarLedgerProjetado(newWorkspace.ledgerId);
    assert.equal((await credits.readBalance({ pool,
      workspaceId: "new-workspace" })).balance, 300);

    const normal = await registrarCicloCortesia({ repositorio: repository,
      usuario: { id: "paid-normal", plano: "ultimate",
        cortesiaAutomatica: false }, plano: plan, agora: now });
    assert.equal(normal.reason, "courtesy_disabled");
    const beta = await registrarCicloCortesia({ repositorio: repository,
      usuario: { id: "free-beta", plano: "free_beta",
        cortesiaAutomatica: true },
      plano: { ...plan, id: "free_beta", entradaBeta: true }, agora: now });
    assert.equal(beta.reason, "courtesy_plan_not_cyclic");

    console.log("SAAS_COURTESY_PG17_PASS", JSON.stringify({
      postgres17: true,
      holdsDeferredWithoutMutation: true,
      factualHoldResolution: true,
      schedulerRetryPreserved: true,
      concurrentIdempotency: true,
      restartIdempotency: true,
      newWorkspace: true,
      paidWithoutCourtesyUnchanged: true,
      freeBetaPolicyPreserved: true
    }));
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
