"use strict";

const { queryEngine } = require("../engine/database");
const { SQL_SCHEMA_PLATFORM_VARIABLES_V1 } = require("./platform-variables.schema");

async function executarQuery(sql, params = [], query = queryEngine) {
  const resultado = await query(sql, params);
  if (!resultado?.ok) {
    const erro = new Error(resultado?.erro || resultado?.motivo || "Falha ao acessar PostgreSQL");
    erro.codigo = resultado?.motivo || "postgres_indisponivel";
    erro.statusCode = 503;
    throw erro;
  }
  return resultado.resultado;
}

async function prepararSchemaPlatformVariables({ query = queryEngine } = {}) {
  for (const sql of SQL_SCHEMA_PLATFORM_VARIABLES_V1) {
    await executarQuery(sql, [], query);
  }
  return { ok: true };
}

function criarPlatformVariablesRepository({ query = queryEngine } = {}) {
  return {
    prepararSchema: () => prepararSchemaPlatformVariables({ query }),

    async listar() {
      const resultado = await executarQuery(`
        SELECT name, type, encrypted_value, iv, auth_tag, key_version, sensitive,
               description, created_at, updated_at, updated_by
          FROM platform_variables
         WHERE deleted_at IS NULL
         ORDER BY name ASC
      `, [], query);
      return resultado.rows || [];
    },

    async buscar(nome) {
      const resultado = await executarQuery(`
        SELECT name, type, encrypted_value, iv, auth_tag, key_version, sensitive,
               description, created_at, updated_at, updated_by
          FROM platform_variables
         WHERE name = $1 AND deleted_at IS NULL
         LIMIT 1
      `, [nome], query);
      return (resultado.rows || [])[0] || null;
    },

    async salvar({ nome, tipo, encryptedValue, iv, authTag, keyVersion, description, updatedBy }) {
      const resultado = await executarQuery(`
        INSERT INTO platform_variables
          (name, type, encrypted_value, iv, auth_tag, key_version, sensitive, description, updated_by)
        VALUES
          ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
        ON CONFLICT (name) DO UPDATE SET
          type = EXCLUDED.type,
          encrypted_value = EXCLUDED.encrypted_value,
          iv = EXCLUDED.iv,
          auth_tag = EXCLUDED.auth_tag,
          key_version = EXCLUDED.key_version,
          sensitive = TRUE,
          description = EXCLUDED.description,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW(),
          deleted_at = NULL
        RETURNING name, type, encrypted_value, iv, auth_tag, key_version, sensitive,
                  description, created_at, updated_at, updated_by
      `, [nome, tipo, encryptedValue, iv, authTag, keyVersion, description || null, updatedBy || null], query);
      return (resultado.rows || [])[0] || null;
    },

    async excluir(nome, updatedBy) {
      const resultado = await executarQuery(`
        UPDATE platform_variables
           SET deleted_at = NOW(),
               updated_at = NOW(),
               updated_by = $2
         WHERE name = $1 AND deleted_at IS NULL
        RETURNING name
      `, [nome, updatedBy || null], query);
      return ((resultado.rows || [])[0] || null) !== null;
    }
  };
}

module.exports = {
  criarPlatformVariablesRepository,
  prepararSchemaPlatformVariables
};
