"use strict";

// Ablacao exploratoria LOCAL. Escritas apenas em tabelas TEMP de um PostgreSQL descartavel.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const { sqlFrescorComercialPreImporter } = require("../modules/engine/frescor-pre-importer.service");

const connection = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const SAMPLE = 10000;
const TRIALS = 3;
const scenarios = [
  { tag: "base", expiry: false, index: false, head: false },
  { tag: "expiry_only", expiry: true, index: false, head: false },
  { tag: "expiry_index", expiry: true, index: true, head: false },
  { tag: "head_only", expiry: false, index: false, head: true },
  { tag: "existing_fairness", expiry: true, index: true, head: false, fairness: true },
  { tag: "final", expiry: true, index: true, head: true }
];

async function measure(client, sql) {
  const start = performance.now();
  await client.query(sql);
  return Math.round((performance.now() - start) * 1000) / 1000;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

async function runScenario(client, scenario) {
  const table = `uf_ablate_${scenario.tag}`;
  const head = `uf_ablate_${scenario.tag}_heads`;
  const frescor = sqlFrescorComercialPreImporter("j", "e");
  const expiry = `CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END`;
  await client.query(`CREATE TEMP TABLE ${table} (LIKE public.engine_jobs_cliente INCLUDING ALL)`);
  if (scenario.expiry) await client.query(`ALTER TABLE ${table} ADD COLUMN expira_comercial_em timestamptz`);
  if (scenario.index) await client.query(`CREATE INDEX ${table}_ws_expiry_idx ON ${table}
    (cliente_id,expira_comercial_em,id)
    WHERE status IN ('pendente','diagnosticado','pronto_para_importar','pronto_sem_utilidade')
      AND expira_comercial_em IS NOT NULL`);
  if (scenario.head) {
    await client.query(`CREATE TEMP TABLE ${head} (
      cliente_id text PRIMARY KEY, proximo_expira_em timestamptz,
      pronto boolean NOT NULL, ultimo_atendimento_em timestamptz)`);
    await client.query(`CREATE INDEX ${head}_ready_idx ON ${head}
      (ultimo_atendimento_em ASC NULLS FIRST,cliente_id) WHERE pronto`);
    await client.query(`CREATE INDEX ${head}_due_idx ON ${head}
      (proximo_expira_em,cliente_id) WHERE NOT pronto AND proximo_expira_em IS NOT NULL`);
  } else if (scenario.fairness) {
    await client.query(`CREATE TEMP TABLE ${head}
      (LIKE public.engine_fairness_origem_fluxo INCLUDING ALL)`);
    await client.query(`ALTER TABLE ${head} ADD COLUMN proximo_expira_em timestamptz`);
    await client.query(`CREATE INDEX ${head}_ready_idx ON ${head}
      (etapa,lane,ultimo_atendimento_em ASC NULLS FIRST,cliente_id)
      WHERE proximo_expira_em IS NOT NULL`);
  }

  const source = `FROM public.engine_jobs_cliente j
    JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
    WHERE e.metadata->>'fixtureKind'='legacy_expired'
    ORDER BY j.id LIMIT ${SAMPLE}`;
  const insertMs = await measure(client, scenario.expiry
    ? `INSERT INTO ${table} SELECT j.*, ${expiry} ${source}`
    : `INSERT INTO ${table} SELECT j.* ${source}`);
  const count = (await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
  assert.equal(count, SAMPLE);

  const headSource = scenario.expiry
    ? `SELECT cliente_id,MIN(expira_comercial_em) AS proximo FROM ${table} GROUP BY cliente_id`
    : `SELECT j.cliente_id,MIN(${expiry}) AS proximo FROM ${table} j
       LEFT JOIN public.engine_eventos_brutos e ON e.id=j.evento_id GROUP BY j.cliente_id`;
  const headSeedMs = scenario.head ? await measure(client, `INSERT INTO ${head}
    (cliente_id,proximo_expira_em,pronto)
    SELECT cliente_id,proximo,COALESCE(proximo<=NOW(),FALSE) FROM (${headSource}) q`)
    : scenario.fairness ? await measure(client, `INSERT INTO ${head}
      (cliente_id,etapa,lane,proximo_expira_em)
      SELECT cliente_id,'diagnostico_final','agua_nova',proximo FROM (${headSource}) q`) : 0;

  const updateMs = await measure(client, scenario.expiry
    ? `WITH novo AS (
         SELECT id,evento_id,criado_em,
                COALESCE(metadata,'{}'::jsonb)||'{"cupomTurbo":true}'::jsonb AS metadata
         FROM ${table}
       ), projecao AS (
         SELECT j.id,j.metadata,${expiry} AS expira_em
         FROM novo j LEFT JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
       ) UPDATE ${table} target
         SET metadata=p.metadata,expira_comercial_em=p.expira_em
         FROM projecao p WHERE target.id=p.id`
    : `UPDATE ${table} SET metadata=COALESCE(metadata,'{}'::jsonb)||'{"cupomTurbo":true}'::jsonb`);
  const headRefreshMs = scenario.head || scenario.fairness ? await measure(client, `UPDATE ${head} h
    SET proximo_expira_em=q.proximo${scenario.head ? ",pronto=COALESCE(q.proximo<=NOW(),FALSE)" : ""}
    FROM (${headSource}) q WHERE h.cliente_id=q.cliente_id`) : 0;
  const fairnessCursorMs = scenario.head || scenario.fairness ? await measure(client,
    `UPDATE ${head} SET ultimo_atendimento_em=NOW()`) : 0;
  const headCount = scenario.head || scenario.fairness
    ? (await client.query(`SELECT COUNT(*)::int AS n FROM ${head}`)).rows[0].n : 0;
  const projectionMismatches = scenario.expiry
    ? (await client.query(`SELECT COUNT(*)::int AS n FROM ${table} j
         LEFT JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
         WHERE j.expira_comercial_em IS DISTINCT FROM ${expiry}`)).rows[0].n : null;
  if (scenario.expiry) assert.equal(projectionMismatches, 0);
  const sizes = (await client.query(`SELECT
    (SELECT COALESCE(SUM(pg_relation_size(indexrelid)),0)::bigint FROM pg_index
      WHERE indrelid='${table}'::regclass) AS job_indexes,
    ${scenario.head || scenario.fairness ? `pg_total_relation_size('${head}'::regclass)` : "0"}::bigint AS heads_total,
    ${scenario.head || scenario.fairness ? `pg_relation_size('${head}_ready_idx'::regclass)` : "0"}::bigint AS state_ready_index,
    ${scenario.index ? `pg_relation_size('${table}_ws_expiry_idx'::regclass)` : "0"}::bigint AS expiry_index`)).rows[0];
  if (scenario.head || scenario.fairness) await client.query(`DROP TABLE ${head}`);
  await client.query(`DROP TABLE ${table}`);
  return { insertMs, headSeedMs, updateMs, headRefreshMs, fairnessCursorMs,
    insertTotalMs: insertMs + headSeedMs,
    updateTotalMs: updateMs + headRefreshMs + fairnessCursorMs,
    headCount, projectionMismatches, sizes };
}

(async () => {
  const client = new Client(connection);
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, connection.database);
    assert.equal(identity.host, connection.host);
    assert.equal(identity.port, connection.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());

    const trials = {};
    for (let trial = 0; trial < TRIALS; trial += 1) {
      for (const scenario of scenarios) {
        (trials[scenario.tag] ||= []).push(await runScenario(client, scenario));
      }
    }
    const result = Object.fromEntries(scenarios.map(({ tag }) => [tag, {
      insertMs: median(trials[tag].map(row => row.insertMs)),
      headSeedMs: median(trials[tag].map(row => row.headSeedMs)),
      updateMs: median(trials[tag].map(row => row.updateMs)),
      headRefreshMs: median(trials[tag].map(row => row.headRefreshMs)),
      fairnessCursorMs: median(trials[tag].map(row => row.fairnessCursorMs)),
      insertTotalMs: median(trials[tag].map(row => row.insertTotalMs)),
      updateTotalMs: median(trials[tag].map(row => row.updateTotalMs)),
      headCount: trials[tag][0].headCount,
      projectionMismatches: trials[tag][0].projectionMismatches,
      sizes: trials[tag][0].sizes
    }]));
    console.log("UNIVERSAL_WRITE_ABLATION " + JSON.stringify({ sampleJobs: SAMPLE,
      trialsPerScenario: TRIALS, result,
      caveat: "TEMP tables, no production WAL; head refresh is full GROUP BY batch, not operational per-job maintenance; medians reflect local ordering/cache" }));
  } finally {
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_WRITE_ABLATION_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
