const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  montarGruposFairness,
  montarSelecaoGrupo,
  reivindicarSlotFairness
} = require("../modules/engine/distributor/distributor-fairness.service");

function oferta(id, origemFluxo, extras = {}) {
  return {
    id,
    cliente_id: extras.clienteId || "workspace_a",
    marketplace: extras.marketplace || "mercadolivre",
    indiceBaseline: extras.indiceBaseline,
    origemFluxo,
    origemFluxoHead: extras.head === true,
    prioridade: extras.prioridade || 0,
    status: "importada"
  };
}

function grupoComDuasOrigens(orcamento = 10, origemMajoritaria = "optimus", extras = {}) {
  const origemMenor = origemMajoritaria === "optimus" ? "clonador_grupos" : "optimus";
  const baseline = Array.from({ length: orcamento }, (_, indice) => oferta(indice + 1, origemMajoritaria, {
    ...extras, indiceBaseline: indice, head: indice === 0
  }));
  const candidatePool = [...baseline, oferta(1000, origemMenor, { ...extras, head: true })];
  return montarGruposFairness(baseline, candidatePool)[0];
}

function contarPorOrigem(selecao = []) {
  return selecao.reduce((total, item) => {
    total[item.origemFluxo] = (total[item.origemFluxo] || 0) + 1;
    return total;
  }, {});
}

function criarPoolMemoria(idsPendentes = [], opcoes = {}) {
  const ofertas = new Map(idsPendentes.map(id => [Number(id), "importada"]));
  const fairness = new Map();
  let copiaOfertas = null;
  let copiaFairness = null;
  const client = {
    release() {},
    async query(sql, params = []) {
      if (sql === "BEGIN") {
        copiaOfertas = new Map(ofertas);
        copiaFairness = new Map([...fairness.entries()].map(([chave, valor]) => [chave, { ...valor }]));
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        ofertas.clear(); for (const [id, status] of copiaOfertas.entries()) ofertas.set(id, status);
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
      if (/UPDATE engine_ofertas/i.test(sql)) {
        const id = Number(params[0]);
        if (ofertas.get(id) !== "importada") return { rows: [], rowCount: 0 };
        ofertas.set(id, "distribuindo");
        return { rows: [{ id, status: "distribuindo" }], rowCount: 1 };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
  return { pool: { connect: async () => client }, ofertas, fairness };
}

function testarOrcamentoEIsolamento() {
  const noveUm = montarSelecaoGrupo(grupoComDuasOrigens(10, "optimus"));
  const umNove = montarSelecaoGrupo(grupoComDuasOrigens(10, "clonador_grupos"));
  assert.deepStrictEqual(contarPorOrigem(noveUm.selecionados), { optimus: 9, clonador_grupos: 1 });
  assert.deepStrictEqual(contarPorOrigem(umNove.selecionados), { clonador_grupos: 9, optimus: 1 });

  const somenteOptimUs = montarGruposFairness([oferta(1, "optimus", { indiceBaseline: 0, head: true })], [oferta(1, "optimus", { indiceBaseline: 0, head: true })])[0];
  const somenteClone = montarGruposFairness([oferta(2, "clonador_grupos", { indiceBaseline: 0, head: true })], [oferta(2, "clonador_grupos", { indiceBaseline: 0, head: true })])[0];
  assert.strictEqual(montarSelecaoGrupo(somenteOptimUs).protegida, false);
  assert.strictEqual(montarSelecaoGrupo(somenteClone).protegida, false);

  const laneUm = grupoComDuasOrigens(1, "optimus");
  assert.strictEqual(montarSelecaoGrupo(laneUm, "optimus").selecionados[0].origemFluxo, "clonador_grupos");
  assert.strictEqual(montarSelecaoGrupo(laneUm, "clonador_grupos").selecionados[0].origemFluxo, "optimus");
  assert.strictEqual(montarSelecaoGrupo(laneUm).selecionados[0].origemFluxo, "optimus", "sem memoria preserva ordem deterministica");

  const grupos = montarGruposFairness([
    oferta(1, "optimus", { clienteId: "workspace_a", marketplace: "mercadolivre", indiceBaseline: 0, head: true }),
    oferta(2, "optimus", { clienteId: "workspace_a", marketplace: "amazon", indiceBaseline: 1, head: true }),
    oferta(3, "optimus", { clienteId: "workspace_b", marketplace: "mercadolivre", indiceBaseline: 2, head: true }),
    oferta(4, "", { clienteId: "workspace_b", marketplace: "amazon", indiceBaseline: 3 })
  ], []);
  assert.strictEqual(grupos.length, 4, "workspace e marketplace isolam a unidade de fairness");
}

async function testarClaimAtomicoEMemoria() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const memoria = criarPoolMemoria([1, 1000]);
  const primeiro = await reivindicarSlotFairness(grupo, 0, { pool: memoria.pool });
  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(primeiro.oferta.id, 1);
  assert.strictEqual(memoria.ofertas.get(1), "distribuindo");
  assert.strictEqual(memoria.fairness.get("workspace_a|distribuicao_final|mercadolivre").ultima, "optimus");

  const segundo = await reivindicarSlotFairness(grupo, 0, { pool: memoria.pool });
  assert.strictEqual(segundo.ok, true);
  assert.strictEqual(segundo.oferta.id, 1000, "grupo de um slot alterna apos claim protegido confirmado");
  assert.strictEqual(memoria.fairness.get("workspace_a|distribuicao_final|mercadolivre").ultima, "clonador_grupos");
}

async function testarClaimPerdidoSubstitutoERollback() {
  const grupo = grupoComDuasOrigens(1, "optimus");
  const perdido = criarPoolMemoria([]);
  const resultadoPerdido = await reivindicarSlotFairness(grupo, 0, { pool: perdido.pool });
  assert.strictEqual(resultadoPerdido.ok, true);
  assert.strictEqual(resultadoPerdido.ignorado, true);
  assert.strictEqual(perdido.fairness.get("workspace_a|distribuicao_final|mercadolivre").ultima, "", "claim perdido nao atualiza memoria");

  const comSubstituto = criarPoolMemoria([1000]);
  const substituto = await reivindicarSlotFairness(grupo, 0, { pool: comSubstituto.pool });
  assert.strictEqual(substituto.oferta.id, 1000, "substituto vem somente do candidate pool bounded do mesmo grupo");
  assert.strictEqual(comSubstituto.fairness.get("workspace_a|distribuicao_final|mercadolivre").ultima, "", "substituto nao transforma claim perdido em atendimento protegido");

  const rollback = criarPoolMemoria([1, 1000], { falharAoRegistrarFairness: true });
  const resultadoRollback = await reivindicarSlotFairness(grupo, 0, { pool: rollback.pool });
  assert.strictEqual(resultadoRollback.ok, false);
  assert.strictEqual(rollback.ofertas.get(1), "importada", "rollback desfaz claim");
  assert.strictEqual(rollback.fairness.size, 0, "rollback desfaz memoria");
}

function testarIntegracaoDoRunner() {
  const runner = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.runner.js"), "utf8");
  assert(runner.includes("reivindicarSlotFairness"));
  assert(runner.includes("candidatePool || []"));
  assert(runner.indexOf("const validacao = await validarOfertaParaDistribuicao") > runner.indexOf("if (lock.oferta) oferta = lock.oferta"), "Flow e trabalho comercial continuam depois do claim");
}

(async () => {
  testarOrcamentoEIsolamento();
  await testarClaimAtomicoEMemoria();
  await testarClaimPerdidoSubstitutoERollback();
  testarIntegracaoDoRunner();
  console.log("engine-distributor-origem-fairness.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
