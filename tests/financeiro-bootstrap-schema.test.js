const assert = require("assert");

const {
  initEngineDatabase
} = require("../modules/engine");

(async () => {
  const chamadas = [];
  const resultadoOk = await initEngineDatabase({
    initEngineDatabaseBase: async () => {
      chamadas.push("engine");
      return { ok: true };
    },
    prepararSchemaEventosComerciaisSeguro: async () => {
      chamadas.push("ofc");
      return { ok: true };
    },
    prepararSchemaFinanceiro: async () => {
      chamadas.push("financeiro");
      return { ok: true, tabelas: "financeiro_v1" };
    },
    ignorarJobsAdminNaoOperacional: async () => {}
  });

  assert.deepStrictEqual(chamadas, ["engine", "ofc", "financeiro"]);
  assert.strictEqual(resultadoOk.ok, true);
  assert.deepStrictEqual(resultadoOk.financeiro, {
    ok: true,
    tabelas: "financeiro_v1",
    motivo: "",
    failSafe: false,
    pulado: false
  });

  const chamadasSegundoBoot = [];
  const resultadoSegundoBoot = await initEngineDatabase({
    initEngineDatabaseBase: async () => {
      chamadasSegundoBoot.push("engine");
      return { ok: true };
    },
    prepararSchemaEventosComerciaisSeguro: async () => {
      chamadasSegundoBoot.push("ofc");
      return { ok: true };
    },
    prepararSchemaFinanceiro: async () => {
      chamadasSegundoBoot.push("financeiro");
      return { ok: true, tabelas: "financeiro_v1" };
    },
    ignorarJobsAdminNaoOperacional: async () => {}
  });

  assert.deepStrictEqual(chamadasSegundoBoot, ["engine", "ofc", "financeiro"]);
  assert.strictEqual(resultadoSegundoBoot.financeiro.ok, true);

  const chamadasSemDb = [];
  const resultadoSemDb = await initEngineDatabase({
    initEngineDatabaseBase: async () => {
      chamadasSemDb.push("engine");
      return { ok: false, motivo: "database_url_ausente" };
    },
    prepararSchemaEventosComerciaisSeguro: async () => {
      chamadasSemDb.push("ofc");
      return { ok: false, failSafe: true, motivo: "database_url_ausente" };
    },
    prepararSchemaFinanceiro: async () => {
      chamadasSemDb.push("financeiro");
      return { ok: true };
    },
    ignorarJobsAdminNaoOperacional: async () => {}
  });

  assert.deepStrictEqual(chamadasSemDb, ["engine", "ofc"]);
  assert.strictEqual(resultadoSemDb.ok, false);
  assert.strictEqual(resultadoSemDb.motivo, "database_url_ausente");
  assert.strictEqual(resultadoSemDb.financeiro.pulado, true);
  assert.strictEqual(resultadoSemDb.financeiro.motivo, "database_url_ausente");

  const resultadoFalha = await initEngineDatabase({
    initEngineDatabaseBase: async () => ({ ok: true }),
    prepararSchemaEventosComerciaisSeguro: async () => ({ ok: true }),
    prepararSchemaFinanceiro: async () => ({
      ok: false,
      motivo: "schema_financeiro_falhou",
      erro: "permission denied"
    }),
    ignorarJobsAdminNaoOperacional: async () => {}
  });

  assert.strictEqual(resultadoFalha.ok, true);
  assert.strictEqual(resultadoFalha.financeiro.ok, false);
  assert.strictEqual(resultadoFalha.financeiro.failSafe, true);
  assert.strictEqual(resultadoFalha.financeiro.motivo, "schema_financeiro_falhou");

  console.log("financeiro-bootstrap-schema.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
