const assert = require("assert");

const {
  montarGruposFairness,
  montarSelecaoGrupo,
  reivindicarGrupoFairness
} = require("../modules/engine/processor-fairness.service");

function job(id, origemFluxo, extras = {}) {
  return {
    id,
    cliente_id: extras.clienteId || "workspace_a",
    lane_vazao_pre_importer: extras.lane || "agua_nova",
    workspace_rank_pre_importer: extras.rank || id,
    indiceBaseline: extras.indiceBaseline,
    origemFluxo,
    origemFluxoHead: extras.head === true,
    prioridade: extras.prioridade || 0,
    metadata: {}
  };
}

function grupoComDuasOrigens(orcamento = 20, origemMajoritaria = "optimus") {
  const origemMenor = origemMajoritaria === "optimus" ? "clonador_grupos" : "optimus";
  const baseline = Array.from({ length: orcamento }, (_, indice) => job(indice + 1, origemMajoritaria, {
    indiceBaseline: indice,
    rank: indice + 1,
    head: indice === 0
  }));
  const candidatePool = [
    ...baseline,
    job(1000, origemMenor, { rank: orcamento + 1, head: true })
  ];
  return montarGruposFairness(baseline, candidatePool)[0];
}

function contarPorOrigem(selecao = []) {
  return selecao.reduce((total, item) => {
    total[item.origemFluxo] = (total[item.origemFluxo] || 0) + 1;
    return total;
  }, {});
}

function testarWorkConservingEProtecao19Por1() {
  const somenteOptimus = montarGruposFairness(
    Array.from({ length: 20 }, (_, indice) => job(indice + 1, "optimus", { indiceBaseline: indice, head: indice === 0 })),
    Array.from({ length: 20 }, (_, indice) => job(indice + 1, "optimus", { indiceBaseline: indice, head: indice === 0 }))
  )[0];
  assert.strictEqual(montarSelecaoGrupo(somenteOptimus).selecionados.length, 20);
  assert.strictEqual(montarSelecaoGrupo(somenteOptimus).protegida, false);

  const optimusMaioria = montarSelecaoGrupo(grupoComDuasOrigens(20, "optimus"));
  assert.deepStrictEqual(contarPorOrigem(optimusMaioria.selecionados), { optimus: 19, clonador_grupos: 1 });

  const cloneMaioria = montarSelecaoGrupo(grupoComDuasOrigens(20, "clonador_grupos"));
  assert.deepStrictEqual(contarPorOrigem(cloneMaioria.selecionados), { clonador_grupos: 19, optimus: 1 });
}

function testarLaneComUmSlotAlterna() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  assert.strictEqual(montarSelecaoGrupo(grupo, "optimus").selecionados[0].origemFluxo, "clonador_grupos");
  assert.strictEqual(montarSelecaoGrupo(grupo, "clonador_grupos").selecionados[0].origemFluxo, "optimus");
  assert.strictEqual(montarSelecaoGrupo(grupo, "").selecionados[0].origemFluxo, "optimus", "sem historico usa ordem SQL deterministica");
}

function testarOrigemDesconhecidaNaoGanhaReserva() {
  const baseline = [
    job(1, "", { indiceBaseline: 0, rank: 1 }),
    job(2, "optimus", { indiceBaseline: 1, rank: 2, head: true })
  ];
  const grupo = montarGruposFairness(baseline, baseline)[0];
  const plano = montarSelecaoGrupo(grupo);
  assert.strictEqual(plano.protegida, false);
  assert.deepStrictEqual(plano.selecionados.map(item => item.id), [1, 2]);
}

function testarWorkspacesELanesNaoTransferemOrcamento() {
  const baseline = [
    job(1, "optimus", { clienteId: "workspace_a", lane: "agua_nova", indiceBaseline: 0, rank: 1, head: true }),
    job(2, "optimus", { clienteId: "workspace_b", lane: "agua_nova", indiceBaseline: 1, rank: 1, head: true }),
    job(3, "optimus", { clienteId: "workspace_a", lane: "fresca_em_risco", indiceBaseline: 2, rank: 1, head: true })
  ];
  const candidates = [
    ...baseline,
    job(1001, "clonador_grupos", { clienteId: "workspace_a", lane: "agua_nova", rank: 2, head: true }),
    job(1002, "clonador_grupos", { clienteId: "workspace_b", lane: "agua_nova", rank: 2, head: true }),
    job(1003, "clonador_grupos", { clienteId: "workspace_a", lane: "fresca_em_risco", rank: 2, head: true })
  ];
  const grupos = montarGruposFairness(baseline, candidates);
  assert.strictEqual(grupos.length, 3);
  for (const grupo of grupos) {
    const plano = montarSelecaoGrupo(grupo, "optimus");
    assert.strictEqual(plano.slots.length, 1, "cada workspace/lane conserva exatamente seu proprio orcamento");
    assert.strictEqual(plano.selecionados[0].origemFluxo, "clonador_grupos");
  }
}

function testarRankingInternoECloneEsporadico() {
  const grupo = grupoComDuasOrigens(20, "optimus");
  const plano = montarSelecaoGrupo(grupo);
  assert.strictEqual(plano.slots.length, 20);
  assert.strictEqual(plano.slots.at(-1).job.id, 1000, "a head esporadica substitui somente o ultimo slot do mesmo grupo");
  assert.deepStrictEqual(
    plano.slots.slice(0, -1).map(item => item.job.id),
    Array.from({ length: 19 }, (_, indice) => indice + 1),
    "o ranking SQL dos demais slots permanece inalterado"
  );
}

function criarPoolMemoria(idsPendentes = [], opcoes = {}) {
  const jobs = new Map(idsPendentes.map(id => [Number(id), "pendente"]));
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
        return { rows: [{ cliente_id: params[0], etapa: params[1], lane: params[2], ultima_origem_atendida: params[3] }], rowCount: 1 };
      }
      if (/UPDATE engine_jobs_cliente/i.test(sql)) {
        const rows = [];
        for (const id of params[0]) {
          if (jobs.get(Number(id)) !== "pendente") continue;
          jobs.set(Number(id), "processando");
          rows.push({ id: Number(id), status: "processando" });
        }
        return { rows, rowCount: rows.length };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
  return { pool: { connect: async () => client }, jobs, fairness };
}

async function testarClaimAtomicoAtualizaSomenteProtegidaConfirmada() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000]);
  const resultado = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.confirmados.map(item => item.job.id), [1]);
  assert.strictEqual(memoria.jobs.get(1), "processando");
  assert.strictEqual(memoria.jobs.get(1000), "pendente");
  assert.strictEqual(memoria.fairness.get("workspace_a|diagnostico_final|agua_nova").ultima, "optimus");
}

async function testarClaimPerdidoNaoAtualizaMemoria() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1000]);
  const resultado = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.confirmados.length, 0);
  assert.strictEqual(memoria.fairness.get("workspace_a|diagnostico_final|agua_nova").ultima, "");
}

async function testarClaimRepetidoNaoDuplicaNemAvancaMemoria() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000]);
  const primeiro = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  const segundo = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  assert.strictEqual(primeiro.confirmados.length, 1);
  assert.strictEqual(segundo.confirmados.length, 1, "o segundo claim pode obter apenas o job alternado ainda pendente");
  assert.notStrictEqual(primeiro.confirmados[0].job.id, segundo.confirmados[0].job.id, "um job nao pode ser reivindicado duas vezes");
  assert.strictEqual(memoria.fairness.get("workspace_a|diagnostico_final|agua_nova").ultima, "clonador_grupos");
}

async function testarRollbackDesfazClaimEMemoria() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000], { falharAoRegistrarFairness: true });
  const resultado = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(memoria.jobs.get(1), "pendente", "rollback devolve o claim do job");
  assert.strictEqual(memoria.jobs.get(1000), "pendente", "rollback nao modifica o outro candidato");
  assert.strictEqual(memoria.fairness.size, 0, "rollback nao persiste a memoria de fairness");
}

(async () => {
  testarWorkConservingEProtecao19Por1();
  testarLaneComUmSlotAlterna();
  testarOrigemDesconhecidaNaoGanhaReserva();
  testarWorkspacesELanesNaoTransferemOrcamento();
  testarRankingInternoECloneEsporadico();
  await testarClaimAtomicoAtualizaSomenteProtegidaConfirmada();
  await testarClaimPerdidoNaoAtualizaMemoria();
  await testarClaimRepetidoNaoDuplicaNemAvancaMemoria();
  await testarRollbackDesfazClaimEMemoria();
  console.log("engine-processor-origem-fairness.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
