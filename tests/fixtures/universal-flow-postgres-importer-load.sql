-- Additional importer pressure for the same isolated fixture database.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'importer_legacy_expired', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - INTERVAL '2 days' - (g % 500) * INTERVAL '1 minute',
       NOW() - INTERVAL '2 days' - (g % 500) * INTERVAL '1 minute'
  FROM generate_series(1, 20000) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'importer_day_700', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 700),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 700)
  FROM generate_series(1, 700) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'importer_day_500', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 500),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 500)
  FROM generate_series(1, 500) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT 'clonador_grupos', 'synthetic',
       jsonb_build_object('fixtureKind', 'importer_retry_due', 'fixtureSeq', g,
                          'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
                          'origemFluxo', 'clonador_grupos'),
       NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '15 minutes'
  FROM generate_series(1, 35) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT 'clonador_grupos', 'synthetic',
       jsonb_build_object('fixtureKind', 'importer_retry_future', 'fixtureSeq', g,
                          'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
                          'origemFluxo', 'clonador_grupos'),
       NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '15 minutes'
  FROM generate_series(1, 35) AS g;

INSERT INTO engine_jobs_cliente
  (evento_id, cliente_id, marketplace_detectado, marketplace, status,
   motivo_final, metadata, criado_em, atualizado_em)
SELECT e.id, e.metadata->>'workspace', 'mercadolivre', 'mercadolivre',
       'pronto_para_importar',
       CASE WHEN e.metadata->>'fixtureKind' LIKE 'importer_retry_%'
            THEN 'aguardando_enriquecimento_local' ELSE 'validacao_ok' END,
       jsonb_build_object('origemFluxo', e.metadata->>'origemFluxo',
         'fixtureKind', e.metadata->>'fixtureKind') ||
       CASE WHEN e.metadata->>'fixtureKind' = 'importer_retry_due'
            THEN jsonb_build_object('localWorkerImageRetry', jsonb_build_object(
              'proximaTentativaEmMs', ((EXTRACT(EPOCH FROM NOW() - INTERVAL '1 minute') * 1000)::bigint)::text))
            WHEN e.metadata->>'fixtureKind' = 'importer_retry_future'
            THEN jsonb_build_object('localWorkerImageRetry', jsonb_build_object(
              'proximaTentativaEmMs', ((EXTRACT(EPOCH FROM NOW() + INTERVAL '1 hour') * 1000)::bigint)::text))
            ELSE '{}'::jsonb END,
       e.criado_em + INTERVAL '1 second', e.criado_em + INTERVAL '1 second'
  FROM engine_eventos_brutos e
 WHERE e.metadata->>'fixtureKind' IN
       ('importer_legacy_expired', 'importer_day_700', 'importer_day_500',
        'importer_retry_due', 'importer_retry_future');

COMMIT;
ANALYZE engine_eventos_brutos;
ANALYZE engine_jobs_cliente;

SELECT e.metadata->>'fixtureKind' AS fixture_kind, j.status,
       COUNT(*) AS jobs
  FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
 WHERE e.metadata->>'fixtureKind' LIKE 'importer_%'
 GROUP BY 1,2 ORDER BY 1,2;
