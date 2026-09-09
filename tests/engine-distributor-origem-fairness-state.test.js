const assert = require("assert");

const {
  MARKETPLACES_DISTRIBUIDOR_FAIRNESS,
  normalizarChaveFairness,
  normalizarOrigemProtegida,
  garantirEstadoFairness,
  obterEstadoFairness,
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("../modules/engine/origem-fairness.repository");

function chave(clienteId = "workspace_distributor", lane = "mercadolivre") {
  return { clienteId, etapa: "distribuicao_final", lane };
}

function criarClientMemoria() {
  const persistido = new Map();
  let pendente = null;
  let emTransacao = false;
  const id = params => params.slice(0, 3).join("|");
  const dados = () => emTransacao ? pendente : persistido;
  const clonar = origem => new Map([...origem.entries()].map(([chaveMapa, valor]) => [chaveMapa, { ...valor }]));

  return {
    async query(sql, params = []) {
      if (sql === "BEGIN") {
        assert.strictEqual(emTransacao, false);
        pendente = clonar(persistido);
        emTransacao = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        assert.strictEqual(emTransacao, true);
        persistido.clear();
        for (const [chaveMapa, valor] of pendente.entries()) persistido.set(chaveMapa, { ...valor });
        pendente = null;
        emTransacao = false;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        assert.strictEqual(emTransacao, true);
        pendente = null;
        emTransacao = false;
        return { rows: [], rowCount: 0 };
      }

      const chaveMapa = id(params);
      const estado = dados();
      if (/INSERT INTO engine_fairness_origem_fluxo/i.test(sql)) {
        if (estado.has(chaveMapa)) return { rows: [], rowCount: 0 };
        const row = {
          cliente_id: params[0], etapa: params[1], lane: params[2],
          ultima_origem_atendida: null, ultimo_atendimento_em: null,
          criado_em: "2026-09-08T12:00:00.000Z", atualizado_em: "2026-09-08T12:00:00.000Z"
        };
        estado.set(chaveMapa, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/FROM engine_fairness_origem_fluxo/i.test(sql) && /SELECT/i.test(sql)) {
        const row = estado.get(chaveMapa);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/UPDATE engine_fairness_origem_fluxo/i.test(sql)) {
        const row = estado.get(chaveMapa);
        if (!row) return { rows: [], rowCount: 0 };
        row.ultima_origem_atendida = params[3];
        row.ultimo_atendimento_em = "2026-09-08T12:01:00.000Z";
        row.atualizado_em = row.ultimo_atendimento_em;
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
}

function testarContrato() {
  assert.deepStrictEqual(MARKETPLACES_DISTRIBUIDOR_FAIRNESS, [
    "mercadolivre", "amazon", "shopee", "aliexpress", "awin", "kabum", "magalu"
  ]);
  for (const marketplace of MARKETPLACES_DISTRIBUIDOR_FAIRNESS) {
    assert.deepStrictEqual(normalizarChaveFairness(chave("workspace_a", marketplace)), chave("workspace_a", marketplace));
  }
  for (const invalida of ["agua_nova", "expirada", "mercadolivre:agua_nova", "desconhecido", "mercadolivre:extra"]) {
    assert.throws(() => normalizarChaveFairness(chave("workspace_a", invalida)), /fairness_lane_distribuicao_invalida/);
  }
  assert.strictEqual(normalizarOrigemProtegida("optimus"), "optimus");
  assert.strictEqual(normalizarOrigemProtegida("CLONADOR_GRUPOS"), "clonador_grupos");
  assert.throws(() => normalizarOrigemProtegida("legado"), /fairness_origem_invalida/);
}

async function testarIsolamentoERollback() {
  const client = criarClientMemoria();
  const mlA = chave("workspace_a", "mercadolivre");
  const amazonA = chave("workspace_a", "amazon");
  const mlB = chave("workspace_b", "mercadolivre");

  await client.query("BEGIN");
  await garantirEstadoFairness(client, mlA);
  await registrarOrigemAtendidaFairness(client, mlA, "optimus");
  await garantirEstadoFairness(client, amazonA);
  await registrarOrigemAtendidaFairness(client, amazonA, "clonador_grupos");
  await garantirEstadoFairness(client, mlB);
  await registrarOrigemAtendidaFairness(client, mlB, "clonador_grupos");
  await client.query("COMMIT");

  await client.query("BEGIN");
  assert.strictEqual((await bloquearEstadoFairness(client, mlA)).ultimaOrigemAtendida, "optimus");
  assert.strictEqual((await obterEstadoFairness(client, amazonA)).ultimaOrigemAtendida, "clonador_grupos");
  assert.strictEqual((await obterEstadoFairness(client, mlB)).ultimaOrigemAtendida, "clonador_grupos");
  await registrarOrigemAtendidaFairness(client, mlA, "clonador_grupos");
  await client.query("ROLLBACK");

  await client.query("BEGIN");
  assert.strictEqual((await obterEstadoFairness(client, mlA)).ultimaOrigemAtendida, "optimus", "rollback nao altera memoria do Distributor");
  await client.query("COMMIT");
}

(async () => {
  testarContrato();
  await testarIsolamentoERollback();
  console.log("engine-distributor-origem-fairness-state.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
