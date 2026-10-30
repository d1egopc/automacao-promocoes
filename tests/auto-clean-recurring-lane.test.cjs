"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRecurringLane, validateReadOnly, summarizeGc } = require("../modules/engine/auto-clean/recurring-lane");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("flag OFF has no work; default validation is detached, single-flight and respects ten minutes", async () => {
  let time = 0, on = false, reads = 0, deletes = 0, release;
  const deferred = [], logs = [];
  const lane = createRecurringLane({ enabled: () => on, intervalMs: () => 600000,
    now: () => time, defer: cb => deferred.push(cb), mode: () => undefined,
    validate: async () => { reads++; await new Promise(r => { release = r; }); return {ok:true, eligible:2}; },
    execute: async () => { deletes++; }, logger: {log: (...v) => logs.push(v)} });
  assert.equal(lane(), false); on = true;
  assert.equal(lane(), true); assert.equal(reads, 0);
  deferred.shift()(); await Promise.resolve();
  time = 700000; assert.equal(lane(), false); release(); await flush();
  assert.equal(deletes, 0); assert.equal(reads, 1); assert.equal(logs.length, 1);
  assert.equal(lane(), true); deferred.shift()(); await Promise.resolve(); release(); await flush();
  time += 599999; assert.equal(lane(), false);
  time++; assert.equal(lane(), true);
});

test("execution requires exact explicit mode, revocation before callback is honored", async () => {
  let mode = "execute", deletes = 0, reads = 0;
  const deferred = [];
  const lane = createRecurringLane({enabled:()=>true, intervalMs:()=>1, now:()=>0,
    mode:()=>mode, defer:cb=>deferred.push(cb), validate:async()=>{reads++;return {ok:true};},
    execute:async()=>{deletes++;return {ok:true,removed:1};},logger:{log(){}}});
  lane(); mode = "invalid"; deferred.shift()(); await flush();
  assert.equal(deletes,0); assert.equal(reads,1);
  const executeLane = createRecurringLane({enabled:()=>true,intervalMs:()=>1,mode:()=>"execute",
    validate:async()=>{throw Error("unexpected");},execute:async()=>{deletes++;return {ok:true};},logger:{log(){}}});
  executeLane(); await flush(); await flush(); assert.equal(deletes,1);
});

test("validation uses READ ONLY, bounded statements, ROLLBACK and releases on errors", async () => {
  for (const fail of [false,true]) {
    const sql = []; let released = false;
    const client = {query:async q => {sql.push(q);return {rows:[]};},release(){released=true;}};
    const work = () => validateReadOnly({pool:{connect:async()=>client},inventory:async options=>{
      assert.equal(options.execute,false); assert.equal(options.loteLimite,32);
      await options.queryEngine("SELECT 1",[]);
      if(fail)throw Error("fixture");
      return [{elegiveis:2,protegidos:3},{erro:true}];
    }});
    if(fail)await assert.rejects(work); else {
      const result = await work(); assert.equal(result.eligible,2);assert.equal(result.protected,3);
      assert.equal(result.blocked,1);assert.equal(result.removed,0);
    }
    assert.equal(sql[0],"BEGIN READ ONLY");assert.equal(sql.at(-1),"ROLLBACK");
    assert.ok(sql.some(q=>q.includes("statement_timeout")));assert.equal(released,true);
    assert.equal(sql.some(q=>/DELETE|UPDATE|INSERT|TRUNCATE/.test(q)),false);
  }
});

test("partial inventory failure is reported as failed without allowing writes", async () => {
  const queries=[];
  const client={query:async q=>{queries.push(q);return {rows:[]};},release(){}};
  const result=await validateReadOnly({pool:{connect:async()=>client},inventory:async()=>[
    {elegiveis:1,protegidos:2},{erro:true,motivoEncerramento:"query_indisponivel"}
  ]});
  assert.equal(result.ok,false);
  assert.equal(result.blocked,1);
  assert.equal(result.removed,0);
  assert.equal(queries[0],"BEGIN READ ONLY");
  assert.equal(queries.at(-1),"ROLLBACK");
});

test("GC missing/stale references remain blocked; metadata contains no workspace or paths",()=>{
  const result=summarizeGc({mediaPhysical:{scanned:500,removed:0,bytesFreed:0,dryRun:false,
    targetResults:[{referenceComplete:false,referenceReasonCode:"REFERENCE_COMPACT_SOURCE_MISSING"},
      {referenceComplete:false,referenceReasonCode:"REFERENCE_COMPACT_SOURCE_STALE"},
      {referenceComplete:false,referenceReasonCode:"private/path/token"}]}});
  assert.equal(result.blocked,3);assert.equal(result.removed,0);
  assert.equal(result.reasons.REFERENCE_UNAVAILABLE,1);
  assert.equal(JSON.stringify(result).includes("private"),false);
});

test("wiring is admitted outside shadow flag and never awaited by commercial cycle",()=>{
  const source=require("node:fs").readFileSync(require.resolve("../modules/engine/orchestrator.runner"),"utf8");
  assert.match(source,/agendarAutoCleanRecorrente\(\);\s*if \(autoCleanShadowAtivo\(\)\)/);
  assert.doesNotMatch(source,/await agendarAutoCleanRecorrente/);
});

test("100k disabled admissions have bounded local CPU cost",()=>{
  const lane=createRecurringLane({enabled:()=>false});const start=performance.now();
  for(let i=0;i<100000;i++)assert.equal(lane(),false);
  const durationMs=performance.now()-start;
  console.log(JSON.stringify({benchmark:"disabled_admission_100k",durationMs}));
  assert.ok(durationMs<1000);
});
