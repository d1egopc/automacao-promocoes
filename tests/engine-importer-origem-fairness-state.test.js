const assert = require("assert");
const {
  normalizarChaveFairness,
  garantirEstadoFairness,
  obterEstadoFairness,
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness,
  MARKETPLACES_IMPORTER_FAIRNESS,
  LANES_IMPORTER_FAIRNESS
} = require("../modules/engine/origem-fairness.repository");

function chave(clienteId = "workspace_importer", lane = "mercadolivre:agua_nova") {
  return { clienteId, etapa: "importacao_final", lane };
}

function criarClientMemoria() {
  const dados = new Map();
  let pendente = null;
  let emTransacao = false;
  const chaveInterna = params => params.slice(0, 3).join("|");
  const origemDados = () => emTransacao ? pendente : dados;
  const clonar = fonte => new Map([...fonte.entries()].map(([id, valor]) => [id, { ...valor }]));

  return {
    async query(sql, params = []) {
      if (sql === "BEGIN") {
        pendente = clonar(dados);
        emTransacao = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        dados.clear();
        for (const [id, valor] of pendente.entries()) dados.set(id, { ...valor });
        pendente = null;
        emTransacao = false;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        pendente = null;
        emTransacao = false;
        return { rows: [], rowCount: 0 };
      }

      const estado = origemDados();
      const id = chaveInterna(params);
      if (/INSERT INTO engine_fairness_origem_fluxo/i.test(sql)) {
        if (estado.has(id)) return { rows: [], rowCount: 0 };
        const row = {
          cliente_id: params[0], etapa: params[1], lane: params[2],
          ultima_origem_atendida: null, ultimo_atendimento_em: null,
          criado_em: "2026-09-08T12:00:00.000Z", atualizado_em: "2026-09-08T12:00:00.000Z"
        };
        estado.set(id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/FROM engine_fairness_origem_fluxo/i.test(sql) && /SELECT/i.test(sql)) {
        const row = estado.get(id);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/UPDATE engine_fairness_origem_fluxo/i.test(sql)) {
        const row = estado.get(id);
        row.ultima_origem_atendida = params[3];
        row.ultimo_atendimento_em = "2026-09-08T12:01:00.000Z";
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
}

function testarContrato() {
  assert.deepStrictEqual(MARKETPLACES_IMPORTER_FAIRNESS, [
    "mercadolivre", "amazon", "shopee", "aliexpress", "awin", "kabum", "magalu"
  ]);
  assert.deepStrictEqual(LANES_IMPORTER_FAIRNESS, [
    "agua_nova", "fresca_em_risco", "fresca_circulavel"
  ]);
  for (const marketplace of MARKETPLACES_IMPORTER_FAIRNESS) {
    for (const lane of LANES_IMPORTER_FAIRNESS) {
      const chaveImportacao = chave("workspace_a", `${marketplace}:${lane}`);
      assert.deepStrictEqual(normalizarChaveFairness(chaveImportacao), chaveImportacao);
    }
  }
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "agua_nova")), /fairness_lane_importacao_invalida/);
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "mercadolivre:expirada")), /fairness_lane_importacao_invalida/);
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "desconhecido:agua_nova")), /fairness_lane_importacao_invalida/);
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "mercadolivre:agua_nova:extra")), /fairness_lane_importacao_invalida/);
}

async function testarPersistenciaEIsolamento() {
  const client = criarClientMemoria();
  const ml = chave("workspace_a", "mercadolivre:agua_nova");
  const amazon = chave("workspace_a", "amazon:agua_nova");

  await client.query("BEGIN");
  await garantirEstadoFairness(client, ml);
  await registrarOrigemAtendidaFairness(client, ml, "optimus");
  await garantirEstadoFairness(client, amazon);
  await registrarOrigemAtendidaFairness(client, amazon, "clonador_grupos");
  await client.query("COMMIT");

  await client.query("BEGIN");
  assert.strictEqual((await bloquearEstadoFairness(client, ml)).ultimaOrigemAtendida, "optimus");
  assert.strictEqual((await obterEstadoFairness(client, amazon)).ultimaOrigemAtendida, "clonador_grupos");
  await registrarOrigemAtendidaFairness(client, ml, "clonador_grupos");
  await client.query("ROLLBACK");

  await client.query("BEGIN");
  assert.strictEqual((await obterEstadoFairness(client, ml)).ultimaOrigemAtendida, "optimus", "rollback nao altera estado importador");
  await client.query("COMMIT");
}

(async () => {
  testarContrato();
  await testarPersistenciaEIsolamento();
  console.log("engine-importer-origem-fairness-state.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
