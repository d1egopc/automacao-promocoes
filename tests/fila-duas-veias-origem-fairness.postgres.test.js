"use strict";

const assert = require("assert");
const {
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("../modules/engine/origem-fairness.repository");

const databaseUrl = String(process.env.FILA_FAIRNESS_TEST_DATABASE_URL || "").trim();

if (!databaseUrl) {
  console.log("fila-duas-veias-origem-fairness.postgres.test.js SKIP (FILA_FAIRNESS_TEST_DATABASE_URL ausente)");
  process.exit(0);
}

const { Pool } = require("pg");
const chave = {
  clienteId: `fila_fairness_isolado_${Date.now()}_${process.pid}`,
  etapa: "fila_final",
  lane: "selecao"
};

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let primeiro = null;
  let segundo = null;
  try {
    primeiro = await pool.connect();
    segundo = await pool.connect();
    await primeiro.query("BEGIN");
    await bloquearEstadoFairness(primeiro, chave);
    await registrarOrigemAtendidaFairness(primeiro, chave, "optimus");

    await segundo.query("BEGIN");
    let segundaConcluiu = false;
    const esperaMesmaChave = bloquearEstadoFairness(segundo, chave).then(estado => {
      segundaConcluiu = true;
      return estado;
    });
    await esperar(25);
    assert.strictEqual(segundaConcluiu, false, "a mesma chave serializa por SELECT FOR UPDATE");

    // Rollback da primeira transacao libera o lock e tambem garante zero
    // residuo de teste, inclusive se esta URL estiver apontada por engano.
    await primeiro.query("ROLLBACK");
    const estadoSegundo = await esperaMesmaChave;
    assert.strictEqual(estadoSegundo.ultimaOrigemAtendida, "", "rollback nao persiste memoria parcial");
    await registrarOrigemAtendidaFairness(segundo, chave, "clonador_grupos");
    await segundo.query("ROLLBACK");

    console.log("fila-duas-veias-origem-fairness.postgres.test.js OK (transacional, zero residuo)");
  } finally {
    if (primeiro) {
      try { await primeiro.query("ROLLBACK"); } catch {}
      primeiro.release();
    }
    if (segundo) {
      try { await segundo.query("ROLLBACK"); } catch {}
      segundo.release();
    }
    await pool.end();
  }
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
