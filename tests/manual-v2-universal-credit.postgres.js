"use strict";

// PostgreSQL 17 descartavel somente. Este teste nunca aceita DATABASE_URL nem
// possui fallback para producao.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const universalCredits =
  require("../modules/engine/universal-credits.repository");
const manualCredits =
  require("../modules/manual-v2/manual-universal-credit");
const { enviarOfertaManualV2 } =
  require("../modules/manual-v2/manual-dispatcher");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `manual_credit_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-12T12:00:00.000Z";
const sourceHash = crypto.createHash("sha256")
  .update("manual-v2-universal-credit-fixture").digest("hex");

async function abrirSaldo(pool, workspaceId, openingBalance) {
  return universalCredits.openBalance({ pool, workspaceId,
    operationEpochStartedAt: epoch, openingBalance, sourceHash });
}

async function saldo(pool, workspaceId) {
  return universalCredits.readBalance({ pool, workspaceId });
}

async function movimentos(client, workspaceId) {
  return (await client.query(`SELECT universal_movement_type,amount,
      projection_status,metadata
    FROM financial_credit_ledger
    WHERE cliente_id=$1 AND operation_epoch_started_at=$2
    ORDER BY created_at,id`, [workspaceId, epoch])).rows;
}

function depsDispatcher(pool, workspaceId, providerCalls) {
  const oferta = { id: `offer_${workspaceId}`, clienteId: workspaceId,
    marketplace: "mercadolivre", titulo: "Oferta Manual PG",
    precoAtual: 99.9, urlOriginal: "https://produto.mercadolivre.com.br/MLB-123",
    urlAfiliada: "https://meli.la/manual-pg", status: "salva" };
  return {
    oferta,
    deps: {
      buscarOfertaManualV2: (_clienteId, ofertaId) =>
        ofertaId === oferta.id ? oferta : null,
      destinosPorCliente: { [workspaceId]: [{ id: "wa_pg", nome: "WA PG",
        tipo: "whatsapp", ativo: true, conexaoId: "session_pg",
        gruposWhatsapp: ["120363000000000000@g.us"] }] },
      configsPorCliente: {}, sessoes: { session_pg: { id: "sock_pg" } },
      statusSessao: { session_pg: "open" },
      plano: { recursos: { whatsapp: true } },
      montarMensagemOferta: item => `${item.titulo}\n${item.linkAfiliado}`,
      enviarWhatsApp: async () => { providerCalls.count += 1; },
      reservarCreditoEnvio: entrada =>
        manualCredits.reservarCreditoManualUniversal({ pool,
          workspaceId: entrada.clienteId, operationId: entrada.operationId,
          destinationId: entrada.destinoId }),
      confirmarCreditoEnvio: reserva =>
        manualCredits.confirmarCreditoManualUniversal({ pool, reserva }),
      liberarCreditoEnvio: reserva =>
        manualCredits.liberarCreditoManualUniversal({ pool, reserva })
    }
  };
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

    for (const [workspaceId, openingBalance] of [
      ["ws_pg_1765_json_0", 1765],
      ["ws_pg_1", 1],
      ["ws_pg_0_json_1765", 0],
      ["ws_concorrente", 1],
      ["ws_isolado", 2],
      ["ws_release", 1]
    ]) await abrirSaldo(pool, workspaceId, openingBalance);
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    // JSON legado deliberadamente divergente: nao e passado ao adaptador.
    const legacyUsers = {
      ws_pg_1765_json_0: { creditos: 0 },
      ws_pg_0_json_1765: { creditos: 1765 }
    };
    assert.equal(legacyUsers.ws_pg_1765_json_0.creditos, 0);
    const pgWins = await manualCredits.reservarCreditoManualUniversal({ pool,
      workspaceId: "ws_pg_1765_json_0", operationId: "send-a",
      destinationId: "wa-a" });
    assert.equal(pgWins.ok, true);
    assert.equal((await saldo(pool, "ws_pg_1765_json_0")).available, 1764);
    assert.equal((await manualCredits.liberarCreditoManualUniversal({
      pool, reserva: pgWins })).released, true);
    const providerAllowed = { count: 0 };
    const allowedFlow = depsDispatcher(pool, "ws_pg_1765_json_0", providerAllowed);
    const allowedResult = await enviarOfertaManualV2({
      clienteId: "ws_pg_1765_json_0", ofertaId: allowedFlow.oferta.id,
      destinosIds: ["wa_pg"], attemptId: "attempt-pg-1765"
    }, allowedFlow.deps);
    assert.equal(allowedResult.enviados, 1);
    assert.equal(allowedResult.creditosDebitados, 1);
    assert.equal(providerAllowed.count, 1);
    assert.equal((await saldo(pool, "ws_pg_1765_json_0")).balance, 1764);

    assert.equal(legacyUsers.ws_pg_0_json_1765.creditos, 1765);
    const pgDenies = await manualCredits.reservarCreditoManualUniversal({ pool,
      workspaceId: "ws_pg_0_json_1765", operationId: "send-b",
      destinationId: "wa-b" });
    assert.deepEqual({ ok: pgDenies.ok, reason: pgDenies.reason },
      { ok: false, reason: "sem_creditos" });
    assert.equal((await movimentos(admin, "ws_pg_0_json_1765"))
      .filter(row => row.universal_movement_type === "TARGET_DEBIT").length, 0);
    const providerDenied = { count: 0 };
    const deniedFlow = depsDispatcher(pool, "ws_pg_0_json_1765", providerDenied);
    const deniedResult = await enviarOfertaManualV2({
      clienteId: "ws_pg_0_json_1765", ofertaId: deniedFlow.oferta.id,
      destinosIds: ["wa_pg"], attemptId: "attempt-pg-zero"
    }, deniedFlow.deps);
    assert.equal(deniedResult.enviados, 0);
    assert.equal(deniedResult.resultados[0].erro, "Sem creditos");
    assert.equal(deniedResult.resultados[0].efeitoExternoPossivel, false);
    assert.equal(providerDenied.count, 0);

    const one = await manualCredits.reservarCreditoManualUniversal({ pool,
      workspaceId: "ws_pg_1", operationId: "send-one",
      destinationId: "wa-one" });
    assert.equal(one.ok, true);
    assert.equal((await saldo(pool, "ws_pg_1")).balance, 1);
    assert.equal((await saldo(pool, "ws_pg_1")).available, 0);
    const confirmed = await manualCredits.confirmarCreditoManualUniversal({
      pool, reserva: one });
    assert.equal(confirmed.debited, true);
    assert.equal((await saldo(pool, "ws_pg_1")).balance, 0);
    const duplicateConfirmation =
      await manualCredits.confirmarCreditoManualUniversal({ pool, reserva: one });
    assert.equal(duplicateConfirmation.debited, false);
    assert.equal(duplicateConfirmation.duplicate, true);
    assert.equal((await movimentos(admin, "ws_pg_1"))
      .filter(row => row.universal_movement_type === "TARGET_DEBIT").length, 1);

    const concurrent = await Promise.all([
      manualCredits.reservarCreditoManualUniversal({ pool,
        workspaceId: "ws_concorrente", operationId: "send-c1",
        destinationId: "wa-c1" }),
      manualCredits.reservarCreditoManualUniversal({ pool,
        workspaceId: "ws_concorrente", operationId: "send-c2",
        destinationId: "wa-c2" })
    ]);
    assert.equal(concurrent.filter(result => result.ok).length, 1);
    assert.equal(concurrent.filter(result => result.reason === "sem_creditos").length, 1);
    assert.equal((await saldo(pool, "ws_concorrente")).reserved, 1);

    const released = await manualCredits.reservarCreditoManualUniversal({ pool,
      workspaceId: "ws_release", operationId: "send-release",
      destinationId: "wa-release" });
    assert.equal((await manualCredits.liberarCreditoManualUniversal({
      pool, reserva: released })).released, true);
    assert.deepEqual({ balance: (await saldo(pool, "ws_release")).balance,
      available: (await saldo(pool, "ws_release")).available },
    { balance: 1, available: 1 });
    assert.equal((await movimentos(admin, "ws_release"))
      .filter(row => row.universal_movement_type === "TARGET_DEBIT").length, 0);

    assert.deepEqual({ balance: (await saldo(pool, "ws_isolado")).balance,
      reserved: (await saldo(pool, "ws_isolado")).reserved },
    { balance: 2, reserved: 0 });

    console.log("MANUAL_V2_UNIVERSAL_CREDIT_PASS", JSON.stringify({
      postgres17: true,
      universalPgAuthority: true,
      legacyJsonIgnored: true,
      pg1765Allows: true,
      pgZeroDenies: true,
      debitAfterConfirmationExactlyOnce: true,
      concurrencySafe: true,
      workspaceIsolation: true,
      migrationIdempotent: true
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
