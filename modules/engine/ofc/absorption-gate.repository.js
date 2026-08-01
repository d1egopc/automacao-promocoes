const { queryEngine } = require("../database");
const { TIPOS_EVENTO_COMERCIAL } = require("./commercial-events.service");

function linhas(resultado) {
  return resultado?.ok ? resultado.resultado?.rows || [] : [];
}

async function consultarEventosAbsorcaoPorWorkspace({ janelaMinutos = 15, query = queryEngine } = {}) {
  const janela = Math.max(1, Math.min(120, Math.floor(Number(janelaMinutos) || 15)));
  const resultado = await query(
    `SELECT COALESCE(NULLIF(TRIM(cliente_id), ''), 'desconhecido') AS workspace_id,
            SUM(CASE WHEN tipo_evento = $2 THEN 1 ELSE 0 END)::int AS ofertas_criadas,
            SUM(CASE WHEN tipo_evento = $3 THEN 1 ELSE 0 END)::int AS itens_adicionados_fila,
            SUM(CASE WHEN tipo_evento = $4 THEN 1 ELSE 0 END)::int AS distribuicoes_finais,
            SUM(CASE WHEN tipo_evento = $5 THEN 1 ELSE 0 END)::int AS envios_confirmados,
            SUM(CASE WHEN tipo_evento = $6 THEN 1 ELSE 0 END)::int AS envios_erro_final
       FROM engine_eventos_comerciais
      WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
      GROUP BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'desconhecido')
      ORDER BY workspace_id`,
    [
      janela,
      TIPOS_EVENTO_COMERCIAL.OFERTA_UNIVERSAL_CRIADA,
      TIPOS_EVENTO_COMERCIAL.FILA_CLIENTE_ADICIONADA,
      TIPOS_EVENTO_COMERCIAL.DISTRIBUICAO_FINAL,
      TIPOS_EVENTO_COMERCIAL.EXECUTOR_ENVIADO,
      TIPOS_EVENTO_COMERCIAL.EXECUTOR_ERRO_FINAL
    ]
  );

  return {
    ok: Boolean(resultado?.ok),
    janelaMinutos: janela,
    porWorkspace: linhas(resultado),
    motivo: resultado?.ok ? "" : resultado?.motivo || "eventos_absorcao_indisponiveis",
    erro: resultado?.ok ? "" : resultado?.erro || ""
  };
}

module.exports = {
  consultarEventosAbsorcaoPorWorkspace
};