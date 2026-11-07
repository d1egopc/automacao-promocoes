"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");

const {
  tableAvailable,
  readProductMemory,
  upsertProductMemory,
  invalidateProductMemory
} = require("../modules/inteligencia-universal/memory-v1.repository");

const connectionString = String(process.env.INTELLIGENCE_MEMORY_TEST_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("INTELLIGENCE_MEMORY_TEST_DATABASE_URL_REQUIRED");
if (process.env.DATABASE_URL) throw new Error("PRODUCTION_DATABASE_URL_FORBIDDEN");

const root = path.join(__dirname, "..");
const schemaSql = fs.readFileSync(path.join(root, "modules/engine/schema.sql"), "utf8");
const migrationSql = fs.readFileSync(path.join(root,
  "modules/inteligencia-universal/intelligence-product-memory.additive.sql"), "utf8");

function scopedUrl(base, schema) {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return url.toString();
}

async function fingerprint(client) {
  const result = await client.query(`SELECT jsonb_build_object(
      'eventos', (SELECT count(*) FROM engine_eventos_brutos),
      'ofertas', (SELECT count(*) FROM engine_ofertas),
      'jobs', (SELECT count(*) FROM engine_jobs_cliente),
      'event_hash', (SELECT md5(COALESCE(string_agg(id::text || ':' || COALESCE(hash_evento,''), ',' ORDER BY id),'')) FROM engine_eventos_brutos),
      'offer_hash', (SELECT md5(COALESCE(string_agg(id::text || ':' || COALESCE(titulo,''), ',' ORDER BY id),'')) FROM engine_ofertas)
    ) AS value`);
  return result.rows[0].value;
}

function globalRecord(overrides = {}) {
  return {
    scopeType: "global",
    workspaceId: "",
    marketplace: "magalu",
    productId: "123456789",
    sku: "SKU-1",
    variantKey: "azul",
    identityKey: "magalu:123456789:SKU-1:azul",
    identityEvidenceHash: "a".repeat(64),
    factualTitle: "Ventilador Arno X-Treme 40 cm",
    brand: "Arno",
    model: "X-Treme",
    capacity: "40 cm",
    quantity: "1 unidade",
    categoryPrimary: "Climatização e Ventilação",
    categoryAffinities: [],
    classificationStatus: "resolved",
    safetyClass: "general",
    source: "api_oficial",
    confidence: "high",
    schemaVersion: "optimus-intelligence-v1-phase-a",
    classifierVersion: "optimus-intelligence-v1-phase-a",
    ...overrides
  };
}

async function main() {
  const admin = new Client({ connectionString, ssl: false });
  await admin.connect();
  const version = await admin.query("SHOW server_version_num");
  assert.ok(Number(version.rows[0].server_version_num) >= 170000, "PostgreSQL 17 obrigatorio");

  const schema = `intelligence_v1_b_${Date.now()}_${process.pid}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: scopedUrl(connectionString, schema), ssl: false, max: 4 });
  const query = (sql, params) => pool.query(sql, params);
  try {
    await pool.query(schemaSql);
    const event = (await pool.query(`INSERT INTO engine_eventos_brutos
      (origem,grupo_id,texto_original,hash_evento) VALUES ('fixture','grupo_a','fixture','hash_fixture') RETURNING id`)).rows[0];
    await pool.query(`INSERT INTO engine_ofertas
      (evento_id,marketplace,titulo,status,criada_em,atualizada_em)
      VALUES ($1,'magalu','Oferta operacional preservada','capturada',clock_timestamp(),clock_timestamp())`, [event.id]);
    const before = await fingerprint(pool);

    await pool.query(migrationSql);
    await pool.query(migrationSql);
    assert.equal((await tableAvailable({ query })).available, true);
    assert.deepEqual(await fingerprint(pool), before, "migration nao altera tabelas operacionais");

    const forbiddenColumns = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='intelligence_product_memory'
        AND column_name = ANY($2::text[])`, [schema,
      ["preco", "cupom", "link_afiliado", "tracking_id", "cookie", "token", "app_secret"]])).rows;
    assert.equal(forbiddenColumns.length, 0, "schema nao contem dados comerciais proibidos");

    const indexes = (await pool.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname=$1 AND tablename='intelligence_product_memory'`, [schema])).rows.map(row => row.indexname);
    for (const name of ["intelligence_product_memory_identity_uq",
      "intelligence_product_memory_identity_key_idx", "intelligence_product_memory_last_seen_idx",
      "intelligence_product_memory_invalidated_idx"]) assert.ok(indexes.includes(name), name);

    const inserted = await upsertProductMemory({ query, record: globalRecord() });
    assert.equal(inserted.ok, true);
    assert.equal(Number(inserted.record.record_revision), 1);

    const lower = await upsertProductMemory({ query, record: globalRecord({
      source: "pagina_oficial", factualTitle: "Titulo inferior nao deve substituir"
    }) });
    assert.equal(lower.ok, true);
    assert.equal(lower.record.factual_title, "Ventilador Arno X-Treme 40 cm");
    assert.equal(Number(lower.record.record_revision), 1);

    const upgraded = await upsertProductMemory({ query, record: globalRecord({
      factualTitle: "Ventilador Arno X-Treme 40 cm 6 Pas"
    }) });
    assert.equal(Number(upgraded.record.record_revision), 2);
    assert.equal(upgraded.record.factual_title, "Ventilador Arno X-Treme 40 cm 6 Pas");

    const concurrent = await Promise.all(Array.from({ length: 20 }, () =>
      upsertProductMemory({ query, record: globalRecord({
        factualTitle: "Ventilador Arno X-Treme 40 cm 6 Pas"
      }) })));
    assert.ok(concurrent.every(result => result.ok));
    assert.equal(Number((await readProductMemory({ query, scopeType: "global", marketplace: "magalu",
      productId: "123456789", sku: "SKU-1", variantKey: "azul" })).record.record_revision), 2,
    "upsert identico concorrente nao infla revisao");
    assert.equal(Number((await pool.query("SELECT count(*) AS total FROM intelligence_product_memory")).rows[0].total), 1);

    const conflict = await upsertProductMemory({ query, record: globalRecord({
      identityEvidenceHash: "b".repeat(64)
    }) });
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.record.invalidation_reason, "identity_evidence_conflict");
    assert.equal(Number(conflict.record.record_revision), 3);

    const restored = await upsertProductMemory({ query, record: globalRecord({
      factualTitle: "Ventilador Arno X-Treme 40 cm 6 Pas"
    }) });
    assert.equal(restored.record.invalidated_at, null);
    assert.equal(Number(restored.record.record_revision), 4);

    const workspaceRecord = globalRecord({
      scopeType: "workspace", workspaceId: "user_a", productId: "LOCAL-1", sku: "LOCAL-1",
      variantKey: "", identityKey: "magalu:LOCAL-1", identityEvidenceHash: "c".repeat(64),
      source: "extension_verified", factualTitle: "Produto local confirmado"
    });
    assert.equal((await upsertProductMemory({ query, record: workspaceRecord })).ok, true);
    assert.ok((await readProductMemory({ query, scopeType: "workspace", workspaceId: "user_a",
      marketplace: "magalu", productId: "LOCAL-1", sku: "LOCAL-1" })).record);
    assert.equal((await readProductMemory({ query, scopeType: "workspace", workspaceId: "user_b",
      marketplace: "magalu", productId: "LOCAL-1", sku: "LOCAL-1" })).record, null,
    "workspace B nao le memoria privada de A");
    assert.equal((await readProductMemory({ query, scopeType: "global", marketplace: "magalu",
      productId: "LOCAL-1", sku: "LOCAL-1" })).record, null,
    "evidencia privada nao e promovida a global");

    const invalidated = await invalidateProductMemory({ query, scopeType: "workspace", workspaceId: "user_a",
      marketplace: "magalu", productId: "LOCAL-1", sku: "LOCAL-1", reason: "fixture_invalidated" });
    assert.equal(invalidated.ok, true);
    assert.equal(invalidated.record.invalidation_reason, "fixture_invalidated");

    await pool.query("SET enable_seqscan=off");
    const explain = (await pool.query(`EXPLAIN (FORMAT JSON) SELECT memory_id
      FROM intelligence_product_memory WHERE scope_type='global' AND workspace_id=''
      AND marketplace='magalu' AND product_id='123456789' AND sku='SKU-1' AND variant_key='azul' LIMIT 1`)).rows[0]["QUERY PLAN"];
    assert.match(JSON.stringify(explain), /Index Scan|Index Only Scan/);

    const autoCleanSource = fs.readFileSync(path.join(root,
      "modules/engine/auto-clean/auto-clean.service.js"), "utf8");
    assert.doesNotMatch(autoCleanSource, /intelligence_product_memory/,
      "Auto-Clean atual nao inclui memoria duravel");
    const memoryCountBefore = Number((await pool.query("SELECT count(*) AS total FROM intelligence_product_memory")).rows[0].total);
    await pool.query(`DELETE FROM engine_ofertas WHERE evento_id=$1`, [event.id]);
    const memoryCountAfter = Number((await pool.query("SELECT count(*) AS total FROM intelligence_product_memory")).rows[0].total);
    assert.equal(memoryCountAfter, memoryCountBefore, "ciclo de oferta nao remove memoria");

    const absentSchema = `${schema}_absent`;
    await admin.query(`CREATE SCHEMA ${absentSchema}`);
    const absentPool = new Pool({ connectionString: scopedUrl(connectionString, absentSchema), ssl: false, max: 1 });
    try {
      assert.equal((await tableAvailable({ query: (sql, params) => absentPool.query(sql, params) })).available, false);
      const missing = await readProductMemory({ query: (sql, params) => absentPool.query(sql, params),
        scopeType: "global", marketplace: "magalu", productId: "1" });
      assert.equal(missing.ok, false);
      assert.equal(missing.reason, "memory_table_unavailable");
    } finally {
      await absentPool.end();
      await admin.query(`DROP SCHEMA ${absentSchema} CASCADE`);
    }

    const timeoutError = new Error("statement timeout");
    timeoutError.code = "57014";
    const timeout = await readProductMemory({ query: async () => { throw timeoutError; },
      scopeType: "global", marketplace: "magalu", productId: "1" });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.reason, "memory_query_timeout");

    console.log("INTELLIGENCE_V1_MEMORY_POSTGRES17_PASS");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
