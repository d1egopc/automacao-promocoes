"use strict";

// Disposable PostgreSQL regression: expired destinations are retired outside
// claim selection, while a fresh destination remains immediately claimable.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const queue = require("../modules/engine/universal-queue.repository");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_expired_fresh_${crypto.randomBytes(6).toString("hex")}`;
const epoch = new Date(Date.now() - 60_000).toISOString();
const workspace = "ws_expired_fresh";

async function createOffer(client, index) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES ('synthetic_expired_fresh',
    'synthetic_expired_fresh',$1,'{}'::jsonb) RETURNING id`,
  [new Date(Date.now() - 30_000).toISOString()])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'synthetic_expired_fresh',
    'oferta_criada') RETURNING id`, [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { eventId, offerId, jobId, index };
}

async function main() {
  const admin = new Client(config);
  let pool;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules",
      "engine", "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    await admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    pool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });

    for (let index = 0; index < 100; index += 1) {
      const offer = await createOffer(admin, index);
      await queue.enqueue({ pool, workspaceId: workspace,
        jobId: offer.jobId, ofertaId: offer.offerId,
        itemPayload: { clienteId: workspace, engineOfertaId: offer.offerId,
          titulo: `Expired ${index}`, expiraEm: "2020-01-01T00:00:00.000Z" },
        destinations: [{ destinationId: `expired_${index}`,
          targetKey: `expired_group_${index}`, channel: "whatsapp" }] });
    }
    const fresh = await createOffer(admin, 100);
    await queue.enqueue({ pool, workspaceId: workspace,
      jobId: fresh.jobId, ofertaId: fresh.offerId,
      itemPayload: { clienteId: workspace, engineOfertaId: fresh.offerId,
        titulo: "Fresh", expiraEm: new Date(Date.now() + 3600000).toISOString() },
      destinations: [{ destinationId: "fresh_destination",
        targetKey: "fresh_group", channel: "whatsapp" }] });

    assert.equal((await queue.preflightWorkspace({ pool, workspaceId: workspace })).ok,
      true);
    const firstRetire = await queue.retireExpiredDestinations({ pool,
      workspaceId: workspace, limit: 20 });
    assert.equal(firstRetire.retired, 20);
    const remainingExpired = (await admin.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_destinations d
      JOIN engine_universal_queue_items i ON i.id=d.queue_item_id
      WHERE d.workspace_id=$1 AND d.status='pending'
        AND i.item_payload->>'expiraEm' < '2021-01-01'`, [workspace])).rows[0].n;
    assert.equal(remainingExpired, 80);

    const claim = await queue.claimDestination({ pool, workspaceId: workspace });
    assert.equal(claim.ok, true);
    assert.equal(claim.empty, false);
    assert.equal(claim.destination_id, "fresh_destination",
      "fresh item must bypass older pending expired rows");
    assert.equal(claim.item_payload.titulo, "Fresh");
    await queue.releaseUnstarted({ pool, destinationId: claim.id,
      leaseToken: claim.leaseToken });

    let retired = firstRetire.retired;
    while (true) {
      const batch = await queue.retireExpiredDestinations({ pool,
        workspaceId: workspace });
      retired += batch.retired;
      if (!batch.retired) break;
    }
    assert.equal(retired, 100);
    const facts = (await admin.query(`SELECT
      (SELECT count(*)::int FROM engine_universal_queue_destinations
       WHERE workspace_id=$1 AND status='skipped' AND
       terminal_reason='commercially_expired_before_claim') AS expired_terminal,
      (SELECT count(*)::int FROM engine_universal_queue_destinations
       WHERE workspace_id=$1 AND status='skipped' AND
       terminal_status='not_sent' AND terminal_evidence='commercial_expiry_filter'
       AND resolved_at IS NOT NULL) AS expired_terminal_facts,
      (SELECT count(*)::int FROM engine_universal_queue_items
       WHERE workspace_id=$1 AND status='not_sent' AND terminal_at IS NOT NULL)
       AS expired_items_terminal,
      (SELECT count(*)::int FROM engine_universal_queue_destinations
       WHERE workspace_id=$1 AND status='pending') AS pending_after,
      (SELECT count(*)::int FROM engine_universal_queue_destinations
       WHERE workspace_id=$1 AND status='claimed') AS claimed_after`,
    [workspace])).rows[0];
    assert.deepEqual(facts, { expired_terminal: 100,
      expired_terminal_facts: 100, expired_items_terminal: 100,
      pending_after: 1, claimed_after: 0 });
    console.log("UNIVERSAL_EXPIRED_FRESH " + JSON.stringify({
      expiredInput: 100, freshInput: 1, firstRetired: firstRetire.retired,
      freshClaimedImmediately: true, expiredRetired: facts.expired_terminal,
      pendingAfter: facts.pending_after, claimQueryExcludesExpired: true,
      expiredConsumesBatchSlot: false, expiredCanDelayFresh: false }));
  } finally {
    await pool?.end().catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
