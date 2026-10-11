"use strict";

// Diagnostic only: transient synthetic rows are inserted in one transaction and rolled back.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const { avaliarFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");

const root = path.resolve(__dirname, "..");
const expectedData = path.join(root, ".local-postgres", "data");

function walk(node, found = []) {
  found.push({ type: node["Node Type"], index: node["Index Name"] || null,
    actualRows: node["Actual Rows"], rowsRemoved: node["Rows Removed by Filter"] || 0 });
  for (const child of node.Plans || []) walk(child, found);
  return found;
}

async function explain(client, label, sql) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const item = result.rows[0]["QUERY PLAN"][0];
  console.log("UNIVERSAL_HOTSET_ALTERNATIVE " + JSON.stringify({
    label, executionMs: item["Execution Time"], returned: item.Plan["Actual Rows"],
    sharedHit: item.Plan["Shared Hit Blocks"], sharedRead: item.Plan["Shared Read Blocks"],
    tempRead: item.Plan["Temp Read Blocks"], tempWritten: item.Plan["Temp Written Blocks"],
    nodes: walk(item.Plan)
  }));
}

(async () => {
  const client = new Client({ host: "127.0.0.1", port: 55433, user: "postgres",
    database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 });
  let begun = false;
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir")).rows[0];
    assert.equal(identity.db, "optimus_universal_fixture");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, 55433);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(), path.normalize(expectedData).toLowerCase());
    await client.query("BEGIN");
    begun = true;
    for (const fixture of [
      { kind: "recent_normal", originType: "synthetic_hotset", captured: new Date(Date.now() - 60_000), metadata: {} },
      { kind: "old_manual", originType: "manual_v2", captured: new Date(Date.now() - 48 * 60 * 60_000), metadata: { manualV2: true } }
    ]) {
      const event = (await client.query(
        `INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em)
         VALUES ('synthetic', $1, $2::jsonb, $3) RETURNING id`,
        [fixture.originType, JSON.stringify({ fixtureKind: fixture.kind, ...fixture.metadata }), fixture.captured]
      )).rows[0];
      await client.query(
        `INSERT INTO engine_jobs_cliente (evento_id, cliente_id, status, metadata)
         VALUES ($1, 'workspace_hotset_case', 'pendente', $2::jsonb)`,
        [event.id, JSON.stringify({ fixtureKind: fixture.kind, ...fixture.metadata })]
      );
    }

    // This is a safe superset for time-limited Normal/Turbo, not a replacement for the canonical runtime gate.
    await explain(client, "event_capture_30m_join_pending", `
      SELECT j.id
        FROM engine_eventos_brutos e
        JOIN engine_jobs_cliente j ON j.evento_id=e.id
       WHERE e.capturado_em >= NOW() - INTERVAL '30 minutes'
         AND j.status='pendente'
       ORDER BY e.capturado_em DESC, j.id ASC
       LIMIT 70`);

    // Manual V2 can be valid at any age. These are only two of the runtime's many manual markers.
    await explain(client, "manual_historical_probe_unindexed", `
      SELECT j.id
        FROM engine_jobs_cliente j
        JOIN engine_eventos_brutos e ON e.id=j.evento_id
       WHERE j.status='pendente'
         AND e.capturado_em < NOW() - INTERVAL '30 minutes'
         AND (j.metadata->>'manualV2'='true' OR e.origem_tipo ILIKE '%manual%')
       ORDER BY j.id ASC
       LIMIT 70`);

    const lateJob = {
      id: -1, status: "pendente", criado_em: new Date().toISOString(),
      evento_capturado_em: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      metadata: { origemFluxo: "clonador_grupos" }
    };
    console.log("UNIVERSAL_LATE_JOB_COUNTEREXAMPLE " + JSON.stringify({
      createdRecent: true,
      eventAgeHours: 48,
      canonicalExpired: avaliarFrescorPreImporter(lateJob).expirada
    }));
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_HOTSET_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
