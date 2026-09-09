const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  normalizarChaveFairness,
  normalizarOrigemProtegida,
  garantirEstadoFairness,
  obterEstadoFairness,
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("../modules/engine/origem-fairness.repository");

function chave(clienteId = "workspace_a", etapa = "diagnostico_final", lane = "agua_nova") {
  return { clienteId, etapa, lane };
}

function chaveInterna(params) {
  return params.slice(0, 3).join("|");
}

function criarClientMemoria() {
  const persistido = new Map();
  let pendente = null;
  let emTransacao = false;
  const consultas = [];

  function dadosAtuais() {
    return emTransacao ? pendente : persistido;
  }

  function linha(row) {
    return {
      cliente_id: row.cliente_id,
      etapa: row.etapa,
      lane: row.lane,
      ultima_origem_atendida: row.ultima_origem_atendida,
      ultimo_atendimento_em: row.ultimo_atendimento_em,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em
    };
  }

  return {
    consultas,
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (sql === "BEGIN") {
        assert.strictEqual(emTransacao, false);
        pendente = new Map([...persistido.entries()].map(([id, row]) => [id, { ...row }]));
        emTransacao = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        assert.strictEqual(emTransacao, true);
        persistido.clear();
        for (const [id, row] of pendente.entries()) persistido.set(id, { ...row });
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

      const dados = dadosAtuais();
      const id = chaveInterna(params);
      if (/INSERT INTO engine_fairness_origem_fluxo/i.test(sql)) {
        if (dados.has(id)) return { rows: [], rowCount: 0 };
        const agora = "2026-09-08T12:00:00.000Z";
        const row = {
          cliente_id: params[0], etapa: params[1], lane: params[2],
          ultima_origem_atendida: null, ultimo_atendimento_em: null,
          criado_em: agora, atualizado_em: agora
        };
        dados.set(id, row);
        return { rows: [linha(row)], rowCount: 1 };
      }
      if (/FROM engine_fairness_origem_fluxo/i.test(sql) && /SELECT/i.test(sql)) {
        const row = dados.get(id);
        return { rows: row ? [linha(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (/UPDATE engine_fairness_origem_fluxo/i.test(sql)) {
        const row = dados.get(id);
        if (!row) return { rows: [], rowCount: 0 };
        row.ultima_origem_atendida = params[3];
        row.ultimo_atendimento_em = "2026-09-08T12:01:00.000Z";
        row.atualizado_em = "2026-09-08T12:01:00.000Z";
        return { rows: [linha(row)], rowCount: 1 };
      }
      throw new Error(`sql_nao_suportado: ${sql}`);
    }
  };
}

async function testarSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8");
  assert(/CREATE TABLE IF NOT EXISTS engine_fairness_origem_fluxo/i.test(schema));
  assert(/PRIMARY KEY \(cliente_id, etapa, lane\)/i.test(schema));
  assert(/ultima_origem_atendida IN \('optimus', 'clonador_grupos'\)/i.test(schema));
  assert(/etapa IN \('diagnostico_final', 'validacao_final', 'importacao_final', 'distribuicao_final'\)/i.test(schema));
  assert(/lane IN \('agua_nova', 'fresca_em_risco', 'fresca_circulavel', 'expirada'\)/i.test(schema));
  assert(/etapa = 'importacao_final'.*mercadolivre\|amazon\|shopee\|aliexpress\|awin\|kabum\|magalu/is.test(schema));
  assert(/etapa = 'distribuicao_final'.*lane IN \('mercadolivre', 'amazon', 'shopee', 'aliexpress', 'awin', 'kabum', 'magalu'\)/is.test(schema));
}

function testarValidacao() {
  assert.deepStrictEqual(normalizarChaveFairness(chave()), chave());
  assert.throws(() => normalizarChaveFairness(chave("", "diagnostico_final", "agua_nova")), /cliente_id_ausente/);
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "importacao_final", "agua_nova")), /lane_importacao_invalida/);
  assert.throws(() => normalizarChaveFairness(chave("workspace_a", "diagnostico_final", "manual_v2")), /lane_invalida/);
  assert.strictEqual(normalizarOrigemProtegida("OPTIMUS"), "optimus");
  assert.throws(() => normalizarOrigemProtegida("legada"), /origem_invalida/);
}

async function testarEstadoETransacao() {
  const client = criarClientMemoria();
  await client.query("BEGIN");
  assert.strictEqual(await obterEstadoFairness(client, chave()), null, "tabela vazia nao inventa historico");
  const criado = await garantirEstadoFairness(client, chave());
  assert.strictEqual(criado.criada, true);
  assert.strictEqual((await bloquearEstadoFairness(client, chave())).ultimaOrigemAtendida, "");
  const optimus = await registrarOrigemAtendidaFairness(client, chave(), "optimus");
  assert.strictEqual(optimus.ultimaOrigemAtendida, "optimus");
  assert(optimus.ultimoAtendimentoEm);
  await client.query("COMMIT");

  await client.query("BEGIN");
  const aposRestartLogico = await bloquearEstadoFairness(client, chave());
  assert.strictEqual(aposRestartLogico.ultimaOrigemAtendida, "optimus");
  const clonador = await registrarOrigemAtendidaFairness(client, chave(), "clonador_grupos");
  assert.strictEqual(clonador.ultimaOrigemAtendida, "clonador_grupos");
  await client.query("COMMIT");

  await client.query("BEGIN");
  await garantirEstadoFairness(client, chave("workspace_a", "diagnostico_final", "fresca_em_risco"));
  await registrarOrigemAtendidaFairness(client, chave("workspace_a", "diagnostico_final", "fresca_em_risco"), "optimus");
  await garantirEstadoFairness(client, chave("workspace_a", "validacao_final", "agua_nova"));
  await registrarOrigemAtendidaFairness(client, chave("workspace_a", "validacao_final", "agua_nova"), "clonador_grupos");
  await garantirEstadoFairness(client, chave("workspace_b", "diagnostico_final", "agua_nova"));
  await registrarOrigemAtendidaFairness(client, chave("workspace_b", "diagnostico_final", "agua_nova"), "optimus");
  await client.query("COMMIT");

  await client.query("BEGIN");
  assert.strictEqual((await obterEstadoFairness(client, chave())).ultimaOrigemAtendida, "clonador_grupos");
  assert.strictEqual((await obterEstadoFairness(client, chave("workspace_a", "diagnostico_final", "fresca_em_risco"))).ultimaOrigemAtendida, "optimus");
  assert.strictEqual((await obterEstadoFairness(client, chave("workspace_a", "validacao_final", "agua_nova"))).ultimaOrigemAtendida, "clonador_grupos");
  assert.strictEqual((await obterEstadoFairness(client, chave("workspace_b", "diagnostico_final", "agua_nova"))).ultimaOrigemAtendida, "optimus");
  await client.query("COMMIT");

  await client.query("BEGIN");
  await registrarOrigemAtendidaFairness(client, chave(), "optimus");
  await client.query("ROLLBACK");
  await client.query("BEGIN");
  assert.strictEqual((await obterEstadoFairness(client, chave())).ultimaOrigemAtendida, "clonador_grupos", "rollback externo nao persiste atualizacao");
  await client.query("COMMIT");

  const inserts = client.consultas.filter(chamada => /INSERT INTO engine_fairness_origem_fluxo/i.test(chamada.sql));
  assert(inserts.every(chamada => /ON CONFLICT \(cliente_id, etapa, lane\) DO NOTHING/i.test(chamada.sql)), "upsert usa a chave unica da memoria");
  const locks = client.consultas.filter(chamada => /FOR UPDATE/i.test(chamada.sql));
  assert(locks.length >= 2, "repository expoe lock transacional por chave");
}

(async () => {
  await testarSchema();
  testarValidacao();
  await testarEstadoETransacao();
  console.log("engine-origem-fairness.repository.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
