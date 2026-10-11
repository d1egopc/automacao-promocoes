"use strict";

// Ensaio local de coexistencia: schema exclusivo em DB descartavel, removido no finally.
const assert = require("node:assert/strict");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Client } = require("pg");

const db = { host:"127.0.0.1", port:55433, user:"postgres",
  database:"optimus_universal_fixture", connectionTimeoutMillis:5000 };
const schema = `uf_live_drain_${process.pid}`;
const totalLegacy=process.argv.includes("--ten-minute")?23664:100000;

async function verify(client) {
  const row = (await client.query(`SELECT current_database() AS db,
    host(inet_server_addr()) AS host,inet_server_port() AS port,
    current_setting('data_directory') AS data_dir`)).rows[0];
  assert.equal(row.db,db.database);
  assert.equal(row.host,db.host);
  assert.equal(row.port,db.port);
  assert.equal(path.normalize(row.data_dir).toLowerCase(),
    path.join(__dirname,"..",".local-postgres","data").toLowerCase());
}

function percentile(values,p) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]*1000)/1000;
}

async function run() {
  const owner=new Client(db),drainer=new Client(db),fresh=new Client(db);
  let created=false;
  try {
    await Promise.all([owner.connect(),drainer.connect(),fresh.connect()]);
    await Promise.all([verify(owner),verify(drainer),verify(fresh)]);
    assert(/^uf_live_drain_[0-9]+$/.test(schema));
    await owner.query(`CREATE SCHEMA ${schema}`);
    created=true;
    await owner.query(`CREATE TABLE ${schema}.jobs (
      id bigint PRIMARY KEY,status text NOT NULL,priority integer NOT NULL,
      captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL)`);
    await owner.query(`INSERT INTO ${schema}.jobs
      SELECT g,'pendente',1000,now()-interval '2 days',now()-interval '1 day'
      FROM generate_series(1,$1::int) g`,[totalLegacy]);
    await owner.query(`CREATE INDEX uf_drain_due_idx ON ${schema}.jobs (expires_at,id)
      WHERE status='pendente'`);
    await owner.query(`CREATE INDEX uf_drain_rank_idx ON ${schema}.jobs
      (priority DESC,captured_at DESC,id ASC) WHERE status='pendente'`);
    await owner.query(`ANALYZE ${schema}.jobs`);

    const start=performance.now();
    const drain=async()=>{
      let total=0,batches=0;
      while(total<totalLegacy){
        const result=await drainer.query(`WITH selected AS (
          SELECT id FROM ${schema}.jobs WHERE status='pendente' AND expires_at<=now()
          ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
        ) UPDATE ${schema}.jobs j SET status='expirada_operacional'
          FROM selected s WHERE j.id=s.id RETURNING j.id`);
        if(!result.rowCount) break;
        total+=result.rowCount;batches++;
        await new Promise(resolve=>setImmediate(resolve));
      }
      return {total,batches,endMs:performance.now()-start};
    };
    const sendFresh=async()=>{
      const samples=[];
      for(let i=1;i<=25;i++){
        const id=totalLegacy+i;
        const started=performance.now();
        await fresh.query(`INSERT INTO ${schema}.jobs
          VALUES ($1,'pendente',100,now()-interval '1 minute',now()+interval '29 minutes')`,[id]);
        const chosen=await fresh.query(`WITH selected AS (
          SELECT id FROM ${schema}.jobs
          WHERE status='pendente' AND expires_at>now()
          ORDER BY priority DESC,captured_at DESC,id ASC LIMIT 1
          FOR UPDATE SKIP LOCKED
        ) UPDATE ${schema}.jobs j SET status='processado'
          FROM selected s WHERE j.id=s.id RETURNING j.id`);
        assert.equal(chosen.rowCount,1);
        assert.equal(Number(chosen.rows[0].id),id);
        samples.push({id,ms:performance.now()-started,atMs:performance.now()-start});
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      return samples;
    };
    const [drained,samples]=await Promise.all([drain(),sendFresh()]);
    const count=(await owner.query(`SELECT
      count(*) FILTER (WHERE status='expirada_operacional')::int AS expired,
      count(*) FILTER (WHERE status='processado')::int AS processed,
      count(*) FILTER (WHERE status='pendente')::int AS pending
      FROM ${schema}.jobs`)).rows[0];
    assert.deepEqual(count,{expired:totalLegacy,processed:25,pending:0});
    console.log("UNIVERSAL_LEGACY_DRAIN " + JSON.stringify({
      scenario:totalLegacy===23664?"ten-minute-stale-synthetic":"legacy-100k",
      drained,count,liveProcessedDuringDrain:samples.filter(s=>s.atMs<drained.endMs).length,
      freshLatencyMs:{p50:percentile(samples.map(s=>s.ms),0.5),
        p95:percentile(samples.map(s=>s.ms),0.95),max:percentile(samples.map(s=>s.ms),1)},
      scope:"two local connections, isolated schema, 100-row commits; not product selector, not CPU/pool SLA"
    }));
  } finally {
    if(created) await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(error=>console.error(error));
    await Promise.all([owner.end().catch(()=>{}),drainer.end().catch(()=>{}),fresh.end().catch(()=>{})]);
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
