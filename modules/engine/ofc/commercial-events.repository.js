const { queryEngine } = require("../database");

const SQL_SCHEMA_EVENTOS_COMERCIAIS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS engine_eventos_comerciais (
    id BIGSERIAL PRIMARY KEY,
    tipo_evento TEXT NOT NULL,
    cliente_id TEXT,
    workspace_id TEXT,
    oferta_id BIGINT,
    job_id BIGINT,
    fila_item_id TEXT,
    destino_id TEXT,
    canal TEXT,
    marketplace TEXT,
    ocorrido_em TIMESTAMPTZ DEFAULT NOW(),
    origem_pipeline TEXT,
    chave_idempotencia TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS workspace_id TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS oferta_id BIGINT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS job_id BIGINT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS fila_item_id TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS destino_id TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS canal TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS marketplace TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS ocorrido_em TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS origem_pipeline TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS chave_idempotencia TEXT`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE engine_eventos_comerciais ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_chave
    ON engine_eventos_comerciais (chave_idempotencia)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_tipo_ocorrido
    ON engine_eventos_comerciais (tipo_evento, ocorrido_em)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_cliente_ocorrido
    ON engine_eventos_comerciais (cliente_id, ocorrido_em)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_marketplace
    ON engine_eventos_comerciais (marketplace)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_oferta
    ON engine_eventos_comerciais (oferta_id)`,
  `CREATE INDEX IF NOT EXISTS idx_engine_eventos_comerciais_job
    ON engine_eventos_comerciais (job_id)`
]);

function duracaoMsEventosComerciais(inicio) {
  return Math.max(0, Date.now() - inicio);
}

function textoErroEventosComerciais(erro = "") {
  return String(erro?.message || erro || "erro_desconhecido").slice(0, 180);
}

function logSchemaEventosComerciaisOk(inicio) {
  console.log("[ENGINE-EVENTOS-COMERCIAIS-SCHEMA-OK]", JSON.stringify({
    tabelaDisponivel: true,
    indiceIdempotenciaDisponivel: true,
    duracaoMs: duracaoMsEventosComerciais(inicio)
  }));
}

function logSchemaEventosComerciaisErro(inicio, motivo = "schema_eventos_comerciais_falhou", erro = "") {
  console.log("[ENGINE-EVENTOS-COMERCIAIS-SCHEMA-ERRO]", JSON.stringify({
    motivo,
    erro: textoErroEventosComerciais(erro),
    duracaoMs: duracaoMsEventosComerciais(inicio)
  }));
}

async function prepararSchemaEventosComerciaisSeguro(opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const inicio = Date.now();

  try {
    for (const sql of SQL_SCHEMA_EVENTOS_COMERCIAIS) {
      const resultado = await executarQuery(sql);
      if (!resultado?.ok) {
        logSchemaEventosComerciaisErro(
          inicio,
          resultado?.motivo || "schema_eventos_comerciais_query_falhou",
          resultado?.erro || ""
        );
        return {
          ok: false,
          motivo: resultado?.motivo || "schema_eventos_comerciais_query_falhou",
          erro: resultado?.erro || "",
          failSafe: true
        };
      }
    }

    logSchemaEventosComerciaisOk(inicio);
    return {
      ok: true,
      tabelaDisponivel: true,
      indiceIdempotenciaDisponivel: true,
      duracaoMs: duracaoMsEventosComerciais(inicio)
    };
  } catch (e) {
    logSchemaEventosComerciaisErro(inicio, "schema_eventos_comerciais_exception", e);
    return {
      ok: false,
      motivo: "schema_eventos_comerciais_exception",
      erro: e?.message || "",
      failSafe: true
    };
  }
}

async function inserirEventoComercial(evento = {}) {
  const resultado = await queryEngine(
    `INSERT INTO engine_eventos_comerciais (
       tipo_evento, cliente_id, workspace_id, oferta_id, job_id, fila_item_id,
       destino_id, canal, marketplace, ocorrido_em, origem_pipeline,
       chave_idempotencia, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $12, $13::jsonb)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING id`,
    [
      evento.tipoEvento,
      evento.clienteId || null,
      evento.workspaceId || null,
      evento.ofertaId || null,
      evento.jobId || null,
      evento.filaItemId || null,
      evento.destinoId || null,
      evento.canal || null,
      evento.marketplace || null,
      evento.ocorridoEm || null,
      evento.origemPipeline || null,
      evento.chaveIdempotencia,
      JSON.stringify(evento.metadata || {})
    ]
  );

  if (!resultado.ok) {
    return {
      ok: false,
      motivo: resultado.motivo || "evento_comercial_insert_falhou",
      erro: resultado.erro || ""
    };
  }

  return {
    ok: true,
    inserido: Boolean(resultado.resultado?.rows?.[0]?.id),
    id: resultado.resultado?.rows?.[0]?.id || null
  };
}

module.exports = {
  SQL_SCHEMA_EVENTOS_COMERCIAIS,
  prepararSchemaEventosComerciaisSeguro,
  inserirEventoComercial
};