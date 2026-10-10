"use strict";

// Disposable local PostgreSQL proof only. This never connects to production.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerEstadoOperacional, exigirCapturaUniversal } =
  require("../modules/engine/operation-epoch");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_epoch_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-10T12:00:00.000Z";

async function main() {
  const client = new Client(config);
  let created = false;
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await client.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await client.query(`SET search_path TO ${schema},public`);
    const ddl = fs.readFileSync(path.join(__dirname, "..", "modules", "engine",
      "operation-epoch.additive.sql"), "utf8");
    await client.query(ddl);
    await client.query(ddl);
    await assert.rejects(lerEstadoOperacional(client), /operation_state_missing/);
    await client.query(`INSERT INTO engine_operation_state (id,mode)
      VALUES (1,'LEGACY')`);
    assert.equal((await lerEstadoOperacional(client)).mode, "LEGACY");
    await client.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    await client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    const state = await lerEstadoOperacional(client);
    assert.equal(state.operationEpochStartedAt, epoch);
    assert.deepEqual(exigirCapturaUniversal({ capturedAt: "2026-10-10T11:59:59.999Z", state }),
      { ok: false, generation: "LEGACY", reason: "pre_epoch_capture" });
    assert.equal(exigirCapturaUniversal({ capturedAt: epoch, state }).ok, true);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET operation_epoch_started_at=$1 WHERE id=1`,
    ["2026-10-10T12:00:01.000Z"]), /UF_OPERATION_EPOCH_IMMUTABLE/);
    await assert.rejects(client.query(`DELETE FROM engine_operation_state WHERE id=1`),
      /UF_OPERATION_STATE_DELETE_FORBIDDEN/);
    await client.query(`UPDATE engine_operation_state
      SET mode='ROLLBACK_FROZEN' WHERE id=1`);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL' WHERE id=1`), /UF_OPERATION_MODE_FROZEN/);
    console.log(JSON.stringify({ test: "operation_epoch_local", ddlRerun: true,
      immutable: true, preEpochBlocked: true, postEpochAccepted: true,
      rollbackFrozen: true }));
  } finally {
    if (created) await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
