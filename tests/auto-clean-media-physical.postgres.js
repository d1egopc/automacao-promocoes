"use strict";

const assert = require("node:assert/strict");
const { Client } = require("pg");
const { referenciasSocialPostgres } = require("../modules/engine/auto-clean/gc-social-reference-index");

async function main() {
  const connectionString = String(process.env.AUTO_CLEAN_TEST_DATABASE_URL || "");
  if (!connectionString) throw new Error("AUTO_CLEAN_TEST_DATABASE_URL_REQUIRED");
  const client = new Client({ connectionString, ssl: false });
  await client.connect();
  try {
    const version = await client.query("SHOW server_version_num");
    assert.ok(Number(version.rows[0].server_version_num) >= 170000, "PostgreSQL 17 obrigatorio");
    await client.query(`
      CREATE TEMP TABLE engine_ofertas (
        imagem text, metadata jsonb, atualizada_em timestamptz, status text
      );
      CREATE TEMP TABLE engine_jobs_cliente (
        evento_id bigint, metadata jsonb, atualizado_em timestamptz, status text
      );
      CREATE TEMP TABLE engine_eventos_brutos (
        id bigint, metadata jsonb, capturado_em timestamptz
      );
    `);
    await client.query(`
      INSERT INTO engine_ofertas VALUES
        ('/social/midia/publica/engine/oferta_ativa.jpg', '{}'::jsonb, now()-interval '30 days', 'pendente'),
        ('/social/midia/publica/engine/oferta_terminal_recente.jpg', '{}'::jsonb, now()-interval '1 day', 'enviado'),
        ('/social/midia/publica/engine/oferta_terminal_expirada.jpg', '{}'::jsonb, now()-interval '9 days', 'enviado');
      INSERT INTO engine_jobs_cliente VALUES
        (10, '{"midia":"/social/midia/publica/engine/job_ativo.png"}'::jsonb, now()-interval '20 days', 'processando'),
        (20, '{}'::jsonb, now()-interval '1 day', 'enviado');
      INSERT INTO engine_eventos_brutos VALUES
        (10, '{"midia":"/social/midia/publica/engine/evento_job_ativo.webp"}'::jsonb, now()-interval '20 days'),
        (20, '{"midia":"/social/midia/publica/engine/evento_recente.webp"}'::jsonb, now()-interval '1 day'),
        (30, '{"midia":"/social/midia/publica/engine/evento_expirado.webp"}'::jsonb, now()-interval '9 days');
    `);
    const query = async (sql, params) => {
      const result = await client.query(sql, params);
      return { ok: true, resultado: result };
    };
    const result = await referenciasSocialPostgres({ bucket: "engine", query });
    assert.equal(result.complete, true);
    for (const name of ["oferta_ativa.jpg", "oferta_terminal_recente.jpg", "job_ativo.png",
      "evento_job_ativo.webp", "evento_recente.webp"]) {
      assert.ok(result.refs.has(`social:engine/${name}`), `${name} deve ficar protegido`);
    }
    assert.equal(result.refs.has("social:engine/oferta_terminal_expirada.jpg"), false);
    assert.equal(result.refs.has("social:engine/evento_expirado.webp"), false);
    const unavailable = await referenciasSocialPostgres({ bucket: "engine",
      query: async () => ({ ok: false, motivo: "consulta_indisponivel" }) });
    assert.equal(unavailable.complete, false);
    assert.equal(unavailable.refs.size, 0);
    console.log("AUTO_CLEAN_MEDIA_PHYSICAL_POSTGRES17_PASS");
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
