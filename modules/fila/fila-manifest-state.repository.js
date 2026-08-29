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
  authority_ready BOOLEAN NOT NULL DEFAULT FALSE,
  authority_ready_generation BIGINT,
  authority_ready_revision BIGINT,
  authority_ready_at TIMESTAMPTZ,
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
  ),
  CHECK (
    authority_ready = FALSE
    OR (
      authority_ready_generation IS NOT NULL
      AND authority_ready_revision IS NOT NULL
      AND authority_ready_generation = viva_generation
      AND authority_ready_revision <= revision
    )
  )
);
ALTER TABLE queue_manifest_state ADD COLUMN IF NOT EXISTS authority_ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_manifest_state ADD COLUMN IF NOT EXISTS authority_ready_generation BIGINT;
ALTER TABLE queue_manifest_state ADD COLUMN IF NOT EXISTS authority_ready_revision BIGINT;
ALTER TABLE queue_manifest_state ADD COLUMN IF NOT EXISTS authority_ready_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'queue_manifest_state_authority_ready_check'
  ) THEN
    ALTER TABLE queue_manifest_state
      ADD CONSTRAINT queue_manifest_state_authority_ready_check
      CHECK (
        authority_ready = FALSE
        OR (
          authority_ready_generation IS NOT NULL
          AND authority_ready_revision IS NOT NULL
          AND authority_ready_generation = viva_generation
          AND authority_ready_revision <= revision
        )
      );
  END IF;
END $$;
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
  const authorityReady = row.authority_ready === true || row.authorityReady === true;
  const authorityReadyGenerationBruta = row.authority_ready_generation ?? row.authorityReadyGeneration;
  const authorityReadyRevisionBruta = row.authority_ready_revision ?? row.authorityReadyRevision;
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
    authorityReady,
    authorityReadyGeneration: authorityReadyGenerationBruta === null || authorityReadyGenerationBruta === undefined
      ? null
      : numeroDb(authorityReadyGenerationBruta, 0),
    authorityReadyRevision: authorityReadyRevisionBruta === null || authorityReadyRevisionBruta === undefined
      ? null
      : numeroDb(authorityReadyRevisionBruta, 0),
    authorityReadyAt: row.authority_ready_at || row.authorityReadyAt || null,
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
  if (
    state.authorityReady &&
    (
      state.authorityReadyGeneration !== state.vivaGeneration ||
      !Number.isInteger(state.authorityReadyRevision) ||
      state.authorityReadyRevision > state.revision
    )
  ) {
    state.authorityReady = false;
    state.authorityReadyGeneration = null;
    state.authorityReadyRevision = null;
    state.authorityReadyAt = null;
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
    `SELECT cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation,
            authority_ready, authority_ready_generation, authority_ready_revision, authority_ready_at, updated_at
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
  const authorityReady = state.authorityReady === true;
  const authorityReadyGeneration = authorityReady ? state.vivaGeneration : null;
  const resultado = await client.query(
    `UPDATE ${TABELA}
        SET revision = revision + 1,
            viva_generation = $2,
            durable_checkpoint_generation = $3,
            dirty_generation = $4,
            authority_ready = $5,
            authority_ready_generation = $6,
            authority_ready_revision = CASE WHEN $5 THEN revision + 1 ELSE NULL END,
            authority_ready_at = CASE WHEN $5 THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE cliente_id = $1
      RETURNING cliente_id, revision, viva_generation, durable_checkpoint_generation, dirty_generation,
                authority_ready, authority_ready_generation, authority_ready_revision, authority_ready_at, updated_at`,
    [
      clienteSeguro(state.clienteId),
      state.vivaGeneration,
      state.durableCheckpointGeneration,
      dirtyGeneration,
      authorityReady,
      authorityReadyGeneration
    ]
  );
  return {
    ok: true,
    motivo,
    state: normalizarStateDb(resultado.rows?.[0] || state, state.clienteId)
  };
}

function estadoLogico(state = {}) {
  return {
    vivaGeneration: numeroDb(state.vivaGeneration, 0),
    durableCheckpointGeneration: numeroDb(state.durableCheckpointGeneration, 0),
    dirtyGeneration: state.dirtyGeneration === null || state.dirtyGeneration === undefined
      ? null
      : numeroDb(state.dirtyGeneration, 0)
  };
}

function estadosLogicosEquivalentes(a = {}, b = {}) {
  const left = estadoLogico(a);
  const right = estadoLogico(b);
  return left.vivaGeneration === right.vivaGeneration &&
    left.durableCheckpointGeneration === right.durableCheckpointGeneration &&
    left.dirtyGeneration === right.dirtyGeneration;
}

function reconciliarEstadosMonotonico(dbState = {}, jsonState = {}) {
  const db = estadoLogico(dbState);
  const json = estadoLogico(jsonState);
  const vivaGeneration = Math.max(db.vivaGeneration, json.vivaGeneration);
  const durableCheckpointGeneration = Math.min(
    vivaGeneration,
    Math.max(db.durableCheckpointGeneration, json.durableCheckpointGeneration)
  );
  let dirtyGeneration = null;
  if (vivaGeneration > durableCheckpointGeneration) {
    const candidatos = [db.dirtyGeneration, json.dirtyGeneration]
      .filter(valor => Number.isInteger(valor) && valor > durableCheckpointGeneration && valor <= vivaGeneration);
    dirtyGeneration = candidatos.length
      ? Math.min(...candidatos)
      : durableCheckpointGeneration + 1;
  }
  return {
    vivaGeneration,
    durableCheckpointGeneration,
    dirtyGeneration
  };
}

async function prepararReadinessAutoridade(clienteId = "admin", dados = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  return comTransacao(async (client) => {
    await inicializarSchemaQueueManifestState(client);
    const atual = await garantirLinhaCliente(client, cliente, {});
    const expectedRevision = numeroInteiroNaoNegativo(dados.expectedRevision);
    if (expectedRevision !== null && expectedRevision !== atual.revision) {
      if (atual.authorityReady) {
        await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_revision_stale");
      }
      return {
        ok: true,
        ready: false,
        motivo: "revision_stale",
        clienteId: cliente,
        state: atual
      };
    }

    if (typeof dados.lerManifesto !== "function") {
      if (atual.authorityReady) {
        const invalidado = await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_manifest_reader_missing");
        return { ...invalidado, ready: false, motivo: "manifest_reader_indisponivel" };
      }
      return { ok: true, ready: false, motivo: "manifest_reader_indisponivel", clienteId: cliente, state: atual };
    }

    const leituraManifesto = await dados.lerManifesto({ clienteId: cliente, state: atual });
    if (leituraManifesto?.ok !== true) {
      if (atual.authorityReady) {
        const invalidado = await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_manifest_indisponivel");
        return { ...invalidado, ready: false, motivo: leituraManifesto?.motivo || "manifest_indisponivel" };
      }
      return {
        ok: true,
        ready: false,
        motivo: leituraManifesto?.motivo || "manifest_indisponivel",
        clienteId: cliente,
        state: atual
      };
    }

    const jsonState = bootstrapValido(leituraManifesto.manifesto);
    if (!jsonState) {
      if (atual.authorityReady) {
        const invalidado = await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_manifest_invalido");
        return { ...invalidado, ready: false, motivo: "manifest_invalido" };
      }
      return { ok: true, ready: false, motivo: "manifest_invalido", clienteId: cliente, state: atual };
    }

    const reconciliado = reconciliarEstadosMonotonico(atual, jsonState);
    const dbPrecisaAvancar = !estadosLogicosEquivalentes(atual, reconciliado);
    const jsonPrecisaAlinhar = !estadosLogicosEquivalentes(jsonState, reconciliado);
    let jsonManifestFinal = leituraManifesto.manifesto;

    if (jsonPrecisaAlinhar) {
      if (typeof dados.escreverManifesto !== "function") {
        if (atual.authorityReady) {
          const invalidado = await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_manifest_writer_missing");
          return { ...invalidado, ready: false, motivo: "manifest_writer_indisponivel" };
        }
        return { ok: true, ready: false, motivo: "manifest_writer_indisponivel", clienteId: cliente, state: atual };
      }
      const escritaManifesto = await dados.escreverManifesto({
        clienteId: cliente,
        state: atual,
        manifestoAtual: leituraManifesto.manifesto,
        reconciliado
      });
      if (escritaManifesto === false || escritaManifesto?.ok === false) {
        const motivo = escritaManifesto?.motivo || "manifest_write_falhou";
        if (atual.authorityReady) {
          const invalidado = await atualizarState(client, { ...atual, authorityReady: false }, "authority_readiness_manifest_write_falhou");
          return { ...invalidado, ready: false, motivo };
        }
        return { ok: true, ready: false, motivo, clienteId: cliente, state: atual };
      }
      jsonManifestFinal = escritaManifesto.manifesto || jsonManifestFinal;
    }

    const resultado = await atualizarState(client, {
      clienteId: cliente,
      revision: atual.revision,
      ...reconciliado,
      authorityReady: true
    }, dbPrecisaAvancar || jsonPrecisaAlinhar ? "authority_readiness_bootstrap_reconciliado" : "authority_readiness_ready");

    return {
      ...resultado,
      ready: resultado.ok === true && resultado.state?.authorityReady === true,
      reconciliado: dbPrecisaAvancar || jsonPrecisaAlinhar,
      dbPrecisaAvancar,
      jsonPrecisaAlinhar,
      jsonManifest: jsonManifestFinal
    };
  }, deps);
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
         , authority_ready, authority_ready_generation, authority_ready_revision, authority_ready_at
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
    equivalente,
    dbAuthorityReady: dbState.authorityReady === true
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
  prepararReadinessAutoridade,
  registrarLegacySyncDuravel,
  registrarMutacaoDuravel,
  reconciliarEstadosMonotonico,
  validarState
};
