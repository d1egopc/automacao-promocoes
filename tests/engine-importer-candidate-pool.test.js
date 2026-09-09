const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  separarResultadoJobsProntos
} = require("../modules/engine/importer/importer.service");
const { calcularCotasFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");

function linha(tipo, id, extras = {}) {
  return {
    tipo_saida_pre_importer: tipo,
    id,
    cliente_id: extras.cliente_id || "workspace_a",
    marketplace: extras.marketplace || "mercadolivre",
    metadata: extras.metadata || {},
    prioridade: extras.prioridade || 0,
    lane_vazao_pre_importer: extras.lane || "agua_nova",
    workspace_chave_pre_importer: extras.workspace || "workspace_a",
    marketplace_chave_pre_importer: extras.marketplace || "mercadolivre",
    origem_fluxo_explicita_pre_importer: extras.origem || "",
    origem_head_rank_pre_importer: extras.headRank || 1,
    bucket_selecao_pre_importer: extras.bucket || 0,
    baseline_ordem_pre_importer: extras.baselineOrdem || null,
    candidate_pool_origem_pre_importer: extras.candidateOrigem || null,
    candidate_pool_dedup_rank_pre_importer: 1,
    evento_metadata: {},
    ...extras
  };
}

function separar(baseline, pool) {
  return separarResultadoJobsProntos([
    ...baseline.map(item => linha("baseline", item.id, item)),
    ...pool.map(item => linha("candidate_pool", item.id, item))
  ]);
}

function testarBaselinePermaneceImutavel() {
  const baseline = [
    { id: 10, baselineOrdem: 1, origem: "optimus" },
    { id: 11, baselineOrdem: 2, origem: "optimus" }
  ];
  const resultado = separar(baseline, [
    { id: 10, candidateOrigem: "baseline", origem: "optimus" },
    { id: 11, candidateOrigem: "baseline", origem: "optimus" },
    { id: 999, candidateOrigem: "head_protegida", origem: "clonador_grupos" }
  ]);

  assert.deepStrictEqual(resultado.jobs.map(item => item.id), [10, 11]);
  assert.strictEqual(resultado.jobs[0].origemFluxo, undefined, "runner continua recebendo o mesmo objeto baseline");
  assert.deepStrictEqual(resultado.candidatePool.map(item => item.id), [10, 11, 999]);
  assert.strictEqual(resultado.candidatePool[2].origemFluxo, "clonador_grupos");
  assert.strictEqual(resultado.candidatePool[2].origemFluxoHead, true);
}

function testarHeadsPorOrigemSemReserva() {
  const baselineOptimUs = Array.from({ length: 20 }, (_, indice) => ({
    id: indice + 1, baselineOrdem: indice + 1, origem: "optimus", prioridade: 100 - indice
  }));
  const comClone = separar(baselineOptimUs, [
    ...baselineOptimUs.map(item => ({ ...item, candidateOrigem: "baseline" })),
    { id: 1001, candidateOrigem: "head_protegida", origem: "clonador_grupos", prioridade: 1 }
  ]);
  assert.strictEqual(comClone.jobs.length, 20);
  assert(!comClone.jobs.some(item => item.id === 1001), "pool ainda nao ativa fairness");
  assert(comClone.candidatePool.some(item => item.id === 1001), "head Clone fora do baseline fica visivel");
  assert.strictEqual(new Set(comClone.candidatePool.map(item => item.id)).size, comClone.candidatePool.length, "dedup e por job.id");

  const somenteOptimUs = separar([{ id: 2001, origem: "optimus", baselineOrdem: 1 }], [{ id: 2001, origem: "optimus", candidateOrigem: "baseline" }]);
  const somenteClone = separar([{ id: 3001, origem: "clonador_grupos", baselineOrdem: 1 }], [{ id: 3001, origem: "clonador_grupos", candidateOrigem: "baseline" }]);
  assert.deepStrictEqual(somenteOptimUs.candidatePool.map(item => item.id), [2001]);
  assert.deepStrictEqual(somenteClone.candidatePool.map(item => item.id), [3001]);
}

function testarGruposELimites() {
  const multiplos = separar([
    { id: 4001, workspace: "workspace_a", marketplace: "mercadolivre", lane: "agua_nova", origem: "optimus", baselineOrdem: 1 },
    { id: 4002, workspace: "workspace_b", marketplace: "amazon", lane: "fresca_em_risco", origem: "clonador_grupos", baselineOrdem: 2 }
  ], [
    { id: 4001, workspace: "workspace_a", marketplace: "mercadolivre", lane: "agua_nova", origem: "optimus", candidateOrigem: "baseline" },
    { id: 4003, workspace: "workspace_a", marketplace: "mercadolivre", lane: "agua_nova", origem: "clonador_grupos", candidateOrigem: "head_protegida" },
    { id: 4002, workspace: "workspace_b", marketplace: "amazon", lane: "fresca_em_risco", origem: "clonador_grupos", candidateOrigem: "baseline" },
    { id: 4004, workspace: "workspace_b", marketplace: "amazon", lane: "fresca_em_risco", origem: "optimus", candidateOrigem: "head_protegida" }
  ]);
  assert.deepStrictEqual(multiplos.candidatePool.map(item => item.id), [4001, 4003, 4002, 4004]);

  for (const limite of [20, 50, 60, 100]) {
    const B = calcularCotasFrescorPreImporter(limite).totalSelecao;
    const G = B;
    assert(B + (2 * G) <= 3 * B);
  }
  assert.strictEqual(calcularCotasFrescorPreImporter(20).totalSelecao * 3, 72);
  assert.strictEqual(calcularCotasFrescorPreImporter(50).totalSelecao * 3, 180);
  assert.strictEqual(calcularCotasFrescorPreImporter(60).totalSelecao * 3, 216);
  assert.strictEqual(calcularCotasFrescorPreImporter(100).totalSelecao * 3, 360);

  const expirada = separar([
    { id: 5001, lane: "expirada", origem: "optimus", baselineOrdem: 1 }
  ], [
    { id: 5001, lane: "expirada", origem: "optimus", candidateOrigem: "baseline" }
  ]);
  assert.deepStrictEqual(expirada.candidatePool.map(item => item.id), [5001], "expirada preserva somente o baseline");

  const legado = separar([
    { id: 6001, origem: "", baselineOrdem: 1 }
  ], [
    { id: 6001, origem: "", candidateOrigem: "baseline" }
  ]);
  assert.strictEqual(legado.candidatePool[0].origemFluxo, undefined, "origem legada nao ganha terceira head");
}

function testarSelectorSql() {
  const arquivo = path.join(__dirname, "..", "modules", "engine", "importer", "importer.service.js");
  const codigo = fs.readFileSync(arquivo, "utf8");
  assert(codigo.includes("baseline_bruto AS"));
  assert(codigo.includes("grupos_representados_baseline AS"));
  assert(codigo.includes("marketplace_chave_pre_importer"), "grupo inclui marketplace mesmo em chamadas diretas");
  assert(codigo.includes("WHERE lane_vazao_pre_importer <> 'expirada'"), "expirada nao produz heads");
  assert(codigo.includes("origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')"));
  assert(codigo.includes("PARTITION BY id"), "dedup SQL e por job.id");
  assert(codigo.includes("tipo_saida_pre_importer === \"baseline\""), "jobs continua filtrado apenas no baseline");
  assert(!codigo.includes("origem-fairness.repository"), "candidate pool nao consulta memoria de fairness");
}

testarBaselinePermaneceImutavel();
testarHeadsPorOrigemSemReserva();
testarGruposELimites();
testarSelectorSql();
console.log("engine-importer-candidate-pool.test.js OK");
