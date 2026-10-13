"use strict";

const COMMERCIAL = new Set(["sent", "partial", "error"]);

function text(value = "") { return String(value ?? "").trim(); }
function first(payload, keys) {
  for (const key of keys) if (payload?.[key] !== undefined && payload[key] !== null && text(payload[key])) return text(payload[key]);
  return "";
}

function publicError(reason = "", evidence = "") {
  const code = text(reason).toLowerCase().slice(0, 120) || "send_failed";
  const sample = `${code} ${text(evidence).toLowerCase()}`;
  let stage = "other";
  if (/imagem|image/.test(sample)) stage = "image";
  else if (/link/.test(sample)) stage = "link";
  else if (/afilia/.test(sample)) stage = "affiliation";
  else if (/sessao|session|provider|whatsapp|telegram|discord/.test(sample)) stage = "provider_session";
  else if (/destino|target|grupo|canal/.test(sample)) stage = "destination";
  else if (/parser|contrato/.test(sample)) stage = "parser_contract";
  else if (/integracao|adapter/.test(sample)) stage = "integration";
  return { stage, code, message: stage === "other" ? "Falha terminal no envio." : {
    image: "A imagem não pôde ser preparada para envio.",
    link: "O link não pôde ser preparado para envio.",
    affiliation: "A afiliação não pôde ser confirmada.",
    provider_session: "A sessão ou o provedor recusou o envio.",
    destination: "O destino não pôde concluir o envio.",
    parser_contract: "O contrato da oferta não pôde ser processado.",
    integration: "A integração não pôde concluir o envio."
  }[stage] };
}

function commercialStatus(targets) {
  const sent = targets.filter(target => target.status === "sent");
  const failed = targets.filter(target => target.status === "failed");
  if (sent.length && failed.length) return { status: "partial", sent, failed };
  if (sent.length) return { status: "sent", sent, failed };
  if (failed.length) return { status: "error", sent, failed };
  return null;
}

async function projectUniversalTerminalTx(client, { queueItemId, workspaceId } = {}) {
  const workspace = text(workspaceId);
  if (!client || typeof client.query !== "function" || !workspace || !Number.isSafeInteger(Number(queueItemId))) {
    throw new Error("history_projection_identity_required");
  }
  const item = (await client.query(`SELECT id,workspace_id,item_payload,status,
      terminal_at,origem_fluxo FROM engine_universal_queue_items
    WHERE id=$1 AND workspace_id=$2 FOR SHARE`, [queueItemId, workspace])).rows[0];
  if (!item?.terminal_at) return { projected: false, reason: "not_terminal" };
  const rawTargets = (await client.query(`SELECT destination_id,target_key,channel,
      status,provider_message_id,confirmed_at,terminal_reason,terminal_evidence,
      destination_name_snapshot,target_label_snapshot
    FROM engine_universal_queue_destinations
    WHERE queue_item_id=$1 AND workspace_id=$2 ORDER BY id`, [queueItemId, workspace])).rows;
  const targets = rawTargets.filter(target => target.status === "sent" || target.status === "failed");
  for (const target of targets.filter(target => target.status === "sent")) {
    if (!text(target.provider_message_id) || !target.confirmed_at) throw new Error("history_sent_ack_unproven");
  }
  const result = commercialStatus(targets);
  if (!result) return { projected: false, reason: "no_commercial_terminal_fact" };
  const payload = item.item_payload && typeof item.item_payload === "object" ? item.item_payload : {};
  const names = [...new Set(targets.map(target => text(target.destination_name_snapshot) || text(target.destination_id)).filter(Boolean))];
  const channels = [...new Set(targets.map(target => text(target.channel)).filter(Boolean))];
  const itemError = result.status === "error"
    ? publicError(result.failed[0]?.terminal_reason, result.failed[0]?.terminal_evidence) : null;
  const inserted = (await client.query(`INSERT INTO engine_history_items
    (workspace_id,source_key,universal_item_id,marketplace,title,thumbnail_url,
     price_text,category,commercial_status,total_targets,sent_targets,
     failed_targets,destination_summary,channels,finalized_at,source_origin,
     error_stage,error_code,error_public_message)
    VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10,$11,
      $12,NULLIF($13,''),$14::text[],$15,$16,NULLIF($17,''),NULLIF($18,''),NULLIF($19,''))
    ON CONFLICT (workspace_id,source_key) DO NOTHING RETURNING history_id`,
  [workspace, `universal:${item.id}`, item.id,
    first(payload,["marketplace","mercado"]), first(payload,["titulo","nome","title"]),
    first(payload,["imagemLista","imagem","thumbnail","image"]),
    first(payload,["precoAtual","preco","price"]), first(payload,["categoria","category"]),
    result.status, targets.length, result.sent.length, result.failed.length,
    names.length === 1 ? names[0] : (names.length ? `${names.length} destinos` : ""),
    channels, item.terminal_at, text(item.origem_fluxo), itemError?.stage || "",
    itemError?.code || "", itemError?.message || ""])).rows[0];
  if (!inserted) return { projected: true, duplicate: true };
  for (const target of targets) {
    const failure = target.status === "failed"
      ? publicError(target.terminal_reason, target.terminal_evidence) : null;
    await client.query(`INSERT INTO engine_history_targets
      (history_id,workspace_id,destination_id,destination_name_snapshot,
       target_label_snapshot,channel,target_key,status,provider_message_id,
       confirmed_at,error_stage,error_code,error_public_message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),$10,NULLIF($11,''),
        NULLIF($12,''),NULLIF($13,''))`, [inserted.history_id, workspace,
      text(target.destination_id), text(target.destination_name_snapshot) || text(target.destination_id),
      text(target.target_label_snapshot) || text(target.target_key), text(target.channel),
      text(target.target_key), target.status, target.status === "sent" ? text(target.provider_message_id) : "",
      target.status === "sent" ? target.confirmed_at : null, failure?.stage || "",
      failure?.code || "", failure?.message || ""]);
  }
  return { projected: true, duplicate: false, historyId: inserted.history_id };
}

const SAFE_PRE_UNIVERSAL = /(?:sem_imagem|imagem.*apos_retries|sem_link|link.*ausent|afiliacao.*apos_retries|marketplace_nao_detectado|adapter_nao_implementado|erro_parser|parser.*falh|contrato.*inval|evento_nao_encontrado|integracao_ausente)/i;
async function projectPreUniversalTerminalError({ pool, job = {}, reason, stage } = {}) {
  const workspace = text(job.cliente_id || job.clienteId);
  const jobId = Number(job.id);
  const code = text(reason);
  if (!pool || typeof pool.query !== "function" || !workspace || !Number.isSafeInteger(jobId) || jobId <= 0 || !SAFE_PRE_UNIVERSAL.test(code)) {
    return { projected: false, reason: "pre_universal_not_safely_classified" };
  }
  const error = publicError(code, stage);
  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const payload = metadata.comercialCapturado || metadata.metadataEvento?.comercialCapturado || metadata;
  const row = (await pool.query(`INSERT INTO engine_history_items
    (workspace_id,source_key,marketplace,title,thumbnail_url,price_text,category,
     commercial_status,total_targets,sent_targets,failed_targets,channels,
     finalized_at,source_origin,error_stage,error_code,error_public_message)
    VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),'error',0,0,0,
      '{}'::text[],clock_timestamp(),$8,$9,$10,$11)
    ON CONFLICT (workspace_id,source_key) DO NOTHING RETURNING history_id`,
  [workspace, `pre_universal:job:${jobId}`, first(job,["marketplace","marketplace_detectado"]),
    first(payload,["titulo","tituloCapturado","nome","title"]),
    first(payload,["imagem","imagemUrl","thumbnail"]), first(payload,["precoAtual","preco","price"]),
    first(payload,["categoria","category"]), first(metadata,["origemFluxo","origem"]) || "engine_pre_universal",
    error.stage, error.code, error.message])).rows[0];
  return { projected: true, duplicate: !row, historyId: row?.history_id || null };
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const at = new Date(parsed.finalizedAt);
    if (!Number.isFinite(at.getTime()) || !/^[1-9]\d*$/.test(String(parsed.historyId))) throw new Error();
    return { finalizedAt: at.toISOString(), historyId: String(parsed.historyId) };
  } catch { throw new Error("history_cursor_invalid"); }
}
function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ finalizedAt: row.finalized_at, historyId: row.history_id })).toString("base64url");
}
function periodStart(period = "hoje") {
  return period === "7dias"
    ? `((date_trunc('day',transaction_timestamp() AT TIME ZONE 'America/Sao_Paulo') - interval '6 days') AT TIME ZONE 'America/Sao_Paulo')`
    : `((date_trunc('day',transaction_timestamp() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo')`;
}
function filtersSql({ workspaceId, period, status, marketplace, channel, destinationId, search, cursor }, includeCursor = true) {
  const params = [text(workspaceId)];
  const clauses = [`h.workspace_id=$1`, `h.finalized_at>=${periodStart(period)}`];
  if (status === "sent") clauses.push(`h.commercial_status IN ('sent','partial')`);
  else if (["partial","error"].includes(status)) { params.push(status); clauses.push(`h.commercial_status=$${params.length}`); }
  if (marketplace) { params.push(text(marketplace).toLowerCase()); clauses.push(`lower(h.marketplace)=$${params.length}`); }
  if (search) { params.push(`%${text(search)}%`); clauses.push(`h.title ILIKE $${params.length}`); }
  if (channel || destinationId) {
    params.push(text(channel).toLowerCase(), text(destinationId));
    clauses.push(`EXISTS (SELECT 1 FROM engine_history_targets ht WHERE ht.history_id=h.history_id AND ht.workspace_id=h.workspace_id AND ($${params.length-1}='' OR ht.channel=$${params.length-1}) AND ($${params.length}='' OR ht.destination_id=$${params.length}))`);
  }
  if (includeCursor && cursor) {
    params.push(cursor.finalizedAt, cursor.historyId);
    clauses.push(`(h.finalized_at,h.history_id)<($${params.length-1}::timestamptz,$${params.length}::bigint)`);
  }
  return { where: clauses.join(" AND "), params };
}

async function historicoResumo({ pool, workspace, periodo = "hoje" } = {}) {
  const workspaceId = workspace;
  const period = periodo;
  const { where, params } = filtersSql({ workspaceId, period }, false);
  const row = (await pool.query(`SELECT count(*)::int AS finalized,
      count(*) FILTER (WHERE commercial_status IN ('sent','partial'))::int AS sent,
      count(*) FILTER (WHERE commercial_status='partial')::int AS partial,
      count(*) FILTER (WHERE commercial_status='error')::int AS errors
    FROM engine_history_items h WHERE ${where}`, params)).rows[0];
  const finalized = Number(row.finalized || 0), sent = Number(row.sent || 0);
  return { finalized, sent, partial: Number(row.partial || 0), errors: Number(row.errors || 0), sendRate: finalized ? sent / finalized : 0 };
}

async function listHistory({ pool, workspaceId, period = "hoje", status = "all", marketplace = "", channel = "", destinationId = "", search = "", cursor: rawCursor = "", limit = 50 } = {}) {
  const workspace = text(workspaceId);
  if (!pool || typeof pool.query !== "function" || !workspace) throw new Error("history_context_required");
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
  const cursor = decodeCursor(rawCursor);
  const [{ where, params }, summary] = await Promise.all([
    Promise.resolve(filtersSql({ workspaceId: workspace, period, status, marketplace, channel, destinationId, search, cursor })),
    historicoResumo({ pool, workspace, periodo: period })
  ]);
  const rows = (await pool.query(`SELECT h.history_id,h.thumbnail_url,h.title,h.price_text,
      h.marketplace,h.category,h.commercial_status,h.total_targets,h.sent_targets,
      h.failed_targets,h.destination_summary,h.channels,h.finalized_at
    FROM engine_history_items h WHERE ${where}
    ORDER BY h.finalized_at DESC,h.history_id DESC LIMIT $${params.length+1}`, [...params, pageSize + 1])).rows;
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);
  return { ok: true, summary, items: visible.map(row => ({ historyId: String(row.history_id), thumbnail: row.thumbnail_url || "", title: row.title, price: row.price_text || "", marketplace: row.marketplace, category: row.category || "", status: row.commercial_status, totalTargets: row.total_targets, sentTargets: row.sent_targets, failedTargets: row.failed_targets, destinationSummary: row.destination_summary || "", channels: row.channels || [], finalizedAt: row.finalized_at })), nextCursor: hasMore ? encodeCursor(visible.at(-1)) : null };
}

async function historyDetail({ pool, workspaceId, historyId } = {}) {
  const workspace = text(workspaceId), id = text(historyId);
  if (!pool || typeof pool.query !== "function" || !workspace || !/^[1-9]\d*$/.test(id)) return null;
  const item = (await pool.query(`SELECT history_id,marketplace,title,thumbnail_url,price_text,
      category,commercial_status,total_targets,sent_targets,failed_targets,
      finalized_at,source_origin,error_stage,error_code,error_public_message
    FROM engine_history_items WHERE history_id=$1 AND workspace_id=$2`, [id, workspace])).rows[0];
  if (!item) return null;
  const targets = (await pool.query(`SELECT destination_id,destination_name_snapshot,
      target_label_snapshot,channel,target_key,status,provider_message_id,
      confirmed_at,error_stage,error_code,error_public_message
    FROM engine_history_targets WHERE history_id=$1 AND workspace_id=$2
    ORDER BY status DESC,history_target_id`, [id, workspace])).rows;
  return { historyId: String(item.history_id), product: { title: item.title, thumbnail: item.thumbnail_url || "", price: item.price_text || "", category: item.category || "" }, marketplace: item.marketplace, status: item.commercial_status, totalTargets: item.total_targets, sentTargets: item.sent_targets, failedTargets: item.failed_targets, finalizedAt: item.finalized_at, sourceOrigin: item.source_origin || "", error: item.error_code ? { stage: item.error_stage || "other", code: item.error_code, publicMessage: item.error_public_message || "Falha terminal." } : null, targets: targets.map(target => ({ destinationId: target.destination_id, destinationName: target.destination_name_snapshot, targetLabel: target.target_label_snapshot, channel: target.channel, targetKey: target.target_key, status: target.status, ack: target.status === "sent", providerMessageId: target.provider_message_id || "", confirmedAt: target.confirmed_at, error: target.error_code ? { stage: target.error_stage || "other", code: target.error_code, publicMessage: target.error_public_message || "Falha terminal." } : null })) };
}

module.exports = { COMMERCIAL, publicError, commercialStatus, projectUniversalTerminalTx,
  projectPreUniversalTerminalError, historicoResumo, listHistory, historyDetail,
  decodeCursor, encodeCursor };
