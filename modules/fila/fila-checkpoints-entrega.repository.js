"use strict";

const crypto = require("crypto");
const { getEnginePool } = require("../engine/database");
const { normalizarClienteId } = require("../../utils/storage");

const TABELA = "fila_checkpoints_entrega";
const TABELA_CURSOR_RECOVERY = "fila_checkpoint_recovery_cursor";
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

function sqlSchemaCheckpointRecoveryCursor(tabela = TABELA_CURSOR_RECOVERY) {
  const nome = normalizarTabela(tabela);
  return `
CREATE TABLE IF NOT EXISTS ${nome} (
  cliente_id TEXT PRIMARY KEY CHECK (btrim(cliente_id) <> ''),
  ultimo_fila_item_id TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;
}

const SQL_SCHEMA_FILA_CHECKPOINT_RECOVERY_CURSOR = sqlSchemaCheckpointRecoveryCursor();

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

function normalizarFilaItemIds(filaItemIds = [], limite = 8) {
  const quantidade = Math.max(1, Math.min(32, Number(limite) || 8));
  const vistos = new Set();
  const ids = [];
  for (const candidato of Array.isArray(filaItemIds) ? filaItemIds : []) {
    const item = texto(candidato);
    if (!item || /^indice:/i.test(item) || vistos.has(item)) continue;
    vistos.add(item);
    ids.push(item);
    if (ids.length >= quantidade) break;
  }
  return ids;
}

function ordenarFilaItemIdsEstaveis(filaItemIds = []) {
  return [...filaItemIds].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function selecionarFatiaCircular(filaItemIds = [], cursorAnterior = "", limite = 8) {
  const ids = ordenarFilaItemIdsEstaveis(normalizarFilaItemIds(filaItemIds, 32));
  if (!ids.length) return { filaItemIds: [], cursorAnterior: texto(cursorAnterior), cursorAtual: "" };
  const quantidade = Math.max(1, Math.min(8, Number(limite) || 8, ids.length));
  const cursor = texto(cursorAnterior);
  const indiceExato = cursor ? ids.indexOf(cursor) : -1;
  let inicio = 0;
  if (indiceExato >= 0) {
    inicio = (indiceExato + 1) % ids.length;
  } else if (cursor) {
    const proximo = ids.findIndex(id => id > cursor);
    inicio = proximo >= 0 ? proximo : 0;
  }
  const selecionados = [];
  for (let deslocamento = 0; deslocamento < quantidade; deslocamento += 1) {
    selecionados.push(ids[(inicio + deslocamento) % ids.length]);
  }
  return {
    filaItemIds: selecionados,
    cursorAnterior: cursor,
    cursorAtual: selecionados[selecionados.length - 1]
  };
}

async function selecionarFatiaRecoveryCheckpoint({ clienteId = "", filaItemIds = [], limite = 8 } = {}, opcoes = {}) {
  const cliente = texto(normalizarClienteId(texto(clienteId)));
  if (!cliente) throw new Error("fila_checkpoint_cliente_id_ausente");
  const ids = normalizarFilaItemIds(filaItemIds, 32);
  if (!ids.length) return { filaItemIds: [], cursorAnterior: "", cursorAtual: "" };
  const tabelaCursor = normalizarTabela(opcoes.tabelaCursor || TABELA_CURSOR_RECOVERY);
  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") throw new Error("fila_checkpoint_pool_indisponivel");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ${tabelaCursor} (cliente_id, ultimo_fila_item_id)
       VALUES ($1, NULL)
       ON CONFLICT (cliente_id) DO NOTHING`,
      [cliente]
    );
    const estado = await client.query(
      `SELECT ultimo_fila_item_id
         FROM ${tabelaCursor}
        WHERE cliente_id = $1
        FOR UPDATE`,
      [cliente]
    );
    const fatia = selecionarFatiaCircular(ids, estado.rows?.[0]?.ultimo_fila_item_id || "", limite);
    await client.query(
      `UPDATE ${tabelaCursor}
          SET ultimo_fila_item_id = $2,
              atualizado_em = NOW()
        WHERE cliente_id = $1`,
      [cliente, fatia.cursorAtual]
    );
    await client.query("COMMIT");
    return fatia;
  } catch (erro) {
    try { await client.query("ROLLBACK"); } catch {}
    throw erro;
  } finally {
    if (typeof client.release === "function") client.release();
  }
}

// A fila e a autoridade dos candidatos. Esta leitura recebe somente ids de
// itens atualmente processando, evitando varrer o historico de checkpoints.
async function listarCheckpointsEntregaPorItens({ clienteId = "", filaItemIds = [], limite = 8 } = {}, opcoes = {}) {
  const cliente = texto(normalizarClienteId(texto(clienteId)));
  if (!cliente) throw new Error("fila_checkpoint_cliente_id_ausente");
  const ids = normalizarFilaItemIds(filaItemIds, limite);
  if (!ids.length) return [];
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `SELECT cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
            estado, provider_message_id, credito_debitado, criado_em, atualizado_em
       FROM ${tabela}
      WHERE cliente_id = $1 AND fila_item_id = ANY($2::text[])
      ORDER BY fila_item_id ASC, criado_em ASC, destino_chave ASC, alvo_chave ASC`,
    [cliente, ids]
  ));
  return (resultado.rows || []).map(linha => normalizarLinha(linha, { clienteId: cliente }));
}

async function listarCheckpointsEntregaPorItem({ clienteId = "", filaItemId = "" } = {}, opcoes = {}) {
  const cliente = texto(normalizarClienteId(texto(clienteId)));
  const item = texto(filaItemId);
  if (!cliente) throw new Error("fila_checkpoint_cliente_id_ausente");
  if (!item || /^indice:/i.test(item)) throw new Error("fila_checkpoint_item_id_invalido");
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `SELECT cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
            estado, provider_message_id, credito_debitado, criado_em, atualizado_em
       FROM ${tabela}
      WHERE cliente_id = $1 AND fila_item_id = $2`,
    [cliente, item]
  ));
  return (resultado.rows || []).map(linha => normalizarLinha(linha, {
    clienteId: cliente,
    filaItemId: item
  }));
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

// O saldo continua fora desta tabela. Esta escrita so registra evidencia de
// que o debito existente ja concluiu e nunca tenta debitar, compensar ou
// reconstruir creditos.
async function registrarCreditoDebitadoCheckpointEntrega(entrada = {}, opcoes = {}) {
  const chave = normalizarChaveCheckpointEntrega(entrada);
  const attemptId = normalizarAttemptId(entrada.attemptId);
  const tabela = tabelaDas(opcoes);
  const resultado = await comExecutor(opcoes, client => client.query(
    `UPDATE ${tabela}
        SET credito_debitado = TRUE,
            atualizado_em = NOW()
      WHERE cliente_id = $1 AND fila_item_id = $2
        AND destino_chave = $3 AND alvo_chave = $4
        AND attempt_id = $5 AND estado = 'enviado'
      RETURNING cliente_id, fila_item_id, destino_chave, alvo_chave, attempt_id,
                estado, provider_message_id, credito_debitado, criado_em, atualizado_em`,
    [...paramsChave(chave), attemptId]
  ));
  return {
    registrado: resultado.rowCount > 0,
    checkpoint: resultado.rows?.[0] ? normalizarLinha(resultado.rows[0], chave) : null,
    motivo: resultado.rowCount > 0 ? "" : "checkpoint_nao_enviado_ou_attempt_divergente"
  };
}

module.exports = {
  TABELA,
  TABELA_CURSOR_RECOVERY,
  ESTADOS,
  TRANSICOES,
  SQL_SCHEMA_FILA_CHECKPOINTS_ENTREGA,
  SQL_SCHEMA_FILA_CHECKPOINT_RECOVERY_CURSOR,
  sqlSchemaCheckpointEntrega,
  sqlSchemaCheckpointRecoveryCursor,
  normalizarChaveCheckpointEntrega,
  normalizarAttemptId,
  gerarAttemptIdCheckpointEntrega,
  normalizarEstado,
  normalizarTransicao,
  criarCheckpointEntrega,
  obterCheckpointEntrega,
  listarCheckpointsEntregaPorItens,
  listarCheckpointsEntregaPorItem,
  selecionarFatiaCircular,
  selecionarFatiaRecoveryCheckpoint,
  transicionarCheckpointEntrega,
  prepararNovaTentativaCheckpointEntrega,
  registrarCreditoDebitadoCheckpointEntrega
};
