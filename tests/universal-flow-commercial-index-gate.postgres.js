"use strict";

// Gate isolado: apenas tabelas TEMP no PostgreSQL descartavel local.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const { sqlBuscarJobsPendentes } = require("../modules/engine/processor.service");
const { sqlBuscarJobsDiagnosticados } = require("../modules/engine/validator.service");
const { buscarReposicaoGrupoPreImporter } = require("../modules/engine/fairness-slot-pre-importer.service");

const order = `priority DESC,
  CASE WHEN lane='fresca_em_risco' THEN captured_at END ASC NULLS FIRST,
  CASE WHEN lane<>'fresca_em_risco' THEN captured_at END DESC NULLS LAST,
  CASE WHEN stage='processor' AND lane='fresca_em_risco' THEN created_at END
    ASC NULLS FIRST,
  CASE WHEN stage='processor' AND lane<>'fresca_em_risco' THEN created_at END
    DESC NULLS LAST,
  CASE WHEN stage<>'processor' AND lane='fresca_em_risco' THEN updated_at END
    ASC NULLS FIRST,
  CASE WHEN stage<>'processor' AND lane<>'fresca_em_risco' THEN updated_at END
    DESC NULLS LAST,
  id ASC`;

function summarizePlan(plan) {
  const scans = [];
  const walk = node => {
    if (/Scan$/.test(node["Node Type"])) scans.push({
      node: node["Node Type"], index: node["Index Name"] || null,
      rows: node["Actual Rows"], loops: node["Actual Loops"],
      filtered: node["Rows Removed by Filter"] || 0,
      indexRecheck: node["Rows Removed by Index Recheck"] || 0
    });
    for (const child of node.Plans || []) walk(child);
  };
  walk(plan.Plan);
  return { executionMs: plan["Execution Time"], root: plan.Plan["Node Type"],
    scans, tempRead: plan.Plan["Temp Read Blocks"] || 0,
    tempWritten: plan.Plan["Temp Written Blocks"] || 0 };
}

async function run() {
  const client = new Client({ host: "127.0.0.1", port: 55433, user: "postgres",
    database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, "optimus_universal_fixture");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, 55433);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());

    for (const table of ["engine_eventos_brutos", "engine_jobs_cliente", "engine_fairness_origem_fluxo"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await client.query(`INSERT INTO engine_eventos_brutos
      (id,origem,origem_tipo,metadata,capturado_em)
      VALUES (1,'synthetic','synthetic','{}',now()-interval '10 seconds'),
             (2,'synthetic','synthetic','{}',now()-interval '10 seconds')`);
    await client.query(`INSERT INTO engine_jobs_cliente
      (id,evento_id,cliente_id,status,metadata,prioridade,criado_em,atualizado_em)
      VALUES (1,1,'tie_ws','pendente','{}',0,now()-interval '30 seconds',now()-interval '30 seconds'),
             (2,2,'tie_ws','pendente','{}',0,now()-interval '20 seconds',now()-interval '20 seconds')`);
    const params = [1,0,0,0,1];
    const processorBaseline = (await client.query(sqlBuscarJobsPendentes(),params)).rows
      .filter(row => row.tipo_saida_pre_importer === "baseline").map(row => Number(row.id));
    const processorFallback = (await buscarReposicaoGrupoPreImporter(client,
      { clienteId: "tie_ws", lane: "agua_nova" },"pendente",[])).map(row => Number(row.id));
    await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado'");
    const validatorBaseline = (await client.query(sqlBuscarJobsDiagnosticados(),params)).rows
      .filter(row => row.tipo_saida_pre_importer === "baseline").map(row => Number(row.id));
    const validatorFallback = (await buscarReposicaoGrupoPreImporter(client,
      { clienteId: "tie_ws", lane: "agua_nova" },"diagnosticado",[])).map(row => Number(row.id));
    const actualTie = { processorBaseline, processorFallback,
      validatorBaseline, validatorFallback };
    assert.deepEqual(processorBaseline,[2]);
    assert.deepEqual(validatorBaseline,[2]);
    assert.equal(processorFallback[0],1);
    assert.equal(validatorFallback[0],1);

    await client.query(`CREATE TEMP TABLE uf_differential AS
      SELECT c AS case_id, s.stage, n AS slot,
        (c*1000 + n + CASE s.stage WHEN 'processor' THEN 0
          WHEN 'validator' THEN 10000000 ELSE 20000000 END)::bigint AS id,
        'ws_'||(n%3) AS workspace,
        CASE WHEN n%2=0 THEN 'optimus' ELSE 'clonador_grupos' END AS origin,
        CASE WHEN n%5=0 THEN 'fresca_em_risco'
             WHEN n%7=0 THEN 'fresca_circulavel' ELSE 'agua_nova' END AS lane,
        ((c*13+n*7)%11)::int AS priority,
        now()-((c*3+n*11)%180)*interval '1 second' AS captured_at,
        now()-((c*5+n*17)%180)*interval '1 second' AS created_at,
        now()-((c*7+n*19)%180)*interval '1 second' AS updated_at,
        CASE WHEN n%13=0 THEN NULL::timestamptz
             ELSE now()+((n%9)-3)*interval '1 minute' END AS expires_at,
        n%13=0 AS manual,
        n%17<>0 AS retry_due,
        n%11<>0 AS active
      FROM generate_series(1,1200) c
      CROSS JOIN (VALUES ('processor'),('validator'),('importer')) s(stage)
      CROSS JOIN generate_series(1,24) n`);
    await client.query("ANALYZE uf_differential");
    const differential = (await client.query(`WITH eligible AS (
        SELECT * FROM uf_differential
        WHERE active AND (manual OR expires_at>now())
          AND (stage<>'importer' OR retry_due)
      ), ranked AS (
        SELECT *, row_number() OVER
          (PARTITION BY case_id,stage,workspace,lane ORDER BY ${order}) AS canonical_rank,
          row_number() OVER
          (PARTITION BY case_id,stage,workspace,lane
           ORDER BY expires_at DESC NULLS LAST,id ASC) AS expiry_rank
        FROM eligible
      ), limits(n) AS (VALUES (1),(2),(4),(18),(35),(70)),
      canonical AS (
        SELECT case_id,stage,workspace,lane,limits.n,
          array_agg(id ORDER BY canonical_rank) FILTER
            (WHERE canonical_rank<=limits.n) AS ids
        FROM ranked CROSS JOIN limits
        GROUP BY case_id,stage,workspace,lane,limits.n
      ), prefix AS (
        SELECT case_id,stage,workspace,lane,n,
          array_agg(id ORDER BY candidate_rank) AS ids
        FROM (
          SELECT ranked.*,limits.n,
            row_number() OVER
              (PARTITION BY case_id,stage,workspace,lane,limits.n
               ORDER BY ${order}) AS candidate_rank
          FROM ranked CROSS JOIN limits
          WHERE expiry_rank<=limits.n
        ) picked
        GROUP BY case_id,stage,workspace,lane,n
      )
      SELECT count(*)::int AS compared,
        count(*) FILTER (WHERE canonical.ids IS DISTINCT FROM prefix.ids)::int
          AS expiry_prefix_mismatches
      FROM canonical JOIN prefix USING (case_id,stage,workspace,lane,n)`)).rows[0];
    assert(differential.compared > 10000);

    await client.query(`CREATE TEMP TABLE uf_index_probe (
      id bigint PRIMARY KEY, workspace text NOT NULL, status text NOT NULL,
      priority integer NOT NULL, captured_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL)`);
    await client.query(`INSERT INTO uf_index_probe
      SELECT g,'hot','active',CASE WHEN g=99997 THEN 100 WHEN g>=99996 THEN 0 ELSE 101 END,
        now()-CASE WHEN g=99997 THEN interval '4 minutes' ELSE interval '1 minute' END,
        now()-g*interval '1 millisecond',
        CASE WHEN g>=99996 THEN now()+CASE WHEN g=99997 THEN interval '20 minutes'
          ELSE interval '30 minutes' END ELSE now()-interval '1 day' END
      FROM generate_series(1,100000) g`);
    await client.query(`CREATE INDEX uf_probe_commercial_idx ON uf_index_probe
      (workspace,priority DESC,captured_at DESC,created_at DESC,id ASC)
      WHERE status='active'`);
    await client.query(`CREATE INDEX uf_probe_expiry_idx ON uf_index_probe
      (workspace,expires_at DESC,id ASC) WHERE status='active'`);
    await client.query("VACUUM (ANALYZE) uf_index_probe");

    const commercialSql = `SELECT id FROM uf_index_probe WHERE workspace='hot'
      AND status='active' AND expires_at>now()
      ORDER BY priority DESC,captured_at DESC,created_at DESC,id ASC LIMIT $1`;
    const prefixSql = `SELECT id FROM (SELECT * FROM uf_index_probe
      WHERE workspace='hot' AND status='active' AND expires_at>now()
      ORDER BY expires_at DESC,id ASC LIMIT $1) p
      ORDER BY priority DESC,captured_at DESC,created_at DESC,id ASC`;
    const sparse = [];
    for (const limit of [1,2,4]) {
      const canonical = (await client.query(commercialSql,[limit])).rows.map(r => Number(r.id));
      const prefix = (await client.query(prefixSql,[limit])).rows.map(r => Number(r.id));
      const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${commercialSql}`,
        [limit])).rows[0]["QUERY PLAN"][0];
      sparse.push({ limit, canonical, expiryPrefix: prefix, plan: summarizePlan(plan) });
    }
    assert.equal(sparse[0].canonical[0], 99997);
    assert.notEqual(sparse[0].expiryPrefix[0], 99997);

    await client.query(`UPDATE uf_index_probe SET expires_at=now()+interval '30 minutes',
      priority=CASE WHEN id<=50000 THEN 1000 ELSE 0 END`);
    await client.query(`UPDATE uf_index_probe SET expires_at=now()-interval '1 day'
      WHERE id<=50000`);
    await client.query("VACUUM (ANALYZE) uf_index_probe");
    const middle = [];
    for (const limit of [1,2,4]) {
      const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${commercialSql}`,
        [limit])).rows[0]["QUERY PLAN"][0];
      middle.push({ limit, plan: summarizePlan(plan) });
    }

    await client.query("UPDATE uf_index_probe SET expires_at=now()+interval '30 minutes'");
    await client.query("UPDATE uf_index_probe SET priority=(id%101)::int");
    await client.query("VACUUM (ANALYZE) uf_index_probe");
    const dense = [];
    for (const limit of [1,2,4]) {
      const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${commercialSql}`,
        [limit])).rows[0]["QUERY PLAN"][0];
      dense.push({ limit, plan: summarizePlan(plan) });
    }
    const storage = (await client.query(`SELECT
      pg_relation_size('uf_probe_commercial_idx'::regclass)::bigint AS commercial_bytes,
      pg_relation_size('uf_probe_expiry_idx'::regclass)::bigint AS expiry_bytes`)).rows[0];
    console.log("UNIVERSAL_COMMERCIAL_INDEX_GATE " + JSON.stringify({
      actualTie, differential, sparse, middle, dense, storage,
      scope: "single-group necessary condition; not the full three-stage selector or writer integration"
    }));
  } finally {
    await client.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
