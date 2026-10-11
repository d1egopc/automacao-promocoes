"use strict";

// Local disposable PostgreSQL 17 proof. No production hostname or fallback.
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
const { consultarHistoricoUniversal, consultarFilaPublicaUniversal,
  consultarDetalheUniversal } =
  require("../modules/engine/universal-history.read-model");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_queue_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-09T12:00:00.000Z";

async function durableAck(client, claim, providerMessageId) {
  const confirmationKey = crypto.randomUUID();
  const channel = claim.channel;
  const target = channel === "telegram" ? claim.target_key
    : channel === "discord" ? `canal:${claim.target_key}`
      : `grupo:${claim.target_key}`;
  await client.query(`INSERT INTO fila_checkpoints_entrega
    (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
     estado,provider_message_id,confirmado_em)
    VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
  [claim.workspace_id, `universal_${claim.queue_item_id}`,
    `${channel}:${claim.destination_id}`, target, confirmationKey,
    providerMessageId]);
  return { confirmationKey, providerMessageId };
}

async function createOffer(client, { workspace, capturedAt, origin = "radar" }) {
  const eventId = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES ($1,$1,$2,'{}'::jsonb)
    RETURNING id`, [origin, capturedAt])).rows[0].id;
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status) VALUES ($1,$2,'oferta_criada') RETURNING id`,
  [eventId, origin])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'oferta_criada','{}'::jsonb) RETURNING id`,
  [eventId, offerId, workspace])).rows[0].id;
  return { eventId, offerId, jobId };
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
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules",
      "engine", "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode,
      "LEGACY");
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode,
      "LEGACY");
    await admin.query(`UPDATE engine_operation_state SET mode='CUTOVER_PREPARED' WHERE id=1`);
    pool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });
    for (const workspaceId of ["ws_A", "ws_B", "ws_NEW"]) {
      await openBalance({ pool, workspaceId, operationEpochStartedAt: epoch,
        openingBalance: 10, sourceHash: crypto.createHash("sha256")
          .update(`fixture:${workspaceId}:10`).digest("hex") });
    }
    await admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    const a = await createOffer(admin, { workspace: "ws_A",
      capturedAt: "2026-10-09T12:05:00.000Z" });
    const b = await createOffer(admin, { workspace: "ws_B",
      capturedAt: "2026-10-09T12:06:00.000Z", origin: "clonador_grupos" });
    const freshUser = await createOffer(admin, { workspace: "ws_NEW",
      capturedAt: "2026-10-09T12:07:00.000Z" });
    const old = await createOffer(admin, { workspace: "ws_A",
      capturedAt: "2026-10-09T11:59:59.000Z" });
    const noOpportunity = await createOffer(admin, { workspace: "ws_A",
      capturedAt: "2026-10-09T12:08:00.000Z" });
    const technicalError = await createOffer(admin, { workspace: "ws_A",
      capturedAt: "2026-10-09T12:09:00.000Z" });
    const noSend = await createOffer(admin, { workspace: "ws_A",
      capturedAt: "2026-10-09T12:10:00.000Z" });
    const deferred = await createOffer(admin, { workspace: "ws_NEW",
      capturedAt: "2026-10-09T12:11:00.000Z" });
    const payload = { title: "fixture", image: "https://example.test/i",
      linkAfiliado: "https://example.test/a" };
    const aResult = await queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: a.jobId, ofertaId: a.offerId, itemPayload: payload,
      destinations: [
        { destinationId: "a_wa", targetKey: "a_group_1", channel: "whatsapp" },
        { destinationId: "a_wa", targetKey: "a_group_2", channel: "whatsapp" },
        { destinationId: "a_tg", targetKey: "a_chat_1", channel: "telegram" }
      ] });
    assert.equal(aResult.created, true);
    const durablePayload = (await admin.query(`SELECT item_payload
      FROM engine_universal_queue_items WHERE id=$1`, [aResult.itemId])).rows[0].item_payload;
    assert.equal(durablePayload.id, `universal_${aResult.itemId}`);
    assert.equal(durablePayload.operationEpochStartedAt, epoch);
    assert.equal((await queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: a.jobId, ofertaId: a.offerId, itemPayload: payload,
      destinations: [
        { destinationId: "a_wa", targetKey: "a_group_1", channel: "whatsapp" },
        { destinationId: "a_wa", targetKey: "a_group_2", channel: "whatsapp" },
        { destinationId: "a_tg", targetKey: "a_chat_1", channel: "telegram" }
      ] })).created, false);
    await assert.rejects(queue.enqueue({ pool, workspaceId: "ws_B",
      jobId: a.jobId, ofertaId: a.offerId, itemPayload: payload,
      destinations: [] }), /identity_unproven/);
    await assert.rejects(queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: old.jobId, ofertaId: old.offerId, itemPayload: payload,
      destinations: [] }), /pre_epoch_capture/);
    await queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: noOpportunity.jobId, ofertaId: noOpportunity.offerId,
      itemPayload: payload, destinations: [] });
    await queue.enqueue({ pool, workspaceId: "ws_B",
      jobId: b.jobId, ofertaId: b.offerId, itemPayload: payload,
      destinations: [{ destinationId: "b_dc", targetKey: "b_channel_1",
        channel: "discord" }] });
    await queue.enqueue({ pool, workspaceId: "ws_NEW",
      jobId: freshUser.jobId, ofertaId: freshUser.offerId,
      itemPayload: payload,
      destinations: [{ destinationId: "new_wa", targetKey: "new_group_1",
        channel: "whatsapp" }] });
    await queue.enqueue({ pool, workspaceId: "ws_NEW",
      jobId: deferred.jobId, ofertaId: deferred.offerId, itemPayload: payload,
      destinations: [{ destinationId: "new_deferred", targetKey: "new_deferred_group",
        channel: "whatsapp" }] });
    assert.equal((await queue.claimDestination({ pool,
      workspaceId: "ws_A" })).reason, "workspace_preflight_required");
    for (const workspaceId of ["ws_A", "ws_B", "ws_NEW"]) {
      assert.equal((await queue.preflightWorkspace({ pool, workspaceId })).ok, true);
    }
    const firstA = await queue.claimDestination({ pool, workspaceId: "ws_A" });
    const firstB = await queue.claimDestination({ pool, workspaceId: "ws_B" });
    assert.equal(firstA.workspace_id, "ws_A");
    assert.equal(firstB.workspace_id, "ws_B");
    assert.equal(firstA.capturado_em.toISOString(),
      "2026-10-09T12:05:00.000Z");
    const parallelDifferentDestination = await queue.claimDestination({ pool,
      workspaceId: "ws_A" });
    assert.equal(parallelDifferentDestination.destination_id, "a_tg");
    assert.equal((await queue.releaseUnstarted({ pool,
      destinationId: parallelDifferentDestination.id,
      leaseToken: parallelDifferentDestination.leaseToken })).ok, true);
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: firstA.id, leaseToken: firstA.leaseToken })).ok, true);
    const ackA1 = await durableAck(admin, firstA, "wa_1");
    const confirmedA1 = await queue.confirmSend({ pool, destinationId: firstA.id,
      leaseToken: firstA.leaseToken, ...ackA1 });
    assert.equal(confirmedA1.itemStatus, "partial");
    assert.equal(confirmedA1.terminal, false);
    assert.equal(firstA.target_key, "a_group_1");
    assert.ok(await queue.readDestinationClock({ pool,
      workspaceId: "ws_A", destinationId: "a_wa" }));
    assert.equal(await queue.countConfirmedToday({ pool,
      workspaceId: "ws_A", destinationId: "a_wa" }), 1);
    assert.equal(await queue.readDestinationClock({ pool,
      workspaceId: "ws_A", destinationId: "a_tg" }), null);
    assert.equal(await queue.readDestinationClock({ pool,
      workspaceId: "ws_B", destinationId: "b_dc" }), null);
    const secondA = await queue.claimDestination({ pool, workspaceId: "ws_A" });
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: secondA.id, leaseToken: secondA.leaseToken })).ok, true);
    const ackA2 = await durableAck(admin, secondA, "wa_2");
    assert.equal((await queue.confirmSend({ pool, destinationId: secondA.id,
      leaseToken: secondA.leaseToken, ...ackA2 })).itemStatus, "partial");
    const thirdA = await queue.claimDestination({ pool, workspaceId: "ws_A" });
    assert.equal(thirdA.target_key, "a_chat_1");
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: thirdA.id, leaseToken: thirdA.leaseToken })).ok, true);
    const ackA3 = await durableAck(admin, thirdA, "tg_3");
    const confirmedA3 = await queue.confirmSend({ pool,
      destinationId: thirdA.id, leaseToken: thirdA.leaseToken, ...ackA3 });
    assert.equal(confirmedA3.itemStatus, "sent");
    assert.equal(confirmedA3.terminal, true);
    assert.deepEqual(await queue.confirmSend({ pool, destinationId: thirdA.id,
      leaseToken: thirdA.leaseToken, ...ackA3 }),
    { ok: true, duplicate: true });
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: firstB.id, leaseToken: firstB.leaseToken })).ok, true);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, [firstB.id]);
    const recoveryB = await queue.preflightWorkspace({ pool, workspaceId: "ws_B" });
    assert.equal(recoveryB.health, "AMBIGUOUS");
    assert.equal((await queue.claimDestination({ pool,
      workspaceId: "ws_B" })).ok, false);
    const ackB1 = await durableAck(admin, firstB, "dc_1");
    assert.equal((await queue.confirmSend({ pool, destinationId: firstB.id,
      leaseToken: firstB.leaseToken, ...ackB1 })).ok, true);
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_B" })).health, "HEALTHY");
    await admin.query(`UPDATE engine_universal_queue_workspace_state
      SET revision=revision+1 WHERE operation_epoch_started_at=$1
        AND workspace_id='ws_B'`, [epoch]);
    assert.deepEqual(await queue.preflightWorkspace({ pool,
      workspaceId: "ws_B" }), { ok: false, health: "AMBIGUOUS",
      workspaceId: "ws_B", reason: "workspace_checkpoint_revision_mismatch" });
    assert.equal((await queue.claimDestination({ pool,
      workspaceId: "ws_B" })).reason, "workspace_preflight_required");
    await queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: technicalError.jobId, ofertaId: technicalError.offerId,
      itemPayload: payload, destinations: [
        { destinationId: "a_failed", targetKey: "a_failed_group",
          channel: "whatsapp" }
      ] });
    await queue.enqueue({ pool, workspaceId: "ws_A",
      jobId: noSend.jobId, ofertaId: noSend.offerId, itemPayload: payload,
      destinations: [{ destinationId: "a_skipped", targetKey: "a_skipped_group",
        channel: "whatsapp" }] });
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_A" })).ok, true);
    const failedA = await queue.claimDestination({ pool,
      workspaceId: "ws_A" });
    assert.equal(failedA.ok, true);
    assert.equal(failedA.destination_id, "a_failed");
    await assert.rejects(queue.confirmFailure({ pool,
      destinationId: failedA.id, leaseToken: failedA.leaseToken,
      reason: "technical_invalid", evidence: "provider_no_effect_confirmed" }),
    /boundary_unproven/);
    assert.deepEqual(await queue.confirmFailure({ pool,
      destinationId: failedA.id, leaseToken: failedA.leaseToken,
      reason: "technical_invalid", evidence: "local_before_transport" }),
    { ok: true, duplicate: false, itemStatus: "error", terminal: true });
    const skippedA = await queue.claimDestination({ pool,
      workspaceId: "ws_A" });
    assert.equal(skippedA.destination_id, "a_skipped");
    assert.deepEqual(await queue.completeWithoutSend({ pool,
      destinationId: skippedA.id, leaseToken: skippedA.leaseToken,
      reason: "commercially_expired" }),
    { ok: true, duplicate: false, itemStatus: "not_sent", terminal: true });
    assert.deepEqual(await queue.completeWithoutSend({ pool,
      destinationId: skippedA.id, leaseToken: skippedA.leaseToken,
      reason: "commercially_expired" }), { ok: true, duplicate: true });
    const firstNew = await queue.claimDestination({ pool,
      workspaceId: "ws_NEW" });
    assert.equal((await queue.releaseUnstarted({ pool,
      destinationId: firstNew.id, leaseToken: firstNew.leaseToken })).ok, true);
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: firstNew.id, leaseToken: firstNew.leaseToken })).ok, false);
    const afterReleaseNew = await queue.claimDestination({ pool,
      workspaceId: "ws_NEW" });
    assert.notEqual(afterReleaseNew.leaseToken, firstNew.leaseToken);
    assert.equal(afterReleaseNew.destination_id, "new_deferred");
    assert.equal((await queue.releaseUnstarted({ pool,
      destinationId: afterReleaseNew.id, leaseToken: afterReleaseNew.leaseToken,
      retryAt: "2099-01-01T00:00:00.000Z" })).ok, true);
    const crashedNew = await queue.claimDestination({ pool,
      workspaceId: "ws_NEW" });
    assert.equal(crashedNew.destination_id, "new_wa");
    assert.equal((await queue.claimDestination({ pool,
      workspaceId: "ws_NEW" })).empty, true);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [crashedNew.id]);
    const recoveryNew = await queue.preflightWorkspace({ pool,
      workspaceId: "ws_NEW" });
    assert.equal(recoveryNew.recoveredClaims, 1);
    const retriedNew = await queue.claimDestination({ pool,
      workspaceId: "ws_NEW" });
    assert.notEqual(retriedNew.leaseToken, crashedNew.leaseToken);
    assert.equal(retriedNew.destination_id, "new_wa");
    const historyA = await consultarHistoricoUniversal({ pool,
      workspaceId: "ws_A", from: epoch, to: "2026-10-11T00:00:00.000Z" });
    assert.equal(historyA.metrics.enviadas, 1);
    assert.equal(historyA.metrics.sem_oportunidade, 1);
    assert.equal(historyA.metrics.erros, 1);
    assert.equal(historyA.metrics.nao_enviadas, 1);
    assert.equal(historyA.items.length, 4);
    assert.equal(historyA.items.find(item => item.resultadoFinalPublico ===
      "enviada").destinos.length, 3);
    assert.equal(historyA.items.find(item => item.resultadoFinalPublico ===
      "nao_elegivel").destinos.length, 0);
    assert.equal(historyA.metrics.elegiveis, 3);
    assert.equal(historyA.metrics.taxaEnvio, 1 / 3);
    const routeList = await consultarFilaPublicaUniversal({ pool,
      workspaceId: "ws_A", filtros: { periodo: "7dias",
        visao: "processadas" } });
    assert.equal(routeList.metricas.finalizadas, 4);
    assert.equal(routeList.metricas.fechaMatematicamente, true);
    assert.equal(routeList.itens.length, 4);
    assert.ok(routeList.itens.every(item =>
      item.detalheRef.arquivo === "universal_queue"));
    const routeSent = await consultarFilaPublicaUniversal({ pool,
      workspaceId: "ws_A", filtros: { periodo: "7dias",
        visao: "enviadas" } });
    assert.equal(routeSent.totalFiltrado, 1);
    const detail = await consultarDetalheUniversal({ pool,
      workspaceId: "ws_A", detalheRef: routeSent.itens[0].detalheRef });
    assert.equal(detail.ok, true);
    assert.equal(detail.detalhe.destinos.length, 3);
    assert.equal((await consultarDetalheUniversal({ pool,
      workspaceId: "ws_B", detalheRef: routeSent.itens[0].detalheRef })).ok,
    false);
    const routeHot = await consultarFilaPublicaUniversal({ pool,
      workspaceId: "ws_NEW", filtros: { periodo: "7dias",
        visao: "fila" } });
    assert.equal(routeHot.metricas.emDistribuicao, 2);
    console.log(JSON.stringify({ test: "universal_queue_epoch_local",
      workspaces: 3, oldCaptureRejected: true, duplicateEnqueueSafe: true,
      fanoutA: 3, destinationClockIsolated: true,
      concurrentDifferentDestinationAllowed: true,
      ambiguousBFailClosed: true,
      preSendClaimRecovered: true, unstartedClaimReleased: true,
      persistedConfirmationIdempotent: true,
      checkpointMismatchClosed: true,
      historyFromEpoch: true, noOpportunityFoundation: true,
      technicalFailureFactual: true, noSendTerminalFactual: true,
      deferredTargetNotReclaimedEarly: true }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
