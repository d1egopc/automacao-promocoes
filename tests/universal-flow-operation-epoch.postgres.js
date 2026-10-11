"use strict";

// Disposable local PostgreSQL proof only. This never connects to production.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerEstadoOperacional, exigirCapturaUniversal } =
  require("../modules/engine/operation-epoch");
const { escolherMotorOperacional } =
  require("../modules/engine/universal-runtime-bootstrap");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_epoch_${crypto.randomBytes(6).toString("hex")}`;
const epoch = "2026-10-10T12:00:00.000Z";

async function main() {
  const client = new Client(config);
  let created = false;
  const labRoot = path.resolve(__dirname, "..", ".local-postgres");
  const legacyDir = fs.mkdtempSync(path.join(labRoot, "rollback-store-"));
  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = legacyDir;
  const rollback = require("../modules/engine/operation-rollback.service");
  const { readGlobalJson, writeGlobalJson } = require("../utils/storage");
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir,
      current_setting('server_version_num')::integer AS version`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await client.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await client.query(`SET search_path TO ${schema},public`);
    const ddl = fs.readFileSync(path.join(__dirname, "..", "modules", "engine",
      "operation-epoch.additive.sql"), "utf8");
    await client.query(ddl);
    await client.query(ddl);
    await client.query(`CREATE TABLE engine_universal_queue_destinations
      (operation_epoch_started_at timestamptz,status text);
      CREATE TABLE engine_universal_credit_holds
      (operation_epoch_started_at timestamptz,state text);
      CREATE TABLE engine_universal_credit_balances
      (operation_epoch_started_at timestamptz,workspace_id text,
       opening_balance integer,balance integer,reserved integer,revision bigint);
      CREATE TABLE financial_credit_ledger
      (id bigserial,operation_epoch_started_at timestamptz,cliente_id text,
       universal_movement_type text,amount integer,balance_policy text,
       universal_balance_revision bigint,universal_balance_after integer,
       projection_status text DEFAULT 'projected',created_at timestamptz DEFAULT clock_timestamp());`);
    await assert.rejects(lerEstadoOperacional(client), /operation_state_missing/);
    await client.query(`INSERT INTO engine_operation_state (id,mode)
      VALUES (1,'LEGACY')`);
    assert.equal((await lerEstadoOperacional(client)).mode, "LEGACY");
    await client.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    await client.query(ddl);
    await client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    const state = await lerEstadoOperacional(client);
    assert.equal(state.operationEpochStartedAt, epoch);
    assert.deepEqual(exigirCapturaUniversal({ capturedAt: "2026-10-10T11:59:59.999Z", state }),
      { ok: false, generation: "LEGACY", reason: "pre_epoch_capture" });
    assert.equal(exigirCapturaUniversal({ capturedAt: epoch, state }).ok, true);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET operation_epoch_started_at=$1 WHERE id=1`,
    ["2026-10-10T12:00:01.000Z"]), /UF_OPERATION_TRANSITION_FORBIDDEN/);
    await assert.rejects(client.query(`DELETE FROM engine_operation_state WHERE id=1`),
      /UF_OPERATION_STATE_DELETE_FORBIDDEN/);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`),
    /UF_OPERATION_TRANSITION_FORBIDDEN/);
    await client.query(`INSERT INTO engine_universal_queue_destinations
      VALUES ($1,'claimed')`, [epoch]);
    const pool = { connect: async () => ({
      query: (...args) => client.query(...args), release: () => {}
    }), query: (...args) => client.query(...args) };
    await assert.rejects(rollback.freezeUniversal({ pool,
      assertBackendStopped: async () => false }), /backend_must_be_stopped/);
    assert.equal((await rollback.freezeUniversal({ pool,
      assertBackendStopped: async () => true })).frozen, true);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`),
    /UF_ROLLBACK_FINANCIAL_PROOF_MISSING/);
    await client.query(`DELETE FROM engine_universal_queue_destinations`);
    await client.query(`INSERT INTO engine_universal_credit_balances
      VALUES ($1,'ws_A',3,2,0,1),($1,'ws_B',5,5,0,0)`, [epoch]);
    await client.query(`INSERT INTO financial_credit_ledger
      (operation_epoch_started_at,cliente_id,universal_movement_type,
       amount,balance_policy,universal_balance_revision,universal_balance_after)
      VALUES ($1,'ws_A','OPENING_BALANCE',3,'set',0,3),
        ($1,'ws_A','TARGET_DEBIT',-1,'subtract',1,2),
        ($1,'ws_B','OPENING_BALANCE',5,'set',0,5)`, [epoch]);
    assert.equal((await rollback.freezeUniversal({ pool,
      assertBackendStopped: async () => true })).duplicate, true);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL' WHERE id=1`), /UF_OPERATION_TRANSITION_FORBIDDEN/);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`),
    /UF_ROLLBACK_FINANCIAL_PROOF_MISSING/);
    writeGlobalJson("usuarios.json", [{ id: "ws_A", creditos: 99 },
      { id: "ws_B", creditos: 77 }]);
    let writes = 0;
    const injected = { pool,
      workspaceId: "ws_A",assertBackendStopped: async () => true,
      readUsers: () => readGlobalJson("usuarios.json", []),
      writeUsers: users => { writeGlobalJson("usuarios.json", users); writes += 1;
        if (writes === 1) {
        throw new Error("crash_after_atomic_legacy_write");
      } return true; } };
    await assert.rejects(rollback.projectLegacyWorkspace(injected),
      /crash_after_atomic_legacy_write/);
    assert.equal(readGlobalJson("usuarios.json", [])[0].creditos, 2);
    const receipt = await rollback.projectLegacyWorkspace(injected);
    assert.equal(receipt.balance, 2);
    assert.equal(writes, 1);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM
      engine_operation_rollback_projections`)).rows[0].n, 1);
    await assert.rejects(client.query(`DELETE FROM
      engine_operation_rollback_projections WHERE workspace_id='ws_A'`),
    /UF_ROLLBACK_RECEIPT_IMMUTABLE/);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`),
    /UF_ROLLBACK_FINANCIAL_PROOF_MISSING/);
    const secondReceipt = await rollback.projectLegacyWorkspace({ ...injected,
      workspaceId: "ws_B" });
    assert.equal(secondReceipt.balance, 5);
    assert.equal(readGlobalJson("usuarios.json", [])[0].creditos, 2);
    assert.equal(readGlobalJson("usuarios.json", [])[1].creditos, 5);
    await client.query(`INSERT INTO financial_credit_ledger
      (operation_epoch_started_at,cliente_id,universal_movement_type,
       amount,balance_policy,universal_balance_revision,universal_balance_after,
       projection_status)
      VALUES (NULL,'ws_A',NULL,1,'add',NULL,NULL,'pending')`);
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`),
    /UF_ROLLBACK_FINANCIAL_PROOF_MISSING/);
    await client.query(`DELETE FROM financial_credit_ledger
      WHERE projection_status='pending'`);
    await client.query("BEGIN");
    await client.query(`UPDATE engine_operation_state
      SET mode='LEGACY',operation_epoch_started_at=NULL WHERE id=1`);
    await client.query("ROLLBACK");
    assert.equal((await lerEstadoOperacional(client)).mode, "ROLLBACK_FROZEN");
    assert.equal((await client.query(`SELECT state FROM engine_operation_epoch_history
      WHERE started_at=$1`, [epoch])).rows[0].state, "active");
    const finished = await rollback.finishRollback({ pool: injected.pool,
      assertBackendStopped: async () => true,
      readUsers: () => readGlobalJson("usuarios.json", []) });
    assert.equal(finished.duplicate, false);
    assert.equal(finished.workspaces, 2);
    assert.equal((await rollback.finishRollback({ pool: injected.pool,
      assertBackendStopped: async () => true,
      readUsers: () => readGlobalJson("usuarios.json", []) })).duplicate, true);
    assert.equal((await lerEstadoOperacional(client)).operationEpochStartedAt, null);
    assert.equal(escolherMotorOperacional(await lerEstadoOperacional(client)), "LEGACY");
    assert.equal((await client.query(`SELECT state,closed_at,rollback_key FROM
      engine_operation_epoch_history WHERE started_at=$1`, [epoch])).rows[0].state,
    "rolled_back");
    await assert.rejects(client.query(`DELETE FROM engine_operation_epoch_history
      WHERE started_at=$1`, [epoch]), /UF_EPOCH_HISTORY_DELETE_FORBIDDEN/);
    await assert.rejects(client.query(`UPDATE engine_operation_epoch_history
      SET closed_at=clock_timestamp() WHERE started_at=$1`, [epoch]),
    /UF_EPOCH_HISTORY_IMMUTABLE/);
    await client.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    const epoch2 = "2026-10-10T13:00:00.000Z";
    await assert.rejects(client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]),
    /UF_OPERATION_EPOCH_NOT_NEW/);
    await client.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch2]);
    const second = await lerEstadoOperacional(client);
    assert.equal(second.operationEpochStartedAt, epoch2);
    assert.equal(exigirCapturaUniversal({ capturedAt: epoch, state: second }).ok, false);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM
      engine_operation_epoch_history`)).rows[0].n, 2);
    console.log(JSON.stringify({ test: "operation_epoch_local", ddlRerun: true,
      immutable: true, preEpochBlocked: true, postEpochAccepted: true,
      rollbackFrozen: true, rollbackCompleted: true, secondEpoch: true,
      legacyWritesAfterCrash: writes, rollbackWorkspaces: 2 }));
  } finally {
    if (created) await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
    if (!path.resolve(legacyDir).startsWith(labRoot + path.sep)) {
      throw new Error("rollback_test_cleanup_path_invalid");
    }
    fs.rmSync(legacyDir, { recursive: true, force: true });
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
