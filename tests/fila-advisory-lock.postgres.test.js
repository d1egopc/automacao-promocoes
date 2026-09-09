"use strict";

const assert = require("assert");
const repo = require("../modules/fila/fila-claims.repository");

const databaseUrl = String(process.env.FILA_ADVISORY_TEST_DATABASE_URL || "").trim();

if (!databaseUrl) {
  console.log("fila-advisory-lock.postgres.test.js SKIP (FILA_ADVISORY_TEST_DATABASE_URL ausente)");
  process.exit(0);
}

const { Pool } = require("pg");

async function adquirir(pool, clienteId, filaItemId) {
  return repo.adquirirAdvisoryLockFila({ clienteId, filaItemId }, { pool });
}

(async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  try {
    const [primeira, segunda] = await Promise.all([
      adquirir(pool, "advisory_test_workspace_a", "advisory_test_item_a"),
      adquirir(pool, "advisory_test_workspace_a", "advisory_test_item_a")
    ]);
    const a = primeira.adquirido ? primeira : segunda;
    const b = primeira.adquirido ? segunda : primeira;
    assert.strictEqual(a.adquirido, true);
    assert.strictEqual(b.adquirido, false, "duas conexoes concorrentes nao adquirem a mesma chave");

    const [outroItem, outroWorkspace] = await Promise.all([
      adquirir(pool, "advisory_test_workspace_a", "advisory_test_item_b"),
      adquirir(pool, "advisory_test_workspace_b", "advisory_test_item_a")
    ]);
    assert.strictEqual(outroItem.adquirido, true);
    assert.strictEqual(outroWorkspace.adquirido, true);

    const estranho = await pool.connect();
    const unlockEstranho = await estranho.query(
      "SELECT pg_advisory_unlock(hashtext($1), hashtext($2)) AS liberado",
      ["advisory_test_workspace_a", "advisory_test_item_a"]
    );
    assert.strictEqual(unlockEstranho.rows[0].liberado, false, "outra conexao nao libera lock alheio");
    estranho.release();

    assert.strictEqual((await repo.liberarAdvisoryLockFila(a.handle)).liberado, true);
    const reacquirido = await adquirir(pool, "advisory_test_workspace_a", "advisory_test_item_a");
    assert.strictEqual(reacquirido.adquirido, true);

    const crash = await adquirir(pool, "advisory_test_workspace_crash", "advisory_test_item");
    crash.handle.client.release(new Error("simulated_advisory_owner_crash"));
    await new Promise(resolve => setTimeout(resolve, 30));
    const aposCrash = await adquirir(pool, "advisory_test_workspace_crash", "advisory_test_item");
    assert.strictEqual(aposCrash.adquirido, true, "conexao encerrada libera advisory lock");

    await repo.liberarAdvisoryLockFila(outroItem.handle);
    await repo.liberarAdvisoryLockFila(outroWorkspace.handle);
    await repo.liberarAdvisoryLockFila(reacquirido.handle);
    await repo.liberarAdvisoryLockFila(aposCrash.handle);
    console.log("fila-advisory-lock.postgres.test.js OK");
  } finally {
    await pool.end();
  }
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
