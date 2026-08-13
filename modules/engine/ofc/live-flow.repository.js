const { queryEngine } = require("../database");
const { minutosLeaseJobsAtivos } = require("../jobs.service");

const STATUS_VIVOS_FLUXO = ["pendente", "pronto_para_importar", "processando", "importando"];
const STATUS_CIRCULAVEIS_FLUXO = ["pendente", "pronto_para_importar"];
const STATUS_EM_CURSO_PROTEGIDOS_FLUXO = ["processando", "importando"];

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
  const leaseMinutos = minutosLeaseJobsAtivos();
  const condicaoVivoSql = `
           (
             status = ANY($1::text[])
             AND (
               status <> ALL($2::text[])
               OR COALESCE(atualizado_em, criado_em) >= NOW() - ($3::int * INTERVAL '1 minute')
             )
           )`;

  const [vivos, circulaveis, emCursoProtegidos, saudeEmCurso, chegada, consumo, expiracao, primeiraTentativa, radarOferta, amostra, primeiraTentativaReset] = await Promise.all([
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              MIN(criado_em) AS mais_antigo_em,
              MAX(criado_em) AS mais_novo_em,
              COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - criado_em)) * 1000), 0)::bigint AS idade_media_ms
         FROM engine_jobs_cliente
        WHERE ${condicaoVivoSql}`,
      [STATUS_VIVOS_FLUXO, STATUS_EM_CURSO_PROTEGIDOS_FLUXO, leaseMinutos]
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
              MIN(criado_em) AS mais_antigo_em,
              MAX(criado_em) AS mais_novo_em,
              COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - criado_em)) * 1000), 0)::bigint AS idade_media_ms
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
          AND COALESCE(atualizado_em, criado_em) >= NOW() - ($2::int * INTERVAL '1 minute')`,
      [STATUS_EM_CURSO_PROTEGIDOS_FLUXO, leaseMinutos]
    ),
    queryEngine(
      `SELECT status,
              COUNT(*)::int AS total,
              COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - criado_em)) * 1000), 0)::bigint AS idade_maxima_ms,
               COUNT(*) FILTER (
                 WHERE COALESCE(atualizado_em, criado_em) <= NOW() - ($2::int * INTERVAL '1 minute')
               )::int AS suspeitos_lock
          FROM engine_jobs_cliente
         WHERE status = ANY($1::text[])
         GROUP BY status`,
      [STATUS_EM_CURSO_PROTEGIDOS_FLUXO, leaseMinutos]
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
              COALESCE(AVG(EXTRACT(EPOCH FROM (p.primeira_tentativa_em - j.criado_em)) * 1000), 0)::bigint AS media_ms,
              COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (p.primeira_tentativa_em - j.criado_em)) * 1000
              ), 0)::bigint AS mediana_ms,
              COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (p.primeira_tentativa_em - j.criado_em)) * 1000
              ), 0)::bigint AS p95_ms
         FROM primeira p
         JOIN engine_jobs_cliente j ON j.id = p.job_id
        WHERE p.primeira_tentativa_em >= j.criado_em`,
      [janela]
    ),
    queryEngine(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(o.criada_em, j.atualizado_em) - e.capturado_em)) * 1000), 0)::bigint AS media_ms
         FROM engine_jobs_cliente j
         JOIN engine_eventos_brutos e ON e.id = j.evento_id
         LEFT JOIN engine_ofertas o ON o.id = j.oferta_id
        WHERE j.oferta_id IS NOT NULL
          AND j.criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
          AND e.capturado_em IS NOT NULL
          AND COALESCE(o.criada_em, j.atualizado_em) >= e.capturado_em
          AND (
            LOWER(COALESCE(e.origem, '')) LIKE '%radar%'
            OR LOWER(COALESCE(e.fonte, '')) LIKE '%radar%'
            OR LOWER(COALESCE(e.origem_tipo, '')) IN ('whatsapp', 'telegram')
            OR e.metadata ? 'radarMirror'
            OR e.metadata ? 'espelhoComercial'
            OR j.metadata ? 'radarMirror'
            OR j.metadata ? 'espelhoComercial'
            OR (j.metadata->'metadataEvento') ? 'radarMirror'
            OR (j.metadata->'metadataEvento') ? 'espelhoComercial'
            OR LOWER(COALESCE(j.metadata->>'origem', '')) LIKE '%radar%'
            OR LOWER(COALESCE(j.metadata->>'fonte', '')) LIKE '%radar%'
            OR LOWER(COALESCE(o.origem, '')) LIKE '%radar%'
            OR o.metadata ? 'radarMirror'
            OR o.metadata ? 'espelhoComercial'
            OR LOWER(COALESCE(o.metadata->>'fonteComercial', '')) LIKE '%radar%'
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
    ),
    queryEngine(
      `WITH reset AS (
         SELECT MAX(cutoff_congelado) AS cutoff_congelado
           FROM engine_reset_operacional_operacoes
          WHERE status = 'execute_concluido'
       ),
       primeira AS (
         SELECT job_id, MIN(criado_em) AS primeira_tentativa_em
           FROM engine_processamentos
          WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
          GROUP BY job_id
       )
       SELECT COUNT(*) FILTER (WHERE j.criado_em < r.cutoff_congelado)::int AS total_antes_reset,
              COUNT(*) FILTER (WHERE j.criado_em >= r.cutoff_congelado)::int AS total_depois_reset,
              MAX(r.cutoff_congelado) AS cutoff_reset_referencia
         FROM primeira p
         JOIN engine_jobs_cliente j ON j.id = p.job_id
         CROSS JOIN reset r
        WHERE p.primeira_tentativa_em >= j.criado_em
          AND r.cutoff_congelado IS NOT NULL`,
      [janela]
    )
  ]);

  const consultas = [vivos, circulaveis, emCursoProtegidos, saudeEmCurso, chegada, consumo, expiracao, primeiraTentativa, radarOferta, amostra];
  const falha = consultas.find(item => !item.ok);

  return {
    ok: !falha,
    janelaMinutos: janela,
    limiteAmostra: limite,
    leaseJobsAtivosMinutos: leaseMinutos,
    vivos: linhaUnica(vivos, { total: 0 }),
    circulaveis: linhaUnica(circulaveis, { total: 0 }),
    emCursoProtegidos: linhaUnica(emCursoProtegidos, { total: 0 }),
    saudeEmCurso: saudeEmCurso.ok ? saudeEmCurso.resultado?.rows || [] : [],
    chegada: linhaUnica(chegada, { total: 0 }),
    consumo: linhaUnica(consumo, { total: 0 }),
    expiracao: linhaUnica(expiracao, { total: 0 }),
    primeiraTentativa: {
      ...linhaUnica(primeiraTentativa, { total: 0, media_ms: 0, mediana_ms: 0, p95_ms: 0 }),
      ...(
        primeiraTentativaReset.ok
          ? linhaUnica(primeiraTentativaReset, {})
          : {
              total_antes_reset: null,
              total_depois_reset: null,
              cutoff_reset_referencia: null,
              reset_disponivel: false,
              motivo_reset_indisponivel: "tabela_reset_indisponivel"
            }
      )
    },
    radarOferta: linhaUnica(radarOferta, { total: 0, media_ms: 0 }),
    amostraCirculavel: amostra.ok ? amostra.resultado?.rows || [] : [],
    erro: falha?.erro || "",
    motivo: falha?.motivo || ""
  };
}

module.exports = {
  STATUS_VIVOS_FLUXO,
  STATUS_CIRCULAVEIS_FLUXO,
  STATUS_EM_CURSO_PROTEGIDOS_FLUXO,
  consultarFluxoVivoOfc
};
