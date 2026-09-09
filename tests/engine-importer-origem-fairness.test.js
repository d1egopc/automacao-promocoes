const assert = require("assert");

const {
  montarGruposFairness,
  montarSelecaoGrupo,
  reivindicarSlotFairness
} = require("../modules/engine/importer/importer-fairness.service");

function job(id, origemFluxo, extras = {}) {
  return {
    id,
    cliente_id: extras.clienteId || "workspace_a",
    marketplace: extras.marketplace || "mercadolivre",
    marketplace_detectado: extras.marketplace || "mercadolivre",
    lane_vazao_pre_importer: extras.lane || "agua_nova",
    workspace_rank_pre_importer: extras.rank || id,
    indiceBaseline: extras.indiceBaseline,
    origemFluxo,
    origemFluxoHead: extras.head === true,
    prioridade: extras.prioridade || 0,
    metadata: {}
  };
}

function grupoComDuasOrigens(orcamento = 20, origemMajoritaria = "optimus", extras = {}) {
  const origemMenor = origemMajoritaria === "optimus" ? "clonador_grupos" : "optimus";
  const baseline = Array.from({ length: orcamento }, (_, indice) => job(indice + 1, origemMajoritaria, {
    ...extras, indiceBaseline: indice, rank: indice + 1, head: indice === 0
  }));
  const candidatePool = [...baseline, job(1000, origemMenor, { ...extras, rank: orcamento + 1, head: true })];
  return montarGruposFairness(baseline, candidatePool)[0];
}

function contarPorOrigem(selecao = []) {
  return selecao.reduce((total, item) => {
    total[item.origemFluxo] = (total[item.origemFluxo] || 0) + 1;
    return total;
  }, {});
}

function criarPoolMemoria(idsPendentes = [], opcoes = {}) {
  const jobs = new Map(idsPendentes.map(id => [Number(id), "pronto_para_importar"]));
  const fairness = new Map();
  let copiaJobs = null;
  let copiaFairness = null;
  const client = {
    release() {},
    async query(sql, params = []) {
      if (sql === "BEGIN") {
        copiaJobs = new Map(jobs);
        copiaFairness = new Map([...fairness.entries()].map(([chave, valor]) => [chave, { ...valor }]));
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        jobs.clear(); for (const [id, status] of copiaJobs.entries()) jobs.set(id, status);
        fairness.clear(); for (const [chave, valor] of copiaFairness.entries()) fairness.set(chave, { ...valor });
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") return { rows: [], rowCount: 0 };

      const chave = params.slice(0, 3).join("|");
      if (/INSERT INTO engine_fairness_origem_fluxo/i.test(sql)) {
        if (!fairness.has(chave)) fairness.set(chave, { ultima: "" });
        return { rows: [], rowCount: 0 };
      }
      if (/FROM engine_fairness_origem_fluxo/i.test(sql) && /SELECT/i.test(sql)) {
        const estado = fairness.get(chave) || { ultima: "" };
        return { rows: [{ cliente_id: params[0], etapa: params[1], lane: params[2], ultima_origem_atendida: estado.ultima }], rowCount: 1 };
      }
      if (/UPDATE engine_fairness_origem_fluxo/i.test(sql)) {
        if (opcoes.falharAoRegistrarFairness) throw new Error("falha_forcada_fairness");
        fairness.set(chave, { ultima: params[3] });
        return { rows: [{ ultima_origem_atendida: params[3] }], rowCount: 1 };
      }
      if (/UPDATE engine_jobs_cliente/i.test(sql)) {
        const id = Number(params[0]);
        if (jobs.get(id) !== "pronto_para_importar") return { rows: [], rowCount: 0 };
        jobs.set(id, "importando");
        return { rows: [{ id, status: "importando" }], rowCount: 1 };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
  return { pool: { connect: async () => client }, jobs, fairness };
}

function testarOrcamentoEIsolamento() {
  const optimus = montarSelecaoGrupo(grupoComDuasOrigens(20, "optimus"));
  const clone = montarSelecaoGrupo(grupoComDuasOrigens(20, "clonador_grupos"));
  assert.deepStrictEqual(contarPorOrigem(optimus.selecionados), { optimus: 19, clonador_grupos: 1 });
  assert.deepStrictEqual(contarPorOrigem(clone.selecionados), { clonador_grupos: 19, optimus: 1 });

  const aguaNova = montarSelecaoGrupo(grupoComDuasOrigens(14, "optimus"));
  assert.deepStrictEqual(contarPorOrigem(aguaNova.selecionados), { optimus: 13, clonador_grupos: 1 });

  const laneUm = grupoComDuasOrigens(1, "optimus");
  assert.strictEqual(montarSelecaoGrupo(laneUm, "optimus").selecionados[0].origemFluxo, "clonador_grupos");
  assert.strictEqual(montarSelecaoGrupo(laneUm, "clonador_grupos").selecionados[0].origemFluxo, "optimus");

  const grupos = montarGruposFairness([
    job(1, "optimus", { clienteId: "workspace_a", marketplace: "mercadolivre", lane: "agua_nova", indiceBaseline: 0, head: true }),
    job(2, "optimus", { clienteId: "workspace_a", marketplace: "amazon", lane: "agua_nova", indiceBaseline: 1, head: true }),
    job(3, "optimus", { clienteId: "workspace_b", marketplace: "mercadolivre", lane: "fresca_em_risco", indiceBaseline: 2, head: true })
  ], []);
  assert.strictEqual(grupos.length, 3, "workspace, marketplace e lane isolam a unidade de fairness");
}

async function testarClaimAtomicoEMemoria() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000]);
  const primeiro = await reivindicarSlotFairness(grupo, 0, { pool: memoria.pool });
  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(primeiro.job.id, 1, "sem historico usa ordem SQL deterministica");
  assert.strictEqual(memoria.jobs.get(1), "importando");
  assert.strictEqual(memoria.fairness.get("workspace_a|importacao_final|mercadolivre:agua_nova").ultima, "optimus");

  const segundo = await reivindicarSlotFairness(grupo, 0, { pool: memoria.pool });
  assert.strictEqual(segundo.ok, true);
  assert.strictEqual(segundo.job.id, 1000, "lane de um slot alterna apos claim protegido confirmado");
  assert.strictEqual(memoria.fairness.get("workspace_a|importacao_final|mercadolivre:agua_nova").ultima, "clonador_grupos");
}

async function testarClaimPerdidoERollback() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const perdido = criarPoolMemoria([]);
  const resultadoPerdido = await reivindicarSlotFairness(grupo, 0, { pool: perdido.pool });
  assert.strictEqual(resultadoPerdido.ok, true);
  assert.strictEqual(resultadoPerdido.ignorado, true);
  assert.strictEqual(perdido.fairness.get("workspace_a|importacao_final|mercadolivre:agua_nova").ultima, "", "claim perdido nao atualiza memoria");

  const rollback = criarPoolMemoria([1, 1000], { falharAoRegistrarFairness: true });
  const resultadoRollback = await reivindicarSlotFairness(grupo, 0, { pool: rollback.pool });
  assert.strictEqual(resultadoRollback.ok, false);
  assert.strictEqual(rollback.jobs.get(1), "pronto_para_importar", "rollback desfaz claim");
  assert.strictEqual(rollback.fairness.size, 0, "rollback desfaz memoria");
}

(async () => {
  testarOrcamentoEIsolamento();
  await testarClaimAtomicoEMemoria();
  await testarClaimPerdidoERollback();
  console.log("engine-importer-origem-fairness.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
