const { queryEngineShadow } = require("../engine/database");

// Count only durable Radar ingress. The time predicate uses the existing
// engine_eventos_brutos_criado_em index; no message body is selected.
async function consultarEntradasRadar({ janelaMinutos = 15, query = queryEngineShadow, now = Date.now() } = {}) {
  const janela = Math.max(1, Math.min(120, Math.floor(Number(janelaMinutos) || 15)));
  const resultado = await query(
    `SELECT origem_tipo, fonte, COUNT(*)::int AS total
       FROM engine_eventos_brutos
      WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
        AND origem = 'radar'
        AND (origem_tipo = 'whatsapp' OR (origem_tipo = 'telegram' AND fonte = 'teleradar'))
      GROUP BY origem_tipo, fonte`,
    [janela]
  );
  if (!resultado?.ok || !Array.isArray(resultado.resultado?.rows)) {
    return { ok: false, motivo: "entrada_engine_indisponivel", collectedAtMs: now };
  }
  let radar = 0;
  let teleRadar = 0;
  for (const row of resultado.resultado.rows) {
    const total = Number(row.total);
    if (!Number.isSafeInteger(total) || total < 0) {
      return { ok: false, motivo: "entrada_engine_invalida", collectedAtMs: now };
    }
    if (row.origem_tipo === "whatsapp" && row.fonte !== "teleradar") radar += total;
    if (row.origem_tipo === "telegram" && row.fonte === "teleradar") teleRadar += total;
  }
  return {
    ok: true,
    janelaMinutos: janela,
    inputRadar: radar / janela,
    inputTeleRadar: teleRadar / janela,
    inputTotal: (radar + teleRadar) / janela,
    collectedAtMs: now,
    unidade: "eventos_engine_aceitos_por_minuto"
  };
}

module.exports = { consultarEntradasRadar };
