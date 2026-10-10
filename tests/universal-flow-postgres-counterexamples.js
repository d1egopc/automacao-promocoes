"use strict";

// Reproduces selector/retention counterexamples only inside the disposable cluster.
// All writes below target PostgreSQL TEMP tables and are rolled back at exit.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Client } = require("pg");
const { sqlBuscarJobsPendentes } = require("../modules/engine/processor.service");
const { sqlBuscarJobsDiagnosticados } = require("../modules/engine/validator.service");
const { calcularCotasFrescorPreImporter, avaliarFrescorPreImporter,
  sqlFrescorComercialPreImporter, sqlRetryPreImporter } = require("../modules/engine/frescor-pre-importer.service");
const { bloquearEstadoFairness, registrarAtendimentoWorkspaceFairness } = require("../modules/engine/origem-fairness.repository");

const root = path.resolve(__dirname, "..");
const expectedData = path.join(root, ".local-postgres", "data");
const expectedDatabase = "optimus_universal_fixture";
const port = 55433;

async function captureImporterQuery(limit) {
  const source = fs.readFileSync(path.join(root, "modules/engine/importer/importer.service.js"), "utf8");
  const start = source.indexOf("async function buscarJobsProntos(");
  const end = source.indexOf("function removerCamposInternosCandidatePoolImporter(", start);
  assert(start >= 0 && end > start, "importer selector not found");
  const captured = [];
  const context = {
    queryEngine: async (sql, params) => {
      captured.push({ sql, params });
      return { ok: true, resultado: { rows: [] } };
    },
    calcularCotasFrescorPreImporter,
    sqlFrescorComercialPreImporter,
    sqlRetryPreImporter,
    limitarJobs: n => Math.min(100, Math.max(1, Number(n) || 10)),
    separarResultadoJobsProntos: () => ({ jobs: [], candidatePool: [] }),
    console: { log: () => {} }
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.capture=buscarJobsProntos;", context, { timeout: 1000 });
  await context.capture({ limite: limit, marketplace: "mercadolivre" });
  const query = captured.find(item => /^\s*WITH\b/i.test(item.sql));
  assert(query, "importer selector SQL not captured");
  return query;
}

async function insertJob(client, { id, workspace, minutesAgo, status = "pendente", kind = "case", origin = "optimus", metadata = {} }) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await client.query(
    `INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em, criado_em)
     VALUES ($1, $2, 'synthetic_case', $3::jsonb, $4, $4)`,
    [id, origin === "clonador_grupos" ? "clonador_grupos" : "radar", JSON.stringify({ fixtureKind: kind, origemFluxo: origin }), at]
  );
  await client.query(
    `INSERT INTO engine_jobs_cliente
       (id, evento_id, cliente_id, marketplace, marketplace_detectado, status, metadata, criado_em, atualizado_em)
     VALUES ($1, $1, $2, 'mercadolivre', 'mercadolivre', $3, $4::jsonb, $5, $5)`,
    [id, workspace, status, JSON.stringify({ fixtureKind: kind, origemFluxo: origin, ...metadata }), at]
  );
}

async function clearCases(client) {
  await client.query("TRUNCATE engine_jobs_cliente, engine_eventos_brutos");
}

async function processorRows(client, limit) {
  const c = calcularCotasFrescorPreImporter(limit);
  const result = await client.query(sqlBuscarJobsPendentes(), [c.aguaNova, c.frescaEmRisco, c.frescaCirculavel, c.limpeza, c.totalSelecao]);
  return result.rows.filter(row => row.tipo_saida_pre_importer === "baseline");
}

async function validatorRows(client, limit) {
  const c = calcularCotasFrescorPreImporter(limit);
  const result = await client.query(sqlBuscarJobsDiagnosticados(), [c.aguaNova, c.frescaEmRisco, c.frescaCirculavel, c.limpeza, c.totalSelecao]);
  return result.rows.filter(row => row.tipo_saida_pre_importer === "baseline");
}

async function importerRows(client, limit) {
  const query = await captureImporterQuery(limit);
  const result = await client.query(query.sql, query.params);
  return result.rows.filter(row => row.tipo_saida_pre_importer === "baseline");
}

(async () => {
  const client = new Client({ host: "127.0.0.1", port, user: "postgres", database: expectedDatabase, connectionTimeoutMillis: 5000 });
  let begun = false;
  const gates = {};
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir")).rows[0];
    assert.equal(identity.db, expectedDatabase);
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(), path.normalize(expectedData).toLowerCase());
    await client.query("BEGIN");
    begun = true;
    await client.query("CREATE TEMP TABLE engine_eventos_brutos AS SELECT * FROM public.engine_eventos_brutos WHERE FALSE");
    await client.query("CREATE TEMP TABLE engine_jobs_cliente AS SELECT * FROM public.engine_jobs_cliente WHERE FALSE");

    // Eligible work exists only in the circulating lane; fixed quotas leave slots empty.
    for (let i = 1; i <= 4; i += 1) await insertJob(client, { id: i, workspace: `circulante_${i}`, minutesAgo: 10 });
    const workConserving = {};
    for (const limit of [1, 2, 4]) workConserving[limit] = (await processorRows(client, limit)).length;
    await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado'");
    const validatorConserving = {};
    for (const limit of [1, 2, 4]) validatorConserving[limit] = (await validatorRows(client, limit)).length;
    await client.query("UPDATE engine_jobs_cliente SET status='pronto_para_importar'");
    const importerConserving = {};
    for (const limit of [1, 2, 4]) importerConserving[limit] = (await importerRows(client, limit)).length;
    gates.workConserving = [workConserving, validatorConserving, importerConserving]
      .every(stage => [1, 2, 4].every(limit => stage[limit] === limit));
    console.log("UNIVERSAL_CASE_WORK_CONSERVING " + JSON.stringify({
      eligible: 4, processor: workConserving, validator: validatorConserving, importer: importerConserving
    }));

    await clearCases(client);
    for (let i = 0; i < 8; i += 1) await insertJob(client, { id: 50 + i, workspace: "water_heavy", minutesAgo: 1 });
    await insertJob(client, { id: 60, workspace: "risk_light", minutesAgo: 25 });
    await insertJob(client, { id: 61, workspace: "circulating_light", minutesAgo: 10, metadata: { manualV2: true } });
    const lanesFiveSix = {};
    for (const limit of [5, 6]) {
      const quota = calcularCotasFrescorPreImporter(limit);
      const selected = await processorRows(client, limit);
      lanesFiveSix[limit] = { quota, workspaces: [...new Set(selected.map(job => job.cliente_id))] };
    }
    gates.laneFloorFiveSix = [5, 6].every(limit =>
      lanesFiveSix[limit].quota.frescaCirculavel >= 1 &&
      lanesFiveSix[limit].workspaces.includes("risk_light") &&
      lanesFiveSix[limit].workspaces.includes("circulating_light"));
    console.log("UNIVERSAL_CASE_LANE_FLOOR_5_6 " + JSON.stringify(lanesFiveSix));

    // The cleanup reserve must never become extra commercial throughput.
    await clearCases(client);
    for (let i = 0; i < 100; i += 1) await insertJob(client, { id: 1000 + i, workspace: `budget_${i % 20}`, minutesAgo: 10 });
    const commercialBudget = { processor: (await processorRows(client, 20)).length };
    await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado'");
    commercialBudget.validator = (await validatorRows(client, 20)).length;
    await client.query("UPDATE engine_jobs_cliente SET status='pronto_para_importar'");
    commercialBudget.importer = (await importerRows(client, 20)).length;
    gates.commercialBudget = Object.values(commercialBudget).every(count => count === 20);
    console.log("UNIVERSAL_CASE_COMMERCIAL_BUDGET " + JSON.stringify({ limit: 20, cleanupReserve: 4, eligible: 100, selected: commercialBudget }));

    await clearCases(client);
    for (let i = 0; i < 100; i += 1) await insertJob(client, { id: 2000 + i, workspace: `mixed_${i % 20}`, minutesAgo: 10 });
    for (let i = 0; i < 20; i += 1) await insertJob(client, { id: 2200 + i, workspace: `expired_${i % 20}`, minutesAgo: 48 * 60 });
    function summarizeBudget(rows) {
      return { fresh: rows.filter(row => row.lane_vazao_pre_importer !== "expirada").length,
        cleanup: rows.filter(row => row.lane_vazao_pre_importer === "expirada").length,
        unique: new Set(rows.map(row => Number(row.id))).size === rows.length };
    }
    const mixedBudget = { processor: summarizeBudget(await processorRows(client, 20)) };
    await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado'");
    mixedBudget.validator = summarizeBudget(await validatorRows(client, 20));
    await client.query("UPDATE engine_jobs_cliente SET status='pronto_para_importar'");
    mixedBudget.importer = summarizeBudget(await importerRows(client, 20));
    gates.separateCleanupBudget = Object.values(mixedBudget).every(result =>
      result.fresh === 20 && result.cleanup === 4 && result.unique);
    console.log("UNIVERSAL_CASE_SEPARATE_CLEANUP_BUDGET " + JSON.stringify({ limit: 20, cleanupReserve: 4, selected: mixedBudget }));

    await clearCases(client);
    for (let i = 0; i < 10; i += 1) await insertJob(client, { id: 2300 + i, workspace: `risk_${i}`, minutesAgo: 21 + i });
    const riskOrder = { processor: (await processorRows(client, 4)).map(row => Number(row.id)) };
    await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado'");
    riskOrder.validator = (await validatorRows(client, 4)).map(row => Number(row.id));
    await client.query("UPDATE engine_jobs_cliente SET status='pronto_para_importar'");
    riskOrder.importer = (await importerRows(client, 4)).map(row => Number(row.id));
    gates.riskUrgency = Object.values(riskOrder).every(ids =>
      ids.length === 4 && ids.join(",") === "2309,2308,2307,2306");
    console.log("UNIVERSAL_CASE_RISK_URGENCY " + JSON.stringify(riskOrder));

    // Refilling a favored workspace after each completed selection must not hide peers.
    await clearCases(client);
    for (let i = 0; i < 8; i += 1) await insertJob(client, {
      id: 100 + i, workspace: `workspace_${i}`, minutesAgo: 1,
      origin: i % 2 === 0 ? "optimus" : "clonador_grupos"
    });
    const served = new Set();
    let nextId = 200;
    for (let round = 0; round < 8; round += 1) {
      const selected = await processorRows(client, 2);
      for (const job of selected) {
        served.add(job.cliente_id);
        const chave = { clienteId: job.cliente_id, etapa: "diagnostico_final", lane: job.lane_vazao_pre_importer };
        await bloquearEstadoFairness(client, chave);
        await registrarAtendimentoWorkspaceFairness(client, chave, job.origem_fluxo_explicita_pre_importer);
        await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado' WHERE id=$1", [job.id]);
        await insertJob(client, {
          id: nextId++, workspace: job.cliente_id, minutesAgo: 0,
          origin: job.origem_fluxo_explicita_pre_importer || "optimus"
        });
      }
    }
    gates.workspaceFairness = served.size === 8;
    console.log("UNIVERSAL_CASE_WORKSPACE_FAIRNESS " + JSON.stringify({ rounds: 8, slotsPerRound: 2, eligibleWorkspaces: 8, servedWorkspaces: [...served].sort() }));

    await clearCases(client);
    for (let i = 0; i < 25; i += 1) await insertJob(client, {
      id: 800 + i, workspace: `single_slot_${i}`, minutesAgo: 1,
      origin: i % 2 === 0 ? "optimus" : "clonador_grupos"
    });
    const servedSingleSlot = new Set();
    for (let round = 0; round < 25; round += 1) {
      const [job] = await processorRows(client, 1);
      assert(job, `single-slot round ${round} must select a job`);
      servedSingleSlot.add(job.cliente_id);
      const chave = { clienteId: job.cliente_id, etapa: "diagnostico_final", lane: job.lane_vazao_pre_importer };
      await bloquearEstadoFairness(client, chave);
      await registrarAtendimentoWorkspaceFairness(client, chave, job.origem_fluxo_explicita_pre_importer);
      await client.query("UPDATE engine_jobs_cliente SET status='diagnosticado' WHERE id=$1", [job.id]);
      await insertJob(client, { id: 900 + round, workspace: job.cliente_id, minutesAgo: 0,
        origin: job.origem_fluxo_explicita_pre_importer || "optimus" });
    }
    gates.workspaceSingleSlot = servedSingleSlot.size === 25;
    console.log("UNIVERSAL_CASE_WORKSPACE_SINGLE_SLOT " + JSON.stringify({ rounds: 25, eligible: 25, served: servedSingleSlot.size }));

    await clearCases(client);
    await insertJob(client, { id: 300, workspace: "turbo", minutesAgo: 15, metadata: { cupomTurbo: true } });
    await insertJob(client, { id: 301, workspace: "manual", minutesAgo: 120, metadata: { manualV2: true } });
    const ageRows = await processorRows(client, 70);
    gates.freshness = ageRows.some(job => Number(job.id) === 300 &&
      job.lane_vazao_pre_importer === "expirada" && avaliarFrescorPreImporter(job).expirada) &&
      ageRows.some(job => Number(job.id) === 301 &&
        job.lane_vazao_pre_importer !== "expirada" && !avaliarFrescorPreImporter(job).expirada);
    console.log("UNIVERSAL_CASE_FRESHNESS " + JSON.stringify(ageRows.map(job => ({
      id: job.id, sqlLane: job.lane_vazao_pre_importer, runtimeExpired: avaliarFrescorPreImporter(job).expirada,
      manualV2: avaliarFrescorPreImporter(job).manualV2 === true
    }))));

    await clearCases(client);
    for (let i = 0; i < 20; i += 1) await insertJob(client, { id: 400 + i, workspace: `ready_${i}`, minutesAgo: 1, status: "pronto_para_importar", kind: "ready" });
    for (let i = 0; i < 5; i += 1) {
      const due = String(Date.now() - 60_000);
      const future = String(Date.now() + 3_600_000);
      await insertJob(client, { id: 500 + i, workspace: `retry_due_${i}`, minutesAgo: 15, status: "pronto_para_importar", kind: "retry_due", metadata: { localWorkerImageRetry: { proximaTentativaEmMs: due } } });
      await insertJob(client, { id: 600 + i, workspace: `retry_future_${i}`, minutesAgo: 15, status: "pronto_para_importar", kind: "retry_future", metadata: { localWorkerImageRetry: { proximaTentativaEmMs: future } } });
    }
    const importer = {};
    for (const limit of [1, 2, 4, 18, 35]) {
      const rows = await importerRows(client, limit);
      importer[limit] = { selected: rows.length, due: rows.filter(row => row.metadata?.fixtureKind === "retry_due").length, future: rows.filter(row => row.metadata?.fixtureKind === "retry_future").length };
    }
    gates.futureRetryExcluded = Object.values(importer).every(result => result.future === 0);
    console.log("UNIVERSAL_CASE_IMPORTER " + JSON.stringify(importer));

    const importerOriginalIds = new Set([...Array(20)].map((_, i) => 400 + i).concat([...Array(5)].map((_, i) => 500 + i)));
    const importerServed = new Set();
    for (let round = 0; round < 25; round += 1) {
      const [job] = await importerRows(client, 1);
      assert(job, `importer empty at round ${round}`);
      await client.query("UPDATE engine_jobs_cliente SET status='importando' WHERE id=$1 AND status='pronto_para_importar'", [job.id]);
      const importerChave = {
        clienteId: job.cliente_id,
        etapa: "importacao_final",
        lane: `mercadolivre:${job.lane_vazao_pre_importer}`
      };
      await bloquearEstadoFairness(client, importerChave);
      await registrarAtendimentoWorkspaceFairness(client, importerChave);
      if (importerOriginalIds.has(Number(job.id))) importerServed.add(Number(job.id));
      await insertJob(client, { id: 800 + round, workspace: job.cliente_id, minutesAgo: 1, status: "pronto_para_importar", kind: "ready_replenished" });
    }
    gates.importerBoundedProgress = importerServed.size === importerOriginalIds.size;
    console.log("UNIVERSAL_CASE_IMPORTER_CONTINUOUS " + JSON.stringify({
      limit: 1, rounds: 25, originalEligible: importerOriginalIds.size,
      originalServed: importerServed.size, replenished: 25
    }));

    await clearCases(client);
    await insertJob(client, { id: 700, workspace: "terminal_recent", minutesAgo: 48 * 60, status: "expirada_operacional", kind: "terminal_recent" });
    await client.query("UPDATE engine_jobs_cliente SET atualizado_em=NOW() WHERE id=700");
    const retention = (await client.query(`SELECT id, criado_em < NOW() - INTERVAL '12 hours' AS eligible_by_created,
      atualizado_em < NOW() - INTERVAL '12 hours' AS eligible_by_terminal_update FROM engine_jobs_cliente WHERE id=700`)).rows[0];
    console.log("UNIVERSAL_CASE_RETENTION " + JSON.stringify(retention));
    console.log("UNIVERSAL_CASE_GATES " + JSON.stringify(gates));
    if (process.argv.includes("--assert-slice")) {
      for (const name of ["workConserving", "commercialBudget", "separateCleanupBudget", "riskUrgency", "futureRetryExcluded", "importerBoundedProgress", "laneFloorFiveSix"]) {
        assert.equal(gates[name], true, `${name} slice gate failed`);
      }
    }
    if (process.argv.includes("--assert-after")) {
      for (const [name, passed] of Object.entries(gates)) assert.equal(passed, true, `${name} gate failed`);
    }
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_CASE_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
