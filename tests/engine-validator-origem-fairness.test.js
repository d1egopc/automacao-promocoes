"use strict";

const assert = require("assert");
const {
  montarGruposFairness,
  montarSelecaoGrupo,
  reivindicarGrupoFairness
} = require("../modules/engine/validator-fairness.service");

function limpar(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mock(relativo, exports) {
  const resolvido = limpar(relativo);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
  return resolvido;
}

function restaurar(resolvido, original) {
  delete require.cache[resolvido];
  if (original) require.cache[resolvido] = original;
}

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

function grupoComDuasOrigens(orcamento = 20, origemMajoritaria = "optimus", extras = {}) {
  const origemMenor = origemMajoritaria === "optimus" ? "clonador_grupos" : "optimus";
  const baseline = Array.from({ length: orcamento }, (_, indice) => job(indice + 1, origemMajoritaria, {
    ...extras,
    indiceBaseline: indice,
    rank: indice + 1,
    head: indice === 0
  }));
  const candidatePool = [
    ...baseline,
    job(1000, origemMenor, { ...extras, rank: orcamento + 1, head: true })
  ];
  return montarGruposFairness(baseline, candidatePool)[0];
}

function contarPorOrigem(selecao = []) {
  return selecao.reduce((total, item) => {
    total[item.origemFluxo] = (total[item.origemFluxo] || 0) + 1;
    return total;
  }, {});
}

function testarPlanoWorkConservingEFairness() {
  const somenteOptimus = montarGruposFairness(
    Array.from({ length: 20 }, (_, indice) => job(indice + 1, "optimus", { indiceBaseline: indice, head: indice === 0 })),
    Array.from({ length: 20 }, (_, indice) => job(indice + 1, "optimus", { indiceBaseline: indice, head: indice === 0 }))
  )[0];
  assert.strictEqual(montarSelecaoGrupo(somenteOptimus).selecionados.length, 20);
  assert.strictEqual(montarSelecaoGrupo(somenteOptimus).protegida, false, "origem unica usa todo o orcamento sem tocar memoria");

  const optimusMaioria = montarSelecaoGrupo(grupoComDuasOrigens(20, "optimus"));
  assert.deepStrictEqual(contarPorOrigem(optimusMaioria.selecionados), { optimus: 19, clonador_grupos: 1 });
  const cloneMaioria = montarSelecaoGrupo(grupoComDuasOrigens(20, "clonador_grupos"));
  assert.deepStrictEqual(contarPorOrigem(cloneMaioria.selecionados), { clonador_grupos: 19, optimus: 1 });
  assert.strictEqual(optimusMaioria.slots.length, 20, "fairness nao cria slot");
}

function testarLaneUmAlternaEOrigensIndependentes() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  assert.strictEqual(montarSelecaoGrupo(grupo, "optimus").selecionados[0].origemFluxo, "clonador_grupos");
  assert.strictEqual(montarSelecaoGrupo(grupo, "clonador_grupos").selecionados[0].origemFluxo, "optimus");
  assert.strictEqual(montarSelecaoGrupo(grupo, "").selecionados[0].origemFluxo, "optimus", "sem memoria usa a ordem SQL deterministica");

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
  for (const item of montarGruposFairness(baseline, candidates)) {
    const plano = montarSelecaoGrupo(item, "optimus");
    assert.strictEqual(plano.selecionados.length, 1);
    assert.strictEqual(plano.selecionados[0].origemFluxo, "clonador_grupos", "workspace/lane possuem memoria independente");
  }
}

function testarLegadoNaoRecebeProtecao() {
  const baseline = [job(1, "", { indiceBaseline: 0, rank: 1 }), job(2, "optimus", { indiceBaseline: 1, rank: 2, head: true })];
  const grupo = montarGruposFairness(baseline, baseline)[0];
  const plano = montarSelecaoGrupo(grupo);
  assert.strictEqual(plano.protegida, false);
  assert.deepStrictEqual(plano.selecionados.map(item => item.id), [1, 2]);
}

function criarPoolMemoria(idsDiagnosticados = [], opcoes = {}) {
  const jobs = new Map(idsDiagnosticados.map(id => [Number(id), "diagnosticado"]));
  const fairness = new Map();
  const consultas = [];
  let copiaJobs = null;
  let copiaFairness = null;
  const client = {
    release() {},
    async query(sql, params = []) {
      consultas.push({ sql, params });
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
          if (jobs.get(Number(id)) !== "diagnosticado") continue;
          jobs.set(Number(id), "validando");
          rows.push({ id: Number(id), status: "validando" });
        }
        return { rows, rowCount: rows.length };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
  return { pool: { connect: async () => client }, jobs, fairness, consultas };
}

async function testarClaimAtomicoEFalhas() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000]);
  const resultado = await reivindicarGrupoFairness(grupo, { pool: memoria.pool });
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.confirmados.map(item => item.job.id), [1]);
  assert.strictEqual(memoria.jobs.get(1), "validando");
  assert.strictEqual(memoria.fairness.get("workspace_a|validacao_final|agua_nova").ultima, "optimus");

  const perdido = criarPoolMemoria([1]);
  perdido.fairness.set("workspace_a|validacao_final|agua_nova", { ultima: "optimus" });
  const planoPerdido = await reivindicarGrupoFairness(grupoComDuasOrigens(1, "optimus"), { pool: perdido.pool });
  assert.strictEqual(planoPerdido.ok, true);
  assert.deepStrictEqual(planoPerdido.confirmados.map(item => item.job.id), [1], "claim protegido perdido e preenchido pelo baseline disponivel");
  assert.strictEqual(perdido.fairness.get("workspace_a|validacao_final|agua_nova").ultima, "optimus", "claim protegido perdido nao avanca memoria");
  assert.strictEqual(perdido.consultas.filter(item => /UPDATE engine_fairness_origem_fluxo/i.test(item.sql)).length, 0, "claim protegido perdido nao atualiza memoria");

  const rollback = criarPoolMemoria([1, 1000], { falharAoRegistrarFairness: true });
  const falhou = await reivindicarGrupoFairness(grupoComDuasOrigens(1, "optimus"), { pool: rollback.pool });
  assert.strictEqual(falhou.ok, false);
  assert.strictEqual(rollback.jobs.get(1), "diagnosticado");
  assert.strictEqual(rollback.jobs.get(1000), "diagnosticado");
  assert.strictEqual(rollback.fairness.size, 0, "rollback desfaz claim e memoria juntos");
}

async function testarRunnerValidaSomenteConfirmadoPelaFairness() {
  const validatorPath = require.resolve("../modules/engine/validator.service");
  const fairnessPath = require.resolve("../modules/engine/validator-fairness.service");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const frescorPath = require.resolve("../modules/engine/frescor-pre-importer.service");
  const loggerPath = require.resolve("../modules/engine/logger");
  const runnerPath = require.resolve("../modules/engine/validator.runner");
  const originais = {
    validator: require.cache[validatorPath], fairness: require.cache[fairnessPath],
    processor: require.cache[processorPath], frescor: require.cache[frescorPath],
    logger: require.cache[loggerPath], runner: require.cache[runnerPath]
  };
  const validados = [];
  try {
    mock("../modules/engine/validator.service", {
      recuperarJobsValidandoStale: async () => ({ ok: true, recuperados: 0 }),
      buscarJobsDiagnosticados: async () => ({
        ok: true,
        jobs: [job(1, "optimus", { indiceBaseline: 0, head: true })],
        candidatePool: [job(1, "optimus", { indiceBaseline: 0, head: true }), job(1000, "clonador_grupos", { head: true })]
      }),
      tentarMarcarValidando: async () => { throw new Error("claim_individual_nao_deve_ocorrer_no_grupo_disputado"); },
      validarJobDiagnosticadoEngine: async item => { validados.push(item.id); return { status: "pronto_para_importar" }; }
    });
    mock("../modules/engine/validator-fairness.service", {
      chaveGrupo: () => "workspace_a|agua_nova",
      montarGruposFairness: () => [{ chave: "workspace_a|agua_nova" }],
      headsProtegidas: () => new Set(["optimus", "clonador_grupos"]),
      reivindicarGrupoFairness: async () => ({ ok: true, confirmados: [{ posicao: 0, job: job(1000, "clonador_grupos") }] })
    });
    mock("../modules/engine/processor.service", {
      limitarJobs: valor => Number(valor || 20),
      marcarJobStatus: async () => ({ ok: true }),
      registrarProcessamento: async () => ({ ok: true })
    });
    mock("../modules/engine/frescor-pre-importer.service", {
      avaliarFrescorPreImporter: () => ({ expirada: false }),
      expirarJobPreImporterSeNecessario: async () => ({ expirou: false }),
      resumirSelecaoFrescorPreImporter: () => ({ frescosSelecionados: 1, expiradosCandidatos: 0, idadeMediaJobsSelecionadosMs: 0 })
    });
    mock("../modules/engine/logger", { logEngineProcessadorInicio() {}, logEngineProcessadorJob() {}, logEngineProcessadorErro() {}, logEngineProcessadorFim() {} });
    limpar("../modules/engine/validator.runner");
    const { validarJobsDiagnosticadosEngine } = require("../modules/engine/validator.runner");
    const resumo = await validarJobsDiagnosticadosEngine({ limite: 1 });
    assert.deepStrictEqual(validados, [1000], "runner valida somente o job confirmado pela transacao de fairness");
    assert.strictEqual(resumo.processados, 1);
  } finally {
    restaurar(validatorPath, originais.validator);
    restaurar(fairnessPath, originais.fairness);
    restaurar(processorPath, originais.processor);
    restaurar(frescorPath, originais.frescor);
    restaurar(loggerPath, originais.logger);
    restaurar(runnerPath, originais.runner);
  }
}

(async () => {
  testarPlanoWorkConservingEFairness();
  testarLaneUmAlternaEOrigensIndependentes();
  testarLegadoNaoRecebeProtecao();
  await testarClaimAtomicoEFalhas();
  await testarRunnerValidaSomenteConfirmadoPelaFairness();
  console.log("engine-validator-origem-fairness.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
