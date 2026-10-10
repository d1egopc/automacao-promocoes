"use strict";

// Read-only Social source for the authoritative post-epoch queue. Never
// falls back to VIVA when the operational mode is UNIVERSAL or unknown.
const { lerEstadoOperacional } = require("../engine/operation-epoch");
const { avaliarFrescorPosClassificacaoCandidato } =
  require("../engine/post-classification-freshness.candidate");

let runtime = null;

function configurarFonteUniversalSocial({ getMode, getPool } = {}) {
  if (typeof getMode !== "function" || typeof getPool !== "function") {
    throw new Error("social_universal_source_invalid");
  }
  runtime = { getMode, getPool };
}

function modoFonteSocial() {
  return runtime ? String(runtime.getMode() || "") : "LEGACY";
}

async function contextoUniversal() {
  const mode = modoFonteSocial();
  if (mode === "LEGACY") return null;
  if (mode !== "UNIVERSAL") throw new Error("social_operational_mode_not_ready");
  const pool = runtime.getPool();
  if (!pool || typeof pool.query !== "function") throw new Error("social_universal_pool_missing");
  const state = await lerEstadoOperacional(pool);
  if (state.mode !== "UNIVERSAL" || !state.operationEpochStartedAt) {
    throw new Error("social_universal_epoch_not_active");
  }
  return { pool, epoch: state.operationEpochStartedAt };
}

function itemSocial(row, workspaceId) {
  const payload = row.item_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("social_universal_payload_invalid");
  }
  if (payload.clienteId && String(payload.clienteId) !== workspaceId) {
    throw new Error("social_universal_workspace_conflict");
  }
  if (payload.engineOfertaId && String(payload.engineOfertaId) !== String(row.oferta_id)) {
    throw new Error("social_universal_offer_conflict");
  }
  const capture = new Date(row.capturado_em).toISOString();
  const freshness = avaliarFrescorPosClassificacaoCandidato({
    ...payload, origem: row.origem_fluxo, evento_capturado_em: capture
  });
  if (!freshness.ok) return null;
  return {
    ...payload,
    id: `universal_${row.id}`,
    ofertaId: String(row.oferta_id),
    engineOfertaId: String(row.oferta_id),
    clienteId: workspaceId,
    // Enqueue by the Universal Distributor is the approval boundary. Social
    // must not drop a valid queue item solely for lacking legacy V2 markers.
    ofertaUniversal: true,
    origemFluxo: row.origem_fluxo,
    // T0 is factual capture time, never the time of a delayed projection.
    dataEntradaFila: capture,
    operationEpochStartedAt: new Date(row.operation_epoch_started_at).toISOString()
  };
}

async function listarItensUniversaisSocial(workspaceId) {
  const context = await contextoUniversal();
  if (!context) return null;
  const workspace = String(workspaceId || "").trim();
  if (!workspace) throw new Error("social_workspace_required");
  // Query only the current epoch/workspace. The normal commercial horizon is
  // 30 minutes; Manual V2 is explicitly exempt. Do not truncate candidates
  // before the existing Social ranking chooses its top 50.
  const result = await context.pool.query(`SELECT id,operation_epoch_started_at,
      oferta_id,origem_fluxo,capturado_em,item_payload
    FROM engine_universal_queue_items
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
      AND (capturado_em >= clock_timestamp() - INTERVAL '30 minutes'
        OR origem_fluxo ~* 'manual'
        OR item_payload->'metadata'->>'manualV2'='true'
        OR item_payload->'metadata'->>'manual_v2'='true')
    ORDER BY id DESC`, [context.epoch, workspace]);
  return result.rows.map(row => itemSocial(row, workspace)).filter(Boolean);
}

async function encontrarItemUniversalSocial(workspaceId, ofertaId) {
  const context = await contextoUniversal();
  if (!context) return null;
  const workspace = String(workspaceId || "").trim();
  const requested = String(ofertaId || "").trim();
  if (!workspace || !requested) return null;
  const queueId = /^universal_([1-9]\d*)$/.exec(requested)?.[1] || null;
  const offerId = /^[1-9]\d*$/.test(requested) ? requested : null;
  if (!queueId && !offerId) return null;
  const result = await context.pool.query(`SELECT id,operation_epoch_started_at,
      oferta_id,origem_fluxo,capturado_em,item_payload
    FROM engine_universal_queue_items
    WHERE operation_epoch_started_at=$1 AND workspace_id=$2
      AND ${queueId ? "id=$3" : "oferta_id=$3"}
    LIMIT 1`, [context.epoch, workspace, queueId || offerId]);
  return result.rows[0] ? itemSocial(result.rows[0], workspace) : null;
}

module.exports = { configurarFonteUniversalSocial, modoFonteSocial,
  listarItensUniversaisSocial, encontrarItemUniversalSocial };
