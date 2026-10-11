"use strict";

// Read-only benchmark. Refuses any connection outside this disposable cluster.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { sqlBuscarJobsPendentes } = require("../modules/engine/processor.service");
const { calcularCotasFrescorPreImporter, sqlFrescorComercialPreImporter,
  sqlRetryPreImporter } = require("../modules/engine/frescor-pre-importer.service");

const port = 55433;
const root = path.resolve(__dirname, "..");
const expectedData = path.join(root, ".local-postgres", "data");
const baseSha = "568c4fe1f848a9ad695929dd0d5706defa822ad7";

function sourceAtBase(file) {
  return execFileSync("git", ["show", `${baseSha}:${file}`], { cwd: root, encoding: "utf8" });
}

function processorQueryAtBase() {
  const source = sourceAtBase("modules/engine/processor.service.js");
  const start = source.indexOf("function sqlBuscarJobsPendentes(");
  const end = source.indexOf("function removerCamposInternosPreImporter(", start);
  assert(start >= 0 && end > start, "base processor selector not found");
  const context = {};
  vm.runInNewContext(source.slice(start, end) + "\nthis.capture=sqlBuscarJobsPendentes;", context, { timeout: 1000 });
  return context.capture();
}

function importerQuery(limite, label) {
  const source = label === "BEFORE"
    ? sourceAtBase("modules/engine/importer/importer.service.js")
    : fs.readFileSync(path.join(root, "modules/engine/importer/importer.service.js"), "utf8");
  const start = source.indexOf("async function buscarJobsProntos(");
  const end = source.indexOf("function removerCamposInternosCandidatePoolImporter(", start);
  assert(start >= 0 && end > start, "importer selector not found");
  const captured = [];
  const context = {
    queryEngine: async (sql, params) => {
      captured.push({ sql, params });
      return { ok: true, resultado: { rows: [] } };
    },
    calcularCotasFrescorPreImporter,
    sqlFrescorComercialPreImporter,
    sqlRetryPreImporter,
    limitarJobs: n => Math.min(100, Math.max(1, Number(n) || 10)),
    separarResultadoJobsProntos: () => ({ jobs: [], candidatePool: [] }),
    console: { log: () => {} }
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.capture=buscarJobsProntos;", context, { timeout: 1000 });
  return context.capture({ limite, marketplace: "mercadolivre" }).then(() => {
    const selector = captured.find(item => /^\s*WITH\b/i.test(item.sql));
    assert(selector, "importer selector SQL not captured");
    return selector;
  });
}

function walkPlan(plan, nodes = []) {
  nodes.push(plan["Index Name"] ? `${plan["Node Type"]}:${plan["Index Name"]}` : plan["Node Type"]);
  for (const child of plan.Plans || []) walkPlan(child, nodes);
  return nodes;
}

function windowAggRows(plan, rows = []) {
  if (plan["Node Type"] === "WindowAgg") rows.push({ actualRows: plan["Actual Rows"], loops: plan["Actual Loops"] });
  for (const child of plan.Plans || []) windowAggRows(child, rows);
  return rows;
}

async function explain(client, label, name, sql, params) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
    const item = result.rows[0]["QUERY PLAN"][0];
    runs.push({
      executionMs: item["Execution Time"],
      planningMs: item["Planning Time"],
      rows: item.Plan["Actual Rows"],
      nodes: [...new Set(walkPlan(item.Plan))],
      windowAggRows: windowAggRows(item.Plan),
      sharedHit: item.Plan["Shared Hit Blocks"],
      sharedRead: item.Plan["Shared Read Blocks"],
      tempRead: item.Plan["Temp Read Blocks"],
      tempWritten: item.Plan["Temp Written Blocks"]
    });
  }
  const sorted = runs.map(x => x.executionMs).sort((a, b) => a - b);
  console.log("UNIVERSAL_PG_PLAN " + JSON.stringify({
    label, name, baseSha, medianExecutionTimeMs: sorted[1],
    runs: runs.map(run => ({ planningTimeMs: run.planningMs, executionTimeMs: run.executionMs,
      rows: run.rows, windowAggRows: run.windowAggRows, tempRead: run.tempRead,
      tempWritten: run.tempWritten, sharedHit: run.sharedHit, sharedRead: run.sharedRead,
      nodes: run.nodes }))
  }));
}

(async () => {
  const client = new Client({ host: "127.0.0.1", port, user: "postgres", database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir, version() AS version")).rows[0];
    assert.equal(identity.db, "optimus_universal_fixture");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(), path.normalize(expectedData).toLowerCase());
    console.log("UNIVERSAL_PG_IDENTITY " + JSON.stringify(identity));
    const counts = (await client.query(`SELECT e.metadata->>'fixtureKind' AS kind, j.status, COUNT(*)::int AS count
      FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
      GROUP BY 1,2 ORDER BY 1,2`)).rows;
    console.log("UNIVERSAL_PG_COUNTS " + JSON.stringify(counts));
    for (const [kind, count] of [["day_500", 500], ["day_700", 700], ["historical_terminal", 100000], ["legacy_expired", 100000]]) {
      assert.equal(counts.find(row => row.kind === kind)?.count, count, `${kind} fixture size`);
    }
    const mixedWorkspaces = (await client.query(`SELECT kind, COUNT(*)::int AS workspaces_with_both_origins FROM (
        SELECT e.metadata->>'fixtureKind' AS kind, j.cliente_id
        FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
        WHERE e.metadata->>'fixtureKind' IN ('day_500', 'day_700')
        GROUP BY 1,2 HAVING COUNT(DISTINCT j.metadata->>'origemFluxo')=2
      ) mixed GROUP BY kind ORDER BY kind`)).rows;
    console.log("UNIVERSAL_PG_MIXED_WORKSPACES " + JSON.stringify(mixedWorkspaces));
    for (const kind of ["day_500", "day_700"]) {
      assert.equal(mixedWorkspaces.find(row => row.kind === kind)?.workspaces_with_both_origins, 80, `${kind} mixed origins`);
    }
    const c = calcularCotasFrescorPreImporter(70);
    for (const label of ["BEFORE", "AFTER"]) {
      await explain(client, label, "processor70", label === "BEFORE" ? processorQueryAtBase() : sqlBuscarJobsPendentes(),
        [c.aguaNova, c.frescaEmRisco, c.frescaCirculavel, c.limpeza, c.totalSelecao]);
    }
    for (const limit of [1, 2, 4]) {
      const quota = calcularCotasFrescorPreImporter(limit);
      const selected = await client.query(sqlBuscarJobsPendentes(), [quota.aguaNova, quota.frescaEmRisco, quota.frescaCirculavel, quota.limpeza, quota.totalSelecao]);
      const baseline = selected.rows.filter(row => row.tipo_saida_pre_importer === "baseline");
      console.log("UNIVERSAL_PG_PROCESSOR_CASE " + JSON.stringify({
        label: "AFTER", limit, quota,
        baseline: baseline.map(row => ({ id: row.id, workspace: row.cliente_id, lane: row.lane_vazao_pre_importer, origin: row.origem_fluxo_explicita_pre_importer }))
      }));
    }
    for (const limit of [35, 18, 4, 2, 1]) {
      for (const label of ["BEFORE", "AFTER"]) {
        const query = await importerQuery(limit, label);
        await explain(client, label, `importer${limit}`, query.sql, query.params);
      }
      const query = await importerQuery(limit, "AFTER");
      const selected = await client.query(query.sql, query.params);
      const baseline = selected.rows.filter(row => row.tipo_saida_pre_importer === "baseline");
      const kinds = [...new Set(baseline.map(row => row.metadata?.fixtureKind))];
      console.log("UNIVERSAL_PG_IMPORTER_CASE " + JSON.stringify({ label: "AFTER", limit, baselineCount: baseline.length, kinds, workspaces: [...new Set(baseline.map(row => row.cliente_id))] }));
    }
  } finally {
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_PG_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
