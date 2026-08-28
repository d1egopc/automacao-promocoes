"use strict";

const { getEnginePool } = require("../engine/database");
const { normalizarClienteId } = require("../../utils/storage");

const TABELA = "queue_manifest_state";

const SQL_SCHEMA_QUEUE_MANIFEST_STATE = `
CREATE TABLE IF NOT EXISTS queue_manifest_state (
  cliente_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  viva_generation BIGINT NOT NULL DEFAULT 0 CHECK (viva_generation >= 0),
  durable_checkpoint_generation BIGINT NOT NULL DEFAULT 0 CHECK (durable_checkpoint_generation >= 0),
  dirty_generation BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (durable_checkpoint_generation <= viva_generation),
  CHECK (
    (viva_generation = durable_checkpoint_generation AND dirty_generation IS NULL)
    OR
    (
      viva_generation > durable_checkpoint_generation
      AND dirty_generation IS NOT NULL
      AND dirty_generation > durable_checkpoint_generation
      AND dirty_generation <= viva_generation
    )
  )
);
`;

function clienteSeguro(clienteId = "admin") {
  return normalizarClienteId(clienteId || "admin") || "admin";
}

function numeroInteiroNaoNegativo(valor) {
  return Number.isInteger(valor) && valor >= 0 ? valor : null;
}

function numeroDb(valor, padrao = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return padrao;
  return Math.floor(numero);
}

function estadoZero(clienteId = "admin") {
  return {
    clienteId: clienteSeguro(clienteId),
    revision: 0,
    vivaGeneration: 0,
    durableCheckpointGeneration: 0,
    dirtyGeneration: null,
    updatedAt: null
  };
}

function dirtyCoerente(vivaGeneration, durableCheckpointGeneration, dirtyGeneration) {
  if (vivaGeneration === durableCheckpointGeneration) return dirtyGeneration === null;
  return Number.isInteger(dirtyGeneration) &&
    dirtyGeneration > durableCheckpointGeneration &&
    dirtyGeneration <= vivaGeneration;
}

function validarState(state = {}) {
  const vivaGeneration = numeroInteiroNaoNegativo(state.vivaGeneration);
  const durableCheckpointGeneration = numeroInteiroNaoNegativo(state.durableCheckpointGeneration);
  const revision = numeroInteiroNaoNegativo(state.revision);
  const dirtyGeneration = state.dirtyGeneration === null
    ? null
    : numeroInteiroNaoNegativo(state.dirtyGeneration);

  if (vivaGeneration === null || durableCheckpointGeneration === null || revision === null) return false;
  if (durableCheckpointGeneration > vivaGeneration) return false;
  return dirtyCoerente(vivaGeneration, durableCheckpointGeneration, dirtyGeneration);
}

function normalizarStateDb(row = {}, clienteId = "admin") {
  const state = {
    clienteId: clienteSeguro(row.cliente_id || row.clienteId || clienteId),
    revision: numeroDb(row.revision, 0),
    vivaGeneration: numeroDb(row.viva_generation ?? row.vivaGeneration, 0),
    durableCheckpointGeneration: numeroDb(
      row.durable_checkpoint_generation ?? row.durableCheckpointGeneration,
      0
    ),
    dirtyGeneration: row.dirty_generation === null || row.dirtyGeneration === null
      ? null
      : numeroDb(row.dirty_generation ?? row.dirtyGeneration, 0),
    updatedAt: row.updated_at || row.updatedAt || null
  };

  if (state.durableCheckpointGeneration > state.vivaGeneration) {
    state.durableCheckpointGeneration = state.vivaGeneration;
  }
  if (state.vivaGeneration <= state.durableCheckpointGeneration) {
    state.dirtyGeneration = null;
  } else if (
    !Number.isInteger(state.dirtyGeneration) ||
    state.dirtyGeneration <= state.durableCheckpointGeneration ||
    state.dirtyGeneration > state.vivaGeneration
  ) {
    state.dirtyGeneration = state.durableCheckpointGeneration + 1;
  }
  return state;
}

function bootstrapValido(manifesto = {}) {
  const bruto = manifesto && typeof manifesto === "object" ? manifesto : {};
  const manifestVersion = numeroInteiroNaoNegativo(bruto.manifestVersion ?? bruto.version);
  const vivaGeneration = numeroInteiroNaoNegativo(bruto.vivaGeneration);
  const durableCheckpointGeneration = numeroInteiroNaoNegativo(bruto.durableCheckpointGeneration);
  const dirtyGeneration = bruto.dirtyGeneration === null
    ? null
    : numeroInteiroNaoNegativo(bruto.dirtyGeneration);

  if (manifestVersion === null || manifestVersion < 2) return null;
  const state = {
    clienteId: clienteSeguro(bruto.clienteId || "admin"),
    revision: 0,
    vivaGeneration,
    durableCheckpointGeneration,
    dirtyGeneration,
    updatedAt: null
  };
  return validarState(state) ? state : null;
}

function estadoBootstrap(clienteId = "admin", manifesto = {}) {
  const valido = bootstrapValido(manifesto);
  if (!valido) return estadoZero(clienteId);
  return {
    ...valido,
    clienteId: clienteSeguro(clienteId)
  };
}

function poolPadrao(deps = {}) {
  if (Object.prototype.hasOwnProperty.call(deps, "pool")) {
    return typeof deps.pool === "function" ? deps.pool() : deps.pool;
  }
  return getEnginePool();
}

async function comTransacao(callback, deps = {}) {
  const pool = poolPadrao(deps);
  if (!pool || typeof pool.connect !== "function") {
    return { ok: false, motivo: "pool_indisponivel" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await callback(client);
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    return {
      ok: false,
      motivo: erro?.codigo || erro?.message || "transacao_manifest_state_falhou",
      erro: erro?.message || "erro_manifest_state"
    };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

async function inicializarSchemaQueueManifestState(client) {
  await client.query(SQL_SCHEMA_QUEUE_MANIFEST_STATE);
}

async function garantirLinhaCliente(client, clienteId = "admin", manifestoBootstrap = {}) {
  const cliente = clienteSeguro(clienteId);
  const inicial = estadoBootstrap(cliente, manifestoBootstrap);
  await client.query(
    `INSERT INTO ${TABELA} (
       cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation
     )
     VALUES ($1, 0, $2, $3, $4)
     ON CONFLICT (cliente_id) DO NOTHING`,
    [
      cliente,
      inicial.vivaGeneration,
      inicial.durableCheckpointGeneration,
      inicial.dirtyGeneration
    ]
  );

  const resultado = await client.query(
    `SELECT cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation, updated_at
       FROM ${TABELA}
      WHERE cliente_id = $1
      FOR UPDATE`,
    [cliente]
  );

  return normalizarStateDb(resultado.rows?.[0] || {}, cliente);
}

async function atualizarState(client, state = {}, motivo = "manifest_state") {
  const dirtyGeneration = state.vivaGeneration > state.durableCheckpointGeneration
    ? state.dirtyGeneration || state.durableCheckpointGeneration + 1
    : null;
  const resultado = await client.query(
    `UPDATE ${TABELA}
        SET revision = revision + 1,
            viva_generation = $2,
            durable_checkpoint_generation = $3,
            dirty_generation = $4,
            updated_at = NOW()
      WHERE cliente_id = $1
      RETURNING cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation, updated_at`,
    [
      clienteSeguro(state.clienteId),
      state.vivaGeneration,
      state.durableCheckpointGeneration,
      dirtyGeneration
    ]
  );
  return {
    ok: true,
    motivo,
    state: normalizarStateDb(resultado.rows?.[0] || state, state.clienteId)
  };
}

async function registrarMutacaoDuravel(clienteId = "admin", dados = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  return comTransacao(async (client) => {
    await inicializarSchemaQueueManifestState(client);
    const atual = await garantirLinhaCliente(client, cliente, dados.bootstrapManifest);
    const nextGeneration = atual.vivaGeneration + 1;

    if (typeof dados.escreverArquivo === "function") {
      const escrita = await dados.escreverArquivo({ clienteId: cliente, state: atual, nextGeneration });
      if (escrita === false || escrita?.ok === false) {
        const erro = new Error(escrita?.motivo || "arquivo_viva_falhou");
        erro.codigo = "arquivo_viva_falhou";
        throw erro;
      }
    }

    const checkpointSincronizado = dados.checkpointSincronizado === true;
    const durableCheckpointGeneration = checkpointSincronizado
      ? nextGeneration
      : atual.durableCheckpointGeneration;
    const dirtyGeneration = checkpointSincronizado
      ? null
      : (atual.dirtyGeneration || durableCheckpointGeneration + 1);

    return atualizarState(client, {
      clienteId: cliente,
      vivaGeneration: nextGeneration,
      durableCheckpointGeneration,
      dirtyGeneration
    }, dados.motivo || "manifest_state_mutacao");
  }, deps);
}

async function capturarTargetCheckpoint(clienteId = "admin", dados = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  return comTransacao(async (client) => {
    await inicializarSchemaQueueManifestState(client);
    const state = await garantirLinhaCliente(client, cliente, dados.bootstrapManifest);
    return {
      ok: true,
      motivo: "checkpoint_target_capturado",
      clienteId: cliente,
      targetGeneration: state.vivaGeneration,
      state
    };
  }, deps);
}

async function confirmarCheckpointDuravel(clienteId = "admin", dados = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const target = numeroInteiroNaoNegativo(dados.targetGeneration);
  if (target === null) return { ok: false, motivo: "target_generation_invalido" };

  return comTransacao(async (client) => {
    await inicializarSchemaQueueManifestState(client);
    const atual = await garantirLinhaCliente(client, cliente, dados.bootstrapManifest);
    const durableCheckpointGeneration = Math.min(
      atual.vivaGeneration,
      Math.max(atual.durableCheckpointGeneration, target)
    );
    const dirtyGeneration = atual.vivaGeneration > durableCheckpointGeneration
      ? Math.max(
          durableCheckpointGeneration + 1,
          atual.dirtyGeneration || durableCheckpointGeneration + 1
        )
      : null;

    return atualizarState(client, {
      clienteId: cliente,
      vivaGeneration: atual.vivaGeneration,
      durableCheckpointGeneration,
      dirtyGeneration
    }, dados.motivo || "manifest_state_checkpoint");
  }, deps);
}

async function registrarLegacySyncDuravel(clienteId = "admin", dados = {}, deps = {}) {
  return registrarMutacaoDuravel(clienteId, {
    ...dados,
    checkpointSincronizado: true,
    motivo: dados.motivo || "manifest_state_legacy_sync"
  }, deps);
}

async function lerStateObservacional(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const pool = poolPadrao(deps);
  if (!pool || typeof pool.connect !== "function") {
    return { ok: false, motivo: "pool_indisponivel" };
  }

  const client = await pool.connect();
  try {
    await inicializarSchemaQueueManifestState(client);
    const resultado = await client.query(
      `SELECT cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation, updated_at
         FROM ${TABELA}
        WHERE cliente_id = $1
        LIMIT 1`,
      [cliente]
    );
    if (!resultado.rows?.[0]) return { ok: false, motivo: "state_ausente", clienteId: cliente };
    return {
      ok: true,
      motivo: "ok",
      clienteId: cliente,
      state: normalizarStateDb(resultado.rows[0], cliente)
    };
  } catch (erro) {
    return {
      ok: false,
      motivo: "state_read_error",
      clienteId: cliente,
      erro: erro?.message || "erro_state"
    };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

function compararDbJson(dbState = null, jsonManifest = null) {
  if (!dbState) return { resultado: "db_indisponivel" };
  const json = bootstrapValido(jsonManifest);
  if (!json) return { resultado: "json_indisponivel" };
  const equivalente = dbState.vivaGeneration === json.vivaGeneration &&
    dbState.durableCheckpointGeneration === json.durableCheckpointGeneration &&
    dbState.dirtyGeneration === json.dirtyGeneration;
  return {
    resultado: equivalente ? "db_json_equivalente" : "db_json_divergente",
    equivalente
  };
}

module.exports = {
  SQL_SCHEMA_QUEUE_MANIFEST_STATE,
  TABELA,
  bootstrapValido,
  capturarTargetCheckpoint,
  compararDbJson,
  confirmarCheckpointDuravel,
  estadoBootstrap,
  estadoZero,
  inicializarSchemaQueueManifestState,
  lerStateObservacional,
  normalizarStateDb,
  registrarLegacySyncDuravel,
  registrarMutacaoDuravel,
  validarState
};
