"use strict";

const crypto = require("crypto");
const { getEnginePool } = require("../engine/database");
const { normalizarClienteId } = require("../../utils/storage");

const TABELA = "fila_claims_ativos";

const SQL_SCHEMA_FILA_CLAIMS = `
CREATE TABLE IF NOT EXISTS fila_claims_ativos (
  cliente_id TEXT NOT NULL,
  fila_item_id TEXT NOT NULL CHECK (btrim(fila_item_id) <> ''),
  claim_token UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (cliente_id, fila_item_id),
  CHECK (lease_expires_at > claimed_at)
);
CREATE INDEX IF NOT EXISTS fila_claims_ativos_lease_expires_at_idx
  ON fila_claims_ativos (lease_expires_at);
`;

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarChaveClaimFila({ clienteId = "", filaItemId = "" } = {}) {
  const clienteBruto = texto(clienteId);
  if (!clienteBruto) throw new Error("fila_claim_cliente_id_ausente");
  const clienteNormalizado = normalizarClienteId(clienteBruto);
  const chave = {
    clienteId: texto(clienteNormalizado),
    filaItemId: texto(filaItemId)
  };

  if (!chave.filaItemId) throw new Error("fila_claim_item_id_ausente");
  if (/^indice:/i.test(chave.filaItemId)) throw new Error("fila_claim_item_id_posicional_nao_permitido");
  return chave;
}

function normalizarTokenClaim(claimToken = "") {
  const token = texto(claimToken);
  if (!token) throw new Error("fila_claim_token_ausente");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error("fila_claim_token_invalido");
  }
  return token;
}

function normalizarLeaseExpiresAt(valor) {
  if (valor instanceof Date && Number.isFinite(valor.getTime())) return valor.toISOString();
  const textoLease = texto(valor);
  const data = new Date(textoLease);
  if (!textoLease || !Number.isFinite(data.getTime())) throw new Error("fila_claim_lease_expires_at_invalido");
  return data.toISOString();
}

function gerarTokenClaimFila() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex").replace(
    /^(........)(....)(....)(....)(............)$/,
    "$1-$2-4$3-8$4-$5"
  );
}

function normalizarClaim(linha = {}, chave = {}, { incluirToken = false } = {}) {
  const claim = {
    clienteId: linha.cliente_id || chave.clienteId,
    filaItemId: linha.fila_item_id || chave.filaItemId,
    claimedAt: linha.claimed_at || null,
    leaseExpiresAt: linha.lease_expires_at || null
  };
  if (incluirToken && linha.claim_token) claim.claimToken = linha.claim_token;
  return claim;
}

async function comExecutorClaim(opcoes = {}, callback) {
  const clientExterno = opcoes.client;
  if (clientExterno && typeof clientExterno.query === "function") return callback(clientExterno);

  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") throw new Error("fila_claim_pool_indisponivel");

  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    if (typeof client.release === "function") client.release();
  }
}

async function adquirirClaimFila(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveClaimFila(entrada);
  const leaseExpiresAt = normalizarLeaseExpiresAt(entrada.leaseExpiresAt);
  const claimToken = gerarTokenClaimFila();

  const resultado = await comExecutorClaim(opcoes, client => client.query(
    `INSERT INTO ${TABELA} (cliente_id, fila_item_id, claim_token, lease_expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cliente_id, fila_item_id) DO NOTHING
     RETURNING cliente_id, fila_item_id, claim_token, claimed_at, lease_expires_at`,
    [chave.clienteId, chave.filaItemId, claimToken, leaseExpiresAt]
  ));

  if (!resultado.rows?.[0]) {
    return { ok: true, adquirido: false, claim: null, motivo: "claim_ativo_existente" };
  }
  return {
    ok: true,
    adquirido: true,
    claim: normalizarClaim(resultado.rows[0], chave, { incluirToken: true })
  };
}

async function obterClaimFila(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveClaimFila(entrada);
  const resultado = await comExecutorClaim(opcoes, client => client.query(
    `SELECT cliente_id, fila_item_id, claimed_at, lease_expires_at
       FROM ${TABELA}
      WHERE cliente_id = $1 AND fila_item_id = $2
      LIMIT 1`,
    [chave.clienteId, chave.filaItemId]
  ));
  return resultado.rows?.[0] ? normalizarClaim(resultado.rows[0], chave) : null;
}

async function renovarClaimFila(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveClaimFila(entrada);
  const claimToken = normalizarTokenClaim(entrada.claimToken);
  const leaseExpiresAt = normalizarLeaseExpiresAt(entrada.leaseExpiresAt);
  const resultado = await comExecutorClaim(opcoes, client => client.query(
    `UPDATE ${TABELA}
        SET lease_expires_at = $4
      WHERE cliente_id = $1
        AND fila_item_id = $2
        AND claim_token = $3
        AND lease_expires_at > NOW()
      RETURNING cliente_id, fila_item_id, claimed_at, lease_expires_at`,
    [chave.clienteId, chave.filaItemId, claimToken, leaseExpiresAt]
  ));
  return {
    ok: true,
    renovado: Boolean(resultado.rows?.[0]),
    claim: resultado.rows?.[0] ? normalizarClaim(resultado.rows[0], chave) : null,
    motivo: resultado.rows?.[0] ? "" : "claim_ausente_token_incorreto_ou_expirado"
  };
}

async function liberarClaimFila(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveClaimFila(entrada);
  const claimToken = normalizarTokenClaim(entrada.claimToken);
  const resultado = await comExecutorClaim(opcoes, client => client.query(
    `DELETE FROM ${TABELA}
      WHERE cliente_id = $1 AND fila_item_id = $2 AND claim_token = $3
      RETURNING cliente_id, fila_item_id`,
    [chave.clienteId, chave.filaItemId, claimToken]
  ));
  return {
    ok: true,
    liberado: Boolean(resultado.rows?.[0]),
    idempotente: !resultado.rows?.[0],
    motivo: resultado.rows?.[0] ? "" : "claim_ausente_ou_token_incorreto"
  };
}

module.exports = {
  TABELA,
  SQL_SCHEMA_FILA_CLAIMS,
  normalizarChaveClaimFila,
  normalizarLeaseExpiresAt,
  normalizarTokenClaim,
  gerarTokenClaimFila,
  adquirirClaimFila,
  obterClaimFila,
  renovarClaimFila,
  liberarClaimFila
};
