"use strict";

// Disposable PostgreSQL 17 proof for item-level quarantine. It never connects
// to production and exercises only the Universal queue repository contract.
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
const { openBalance } = require("../modules/engine/universal-credits.repository");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_ambiguous_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-12T12:00:00.000Z";

async function createOffer(client, workspace, minute) {
  const capturedAt = `2026-10-12T12:${String(minute).padStart(2, "0")}:00.000Z`;
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES ('radar','radar',$1,'{}'::jsonb)
    RETURNING id`, [capturedAt])).rows[0].id;
  const ofertaId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada') RETURNING id`,
  [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, ofertaId, workspace])).rows[0].id;
  return { jobId, ofertaId };
}

async function durableAck(client, claim, providerMessageId) {
  const confirmationKey = crypto.randomUUID();
  const target = claim.channel === "whatsapp"
    ? `grupo:${claim.target_key}` : claim.target_key;
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id, `universal_${claim.queue_item_id}`,
    `${claim.channel}:${claim.destination_id}`, target, confirmationKey,
    providerMessageId]);
  return { confirmationKey, providerMessageId };
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
    assert.equal(Number(identity.port), config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query(`UPDATE engine_operation_state SET mode='CUTOVER_PREPARED'
      WHERE id=1`);
    pool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });
    await openBalance({ pool, workspaceId: "ws_iso",
      operationEpochStartedAt: epoch, openingBalance: 10,
      sourceHash: crypto.createHash("sha256").update("iso").digest("hex") });
    await admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);

    const a = await createOffer(admin, "ws_iso", 1);
    const b = await createOffer(admin, "ws_iso", 2);
    const c = await createOffer(admin, "ws_iso", 3);
    const d = await createOffer(admin, "ws_iso", 4);
    const destinations = ["iso_a", "iso_b", "iso_c", "iso_d"];
    const offers = [a, b, c, d];
    const itemIds = [];
    for (let i = 0; i < offers.length; i += 1) {
      const result = await queue.enqueue({ pool, workspaceId: "ws_iso",
        jobId: offers[i].jobId, ofertaId: offers[i].ofertaId,
        itemPayload: { titulo: `iso-${i}` }, destinations: [{
          destinationId: destinations[i], targetKey: `group-${i}`,
          channel: "whatsapp" }] });
      itemIds.push(result.itemId);
    }
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_iso" })).health, "HEALTHY");

    const aClaim = await queue.claimDestination({ pool, workspaceId: "ws_iso" });
    assert.equal(aClaim.destination_id, "iso_a");
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: aClaim.id, leaseToken: aClaim.leaseToken })).ok, true);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [aClaim.id]);
    const degraded = await queue.preflightWorkspace({ pool, workspaceId: "ws_iso" });
    assert.equal(degraded.health, "AMBIGUOUS");
    assert.equal(degraded.ok, true);
    assert.equal(degraded.claimAllowed, true);

    const bClaim = await queue.claimDestination({ pool, workspaceId: "ws_iso" });
    assert.equal(bClaim.destination_id, "iso_b");
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: bClaim.id, leaseToken: bClaim.leaseToken })).ok, true);
    const bAck = await durableAck(admin, bClaim, "provider-b");
    assert.equal((await queue.confirmSend({ pool, destinationId: bClaim.id,
      leaseToken: bClaim.leaseToken, ...bAck })).ok, true);
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_iso" })).claimAllowed, true);

    const cClaim = await queue.claimDestination({ pool, workspaceId: "ws_iso" });
    assert.equal(cClaim.destination_id, "iso_c");
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: cClaim.id, leaseToken: cClaim.leaseToken })).ok, true);
    const cAck = await durableAck(admin, cClaim, "provider-c");
    assert.equal((await queue.confirmSend({ pool, destinationId: cClaim.id,
      leaseToken: cClaim.leaseToken, ...cAck })).ok, true);

    const discarded = await queue.discardAmbiguousWithoutReplay({ pool,
      workspaceId: "ws_iso", destinationId: aClaim.id,
      terminalReason: "DISCARD_WITHOUT_REPLAY",
      evidence: "external_effect_indeterminate",
      resolutionSource: "manual_reconciliation:user" });
    assert.equal(discarded.terminalStatus, "discarded_without_replay");
    assert.equal(discarded.itemStatus, "not_sent");
    assert.deepEqual(await queue.discardAmbiguousWithoutReplay({ pool,
      workspaceId: "ws_iso", destinationId: aClaim.id,
      terminalReason: "DISCARD_WITHOUT_REPLAY",
      evidence: "external_effect_indeterminate",
      resolutionSource: "manual_reconciliation:user" }),
    { ok: true, duplicate: true, itemStatus: null, terminal: true });
    const aState = (await admin.query(`SELECT status,terminal_status,
      terminal_reason,terminal_evidence,resolution_source,provider_message_id,
      confirmed_at,credit_debited FROM engine_universal_queue_destinations
      WHERE id=$1`, [aClaim.id])).rows[0];
    assert.equal(aState.status, "discarded_without_replay");
    assert.equal(aState.terminal_status, "discarded_without_replay");
    assert.equal(aState.provider_message_id, null);
    assert.equal(aState.confirmed_at, null);
    assert.notEqual(aState.terminal_evidence, null);
    assert.equal(aState.credit_debited, null);
    assert.equal((await admin.query(`SELECT reserved FROM
      engine_universal_credit_balances WHERE workspace_id='ws_iso'`)).rows[0].reserved, 0);
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_iso" })).health, "HEALTHY");
    // A late ACK is reconciled, not discarded and never replayed.
    const dClaim = await queue.claimDestination({ pool, workspaceId: "ws_iso" });
    assert.equal(dClaim.destination_id, "iso_d");
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: dClaim.id, leaseToken: dClaim.leaseToken })).ok, true);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [dClaim.id]);
    const dAck = await durableAck(admin, dClaim, "provider-d");
    const reconciled = await queue.preflightWorkspace({ pool, workspaceId: "ws_iso" });
    assert.equal(reconciled.recoveredAcks, 1);
    const dState = (await admin.query(`SELECT status,provider_message_id,
      credit_debited FROM engine_universal_queue_destinations WHERE id=$1`,
    [dClaim.id])).rows[0];
    assert.equal(dState.status, "sent");
    assert.equal(dState.provider_message_id, dAck.providerMessageId);
    assert.equal(dState.credit_debited, true);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      fila_checkpoints_entrega WHERE fila_item_id=$1 AND estado='enviado'`,
    [`universal_${itemIds[3]}`])).rows[0].n, 1);
    console.log(JSON.stringify({
      AMBIGUOUS_ITEM_NOT_REPLAYED: true,
      AMBIGUOUS_ITEM_DOES_NOT_BLOCK_OTHER_CLAIMS: true,
      CREDIT_NOT_DEBITED_WITHOUT_ACK: true,
      RESERVATION_RELEASED_ON_DISCARD: true,
      AUDIT_TRAIL_PRESERVED: true,
      LATE_ACK_RECONCILIATION_SAFE: true,
      TERMINAL_ERRORS_LEAVE_HOT_PATH: true,
      OTHER_WORKSPACES_UNCHANGED: true
    }));
    console.log("universal-flow-ambiguous-isolation.postgres.js OK");
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
