"use strict";

const { getEnginePool, queryEngine } = require("../engine/database");

const MAX_FONTES_ATIVAS = 4;
const STATUS_BUFFER_VALIDOS = new Set(["capturada", "processando", "pronta", "encaminhada", "repetida", "erro"]);

let schemaPromise = null;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function bool(valor) {
  return valor === true;
}

function erroDb(resultado = {}, motivo = "clonador_grupos_db_erro") {
  const erro = new Error(resultado.erro || resultado.motivo || motivo);
  erro.codigo = resultado.motivo || motivo;
  erro.statusCode = 503;
  return erro;
}

function erroValidacao(codigo = "clonador_grupos_validacao_falhou", detalhes = {}) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = 400;
  erro.detalhes = detalhes;
  return erro;
}

async function executar(sql, params = [], query = queryEngine) {
  const resultado = await query(sql, params);
  if (!resultado?.ok) throw erroDb(resultado);
  return resultado.resultado;
}

function contarFontesAtivas(fontes = []) {
  return fontes.filter(fonte => fonte?.ativo !== false).length;
}

function serializarFontes(fontes = []) {
  return fontes.map(fonte => ({
    sessao_id: texto(fonte.sessaoId || fonte.sessao_id),
    grupo_jid: texto(fonte.grupoJid || fonte.grupo_jid),
    grupo_nome: texto(fonte.grupoNome || fonte.grupo_nome),
    ativo: fonte.ativo !== false
  }));
}

function serializarDestinos(destinoIds = []) {
  return destinoIds.map(destinoId => ({ destino_id: texto(destinoId) }));
}

function normalizarStatusBuffer(status = "") {
  const valor = texto(status || "capturada").toLowerCase();
  return STATUS_BUFFER_VALIDOS.has(valor) ? valor : "capturada";
}

function limitarBuffer(valor = 50) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 50;
  return Math.max(1, Math.min(100, Math.floor(numero)));
}

function jsonObjeto(valor = {}) {
  return JSON.stringify(valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
}

function criarRepositorioClonadorGrupos(opcoes = {}) {
  const query = opcoes.queryEngine || queryEngine;
  const pool = opcoes.pool || getEnginePool;

  function poolAtual() {
    return typeof pool === "function" ? pool() : pool;
  }

  async function comTransacao(callback) {
    const clientPool = poolAtual();
    if (!clientPool || typeof clientPool.connect !== "function") {
      throw erroDb({ motivo: "pool_indisponivel" });
    }

    const client = await clientPool.connect();
    try {
      await client.query("BEGIN");
      const resultado = await callback(client);
      await client.query("COMMIT");
      return resultado;
    } catch (erro) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw erro;
    } finally {
      if (client && typeof client.release === "function") client.release();
    }
  }

  async function bloquearWorkspace(client, namespace = "", clienteId = "") {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [namespace, clienteId]
    );
  }

  async function prepararSchema() {
    if (!schemaPromise) {
      schemaPromise = executar(`
        CREATE TABLE IF NOT EXISTS clonador_grupos_config (
          cliente_id TEXT PRIMARY KEY,
          ativo BOOLEAN NOT NULL DEFAULT FALSE,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS clonador_grupos_fontes (
          id BIGSERIAL PRIMARY KEY,
          cliente_id TEXT NOT NULL,
          sessao_id TEXT NOT NULL,
          grupo_jid TEXT NOT NULL,
          grupo_nome TEXT NOT NULL DEFAULT '',
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (cliente_id, sessao_id, grupo_jid)
        );

        CREATE TABLE IF NOT EXISTS clonador_grupos_destinos (
          id BIGSERIAL PRIMARY KEY,
          cliente_id TEXT NOT NULL,
          destino_id TEXT NOT NULL,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (cliente_id, destino_id)
        );

        CREATE TABLE IF NOT EXISTS clonador_grupos_buffer (
          id BIGSERIAL PRIMARY KEY,
          cliente_id TEXT NOT NULL,
          sessao_id TEXT NOT NULL,
          grupo_jid TEXT NOT NULL,
          grupo_nome TEXT NOT NULL DEFAULT '',
          mensagem_id TEXT NOT NULL,
          texto_original TEXT NOT NULL DEFAULT '',
          links JSONB NOT NULL DEFAULT '[]'::jsonb,
          capturado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status TEXT NOT NULL DEFAULT 'capturada',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (cliente_id, sessao_id, grupo_jid, mensagem_id),
          CHECK (status IN ('capturada', 'processando', 'pronta', 'encaminhada', 'repetida', 'erro'))
        );

        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_fontes_cliente
          ON clonador_grupos_fontes (cliente_id);
        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_fontes_ativas
          ON clonador_grupos_fontes (cliente_id, ativo);
        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_destinos_cliente
          ON clonador_grupos_destinos (cliente_id);
        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_buffer_cliente_status
          ON clonador_grupos_buffer (cliente_id, status, capturado_em DESC);
        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_buffer_fonte
          ON clonador_grupos_buffer (cliente_id, sessao_id, grupo_jid, capturado_em DESC);
      `, [], query).catch((erro) => {
        schemaPromise = null;
        throw erro;
      });
    }
    return schemaPromise;
  }

  async function pronto() {
    await prepararSchema();
  }

  function normalizarConfig(row = {}, clienteId = "") {
    return {
      clienteId: texto(row.cliente_id || clienteId),
      ativo: bool(row.ativo),
      criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : "",
      atualizadoEm: row.atualizado_em ? new Date(row.atualizado_em).toISOString() : ""
    };
  }

  function normalizarFonte(row = {}) {
    return {
      id: row.id ? String(row.id) : "",
      clienteId: texto(row.cliente_id),
      sessaoId: texto(row.sessao_id),
      grupoJid: texto(row.grupo_jid),
      grupoNome: texto(row.grupo_nome),
      ativo: row.ativo !== false,
      criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : "",
      atualizadoEm: row.atualizado_em ? new Date(row.atualizado_em).toISOString() : ""
    };
  }

  function normalizarDestino(row = {}) {
    return {
      id: row.id ? String(row.id) : "",
      clienteId: texto(row.cliente_id),
      destinoId: texto(row.destino_id),
      criadoEm: row.criado_em ? new Date(row.criado_em).toISOString() : "",
      atualizadoEm: row.atualizado_em ? new Date(row.atualizado_em).toISOString() : ""
    };
  }

  function normalizarBuffer(row = {}) {
    return {
      id: row.id ? String(row.id) : "",
      clienteId: texto(row.cliente_id),
      sessaoId: texto(row.sessao_id),
      grupoJid: texto(row.grupo_jid),
      grupoNome: texto(row.grupo_nome),
      mensagemId: texto(row.mensagem_id),
      textoOriginal: String(row.texto_original ?? ""),
      links: Array.isArray(row.links) ? row.links : [],
      capturadoEm: row.capturado_em ? new Date(row.capturado_em).toISOString() : "",
      status: normalizarStatusBuffer(row.status),
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
    };
  }

  async function lerConfig(clienteId = "") {
    await pronto();
    const resultado = await executar(
      "SELECT cliente_id, ativo, criado_em, atualizado_em FROM clonador_grupos_config WHERE cliente_id = $1",
      [texto(clienteId)],
      query
    );
    return normalizarConfig(resultado.rows[0] || {}, clienteId);
  }

  async function salvarConfig(clienteId = "", dados = {}) {
    await pronto();
    const resultado = await executar(`
      INSERT INTO clonador_grupos_config (cliente_id, ativo)
      VALUES ($1, $2)
      ON CONFLICT (cliente_id)
      DO UPDATE SET ativo = EXCLUDED.ativo, atualizado_em = NOW()
      RETURNING cliente_id, ativo, criado_em, atualizado_em
    `, [texto(clienteId), dados.ativo === true], query);
    return normalizarConfig(resultado.rows[0] || {}, clienteId);
  }

  async function listarFontes(clienteId = "") {
    await pronto();
    const resultado = await executar(`
      SELECT id, cliente_id, sessao_id, grupo_jid, grupo_nome, ativo, criado_em, atualizado_em
        FROM clonador_grupos_fontes
       WHERE cliente_id = $1
       ORDER BY ativo DESC, atualizado_em DESC, id ASC
    `, [texto(clienteId)], query);
    return resultado.rows.map(normalizarFonte);
  }

  async function substituirFontes(clienteId = "", fontes = []) {
    await pronto();
    const cliente = texto(clienteId);
    const fontesNormalizadas = serializarFontes(fontes);
    return comTransacao(async (client) => {
      await bloquearWorkspace(client, "clonador_grupos:fontes", cliente);
      const ativas = contarFontesAtivas(fontesNormalizadas);
      if (ativas > MAX_FONTES_ATIVAS) {
        throw erroValidacao("limite_fontes_ativas_excedido", {
          limite: MAX_FONTES_ATIVAS,
          atual: ativas
        });
      }

      await client.query("DELETE FROM clonador_grupos_fontes WHERE cliente_id = $1", [cliente]);
      if (!fontesNormalizadas.length) return [];

      const resultado = await client.query(`
        INSERT INTO clonador_grupos_fontes (cliente_id, sessao_id, grupo_jid, grupo_nome, ativo)
        SELECT $1, fonte.sessao_id, fonte.grupo_jid, fonte.grupo_nome, fonte.ativo
          FROM jsonb_to_recordset($2::jsonb)
            AS fonte(sessao_id TEXT, grupo_jid TEXT, grupo_nome TEXT, ativo BOOLEAN)
        RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, ativo, criado_em, atualizado_em
      `, [cliente, JSON.stringify(fontesNormalizadas)]);
      return resultado.rows.map(normalizarFonte);
    });
  }

  async function listarDestinos(clienteId = "") {
    await pronto();
    const resultado = await executar(`
      SELECT id, cliente_id, destino_id, criado_em, atualizado_em
        FROM clonador_grupos_destinos
       WHERE cliente_id = $1
       ORDER BY atualizado_em DESC, id ASC
    `, [texto(clienteId)], query);
    return resultado.rows.map(normalizarDestino);
  }

  async function substituirDestinos(clienteId = "", destinoIds = []) {
    await pronto();
    const cliente = texto(clienteId);
    const destinosNormalizados = serializarDestinos(destinoIds);
    return comTransacao(async (client) => {
      await bloquearWorkspace(client, "clonador_grupos:destinos", cliente);
      await client.query("DELETE FROM clonador_grupos_destinos WHERE cliente_id = $1", [cliente]);
      if (!destinosNormalizados.length) return [];

      const resultado = await client.query(`
        INSERT INTO clonador_grupos_destinos (cliente_id, destino_id)
        SELECT $1, destino_id
          FROM jsonb_to_recordset($2::jsonb) AS destino(destino_id TEXT)
        RETURNING id, cliente_id, destino_id, criado_em, atualizado_em
      `, [cliente, JSON.stringify(destinosNormalizados)]);
      return resultado.rows.map(normalizarDestino);
    });
  }

  async function inserirBufferCaptura(item = {}) {
    await pronto();
    const resultado = await executar(`
      INSERT INTO clonador_grupos_buffer (
        cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        texto_original, links, capturado_em, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, NOW()), $9, $10::jsonb)
      ON CONFLICT (cliente_id, sessao_id, grupo_jid, mensagem_id)
      DO NOTHING
      RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        texto_original, links, capturado_em, status, metadata, created_at, updated_at
    `, [
      texto(item.clienteId || item.cliente_id),
      texto(item.sessaoId || item.sessao_id),
      texto(item.grupoJid || item.grupo_jid),
      texto(item.grupoNome || item.grupo_nome),
      texto(item.mensagemId || item.mensagem_id),
      String(item.textoOriginal ?? item.texto_original ?? ""),
      JSON.stringify(Array.isArray(item.links) ? item.links : []),
      item.capturadoEm || item.capturado_em || null,
      normalizarStatusBuffer(item.status),
      JSON.stringify(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {})
    ], query);
    const row = resultado.rows[0] || null;
    return row ? { inserido: true, item: normalizarBuffer(row) } : { inserido: false, item: null };
  }

  async function reivindicarProximaCaptura(opcoes = {}) {
    await pronto();
    const clienteId = texto(opcoes.clienteId || opcoes.cliente_id);
    const timeoutMinutos = Math.max(1, Math.min(60, Number(opcoes.timeoutMinutos || 15)));
    const resultado = await executar(`
      WITH candidata AS (
        SELECT id
          FROM clonador_grupos_buffer
         WHERE ($1::text = '' OR cliente_id = $1)
           AND (
             status = 'capturada'
             OR (status = 'processando' AND updated_at < NOW() - ($2::text || ' minutes')::interval)
           )
         ORDER BY capturado_em ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      UPDATE clonador_grupos_buffer b
         SET status = 'processando',
             updated_at = NOW(),
             metadata = COALESCE(b.metadata, '{}'::jsonb) || $3::jsonb
        FROM candidata
       WHERE b.id = candidata.id
       RETURNING b.id, b.cliente_id, b.sessao_id, b.grupo_jid, b.grupo_nome, b.mensagem_id,
         b.texto_original, b.links, b.capturado_em, b.status, b.metadata, b.created_at, b.updated_at
    `, [
      clienteId,
      String(timeoutMinutos),
      jsonObjeto({
        clonadorGruposBridge: {
          status: "processando",
          reivindicadoEm: new Date().toISOString()
        }
      })
    ], query);
    const row = resultado.rows[0] || null;
    return row ? normalizarBuffer(row) : null;
  }

  async function atualizarBufferStatus(bufferId = "", status = "capturada", metadata = {}) {
    await pronto();
    const statusNormalizado = normalizarStatusBuffer(status);
    const resultado = await executar(`
      UPDATE clonador_grupos_buffer
         SET status = $2,
             updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
       RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
         texto_original, links, capturado_em, status, metadata, created_at, updated_at
    `, [Number(bufferId), statusNormalizado, jsonObjeto(metadata)], query);
    const row = resultado.rows[0] || null;
    return row ? normalizarBuffer(row) : null;
  }

  async function listarBuffer(clienteId = "", filtros = {}) {
    await pronto();
    const status = texto(filtros.status).toLowerCase();
    const statusFiltro = STATUS_BUFFER_VALIDOS.has(status) ? status : "";
    const resultado = await executar(`
      SELECT id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        texto_original, links, capturado_em, status, metadata, created_at, updated_at
        FROM clonador_grupos_buffer
       WHERE cliente_id = $1
         AND ($2::text = '' OR status = $2)
       ORDER BY capturado_em DESC, id DESC
       LIMIT $3
    `, [texto(clienteId), statusFiltro, limitarBuffer(filtros.limit)], query);
    return resultado.rows.map(normalizarBuffer);
  }

  return {
    prepararSchema,
    lerConfig,
    salvarConfig,
    listarFontes,
    substituirFontes,
    listarDestinos,
    substituirDestinos,
    inserirBufferCaptura,
    reivindicarProximaCaptura,
    atualizarBufferStatus,
    listarBuffer
  };
}

module.exports = {
  criarRepositorioClonadorGrupos,
  STATUS_BUFFER_VALIDOS
};
