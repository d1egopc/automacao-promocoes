"use strict";

const crypto = require("crypto");
const { getEnginePool } = require("../engine/database");
const { normalizarClienteId } = require("../../utils/storage");

const TABELA = "fila_checkpoints_entrega";
const ESTADOS = Object.freeze([
  "preparado",
  "envio_iniciado",
  "enviado",
  "falha_confirmada",
  "resultado_ambiguo"
]);

const TRANSICOES = Object.freeze({
  preparado: Object.freeze(["envio_iniciado"]),
  envio_iniciado: Object.freeze(["enviado", "falha_confirmada", "resultado_ambiguo"]),
  enviado: Object.freeze([]),
  falha_confirmada: Object.freeze([]),
  resultado_ambiguo: Object.freeze([])
});

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarTabela(tabela = TABELA) {
  const valor = texto(tabela);
  if (!/^[a-z_][a-z0-9_]*$/i.test(valor)) throw new Error("fila_checkpoint_tabela_invalida");
  return valor;
}

function sqlSchemaCheckpointEntrega(tabela = TABELA) {
  const nome = normalizarTabela(tabela);
  return `
CREATE TABLE IF NOT EXISTS ${nome} (
  cliente_id TEXT NOT NULL CHECK (btrim(cliente_id) <> ''),
  fila_item_id TEXT NOT NULL CHECK (btrim(fila_item_id) <> ''),
  destino_chave TEXT NOT NULL CHECK (btrim(destino_chave) <> ''),
  alvo_chave TEXT NOT NULL CHECK (btrim(alvo_chave) <> ''),
  attempt_id UUID NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN (
    'preparado',
    'envio_iniciado',
    'enviado',
    'falha_confirmada',
    'resultado_ambiguo'
  )),
  provider_message_id TEXT,
  credito_debitado BOOLEAN,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cliente_id, fila_item_id, destino_chave, alvo_chave)
);`;
}

const SQL_SCHEMA_FILA_CHECKPOINTS_ENTREGA = sqlSchemaCheckpointEntrega();

function normalizarChaveCheckpointEntrega({
  clienteId = "",
  filaItemId = "",
  destinoChave = "",
  alvoChave = ""
} = {}) {
  const clienteBruto = texto(clienteId);
  if (!clienteBruto) throw new Error("fila_checkpoint_cliente_id_ausente");
  const chave = {
    clienteId: texto(normalizarClienteId(clienteBruto)),
    filaItemId: texto(filaItemId),
    destinoChave: texto(destinoChave),
    alvoChave: texto(alvoChave)
  };
  if (!chave.filaItemId) throw new Error("fila_checkpoint_item_id_ausente");
  if (/^indice:/i.test(chave.filaItemId)) throw new Error("fila_checkpoint_item_id_posicional_nao_permitido");
  if (!chave.destinoChave) throw new Error("fila_checkpoint_destino_chave_ausente");
  if (!chave.alvoChave) throw new Error("fila_checkpoint_alvo_chave_ausente");
  return chave;
}

function normalizarAttemptId(attemptId = "") {
  const valor = texto(attemptId);
  if (!valor) throw new Error("fila_checkpoint_attempt_id_ausente");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)) {
    throw new Error("fila_checkpoint_attempt_id_invalido");
  }
  return valor;
}

function gerarAttemptIdCheckpointEntrega() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex").replace(
    /^(........)(....)(....)(....)(............)$/,
    "$1-$2-4$3-8$4-$5"
  );
}

function normalizarEstado(estado = "") {
  const valor = texto(estado).toLowerCase();
  if (!ESTADOS.includes(valor)) throw new Error("fila_checkpoint_estado_invalido");
  return valor;
}

function normalizarProviderMessageId(valor) {
  if (valor === undefined || valor === null) return null;
  const id = texto(valor);
  if (!id) throw new Error("fila_checkpoint_provider_message_id_invalido");
  return id;
}

function normalizarCreditoDebitado(valor) {
  if (valor === undefined) return undefined;
  if (typeof valor !== "boolean") throw new Error("fila_checkpoint_credito_debitado_invalido");
  return valor;
}

function normalizarTransicao({ deEstado = "", paraEstado = "" } = {}) {
  const de = normalizarEstado(deEstado);
  const para = normalizarEstado(paraEstado);
  if (!TRANSICOES[de].includes(para)) throw new Error("fila_checkpoint_transicao_invalida");
  return { deEstado: de, paraEstado: para };
}

function paramsChave(chave = {}) {
  return [chave.clienteId, chave.filaItemId, chave.destinoChave, chave.alvoChave];
}

function normalizarLinha(linha = {}, chave = {}) {
  return {
    clienteId: linha.cliente_id || chave.clienteId,
    filaItemId: linha.fila_item_id || chave.filaItemId,
    destinoChave: linha.destino_chave || chave.destinoChave,
    alvoChave: linha.alvo_chave || chave.alvoChave,
    attemptId: linha.attempt_id || "",
    estado: linha.estado || "",
    providerMessageId: linha.provider_message_id || null,
    creditoDebitado: typeof linha.credito_debitado === "boolean" ? linha.credito_debitado : null,
    criadoEm: linha.criado_em || null,
    atualizadoEm: linha.atualizado_em || null
  };
}

async function comExecutor(opcoes = {}, callback) {
  const clientExterno = opcoes.client;
  if (clientExterno && typeof clientExterno.query === "function") return callback(clientExterno);
  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") throw new Error("fila_checkpoint_pool_indisponivel");
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    if (typeof client.release === "function") client.release();
  }
}

function tabelaDas(opcoes = {}) {
  return normalizarTabela(opcoes.tabela || TABELA);
}

async function criarCheckpointEntrega(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveCheckpointEntrega(entrada);
  const attemptId = normalizarAttemptId(entrada.attemptId);
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `INSERT INTO ${tabela} (
       cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id, estado
     ) VALUES ($1, $2, $3, $4, $5, 'preparado')
     ON CONFLICT (cliente_id, fila_item_id, destino_chave, alvo_chave) DO NOTHING
     RETURNING cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
               estado, provider_message_id, credito_debitado, criado_em, atualizado_em`,
    [...paramsChave(chave), attemptId]
  ));
  return {
    criado: resultado.rowCount > 0,
    checkpoint: resultado.rows?.[0] ? normalizarLinha(resultado.rows[0], chave) : null
  };
}

async function obterCheckpointEntrega(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveCheckpointEntrega(entrada);
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `SELECT cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
            estado, provider_message_id, credito_debitado, criado_em, atualizado_em
       FROM ${tabela}
      WHERE cliente_id = $1 AND fila_item_id = $2
        AND destino_chave = $3 AND alvo_chave = $4
      LIMIT 1`,
    paramsChave(chave)
  ));
  return resultado.rows?.[0] ? normalizarLinha(resultado.rows[0], chave) : null;
}

async function transicionarCheckpointEntrega(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveCheckpointEntrega(entrada);
  const attemptId = normalizarAttemptId(entrada.attemptId);
  const { deEstado, paraEstado } = normalizarTransicao(entrada);
  const providerMessageId = normalizarProviderMessageId(entrada.providerMessageId);
  const creditoDebitado = normalizarCreditoDebitado(entrada.creditoDebitado);
  if (paraEstado !== "enviado" && (providerMessageId !== null || creditoDebitado !== undefined)) {
    throw new Error("fila_checkpoint_evidencia_apenas_envio_confirmado");
  }
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `UPDATE ${tabela}
        SET estado = $7,
            provider_message_id = CASE WHEN $8::text IS NULL THEN provider_message_id ELSE $8 END,
            credito_debitado = CASE WHEN $9::boolean IS NULL THEN credito_debitado ELSE $9 END,
            atualizado_em = NOW()
      WHERE cliente_id = $1 AND fila_item_id = $2
        AND destino_chave = $3 AND alvo_chave = $4
        AND attempt_id = $5 AND estado = $6
      RETURNING cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
                estado, provider_message_id, credito_debitado, criado_em, atualizado_em`,
    [...paramsChave(chave), attemptId, deEstado, paraEstado, providerMessageId, creditoDebitado ?? null]
  ));
  return {
    transicionado: resultado.rowCount > 0,
    checkpoint: resultado.rows?.[0] ? normalizarLinha(resultado.rows[0], chave) : null,
    motivo: resultado.rowCount > 0 ? "" : "checkpoint_ausente_attempt_ou_estado_divergente"
  };
}

// Esta operacao e deliberadamente restrita a falha confirmada. Resultado
// ambiguo nao e retomado por este repository nem por esta fase shadow.
async function prepararNovaTentativaCheckpointEntrega(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveCheckpointEntrega(entrada);
  const attemptIdAnterior = normalizarAttemptId(entrada.attemptIdAnterior);
  const attemptId = normalizarAttemptId(entrada.attemptId);
  if (attemptId === attemptIdAnterior) throw new Error("fila_checkpoint_attempt_id_novo_igual_anterior");
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `UPDATE ${tabela}
        SET attempt_id = $6,
            estado = 'preparado',
            provider_message_id = NULL,
            credito_debitado = NULL,
            atualizado_em = NOW()
      WHERE cliente_id = $1 AND fila_item_id = $2
        AND destino_chave = $3 AND alvo_chave = $4
        AND attempt_id = $5 AND estado = 'falha_confirmada'
      RETURNING cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
                estado, provider_message_id, credito_debitado, criado_em, atualizado_em`,
    [...paramsChave(chave), attemptIdAnterior, attemptId]
  ));
  return {
    preparada: resultado.rowCount > 0,
    checkpoint: resultado.rows?.[0] ? normalizarLinha(resultado.rows[0], chave) : null,
    motivo: resultado.rowCount > 0 ? "" : "checkpoint_nao_e_falha_confirmada_ou_attempt_divergente"
  };
}

module.exports = {
  TABELA,
  ESTADOS,
  TRANSICOES,
  SQL_SCHEMA_FILA_CHECKPOINTS_ENTREGA,
  sqlSchemaCheckpointEntrega,
  normalizarChaveCheckpointEntrega,
  normalizarAttemptId,
  gerarAttemptIdCheckpointEntrega,
  normalizarEstado,
  normalizarTransicao,
  criarCheckpointEntrega,
  obterCheckpointEntrega,
  transicionarCheckpointEntrega,
  prepararNovaTentativaCheckpointEntrega
};
