const assert = require("assert");

const {
  sqlBuscarJobsPendentes,
  separarResultadoJobsPendentes
} = require("../modules/engine/processor.service");
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

function testarCotasPreservadas() {
  assert.deepStrictEqual(
    [20, 40, 100].map(limite => {
      const cotas = calcularCotasFrescorPreImporter(limite);
      return [cotas.aguaNova, cotas.frescaEmRisco, cotas.frescaCirculavel, cotas.limpeza, cotas.totalSelecao];
    }),
    [[14, 4, 2, 4, 24], [28, 8, 4, 8, 48], [70, 20, 10, 20, 120]]
  );
}

function testarBaselinePermaneceSaidaFuncional() {
  const rows = [
    linha("baseline", 10, { baselineOrdem: 1, origem: "optimus" }),
    linha("baseline", 11, { baselineOrdem: 2, origem: "optimus" }),
    linha("candidate_pool", 10, { candidateOrigem: "baseline", origem: "optimus" }),
    linha("candidate_pool", 11, { candidateOrigem: "baseline", origem: "optimus" }),
    linha("candidate_pool", 999, { candidateOrigem: "head_protegida", origem: "clonador_grupos" })
  ];
  const resultado = separarResultadoJobsPendentes(rows);

  assert.deepStrictEqual(resultado.jobs.map(item => item.id), [10, 11], "saida funcional deve continuar somente no baseline e na mesma ordem");
  assert.deepStrictEqual(resultado.candidatePool.map(item => item.id), [10, 11, 999]);
  assert.strictEqual(resultado.jobs[0].tipo_saida_pre_importer, undefined, "marcadores internos nao vazam para o Processor");
  assert.strictEqual(resultado.jobs[0].bucket_selecao_pre_importer, 0, "campo historico do baseline permanece disponivel");
  assert.strictEqual(resultado.candidatePool[2].origem_fluxo_explicita_pre_importer, undefined, "pool interno nao vaza chaves SQL para consumidores");
  assert.strictEqual(resultado.candidatePool[2].origemFluxo, "clonador_grupos", "pool preserva a identidade explicita para a proxima fase");
}

function testarCenarioCloneForaDoBaselineVisivelNoPool() {
  const baseline = Array.from({ length: 20 }, (_, indice) =>
    linha("baseline", indice + 1, { baselineOrdem: indice + 1, origem: "optimus", prioridade: 100 - indice })
  );
  const pool = [
    ...baseline.map(item => linha("candidate_pool", item.id, { candidateOrigem: "baseline", origem: "optimus" })),
    linha("candidate_pool", 1001, { candidateOrigem: "head_protegida", origem: "clonador_grupos" })
  ];
  const resultado = separarResultadoJobsPendentes([...baseline, ...pool]);

  assert.strictEqual(resultado.jobs.length, 20);
  assert(!resultado.jobs.some(item => item.id === 1001), "esta fase nao ativa fairness nem altera a saida funcional");
  assert(resultado.candidatePool.some(item => item.id === 1001), "cabeca Clone deve ficar visivel para a fase seguinte");
  assert.strictEqual(new Set(resultado.candidatePool.map(item => item.id)).size, resultado.candidatePool.length, "pool nao pode conter job duplicado");
}

function testarSqlProtegeSomenteOrigemExplicitaEGruposRepresentados() {
  const sql = sqlBuscarJobsPendentes();
  assert(sql.includes("baseline_bruto AS"));
  assert(sql.includes("grupos_representados_baseline AS"));
  assert(sql.includes("heads_protegidas_brutas AS"));
  assert(sql.includes("candidate_pool_ranqueado AS"));
  assert(sql.includes("PARTITION BY id"), "deduplicacao SQL deve ser por job.id");
  assert(sql.includes("origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')"));
  assert(sql.includes("JOIN grupos_representados_baseline"), "heads devem existir apenas para workspace/lane ja contemplados no baseline");
  assert(!sql.includes("clonadorGrupos"), "selector nao pode inferir Clonador por metadata legada");
  for (const parametro of ["$1", "$2", "$3", "$4", "$5"]) {
    assert(sql.includes(parametro), `query deve preservar parametro ${parametro}`);
  }
}

function testarCardinalidadeLimitada() {
  for (const limite of [20, 40, 100]) {
    const cotas = calcularCotasFrescorPreImporter(limite);
    const maximoPool = cotas.totalSelecao * 3;
    assert(maximoPool <= 360, `pool deve permanecer limitado para limite=${limite}`);
  }
}

testarCotasPreservadas();
testarBaselinePermaneceSaidaFuncional();
testarCenarioCloneForaDoBaselineVisivelNoPool();
testarSqlProtegeSomenteOrigemExplicitaEGruposRepresentados();
testarCardinalidadeLimitada();
console.log("engine-processor-candidate-pool.test.js OK");
