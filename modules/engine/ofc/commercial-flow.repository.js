const { queryEngine } = require("../database");

function linhaUnica(resultado, fallback = {}) {
  return resultado?.ok ? resultado.resultado?.rows?.[0] || fallback : fallback;
}

function linhas(resultado) {
  return resultado?.ok ? resultado.resultado?.rows || [] : [];
}

async function consultarFluxoComercialOfc({ janelaMinutos = 15 } = {}) {
  const janela = Math.max(1, Math.min(120, Math.floor(Number(janelaMinutos) || 15)));
  const [eventos, porMarketplace, porCliente, porCanal, radarOferta] = await Promise.all([
    queryEngine(
      `SELECT tipo_evento, COUNT(*)::int AS total
         FROM engine_eventos_comerciais
        WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
        GROUP BY tipo_evento`,
      [janela]
    ),
    queryEngine(
      `SELECT tipo_evento,
              COALESCE(NULLIF(TRIM(marketplace), ''), 'desconhecido') AS marketplace,
              COUNT(*)::int AS total
         FROM engine_eventos_comerciais
        WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
        GROUP BY tipo_evento, COALESCE(NULLIF(TRIM(marketplace), ''), 'desconhecido')
        ORDER BY total DESC
        LIMIT 40`,
      [janela]
    ),
    queryEngine(
      `SELECT tipo_evento,
              COALESCE(NULLIF(TRIM(cliente_id), ''), 'desconhecido') AS cliente_id,
              COUNT(*)::int AS total
         FROM engine_eventos_comerciais
        WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
        GROUP BY tipo_evento, COALESCE(NULLIF(TRIM(cliente_id), ''), 'desconhecido')
        ORDER BY total DESC
        LIMIT 40`,
      [janela]
    ),
    queryEngine(
      `SELECT tipo_evento,
              COALESCE(NULLIF(TRIM(canal), ''), 'desconhecido') AS canal,
              COUNT(*)::int AS total
         FROM engine_eventos_comerciais
        WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
        GROUP BY tipo_evento, COALESCE(NULLIF(TRIM(canal), ''), 'desconhecido')
        ORDER BY total DESC
        LIMIT 40`,
      [janela]
    ),
    queryEngine(
      `WITH radar_jobs AS (
         SELECT j.id AS job_id,
                j.oferta_id,
                j.criado_em AS job_criado_em,
                e.capturado_em AS evento_capturado_em,
                o.criada_em AS oferta_criada_em
           FROM engine_jobs_cliente j
           JOIN engine_eventos_brutos e ON e.id = j.evento_id
           LEFT JOIN engine_ofertas o ON o.id = j.oferta_id
          WHERE j.criado_em >= NOW() - (GREATEST($1::int, 30) * INTERVAL '1 minute')
            AND (
              LOWER(COALESCE(e.origem, '')) LIKE '%radar%'
              OR LOWER(COALESCE(e.fonte, '')) LIKE '%radar%'
              OR LOWER(COALESCE(e.origem_tipo, '')) IN ('whatsapp', 'telegram')
              OR e.metadata ? 'radarMirror'
              OR e.metadata ? 'espelhoComercial'
              OR LOWER(COALESCE(j.metadata->>'origem', '')) LIKE '%radar%'
              OR LOWER(COALESCE(j.metadata->>'fonte', '')) LIKE '%radar%'
              OR j.metadata ? 'radarMirror'
              OR j.metadata ? 'espelhoComercial'
              OR (j.metadata->'metadataEvento') ? 'radarMirror'
              OR (j.metadata->'metadataEvento') ? 'espelhoComercial'
              OR LOWER(COALESCE(o.origem, '')) LIKE '%radar%'
              OR o.metadata ? 'radarMirror'
              OR o.metadata ? 'espelhoComercial'
              OR LOWER(COALESCE(o.metadata->>'fonteComercial', '')) LIKE '%radar%'
            )
       ),
       com_oferta AS (
         SELECT EXTRACT(EPOCH FROM (COALESCE(oferta_criada_em, job_criado_em) - evento_capturado_em)) * 1000 AS tempo_ms
           FROM radar_jobs
          WHERE oferta_id IS NOT NULL
            AND evento_capturado_em IS NOT NULL
            AND COALESCE(oferta_criada_em, job_criado_em) >= evento_capturado_em
       )
       SELECT (SELECT COUNT(*)::int FROM radar_jobs) AS total_radar_jobs,
              (SELECT COUNT(*)::int FROM radar_jobs WHERE oferta_id IS NULL) AS total_sem_vinculo,
              COUNT(*)::int AS total,
              AVG(tempo_ms)::bigint AS media_ms,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tempo_ms)::bigint AS mediana_ms,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tempo_ms)::bigint AS p95_ms
         FROM com_oferta`,
      [janela]
    )
  ]);

  const consultas = [eventos, porMarketplace, porCliente, porCanal, radarOferta];
  const falha = consultas.find(item => !item.ok);
  return {
    ok: !falha,
    janelaMinutos: janela,
    eventos: linhas(eventos),
    porMarketplace: linhas(porMarketplace),
    porCliente: linhas(porCliente),
    porCanal: linhas(porCanal),
    radarOferta: linhaUnica(radarOferta, {
      total_radar_jobs: 0,
      total_sem_vinculo: 0,
      total: 0,
      media_ms: null,
      mediana_ms: null,
      p95_ms: null
    }),
    erro: falha?.erro || "",
    motivo: falha?.motivo || ""
  };
}

module.exports = {
  consultarFluxoComercialOfc
};
