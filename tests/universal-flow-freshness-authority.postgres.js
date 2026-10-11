"use strict";

// Equivalence test against the disposable PostgreSQL only. Inserts are rolled back.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const {
  avaliarFrescorPreImporter,
  sqlFrescorComercialPreImporter,
  sqlRetryPreImporter
} = require("../modules/engine/frescor-pre-importer.service");

const cases = [
  { name: "normal_live", ageMin: 5, job: {}, event: {} },
  { name: "normal_dead", ageMin: 31, job: {}, event: {} },
  { name: "turbo_live", ageMin: 8, job: { cupomTurbo: true }, event: {} },
  { name: "turbo_dead", ageMin: 12, job: { tipoFluxo: "cupom_turbo" }, event: {} },
  { name: "turbo_whitespace_dead", ageMin: 12, job: { tipoFluxo: " cupom_turbo " }, event: {} },
  { name: "turbo_blank_alias_fallback", ageMin: 12, job: { tipoFluxo: "   ", tipo_fluxo: "cupom_turbo" }, event: {} },
  { name: "manual_job_bool", ageMin: 120, job: { manualV2: true }, event: {} },
  { name: "manual_event_bool", ageMin: 120, job: {}, event: { manual_v2: true } },
  { name: "manual_event_text", ageMin: 120, job: {}, event: { fonte: "captura_manual_v2" } },
  { name: "manual_json_null_fallback", ageMin: 120, job: { metadataEvento: { manualV2: true } }, event: null },
  { name: "manual_origin_type", ageMin: 120, job: {}, event: {}, originType: "manual_v2" },
  { name: "normal_retry_future", ageMin: 15, job: { localWorkerImageRetry: { proximaTentativaEmMs: String(Date.now() + 3600000) } }, event: {}, retryFuture: true },
  { name: "normal_retry_due", ageMin: 15, job: { afiliacaoWorkspaceRetry: { proximaTentativaEmMs: String(Date.now() - 60000) } }, event: {}, retryFuture: false },
  { name: "normal_retry_blank", ageMin: 15, job: { localWorkerImageRetry: { proximaTentativaEmMs: "" } }, event: {}, retryFuture: false }
];

(async () => {
  const client = new Client({ host: "127.0.0.1", port: 55433, user: "postgres", database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 });
  let begun = false;
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir")).rows[0];
    assert.equal(identity.db, "optimus_universal_fixture");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, 55433);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(), path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await client.query("BEGIN");
    begun = true;
    const policy = sqlFrescorComercialPreImporter("j", "e");
    const retry = sqlRetryPreImporter("j");
    for (const item of cases) {
      const capturedAt = new Date(Date.now() - item.ageMin * 60000);
      const event = (await client.query(
        `INSERT INTO engine_eventos_brutos (origem, origem_tipo, metadata, capturado_em)
         VALUES ('synthetic', $1, $2::jsonb, $3) RETURNING id`,
        [item.originType || "synthetic_freshness", JSON.stringify(item.event), capturedAt]
      )).rows[0];
      const job = (await client.query(
        `INSERT INTO engine_jobs_cliente (evento_id, cliente_id, status, metadata)
         VALUES ($1, 'workspace_freshness_case', 'pendente', $2::jsonb) RETURNING id`,
        [event.id, JSON.stringify(item.job)]
      )).rows[0];
      const sql = (await client.query(
        `SELECT ${policy.manual} AS manual, ${policy.turbo} AS turbo,
                ${policy.vivo} AS vivo, ${policy.morto} AS morto,
                ${policy.expiraEm} AS expira_em,
                ${retry.vencido} AS retry_vencido, ${retry.futuro} AS retry_futuro
           FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
          WHERE j.id=$1`, [job.id]
      )).rows[0];
      const runtime = avaliarFrescorPreImporter({
        id: job.id, metadata: item.job, evento_metadata: item.event,
        evento_origem: "synthetic", evento_origem_tipo: item.originType || "synthetic_freshness",
        evento_capturado_em: capturedAt.toISOString(), criado_em: new Date().toISOString()
      });
      assert.equal(sql.vivo, !runtime.expirada, item.name);
      assert.equal(sql.morto, runtime.expirada, item.name);
      assert.equal(sql.manual, runtime.manualV2 === true, item.name);
      assert.equal(sql.retry_futuro, item.retryFuture === true, item.name);
      assert.equal(sql.retry_vencido, item.retryFuture !== true, item.name);
      if (!runtime.manualV2) assert.equal(sql.turbo, runtime.tipoFluxo === "cupom_turbo", item.name);
      console.log("UNIVERSAL_FRESHNESS_AUTHORITY " + JSON.stringify({ name: item.name, manual: sql.manual, turbo: sql.turbo, live: sql.vivo }));
    }
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_FRESHNESS_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
