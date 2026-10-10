-- Run only against the isolated optimus_universal_fixture database.
-- No production data, identities or credentials are used.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'legacy_expired', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - INTERVAL '2 days' - (g % 1000) * INTERVAL '1 minute',
       NOW() - INTERVAL '2 days' - (g % 1000) * INTERVAL '1 minute'
  FROM generate_series(1, 100000) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT 'radar', 'synthetic',
       jsonb_build_object('fixtureKind', 'historical_terminal', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', 'optimus'),
       NOW() - INTERVAL '9 days' - (g % 1000) * INTERVAL '1 minute',
       NOW() - INTERVAL '9 days' - (g % 1000) * INTERVAL '1 minute'
  FROM generate_series(1, 100000) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'day_500', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 500),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 500)
  FROM generate_series(1, 500) AS g;

INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em, criado_em)
SELECT CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'radar' ELSE 'clonador_grupos' END,
       'synthetic',
       jsonb_build_object('fixtureKind', 'day_700', 'fixtureSeq', g,
         'workspace', 'user_sim_' || lpad((g % 80)::text, 2, '0'),
         'origemFluxo', CASE WHEN ((g - 1) / 80) % 2 = 0 THEN 'optimus' ELSE 'clonador_grupos' END),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 700),
       NOW() - (g - 1) * (INTERVAL '24 hours' / 700)
  FROM generate_series(1, 700) AS g;

INSERT INTO engine_jobs_cliente
  (evento_id, cliente_id, marketplace_detectado, marketplace, status,
   metadata, criado_em, atualizado_em)
SELECT e.id, e.metadata->>'workspace', 'mercadolivre', 'mercadolivre',
       CASE WHEN e.metadata->>'fixtureKind' = 'historical_terminal'
            THEN 'expirada_operacional' ELSE 'pendente' END,
       jsonb_build_object('origemFluxo', e.metadata->>'origemFluxo',
                          'fixtureKind', e.metadata->>'fixtureKind'),
       e.criado_em + INTERVAL '1 second',
       CASE WHEN e.metadata->>'fixtureKind' = 'historical_terminal'
            THEN NOW() - INTERVAL '3 days'
            ELSE e.criado_em + INTERVAL '1 second' END
  FROM engine_eventos_brutos e
 WHERE e.origem_tipo = 'synthetic';

COMMIT;
ANALYZE engine_eventos_brutos;
ANALYZE engine_jobs_cliente;

SELECT e.metadata->>'fixtureKind' AS fixture_kind, j.status,
       COUNT(*) AS jobs, COUNT(DISTINCT j.cliente_id) AS workspaces
  FROM engine_jobs_cliente j
  JOIN engine_eventos_brutos e ON e.id = j.evento_id
 GROUP BY 1, 2 ORDER BY 1, 2;
