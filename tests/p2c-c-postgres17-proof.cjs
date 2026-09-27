'use strict';
// CI-only, synthetic, disposable PostgreSQL. Never required by backend code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Pool } = require(process.env.P2C_PG_MODULE || 'pg');
const target = require('./p2c-c-production-profile.json');
const url = new URL(process.env.P2C_TEST_DATABASE_URL || 'invalid://not-configured');
assert.equal(process.env.P2C_ISOLATED_ACK, 'disposable-synthetic-only');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/p2c_disposable_representative');
assert(!process.env.DATABASE_URL, 'Application database forbidden');
const outDir = process.env.P2C_EVIDENCE_DIR || path.join(__dirname, 'p2c-c-evidence');
fs.mkdirSync(outDir, { recursive: true });
const evidence = { status: 'running', synthetic: true, startedUTC: new Date().toISOString(),
  targets: target, profiles: {}, equivalence: {}, benchmarks: [], writes: [], phases: [],
  limitations: ['No production DDL or backend change authorized by this proof.',
    'Warm/mixed cache; no deliberate OS cache flush. CI hardware differs from VPS.',
    'Trigram diversity/content is synthetic even when stored-size and compression distributions fit.',
    'p95 requires >=20 observations; p99 >=100, nearest-rank descriptive sample, not SLA.',
    'WAL LSN deltas include concurrent/autovacuum cluster activity, isolated cluster only.',
    'INSERT SELECT benchmarks server-side materialization; excludes client JSON/network serialization.',
    'Table profiles/counters are phase snapshots; stats publication can lag.',
    'Lossy bitmap is measured if observed, not assumed; diagnostic forced plan is labelled separately.',
    'Durable COMMIT uses fsync/on synchronous_commit/on; hardware/device durability not independently certified.'] };
function save() { fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify(evidence, null, 2)); }
function emit(phase, data = {}) {
  evidence.phases.push({ phase, at: new Date().toISOString(), ...data }); save();
  console.log(JSON.stringify({ phase, ...data }));
}
const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 5,
  connectionTimeoutMillis: 5000, statement_timeout: 600000, query_timeout: 610000 });
pool.on('error', e => { evidence.poolError = { code: e.code }; save(); });
let client;
const common = `NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL AND
 LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml','mercadolivre')`;
const ordering = 'atualizada_em DESC NULLS LAST, id DESC';
const originalText = "CONCAT_WS(' ',link_original,link_expandido,link_afiliado,COALESCE(metadata::text,''))";
const immutableText = `((CASE WHEN link_original IS NULL THEN '' ELSE link_original||' ' END)||
 (CASE WHEN link_expandido IS NULL THEN '' ELSE link_expandido||' ' END)||
 (CASE WHEN link_afiliado IS NULL THEN '' ELSE link_afiliado||' ' END)||COALESCE(metadata::text,''))`;
const variants = ['canonical', 'importer'];
const cases = [
  { name: 'recent', mlb: 'MLB900000001', exclude: 1000001 },
  { name: 'old', mlb: 'MLB900000002', exclude: 0 },
  { name: 'miss', mlb: 'MLB999999999', exclude: 0 },
  { name: 'multiple_tie_nulls', mlb: 'MLB900000003', exclude: 1000004 },
  { name: 'metadata_only', mlb: 'MLB900000004', exclude: 0 },
  { name: 'large_history_image', mlb: 'MLB900000005', exclude: 0 },
  { name: 'many_exact_matches', mlb: 'MLB900000006', exclude: 0 },
  { name: 'trigram_false_candidates', mlb: 'MLB900000007', exclude: 0 },
  { name: 'metadata_key', mlb: 'MLB900000008', exclude: 0 },
  { name: 'broad_bitmap_prefix', mlb: 'MLB1', exclude: 100 }
];
function sql(strategy, v, full = false) {
  return `SELECT id,imagem FROM ${strategy}_ofertas WHERE ${v === 'importer' ? 'id <> $2 AND ' : ''}${common}
    AND UPPER(${strategy === 'baseline' ? originalText : immutableText}) LIKE '%'||$1||'%'
    ORDER BY ${ordering}${full ? '' : ' LIMIT 1'}`;
}
function params(v, c) { return v === 'importer' ? [c.mlb, c.exclude] : [c.mlb]; }
function quantiles(values) {
  const a = [...values].sort((a,b) => a-b); const q = p => a[Math.max(0,Math.ceil(p*a.length)-1)];
  return { n:a.length, min:a[0], p50:q(.5), p95:a.length>=20?q(.95):null, p99:a.length>=100?q(.99):null, max:a.at(-1) };
}
function metrics(p) {
  const scans=[], sorts=[];
  function walk(n) {
    if (/Scan/.test(n['Node Type'])) scans.push(Object.fromEntries(['Node Type','Parallel Aware','Index Name','Actual Rows',
      'Actual Loops','Rows Removed by Filter','Rows Removed by Index Recheck','Exact Heap Blocks','Lossy Heap Blocks'].filter(k=>k in n).map(k=>[k,n[k]])));
    if (n['Node Type']==='Sort') sorts.push(Object.fromEntries(['Sort Method','Sort Space Used','Sort Space Type'].filter(k=>k in n).map(k=>[k,n[k]])));
    (n.Plans||[]).forEach(walk);
  } walk(p.Plan);
  return { executionMs:p['Execution Time'],planningMs:p['Planning Time'],scans,sorts,
    buffers:Object.fromEntries(['Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Temp Read Blocks','Temp Written Blocks'].map(k=>[k,p.Plan[k]||0])) };
}
async function q(sql,args=[]) { return (await client.query(sql,args)).rows; }
async function profile(table) {
  const shape=(await q(`SELECT count(*)::int rows,avg(pg_column_size(metadata)) mean_bytes,
   percentile_cont(ARRAY[.5,.9,.95,.99]) WITHIN GROUP(ORDER BY pg_column_size(metadata)) quantiles_bytes,
   max(pg_column_size(metadata)) max_bytes,
   count(*) FILTER(WHERE pg_column_compression(metadata)='pglz')::int pglz_rows,
   count(*) FILTER(WHERE metadata IS NULL)::int null_rows,
   count(*) FILTER(WHERE LOWER(REGEXP_REPLACE(COALESCE(marketplace,''),'[[:space:]_-]+','','g')) IN ('ml','mercadolivre'))::int ml_rows,
   avg(octet_length(metadata::text)) mean_logical_text_bytes FROM ${table}`))[0];
  const sizes=(await q(`SELECT pg_relation_size(oid) heap_bytes,pg_table_size(oid) table_bytes,
   pg_total_relation_size(reltoastrelid) toast_bytes,pg_indexes_size(oid) indexes_bytes,
   pg_total_relation_size(oid) total_bytes FROM pg_class WHERE oid=$1::regclass`,[table]))[0];
  return {shape,sizes};
}
async function cluster() {
  const r={ at:new Date().toISOString() };
  r.wal=(await q('SELECT * FROM pg_stat_wal'))[0];
  r.lsn=(await q('SELECT pg_current_wal_insert_lsn() lsn'))[0].lsn;
  r.checkpointer=(await q('SELECT * FROM pg_stat_checkpointer'))[0];
  r.io=await q("SELECT backend_type,object,context,reads,writes,extends,op_bytes,read_time,write_time,fsyncs,fsync_time FROM pg_stat_io WHERE COALESCE(reads,0)+COALESCE(writes,0)+COALESCE(extends,0)>0");
  r.tables=await q("SELECT relname,n_tup_ins,n_tup_upd,n_tup_hot_upd,n_live_tup,n_dead_tup,autovacuum_count,vacuum_count,last_autovacuum FROM pg_stat_user_tables WHERE relname IN ('baseline_ofertas','gin_ofertas')");
  const exists=(await q("SELECT to_regclass('p2c_c_trgm') present"))[0].present;
  r.gin=exists?(await q("SELECT pg_relation_size('p2c_c_trgm') bytes,(SELECT row_to_json(g) FROM pgstatginindex('p2c_c_trgm') g) pending"))[0]:null;
  return r;
}
function localResources() {
  // Linux service container metrics are collected independently by CI observer.
  return {cpuMicros:process.cpuUsage(),rss:process.memoryUsage().rss,at:new Date().toISOString()};
}
async function fixture() {
  await q(`CREATE FUNCTION fixture_metadata(seed integer, entropy_bytes integer) RETURNS jsonb LANGUAGE SQL AS $$
   SELECT jsonb_build_object('produto',jsonb_build_object('id','MLB'||(100000000+seed)),
    'padding',repeat(substring(s from 1 for 512),72)||substring(s from 1 for entropy_bytes)) ||
    CASE WHEN seed%10=0 THEN jsonb_build_object('common_mlb','MLB900000006')
     WHEN seed%10=1 THEN jsonb_build_object('trigrams','MLB900000 900000007') ELSE '{}'::jsonb END
   FROM (SELECT string_agg(md5(seed::text||':'||j::text),'') s FROM generate_series(1,1600) j) x $$`);
  await q('CREATE TABLE calibration(m jsonb)');
  // Actual stored-column compression, NOT pg_column_size of a transient expression.
  const calibrations=[];
  for (const mode of [0,1,2]) for (const desired of [14500,19832,23199,26636,28926,46522]) {
    let entropy=Math.round(desired*.88), actual;
    for(let i=0;i<3;i++) {
      await q('TRUNCATE calibration');
      await q('INSERT INTO calibration SELECT fixture_metadata(j*10+$2,$1) FROM generate_series(1,8) j',[entropy,mode]);
      actual=Number((await q('SELECT avg(pg_column_size(m)) bytes FROM calibration'))[0].bytes);
      if(i<2) entropy=Math.max(1000,Math.min(50000,Math.round(entropy*desired/actual)));
    }
    calibrations.push({mode,desired,entropy,actual});
  }
  evidence.calibrations=calibrations; emit('compression_calibrated',{calibrations});
  await q(`CREATE TABLE baseline_ofertas(id bigint PRIMARY KEY,uuid uuid UNIQUE,evento_id bigint,link_id bigint,
   marketplace text,titulo text,titulo_normalizado text,preco numeric,preco_original numeric,moeda text,cupom text,tipo_cupom text,
   beneficio_extra text,imagem text,link_original text,link_expandido text,link_afiliado text,categoria text,score numeric,
   prioridade integer,origem text,status text,motivo_status text,metadata jsonb,capturada_em timestamptz,criada_em timestamptz,atualizada_em timestamptz)`);
  await q('ALTER TABLE baseline_ofertas ALTER COLUMN metadata SET COMPRESSION pglz');
  const breaks=[1109,Math.round(target.rows*.5)+20,Math.round(target.rows*.9)+20,Math.round(target.rows*.95)+20,Math.round(target.rows*.99)+20,target.rows];
  const picks=[0,1,2].map(mode=>{
    const cs=calibrations.filter(x=>x.mode===mode);
    return `round(CASE ${breaks.map((b,i)=>i===0?`WHEN i<=${b} THEN ${cs[i].entropy}`:
      `WHEN i<=${b} THEN ${cs[i-1].entropy} + (i-${breaks[i-1]})::numeric/(${b-breaks[i-1]}) * ${cs[i].entropy-cs[i-1].entropy}`).join(' ')} END)::integer`;
  });
  const pick=`CASE WHEN i%10=0 THEN ${picks[0]} WHEN i%10=1 THEN ${picks[1]} ELSE ${picks[2]} END`;
  const t=performance.now();
  await q(`INSERT INTO baseline_ofertas SELECT i,md5('uuid:'||i)::uuid,(i+2)/3,(i+2)/3,
   CASE WHEN (i*7919)%${target.rows}<${target.mlRows} THEN 'mercadolivre' ELSE 'amazon' END,
   'Produto sintetico para medicao sem dados reais '||i,'produto sintetico para medicao sem dados reais '||i,100,120,'BRL',
   NULL,'sem_cupom','fixture sintetica', 'https://fixture.invalid/images/official-product-'||md5(i::text)||'/image.jpg',
   'https://fixture.invalid/MLB'||(100000000+i),
   'https://fixture.invalid/expanded/'||md5(i::text)||'/product/MLB'||(100000000+i)||'?synthetic=1&variant=plain&classification=fixture-only',
   'https://fixture.invalid/aff/'||i,'categoria sintetica',i%40,i%40,'engine_importer','fila',NULL,
   fixture_metadata(i,${pick}),'2026-01-01'::timestamptz,'2026-01-01'::timestamptz,
   CASE WHEN i%97=0 THEN NULL ELSE '2026-01-01'::timestamptz+i*interval '1 second' END FROM generate_series(1,$1::int) i`,[target.rows]);
  // Adversarial fields are included BEFORE compression and calibrated separately.
  // No post-generation rewrite distorts stored-size quantiles or creates dead TOAST.
  const special=[
   [1000001,'MLB900000001',{},'2050-01-01','recent'],[1000002,'MLB900000002',{},'2000-01-01','old'],
   [1000003,'MLB900000003',{},'2050-02-01','tieA'],[1000004,'MLB900000003',{},'2050-02-01','tieB'],
   [1000005,'MLB900000003',{},null,'nullDate'],[1000006,null,{arbitrary:{note:'MLB900000004'}},'2027-01-01','meta'],
   [1000007,'MLB900000005',{},'2000-01-01','large'],[1000008,null,{MLB900000008:'metadata key'},'2027-01-01','key'],
   [1000009,'MLB900000007',{},'2027-01-01','falseCandidates'],[1000010,'mlb900000001',{},'2020-01-01','lower'],
   [1000011,'MLB900000001',{},'2060-01-01',' ']
  ];
  for(const [id,link,meta,date,img]of special) await q(`INSERT INTO baseline_ofertas(id,uuid,marketplace,link_original,metadata,atualizada_em,imagem)
   VALUES($1::bigint,md5('special:'||($1::bigint)::text)::uuid,'ml',$2,fixture_metadata(50,$3)||$4::jsonb,$5::timestamptz,$6)`,
   [id,link,calibrations[1].entropy,JSON.stringify(meta),date,img==='large'?'data:image/fixture,'+'x'.repeat(180000):img]);
  // Same 14 B-tree definitions (including duplicate uuid index), no ordering candidate.
  await q('CREATE UNIQUE INDEX baseline_uuid_duplicate ON baseline_ofertas(uuid)');
  for(const col of ['evento_id','link_id','marketplace','categoria','score','prioridade','status','capturada_em','titulo_normalizado','link_original','link_expandido'])
    await q(`CREATE INDEX baseline_${col} ON baseline_ofertas(${col})`);
  await q('ANALYZE baseline_ofertas');
  evidence.profiles.baseline=await profile('baseline_ofertas');
  evidence.fixtureGenerationMs=performance.now()-t;
  const shape=evidence.profiles.baseline.shape;
  assert(shape.pglz_rows/shape.rows>.99,'pglz required');
  assert(Math.abs(Number(shape.mean_bytes)/target.metadataMeanStoredBytes-1)<.15,'Stored mean mismatch >15%');
  shape.quantiles_bytes.forEach((x,i)=>assert(Math.abs(x/target.metadataQuantilesStoredBytes[i]-1)<.15,'Quantile mismatch >15%'));
  assert(Math.abs(shape.ml_rows/shape.rows-target.mlRows/target.rows)<.02,'ML ratio mismatch');
  const toastRatio=Number(evidence.profiles.baseline.sizes.toast_bytes)/target.toastBytes;
  assert(toastRatio>.7&&toastRatio<1.3,'TOAST mismatch >30%');
  evidence.representativeness={passedNumericGates:true,storedQuantileTolerance:.15,toastTolerance:.30,
   toastRatio,logicalVocabularyNotProven:true,mvccBloatNotCloned:true};
  await q('CREATE TABLE gin_ofertas (LIKE baseline_ofertas INCLUDING ALL)');
  await q('INSERT INTO gin_ofertas SELECT * FROM baseline_ofertas');
  await q('ANALYZE gin_ofertas');
  evidence.profiles.ginPreBuild=await profile('gin_ofertas');
  evidence.indexes=await q("SELECT relname,pg_get_indexdef(indexrelid) definition FROM pg_index JOIN pg_class ON oid=indrelid WHERE indrelid IN ('baseline_ofertas'::regclass,'gin_ofertas'::regclass)");
  emit('fixture_profile_pass',{shape,sizes:evidence.profiles.baseline.sizes});
}
const expected=new Map();
async function selects(strategy) {
  for(const v of variants) for(const c of cases) {
    const full=(await q(sql(strategy,v,true),params(v,c)));
    const head=await q(sql(strategy,v),params(v,c));
    assert.deepEqual(head,full.slice(0,1)); const key=v+':'+c.name;
    if(strategy==='baseline')expected.set(key,{full,head});
    else assert.deepEqual({full,head},expected.get(key),key+' full observable equivalence');
    const plans=[]; const reps=strategy==='baseline'?3:20;
    for(let i=0;i<reps;i++) plans.push((await q('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql(strategy,v),params(v,c)))[0]['QUERY PLAN'][0]);
    const ms=plans.map(metrics); const item={strategy,variant:v,case:c.name,setCount:full.length,
      executionMs:quantiles(ms.map(x=>x.executionMs)),planningMs:quantiles(ms.map(x=>x.planningMs)),metrics:ms,plans};
    evidence.benchmarks.push(item);emit('select_case',{strategy,variant:v,case:c.name,setCount:full.length,timing:item.executionMs,plan:ms[0]});
  }
  evidence.equivalence[strategy]={cases:20,fullSetsAndSelectedRows:true,passed:true};
}
async function writes(strategy) {
  const table=strategy+'_ofertas';
  // Production importer writes ONE row plus a separate metadata update; distributor also updates status.
  // Batch10 and concurrency4 are labelled burst sensitivity, not claimed observed production batching.
  for(const operation of ['insert','metadata_update','status_update']) for(const batch of [1,10]) for(const concurrency of [1,4]) {
    const before=await cluster(),resourcesBefore=localResources(),samples=[];const t=performance.now();
    let next=0;
    await Promise.all(Array.from({length:concurrency},async(_,w)=>{
      const c=await pool.connect();
      try { while(true) {
        const rep=next++;if(rep>=100)break;
        // Spread writes through the ENTIRE distribution, not just smallest first 1,000 rows.
        const from=1+Math.floor(rep*(target.rows-batch)/100);
        const newId=2000000+operation.length*100000+batch*10000+concurrency*1000+rep*batch;
        const begin=performance.now();await c.query('BEGIN');
        try {
          if(operation==='insert') await c.query(`INSERT INTO ${table} SELECT
            $3::bigint+(id-$1::bigint),md5('write:'||($3::bigint)::text||':'||id)::uuid,evento_id,link_id,marketplace,titulo,titulo_normalizado,
            preco,preco_original,moeda,cupom,tipo_cupom,beneficio_extra,imagem,link_original,link_expandido,link_afiliado,
            categoria,score,prioridade,origem,status,motivo_status,metadata,capturada_em,criada_em,atualizada_em
            FROM ${table} WHERE id BETWEEN $1 AND $2`,[from,from+batch-1,newId]);
          else if(operation==='metadata_update') await c.query(`UPDATE ${table} SET
            metadata=metadata||jsonb_build_object('write_probe',id::text||':'||$3::text),
            link_expandido=link_expandido||'?probe='||$3::text,atualizada_em=NOW() WHERE id BETWEEN $1 AND $2`,[from,from+batch-1,concurrency]);
          else await c.query(`UPDATE ${table} SET status='processada',motivo_status='synthetic',atualizada_em=NOW() WHERE id BETWEEN $1 AND $2`,[from,from+batch-1]);
          const preCommit=performance.now();await c.query('COMMIT');
          samples.push({rep,worker:w,dmlMs:preCommit-begin,commitMs:performance.now()-preCommit,totalMs:performance.now()-begin});
        } catch(e) {await c.query('ROLLBACK');throw e;}
      }} finally {c.release();}
    }));
    const wallMs=performance.now()-t;
    await q('SELECT pg_sleep(1.1)'); // Disposable stats publication, not a production wait.
    const after=await cluster();
    const walBytes=Number((await q('SELECT pg_wal_lsn_diff($1::pg_lsn,$2::pg_lsn) bytes',[after.lsn,before.lsn]))[0].bytes);
    const item={strategy,operation,batch,concurrency,transactions:samples.length,rows:samples.length*batch,
      wallMs,rowsPerSecond:samples.length*batch/(wallMs/1000),latencyMs:quantiles(samples.map(x=>x.totalMs)),
      commitMs:quantiles(samples.map(x=>x.commitMs)),dmlMs:quantiles(samples.map(x=>x.dmlMs)),walBytes,
      walBytesPerRow:walBytes/(samples.length*batch),before,after,samples,resourcesBefore,resourcesAfter:localResources()};
    assert.equal(samples.length,100);evidence.writes.push(item);
    emit('durable_write_case',{strategy,operation,batch,concurrency,wallMs,latencyMs:item.latencyMs,commitMs:item.commitMs,walBytes,pending:after.gin});
  }
}
async function visibility() {
  const other=await pool.connect();
  try {
    const c={mlb:'MLB988888888',exclude:4000000};
    assert.deepEqual(await q(sql('gin','canonical'),params('canonical',c)),[]);
    for(const table of ['baseline_ofertas','gin_ofertas']) {
      await other.query('BEGIN');await other.query(`INSERT INTO ${table}(id,marketplace,imagem,metadata,atualizada_em)
       VALUES(4000000,'ml','synthetic later image','{"id":"MLB988888888"}', '2070-01-01')`);await other.query('COMMIT');
    }
    const a=await q(sql('baseline','canonical'),params('canonical',c)),b=await q(sql('gin','canonical'),params('canonical',c));
    assert.equal(a[0].id,'4000000');assert.deepEqual(a,b);
    assert.deepEqual(await q(sql('gin','importer'),params('importer',c)),[]);
    evidence.equivalence.laterCommit={canonicalSeesLaterPersistence:true,importerExclusionPreserved:true};
  }finally{other.release();}
}
async function main() {
  client=await pool.connect();
  try {
    evidence.environment=(await q(`SELECT current_database() database,current_setting('server_version') version,
      current_setting('server_version_num')::int version_num,(SELECT datcollate FROM pg_database WHERE datname=current_database()) collation,
      current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('work_mem') work_mem,
      current_setting('shared_buffers') shared_buffers,current_setting('default_toast_compression') compression`))[0];
    assert.equal(Math.floor(evidence.environment.version_num/10000),17);
    assert.equal(evidence.environment.database,'p2c_disposable_representative');
    assert.equal(evidence.environment.fsync,'on');assert.equal(evidence.environment.synchronous_commit,'on');
    assert.equal((await q("SELECT to_regclass('baseline_ofertas') present"))[0].present,null);
    await q("SET work_mem='4MB'");await q("SET maintenance_work_mem='64MB'");
    await q('CREATE EXTENSION pg_trgm');await q('CREATE EXTENSION pgstattuple');
    await fixture();
    evidence.equivalence.expression=(await q(`SELECT count(*)::int rows,count(*) FILTER(WHERE
     convert_to(${originalText},'UTF8') IS DISTINCT FROM convert_to(${immutableText},'UTF8'))::int differences FROM baseline_ofertas`))[0];
    assert.equal(evidence.equivalence.expression.differences,0);
    await selects('baseline');
    const before=await cluster(),t=performance.now();
    // Actual CONCURRENTLY outside transaction, no fake immutable wrapper.
    await q(`CREATE INDEX CONCURRENTLY p2c_c_trgm ON gin_ofertas USING gin(UPPER(${immutableText}) gin_trgm_ops) WHERE ${common}`);
    evidence.build={wallMs:performance.now()-t,before,after:await cluster(),index:(await q(`SELECT pg_relation_size(indexrelid) bytes,
     indisvalid,indisready,pg_get_indexdef(indexrelid) definition FROM pg_index WHERE indexrelid='p2c_c_trgm'::regclass`))[0]};
    assert(evidence.build.index.indisvalid&&evidence.build.index.indisready);
    emit('gin_concurrent_build',evidence.build.index);
    await selects('gin');await visibility();
    // Broad bitmap/recheck diagnostic only: natural plan remains authoritative benchmark.
    await q('SET enable_seqscan=off');
    evidence.forcedBitmapDiagnostic=(await q('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql('gin','canonical'),['MLB1']))[0]['QUERY PLAN'][0];
    await q('RESET enable_seqscan');
    await writes('baseline');await writes('gin');
    const beforeVacuum=await cluster(),vt=performance.now();
    await q('VACUUM (ANALYZE) gin_ofertas');
    evidence.vacuum={before:beforeVacuum,wallMs:performance.now()-vt,after:await cluster(),isolatedOnly:true};
    evidence.profiles.finalBaseline=await profile('baseline_ofertas');evidence.profiles.finalGin=await profile('gin_ofertas');
    evidence.status='passed';evidence.finishedUTC=new Date().toISOString();emit('proof_complete');
  }finally{client.release();await pool.end();}
}
main().catch(async e=>{evidence.status='failed';evidence.failure={name:e.name,message:e.message,code:e.code};save();
 console.error(e.stack);process.exitCode=1;if(!client)await pool.end();});
