"use strict";

// Taxas observadas de um UPDATE indexado em TEMP; nao sao capacidade minima operacional.
const assert=require("node:assert/strict");
const path=require("node:path");
const {performance}=require("node:perf_hooks");
const {Client}=require("pg");

function percentile(values,p){
  const ordered=[...values].sort((a,b)=>a-b);
  return Math.round(ordered[Math.min(ordered.length-1,Math.ceil(ordered.length*p)-1)]*1000)/1000;
}

async function run(){
  const client=new Client({host:"127.0.0.1",port:55433,user:"postgres",
    database:"optimus_universal_fixture",connectionTimeoutMillis:5000});
  try{
    await client.connect();
    const identity=(await client.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db,"optimus_universal_fixture");
    assert.equal(identity.host,"127.0.0.1");
    assert.equal(identity.port,55433);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname,"..",".local-postgres","data").toLowerCase());
    await client.query(`CREATE TEMP TABLE uf_capacity (
      id bigint PRIMARY KEY,status text NOT NULL,terminal_due_at timestamptz NOT NULL)`);
    await client.query(`CREATE INDEX uf_capacity_due_idx ON uf_capacity
      (terminal_due_at,id) WHERE status='pending'`);
    const sql=`WITH picked AS (
      SELECT id FROM uf_capacity WHERE status='pending' AND terminal_due_at<=now()
      ORDER BY terminal_due_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE uf_capacity j SET status='expired'
      FROM picked WHERE j.id=picked.id RETURNING j.id`;
    const rates=[];
    for(const limit of [1,10,50,100]){
      await client.query("TRUNCATE uf_capacity");
      await client.query(`INSERT INTO uf_capacity
        SELECT g,'pending',now()-interval '1 day' FROM generate_series(1,10000) g`);
      await client.query("VACUUM (ANALYZE) uf_capacity");
      const times=[];
      let total=0;
      const started=performance.now();
      while(total<10000){
        const t=performance.now();
        const result=await client.query(sql,[limit]);
        const elapsed=performance.now()-t;
        assert(result.rowCount>0);
        times.push(elapsed);
        total+=result.rowCount;
      }
      const seconds=(performance.now()-started)/1000;
      const remaining=(await client.query(`SELECT count(*)::int AS n
        FROM uf_capacity WHERE status='pending'`)).rows[0].n;
      assert.equal(remaining,0);
      rates.push({batch:limit,jobs:total,rounds:times.length,seconds,
        observedJobsPerSecond:Math.round(total/seconds),
        roundMs:{p50:percentile(times,0.5),p95:percentile(times,0.95),
          max:percentile(times,1)}});
    }

    await client.query(`CREATE TEMP TABLE uf_due_input AS
      WITH clock AS (SELECT now() AS t0), generated AS (
        SELECT g,'ws_'||(g%25) AS workspace,
          CASE WHEN g%2=0 THEN 'optimus' ELSE 'clonador_grupos' END AS origin,
          CASE WHEN g%10<3 THEN 'turbo' WHEN g%10<5 THEN 'retry'
            ELSE 'normal' END AS flow,
          t0+CASE WHEN g<=90000 THEN (g%1800)*interval '1 second'
            ELSE interval '0 second' END AS captured_at,t0
        FROM clock CROSS JOIN generate_series(1,100000) g
      ) SELECT *,captured_at+CASE WHEN flow='turbo' THEN interval '10 minutes'
        ELSE interval '30 minutes' END AS commercial_expiry,
        CASE WHEN flow='retry' THEN captured_at+interval '45 minutes'
          ELSE NULL::timestamptz END AS retry_ready_at
      FROM generated`);
    const arrivals=(await client.query(`WITH due AS (
        SELECT g,flow,workspace,origin,
          GREATEST(commercial_expiry,COALESCE(retry_ready_at,commercial_expiry)) AS at
        FROM uf_due_input
      ), seconds AS (
        SELECT date_trunc('second',at) AS bucket,count(*)::int AS n
        FROM due GROUP BY 1
      ), minutes AS (
        SELECT date_trunc('minute',at) AS bucket,count(*)::int AS n
        FROM due GROUP BY 1
      ), cycles AS (
        SELECT floor(extract(epoch FROM at)/120)::bigint AS bucket,count(*)::int AS n
        FROM due GROUP BY 1
      ) SELECT (SELECT max(n) FROM seconds) AS max_per_second,
        (SELECT max(n) FROM minutes) AS max_per_minute,
        (SELECT max(n) FROM cycles) AS max_per_2min_cycle,
        (SELECT count(*)::int FROM due WHERE flow='normal') AS normal,
        (SELECT count(*)::int FROM due WHERE flow='turbo') AS turbo,
        (SELECT count(*)::int FROM due WHERE flow='retry') AS retry,
        (SELECT count(DISTINCT workspace)::int FROM due) AS workspaces
      `)).rows[0];
    const dueBuckets=(await client.query(`WITH due AS (
      SELECT GREATEST(commercial_expiry,
        COALESCE(retry_ready_at,commercial_expiry)) AS at
      FROM uf_due_input
    ), origin AS (SELECT min(at) AS first_at FROM due)
    SELECT floor(extract(epoch FROM due.at-origin.first_at))::int AS second,
      count(*)::int AS n FROM due CROSS JOIN origin GROUP BY 1 ORDER BY 1`)).rows;
    const perSecond=new Map(dueBuckets.map(row=>[row.second,row.n]));
    const lastSecond=dueBuckets.at(-1).second;
    function simulate(batch,intervalSeconds,initialDue=0){
      let pending=initialDue,maxPending=pending;
      for(let second=0;second<=lastSecond;second++){
        pending+=perSecond.get(second)||0;
        if(second%intervalSeconds===0) pending=Math.max(0,pending-batch);
        maxPending=Math.max(maxPending,pending);
      }
      return {batch,intervalSeconds,initialDue,maxPending,
        pendingAfterArrivals:pending,
        extraDrainSeconds:Math.ceil(pending/batch)*intervalSeconds};
    }
    const conditionalSchedules=[simulate(10,1),simulate(50,1),simulate(100,1),
      simulate(100,2),simulate(100,120),simulate(100,1,23664)];
    await client.query(`CREATE TEMP TABLE uf_fair_due (
      id bigint PRIMARY KEY,workspace text NOT NULL,status text NOT NULL,
      terminal_due_at timestamptz NOT NULL)`);
    await client.query(`INSERT INTO uf_fair_due SELECT g,
      CASE WHEN g<=90000 THEN 'A' WHEN g<=95000 THEN 'B' ELSE 'C' END,
      'pending',now()-interval '1 day' FROM generate_series(1,100000) g`);
    await client.query(`CREATE INDEX uf_fair_due_idx ON uf_fair_due
      (workspace,terminal_due_at,id) WHERE status='pending'`);
    await client.query(`CREATE TEMP TABLE uf_existing_fairness (
      workspace text PRIMARY KEY,last_served_at timestamptz)`);
    await client.query(`INSERT INTO uf_existing_fairness(workspace) VALUES ('A'),('B'),('C')`);
    await client.query("VACUUM (ANALYZE) uf_fair_due");
    await client.query("ANALYZE uf_existing_fairness");
    const fairSql=`SELECT f.workspace,j.id FROM uf_existing_fairness f
      CROSS JOIN LATERAL (
        SELECT id FROM uf_fair_due j WHERE j.workspace=f.workspace
          AND j.status='pending' AND j.terminal_due_at<=now()
        ORDER BY j.terminal_due_at,j.id LIMIT 1
      ) j ORDER BY f.last_served_at ASC NULLS FIRST,f.workspace LIMIT 2`;
    const fairPlan=(await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${fairSql}`))
      .rows[0]["QUERY PLAN"][0];
    const fairScans=[];
    const walk=node=>{if(/Scan$/.test(node["Node Type"])) fairScans.push({
      type:node["Node Type"],index:node["Index Name"]||null,
      rows:node["Actual Rows"],loops:node["Actual Loops"],
      filtered:node["Rows Removed by Filter"]||0});
      for(const child of node.Plans||[]) walk(child);};
    walk(fairPlan.Plan);
    const served={A:0,B:0,C:0};
    for(let round=0;round<12;round++){
      const rows=(await client.query(fairSql)).rows;
      assert.equal(rows.length,2);
      for(const row of rows){
        await client.query("UPDATE uf_fair_due SET status='expired' WHERE id=$1",[row.id]);
        await client.query("UPDATE uf_existing_fairness SET last_served_at=clock_timestamp() WHERE workspace=$1",[row.workspace]);
        served[row.workspace]++;
      }
    }
    assert(served.A>0&&served.B>0&&served.C>0);
    const workspaceFairness={served,plan:{ms:fairPlan["Execution Time"],scans:fairScans},
      scope:"three always-ready workspaces only; not bounded across arbitrary inactive workspaces"};
    console.log("UNIVERSAL_TERMINALIZER_CAPACITY "+JSON.stringify({rates,arrivals,conditionalSchedules,workspaceFairness,
      scenario:"90k arrivals spread over 30 min plus 10k same-second burst; 25 workspaces, two origins; generated inputs, not production rates",
      scope:"TEMP 10k per batch, one client; excludes facts, fairness, writer integration, pool contention and WAL"}));
  }finally{await client.end().catch(()=>{});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
