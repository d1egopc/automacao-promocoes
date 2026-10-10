"use strict";

// Focal P+D commercial reservation / durable target-owner proof in PG17 lab.
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
const { openBalance } =
  require("../modules/engine/universal-credits.repository");
const claims = require("../modules/fila/fila-claims.repository");
const { criarCatracaAdvisoryFuncionalFila } =
  require("../modules/fila/fila-advisory-functional.service");
const { criarCoordenadorEnvioProdutoDestino } =
  require("../modules/manual-v2/ofertas-v2-envio-claim");
const { getEnginePool } = require("../modules/engine/database");
const { TTL_NORMAL_MS, TTL_TURBO_MS } =
  require("../modules/engine/flow-manager/flow-manager.service");

const root = path.join(__dirname, "..");
const schema = `uf_owner_${crypto.randomBytes(6).toString("hex")}`;
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspace = "ws_owner";
const destination = "destination_D";

async function durableAck(client, claim, messageId) {
  const attemptId = crypto.randomUUID();
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [workspace, `universal_${claim.queue_item_id}`,
    `whatsapp:${claim.destination_id}`, claim.target_key,
    attemptId, messageId]);
  return { confirmationKey: attemptId, providerMessageId: messageId };
}

async function createOffer(client, product, suffix) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES
    ('radar','radar',now(),'{}'::jsonb) RETURNING id`)).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,'radar','oferta_criada')
    RETURNING id`, [eventId])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { offerId, jobId, itemPayload: { clienteId: workspace,
    engineOfertaId: offerId, engineJobId: jobId, marketplace: "amazon",
    linkOriginal: `https://www.amazon.com.br/dp/${product}`,
    titulo: `Produto ${product} ${suffix}` } };
}

async function claimNext(pool) {
  const health = await queue.preflightWorkspace({ pool, workspaceId: workspace });
  assert.equal(health.ok, true, JSON.stringify(health));
  const claim = await queue.claimDestination({ pool, workspaceId: workspace });
  assert.equal(claim.ok, true, JSON.stringify(claim));
  assert.equal(claim.empty, false, JSON.stringify(claim));
  return claim;
}

async function main() {
  const admin = new Client(config);
  let pool, created = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert(TTL_NORMAL_MS < 2 * 60 * 60 * 1000);
    assert(TTL_TURBO_MS < 2 * 60 * 60 * 1000);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    await admin.query(claims.SQL_SCHEMA_FILA_CLAIMS);
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query(`UPDATE engine_operation_state SET mode='CUTOVER_PREPARED'
      WHERE id=1`);
    const epoch = new Date(Date.now() - 60000).toISOString();
    pool = new Pool({ ...config, options: `-c search_path=${schema},public` });
    await openBalance({ pool, workspaceId: workspace,
      operationEpochStartedAt: epoch, openingBalance: 10,
      sourceHash: crypto.createHash("sha256").update("ws_owner:10")
        .digest("hex") });
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:55433/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
    process.env.PGSSLMODE = "disable";
    const advisory = criarCatracaAdvisoryFuncionalFila({ repository: claims,
      logger: { log() {} } });
    const commercial = criarCoordenadorEnvioProdutoDestino({ advisory });

    const first = await createOffer(admin, "B012345678", "F1");
    const targets = ["grupo:A", "grupo:B"].map(targetKey => ({
      destinationId: destination, channel: "whatsapp", targetKey,
      connectionId: "wa_1" }));
    const [enqueuedA, enqueuedB] = await Promise.all([1, 2].map(() =>
      queue.enqueue({ pool, workspaceId: workspace, jobId: first.jobId,
        ofertaId: first.offerId, itemPayload: first.itemPayload,
        destinations: targets })));
    assert.equal(String(enqueuedA.itemId), String(enqueuedB.itemId));
    const owners = (await admin.query(`SELECT owner_id,reservation_token,
      target_snapshot_hash FROM engine_universal_fanout_owners
      WHERE queue_item_id=$1`, [enqueuedA.itemId])).rows;
    assert.equal(owners.length, 1);
    assert.match(owners[0].target_snapshot_hash, /^[0-9a-f]{64}$/);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM
      engine_universal_queue_destinations WHERE queue_item_id=$1`,
    [enqueuedA.itemId])).rows[0].n, 2);
    await assert.rejects(queue.enqueue({ pool, workspaceId: workspace,
      jobId: first.jobId, ofertaId: first.offerId,
      itemPayload: first.itemPayload,
      destinations: [...targets, { destinationId: destination,
        channel: "whatsapp", targetKey: "grupo:C", connectionId: "wa_1" }] }),
    /queue_existing_fanout_conflict/);

    const a = await claimNext(pool);
    assert.equal(a.target_key, "grupo:A");
    const competingClaim = await queue.claimDestination({ pool,
      workspaceId: workspace });
    assert.equal(competingClaim.empty, true);
    const reservationA = await commercial.adquirir({ clienteId: workspace,
      oferta: first.itemPayload, destinoId: destination,
      fanoutOwnerId: a.fanout_owner_id, targetId: a.id,
      targetLeaseToken: a.leaseToken });
    assert.equal(reservationA.resultado, "adquirido");
    assert.equal(reservationA.ownerContinuation, false);
    assert.equal(await commercial.prepararTransporte(reservationA), true);
    assert.equal(await commercial.validarTitularidade(reservationA, {
      targetId: a.id, targetLeaseToken: a.leaseToken }), true);
    await queue.markSendStarted({ pool, destinationId: a.id,
      leaseToken: a.leaseToken });
    const ackA = await durableAck(admin, a, "provider-A");
    assert.equal((await queue.confirmSend({ pool, destinationId: a.id,
      leaseToken: a.leaseToken, ...ackA })).ok, true);
    await commercial.finalizar(reservationA);

    const manualSameProduct = await commercial.adquirir({
      clienteId: workspace, oferta: first.itemPayload,
      destinoId: destination });
    assert.equal(manualSameProduct.resultado, "ocupado_recente");
    // Recreate the coordinator and its advisory wrapper: continuation must
    // come from PostgreSQL, not process-local state retained by F1.
    const afterRestart = criarCoordenadorEnvioProdutoDestino({
      advisory: criarCatracaAdvisoryFuncionalFila({ repository: claims,
        logger: { log() {} } }) });
    const b = await claimNext(pool);
    assert.equal(b.target_key, "grupo:B");
    assert.equal(b.fanout_owner_id, a.fanout_owner_id);
    const reservationB = await afterRestart.adquirir({ clienteId: workspace,
      oferta: first.itemPayload, destinoId: destination,
      fanoutOwnerId: b.fanout_owner_id, targetId: b.id,
      targetLeaseToken: b.leaseToken });
    assert.equal(reservationB.resultado, "adquirido");
    assert.equal(reservationB.ownerContinuation, true);
    assert.equal(await afterRestart.prepararTransporte(reservationB), true);
    assert.equal(await afterRestart.validarTitularidade(reservationB, {
      targetId: b.id, targetLeaseToken: b.leaseToken }), true);
    const beforeB = (await admin.query(`SELECT status,credit_debited FROM
      engine_universal_queue_destinations WHERE id=$1`, [b.id])).rows[0];
    assert.equal(beforeB.status, "claimed");
    assert.equal(beforeB.credit_debited, null);
    await queue.markSendStarted({ pool, destinationId: b.id,
      leaseToken: b.leaseToken });
    const ackB = await durableAck(admin, b, "provider-B");
    assert.equal((await queue.confirmSend({ pool, destinationId: b.id,
      leaseToken: b.leaseToken, ...ackB })).ok, true);
    const sent = (await admin.query(`SELECT target_key,status,provider_message_id
      FROM engine_universal_queue_destinations WHERE queue_item_id=$1
      ORDER BY target_key`, [enqueuedA.itemId])).rows;
    assert.deepEqual(sent.map(row => [row.target_key,row.status,
      row.provider_message_id]), [["grupo:A","sent","provider-A"],
      ["grupo:B","sent","provider-B"]]);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM
      fila_claims_ativos WHERE cliente_id=$1 AND
      fila_item_id=$2`, [workspace, reservationA.chaveReserva])).rows[0].n, 1);

    const second = await createOffer(admin, "B012345678", "F2");
    await queue.enqueue({ pool, workspaceId: workspace, jobId: second.jobId,
      ofertaId: second.offerId, itemPayload: second.itemPayload,
      destinations: [{ destinationId: destination, channel: "whatsapp",
        targetKey: "grupo:C", connectionId: "wa_1" }] });
    const f2 = await claimNext(pool);
    const forged = await commercial.adquirir({ clienteId: workspace,
      oferta: second.itemPayload, destinoId: destination,
      fanoutOwnerId: a.fanout_owner_id, targetId: f2.id,
      targetLeaseToken: f2.leaseToken });
    assert.equal(forged.resultado, "owner_target_invalido");
    const differentOwner = await commercial.adquirir({ clienteId: workspace,
      oferta: second.itemPayload, destinoId: destination,
      fanoutOwnerId: f2.fanout_owner_id, targetId: f2.id,
      targetLeaseToken: f2.leaseToken });
    assert.equal(differentOwner.resultado, "ocupado_recente");
    await queue.releaseUnstarted({ pool, destinationId: f2.id,
      leaseToken: f2.leaseToken,
      retryAt: new Date(Date.now() + 60000).toISOString() });

    const manualOffer = { clienteId: workspace, marketplace: "amazon",
      linkOriginal: "https://www.amazon.com.br/dp/B012345679",
      titulo: "manual prior" };
    const manual = await commercial.adquirir({ clienteId: workspace,
      oferta: manualOffer, destinoId: "destination_manual" });
    assert.equal(manual.resultado, "adquirido");
    assert.equal(await commercial.prepararTransporte(manual), true);
    const third = await createOffer(admin, "B012345679", "F3");
    await queue.enqueue({ pool, workspaceId: workspace, jobId: third.jobId,
      ofertaId: third.offerId, itemPayload: third.itemPayload,
      destinations: [{ destinationId: "destination_manual",
        channel: "whatsapp", targetKey: "grupo:M", connectionId: "wa_1" }] });
    const f3 = await claimNext(pool);
    const manualBlocksUniversal = await commercial.adquirir({
      clienteId: workspace, oferta: third.itemPayload,
      destinoId: "destination_manual",
      fanoutOwnerId: f3.fanout_owner_id, targetId: f3.id,
      targetLeaseToken: f3.leaseToken });
    assert.equal(manualBlocksUniversal.resultado, "ocupado_recente");
    const fourth = await createOffer(admin, "B012345680", "F4");
    await queue.enqueue({ pool, workspaceId: workspace, jobId: fourth.jobId,
      ofertaId: fourth.offerId, itemPayload: fourth.itemPayload,
      destinations: [{ destinationId: "destination_cleanup",
        channel: "whatsapp", targetKey: "grupo:Q", connectionId: "wa_1" }] });
    const noProvider = await claimNext(pool);
    const release = await commercial.adquirir({ clienteId: workspace,
      oferta: fourth.itemPayload, destinoId: "destination_cleanup",
      fanoutOwnerId: noProvider.fanout_owner_id, targetId: noProvider.id,
      targetLeaseToken: noProvider.leaseToken });
    assert.equal(release.resultado, "adquirido");
    assert.equal(await commercial.prepararTransporte(release), true);
    await commercial.descartarSemTransporte(release);
    const detached = (await admin.query(`SELECT reservation_token,
      commercial_reservation_key FROM engine_universal_fanout_owners
      WHERE owner_id=$1`, [noProvider.fanout_owner_id])).rows[0];
    assert.equal(detached.reservation_token, null);
    assert.equal(detached.commercial_reservation_key, null);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM
      fila_claims_ativos WHERE cliente_id=$1 AND fila_item_id=$2`,
    [workspace, release.chaveReserva])).rows[0].n, 0);
    console.log(JSON.stringify({ test: "universal_fanout_owner",
      ownerCount: owners.length, targets: sent.length,
      sameOwnerContinues: true, differentOwnerBlocked: true,
      manualBlocksUniversal: true, universalBlocksManual: true,
      commercialReservationsPerPair: 1,
      preProviderReleaseAtomic: true }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (process.env.DATABASE_URL) await getEnginePool()?.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
