"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");
const scoped = require("../modules/engine/auto-clean/recurring-admin-events");

async function main() {
  const url = process.env.AUTO_CLEAN_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("ISOLATED_POSTGRES_REQUIRED");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-scoped-auto-clean-"));
  const db = new Client({ connectionString: url });
  const schema = `ac_scoped_${process.pid}`;
  const envKeys = [scoped.RELEASE,"OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE",
    "OPTIMUS_AUTO_CLEAN_RECURRING_SCOPE","OPTIMUS_AUTO_CLEAN_RECURRING_MODE"];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    await db.query(`CREATE TABLE engine_eventos_brutos(id bigint PRIMARY KEY,origem_tipo text,
      metadata jsonb,criado_em timestamptz,texto_original text)`);
    for (const [table,column] of scoped.referenceTables)
      await db.query(`CREATE TABLE ${table} (${column} bigint REFERENCES engine_eventos_brutos(id))`);
    await db.query(`CREATE FUNCTION engine_radar_pending_event_guard_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN OLD; END $$`);
    await db.query(`CREATE TRIGGER engine_radar_pending_event_guard_candidate_trigger BEFORE DELETE
      ON engine_eventos_brutos FOR EACH ROW EXECUTE FUNCTION engine_radar_pending_event_guard_candidate()`);
    const old = new Date(Date.now()-10*24*60*60*1000);
    await db.query(`INSERT INTO engine_eventos_brutos VALUES
      (1,'whatsapp','{"radarMirror":{"origem":{"clienteId":"admin"}}}',$1,'backup test'),
      (2,'whatsapp','{"radarMirror":{"origem":{"clienteId":"admin"}}}',$1,'referenced'),
      (3,'whatsapp','{"radarMirror":{"origem":{"clienteId":"other"}}}',$1,'other tenant'),
      (4,'whatsapp','{"radarMirror":{"origem":{"clienteId":"admin"}}}',NOW(),'recent')`,[old]);
    await db.query("INSERT INTO engine_jobs_cliente(evento_id) VALUES(2)");
    const pool = {connect: async () => ({query: (...args) => db.query(...args),release() {}})};
    delete process.env[scoped.RELEASE];
    process.env.OPTIMUS_AUTO_CLEAN_RECURRING_SCOPE = scoped.SCOPE;
    process.env.OPTIMUS_AUTO_CLEAN_RECURRING_MODE = "execute";
    const off = await scoped.run({pool,dataDir:root});
    assert.equal(off.removed,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM engine_eventos_brutos")).rows[0].n,4);
    process.env[scoped.RELEASE] = "approved";
    process.env.OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE = "approved";
    assert.equal((await scoped.run({pool,dataDir:root})).removed,0,"global release must not bypass isolation");
    delete process.env.OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE;
    const first = await scoped.run({pool,dataDir:root});
    assert.equal(first.ok,true,first.reason);
    assert.equal(first.removed,1);
    assert.deepEqual((await db.query("SELECT id FROM engine_eventos_brutos ORDER BY id")).rows.map(r=>Number(r.id)),[2,3,4]);
    const directory = path.join(root,"auto-clean",scoped.DIRECTORY);
    const archives = fs.readdirSync(directory);
    assert.equal(archives.length,1);
    const record = JSON.parse(fs.readFileSync(path.join(directory,archives[0]),"utf8"));
    assert.ok(scoped.validArchive(record,archives[0]));
    await db.query("BEGIN");
    await db.query("INSERT INTO engine_eventos_brutos SELECT * FROM json_populate_record(NULL::engine_eventos_brutos,$1::json)",
      [JSON.stringify(record.row)]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM engine_eventos_brutos WHERE id=1")).rows[0].n,1);
    await db.query("ROLLBACK");
    assert.equal((await scoped.run({pool,dataDir:root})).removed,0,"idempotent after first batch");
    await db.query("INSERT INTO engine_eventos_brutos VALUES(5,'whatsapp','{\"radarMirror\":{\"origem\":{\"clienteId\":\"admin\"}}}',$1,'guard')",[old]);
    fs.writeFileSync(path.join(directory,"unknown-backup.json"),"protected");
    const blocked = await scoped.run({pool,dataDir:root});
    assert.equal(blocked.removed,0);
    assert.equal(blocked.reason,"AUTO_CLEAN_RECOVERY_UNKNOWN_FILE");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM engine_eventos_brutos WHERE id=5")).rows[0].n,1);
    fs.unlinkSync(path.join(directory,"unknown-backup.json"));
    await db.query("CREATE TABLE new_event_dependency(event_id bigint)");
    const drift = await scoped.run({pool,dataDir:root});
    assert.equal(drift.removed,0);
    assert.equal(drift.reason,"AUTO_CLEAN_REFERENCE_SCHEMA_CHANGED");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM engine_eventos_brutos WHERE id=5")).rows[0].n,1);
    await db.query("DROP TABLE new_event_dependency");
    const expired = await scoped.inventory(directory,Date.now()+scoped.RECOVERY_MS+1000);
    assert.equal(expired.count,0);
    assert.equal(fs.readdirSync(directory).length,0);
    console.log("AUTO_CLEAN_RECURRING_ADMIN_EVENTS_PASS");
  } finally {
    for (const key of envKeys) previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];
    if (db._connected) {try {await db.query(`DROP SCHEMA ${schema} CASCADE`);} catch {} await db.end();}
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
