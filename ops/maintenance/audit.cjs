"use strict";

const { createHmac } = require("node:crypto");
const { requireOk } = require("./deployment.cjs");
const selected = `WITH scoped AS (
  SELECT j.id, j.evento_id, j.oferta_id, j.cliente_id, j.status, j.marketplace, j.motivo_final, j.criado_em, j.metadata
  FROM public.engine_jobs_cliente j
  WHERE j.cliente_id=$1 AND j.criado_em >= statement_timestamp() - ($2::int * interval '1 minute')
  ORDER BY j.criado_em DESC, j.id DESC LIMIT $3
)`;
const queries = Object.freeze({
  jobs: selected + ` SELECT id, status, marketplace, motivo_final, criado_em FROM scoped`,
  funil: selected + ` SELECT count(*)::int AS jobs,
    count(*) FILTER (WHERE oferta_id IS NOT NULL)::int AS offers,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.engine_universal_queue_items q
      WHERE q.workspace_id=scoped.cliente_id AND q.job_id=scoped.id AND q.evento_id=scoped.evento_id
        AND q.oferta_id=scoped.oferta_id))::int AS queued FROM scoped`,
  logs: selected + ` SELECT j.id, p.etapa, p.status, p.motivo, p.criado_em
    FROM scoped j JOIN public.engine_processamentos p ON p.job_id=j.id
    ORDER BY p.criado_em DESC, p.id DESC LIMIT $3`,
  work: selected + ` SELECT j.id, t.id AS task_id, t.status, t.capability, t.completed_at
    FROM scoped j
    CROSS JOIN LATERAL (SELECT j.metadata #> '{localWorkerImageRetry,identidadeTask}' AS binding) b
    JOIN public.engine_links l ON l.id=CASE WHEN b.binding->>'linkId' ~ '^[1-9][0-9]{0,17}$'
      THEN (b.binding->>'linkId')::bigint END AND l.evento_id=j.evento_id
    JOIN public.local_worker_tasks t ON t.id=CASE WHEN b.binding->>'taskId' ~ '^[1-9][0-9]{0,17}$'
      THEN (b.binding->>'taskId')::bigint END AND t.product_id=b.binding->>'identityKey'
      AND (t.source_url=l.url_original OR t.source_url=l.url_normalizada OR t.source_url=l.url_expandida)
    WHERE b.binding->>'jobId'=j.id::text AND b.binding->>'eventoId'=j.evento_id::text
      AND b.binding->>'workspaceId'=j.cliente_id AND t.capability='magalu_identity_v1'
    ORDER BY j.id DESC LIMIT $3`,
  acks: selected + ` SELECT j.id, d.channel, count(*)::int AS factual, max(d.confirmed_at) AS last_ack_at
    FROM scoped j JOIN public.engine_universal_queue_items q ON q.job_id=j.id AND q.workspace_id=j.cliente_id
      AND q.evento_id=j.evento_id AND q.oferta_id=j.oferta_id
    JOIN public.engine_universal_queue_destinations d ON d.queue_item_id=q.id AND d.workspace_id=q.workspace_id
      AND d.operation_epoch_started_at=q.operation_epoch_started_at
    WHERE d.status='sent' AND d.confirmed_at IS NOT NULL AND NULLIF(btrim(d.provider_message_id),'') IS NOT NULL
    GROUP BY j.id,d.channel ORDER BY j.id DESC,d.channel LIMIT $3`
});

const allowed = {
  status: new Set(["pendente", "processando", "importando", "erro_importacao", "oferta_criada", "validado",
    "retido", "fila", "pending", "leased", "completed", "failed", "queued", "sent", "ok", "erro"]),
  marketplace: new Set(["mercadolivre", "magalu", "amazon", "shopee", "aliexpress", "kabum"]),
  etapa: new Set(["captura", "validacao", "importador", "normalizacao", "distribuicao", "fila", "ack"]),
  motivo: new Set(["sem_imagem", "sem_link_produto_confirmado", "radar_identidade_titulo_nao_confirmada",
    "mercadolivre_titulo_tecnico_nao_confirmado", "imagem_base_nao_publicavel", "fallback_clonador_insuficiente"]),
  capability: new Set(["magalu_identity_v1"]),
  channel: new Set(["whatsapp", "telegram", "discord"])
};

function sanitize(row) {
  return Object.fromEntries(Object.entries(row).map(([field, value]) => {
    if (["id", "task_id"].includes(field)) return [field, /^[1-9]\d{0,18}$/.test(String(value)) ? String(value) : null];
    if (["jobs", "offers", "queued", "factual"].includes(field)) return [field, Number.isSafeInteger(value) ? value : null];
    if (["criado_em", "last_ack_at", "completed_at"].includes(field)) {
      return [field, value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null];
    }
    const options = allowed[field === "motivo_final" ? "motivo" : field];
    return [field, value == null ? null : options?.has(value) ? value : "other"];
  }));
}

async function auditWorkspace({ pool, scopes, salt, action, workspace, minutes, limit }) {
  requireOk(Object.hasOwn(queries, action), "audit_action_denied");
  requireOk(scopes.includes(workspace), "workspace_denied");
  requireOk(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 &&
    Number.isInteger(limit) && limit >= 1 && limit <= 120, "invalid_audit_bounds");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='2000ms'");
    const result = await client.query(queries[action], [workspace, minutes, limit]);
    await client.query("COMMIT");
    return {
      workspace: createHmac("sha256", salt).update(workspace).digest("hex").slice(0, 16),
      action, minutes, limit, rows: result.rows.map(sanitize)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { auditWorkspace, sanitize };
