"use strict";

const { queryEngine } = require("../database");

const TERMINAL = [
  "enviado", "enviada", "historico", "terminal", "expirada", "expirado",
  "expirada_operacional", "expirado_operacional", "erro_final", "erro_permanente",
  "falha_final", "cancelada", "cancelado", "descartada", "descartado", "duplicada", "duplicado"
];
const EXT = "(?:jpg|jpeg|png|webp|mp4|mov|webm)";

function bucketSeguro(value = "") {
  const bucket = String(value || "");
  if (!/^(?:engine|[a-zA-Z0-9_-]+)$/.test(bucket)) throw new Error("GC_SOCIAL_BUCKET_INVALID");
  return bucket;
}

async function referenciasSocialPostgres({ bucket, query = queryEngine } = {}) {
  const safeBucket = bucketSeguro(bucket);
  const escaped = safeBucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `/social/midia/publica/${escaped}/([^[:space:]\"'?#/]+\\.${EXT})`;
  const sql = `SELECT DISTINCT m[1] AS nome FROM (
      SELECT regexp_matches(coalesce(imagem,'')||' '||coalesce(metadata::text,''),$2,'g') m
        FROM engine_ofertas WHERE atualizada_em >= clock_timestamp()-make_interval(days=>8)
          OR lower(coalesce(status,'')) <> ALL($1::text[])
      UNION ALL
      SELECT regexp_matches(coalesce(metadata::text,''),$2,'g') m
        FROM engine_jobs_cliente WHERE atualizado_em >= clock_timestamp()-make_interval(days=>8)
          OR lower(coalesce(status,'')) <> ALL($1::text[])
      UNION ALL
      SELECT regexp_matches(coalesce(e.metadata::text,''),$2,'g') m
        FROM engine_eventos_brutos e WHERE e.capturado_em >= clock_timestamp()-make_interval(days=>8)
          OR EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id=e.id
            AND lower(coalesce(j.status,'')) <> ALL($1::text[]))
    ) refs`;
  const result = await query(sql, [TERMINAL, pattern], { timeoutSqlMs: 45000 });
  if (!result?.ok || !Array.isArray(result.resultado?.rows)) {
    return { complete: false, refs: new Set(), reasonCode: result?.motivo || "GC_SOCIAL_DB_UNAVAILABLE" };
  }
  return { complete: true,
    refs: new Set(result.resultado.rows.map(row => `social:${safeBucket}/${String(row.nome || "")}`)),
    reasonCode: "" };
}

module.exports = { referenciasSocialPostgres, bucketSeguro, TERMINAL };
