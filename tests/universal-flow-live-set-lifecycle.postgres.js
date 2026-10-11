"use strict";

// Prova de arquitetura em tabelas TEMP no PostgreSQL local descartavel.
// Nao integra migration, writer, terminalizer ou selector no produto.
const assert = require("node:assert/strict");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Client } = require("pg");

const commercialOrder = `priority DESC,
  CASE WHEN lane='fresca_em_risco' THEN captured_at END ASC NULLS FIRST,
  CASE WHEN lane<>'fresca_em_risco' THEN captured_at END DESC NULLS LAST,
  CASE WHEN stage='processor' AND lane='fresca_em_risco' THEN created_at END ASC NULLS FIRST,
  CASE WHEN stage='processor' AND lane<>'fresca_em_risco' THEN created_at END DESC NULLS LAST,
  CASE WHEN stage<>'processor' AND lane='fresca_em_risco' THEN updated_at END ASC NULLS FIRST,
  CASE WHEN stage<>'processor' AND lane<>'fresca_em_risco' THEN updated_at END DESC NULLS LAST,
  id ASC`;

function planSummary(plan) {
  const scans = [];
  const visit = node => {
    if (/Scan$/.test(node["Node Type"])) scans.push({ type: node["Node Type"],
      index: node["Index Name"] || null, rows: node["Actual Rows"],
      loops: node["Actual Loops"], filtered: node["Rows Removed by Filter"] || 0,
      sharedHit: node["Shared Hit Blocks"] || 0, localHit: node["Local Hit Blocks"] || 0 });
    for (const child of node.Plans || []) visit(child);
  };
  visit(plan.Plan);
  return { ms: plan["Execution Time"], scans, tempRead: plan.Plan["Temp Read Blocks"] || 0,
    tempWritten: plan.Plan["Temp Written Blocks"] || 0 };
}

async function explain(client, sql, params) {
  const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params))
    .rows[0]["QUERY PLAN"][0];
  return planSummary(plan);
}

async function differential(client, at) {
  const result = await client.query(`WITH source AS (
      SELECT *, CASE
        WHEN manual THEN 'fresca_circulavel'
        WHEN expires_at <= $1::timestamptz + interval '10 minutes' THEN 'fresca_em_risco'
        WHEN captured_at >= $1::timestamptz - interval '5 minutes' THEN 'agua_nova'
        ELSE 'fresca_circulavel' END AS lane
      FROM uf_lifecycle_cases
    ), canonical AS (
      SELECT *, row_number() OVER
        (PARTITION BY case_id,stage,workspace,lane ORDER BY ${commercialOrder}) AS rn
      FROM source WHERE (manual OR expires_at>$1::timestamptz)
        AND (stage<>'importer' OR retry_due)
    ), live_set AS (
      SELECT *, row_number() OVER
        (PARTITION BY case_id,stage,workspace,lane ORDER BY ${commercialOrder}) AS rn
      FROM source WHERE lifecycle_status='live'
        AND (stage<>'importer' OR retry_due)
    ), limits(n) AS (VALUES (1),(2),(4),(18),(35),(70)),
    a AS (
      SELECT case_id,stage,workspace,lane,n,
        array_agg(id||':'||workspace||':'||origin ORDER BY rn)
          FILTER (WHERE rn<=n) AS ids
      FROM canonical CROSS JOIN limits
      GROUP BY case_id,stage,workspace,lane,n
    ), b AS (
      SELECT case_id,stage,workspace,lane,n,
        array_agg(id||':'||workspace||':'||origin ORDER BY rn)
          FILTER (WHERE rn<=n) AS ids
      FROM live_set CROSS JOIN limits
      GROUP BY case_id,stage,workspace,lane,n
    )
    SELECT count(*)::int AS compared,
      count(*) FILTER (WHERE a.ids IS DISTINCT FROM b.ids)::int AS mismatches
    FROM a FULL JOIN b USING (case_id,stage,workspace,lane,n)`, [at]);
  return result.rows[0];
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

    await client.query(`CREATE TEMP TABLE uf_lifecycle_cases AS
      WITH clock AS (SELECT now() AS t0), generated AS (
        SELECT c AS case_id,s.stage,n AS slot,
          (c*1000+n+CASE s.stage WHEN 'processor' THEN 0
            WHEN 'validator' THEN 10000000 ELSE 20000000 END)::bigint AS id,
          'ws_'||(n%3) AS workspace,
          CASE WHEN n%2=0 THEN 'optimus' ELSE 'clonador_grupos' END AS origin,
          ((c*13+n*7)%11)::int AS priority,
          t0-((c*3+n*5)%35)*interval '1 minute' AS captured_at,
          t0-((c*5+n*7)%180)*interval '1 second' AS created_at,
          t0-((c*7+n*11)%180)*interval '1 second' AS updated_at,
          n%13=0 AS manual,n%7=0 AS turbo,n%17<>0 AS retry_due,t0
        FROM clock CROSS JOIN generate_series(1,1200) c
        CROSS JOIN (VALUES ('processor'),('validator'),('importer')) s(stage)
        CROSS JOIN generate_series(1,24) n
      ), projected AS (
        SELECT *,CASE WHEN manual THEN NULL::timestamptz
          ELSE captured_at + CASE WHEN turbo THEN interval '10 minutes'
            ELSE interval '30 minutes' END END AS expires_at
        FROM generated
      )
      SELECT *, CASE WHEN manual OR expires_at>t0 THEN 'live'
        ELSE 'expired' END AS lifecycle_status FROM projected`);
    await client.query("ANALYZE uf_lifecycle_cases");
    const clocks = (await client.query(`SELECT
      to_char(min(t0),'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS t0,
      to_char(min(t0)+interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS.USOF') AS t1
      FROM uf_lifecycle_cases`)).rows[0];
    const {t0,t1} = clocks;
    const initial = await differential(client,t0);
    assert.equal(initial.mismatches,0);
    const stale = await differential(client,t1);
    const dueLive = (await client.query(`SELECT count(*)::int AS n FROM uf_lifecycle_cases
      WHERE lifecycle_status='live' AND NOT manual AND expires_at<=$1`,[t1])).rows[0].n;
    assert(dueLive>0);
    assert(stale.mismatches>0);
    await client.query(`UPDATE uf_lifecycle_cases SET lifecycle_status='expired'
      WHERE lifecycle_status='live' AND NOT manual AND expires_at<=$1`,[t1]);
    const reconciled = await differential(client,t1);
    assert.equal(reconciled.mismatches,0);

    await client.query(`CREATE TEMP TABLE uf_live_jobs (
      id bigint PRIMARY KEY,workspace text NOT NULL,status text NOT NULL,
      priority integer NOT NULL,captured_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL,expires_at timestamptz,
      retry_ready_at timestamptz,terminal_due_at timestamptz)`);
    await client.query(`INSERT INTO uf_live_jobs
      SELECT g,'hot','pendente',CASE WHEN g=99997 THEN 100 ELSE 0 END,
        now()-interval '2 days',now()-interval '2 days',now()-interval '1 day'
      FROM generate_series(1,100000) g`);
    await client.query(`CREATE INDEX uf_lifecycle_due_idx ON uf_live_jobs
      (expires_at ASC,id ASC) WHERE status='pendente' AND expires_at IS NOT NULL`);
    await client.query(`CREATE INDEX uf_lifecycle_commercial_idx ON uf_live_jobs
      (workspace,priority DESC,captured_at DESC,created_at DESC,id ASC)
      WHERE status='pendente'`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const dueSql = `SELECT id FROM uf_live_jobs WHERE status='pendente'
      AND expires_at<=now() ORDER BY expires_at ASC,id ASC LIMIT $1
      FOR UPDATE SKIP LOCKED`;
    const terminalizer = [];
    for (const limit of [1,10,50,100]) {
      terminalizer.push({limit, plan: await explain(client,dueSql,[limit])});
    }
    await client.query(`UPDATE uf_live_jobs SET retry_ready_at=now()+interval '1 day'
      WHERE id<=99996`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const retrySql = `SELECT id FROM uf_live_jobs WHERE status='pendente'
      AND expires_at<=now()
      AND (retry_ready_at IS NULL OR retry_ready_at<=now())
      ORDER BY expires_at ASC,id ASC LIMIT 4`;
    const retryExpiryOnly = await explain(client,retrySql,[]);
    await client.query(`UPDATE uf_live_jobs SET terminal_due_at=
      GREATEST(expires_at,COALESCE(retry_ready_at,expires_at))`);
    await client.query(`CREATE INDEX uf_lifecycle_terminal_due_idx ON uf_live_jobs
      (terminal_due_at ASC,id ASC) WHERE status='pendente' AND terminal_due_at IS NOT NULL`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const terminalDueSql = `SELECT id FROM uf_live_jobs WHERE status='pendente'
      AND terminal_due_at<=now() ORDER BY terminal_due_at ASC,id ASC LIMIT 4`;
    const retryProjected = await explain(client,terminalDueSql,[]);

    const startTransition = performance.now();
    await client.query(`UPDATE uf_live_jobs SET status='expirada_operacional' WHERE id<=50000`);
    const transitionMs = performance.now()-startTransition;
    await client.query(`UPDATE uf_live_jobs SET captured_at=now()-interval '20 minutes',
      created_at=now()-interval '20 minutes',expires_at=now()+interval '10 minutes'
      WHERE id>50000`);
    await client.query(`UPDATE uf_live_jobs SET captured_at=now()-interval '1 minute',
      created_at=now()-interval '1 minute',expires_at=now()+interval '29 minutes'
      WHERE id>=99996`);
    await client.query(`UPDATE uf_live_jobs SET captured_at=now()-interval '4 minutes',
      created_at=now()-interval '4 minutes',expires_at=now()+interval '26 minutes'
      WHERE id=99997`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const commercialSql = `SELECT id FROM uf_live_jobs WHERE workspace='hot'
      AND status='pendente' ORDER BY priority DESC,captured_at DESC,created_at DESC,id ASC
      LIMIT $1`;
    const fiftyFifty = [];
    for (const limit of [1,2,4]) {
      const ids = (await client.query(commercialSql,[limit])).rows.map(row => Number(row.id));
      fiftyFifty.push({limit,ids,plan:await explain(client,commercialSql,[limit])});
    }
    assert.deepEqual(fiftyFifty[2].ids,[99997,99996,99998,99999]);

    await client.query(`UPDATE uf_live_jobs SET status='expirada_operacional'
      WHERE id BETWEEN 50001 AND 99995`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const sparse = [];
    for (const limit of [1,2,4]) sparse.push({limit,plan:await explain(client,commercialSql,[limit])});

    await client.query(`UPDATE uf_live_jobs SET status='pendente',
      expires_at=now()+interval '30 minutes',priority=(id%101)::int,
      captured_at=now()-interval '1 minute',created_at=now()-id*interval '1 millisecond'`);
    await client.query("VACUUM (ANALYZE) uf_live_jobs");
    const dense = [];
    for (const limit of [1,2,4]) dense.push({limit,plan:await explain(client,commercialSql,[limit])});
    const storage = (await client.query(`SELECT
      pg_relation_size('uf_lifecycle_due_idx'::regclass)::bigint AS due_index_bytes,
      pg_relation_size('uf_lifecycle_terminal_due_idx'::regclass)::bigint AS terminal_due_index_bytes,
      pg_relation_size('uf_lifecycle_commercial_idx'::regclass)::bigint AS commercial_index_bytes`)).rows[0];
    console.log("UNIVERSAL_LIVE_SET_LIFECYCLE " + JSON.stringify({
      differential:{initial,stale,dueLive,reconciled},
      terminalizer,retryExpiryOnly,retryProjected,fiftyFifty,sparse,dense,transitionMs,storage,
      scope:"TEMP necessary-condition proof, not operational lifecycle or full global fairness"
    }));
  } finally {
    await client.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode=1; });
