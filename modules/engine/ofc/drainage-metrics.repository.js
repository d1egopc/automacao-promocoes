"use strict";

const { queryEngineShadow } = require("../database");
const { criarDisponibilidadeRelacao } = require("./optional-relation-source");
const fonteConfirmacao = criarDisponibilidadeRelacao({ relacao: "fila_checkpoints_entrega", coluna: "confirmado_em" });

async function consultarEntregasConfirmadas({ janelaMinutos = 15, consultar = queryEngineShadow,
  disponibilidade = fonteConfirmacao } = {}) {
  const janela = Math.max(1, Math.min(120, Math.floor(Number(janelaMinutos) || 15)));
  const query = (sql, params) => consultar(sql, params, { timeoutSqlMs: 2500 });
  const fonte = await disponibilidade.observar(query);
  if (fonte.estado !== "DISPONIVEL") return { ok: false, disponibilidade: fonte, motivo: "confirmacao_duravel_indisponivel" };
  try {
    const resultado = await query(`WITH por_destino AS (
      SELECT cliente_id, destino_chave, COUNT(*)::int AS total
        FROM fila_checkpoints_entrega
       WHERE estado = 'enviado' AND confirmado_em >= statement_timestamp() - ($1::int * INTERVAL '1 minute')
         AND confirmado_em <= statement_timestamp()
       GROUP BY cliente_id, destino_chave
    ), detalhe AS (
      SELECT * FROM por_destino ORDER BY total DESC, cliente_id, destino_chave LIMIT 100
    )
    SELECT COALESCE((SELECT SUM(total) FROM por_destino), 0)::int AS total,
           (SELECT COUNT(*)::int FROM por_destino) AS destinos_total,
           COALESCE((SELECT json_agg(detalhe) FROM detalhe), '[]'::json) AS por_destino,
           EXISTS (SELECT 1 FROM fila_checkpoints_entrega WHERE estado = 'enviado' AND confirmado_em IS NULL) AS historico_sem_timestamp,
           statement_timestamp() AS observado_em`, [janela]);
    if (resultado?.ok !== true) return { ok: false, motivo: resultado?.motivo || "erro_confirmacoes",
      disponibilidade: disponibilidade.desconhecido(resultado?.motivo || "erro_confirmacoes") };
    const linha = resultado.resultado?.rows?.[0];
    if (!linha || !Number.isInteger(linha.total) || linha.total < 0 || !Array.isArray(linha.por_destino)
      || !Number.isInteger(linha.destinos_total) || typeof linha.historico_sem_timestamp !== "boolean"
      || !Number.isFinite(new Date(linha.observado_em).getTime())) {
      return { ok: false, disponibilidade: fonte, motivo: "confirmacoes_resultado_invalido" };
    }
    return { ok: true, janelaMinutos: janela, total: linha.total, porDestino: linha.por_destino,
      destinosTotal: linha.destinos_total, detalheLimitado: linha.destinos_total > 100,
      historicoSemTimestamp: linha.historico_sem_timestamp, observadoEmMs: new Date(linha.observado_em).getTime(), disponibilidade: fonte };
  } catch {
    return { ok: false, motivo: "erro_confirmacoes", disponibilidade: disponibilidade.desconhecido("erro_confirmacoes") };
  }
}

module.exports = { consultarEntregasConfirmadas };
