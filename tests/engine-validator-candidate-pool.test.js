"use strict";

const assert = require("assert");
const {
  sqlBuscarJobsDiagnosticados,
  separarResultadoJobsDiagnosticados
} = require("../modules/engine/validator.service");
const { calcularCotasFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");

function linha(tipo, id, extras = {}) {
  return {
    tipo_saida_pre_importer: tipo,
    id,
    cliente_id: extras.cliente_id || "workspace_a",
    metadata: extras.metadata || {},
    prioridade: extras.prioridade || 0,
    lane_vazao_pre_importer: extras.lane || "agua_nova",
    workspace_chave_pre_importer: extras.workspace || "workspace_a",
    origem_fluxo_explicita_pre_importer: extras.origem || "",
    origem_head_rank_pre_importer: extras.headRank || 1,
    bucket_selecao_pre_importer: 0,
    baseline_ordem_pre_importer: extras.baselineOrdem || null,
    candidate_pool_origem_pre_importer: extras.candidateOrigem || null,
    candidate_pool_dedup_rank_pre_importer: 1,
    evento_metadata: {},
    ...extras
  };
}

function testarCotasELimitesPreservados() {
  assert.deepStrictEqual(
    [20, 40, 100].map(limite => {
      const cotas = calcularCotasFrescorPreImporter(limite);
      return [cotas.aguaNova, cotas.frescaEmRisco, cotas.frescaCirculavel, cotas.limpeza, cotas.totalSelecao];
    }),
    [[14, 4, 2, 4, 24], [28, 8, 4, 8, 48], [70, 20, 10, 20, 120]]
  );
  for (const limite of [20, 40, 100]) {
    assert(calcularCotasFrescorPreImporter(limite).totalSelecao * 3 <= 360, "pool deve ser bounded");
  }
}

function testarBaselinePermaneceFuncional() {
  const rows = [
    linha("baseline", 10, { baselineOrdem: 1, origem: "optimus" }),
    linha("baseline", 11, { baselineOrdem: 2, origem: "optimus" }),
    linha("candidate_pool", 10, { candidateOrigem: "baseline", origem: "optimus" }),
    linha("candidate_pool", 11, { candidateOrigem: "baseline", origem: "optimus" }),
    linha("candidate_pool", 999, { candidateOrigem: "head_protegida", origem: "clonador_grupos" })
  ];
  const resultado = separarResultadoJobsDiagnosticados(rows);
  assert.deepStrictEqual(resultado.jobs.map(item => item.id), [10, 11], "runner continua consumindo exclusivamente o baseline, na mesma ordem");
  assert.deepStrictEqual(resultado.candidatePool.map(item => item.id), [10, 11, 999]);
  assert.strictEqual(resultado.jobs[0].tipo_saida_pre_importer, undefined);
  assert.strictEqual(resultado.candidatePool[2].origemFluxo, "clonador_grupos");
  assert.strictEqual(resultado.candidatePool[2].origemFluxoHead, true);
}

function testarCabecaMinoritariaEOrigemLegada() {
  const baseline = Array.from({ length: 48 }, (_, indice) =>
    linha("baseline", indice + 1, { baselineOrdem: indice + 1, origem: "optimus", prioridade: 100 - indice })
  );
  const pool = [
    ...baseline.map(item => linha("candidate_pool", item.id, { candidateOrigem: "baseline", origem: "optimus" })),
    linha("candidate_pool", 1001, { candidateOrigem: "head_protegida", origem: "clonador_grupos" })
  ];
  const resultado = separarResultadoJobsDiagnosticados([...baseline, ...pool]);
  assert.strictEqual(resultado.jobs.length, 48);
  assert(!resultado.jobs.some(item => item.id === 1001), "esta fase nao ativa fairness");
  assert(resultado.candidatePool.some(item => item.id === 1001), "pool deve conter a cabeca Clone fora do baseline");
  assert.strictEqual(new Set(resultado.candidatePool.map(item => item.id)).size, resultado.candidatePool.length, "pool nao pode duplicar job.id");

  const legado = separarResultadoJobsDiagnosticados([
    linha("baseline", 2001, { baselineOrdem: 1, origem: "" }),
    linha("candidate_pool", 2001, { candidateOrigem: "baseline", origem: "" })
  ]);
  assert.strictEqual(legado.candidatePool[0].origemFluxo, undefined, "origem legada nao recebe terceira head");
}

function testarComposicoesDeOrigemELanes() {
  const somenteOptimUs = separarResultadoJobsDiagnosticados([
    linha("baseline", 3001, { baselineOrdem: 1, origem: "optimus", lane: "agua_nova" }),
    linha("candidate_pool", 3001, { candidateOrigem: "baseline", origem: "optimus", lane: "agua_nova" })
  ]);
  assert.deepStrictEqual(somenteOptimUs.jobs.map(item => item.id), [3001]);
  assert.deepStrictEqual(somenteOptimUs.candidatePool.map(item => item.id), [3001], "origem unica nao cria reserva artificial");

  const somenteClone = separarResultadoJobsDiagnosticados([
    linha("baseline", 3101, { baselineOrdem: 1, origem: "clonador_grupos", lane: "fresca_circulavel" }),
    linha("candidate_pool", 3101, { candidateOrigem: "baseline", origem: "clonador_grupos", lane: "fresca_circulavel" })
  ]);
  assert.deepStrictEqual(somenteClone.jobs.map(item => item.id), [3101]);
  assert.deepStrictEqual(somenteClone.candidatePool.map(item => item.id), [3101], "Clone unico tambem permanece work-conserving");

  const baselineClone = Array.from({ length: 48 }, (_, indice) =>
    linha("baseline", 3200 + indice, { baselineOrdem: indice + 1, origem: "clonador_grupos", prioridade: 100 - indice })
  );
  const inverso = separarResultadoJobsDiagnosticados([
    ...baselineClone,
    ...baselineClone.map(item => linha("candidate_pool", item.id, { candidateOrigem: "baseline", origem: "clonador_grupos" })),
    linha("candidate_pool", 3999, { candidateOrigem: "head_protegida", origem: "optimus" })
  ]);
  assert.strictEqual(inverso.jobs.length, 48);
  assert(!inverso.jobs.some(item => item.id === 3999), "a inversao ainda nao ativa fairness");
  assert(inverso.candidatePool.some(item => item.id === 3999), "pool preserva cabeca Optimus minoritaria");

  const multiplosGrupos = separarResultadoJobsDiagnosticados([
    linha("baseline", 4001, { baselineOrdem: 1, workspace: "workspace_a", lane: "agua_nova", origem: "optimus" }),
    linha("baseline", 4002, { baselineOrdem: 2, workspace: "workspace_b", lane: "fresca_em_risco", origem: "clonador_grupos" }),
    linha("candidate_pool", 4001, { candidateOrigem: "baseline", workspace: "workspace_a", lane: "agua_nova", origem: "optimus" }),
    linha("candidate_pool", 4002, { candidateOrigem: "baseline", workspace: "workspace_b", lane: "fresca_em_risco", origem: "clonador_grupos" }),
    linha("candidate_pool", 4003, { candidateOrigem: "head_protegida", workspace: "workspace_a", lane: "agua_nova", origem: "clonador_grupos" }),
    linha("candidate_pool", 4004, { candidateOrigem: "head_protegida", workspace: "workspace_b", lane: "fresca_em_risco", origem: "optimus" })
  ]);
  assert.deepStrictEqual(multiplosGrupos.jobs.map(item => item.id), [4001, 4002], "baseline conserva ordem em workspaces/lanes distintos");
  assert.deepStrictEqual(multiplosGrupos.candidatePool.map(item => item.id), [4001, 4002, 4003, 4004]);
}

function testarSqlSemFairnessOuMudancaClaim() {
  const sql = sqlBuscarJobsDiagnosticados();
  for (const trecho of ["baseline_bruto AS", "grupos_representados_baseline AS", "heads_protegidas_brutas AS", "candidate_pool_ranqueado AS", "saida_pre_importer AS"]) {
    assert(sql.includes(trecho), `SQL deve conter ${trecho}`);
  }
  assert(sql.includes("PARTITION BY id"));
  assert(sql.includes("origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')"));
  assert(!sql.includes("engine_fairness_origem_fluxo"));
  assert(!sql.includes("FOR UPDATE"), "candidate pool nao pode mudar o claim");
  for (const parametro of ["$1", "$2", "$3", "$4", "$5"]) assert(sql.includes(parametro));
}

testarCotasELimitesPreservados();
testarBaselinePermaneceFuncional();
testarCabecaMinoritariaEOrigemLegada();
testarComposicoesDeOrigemELanes();
testarSqlSemFairnessOuMudancaClaim();
console.log("engine-validator-candidate-pool.test.js OK");
