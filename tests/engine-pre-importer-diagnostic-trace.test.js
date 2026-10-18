"use strict";

const assert = require("assert");
const {
  MAX_TARGETS,
  carregarConfiguracao,
  criarColetor
} = require("../modules/engine/pre-importer-diagnostic-trace");
const { sqlBuscarJobsPendentes, sqlDiagnosticarAlvosPreImporter } = require("../modules/engine/processor.service");
const { reivindicarSlotPreImporter } = require("../modules/engine/fairness-slot-pre-importer.service");
const database = require("../modules/engine/database");

const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();

function testConfigFailsClosed() {
  assert.deepStrictEqual(carregarConfiguracao({}), { enabled: false, ids: [] });
  assert.deepStrictEqual(carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "true",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: "123",
    ENGINE_PRE_IMPORTER_TRACE_UNTIL: future
  }), { enabled: false, ids: [] });
  assert.deepStrictEqual(carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "1",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: "123,abc",
    ENGINE_PRE_IMPORTER_TRACE_UNTIL: future
  }), { enabled: false, ids: [] });
  assert.deepStrictEqual(carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "1",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: Array.from({ length: MAX_TARGETS + 1 }, (_, i) => i + 1).join(","),
    ENGINE_PRE_IMPORTER_TRACE_UNTIL: future
  }), { enabled: false, ids: [] });
  assert.deepStrictEqual(carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "1",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: "123",
    ENGINE_PRE_IMPORTER_TRACE_UNTIL: new Date(Date.now() - 1000).toISOString()
  }), { enabled: false, ids: [] });
  const config = carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "1",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: "001,123"
  }, Date.now());
  assert.deepStrictEqual(config, { enabled: false, ids: [] }, "ID não canônico não deve ser habilitado");
  const enabled = carregarConfiguracao({
    ENGINE_PRE_IMPORTER_TRACE_ENABLED: "1",
    ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: "123,456,123",
    ENGINE_PRE_IMPORTER_TRACE_UNTIL: future
  });
  assert.strictEqual(enabled.enabled, true);
  assert.deepStrictEqual(enabled.ids, ["123", "456"]);
}

function testCollectorSanitizesAndBoundsOutput() {
  const logs = [];
  const collector = criarColetor({ config: { enabled: true, ids: ["123"] }, quotas: { agua_nova: 10 }, log: (...args) => logs.push(args) });
  collector.aplicarDiagnostico([{
    job_id: "123", status: "pendente", lane: "agua_nova", posicao_workspace_lane: 3,
    candidatos_lane: 19, elegivel_sql: true, motivo_selecao: "elegivel"
  }], [{ id: 123 }], []);
  collector.selecaoPlano(123, true, "plano_fairness");
  collector.claimAttempt(123, { etapa: "fairness_slot", resultado: "rollback_savepoint", motivo: "frescor_revalidado" });
  collector.transaction(123, { resultado: "commit_sem_claim", motivo: "claim_nao_confirmado", duracaoMs: 4.25 });
  assert.strictEqual(logs.length, 0, "telemetria não deve emitir logs por evento antes do flush agregado");
  collector.flush({ diagnosticoQuery: "ok" });
  collector.flush({ diagnosticoQuery: "duplicado" });
  assert.strictEqual(logs.length, 1, "no máximo um registro agregado por ciclo");
  const payload = JSON.parse(logs[0][1]);
  assert.strictEqual(payload.targetCount, 1);
  assert.strictEqual(payload.entries[0].jobId, "123");
  assert.strictEqual(payload.entries[0].lane, "agua_nova");
  assert.strictEqual(payload.entries[0].posicaoWorkspaceLane, 3);
  assert.strictEqual(payload.entries[0].cotaLane, 10);
  assert.strictEqual(payload.entries[0].selecionadoSql, true);
  assert.strictEqual(payload.entries[0].selecionadoEfetivo, false);
  assert.strictEqual(Object.hasOwn(payload.entries[0], "cliente_id"), false);
  assert.strictEqual(JSON.stringify(payload).includes("https://"), false);
  assert.strictEqual(JSON.stringify(payload).includes("mensagem"), false);
  const visibleLogs = [];
  const visible = criarColetor({ config: { enabled: true, ids: ["123"] }, quotas: { agua_nova: 10 }, log: (...args) => visibleLogs.push(args) });
  visible.aplicarDiagnostico([], [{ id: 123, lane_vazao_pre_importer: "agua_nova", workspace_rank_pre_importer: 2 }], []);
  visible.transaction(123, { resultado: "autocommit_confirmado" });
  visible.flush();
  const visibleEntry = JSON.parse(visibleLogs[0][1]).entries[0];
  assert.strictEqual(visibleEntry.motivoSelecao, "selecionado_baseline_sql");
  assert.strictEqual(visibleEntry.posicaoWorkspaceLane, 2);
  assert.strictEqual(visibleEntry.selecionadoEfetivo, true);
  const expiredLogs = [];
  const expired = criarColetor({ config: { enabled: true, ids: ["123"], ateMs: Date.now() - 1 }, log: (...args) => expiredLogs.push(args) });
  expired.flush();
  assert.strictEqual(expiredLogs.length, 0, "janela expirada não deve emitir telemetria");
}

function testSelectionSqlUnchangedAndDiagnosticQueryReadOnlyBounded() {
  const selection = sqlBuscarJobsPendentes();
  assert(selection.includes("WITH limpeza_ids AS MATERIALIZED"));
  assert(selection.includes("LIMIT $5"));
  assert(selection.includes("candidate_pool"));
  const diagnostic = sqlDiagnosticarAlvosPreImporter();
  assert(diagnostic.includes("WHERE j.id = ANY($1::bigint[])"));
  assert(diagnostic.includes("ROW_NUMBER() OVER"));
  assert(diagnostic.includes("posicao_workspace_lane"));
  assert(!/\b(INSERT|UPDATE|DELETE|FOR\s+UPDATE)\b/i.test(diagnostic));
}

async function testOffDoesNotAddDbQueries() {
  const originalQuery = database.queryEngine;
  const originalPool = database.getEnginePool;
  const originalEnv = {
    enabled: process.env.ENGINE_PRE_IMPORTER_TRACE_ENABLED,
    ids: process.env.ENGINE_PRE_IMPORTER_TRACE_JOB_IDS,
    until: process.env.ENGINE_PRE_IMPORTER_TRACE_UNTIL
  };
  let selectionQueries = 0;
  let diagnosticSqlQueries = 0;
  let selectionRows = [];
  database.queryEngine = async () => {
    selectionQueries += 1;
    return { ok: true, resultado: { rows: selectionRows } };
  };
  database.getEnginePool = () => ({
    idleCount: 1,
    waitingCount: 0,
    async connect() {
      return {
        async query(sql) {
          if (String(sql).startsWith("WITH limpeza_ids")) {
            diagnosticSqlQueries += 1;
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {}
      };
    }
  });
  const servicePath = require.resolve("../modules/engine/processor.service");
  delete require.cache[servicePath];
  const service = require(servicePath);
  try {
    delete process.env.ENGINE_PRE_IMPORTER_TRACE_ENABLED;
    delete process.env.ENGINE_PRE_IMPORTER_TRACE_JOB_IDS;
    delete process.env.ENGINE_PRE_IMPORTER_TRACE_UNTIL;
    const off = await service.buscarJobsPendentes(20);
    assert.strictEqual(off.ok, true);
    assert.strictEqual(selectionQueries, 1);
    assert.strictEqual(diagnosticSqlQueries, 0, "OFF não executa consulta diagnóstica adicional");

    process.env.ENGINE_PRE_IMPORTER_TRACE_ENABLED = "1";
    process.env.ENGINE_PRE_IMPORTER_TRACE_JOB_IDS = "123";
    process.env.ENGINE_PRE_IMPORTER_TRACE_UNTIL = new Date(Date.now() + 60_000).toISOString();
    const on = await service.buscarJobsPendentes(20);
    assert.strictEqual(on.ok, true);
    assert.strictEqual(selectionQueries, 2, "uma consulta de seleção normal por chamada");
    assert.strictEqual(diagnosticSqlQueries, 1, "ON executa no máximo uma consulta adicional por ciclo");
    assert.strictEqual(on.traceConfig.enabled, true);

    selectionRows = [
      { id: 123, tipo_saida_pre_importer: "baseline", lane_vazao_pre_importer: "agua_nova", workspace_rank_pre_importer: 2 }
    ];
    const visible = await service.buscarJobsPendentes(20);
    assert.strictEqual(visible.diagnosticoPreImporter.motivo, "alvos_visiveis");
    assert.strictEqual(diagnosticSqlQueries, 1, "alvo visível na seleção não precisa de consulta diagnóstica");
  } finally {
    database.queryEngine = originalQuery;
    database.getEnginePool = originalPool;
    for (const [key, value] of Object.entries({
      ENGINE_PRE_IMPORTER_TRACE_ENABLED: originalEnv.enabled,
      ENGINE_PRE_IMPORTER_TRACE_JOB_IDS: originalEnv.ids,
      ENGINE_PRE_IMPORTER_TRACE_UNTIL: originalEnv.until
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[servicePath];
    require(servicePath);
  }
}

async function testDiagnosticNeverWaitsForBusyPool() {
  const originalPool = database.getEnginePool;
  let attempts = 0;
  database.getEnginePool = () => ({
    idleCount: 0, waitingCount: 1,
    connect() { attempts += 1; throw new Error("não deveria aguardar pool ocupado"); }
  });
  const servicePath = require.resolve("../modules/engine/processor.service");
  delete require.cache[servicePath];
  const service = require(servicePath);
  try {
    const result = await service.buscarDiagnosticoAlvosPreImporter(["123"], 1, 20);
    assert.strictEqual(result.motivo, "pool_ocupado");
    assert.strictEqual(attempts, 0);
  } finally {
    database.getEnginePool = originalPool;
    delete require.cache[servicePath];
    require(servicePath);
  }
}

async function testDelayedAcquisitionIsReleasedWithoutQuery() {
  const originalPool = database.getEnginePool;
  let releases = 0;
  let queries = 0;
  database.getEnginePool = () => ({
    idleCount: 1, waitingCount: 0,
    async connect() {
      await new Promise(resolve => setTimeout(resolve, 130));
      return { query() { queries += 1; }, release() { releases += 1; } };
    }
  });
  const servicePath = require.resolve("../modules/engine/processor.service");
  delete require.cache[servicePath];
  const service = require(servicePath);
  try {
    const result = await service.buscarDiagnosticoAlvosPreImporter(["123"], 1);
    assert.strictEqual(result.motivo, "aquisicao_timeout");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(releases, 1, "conexão adquirida após o timeout deve ser devolvida");
    assert.strictEqual(queries, 0, "nenhuma consulta após timeout de aquisição");
  } finally {
    database.getEnginePool = originalPool;
    delete require.cache[servicePath];
    require(servicePath);
  }
}

async function testFairnessCommitAndRollbackAreDistinct() {
  async function run(failure = "") {
    const statements = [];
    const client = {
      async query(sql) {
        statements.push(sql);
        if (/SELECT \(/i.test(sql) && /engine_jobs_cliente/i.test(sql)) return { rows: [{ vivo: true }] };
        if (/SELECT cliente_id, etapa, lane, ultima_origem_atendida/i.test(sql)) {
          return { rows: [{ cliente_id: "w", etapa: "diagnostico_final", lane: "agua_nova", ultima_origem_atendida: "" }] };
        }
        if (/UPDATE engine_fairness_origem_fluxo/i.test(sql) && failure === "before_commit") throw new Error("synthetic_failure");
        if (sql === "COMMIT" && failure === "commit") throw new Error("synthetic_commit_failure");
        if (/UPDATE engine_fairness_origem_fluxo/i.test(sql)) {
          return { rows: [{ cliente_id: "w", etapa: "diagnostico_final", lane: "agua_nova", ultima_origem_atendida: null }] };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {}
    };
    const pool = { async connect() { return client; } };
    const logs = [];
    const collector = criarColetor({ config: { enabled: true, ids: ["123"] }, log: (...args) => logs.push(args) });
    collector.selecaoPlano("123", true, "plano_fairness");
    const result = await reivindicarSlotPreImporter({
      chave: "w|agua_nova", clienteId: "w", lane: "agua_nova", baseline: [{ id: 123, cliente_id: "w" }], candidates: []
    }, 0, {
      pool,
      etapa: "diagnostico_final",
      plano: { slots: [{ job: { id: 123 }, posicao: 0 }], selecionados: [{ id: 123 }] },
      idsReservados: new Set(),
      claim: async () => ({ ok: true, jobs: [{ id: 123, status: "processando" }] }),
      montarPlano: () => ({ slots: [{ job: { id: 123 }, posicao: 0 }], selecionados: [{ id: 123 }] }),
      origemProtegida: () => "",
      diagnostico: collector
    });
    collector.flush();
    return { result, statements, payload: JSON.parse(logs[0][1]) };
  }
  const committed = await run();
  assert.strictEqual(committed.result.ok, true);
  assert(committed.payload.entries[0].transacoes.some(item => item.resultado === "commit_confirmado"));
  const rolledBack = await run("before_commit");
  assert.strictEqual(rolledBack.result.ok, false);
  assert(rolledBack.statements.includes("ROLLBACK"));
  assert(rolledBack.payload.entries[0].transacoes.some(item => item.resultado === "rollback_confirmado"));
  const commitFailed = await run("commit");
  assert.strictEqual(commitFailed.result.ok, false);
  assert(commitFailed.payload.entries[0].transacoes.some(item => item.resultado === "commit_resultado_desconhecido"));
}

async function main() {
  testConfigFailsClosed();
  testCollectorSanitizesAndBoundsOutput();
  testSelectionSqlUnchangedAndDiagnosticQueryReadOnlyBounded();
  await testOffDoesNotAddDbQueries();
  await testDiagnosticNeverWaitsForBusyPool();
  await testDelayedAcquisitionIsReleasedWithoutQuery();
  await testFairnessCommitAndRollbackAreDistinct();
  console.log("OK engine-pre-importer-diagnostic-trace");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
