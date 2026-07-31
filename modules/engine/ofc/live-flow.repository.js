const { queryEngine } = require("../database");

const STATUS_VIVOS_FLUXO = ["pendente", "pronto_para_importar", "processando", "importando"];
const STATUS_CIRCULAVEIS_FLUXO = ["pendente", "pronto_para_importar"];

function limitarInteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

function linhaUnica(resultado, fallback = {}) {
  return resultado?.ok ? resultado.resultado?.rows?.[0] || fallback : fallback;
}

async function consultarFluxoVivoOfc({ janelaMinutos = 15, limiteAmostra = 2000 } = {}) {
  const janela = limitarInteiro(janelaMinutos, 15, 1, 120);
  const limite = limitarInteiro(limiteAmostra, 2000, 1, 5000);

  const [vivos, circulaveis, chegada, consumo, expiracao, primeiraTentativa, radarOferta, amostra] = await Promise.all([
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(criado_em) AS mais_antigo_em,
              MAX(criado_em) AS mais_novo_em,
              COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - criado_em)) * 1000), 0)::bigint AS idade_media_ms
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])`,
      [STATUS_VIVOS_FLUXO]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(criado_em) AS mais_antigo_em,
              MAX(criado_em) AS mais_novo_em,
              COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - criado_em)) * 1000), 0)::bigint AS idade_media_ms
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])`,
      [STATUS_CIRCULAVEIS_FLUXO]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(criado_em) AS primeiro_em,
              MAX(criado_em) AS ultimo_em
         FROM engine_jobs_cliente
        WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')`,
      [janela]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(criado_em) AS primeiro_em,
              MAX(criado_em) AS ultimo_em
         FROM engine_processamentos
        WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')`,
      [janela]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(atualizado_em) AS primeiro_em,
              MAX(atualizado_em) AS ultimo_em
         FROM engine_jobs_cliente
        WHERE status = 'expirada_operacional'
          AND atualizado_em >= NOW() - ($1::int * INTERVAL '1 minute')`,
      [janela]
    ),
    queryEngine(
      `WITH primeira AS (
         SELECT job_id, MIN(criado_em) AS primeira_tentativa_em
           FROM engine_processamentos
          WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
          GROUP BY job_id
       )
       SELECT COUNT(*)::int AS total,
              COALESCE(AVG(EXTRACT(EPOCH FROM (p.primeira_tentativa_em - j.criado_em)) * 1000), 0)::bigint AS media_ms
         FROM primeira p
         JOIN engine_jobs_cliente j ON j.id = p.job_id
        WHERE p.primeira_tentativa_em >= j.criado_em`,
      [janela]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(o.criada_em, j.atualizado_em) - j.criado_em)) * 1000), 0)::bigint AS media_ms
         FROM engine_jobs_cliente j
         LEFT JOIN engine_ofertas o ON o.id = j.oferta_id
        WHERE j.oferta_id IS NOT NULL
          AND j.criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
          AND COALESCE(o.criada_em, j.atualizado_em) >= j.criado_em
          AND (
            j.metadata ? 'radarMirror'
            OR j.metadata ? 'espelhoComercial'
            OR (j.metadata->'metadataEvento') ? 'radarMirror'
            OR (j.metadata->'metadataEvento') ? 'espelhoComercial'
            OR LOWER(COALESCE(j.metadata->>'origem', '')) LIKE '%radar%'
            OR LOWER(COALESCE(j.metadata->>'fonte', '')) LIKE '%radar%'
          )`,
      [Math.max(janela, 30)]
    ),
    queryEngine(
      `SELECT id,
              cliente_id,
              status,
              COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), 'desconhecido') AS marketplace,
              metadata,
              criado_em,
              atualizado_em
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
        ORDER BY criado_em ASC, id ASC
        LIMIT $2`,
      [STATUS_CIRCULAVEIS_FLUXO, limite]
    )
  ]);

  const consultas = [vivos, circulaveis, chegada, consumo, expiracao, primeiraTentativa, radarOferta, amostra];
  const falha = consultas.find(item => !item.ok);

  return {
    ok: !falha,
    janelaMinutos: janela,
    limiteAmostra: limite,
    vivos: linhaUnica(vivos, { total: 0 }),
    circulaveis: linhaUnica(circulaveis, { total: 0 }),
    chegada: linhaUnica(chegada, { total: 0 }),
    consumo: linhaUnica(consumo, { total: 0 }),
    expiracao: linhaUnica(expiracao, { total: 0 }),
    primeiraTentativa: linhaUnica(primeiraTentativa, { total: 0, media_ms: 0 }),
    radarOferta: linhaUnica(radarOferta, { total: 0, media_ms: 0 }),
    amostraCirculavel: amostra.ok ? amostra.resultado?.rows || [] : [],
    erro: falha?.erro || "",
    motivo: falha?.motivo || ""
  };
}

module.exports = {
  STATUS_VIVOS_FLUXO,
  STATUS_CIRCULAVEIS_FLUXO,
  consultarFluxoVivoOfc
};
