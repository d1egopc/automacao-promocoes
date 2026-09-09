"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { Pool } = require("pg");
const repo = require("../modules/fila/fila-checkpoints-entrega.repository");

const databaseUrl = String(process.env.FILA_CHECKPOINT_TEST_DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.log("fila-checkpoints-entrega.postgres.test.js SKIP (FILA_CHECKPOINT_TEST_DATABASE_URL ausente)");
  process.exit(0);
}

const ATTEMPT_A = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_B = "44444444-4444-4444-8444-444444444444";
const tabela = `fila_checkpoints_entrega_teste_${crypto.randomBytes(6).toString("hex")}`;

function entrada(extra = {}) {
  return {
    clienteId: "checkpoint_test_workspace_a",
    filaItemId: "checkpoint_test_item_a",
    destinoChave: "whatsapp:destino_a",
    alvoChave: "grupo:teste_a",
    attemptId: ATTEMPT_A,
    ...extra
  };
}

(async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    await pool.query(repo.sqlSchemaCheckpointEntrega(tabela));
    const opcoes = { pool, tabela };
    assert.strictEqual((await repo.criarCheckpointEntrega(entrada(), opcoes)).criado, true);
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "preparado", paraEstado: "envio_iniciado" }, opcoes)).transicionado, true);
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada({ attemptId: ATTEMPT_B }), deEstado: "envio_iniciado", paraEstado: "enviado" }, opcoes)).transicionado, false, "A nao conclui com attempt B");
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "envio_iniciado", paraEstado: "falha_confirmada" }, opcoes)).transicionado, true);
    assert.strictEqual((await repo.prepararNovaTentativaCheckpointEntrega({ ...entrada(), attemptIdAnterior: ATTEMPT_A, attemptId: ATTEMPT_B }, opcoes)).preparada, true);
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "preparado", paraEstado: "envio_iniciado" }, opcoes)).transicionado, false, "A velha nao sobrescreve B");
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada({ attemptId: ATTEMPT_B }), deEstado: "preparado", paraEstado: "envio_iniciado" }, opcoes)).transicionado, true);
    assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada({ attemptId: ATTEMPT_B }), deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "discord-123", creditoDebitado: false }, opcoes)).transicionado, true);
    const independente = await Promise.all([
      repo.criarCheckpointEntrega(entrada({ destinoChave: "discord:destino_b" }), opcoes),
      repo.criarCheckpointEntrega(entrada({ alvoChave: "canal:teste_b" }), opcoes),
      repo.criarCheckpointEntrega(entrada({ clienteId: "checkpoint_test_workspace_b" }), opcoes)
    ]);
    assert(independente.every(resultado => resultado.criado), "chaves independentes coexistem");
    const linhas = await pool.query(`SELECT count(*)::int AS total FROM ${tabela}`);
    assert.strictEqual(linhas.rows[0].total, 4);
    console.log("fila-checkpoints-entrega.postgres.test.js OK");
  } finally {
    try { await pool.query(`DROP TABLE IF EXISTS ${tabela}`); } finally { await pool.end(); }
  }
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
