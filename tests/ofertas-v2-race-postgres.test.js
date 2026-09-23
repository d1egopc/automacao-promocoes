"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { Pool } = require("pg");
const claims = require("../modules/fila/fila-claims.repository");
const { criarCatracaAdvisoryFuncionalFila } = require("../modules/fila/fila-advisory-functional.service");
const { criarCoordenadorEnvioProdutoDestino } = require("../modules/manual-v2/ofertas-v2-envio-claim");

const databaseUrl = String(process.env.TEST_DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.log("ofertas-v2-race-postgres.test.js SKIP (TEST_DATABASE_URL ausente)");
  process.exit(0);
}

const databaseTarget = new URL(databaseUrl);
const hostname = databaseTarget.hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ||
    !/test/i.test(decodeURIComponent(databaseTarget.pathname))) {
  throw new Error("TEST_DATABASE_URL_deve_apontar_para_postgres_local_isolado");
}

(async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const clienteId = `teste_race_${crypto.randomUUID().replace(/-/g, "")}`;
  const destinoId = "destino_controlado";
  const oferta = produtoId => ({ clienteId, marketplace: "amazon", produtoId,
    urlOriginal: `https://www.amazon.com.br/dp/${produtoId}`, id: `fila_${produtoId}` });
  const advisoryRepository = {
    adquirirAdvisoryLockFila: entrada => claims.adquirirAdvisoryLockFila(entrada, { pool }),
    liberarAdvisoryLockFila: handle => claims.liberarAdvisoryLockFila(handle)
  };
  const criar = () => criarCoordenadorEnvioProdutoDestino({
    advisory: criarCatracaAdvisoryFuncionalFila({ repository: advisoryRepository, logger: { log() {} } })
  });
  try {
    await pool.query(claims.SQL_SCHEMA_FILA_CLAIMS);
    const a = criar();
    const b = criar();
    const primeiro = await a.adquirir({ clienteId, oferta: oferta("B0RACEPG01"), destinoId });
    assert.strictEqual(primeiro.resultado, "adquirido");
    assert.strictEqual(await a.prepararTransporte(primeiro), true);
    assert.strictEqual(primeiro.advisoryLiberado, true);
    assert.strictEqual(primeiro.handle, null, "client voltou ao pool antes de qualquer rede");
    const segundo = await b.adquirir({ clienteId, oferta: oferta("B0RACEPG01"), destinoId });
    assert.strictEqual(segundo.resultado, "ocupado_recente",
      "outro client obteve advisory, mas a reserva persistida impediu o mesmo par");
    const independente = await b.adquirir({ clienteId, oferta: oferta("B0RACEPG02"), destinoId });
    assert.strictEqual(independente.resultado, "adquirido");
    assert.strictEqual(await b.prepararTransporte(independente), true);
    const linhas = await pool.query(
      "SELECT COUNT(*)::int AS total FROM fila_claims_ativos WHERE cliente_id = $1 AND lease_expires_at > NOW()",
      [clienteId]
    );
    assert.strictEqual(linhas.rows[0].total, 2, "ambos os pares independentes persistem");
    console.log("ofertas-v2-race-postgres.test.js PASS");
  } finally {
    try {
      await pool.query("DELETE FROM fila_claims_ativos WHERE cliente_id = $1", [clienteId]);
    } finally { await pool.end(); }
  }
})().catch(erro => { console.error(erro.stack || erro); process.exitCode = 1; });
