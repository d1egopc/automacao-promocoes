"use strict";

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
const {
  creditoDisponivelSomenteLeitura
} = require("../modules/engine/universal-credit-eligibility.service");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1",
  port: Number(process.env.UF_TEST_PG_PORT || 55433), user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const expectedServerHost = process.env.UF_TEST_PG_EXPECTED_SERVER_HOST || config.host;
const expectedServerPort = Number(process.env.UF_TEST_PG_EXPECTED_SERVER_PORT || config.port);
const expectedDataDir = process.env.UF_TEST_PG_EXPECTED_DATA_DIR ||
  path.join(root, ".local-postgres", "data");
const schema = `uf_preflight_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-11-03T12:00:00.000Z";
const now = new Date("2026-11-03T12:30:00.000Z");
const sourceHash = crypto.createHash("sha256").update("preflight-fixture")
  .digest("hex");
const paidPlan = { nome: "Pro", creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento", creditosPorCiclo: 20, cicloDias: 30 };

function user(overrides = {}) {
  return { id: "fixture-workspace", assinaturaStatus: "ativa",
    pagamentoUltimoStatus: "aprovado",
    ultimoCicloCreditoId: "payment-before-fixture",
    cicloAtualInicio: "2026-11-01T00:00:00.000Z",
    cicloAtualFim: "2026-12-01T00:00:00.000Z", ...overrides };
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
    pool = new Pool({ ...config, max: 6,
      options: `-c search_path=${schema},public` });

    for (const [workspace, balance] of [["valid", 5], ["expired", 9],
      ["pending", 7], ["zero", 0], ["payment", 3], ["other", 4]]) {
      await credits.openBalance({ pool, workspaceId: workspace,
        operationEpochStartedAt: epoch, openingBalance: balance, sourceHash });
    }
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    // Hold aberto reduz somente o disponivel. Nao pode acionar renovacao nem
    // impedir outra operacao legitima enquanto ainda houver capacidade.
    await admin.query(`UPDATE engine_universal_credit_balances
      SET reserved=1 WHERE workspace_id='valid'`);
    const valid = await creditoDisponivelSomenteLeitura({
      usuario: user(), plano: paidPlan, workspaceId: "valid", quantidade: 1,
      agora: now, readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(valid.ok, true);
    assert.equal(valid.balance, 5);
    assert.equal(valid.reserved, 1);
    assert.equal(valid.available, 4);

    const expired = await creditoDisponivelSomenteLeitura({
      usuario: user({ cicloAtualFim: "2026-11-01T00:00:00.000Z" }),
      plano: paidPlan, workspaceId: "expired", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, "credit_cycle_expired");

    const pending = await creditoDisponivelSomenteLeitura({
      usuario: user({ assinaturaStatus: "pagamento_pendente",
        creditosAdminManualAtivo: true,
        creditosAdminManualExpiraEm: "2026-11-02T00:00:00.000Z" }),
      plano: paidPlan, workspaceId: "pending", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(pending.ok, false);
    assert.equal((await admin.query(`SELECT count(*)::int AS total FROM
      financial_credit_ledger WHERE universal_movement_type='POLICY_BALANCE_SET'`))
      .rows[0].total, 0);

    const zero = await creditoDisponivelSomenteLeitura({
      usuario: user(), plano: paidPlan, workspaceId: "zero", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(zero.ok, false);
    assert.equal(zero.reason, "workspace_credits_unavailable");

    await assert.rejects(creditoDisponivelSomenteLeitura({
      usuario: user(), plano: paidPlan, workspaceId: "unavailable", agora: now,
      readBalance: async () => { throw new Error("fixture_ledger_unavailable"); }
    }), /fixture_ledger_unavailable/);

    const paymentUser = user({ id: "payment", assinaturaStatus: "suspensa",
      pagamentoUltimoStatus: "vencido_sem_pagamento",
      ultimoCicloCreditoId: "old-payment",
      cicloAtualFim: "2026-11-01T00:00:00.000Z" });
    const beforePayment = await creditoDisponivelSomenteLeitura({
      usuario: paymentUser, plano: paidPlan, workspaceId: "payment", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(beforePayment.ok, false);
    const approved = saas.aplicarPagamentoSimulado(paymentUser, paidPlan, {
      estado: "aprovado", pagamentoId: "payment-current-fixture", agora: now
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.alterou, true);
    const cycle = await credits.registerSimulatedCycle({ pool,
      workspaceId: "payment", paymentId: "payment-current-fixture",
      planId: "Pro", amount: 20,
      cycleStart: paymentUser.cicloAtualInicio,
      cycleEnd: paymentUser.cicloAtualFim });
    assert.equal((await credits.applyFinancialLedger({ pool,
      ledgerId: cycle.ledgerId })).applied, true);
    assert.equal((await credits.registerSimulatedCycle({ pool,
      workspaceId: "payment", paymentId: "payment-current-fixture",
      planId: "Pro", amount: 20,
      cycleStart: paymentUser.cicloAtualInicio,
      cycleEnd: paymentUser.cicloAtualFim })).duplicate, true);
    const afterPayment = await creditoDisponivelSomenteLeitura({
      usuario: paymentUser, plano: paidPlan, workspaceId: "payment", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(afterPayment.ok, true);
    assert.equal(afterPayment.balance, 20);

    // Um workspace invalido nao interfere nos demais.
    const other = await creditoDisponivelSomenteLeitura({
      usuario: user({ ultimoCicloCreditoId: "other-payment" }),
      plano: paidPlan, workspaceId: "other", agora: now,
      readBalance: input => credits.readBalance({ pool, ...input })
    });
    assert.equal(other.ok, true);

    console.log("UNIVERSAL_CREDIT_PREFLIGHT_TEST_PASS", JSON.stringify({
      postgres17: true,
      validCycleWithHolds: true,
      expiredCycleBlocked: true,
      noPolicyMutation: true,
      zeroBlocked: true,
      ledgerUnavailableFailClosed: true,
      approvedPaymentRestoresIdempotently: true,
      workspaceIsolation: true
    }));
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
