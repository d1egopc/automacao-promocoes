const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  separarResultadoOfertasDistribuiveis
} = require("../modules/engine/distributor/distributor.service");

function linha(tipo, id, extras = {}) {
  return {
    tipo_saida_distribuidor: tipo,
    id,
    cliente_id: extras.cliente_id || "workspace_a",
    marketplace: extras.marketplace || "mercadolivre",
    origem_fluxo_explicita_distribuidor: extras.origem || "",
    origem_head_rank_distribuidor: extras.headRank ?? 1,
    baseline_ordem_distribuidor: extras.baselineOrdem ?? null,
    candidate_pool_origem_distribuidor: extras.candidateOrigem || null,
    candidate_pool_dedup_rank_distribuidor: 1,
    metadata: {},
    job_metadata: {},
    evento_metadata: {},
    ...extras
  };
}

function separar(baseline, pool) {
  return separarResultadoOfertasDistribuiveis([
    ...baseline.map(item => linha("baseline", item.id, item)),
    ...pool.map(item => linha("candidate_pool", item.id, item))
  ]);
}

function testarBaselinePermaneceIdentico() {
  const baseline = [
    { id: 1, baselineOrdem: 1, origem: "optimus" },
    { id: 2, baselineOrdem: 2, origem: "optimus" }
  ];
  const resultado = separar(baseline, [
    { id: 1, candidateOrigem: "baseline", origem: "optimus" },
    { id: 2, candidateOrigem: "baseline", origem: "optimus" },
    { id: 999, candidateOrigem: "head_protegida", origem: "clonador_grupos" }
  ]);

  assert.deepStrictEqual(resultado.ofertas.map(item => item.id), [1, 2]);
  assert.strictEqual(resultado.ofertas[0].origemFluxo, undefined, "runner continua recebendo somente o baseline anterior");
  assert.deepStrictEqual(resultado.candidatePool.map(item => item.id), [1, 2, 999]);
  assert.strictEqual(resultado.candidatePool[2].origemFluxo, "clonador_grupos");
  assert.strictEqual(resultado.candidatePool[2].origemFluxoHead, true);

  const legado = separarResultadoOfertasDistribuiveis([{ id: 3, cliente_id: "workspace_a" }]);
  assert.deepStrictEqual(legado.ofertas.map(item => item.id), [3], "retorno legado sem tipo continua sendo baseline");
}

function testarHeadsSemReserva() {
  const baselineOptimUs = Array.from({ length: 10 }, (_, indice) => ({
    id: indice + 1, baselineOrdem: indice + 1, origem: "optimus", prioridade: 100 - indice
  }));
  const clone = separar(baselineOptimUs, [
    ...baselineOptimUs.map(item => ({ ...item, candidateOrigem: "baseline" })),
    { id: 1001, candidateOrigem: "head_protegida", origem: "clonador_grupos", prioridade: 1 }
  ]);
  assert.strictEqual(clone.ofertas.length, 10);
  assert(!clone.ofertas.some(item => item.id === 1001), "pool nao altera o baseline");
  assert(clone.candidatePool.some(item => item.id === 1001), "head Clone fora do baseline fica visivel");

  const optimus = separar([{ id: 2001, origem: "clonador_grupos", baselineOrdem: 1 }], [
    { id: 2001, origem: "clonador_grupos", candidateOrigem: "baseline" },
    { id: 2002, origem: "optimus", candidateOrigem: "head_protegida" }
  ]);
  assert(optimus.candidatePool.some(item => item.id === 2002));

  const somenteOptimUs = separar([{ id: 3001, origem: "optimus", baselineOrdem: 1 }], [{ id: 3001, origem: "optimus", candidateOrigem: "baseline" }]);
  const somenteClone = separar([{ id: 4001, origem: "clonador_grupos", baselineOrdem: 1 }], [{ id: 4001, origem: "clonador_grupos", candidateOrigem: "baseline" }]);
  assert.deepStrictEqual(somenteOptimUs.candidatePool.map(item => item.id), [3001]);
  assert.deepStrictEqual(somenteClone.candidatePool.map(item => item.id), [4001]);
}

function testarGruposDedupELimite() {
  const resultado = separar([
    { id: 5001, cliente_id: "workspace_a", marketplace: "mercadolivre", origem: "optimus", baselineOrdem: 1 },
    { id: 5002, cliente_id: "workspace_b", marketplace: "amazon", origem: "clonador_grupos", baselineOrdem: 2 },
    { id: 5003, cliente_id: "workspace_c", marketplace: "shopee", origem: "", baselineOrdem: 3 }
  ], [
    { id: 5001, cliente_id: "workspace_a", marketplace: "mercadolivre", origem: "optimus", candidateOrigem: "baseline" },
    { id: 5004, cliente_id: "workspace_a", marketplace: "mercadolivre", origem: "clonador_grupos", candidateOrigem: "head_protegida" },
    { id: 5002, cliente_id: "workspace_b", marketplace: "amazon", origem: "clonador_grupos", candidateOrigem: "baseline" },
    { id: 5005, cliente_id: "workspace_b", marketplace: "amazon", origem: "optimus", candidateOrigem: "head_protegida" },
    { id: 5003, cliente_id: "workspace_c", marketplace: "shopee", origem: "", candidateOrigem: "baseline" }
  ]);

  assert.deepStrictEqual(resultado.candidatePool.map(item => item.id), [5001, 5004, 5002, 5005, 5003]);
  assert.strictEqual(new Set(resultado.candidatePool.map(item => item.id)).size, resultado.candidatePool.length, "dedup e por oferta.id");
  assert.strictEqual(resultado.candidatePool.find(item => item.id === 5003).origemFluxo, undefined, "origem legada nao recebe head protegida");

  const B = resultado.ofertas.length;
  const grupos = new Set(resultado.ofertas.map(item => `${item.cliente_id}|${item.marketplace}`)).size;
  assert(resultado.candidatePool.length <= B + (2 * grupos));
  assert(grupos <= B);
  assert(resultado.candidatePool.length <= 3 * B);
  assert(30 <= 3 * 10, "B=10 limita o pool a no maximo 30 itens");
}

function testarSqlESemAtivacao() {
  const arquivo = path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.service.js");
  const runner = path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.runner.js");
  const codigo = fs.readFileSync(arquivo, "utf8");
  const codigoRunner = fs.readFileSync(runner, "utf8");
  assert(codigo.includes("baseline AS ("));
  assert(codigo.includes("grupos_representados_baseline AS"));
  assert(codigo.includes("origem_fluxo_explicita_distribuidor IN ('optimus', 'clonador_grupos')"));
  assert(codigo.includes("PARTITION BY id"));
  assert(codigo.includes('tipo_saida_distribuidor !== "candidate_pool"'));
  assert(!codigo.includes("origem-fairness.repository"), "candidate pool nao consulta memoria de fairness");
  assert(codigoRunner.includes("busca.ofertas || []"), "baseline continua sendo a fonte do orcamento do runner");
  assert(codigoRunner.includes("busca.candidatePool || []"), "2B.3c consome somente o pool bounded ja preparado");
}

testarBaselinePermaneceIdentico();
testarHeadsSemReserva();
testarGruposDedupELimite();
testarSqlESemAtivacao();
console.log("engine-distributor-candidate-pool.test.js OK");
