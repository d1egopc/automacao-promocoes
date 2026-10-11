"use strict";

// Epoch-scoped factual projection. This module does not read VIVA or derive
// terminal outcomes from a UI card. It is not yet routed by the HTTP server.
const { lerEstadoOperacional } = require("./operation-epoch");

const PUBLIC_STATUS = Object.freeze({
  sent: "enviada",
  partial: "parcial",
  not_sent: "nao_enviada",
  error: "erro",
  no_opportunity: "nao_elegivel"
});

function statusPublico(status) {
  const result = PUBLIC_STATUS[String(status || "")];
  if (!result) throw new Error("universal_history_status_not_terminal");
  return result;
}

// Operational validation is deliberately outside the definitive epoch and
// therefore outside the normal public History. Its factual row remains
// queryable by the exact gate/workspace identity for cutover audit.
async function consultarHistoricoValidacaoCutover({ pool, gateId,
  workspaceId } = {}) {
  const workspace=String(workspaceId || "").trim();
  if (!pool || typeof pool.query!=="function" || !workspace ||
      !/^[0-9a-f-]{36}$/i.test(String(gateId || ""))) {
    throw new Error("cutover_validation_history_identity_required");
  }
  const row=(await pool.query(`SELECT g.id,g.smoke_epoch_at,
      i.id AS item_id,i.evento_id,i.job_id,i.oferta_id,i.status,
      i.capturado_em,i.terminal_at,
      d.destination_id,d.target_key,d.channel,d.confirmed_at,
      d.provider_message_id,d.credit_debited
    FROM engine_universal_one_shot_smoke g
    JOIN engine_universal_queue_items i ON i.id=g.queue_item_id
      AND i.operation_epoch_started_at=g.smoke_epoch_at
      AND i.workspace_id=g.workspace_id
    JOIN engine_universal_queue_destinations d
      ON d.id=g.queue_destination_id AND d.queue_item_id=i.id
      AND d.operation_epoch_started_at=g.smoke_epoch_at
      AND d.workspace_id=g.workspace_id
    WHERE g.id=$1::uuid AND g.workspace_id=$2`,
  [gateId,workspace])).rows[0];
  if (!row || !row.terminal_at) return null;
  return { kind:"CUTOVER_VALIDATION",id:row.id,
    workspaceId:workspace,operationEpochStartedAt:null,
    smokeEpochAt:row.smoke_epoch_at,itemId:row.item_id,
    eventoId:row.evento_id,jobId:row.job_id,ofertaId:row.oferta_id,
    capturadoEm:row.capturado_em,terminalOcorridoEm:row.terminal_at,
    resultadoFinalPublico:statusPublico(row.status),
    destino:{destinationId:row.destination_id,targetKey:row.target_key,
      channel:row.channel,confirmedAt:row.confirmed_at,
      providerMessageId:row.provider_message_id,
      creditDebited:row.credit_debited===true} };
}

async function consultarHistoricoUniversal({ pool, workspaceId, from, to,
  limit = 50, cursor = null } = {}) {
  const workspace = String(workspaceId || "").trim();
  if (!workspace || !pool || typeof pool.connect !== "function") {
    throw new Error("universal_history_context_required");
  }
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      start >= end) throw new Error("universal_history_period_invalid");
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const state = await lerEstadoOperacional(client);
    if (!state.operationEpochStartedAt) throw new Error("universal_epoch_missing");
    const epoch = state.operationEpochStartedAt;
    const period = [epoch, workspace, start.toISOString(), end.toISOString()];
    const metrics = (await client.query(`SELECT
      count(*)::int AS finalizadas,
      count(*) FILTER (WHERE status='sent')::int AS enviadas,
      count(*) FILTER (WHERE status='partial')::int AS parciais,
      count(*) FILTER (WHERE status='not_sent')::int AS nao_enviadas,
      count(*) FILTER (WHERE status='error')::int AS erros,
      count(*) FILTER (WHERE status='no_opportunity')::int AS sem_oportunidade
      FROM engine_universal_queue_items
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND terminal_at >= GREATEST($3::timestamptz,$1)
        AND terminal_at < $4::timestamptz`, period)).rows[0];
    const cursorAt = cursor?.terminalAt ? new Date(cursor.terminalAt) : null;
    if (cursorAt && !Number.isFinite(cursorAt.getTime())) {
      throw new Error("universal_history_cursor_invalid");
    }
    const rows = (await client.query(`SELECT id,evento_id,job_id,oferta_id,
      origem_fluxo,capturado_em,item_payload,status,terminal_at
      FROM engine_universal_queue_items
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND terminal_at >= GREATEST($3::timestamptz,$1)
        AND terminal_at < $4::timestamptz
        AND ($5::timestamptz IS NULL OR
          (terminal_at,id) < ($5::timestamptz,$6::bigint))
      ORDER BY terminal_at DESC,id DESC LIMIT $7`,
    [...period, cursorAt ? cursorAt.toISOString() : null,
      cursorAt ? cursor.id : null, pageSize])).rows;
    const ids = rows.map(row => row.id);
    const destinations = ids.length ? (await client.query(`SELECT queue_item_id,
      destination_id,target_key,connection_id,channel,status,
      confirmed_at,provider_message_id,credit_debited
      FROM engine_universal_queue_destinations
      WHERE queue_item_id=ANY($1::bigint[])
      ORDER BY queue_item_id,id`, [ids])).rows : [];
    const byItem = new Map();
    for (const destination of destinations) {
      const key = String(destination.queue_item_id);
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(destination);
    }
    const items = rows.map(row => ({
      id: row.id,
      workspaceId: workspace,
      eventoId: row.evento_id,
      jobId: row.job_id,
      ofertaId: row.oferta_id,
      origemFluxo: row.origem_fluxo,
      capturadoEm: row.capturado_em,
      terminalOcorridoEm: row.terminal_at,
      resultadoFinalPublico: statusPublico(row.status),
      oferta: row.item_payload,
      destinos: byItem.get(String(row.id)) || []
    }));
    await client.query("COMMIT");
    open = false;
    const eligible = metrics.enviadas + metrics.parciais +
      metrics.nao_enviadas + metrics.erros;
    return { operationEpochStartedAt: epoch, items,
      nextCursor: rows.length === pageSize ? {
        terminalAt: rows.at(-1).terminal_at, id: rows.at(-1).id
      } : null,
      metrics: { ...metrics, elegiveis: eligible,
        taxaEnvio: eligible ? (metrics.enviadas + metrics.parciais) / eligible : 0 } };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

const VISIONS = Object.freeze({
  fila: null,
  processadas: "terminal",
  enviadas: "sent",
  parciais: "partial",
  nao_enviadas: "not_sent",
  com_erro: "error",
  nao_elegiveis: "no_opportunity"
});

function publicItem(row, destinations = []) {
  const terminal = Boolean(row.terminal_at);
  return { ...(row.item_payload || {}),
    id: `universal_${row.id}`, queueItemId: row.id,
    engineOfertaId: row.oferta_id, engineJobId: row.job_id,
    eventoId: row.evento_id, origemFluxo: row.origem_fluxo,
    status: terminal ? statusPublico(row.status) : "em_distribuicao",
    resultadoFinalPublico: terminal ? statusPublico(row.status) : null,
    timestamp: row.terminal_at || row.created_at,
    terminalOcorridoEm: row.terminal_at || null,
    detalheRef: { arquivo: "universal_queue", id: String(row.id) },
    destinos: destinations };
}

async function consultarFilaPublicaUniversal({ pool, workspaceId,
  filtros = {}, page = 1, limit = 50 } = {}) {
  const workspace = String(workspaceId || "").trim();
  const vision = String(filtros.visao || "processadas");
  if (!workspace || !pool || typeof pool.connect !== "function" ||
      !Object.hasOwn(VISIONS, vision)) {
    throw new Error("universal_public_history_context_invalid");
  }
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const pageNumber = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (pageNumber - 1) * pageSize;
  const daysBack = filtros.periodo === "hoje" ? 0 : 6;
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const state = await lerEstadoOperacional(client);
    if (state.mode !== "UNIVERSAL" || !state.operationEpochStartedAt) {
      throw new Error("universal_history_mode_not_active");
    }
    const epoch = state.operationEpochStartedAt;
    const startSql = `GREATEST($1::timestamptz,
      ((date_trunc('day',transaction_timestamp() AT TIME ZONE 'America/Sao_Paulo')
        - ($3::int * interval '1 day')) AT TIME ZONE 'America/Sao_Paulo'))`;
    const metrics = (await client.query(`SELECT
      count(*) FILTER (WHERE terminal_at IS NOT NULL)::int AS finalizadas,
      count(*) FILTER (WHERE terminal_at IS NOT NULL AND status='sent')::int AS enviadas,
      count(*) FILTER (WHERE terminal_at IS NOT NULL AND status='partial')::int AS parciais,
      count(*) FILTER (WHERE terminal_at IS NOT NULL AND status='not_sent')::int AS nao_enviadas,
      count(*) FILTER (WHERE terminal_at IS NOT NULL AND status='error')::int AS erros,
      count(*) FILTER (WHERE terminal_at IS NOT NULL AND status='no_opportunity')::int AS sem_oportunidade,
      count(*) FILTER (WHERE terminal_at IS NULL)::int AS em_distribuicao
      FROM engine_universal_queue_items
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
        AND COALESCE(terminal_at,created_at)>=${startSql}`,
    [epoch, workspace, daysBack])).rows[0];
    const selected = VISIONS[vision];
    const predicates = ["operation_epoch_started_at=$1", "workspace_id=$2",
      `COALESCE(terminal_at,created_at)>=${startSql}`,
      selected === null ? "terminal_at IS NULL" : "terminal_at IS NOT NULL"];
    const params = [epoch, workspace, daysBack];
    if (selected && selected !== "terminal") {
      params.push(selected);
      predicates.push(`status=$${params.length}`);
    }
    if (filtros.marketplace) {
      params.push(String(filtros.marketplace).toLowerCase());
      predicates.push(`LOWER(COALESCE(item_payload->>'marketplace',
        item_payload->>'mercado',''))=$${params.length}`);
    }
    if (filtros.q || filtros.busca) {
      params.push(`%${String(filtros.q || filtros.busca).trim()}%`);
      predicates.push(`(COALESCE(item_payload->>'titulo',item_payload->>'nome','')
        ILIKE $${params.length} OR oferta_id::text ILIKE $${params.length})`);
    }
    if (filtros.canal || filtros.destinoId) {
      params.push(String(filtros.canal || "").toLowerCase(),
        String(filtros.destinoId || ""));
      predicates.push(`EXISTS (SELECT 1 FROM engine_universal_queue_destinations d
        WHERE d.queue_item_id=engine_universal_queue_items.id
          AND ($${params.length - 1}='' OR d.channel=$${params.length - 1})
          AND ($${params.length}='' OR d.destination_id=$${params.length}))`);
    }
    const where = predicates.join(" AND ");
    const total = Number((await client.query(`SELECT count(*)::int AS n
      FROM engine_universal_queue_items WHERE ${where}`, params)).rows[0].n);
    const rows = (await client.query(`SELECT id,evento_id,job_id,oferta_id,
      origem_fluxo,item_payload,status,terminal_at,created_at
      FROM engine_universal_queue_items WHERE ${where}
      ORDER BY COALESCE(terminal_at,created_at) DESC,id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset])).rows;
    const ids = rows.map(row => row.id);
    const targets = ids.length ? (await client.query(`SELECT queue_item_id,
      destination_id,target_key,channel,status,confirmed_at,provider_message_id,
      credit_debited FROM engine_universal_queue_destinations
      WHERE queue_item_id=ANY($1::bigint[]) ORDER BY queue_item_id,id`, [ids])).rows : [];
    const byItem = new Map();
    for (const target of targets) {
      const key = String(target.queue_item_id);
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(target);
    }
    await client.query("COMMIT");
    open = false;
    const eligible = metrics.enviadas + metrics.parciais +
      metrics.nao_enviadas + metrics.erros;
    return { ok: true, projectionReady: true, visao: vision,
      operationEpochStartedAt: epoch,
      metricas: { finalizadas: metrics.finalizadas, elegiveis: eligible,
        enviadasCompletas: metrics.enviadas, parciais: metrics.parciais,
        naoEnviadas: metrics.nao_enviadas, erros: metrics.erros,
        naoElegiveis: metrics.sem_oportunidade,
        emDistribuicao: metrics.em_distribuicao,
        fechaMatematicamente: metrics.finalizadas ===
          eligible + metrics.sem_oportunidade },
      itens: rows.map(row => publicItem(row,
        byItem.get(String(row.id)) || [])),
      totalFiltrado: total, page: pageNumber, limit: pageSize, offset,
      totalPages: Math.ceil(total / pageSize),
      hasMore: offset + rows.length < total };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function consultarDetalheUniversal({ pool, workspaceId, detalheRef } = {}) {
  const workspace = String(workspaceId || "").trim();
  const ref = detalheRef && typeof detalheRef === "object" ? detalheRef : {};
  const id = String(ref.id || "").trim();
  if (!workspace || ref.arquivo !== "universal_queue" ||
      !/^[1-9]\d*$/.test(id) || !pool || typeof pool.connect !== "function") {
    return { ok: false, motivo: "detalhe_ref_invalido" };
  }
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const state = await lerEstadoOperacional(client);
    if (state.mode !== "UNIVERSAL" || !state.operationEpochStartedAt) {
      throw new Error("universal_history_mode_not_active");
    }
    const row = (await client.query(`SELECT id,evento_id,job_id,oferta_id,
      origem_fluxo,item_payload,status,terminal_at,created_at
      FROM engine_universal_queue_items
      WHERE id=$1 AND operation_epoch_started_at=$2 AND workspace_id=$3`,
    [id, state.operationEpochStartedAt, workspace])).rows[0];
    const targets = row ? (await client.query(`SELECT destination_id,
      target_key,channel,status,confirmed_at,provider_message_id,credit_debited
      FROM engine_universal_queue_destinations
      WHERE queue_item_id=$1 AND operation_epoch_started_at=$2
        AND workspace_id=$3 ORDER BY id`,
    [id, state.operationEpochStartedAt, workspace])).rows : [];
    await client.query("COMMIT");
    open = false;
    return row ? { ok: true, detalheRef: ref, fonte: "universal_queue",
      detalhe: publicItem(row, targets),
      diagnostico: { leiturasFisicas: 0, bytesLidos: 0,
        leuFilaJson: false } }
      : { ok: false, motivo: "detalhe_nao_encontrado", detalheRef: ref };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { statusPublico, consultarHistoricoValidacaoCutover,
  consultarHistoricoUniversal,
  consultarFilaPublicaUniversal, consultarDetalheUniversal };
