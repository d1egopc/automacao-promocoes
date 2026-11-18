const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");

const connectionString = String(process.env.WHATSAPP_DELETE_TEST_DATABASE_URL || "").trim();
if (!connectionString) {
  throw new Error("WHATSAPP_DELETE_TEST_DATABASE_URL_required");
}

const pool = new Pool({ connectionString, max: 4 });
const queryEngine = async (sql, params = []) => {
  try {
    return { ok: true, resultado: await pool.query(sql, params) };
  } catch (error) {
    return { ok: false, motivo: String(error?.message || "postgres_error") };
  }
};

async function main() {
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.match(String(version.rows[0]?.server_version_num || ""), /^17/, "o fixture deve executar em PostgreSQL 17");

    const repository = criarRepositorioClonadorGrupos({ pool, queryEngine });
    await repository.substituirFontes("workspace_a", [
      { sessaoId: "workspace_a_Claro", grupoJid: "111@g.us", grupoNome: "Claro", ativo: true },
      { sessaoId: "workspace_a_Outro", grupoJid: "222@g.us", grupoNome: "Outro", ativo: true }
    ]);
    await repository.substituirFontes("workspace_b", [
      { sessaoId: "workspace_a_Claro", grupoJid: "333@g.us", grupoNome: "Mesmo ID em outro workspace", ativo: true }
    ]);

    const removidas = await repository.removerFontesDaSessao("workspace_a", "workspace_a_Claro");
    assert.equal(removidas.length, 1);
    assert.equal(removidas[0].clienteId, "workspace_a");
    assert.equal(removidas[0].sessaoId, "workspace_a_Claro");

    const fontesA = await repository.listarFontes("workspace_a");
    assert.deepEqual(fontesA.map(item => [item.sessaoId, item.grupoJid]), [["workspace_a_Outro", "222@g.us"]]);

    const fontesB = await repository.listarFontes("workspace_b");
    assert.deepEqual(fontesB.map(item => [item.sessaoId, item.grupoJid]), [["workspace_a_Claro", "333@g.us"]]);

    console.log("whatsapp-session-reference-cleanup.postgres.test.cjs OK");
  } finally {
    try {
      await pool.query("DROP TABLE IF EXISTS clonador_grupos_buffer, clonador_grupos_destinos, clonador_grupos_fontes, clonador_grupos_config CASCADE");
    } finally {
      await pool.end();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
