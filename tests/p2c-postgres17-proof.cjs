/* P2C-B isolated proof only: never imported by production. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const pg = require(process.env.P2C_PG_MODULE || 'pg');
const url = new URL(process.env.P2C_TEST_DATABASE_URL || 'invalid://not-configured');
assert.equal(process.env.P2C_ISOLATED_ACK, 'disposable-synthetic-only');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback database only');
assert(/^\/p2c_disposable_[a-z0-9_]+$/.test(url.pathname), 'Disposable database name required');
assert(!process.env.DATABASE_URL, 'No application DATABASE_URL allowed');
const ROWS = Number(process.env.P2C_ROWS || 61000);
const REPS = Number(process.env.P2C_REPETITIONS || 3);
assert(ROWS >= 61000 && ROWS <= 100000);
assert(REPS >= 3 && REPS <= 10);
const outDir = process.env.P2C_EVIDENCE_DIR || path.join(__dirname, 'evidence');
fs.mkdirSync(outDir, { recursive: true });
const evidence = { status: 'running', synthetic: true, rowsRequested: ROWS, repetitions: REPS,
  startedAt: new Date().toISOString(), equivalence: {}, builds: [], benchmarks: [], writes: [],
  limitations: ['Synthetic database, not a production clone; distribution is deliberately adversarial.',
    'Repeated natural-planner warm/mixed-cache measurements, not controlled cold-cache measurements.',
    'Buffers are block counters, not physical device bytes. Accumulated worker operations are not wall time.',
    'Write probes use rollback; measure execution/index maintenance, not durable COMMIT latency.',
    'Synthetic schema has eight production-style B-trees plus primary key, not all fourteen production indexes.',
    'GIN indexes the metadata route; the no-metadata compatibility route is measured separately and may scan.',
    'Whole-dataset identity audit covers every row and extracted token; not every possible arbitrary LIKE parameter.',
    'Results do not authorize production DDL, code, backfill or feature changes.'] };
function save() {
  fs.writeFileSync(path.join(outDir, 'proof.json'), JSON.stringify(evidence, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY && evidence.status !== 'running') {
    const compact = { ...evidence,
      benchmarks: evidence.benchmarks.map(({ plans, ...rest }) => rest),
      writes: evidence.writes.map(({ plans, ...rest }) => rest) };
    fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY, '# P2C disposable PostgreSQL evidence\n\n```json\n' + JSON.stringify(compact, null, 2) + '\n```\n');
  }
}
function emit(phase, extra = {}) { console.log(JSON.stringify({ phase, at: new Date().toISOString(), ...extra })); save(); }
const pool = new pg.Pool({ connectionString: url.toString(), ssl: false, max: 2,
  connectionTimeoutMillis: 5000, statement_timeout: 600000, query_timeout: 610000 });
pool.on('error', e => { evidence.poolError = { code: e.code || '', message: 'isolated pool error' }; save(); });
let client;
const common = `NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
  AND LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml', 'mercadolivre')`;
const order = 'atualizada_em DESC NULLS LAST, id DESC';
function textExpr(meta = true) {
  // Last argument of original CONCAT_WS is ALWAYS non-NULL, including the no-metadata route.
  return `((CASE WHEN link_original IS NULL THEN '' ELSE link_original || ' ' END) ||
    (CASE WHEN link_expandido IS NULL THEN '' ELSE link_expandido || ' ' END) ||
    (CASE WHEN link_afiliado IS NULL THEN '' ELSE link_afiliado || ' ' END) || ${meta ? "COALESCE(metadata::text, '')" : "''"})`;
}
function baselineText(meta = true) {
  return `CONCAT_WS(' ', link_original, link_expandido, link_afiliado, ${meta ? "COALESCE(metadata::text, '')" : "''"})`;
}
function identityExpr(expression = baselineText()) {
  return `CASE WHEN substring(UPPER(${expression}) from 'MLB-?([0-9]{6,})') IS NULL THEN NULL
    ELSE 'MLB'||substring(UPPER(${expression}) from 'MLB-?([0-9]{6,})') END`;
}
const variants = [{ name: 'canonical', exclude: false, meta: true },
  { name: 'importer', exclude: true, meta: true }, { name: 'importer_no_metadata', exclude: true, meta: false }];
const cases = [
  { name: 'recent', mlb: 'MLB900000001', exclude: 1000001 },
  { name: 'old', mlb: 'MLB900000002', exclude: 0 },
  { name: 'miss', mlb: 'MLB999999999', exclude: 0 },
  { name: 'multiple_and_tie', mlb: 'MLB900000003', exclude: 1000004 },
  { name: 'metadata_only', mlb: 'MLB900000004', exclude: 0 },
  { name: 'hyphen_only', mlb: 'MLB900000005', exclude: 0 },
  { name: 'substring_prefix', mlb: 'MLB900000006', exclude: 0 },
  { name: 'two_id_sources', mlb: 'MLB900000007', exclude: 0 },
  { name: 'metadata_key', mlb: 'MLB900000008', exclude: 0 },
  { name: 'different_parameter', mlb: 'MLB900000009', exclude: 0 }
];
function query(strategy, variant, all = false, table = 'engine_ofertas') {
  const expression = strategy === 'gin' ? textExpr(variant.meta) : baselineText(variant.meta);
  // Structured identity is intentionally tested as a DIFFERENT candidate, not assumed equivalent.
  const match = strategy === 'structured' ? 'mlb_identity = $1' : `UPPER(${expression}) LIKE '%' || $1 || '%'`;
  return `SELECT id, imagem FROM ${table} WHERE ${variant.exclude ? 'id <> $2 AND ' : ''}${common}
    AND ${match} ORDER BY ${order}${all ? '' : ' LIMIT 1'}`;
}
function params(v, c) { return v.exclude ? [c.mlb, c.exclude] : [c.mlb]; }
function stats(a) { const s = [...a].sort((x, y) => x - y); return { min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) }; }
function planMetrics(root) {
  const scans = [], sorts = [];
  function walk(n) {
    if (/Scan/.test(n['Node Type'])) scans.push({ type: n['Node Type'], parallel: n['Parallel Aware'], index: n['Index Name'],
      rows: n['Actual Rows'], loops: n['Actual Loops'], removed: n['Rows Removed by Filter'] || 0,
      removedRecheck: n['Rows Removed by Index Recheck'] || 0,
      approximateVisited: ((n['Actual Rows'] || 0) + (n['Rows Removed by Filter'] || 0)) * (n['Actual Loops'] || 1) });
    if (n['Node Type'] === 'Sort') sorts.push({ method: n['Sort Method'], space: n['Sort Space Used'], type: n['Sort Space Type'] });
    (n.Plans || []).forEach(walk);
  }
  walk(root.Plan);
  return { executionMs: root['Execution Time'], planningMs: root['Planning Time'], scans, sorts,
    buffers: { sharedHit: root.Plan['Shared Hit Blocks'] || 0, sharedRead: root.Plan['Shared Read Blocks'] || 0,
      sharedDirtied: root.Plan['Shared Dirtied Blocks'] || 0, sharedWritten: root.Plan['Shared Written Blocks'] || 0,
      tempRead: root.Plan['Temp Read Blocks'] || 0, tempWritten: root.Plan['Temp Written Blocks'] || 0 },
    seqScan: scans.some(x => x.type === 'Seq Scan') };
}
async function explain(sql, args = []) {
  const r = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, args);
  return r.rows[0]['QUERY PLAN'][0];
}
async function expressionProof() {
  // Cartesian product: exact byte equality, not merely LIKE equivalence.
  const sql = `WITH vals(v) AS (VALUES (NULL::text),(''),('x'),(' '),('MLB900000001'),('mlb-900000001'),
    ('ação İ ß'),('x'||chr(9)||'y'),('a'||chr(10)||'b'),('https://fixture.invalid/p/MLB900000001?q=x')),
  metas(v) AS (VALUES (NULL::jsonb),('null'::jsonb),('{}'::jsonb),('[]'::jsonb),
    ('""'::jsonb),('"MLB900000001"'::jsonb),('{"MLB900000008":"ação"}'::jsonb),
    ('{"nested":[null,"",{"id":"MLB900000001"}]}'::jsonb))
  SELECT count(*)::int AS combinations,
    count(*) FILTER (WHERE convert_to(${baselineText()},'UTF8') IS DISTINCT FROM convert_to(${textExpr()},'UTF8'))::int AS differences,
    count(*) FILTER (WHERE convert_to(${baselineText(false)},'UTF8') IS DISTINCT FROM convert_to(${textExpr(false)},'UTF8'))::int AS no_metadata_differences
  FROM vals a CROSS JOIN vals b CROSS JOIN vals c CROSS JOIN metas m,
  LATERAL (SELECT a.v AS link_original,b.v AS link_expandido,c.v AS link_afiliado,m.v AS metadata) fields`;
  evidence.equivalence.cartesian = (await client.query(sql)).rows[0];
  assert.equal(evidence.equivalence.cartesian.differences, 0);
  assert.equal(evidence.equivalence.cartesian.no_metadata_differences, 0);
  evidence.volatility = (await client.query(`SELECT oid::regprocedure::text AS signature,provolatile
    FROM pg_proc WHERE oid IN ('textcat(text,text)'::regprocedure,'upper(text)'::regprocedure,'jsonb_out(jsonb)'::regprocedure,
    'concat_ws(text,"any")'::regprocedure)`)).rows;
  for (const x of evidence.volatility) if (!x.signature.startsWith('concat_ws')) assert.equal(x.provolatile, 'i');
  assert.equal(evidence.volatility.find(x => x.signature.startsWith('concat_ws')).provolatile, 's');
  evidence.exactSql = variants.map(v => ({ variant: v.name, baseline: query('baseline', v),
    gin: query('gin', v), structured: query('structured', v) }));
  emit('expression_byte_equivalence_pass');
}
async function fixtures() {
  await client.query(`CREATE TABLE engine_ofertas (
    id bigint PRIMARY KEY, marketplace text, titulo text, titulo_normalizado text, preco numeric, preco_original numeric,
    cupom text, imagem text, link_original text, link_expandido text, link_afiliado text, categoria text,
    prioridade integer, status text, metadata jsonb, capturada_em timestamptz, criada_em timestamptz, atualizada_em timestamptz)`);
  // Per-row pseudo-entropy (~20KiB), then repeats to ~56KiB logical JSON. No network or real data.
  const start = performance.now();
  await client.query(`INSERT INTO engine_ofertas
    SELECT i, CASE WHEN i%10=0 THEN 'amazon' WHEN i%3=0 THEN ' Mercado_Livre ' ELSE 'ml' END,
    'Fixture '||i,'fixture '||i,100,120,NULL,
    CASE WHEN i%29=0 THEN ' ' WHEN i%31=0 THEN NULL ELSE 'https://fixture.invalid/image/'||i END,
    CASE WHEN i%11=0 THEN NULL ELSE 'https://fixture.invalid/MLB'||(100000000+i) END,
    CASE WHEN i%13=0 THEN '' ELSE 'https://fixture.invalid/p/MLB'||(100000000+i) END,
    CASE WHEN i%17=0 THEN NULL ELSE 'https://fixture.invalid/aff/'||i END,'fixture',1,'fila',
    CASE WHEN i%101=0 THEN NULL ELSE jsonb_build_object('produto',jsonb_build_object('id','MLB'||(100000000+i)),
      'padding', substring(repeat(entropy.s,3) from 1 for 56000)) END,
    '2026-01-01'::timestamptz,'2026-01-01'::timestamptz,
    CASE WHEN i%97=0 THEN NULL ELSE '2026-01-01'::timestamptz + i*interval '1 second' END
    FROM generate_series(1,$1::int) i
    CROSS JOIN LATERAL (SELECT string_agg(md5(i::text||':'||j::text),'') AS s FROM generate_series(1,650) j) entropy`, [ROWS]);
  const specials = [
    [1000001, 'MLB900000001', null, null, {}, '2050-01-01', 'https://fixture.invalid/recent'],
    [1000002, 'MLB900000002', null, null, {}, '2000-01-01', 'https://fixture.invalid/old'],
    [1000003, 'MLB900000003', null, null, {}, '2050-02-01', 'https://fixture.invalid/tieA'],
    [1000004, 'MLB900000003', null, null, {}, '2050-02-01', 'https://fixture.invalid/tieB'],
    [1000005, 'MLB900000003', null, null, {}, null, 'https://fixture.invalid/nullDate'],
    [1000006, null, '', null, { arbitrary: { note: 'MLB900000004' } }, '2027-01-01', 'https://fixture.invalid/meta'],
    [1000007, 'MLB-900000005', null, null, {}, '2027-01-02', 'https://fixture.invalid/hyphen'],
    [1000008, 'MLB9000000060', null, null, {}, '2027-01-03', 'https://fixture.invalid/prefix'],
    [1000009, 'MLB900000099', 'MLB900000007', null, { id: 'MLB900000009' }, '2027-01-04', 'https://fixture.invalid/multipleIDs'],
    [1000010, null, '', null, { MLB900000008: 'metadata key' }, '2027-01-05', 'https://fixture.invalid/key'],
    [1000011, null, '', null, {}, '2027-01-06', 'https://fixture.invalid/noId'],
    [1000012, 'mlb900000001', null, null, null, '2020-01-01', 'https://fixture.invalid/case'],
    [1000013, 'MLB900000001', null, null, {}, '2060-01-01', ' ']
  ];
  for (const r of specials) await client.query(`INSERT INTO engine_ofertas
    (id,marketplace,link_original,link_expandido,link_afiliado,metadata,atualizada_em,imagem)
    VALUES($1,'ml',$2,$3,$4,$5::jsonb,$6::timestamptz,$7)`, r.map((v, i) => i === 4 ? JSON.stringify(v) : v));
  // Existing production-style simple B-trees: these do not index the search expression.
  for (const col of ['marketplace', 'link_original', 'link_expandido', 'categoria', 'status', 'prioridade', 'titulo_normalizado', 'capturada_em'])
    await client.query(`CREATE INDEX fixture_${col} ON engine_ofertas (${col})`);
  await client.query('ANALYZE engine_ofertas');
  evidence.equivalence.wholeCorpusExpression = (await client.query(`SELECT count(*)::int AS checked,
    count(*) FILTER(WHERE convert_to(${baselineText()},'UTF8') IS DISTINCT FROM convert_to(${textExpr()},'UTF8'))::int AS differences,
    count(*) FILTER(WHERE convert_to(${baselineText(false)},'UTF8') IS DISTINCT FROM convert_to(${textExpr(false)},'UTF8'))::int AS no_metadata_differences
    FROM engine_ofertas`)).rows[0];
  assert.equal(evidence.equivalence.wholeCorpusExpression.differences, 0);
  assert.equal(evidence.equivalence.wholeCorpusExpression.no_metadata_differences, 0);
  evidence.fixture = { generationMs: performance.now() - start,
    shape: (await client.query(`SELECT count(*)::int AS rows,
      avg(pg_column_size(metadata)) AS avg_stored_metadata_bytes,
      avg(octet_length(metadata::text)) AS avg_text_metadata_bytes,
      count(*) FILTER(WHERE pg_column_compression(metadata)='pglz') AS compressed_pglz FROM engine_ofertas`)).rows[0],
    sizes: (await client.query(`SELECT pg_relation_size('engine_ofertas') AS heap_bytes,
      pg_table_size('engine_ofertas') AS table_bytes,pg_indexes_size('engine_ofertas') AS indexes_bytes,
      pg_total_relation_size('engine_ofertas') AS total_bytes,
      pg_total_relation_size(reltoastrelid) AS toast_bytes FROM pg_class WHERE oid='engine_ofertas'::regclass`)).rows[0] };
  emit('fixtures_generated', { rows: evidence.fixture.shape.rows });
}
const expected = new Map();
async function benchmark(strategy) {
  const mismatches = [];
  for (const v of variants) for (const c of cases) {
    const key = v.name + ':' + c.name;
    const set = (await client.query(query(strategy, v, true), params(v, c))).rows;
    const chosen = (await client.query(query(strategy, v), params(v, c))).rows;
    assert.deepEqual(chosen, set.slice(0, 1), 'ORDER BY/LIMIT must select same head');
    if (strategy === 'baseline') expected.set(key, { set, chosen });
    else if (strategy === 'structured') {
      if (JSON.stringify(set) !== JSON.stringify(expected.get(key).set) || JSON.stringify(chosen) !== JSON.stringify(expected.get(key).chosen))
        mismatches.push({ variant: v.name, case: c.name, baselineCount: expected.get(key).set.length,
          candidateCount: set.length, chosenEqual: JSON.stringify(chosen) === JSON.stringify(expected.get(key).chosen) });
    } else { assert.deepEqual(set, expected.get(key).set, key + ' full set'); assert.deepEqual(chosen, expected.get(key).chosen, key + ' chosen'); }
    const plans = [];
    for (let rep = 0; rep < REPS; rep++) plans.push(await explain(query(strategy, v), params(v, c)));
    const metrics = plans.map(planMetrics);
    const r = { strategy, variant: v.name, case: c.name, setCount: set.length, chosen, metrics,
      executionMs: stats(metrics.map(x => x.executionMs)), planningMs: stats(metrics.map(x => x.planningMs)), plans };
    evidence.benchmarks.push(r);
    emit('benchmark_case', { strategy, variant: v.name, case: c.name, executionMs: r.executionMs,
      scans: metrics[0].scans, sort: metrics[0].sorts });
  }
  evidence.equivalence[strategy] = { checkedCases: variants.length * cases.length, mismatches,
    equivalent: mismatches.length === 0, fullSetsAndChosen: true };
}
async function build(name, ddl) {
  const t = performance.now(); await client.query(ddl); const ms = performance.now() - t;
  const index = (await client.query(`SELECT pg_relation_size(indexrelid) AS bytes,indisvalid,indisready,
    pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid=$1::regclass`, [name])).rows[0];
  assert.equal(index.indisvalid, true); assert.equal(index.indisready, true);
  evidence.builds.push({ name, wallMs: ms, ...index }); emit('index_built', { name, ms, bytes: index.bytes });
}
async function writeProbe(strategy) {
  for (const operation of ['insert', 'update']) {
    const times = [], plans = [];
    for (let rep = 0; rep < REPS; rep++) {
      await client.query('BEGIN');
      try {
        const structured = strategy === 'structured';
        const updatedMetadata = "COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('write_probe',id::text)";
        const updatedText = `CONCAT_WS(' ',link_original,COALESCE(link_expandido,'')||'?probe=1',link_afiliado,COALESCE((${updatedMetadata})::text,''))`;
        const sql = operation === 'insert' ? `INSERT INTO engine_ofertas
          (id,marketplace,imagem,link_original,link_expandido,link_afiliado,metadata,atualizada_em${structured ? ',mlb_identity' : ''})
          SELECT 2000000+id,marketplace,imagem,link_original,link_expandido,link_afiliado,metadata,atualizada_em${structured ? ',' + identityExpr() : ''}
          FROM engine_ofertas WHERE id BETWEEN 1 AND 100` : `UPDATE engine_ofertas
          SET metadata=${updatedMetadata},
          link_expandido=COALESCE(link_expandido,'')||'?probe=1',atualizada_em=atualizada_em+interval '1 second'
          ${structured ? ',mlb_identity=' + identityExpr(updatedText) : ''}
          WHERE id BETWEEN 1 AND 100`;
        const t = performance.now(); const plan = await explain(sql); times.push(performance.now() - t); plans.push(plan);
      } finally { await client.query('ROLLBACK'); }
    }
    evidence.writes.push({ strategy, operation, rowsPerProbe: 100, roundTripMs: stats(times),
      executionMs: stats(plans.map(p => p['Execution Time'])), plans,
      note: 'Same source IDs/100 rows; rollback, existing index residue/cache can affect repeats; no durable commit comparison.' });
    emit('write_probe', { strategy, operation, executionMs: evidence.writes.at(-1).executionMs });
  }
}
async function identityProof() {
  const t = performance.now();
  await client.query('ALTER TABLE engine_ofertas ADD COLUMN mlb_identity text');
  await client.query(`UPDATE engine_ofertas SET mlb_identity = ${identityExpr()}`);
  evidence.identity = { extractionMs: performance.now() - t, definition: 'first MLB token in links then metadata, optional hyphen normalized',
    population: (await client.query(`WITH f AS (SELECT *,
      LOWER(REGEXP_REPLACE(COALESCE(marketplace,''),'[[:space:]_-]+','','g')) IN ('ml','mercadolivre') AS ml,
      UPPER(CONCAT_WS(' ',link_original,link_expandido,link_afiliado)) ~ 'MLB-?[0-9]{6,}' AS links_id,
      UPPER(COALESCE(metadata::text,'')) ~ 'MLB-?[0-9]{6,}' AS meta_id FROM engine_ofertas)
      SELECT count(*)::int AS all_rows,count(*) FILTER(WHERE ml)::int AS ml_rows,
      count(*) FILTER(WHERE ml AND mlb_identity IS NOT NULL)::int AS ml_extractable,
      count(*) FILTER(WHERE ml AND mlb_identity IS NULL)::int AS ml_unextractable,
      count(*) FILTER(WHERE ml AND links_id AND NOT meta_id)::int AS ml_links_only,
      count(*) FILTER(WHERE ml AND NOT links_id AND meta_id)::int AS ml_metadata_only,
      count(*) FILTER(WHERE ml AND links_id AND meta_id)::int AS ml_both,
      count(*) FILTER(WHERE ml AND NOT links_id AND NOT meta_id)::int AS ml_neither FROM f`)).rows[0],
    allRowMembership: (await client.query(`SELECT count(*)::int AS rows,
      count(*) FILTER(WHERE mlb_identity IS NOT NULL AND
        UPPER(${baselineText()}) NOT LIKE '%'||mlb_identity||'%')::int AS normalized_identity_not_a_textual_match
      FROM engine_ofertas`)).rows[0] };
  // Enumerate ALL observed tokens in the FULL isolated dataset, not just the selected benchmark cases.
  await client.query(`CREATE TABLE p2c_tokens AS SELECT DISTINCT 'MLB'||r[1] AS mlb
    FROM engine_ofertas CROSS JOIN LATERAL regexp_matches(UPPER(${baselineText()}),'MLB-?([0-9]{6,})','g') AS r`);
  // A second token differs from first identity; the exact original predicate still must match it.
  evidence.identity.fullTokenDivergence = (await client.query(`SELECT count(*)::int AS rows_checked,
    count(*) FILTER(WHERE cardinality(tokens.ids)>1)::int AS rows_multiple_extracted_ids,
    count(*) FILTER(WHERE EXISTS (SELECT 1 FROM unnest(tokens.ids) t
      WHERE t IS DISTINCT FROM e.mlb_identity AND UPPER(${baselineText()}) LIKE '%'||t||'%'))::int AS rows_with_missing_secondary_textual_match
    FROM engine_ofertas e CROSS JOIN LATERAL (SELECT array_agg(DISTINCT 'MLB'||r[1]) AS ids
      FROM regexp_matches(UPPER(${baselineText()}),'MLB-?([0-9]{6,})','g') r) tokens`)).rows[0];
  // Prefix matching semantics yield valid shorter query IDs too; exact identity equality cannot cover them.
  evidence.identity.tokenCount = Number((await client.query('SELECT count(*) AS n FROM p2c_tokens')).rows[0].n);
  evidence.identity.fullPrefixAudit = (await client.query(`SELECT count(*)::int AS rows_checked,
    count(*) FILTER(WHERE EXISTS (SELECT 1 FROM regexp_matches(UPPER(${baselineText()}),'MLB([0-9]{7,})','g') r
      WHERE 'MLB'||left(r[1],length(r[1])-1) IS DISTINCT FROM mlb_identity
        AND UPPER(${baselineText()}) LIKE '%'||('MLB'||left(r[1],length(r[1])-1))||'%'))::int AS rows_matching_shorter_identity
    FROM engine_ofertas`)).rows[0];
  evidence.identity.additionalHeapBytes = (await client.query("SELECT pg_relation_size('engine_ofertas') AS bytes")).rows[0].bytes;
  await client.query('ANALYZE engine_ofertas'); emit('full_dataset_identity_audited', evidence.identity.population);
}
async function visibilityProof() {
  const other = await pool.connect();
  const v = variants.find(x => x.name === 'canonical');
  const c = { mlb: 'MLB988888888', exclude: 0 };
  try {
    assert.deepEqual((await client.query(query('gin', v), params(v, c))).rows, []);
    await other.query(`INSERT INTO engine_ofertas(id,marketplace,imagem,metadata,atualizada_em)
      VALUES(3000000,'ml','https://fixture.invalid/concurrent','{"id":"MLB988888888"}', '2070-01-01')`);
    const legacy = (await client.query(query('baseline', v), params(v, c))).rows;
    const candidate = (await client.query(query('gin', v), params(v, c))).rows;
    assert.equal(legacy[0].id, '3000000'); assert.deepEqual(candidate, legacy);
    const excluded = (await client.query(query('gin', variants[1]), ['MLB988888888', 3000000])).rows;
    assert.deepEqual(excluded, []);
    evidence.equivalence.visibility = { separateCommittedWriter: true, canonicalSeesLaterPersistence: true, importerExclusionIntact: true };
  } finally { other.release(); }
  emit('later_commit_visibility_pass');
}
async function main() {
  client = await pool.connect();
  try {
    const env = (await client.query(`SELECT current_database() AS database,current_setting('server_version') AS version,
      current_setting('server_version_num')::int AS version_num,current_setting('lc_collate') AS collation,
      current_setting('shared_buffers') AS shared_buffers,current_setting('work_mem') AS work_mem,
      current_setting('max_parallel_workers_per_gather') AS parallel_workers`)).rows[0];
    assert.equal(Math.floor(env.version_num / 10000), 17); assert(/^p2c_disposable_/.test(env.database));
    assert.equal((await client.query("SELECT to_regclass('public.engine_ofertas') AS rel")).rows[0].rel, null, 'Fresh database required');
    evidence.environment = env; emit('isolated_postgres17_confirmed');
    await expressionProof(); await fixtures();
    await benchmark('baseline'); await writeProbe('baseline');
    await build('p2c_ordering', `CREATE INDEX CONCURRENTLY p2c_ordering ON engine_ofertas (${order}) WHERE ${common}`);
    await benchmark('btree'); await writeProbe('btree');
    await client.query('DROP INDEX p2c_ordering'); // Only fixture index, disposable guard already verified.
    await client.query('CREATE EXTENSION pg_trgm');
    await build('p2c_trgm', `CREATE INDEX CONCURRENTLY p2c_trgm ON engine_ofertas USING gin (UPPER(${textExpr()}) gin_trgm_ops) WHERE ${common}`);
    await benchmark('gin'); await writeProbe('gin'); await visibilityProof();
    await client.query('DROP INDEX p2c_trgm');
    await client.query('DELETE FROM engine_ofertas WHERE id=3000000');
    await identityProof();
    await build('p2c_identity', `CREATE INDEX CONCURRENTLY p2c_identity ON engine_ofertas (mlb_identity,${order}) WHERE ${common}`);
    await benchmark('structured'); await writeProbe('structured');
    assert(evidence.equivalence.structured.mismatches.length > 0, 'Adversarial data must expose identity inequality');
    evidence.status = 'passed'; evidence.finishedAt = new Date().toISOString();
    evidence.conclusion = 'B-tree and immutable-expression GIN must have identical sets/chosen rows; structured substitution is NOT equivalent.';
    emit('proof_complete');
  } finally { client.release(); await pool.end(); }
}
main().catch(async e => { evidence.status = 'failed'; evidence.failure = { name: e.name, message: e.message, code: e.code || '' }; save(); console.error(e.stack);
  if (process.env.GITHUB_ACTIONS) console.error('::error title=P2C isolated proof failure::' + String(e.message).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
  process.exitCode = 1;
  if (!client) await pool.end(); });
