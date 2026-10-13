"use strict";

// Disposable PostgreSQL 17 proof. Never reads DATABASE_URL or production env.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const { projectUniversalTerminalTx, historicoResumo, listHistory,
  historyDetail } = require("../modules/engine/universal-history.repository");

const root = path.join(__dirname, "..");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `history_v1_${crypto.randomBytes(6).toString("hex")}`;
const workspace = "history_gate_workspace";
const epoch = new Date(Date.now() - 60 * 60 * 1000).toISOString();

async function createSource(client, label) {
  const event = (await client.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,capturado_em,metadata) VALUES
    ('radar','radar',clock_timestamp(),'{}'::jsonb) RETURNING id,capturado_em`)).rows[0];
  const offerId = (await client.query(`INSERT INTO engine_ofertas
    (evento_id,origem,status,titulo) VALUES ($1,'radar','distribuindo',$2)
    RETURNING id`, [event.id, label])).rows[0].id;
  const jobId = (await client.query(`INSERT INTO engine_jobs_cliente
    (evento_id,oferta_id,cliente_id,status,metadata)
    VALUES ($1,$2,$3,'importado','{}'::jsonb) RETURNING id`,
  [event.id, offerId, workspace])).rows[0].id;
  return { eventId: event.id, offerId, jobId, capturedAt: event.capturado_em };
}

async function createItem(client, { label, itemStatus, targets }) {
  const source = await createSource(client, label);
  const payload = { marketplace: "amazon", titulo: label,
    imagemLista: `https://example.test/${encodeURIComponent(label)}.jpg`,
    precoAtual: "R$ 99,90", categoria: "Casa" };
  const itemId = (await client.query(`INSERT INTO engine_universal_queue_items
    (operation_epoch_started_at,workspace_id,evento_id,job_id,oferta_id,
     origem_fluxo,capturado_em,item_payload,status,terminal_at)
    VALUES ($1,$2,$3,$4,$5,'radar',$6,$7::jsonb,$8,clock_timestamp())
    RETURNING id`, [epoch, workspace, source.eventId, source.jobId,
    source.offerId, source.capturedAt, JSON.stringify(payload), itemStatus])).rows[0].id;
  for (const [index, target] of targets.entries()) {
    const ownerId = crypto.createHash("sha256")
      .update(`${itemId}:${target.destinationId}`).digest("hex");
    const snapshotHash = crypto.createHash("sha256")
      .update(`${target.destinationId}:${target.targetKey}`).digest("hex");
    await client.query(`INSERT INTO engine_universal_fanout_owners
      (owner_id,queue_item_id,operation_epoch_started_at,workspace_id,
       destination_id,target_snapshot_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [ownerId, itemId, epoch, workspace,
      target.destinationId, snapshotHash]);
    await client.query(`INSERT INTO engine_universal_queue_destinations
      (queue_item_id,operation_epoch_started_at,workspace_id,destination_id,
       fanout_owner_id,target_key,channel,status,confirmation_key,
       provider_message_id,confirmed_at,credit_debited,terminal_reason,
       terminal_status,terminal_evidence,resolved_at,resolution_source,
       destination_name_snapshot,target_label_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [itemId, epoch, workspace, target.destinationId, ownerId,
      target.targetKey, target.channel, target.status,
      target.status === "sent" ? `ack-key-${itemId}-${index}` : null,
      target.providerMessageId || null,
      target.status === "sent" ? new Date() : null,
      target.status === "sent" ? true : null,
      target.reason || null, target.terminalStatus || null,
      target.evidence || null, target.resolvedAt || null,
      target.resolutionSource || null, target.destinationName,
      target.targetLabel]);
  }
  return itemId;
}

async function projectInTransaction(client, itemId) {
  await client.query("BEGIN");
  try {
    const result = await projectUniversalTerminalTx(client,
      { queueItemId: Number(itemId), workspaceId: workspace });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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
      current_setting('server_version_num')::int AS version`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());

    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode,
      "LEGACY");
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode,
      "LEGACY", "bootstrap aditivo deve ser idempotente");

    const tables = (await admin.query(`SELECT table_name FROM
      information_schema.tables WHERE table_schema=current_schema()
        AND table_name IN ('engine_history_items','engine_history_targets')
      ORDER BY table_name`)).rows.map(row => row.table_name);
    assert.deepEqual(tables,
      ["engine_history_items", "engine_history_targets"]);
    const expectedIndexes = [
      "engine_history_items_workspace_finalized_idx",
      "engine_history_items_workspace_marketplace_finalized_idx",
      "engine_history_items_workspace_status_finalized_idx",
      "engine_history_targets_workspace_channel_idx",
      "engine_history_targets_workspace_destination_idx"
    ];
    const indexes = (await admin.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname=current_schema() AND indexname=ANY($1::text[])
      ORDER BY indexname`, [expectedIndexes])).rows.map(row => row.indexname);
    assert.deepEqual(indexes, [...expectedIndexes].sort());

    pool = new Pool({ ...config, max: 3,
      options: `-c search_path=${schema},public` });
    const sentId = await createItem(admin, { label: "Produto enviado",
      itemStatus: "sent", targets: [{ destinationId: "dest-sent",
        destinationName: "Ofertas VIP", targetLabel: "Grupo Principal",
        targetKey: "grupo-sent", channel: "whatsapp", status: "sent",
        providerMessageId: "provider-sent-1" }] });
    const partialId = await createItem(admin, { label: "Produto parcial",
      itemStatus: "partial", targets: [
        { destinationId: "dest-partial-ok", destinationName: "Telegram VIP",
          targetLabel: "Canal Ofertas", targetKey: "canal-ok",
          channel: "telegram", status: "sent",
          providerMessageId: "provider-partial-1" },
        { destinationId: "dest-partial-fail", destinationName: "Discord Promo",
          targetLabel: "Sala Promo", targetKey: "sala-fail", channel: "discord",
          status: "failed", reason: "provider_rejected",
          evidence: "provider_no_effect_confirmed" }
      ] });
    const errorId = await createItem(admin, { label: "Produto com erro",
      itemStatus: "error", targets: [{ destinationId: "dest-error",
        destinationName: "Grupo Erros", targetLabel: "Grupo Erros",
        targetKey: "grupo-error", channel: "whatsapp", status: "failed",
        reason: "provider_session_closed",
        evidence: "provider_no_effect_confirmed" }] });
    const expiredId = await createItem(admin, { label: "Produto expirado",
      itemStatus: "not_sent", targets: [{ destinationId: "dest-expired",
        destinationName: "Grupo Expirado", targetLabel: "Grupo Expirado",
        targetKey: "grupo-expired", channel: "whatsapp", status: "skipped",
        reason: "expired" }] });
    const discardedId = await createItem(admin, { label: "Produto descartado",
      itemStatus: "not_sent", targets: [{ destinationId: "dest-discarded",
        destinationName: "Grupo Descartado", targetLabel: "Grupo Descartado",
        targetKey: "grupo-discarded", channel: "whatsapp",
        status: "discarded_without_replay", reason: "operator_discard",
        terminalStatus: "discarded_without_replay",
        evidence: "provider_no_effect_confirmed", resolvedAt: new Date(),
        resolutionSource: "fixture_operator" }] });

    const sentProjection = await projectInTransaction(admin, sentId);
    const partialProjection = await projectInTransaction(admin, partialId);
    const errorProjection = await projectInTransaction(admin, errorId);
    assert.equal(sentProjection.projected, true);
    assert.equal(partialProjection.projected, true);
    assert.equal(errorProjection.projected, true);
    assert.equal((await projectInTransaction(admin, sentId)).duplicate, true,
      "retry da terminalização não duplica histórico");
    assert.deepEqual(await projectInTransaction(admin, expiredId),
      { projected: false, reason: "no_commercial_terminal_fact" });
    assert.deepEqual(await projectInTransaction(admin, discardedId),
      { projected: false, reason: "no_commercial_terminal_fact" });

    const noAckId = await createItem(admin, { label: "Sent sem ACK",
      itemStatus: "sent", targets: [{ destinationId: "dest-no-ack",
        destinationName: "Destino sem ACK", targetLabel: "Alvo sem ACK",
        targetKey: "no-ack", channel: "whatsapp", status: "sent" }] });
    await assert.rejects(projectInTransaction(admin, noAckId),
      /history_sent_ack_unproven/);

    const summary = await historicoResumo({ pool, workspace, periodo: "hoje" });
    assert.deepEqual(summary,
      { finalized: 3, sent: 2, partial: 1, errors: 1, sendRate: 2 / 3 });
    const listed = await listHistory({ pool, workspaceId: workspace,
      period: "hoje", limit: 50 });
    assert.equal(listed.items.length, 3);
    assert.deepEqual(new Set(listed.items.map(item => item.status)),
      new Set(["sent", "partial", "error"]));
    for (const item of listed.items) {
      assert.equal(Object.hasOwn(item, "targets"), false);
      assert.equal(Object.hasOwn(item, "providerMessageId"), false);
    }

    const sentDetail = await historyDetail({ pool, workspaceId: workspace,
      historyId: sentProjection.historyId });
    assert.equal(sentDetail.targets[0].destinationName, "Ofertas VIP");
    assert.equal(sentDetail.targets[0].channel, "whatsapp");
    assert.equal(sentDetail.targets[0].targetKey, "grupo-sent");
    assert.equal(sentDetail.targets[0].providerMessageId, "provider-sent-1");
    assert.ok(sentDetail.targets[0].confirmedAt);
    const partialDetail = await historyDetail({ pool, workspaceId: workspace,
      historyId: partialProjection.historyId });
    assert.equal(partialDetail.targets.filter(target => target.ack).length, 1);
    assert.equal(partialDetail.targets.filter(target => !target.ack).length, 1);
    const errorDetail = await historyDetail({ pool, workspaceId: workspace,
      historyId: errorProjection.historyId });
    assert.equal(errorDetail.targets.every(target => !target.ack), true);
    assert.equal(errorDetail.error.stage, "provider_session");
    assert.equal(errorDetail.error.code, "provider_session_closed");
    assert.ok(errorDetail.error.publicMessage);

    await admin.query(`UPDATE engine_universal_queue_destinations
      SET destination_name_snapshot='Configuração renomeada'
      WHERE queue_item_id=$1`, [sentId]);
    const immutableDetail = await historyDetail({ pool, workspaceId: workspace,
      historyId: sentProjection.historyId });
    assert.equal(immutableDetail.targets[0].destinationName, "Ofertas VIP");
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE workspace_id=$1`, [workspace])).rows[0].n, 3);

    console.log("HISTORY_V1_POSTGRES17_PASS", JSON.stringify({
      schemaTables: tables.length, requiredIndexes: indexes.length,
      finalized: summary.finalized, sent: summary.sent,
      partial: summary.partial, errors: summary.errors,
      listed: listed.items.length, idempotent: true,
      expiredExcluded: true, discardedExcluded: true,
      ackDetail: true, errorDetail: true, snapshotImmutable: true
    }));
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end().catch(() => {});
  }
}

main().catch(error => {
  console.error("HISTORY_V1_POSTGRES17_FAIL", error?.code || error?.message,
    error?.constraint || "", error?.stack || error?.message || "");
  process.exitCode = 1;
});
