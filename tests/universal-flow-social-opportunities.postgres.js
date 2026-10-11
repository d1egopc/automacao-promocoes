"use strict";

// Disposable localhost PostgreSQL 17 only; never accepts a remote DB URL.
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
process.env.DATA_DIR = path.join(__dirname, "..", ".local-test-tmp", "uf-social-pg-empty");
const { Pool } = require("pg");
const source = require("../modules/social/universal-opportunities.source");
const storage = require("../modules/social/storage");

const schema = `uf_social_${randomBytes(5).toString("hex")}`;
const base = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 3000 };
const admin = new Pool(base);
const pool = new Pool({ ...base, options: `-c search_path=${schema},public` });
const epoch = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
const payload = { clienteId: "ws_a", titulo: "Fila Universal", marketplace: "amazon",
  precoAtual: 99, imagem: "https://cdn.test/item.jpg",
  linkAfiliado: "https://go.test/item", status: "pendente" };

(async () => {
  const identity = (await admin.query(`SELECT current_database() AS database,
    host(inet_server_addr()) AS host,inet_server_port() AS port,
    current_setting('data_directory') AS data_directory,
    current_setting('server_version_num')::int AS version`)).rows[0];
  assert.equal(identity.database, base.database);
  assert.equal(identity.host, base.host);
  assert.equal(identity.port, base.port);
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.match(identity.data_directory.replaceAll("\\", "/"),
    /\/Codex\/uf\/\.local-postgres\/data$/i);
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE engine_operation_state
      (id int PRIMARY KEY,mode text,operation_epoch_started_at timestamptz)`);
    await pool.query(`INSERT INTO engine_operation_state VALUES (1,'UNIVERSAL',$1)`, [epoch]);
    await pool.query(`CREATE TABLE engine_universal_queue_items
      (id bigint PRIMARY KEY,operation_epoch_started_at timestamptz,
       workspace_id text,oferta_id bigint,origem_fluxo text,
       capturado_em timestamptz,item_payload jsonb)`);
    await pool.query(`CREATE INDEX engine_uq_items_social_workspace_idx
      ON engine_universal_queue_items
      (operation_epoch_started_at,workspace_id,id DESC)`);
    const insert = async (id, workspace, capture, data, origin = "radar") =>
      pool.query(`INSERT INTO engine_universal_queue_items
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [id, epoch, workspace, 100 + id, origin, capture, JSON.stringify(data)]);
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    await insert(1, "ws_a", recent, payload);
    await insert(2, "ws_b", recent, { ...payload, clienteId: "ws_b" });
    await insert(3, "ws_a", new Date(Date.now() - 35 * 60_000).toISOString(),
      { ...payload, linkAfiliado: "https://go.test/old" });
    await insert(4, "ws_a", new Date(Date.now() - 35 * 60_000).toISOString(),
      { ...payload, linkAfiliado: "https://go.test/manual", metadata: { manualV2: true } }, "manual_v2");
    await insert(5, "ws_a", new Date(Date.now() - 15 * 60_000).toISOString(),
      { ...payload, linkAfiliado: "https://go.test/turbo", cupom: "APP20" });
    source.configurarFonteUniversalSocial({ getMode: () => "UNIVERSAL", getPool: () => pool });
    const a = await storage.listarOportunidadesSocialOperacional("ws_a", 50);
    const b = await storage.listarOportunidadesSocialOperacional("ws_b", 50);
    assert.deepEqual(new Set(a.map(item => item.ofertaId)), new Set(["101", "104"]));
    assert.deepEqual(b.map(item => item.ofertaId), ["102"]);
    assert.equal((await source.encontrarItemUniversalSocial("ws_b", "universal_1")), null);
    assert.equal((await storage.validarOportunidadeSocialManualOperacional("ws_a", "103")).ok, false);
    const plan = (await pool.query(`EXPLAIN SELECT id FROM engine_universal_queue_items
      WHERE operation_epoch_started_at=$1 AND workspace_id=$2
      ORDER BY id DESC LIMIT 50`, [epoch, "ws_a"])).rows.map(row => row["QUERY PLAN"]).join("\n");
    assert.match(plan, /engine_uq_items_social_workspace_idx|Seq Scan/);
    console.log("universal_flow_social_postgres=PASS");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
