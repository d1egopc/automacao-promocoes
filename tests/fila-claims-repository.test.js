"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repo = require("../modules/fila/fila-claims.repository");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function chave(params = []) {
  return `${params[0]}|${params[1]}`;
}

function criarPoolMemoria() {
  const persistido = new Map();
  const locks = new Map();
  let proximoClientId = 1;

  function copiarState(state) {
    return new Map([...state.entries()].map(([id, linha]) => [id, { ...linha }]));
  }

  return {
    persistido,
    async connect() {
      const client = {
        id: proximoClientId++, snapshot: null, emTransacao: false, liberado: false,
        async query(sql, params = []) {
          const texto = String(sql).replace(/\s+/g, " ").trim();
          const id = chave(params);
          const state = client.emTransacao ? client.snapshot : persistido;
          if (texto === "BEGIN") {
            client.snapshot = copiarState(persistido);
            client.emTransacao = true;
            return { rows: [], rowCount: 0 };
          }
          if (texto === "COMMIT") {
            persistido.clear();
            for (const [key, value] of client.snapshot.entries()) persistido.set(key, { ...value });
            client.snapshot = null;
            client.emTransacao = false;
            return { rows: [], rowCount: 0 };
          }
          if (texto === "ROLLBACK") {
            client.snapshot = null;
            client.emTransacao = false;
            return { rows: [], rowCount: 0 };
          }
          if (/^INSERT INTO fila_claims_ativos/i.test(texto)) {
            const anterior = locks.get(id) || Promise.resolve();
            let liberar;
            const bloqueio = new Promise(resolve => { liberar = resolve; });
            locks.set(id, anterior.then(() => bloqueio));
            await anterior;
            try {
              if (state.has(id)) return { rows: [], rowCount: 0 };
              const agora = "2026-09-09T12:00:00.000Z";
              const row = {
                cliente_id: params[0], fila_item_id: params[1], claim_token: params[2],
                claimed_at: agora, lease_expires_at: params[3]
              };
              state.set(id, row);
              return { rows: [clone(row)], rowCount: 1 };
            } finally { liberar(); }
          }
          if (/^SELECT .* FROM fila_claims_ativos/i.test(texto)) {
            const row = state.get(id);
            if (!row) return { rows: [], rowCount: 0 };
            return { rows: [{
              cliente_id: row.cliente_id, fila_item_id: row.fila_item_id,
              claimed_at: row.claimed_at, lease_expires_at: row.lease_expires_at
            }], rowCount: 1 };
          }
          if (/^UPDATE fila_claims_ativos/i.test(texto)) {
            const row = state.get(id);
            if (!row || row.claim_token !== params[2] || Date.parse(row.lease_expires_at) <= Date.now()) {
              return { rows: [], rowCount: 0 };
            }
            row.lease_expires_at = params[3];
            return { rows: [{
              cliente_id: row.cliente_id, fila_item_id: row.fila_item_id,
              claimed_at: row.claimed_at, lease_expires_at: row.lease_expires_at
            }], rowCount: 1 };
          }
          if (/^DELETE FROM fila_claims_ativos/i.test(texto)) {
            const row = state.get(id);
            if (!row || row.claim_token !== params[2]) return { rows: [], rowCount: 0 };
            state.delete(id);
            return { rows: [{ cliente_id: row.cliente_id, fila_item_id: row.fila_item_id }], rowCount: 1 };
          }
          throw new Error(`sql_nao_suportado: ${texto}`);
        },
        release() { client.liberado = true; }
      };
      return client;
    }
  };
}

function entrada(clienteId = "workspace_a", filaItemId = "engine_1") {
  return { clienteId, filaItemId, leaseExpiresAt: "2030-01-01T00:00:00.000Z" };
}

async function testarSchemaEContrato() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8");
  const tabelaClaims = schema.match(/CREATE TABLE IF NOT EXISTS fila_claims_ativos \([\s\S]*?\n\);/i)?.[0] || "";
  assert.match(schema, /CREATE TABLE IF NOT EXISTS fila_claims_ativos/i);
  assert.match(tabelaClaims, /PRIMARY KEY \(cliente_id, fila_item_id\)/i);
  assert.match(tabelaClaims, /claim_token UUID NOT NULL/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS fila_claims_ativos_lease_expires_at_idx/i);
  assert.doesNotMatch(tabelaClaims, /(titulo|preco|cupom|marketplace|origem_fluxo|destino|imagem|url|mensagem|creditos)/i);
  assert.match(repo.SQL_SCHEMA_FILA_CLAIMS, /lease_expires_at/i);
  assert.throws(() => repo.normalizarChaveClaimFila({ clienteId: "", filaItemId: "engine_1" }), /cliente_id_ausente/);
  assert.throws(() => repo.normalizarChaveClaimFila({ clienteId: "workspace", filaItemId: "indice:4" }), /posicional/);
  assert.throws(() => repo.normalizarLeaseExpiresAt(), /lease_expires_at_invalido/);
  assert.strictEqual(repo.normalizarLeaseExpiresAt("2030-01-01T00:00:00.000Z"), "2030-01-01T00:00:00.000Z");
}

async function testarOperacoesBasicas() {
  const pool = criarPoolMemoria();
  const primeiro = await repo.adquirirClaimFila(entrada(), { pool });
  assert.strictEqual(primeiro.adquirido, true);
  assert.match(primeiro.claim.claimToken, /^[0-9a-f-]{36}$/i);
  assert.strictEqual(primeiro.claim.clienteId, "workspace_a");
  assert.strictEqual(primeiro.claim.filaItemId, "engine_1");

  const segundo = await repo.adquirirClaimFila(entrada(), { pool });
  assert.strictEqual(segundo.adquirido, false);
  assert.strictEqual(segundo.claim, null);

  const leitura = await repo.obterClaimFila(entrada(), { pool });
  assert.strictEqual(leitura.claimToken, undefined, "consulta generica nao expoe token");
  assert.strictEqual(leitura.claimedAt, "2026-09-09T12:00:00.000Z");

  const renovado = await repo.renovarClaimFila({ ...entrada(), claimToken: primeiro.claim.claimToken, leaseExpiresAt: "2030-01-02T00:00:00.000Z" }, { pool });
  assert.strictEqual(renovado.renovado, true);
  assert.strictEqual(renovado.claim.leaseExpiresAt, "2030-01-02T00:00:00.000Z");
  const tokenErrado = "00000000-0000-4000-8000-000000000000";
  assert.strictEqual((await repo.renovarClaimFila({ ...entrada(), claimToken: tokenErrado, leaseExpiresAt: "2030-01-03T00:00:00.000Z" }, { pool })).renovado, false);
  pool.persistido.get("workspace_a|engine_1").lease_expires_at = "2020-01-01T00:00:00.000Z";
  assert.strictEqual((await repo.renovarClaimFila({ ...entrada(), claimToken: primeiro.claim.claimToken, leaseExpiresAt: "2030-01-03T00:00:00.000Z" }, { pool })).renovado, false, "claim expirado nao e revivido pela renovacao");

  assert.strictEqual((await repo.liberarClaimFila({ ...entrada(), claimToken: tokenErrado }, { pool })).liberado, false);
  assert.strictEqual((await repo.liberarClaimFila({ ...entrada(), claimToken: primeiro.claim.claimToken }, { pool })).liberado, true);
  const liberacaoIdempotente = await repo.liberarClaimFila({ ...entrada(), claimToken: primeiro.claim.claimToken }, { pool });
  assert.strictEqual(liberacaoIdempotente.liberado, false);
  assert.strictEqual(liberacaoIdempotente.idempotente, true);
  assert.strictEqual(await repo.obterClaimFila(entrada(), { pool }), null);
}

async function testarConcorrenciaEIsolamento() {
  const pool = criarPoolMemoria();
  const [a, b] = await Promise.all([
    repo.adquirirClaimFila(entrada("workspace_a", "engine_mesmo"), { pool }),
    repo.adquirirClaimFila(entrada("workspace_a", "engine_mesmo"), { pool })
  ]);
  assert.strictEqual([a, b].filter(resultado => resultado.adquirido).length, 1, "mesmo item tem exatamente um vencedor");

  const [itemDiferente, workspaceDiferente] = await Promise.all([
    repo.adquirirClaimFila(entrada("workspace_a", "engine_outro"), { pool }),
    repo.adquirirClaimFila(entrada("workspace_b", "engine_mesmo"), { pool })
  ]);
  assert.strictEqual(itemDiferente.adquirido, true);
  assert.strictEqual(workspaceDiferente.adquirido, true);
}

async function testarClientExternoERollback() {
  const pool = criarPoolMemoria();
  const client = await pool.connect();
  await client.query("BEGIN");
  const claim = await repo.adquirirClaimFila(entrada("workspace_tx", "engine_tx"), { client });
  assert.strictEqual(claim.adquirido, true);
  await client.query("ROLLBACK");
  client.release();
  assert.strictEqual(await repo.obterClaimFila(entrada("workspace_tx", "engine_tx"), { pool }), null, "rollback externo nao deixa claim");
}

(async () => {
  await testarSchemaEContrato();
  await testarOperacoesBasicas();
  await testarConcorrenciaEIsolamento();
  await testarClientExternoERollback();
  console.log("fila-claims-repository.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
