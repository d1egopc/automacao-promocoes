"use strict";

// Shared disposable schema is required: PostgreSQL TEMP tables are invisible to a second worker.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Client } = require("pg");
const processor = require("../modules/engine/processor.service");
const validator = require("../modules/engine/validator.service");
const importer = require("../modules/engine/importer/importer.service");
const processorFairness = require("../modules/engine/processor-fairness.service");
const validatorFairness = require("../modules/engine/validator-fairness.service");
const importerFairness = require("../modules/engine/importer/importer-fairness.service");
const { terminalizarJobsPreImporter } = require("../modules/engine/terminalizer-pre-importer.service");
const { buscarReposicaoGrupoPreImporter } = require("../modules/engine/fairness-slot-pre-importer.service");
const { calcularCotasFrescorPreImporter, sqlFrescorComercialPreImporter,
  sqlRetryPreImporter } = require("../modules/engine/frescor-pre-importer.service");

const root = path.resolve(__dirname, "..");
const schema = "universal_flow_multiworker_local";
const connection = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };

async function importerSql(limite, marketplace = "mercadolivre") {
  const source = fs.readFileSync(path.join(root, "modules/engine/importer/importer.service.js"), "utf8");
  const start = source.indexOf("async function buscarJobsProntos(");
  const end = source.indexOf("function removerCamposInternosCandidatePoolImporter(", start);
  assert(start >= 0 && end > start);
  const captured = [];
  const context = {
    queryEngine: async (sql, params) => { captured.push({ sql, params }); return { ok: true, resultado: { rows: [] } }; },
    calcularCotasFrescorPreImporter, sqlFrescorComercialPreImporter, sqlRetryPreImporter,
    limitarJobs: n => n, separarResultadoJobsProntos: () => ({ jobs: [], candidatePool: [] }),
    console: { log: () => {} }
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.capture=buscarJobsProntos;", context, { timeout: 1000 });
  await context.capture({ limite, marketplace });
  return captured.find(item => /^\s*WITH\b/i.test(item.sql));
}

async function runStage(owner, workerA, workerB, stage) {
  await owner.query("TRUNCATE engine_fairness_origem_fluxo, engine_jobs_cliente, engine_eventos_brutos");
  const limit = stage.limit || 1;
  const ids = Array.from({ length: stage.jobCount || 2 }, (_, index) => stage.baseId + index);
  for (const id of ids) {
    await owner.query(`INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
      VALUES ($1, 'radar', 'synthetic_multiworker', '{"origemFluxo":"optimus"}'::jsonb, NOW() - INTERVAL '1 minute')`, [id]);
    await owner.query(`INSERT INTO engine_jobs_cliente
      (id, evento_id, cliente_id, marketplace, marketplace_detectado, status, metadata, criado_em)
      VALUES ($1, $1, 'multiworker_ws', 'mercadolivre', 'mercadolivre', $2,
        '{"origemFluxo":"optimus"}'::jsonb, NOW() - INTERVAL '1 minute')`, [id, stage.status]);
  }
  const quota = calcularCotasFrescorPreImporter(limit);
  const query = stage.query || { sql: stage.sql(), params: [quota.aguaNova, quota.frescaEmRisco,
    quota.frescaCirculavel, quota.limpeza, quota.totalSelecao] };
  const rows = (await owner.query(query.sql, query.params)).rows;
  const parsed = stage.parse(rows);
  assert.equal(parsed.jobs.length, limit, `${stage.name}: baseline limit ${limit}`);
  assert.deepEqual(new Set(parsed.candidatePool.map(job => Number(job.id))), new Set(ids),
    `${stage.name}: SQL candidate pool must include a replacement`);
  const baseline = parsed.jobs.map((job, indiceBaseline) => ({ ...job, indiceBaseline }));
  const groups = stage.fairness.montarGruposFairness(baseline, parsed.candidatePool);
  assert.equal(groups.length, 1);

  let lockAcquired;
  const locked = new Promise(resolve => { lockAcquired = resolve; });
  let delayed = false;
  const poolA = { connect: async () => ({
    query: async (...args) => {
      const sql = String(args[0]);
      if (/UPDATE engine_jobs_cliente/i.test(sql) && !delayed) {
        delayed = true;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const result = await workerA.query(...args);
      if (/FROM engine_fairness_origem_fluxo[\s\S]*FOR UPDATE/i.test(sql)) lockAcquired();
      return result;
    }, release() {}
  }) };
  const poolB = { connect: async () => ({ query: (...args) => workerB.query(...args), release() {} }) };
  async function claimRound(pool) {
    const claimed = [];
    let plano = null;
    const idsReservados = new Set();
    for (let posicao = 0; posicao < (stage.fullRound ? limit : 1); posicao += 1) {
      const result = await stage.fairness.reivindicarSlotFairness(groups[0], posicao,
        { pool, plano, idsReservados });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.plano) plano = result.plano;
      if (result.job) {
        claimed.push(Number(result.job.id));
        idsReservados.add(Number(result.job.id));
      }
    }
    return claimed;
  }
  const firstPromise = claimRound(poolA);
  await Promise.race([locked, new Promise((_, reject) => setTimeout(() => reject(new Error("fairness_lock_timeout")), 5000))]);
  const secondStarted = performance.now();
  const secondPromise = claimRound(poolB);
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const secondWaitMs = Math.round(performance.now() - secondStarted);
  const claimed = [...first, ...second];
  const expectedClaims = stage.fullRound ? limit * 2 : 2;
  assert.equal(claimed.length, expectedClaims, `${stage.name}: all worker slots must be filled`);
  assert.equal(new Set(claimed).size, expectedClaims,
    `${stage.name}: two workers must claim distinct real jobs`);
  assert(claimed.every(id => ids.includes(id)));
  const states = (await owner.query("SELECT id, status FROM engine_jobs_cliente ORDER BY id")).rows;
  assert.equal(states.filter(row => row.status === stage.claimedStatus).length, expectedClaims,
    `${stage.name}: every slot claims a distinct job once`);
  assert(secondWaitMs >= 150, `${stage.name}: second worker must wait for fairness lock`);
  return { stage: stage.name, idsClaimed: claimed,
    secondWorkerWaitMs: secondWaitMs, statuses: states.map(row => row.status) };
}

async function runTtlCrossStage(owner, workerA, workerB, stage) {
  await owner.query("TRUNCATE engine_fairness_origem_fluxo, engine_jobs_cliente, engine_eventos_brutos");
  for (const [offset, age] of [[0, "29 minutes 57 seconds"], [1, "29 minutes"], [2, "29 minutes"]]) {
    const id = stage.baseId + offset;
    await owner.query(`INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
      VALUES ($1, 'radar', 'synthetic_ttl_cross', '{}'::jsonb, clock_timestamp() - $2::interval)`, [id, age]);
    await owner.query(`INSERT INTO engine_jobs_cliente
      (id, evento_id, cliente_id, marketplace, marketplace_detectado, status, metadata, criado_em)
      VALUES ($1,$1,'ttl_cross_ws','mercadolivre','mercadolivre',$2,
        '{"origemFluxo":"optimus"}'::jsonb, clock_timestamp() - $3::interval)`,
    [id, stage.status, age]);
  }
  const quota = calcularCotasFrescorPreImporter(1);
  const query = stage.query || { sql: stage.sql(), params: [quota.aguaNova, quota.frescaEmRisco,
    quota.frescaCirculavel, quota.limpeza, quota.totalSelecao] };
  const parsed = stage.parse((await owner.query(query.sql, query.params)).rows);
  assert.equal(Number(parsed.jobs[0]?.id), stage.baseId, `${stage.name}: oldest risk is baseline`);
  assert.deepEqual(new Set(parsed.candidatePool.map(job => Number(job.id))),
    new Set([stage.baseId, stage.baseId + 1]), `${stage.name}: third live job starts outside candidate pool`);
  const group = stage.fairness.montarGruposFairness(
    parsed.jobs.map((job, indiceBaseline) => ({ ...job, indiceBaseline })), parsed.candidatePool)[0];

  let lockAcquired;
  const locked = new Promise(resolve => { lockAcquired = resolve; });
  let delayed = false;
  const poolA = { connect: async () => ({ query: async (...args) => {
    const sql = String(args[0]);
    if (/UPDATE engine_jobs_cliente/i.test(sql) && !delayed) {
      delayed = true;
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    const result = await workerA.query(...args);
    if (/FROM engine_fairness_origem_fluxo[\s\S]*FOR UPDATE/i.test(sql)) lockAcquired();
    return result;
  }, release() {} }) };
  const poolB = { connect: async () => ({ query: (...args) => workerB.query(...args), release() {} }) };
  const firstPromise = stage.fairness.reivindicarSlotFairness(group, 0, { pool: poolA });
  await Promise.race([locked, new Promise((_, reject) => setTimeout(() => reject(new Error("ttl_lock_timeout")), 5000))]);
  const secondPromise = stage.fairness.reivindicarSlotFairness(group, 0, { pool: poolB });
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(Number(first.job?.id), stage.baseId + 1, `${stage.name}: first worker uses B after A expires`);
  assert.equal(Number(second.job?.id), stage.baseId + 2, `${stage.name}: second worker refills with C`);
  const states = (await owner.query("SELECT id,status FROM engine_jobs_cliente ORDER BY id")).rows;
  assert.equal(states[0].status, stage.status, `${stage.name}: expired A remains unclaimed for terminalizer`);
  assert(states.slice(1).every(row => row.status === stage.claimedStatus));
  return { stage: stage.name, claimed: [Number(first.job.id), Number(second.job.id)],
    expiredStatus: states[0].status };
}

(async () => {
  const owner = new Client(connection);
  const workerA = new Client(connection);
  const workerB = new Client(connection);
  let created = false;
  try {
    await Promise.all([owner.connect(), workerA.connect(), workerB.connect()]);
    const identity = (await owner.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir")).rows[0];
    assert.equal(identity.db, connection.database);
    assert.equal(identity.host, connection.host);
    assert.equal(identity.port, connection.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    const already = (await owner.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount;
    assert.equal(already, 0, "refuse to overwrite an existing schema");
    await owner.query(`CREATE SCHEMA ${schema}`);
    created = true;
    for (const table of ["engine_eventos_brutos", "engine_jobs_cliente", "engine_fairness_origem_fluxo",
      "engine_processamentos", "engine_eventos_comerciais"]) {
      await owner.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    for (const client of [owner, workerA, workerB]) await client.query(`SET search_path TO ${schema}, public`);
    const results = [];
    results.push(await runStage(owner, workerA, workerB, {
      name: "processor", baseId: 71001, status: "pendente", claimedStatus: "processando",
      sql: processor.sqlBuscarJobsPendentes, parse: processor.separarResultadoJobsPendentes,
      fairness: processorFairness
    }));
    results.push(await runStage(owner, workerA, workerB, {
      name: "validator", baseId: 72001, status: "diagnosticado", claimedStatus: "validando",
      sql: validator.sqlBuscarJobsDiagnosticados, parse: validator.separarResultadoJobsDiagnosticados,
      fairness: validatorFairness
    }));
    results.push(await runStage(owner, workerA, workerB, {
      name: "importer", baseId: 73001, status: "pronto_para_importar", claimedStatus: "importando",
      query: await importerSql(1), parse: importer.separarResultadoJobsProntos,
      fairness: importerFairness
    }));
    for (const stage of [
      { name: "processor_limit2", baseId: 74001, status: "pendente", claimedStatus: "processando",
        sql: processor.sqlBuscarJobsPendentes, parse: processor.separarResultadoJobsPendentes,
        fairness: processorFairness },
      { name: "validator_limit2", baseId: 75001, status: "diagnosticado", claimedStatus: "validando",
        sql: validator.sqlBuscarJobsDiagnosticados, parse: validator.separarResultadoJobsDiagnosticados,
        fairness: validatorFairness },
      { name: "importer_limit2", baseId: 76001, status: "pronto_para_importar", claimedStatus: "importando",
        query: await importerSql(2), parse: importer.separarResultadoJobsProntos,
        fairness: importerFairness }
    ]) results.push(await runStage(owner, workerA, workerB, { ...stage, limit: 2, jobCount: 4, fullRound: true }));
    for (const stage of [
      { name: "processor_limit4", baseId: 78001, status: "pendente", claimedStatus: "processando",
        sql: processor.sqlBuscarJobsPendentes, parse: processor.separarResultadoJobsPendentes,
        fairness: processorFairness },
      { name: "validator_limit4", baseId: 79001, status: "diagnosticado", claimedStatus: "validando",
        sql: validator.sqlBuscarJobsDiagnosticados, parse: validator.separarResultadoJobsDiagnosticados,
        fairness: validatorFairness },
      { name: "importer_limit4", baseId: 80001, status: "pronto_para_importar", claimedStatus: "importando",
        query: await importerSql(4), parse: importer.separarResultadoJobsProntos,
        fairness: importerFairness }
    ]) results.push(await runStage(owner, workerA, workerB, { ...stage, limit: 4, jobCount: 8, fullRound: true }));

    for (const stage of [
      { name: "processor_ttl_cross", baseId: 81001, status: "pendente", claimedStatus: "processando",
        sql: processor.sqlBuscarJobsPendentes, parse: processor.separarResultadoJobsPendentes,
        fairness: processorFairness },
      { name: "validator_ttl_cross", baseId: 82001, status: "diagnosticado", claimedStatus: "validando",
        sql: validator.sqlBuscarJobsDiagnosticados, parse: validator.separarResultadoJobsDiagnosticados,
        fairness: validatorFairness },
      { name: "importer_ttl_cross", baseId: 83001, status: "pronto_para_importar", claimedStatus: "importando",
        query: await importerSql(1), parse: importer.separarResultadoJobsProntos,
        fairness: importerFairness }
    ]) results.push(await runTtlCrossStage(owner, workerA, workerB, stage));

    await owner.query("TRUNCATE engine_fairness_origem_fluxo, engine_jobs_cliente, engine_eventos_brutos");
    for (const [id, marketplace, priority] of [
      [77001, "mercadolivre", 100], [77002, "shopee", 90],
      [77003, "shopee", 85], [77004, "mercadolivre", 80]
    ]) {
      await owner.query(`INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
        VALUES ($1, 'radar', 'synthetic_multiworker', '{}'::jsonb, NOW() - INTERVAL '1 minute')`, [id]);
      await owner.query(`INSERT INTO engine_jobs_cliente
        (id, evento_id, cliente_id, marketplace, marketplace_detectado, status, prioridade, metadata, criado_em)
        VALUES ($1,$1,'multiworker_ws',$2,$2,'pronto_para_importar',$3,'{"origemFluxo":"optimus"}'::jsonb,
        NOW() - INTERVAL '1 minute')`, [id, marketplace, priority]);
    }
    const mixedQuery = await importerSql(1, "");
    const mixedRows = importer.separarResultadoJobsProntos((await owner.query(mixedQuery.sql, mixedQuery.params)).rows);
    assert.equal(Number(mixedRows.jobs[0]?.id), 77001, "default importer baseline must start with ML head");
    const mixedGroup = importerFairness.montarGruposFairness(
      mixedRows.jobs.map((job, indiceBaseline) => ({ ...job, indiceBaseline })), mixedRows.candidatePool);
    assert.deepEqual(new Set(mixedGroup[0].candidates.map(job => Number(job.id))),
      new Set([77001, 77004]), "mixed marketplace must retain ML replacement despite Shopee rank");
    console.log("UNIVERSAL_MULTIWORKER_MIXED_MARKETPLACE " + JSON.stringify({
      baseline: Number(mixedRows.jobs[0].id), candidateIds: mixedGroup[0].candidates.map(job => Number(job.id))
    }));

    await owner.query(`INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
      VALUES (77005, 'radar', 'synthetic_alias', '{}'::jsonb, NOW() - INTERVAL '1 minute')`);
    await owner.query(`INSERT INTO engine_jobs_cliente
      (id, evento_id, cliente_id, marketplace, marketplace_detectado, status, metadata, criado_em)
      VALUES (77005, 77005, ' whitespace_ws ', ' MercadoLivre ', 'mercadolivre',
        'pronto_para_importar', '{"origem_fluxo":"clonador_grupos"}'::jsonb,
        NOW() - INTERVAL '1 minute')`);
    const aliasReplacement = await buscarReposicaoGrupoPreImporter(owner,
      { clienteId: "whitespace_ws", marketplace: "mercadolivre", lane: "agua_nova" },
      "pronto_para_importar", [], { verificarRetry: true });
    assert.deepEqual(aliasReplacement.map(row => Number(row.id)), [77005]);
    assert.equal(aliasReplacement[0].origemFluxo, "clonador_grupos");

    await owner.query(`INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
      VALUES (84001, 'radar', 'synthetic_retention', '{}'::jsonb, NOW() - INTERVAL '48 hours')`);
    await owner.query(`INSERT INTO engine_jobs_cliente
      (id, evento_id, cliente_id, status, metadata, criado_em)
      VALUES (84001, 84001, 'retention_ws', 'pendente', '{}'::jsonb, NOW() - INTERVAL '48 hours')`);
    const terminalPool = { connect: async () => ({ query: (...args) => workerA.query(...args), release() {} }) };
    const terminal = await terminalizarJobsPreImporter({ limite: 1, pool: terminalPool });
    assert.equal(Number(terminal.terminalizados[0]?.id), 84001, JSON.stringify(terminal));
    const markerBefore = (await workerB.query(`SELECT metadata->>'terminalOcorridoEm' AS terminal_em,
      criado_em FROM engine_jobs_cliente WHERE id=84001`)).rows[0];
    assert(new Date(markerBefore.terminal_em) > new Date(markerBefore.criado_em));
    await workerB.query("UPDATE engine_jobs_cliente SET prioridade=1, atualizado_em=NOW() WHERE id=84001");
    const replay = await terminalizarJobsPreImporter({ limite: 1, pool: terminalPool });
    assert.equal(replay.terminalizados.length, 0);
    const markerAfter = (await workerB.query(`SELECT metadata->>'terminalOcorridoEm' AS terminal_em
      FROM engine_jobs_cliente WHERE id=84001`)).rows[0].terminal_em;
    assert.equal(markerAfter, markerBefore.terminal_em);
    const eventCount = (await workerB.query(`SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais
      WHERE job_id=84001 AND tipo_evento='job_expirada_operacional'`)).rows[0].n;
    assert.equal(eventCount, 1);
    const retention = (await workerB.query(`SELECT
      j.criado_em < NOW()-INTERVAL '12 hours' AS old_created_cutoff,
      (j.metadata->>'terminalOcorridoEm')::timestamptz < NOW()-INTERVAL '12 hours'
        AS terminal_cutoff,
      EXISTS (SELECT 1 FROM engine_eventos_comerciais c
        WHERE c.job_id=j.id AND c.cliente_id=j.cliente_id
          AND c.tipo_evento='job_expirada_operacional') AS compact_fact_exists
      FROM engine_jobs_cliente j WHERE j.id=84001`)).rows[0];
    assert.equal(retention.old_created_cutoff, true);
    assert.equal(retention.terminal_cutoff, false);
    assert.equal(retention.compact_fact_exists, true);
    console.log("UNIVERSAL_TERMINAL_MARKER_CROSS_CONNECTION " + JSON.stringify({
      oldCreatedHours: 48, markerPersisted: true, replayFacts: eventCount,
      laterUpdatePreserved: true, retention
    }));
    console.log("UNIVERSAL_MULTIWORKER " + JSON.stringify(results));
  } finally {
    await Promise.all([workerA.end().catch(() => {}), workerB.end().catch(() => {})]);
    if (created) {
      await owner.query("SET search_path TO public").catch(() => {});
      await owner.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    }
    await owner.end().catch(() => {});
  }
})().catch(error => { console.error("UNIVERSAL_MULTIWORKER_FATAL", error.stack || String(error)); process.exitCode = 1; });
