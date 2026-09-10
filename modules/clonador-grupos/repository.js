"use strict";

const { getEnginePool, queryEngine } = require("../engine/database");

const MAX_FONTES_ATIVAS = 4;
// `ignorada` e' um registro de auditoria: nunca entra no bridge porque ele
// reivindica somente `capturada`/`processando`.
const STATUS_BUFFER_VALIDOS = new Set(["capturada", "processando", "pronta", "encaminhada", "repetida", "ignorada", "erro"]);

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
          CHECK (status IN ('capturada', 'processando', 'pronta', 'encaminhada', 'repetida', 'ignorada', 'erro'))
        );

        -- Bancos ja' existentes foram criados antes da auditoria de historico.
        -- O CHECK e' expandido de forma aditiva, sem reclassificar linhas.
        ALTER TABLE clonador_grupos_buffer DROP CONSTRAINT IF EXISTS clonador_grupos_buffer_status_check;
        ALTER TABLE clonador_grupos_buffer ADD CONSTRAINT clonador_grupos_buffer_status_check
          CHECK (status IN ('capturada', 'processando', 'pronta', 'encaminhada', 'repetida', 'ignorada', 'erro'));

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
        CREATE INDEX IF NOT EXISTS idx_clonador_grupos_buffer_historico
          ON clonador_grupos_buffer (cliente_id, capturado_em DESC, id DESC);
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

  // Guarda somente o motivo e a identidade tecnica da captura descartada. O
  // texto, links e payload da mensagem nao sao replicados neste caminho.
  async function registrarCapturaIgnorada(item = {}) {
    await pronto();
    const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? item.metadata
      : {};
    const resultado = await executar(`
      INSERT INTO clonador_grupos_buffer (
        cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        texto_original, links, capturado_em, status, metadata
      ) VALUES ($1, $2, $3, $4, $5, '', '[]'::jsonb, COALESCE($6::timestamptz, NOW()), 'ignorada', $7::jsonb)
      ON CONFLICT (cliente_id, sessao_id, grupo_jid, mensagem_id)
      DO UPDATE SET
        updated_at = NOW(),
        metadata = (COALESCE(clonador_grupos_buffer.metadata, '{}'::jsonb) || ($7::jsonb - 'historicoResumo')) ||
          CASE WHEN ($7::jsonb ? 'historicoResumo') THEN jsonb_build_object(
            'historicoResumo', COALESCE(clonador_grupos_buffer.metadata -> 'historicoResumo', '{}'::jsonb) || ($7::jsonb -> 'historicoResumo')
          ) ELSE '{}'::jsonb END
      RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        texto_original, links, capturado_em, status, metadata, created_at, updated_at
    `, [
      texto(item.clienteId || item.cliente_id), texto(item.sessaoId || item.sessao_id),
      texto(item.grupoJid || item.grupo_jid), texto(item.grupoNome || item.grupo_nome),
      texto(item.mensagemId || item.mensagem_id), item.capturadoEm || item.capturado_em || null,
      jsonObjeto(metadata)
    ], query);
    return normalizarBuffer(resultado.rows[0] || {});
  }

  async function registrarRepeticaoCaptura(item = {}) {
    await pronto();
    const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? item.metadata
      : {};
    const resultado = await executar(`
      UPDATE clonador_grupos_buffer
         SET updated_at = NOW(),
              metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb), '{historicoResumo}',
                COALESCE(metadata -> 'historicoResumo', '{}'::jsonb) || jsonb_build_object(
                  'repeticoes', jsonb_build_object(
                    'total', CASE WHEN COALESCE(metadata #>> '{historicoResumo,repeticoes,total}', '') ~ '^[0-9]+$'
                      THEN (metadata #>> '{historicoResumo,repeticoes,total}')::int + 1 ELSE 1 END,
                    'ultimaEm', $5::text,
                    'motivos', (
                      SELECT jsonb_agg(valor ORDER BY pos)
                        FROM (
                          SELECT valor, MAX(pos) AS pos
                            FROM (
                              SELECT valor, pos
                                FROM jsonb_array_elements_text(COALESCE(metadata #> '{historicoResumo,repeticoes,motivos}', '[]'::jsonb)) WITH ORDINALITY AS motivos(valor, pos)
                              UNION ALL
                              SELECT $6::text, jsonb_array_length(COALESCE(metadata #> '{historicoResumo,repeticoes,motivos}', '[]'::jsonb)) + 1
                               WHERE NOT COALESCE(metadata #> '{historicoResumo,repeticoes,motivos}', '[]'::jsonb) ? $6::text
                            ) todos
                           GROUP BY valor
                           ORDER BY MAX(pos) DESC
                           LIMIT 8
                        ) recentes
                    )
                  )
                ), true
              )
       WHERE cliente_id = $1 AND sessao_id = $2 AND grupo_jid = $3 AND mensagem_id = $4
       RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
         texto_original, links, capturado_em, status, metadata, created_at, updated_at
    `, [
      texto(item.clienteId || item.cliente_id), texto(item.sessaoId || item.sessao_id),
      texto(item.grupoJid || item.grupo_jid), texto(item.mensagemId || item.mensagem_id),
      new Date().toISOString(), texto(metadata?.historicoResumo?.repeticoes?.motivo || metadata?.motivoCodigo || "mesma_mensagem")
    ], query);
    return normalizarBuffer(resultado.rows[0] || {});
  }

  async function reivindicarProximaCaptura(opcoes = {}) {
    await pronto();
    const clienteId = texto(opcoes.clienteId || opcoes.cliente_id);
    const timeoutMinutos = Math.max(1, Math.min(60, Number(opcoes.timeoutMinutos || 15)));
    const resultado = await executar(`
      WITH pendentes_por_workspace AS (
        SELECT DISTINCT ON (b.cliente_id)
          b.id AS id_representante,
          b.cliente_id,
          b.capturado_em,
          (
            SELECT MAX(h.updated_at)
              FROM clonador_grupos_buffer h
             WHERE h.cliente_id = b.cliente_id
               AND h.status IN ('processando', 'pronta', 'encaminhada', 'repetida', 'erro')
          ) AS ultimo_atendimento
          FROM clonador_grupos_buffer b
         WHERE ($1::text = '' OR b.cliente_id = $1)
           AND (
             b.status = 'capturada'
             OR (b.status = 'processando' AND b.updated_at < NOW() - ($2::text || ' minutes')::interval)
           )
         ORDER BY b.cliente_id, b.capturado_em ASC, b.id ASC
      ),
      workspace_escolhido AS (
        SELECT b.cliente_id
          FROM pendentes_por_workspace p
          JOIN clonador_grupos_buffer b ON b.id = p.id_representante
         ORDER BY p.ultimo_atendimento ASC NULLS FIRST, p.capturado_em ASC, p.id_representante ASC
         FOR UPDATE OF b SKIP LOCKED
         LIMIT 1
      ),
      candidata AS (
        SELECT b.id
          FROM clonador_grupos_buffer b
          JOIN workspace_escolhido w ON w.cliente_id = b.cliente_id
         WHERE (
           b.status = 'capturada'
           OR (b.status = 'processando' AND b.updated_at < NOW() - ($2::text || ' minutes')::interval)
         )
         ORDER BY b.capturado_em ASC, b.id ASC
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
              metadata = (COALESCE(metadata, '{}'::jsonb) || ($3::jsonb - 'historicoResumo')) ||
                CASE WHEN ($3::jsonb ? 'historicoResumo') THEN jsonb_build_object(
                  'historicoResumo', COALESCE(metadata -> 'historicoResumo', '{}'::jsonb) || ($3::jsonb -> 'historicoResumo')
                ) ELSE '{}'::jsonb END
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

  async function listarHistoricoBase(clienteId = "", filtros = {}) {
    await pronto();
    const limit = limitarBuffer(filtros.limit);
    const cursorCapturadoEm = texto(filtros.cursorCapturadoEm);
    const cursorId = Number(filtros.cursorId || 0);
    const grupoFonte = texto(filtros.grupoFonte);
    const dataInicio = texto(filtros.dataInicio);
    const dataFim = texto(filtros.dataFim);
    const tipo = texto(filtros.tipo).toLowerCase();
    const marketplace = texto(filtros.marketplace).toLowerCase();
    const status = texto(filtros.status).toLowerCase();
    const resultado = await executar(`
      SELECT id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        capturado_em, status, metadata, created_at, updated_at
        FROM clonador_grupos_buffer b
       WHERE b.cliente_id = $1
         AND ($2::text = '' OR b.grupo_jid = $2)
         AND ($3::timestamptz IS NULL OR b.capturado_em >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR b.capturado_em <= $4::timestamptz)
           AND ($5::text = '' OR
                ($5 = 'erro' AND (
                  b.status = 'erro' OR
                  lower(COALESCE(b.metadata #>> '{historicoResumo,statusCodigo}', '')) = 'erro' OR
                  lower(COALESCE(b.metadata #>> '{historicoResumo,resultadoAgregado}', '')) = 'erro'
                )) OR
                ($5 = 'repeticao' AND (
                  b.status = 'repetida' OR
                  COALESCE(b.metadata #>> '{historicoResumo,repeticoes,total}', '') ~ '^[1-9][0-9]*$' OR
                  lower(COALESCE(b.metadata #>> '{historicoResumo,motivoCodigo}', '')) IN (
                    'evento_duplicado', 'duplicidade_fila',
                    'sem_melhoria_financeira_janela_2h', 'repetida_no_executor_2h',
                    'destino_ja_enviado', 'fanout_destino_ja_enviado',
                    'replay_buffer', 'mesma_mensagem', 'mensagem_duplicada',
                    'mesma_condicao_comercial_janela_2h'
                  )
                )))
          AND ($6::text = '' OR lower(COALESCE(b.metadata #>> '{historicoResumo,marketplace}', '')) = $6)
          AND ($7::text = '' OR lower(COALESCE(
            NULLIF(b.metadata #>> '{historicoResumo,resultadoAgregado}', ''),
            NULLIF(b.metadata #>> '{historicoResumo,statusCodigo}', ''),
            b.status
          )) = $7)
          AND ($8::timestamptz IS NULL OR (b.capturado_em, b.id) < ($8::timestamptz, $9::bigint))
        ORDER BY b.capturado_em DESC, b.id DESC
        LIMIT $10
    `, [texto(clienteId), grupoFonte, dataInicio || null, dataFim || null, tipo, marketplace, status, cursorCapturadoEm || null, cursorId || 0, limit], query);
    return resultado.rows.map(normalizarBuffer);
  }

  async function atualizarResumoHistorico(bufferId = "", clienteId = "", resumo = {}) {
    await pronto();
    const resultado = await executar(`
      UPDATE clonador_grupos_buffer
         SET updated_at = NOW(),
             metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb), '{historicoResumo}',
               COALESCE(metadata -> 'historicoResumo', '{}'::jsonb) ||
                 CASE WHEN COALESCE(metadata #>> '{historicoResumo,statusCodigo}', '') IN ('enviada', 'parcial', 'falhou')
                            AND COALESCE($3::jsonb ->> 'statusCodigo', '') IN ('capturada', 'processando', 'na_fila', 'repetida', 'pendente')
                      THEN ($3::jsonb - 'statusCodigo' - 'resultadoAgregado')
                      ELSE $3::jsonb END, true)
       WHERE id = $1 AND cliente_id = $2
       RETURNING id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
         texto_original, links, capturado_em, status, metadata, created_at, updated_at
    `, [Number(bufferId), texto(clienteId), jsonObjeto(resumo)], query);
    const row = resultado.rows[0] || null;
    return row ? normalizarBuffer(row) : null;
  }

  async function obterHistoricoBasePorId(clienteId = "", bufferId = "") {
    await pronto();
    const resultado = await executar(`
      SELECT id, cliente_id, sessao_id, grupo_jid, grupo_nome, mensagem_id,
        capturado_em, status, metadata, created_at, updated_at
        FROM clonador_grupos_buffer
       WHERE id = $1 AND cliente_id = $2
       LIMIT 1
    `, [Number(bufferId), texto(clienteId)], query);
    const row = resultado.rows[0] || null;
    return row ? normalizarBuffer(row) : null;
  }

  async function buscarContextoHistorico(clienteId = "", bufferIds = []) {
    await pronto();
    const ids = [...new Set((Array.isArray(bufferIds) ? bufferIds : []).map(Number).filter(Number.isFinite))];
    if (!ids.length) return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] };
    const buffers = await executar(`SELECT id, metadata FROM clonador_grupos_buffer WHERE cliente_id = $1 AND id = ANY($2::bigint[])`, [texto(clienteId), ids], query);
    const eventoIds = buffers.rows.map(row => row.metadata?.clonadorGruposBridge?.eventoId || row.metadata?.historicoResumo?.eventoId).map(Number).filter(Number.isFinite);
    const [eventos, jobs, ofertas, fila, checkpoints] = await Promise.all([
      executar(`SELECT e.id, e.origem, e.status, e.criado_em, e.metadata
                  FROM engine_eventos_brutos e
                 WHERE e.cliente_id = $1 AND (
                   (e.metadata #>> '{clonadorGrupos,bufferId}')::text = ANY($2::text[])
                    OR (e.metadata #>> '{clonadorGruposBridge,bufferId}')::text = ANY($2::text[])
                    OR e.id = ANY($3::bigint[]))`, [texto(clienteId), ids.map(String), eventoIds], query),
      executar(`SELECT j.id, j.evento_id, j.oferta_id, j.status, j.criado_em, j.atualizado_em, j.metadata
                  FROM engine_jobs_cliente j
                  JOIN engine_eventos_brutos e ON e.id = j.evento_id
                  WHERE e.cliente_id = $1 AND ((e.metadata #>> '{clonadorGrupos,bufferId}')::text = ANY($2::text[]) OR e.id = ANY($3::bigint[]))`, [texto(clienteId), ids.map(String), eventoIds], query),
      executar(`SELECT o.id, o.status, o.marketplace, o.titulo, o.preco, o.preco_original, o.cupom, o.beneficio_extra, o.imagem, o.criada_em, o.metadata,
                       j.id AS job_id
                  FROM engine_ofertas o
                  JOIN engine_jobs_cliente j ON j.oferta_id = o.id
                  JOIN engine_eventos_brutos e ON e.id = j.evento_id
                  WHERE e.cliente_id = $1 AND ((e.metadata #>> '{clonadorGrupos,bufferId}')::text = ANY($2::text[]) OR e.id = ANY($3::bigint[]))`, [texto(clienteId), ids.map(String), eventoIds], query),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] })
    ]);
    return { eventos: eventos.rows, jobs: jobs.rows, ofertas: ofertas.rows, fila: fila.rows, checkpoints: checkpoints.rows };
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
    registrarCapturaIgnorada,
    registrarRepeticaoCaptura,
    reivindicarProximaCaptura,
    atualizarBufferStatus,
    listarBuffer,
    listarHistoricoBase,
    atualizarResumoHistorico,
    obterHistoricoBasePorId,
    buscarContextoHistorico
  };
}

module.exports = {
  criarRepositorioClonadorGrupos,
  STATUS_BUFFER_VALIDOS
};
