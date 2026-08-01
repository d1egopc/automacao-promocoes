const { queryEngine } = require("../database");

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
  inserirEventoComercial
};
