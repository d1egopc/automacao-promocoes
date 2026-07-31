const { queryEngine } = require("../database");

async function consultarReservatorioOfc() {
  const status = await queryEngine(
    `SELECT status,
            COUNT(*)::int AS total,
            MIN(criado_em) AS mais_antigo_em,
            MAX(criado_em) AS mais_novo_em
       FROM engine_jobs_cliente
      GROUP BY status
      ORDER BY total DESC, status ASC`
  );

  const marketplaces = await queryEngine(
    `SELECT marketplace_ofc AS marketplace,
            status,
            COUNT(*)::int AS total,
            MIN(criado_em) AS mais_antigo_em,
            MAX(criado_em) AS mais_novo_em
       FROM (
         SELECT COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), 'desconhecido') AS marketplace_ofc,
                status,
                criado_em
           FROM engine_jobs_cliente
          WHERE status IN ('pendente', 'diagnosticado', 'pronto_para_importar', 'processando', 'importando')
       ) jobs_ofc
      GROUP BY marketplace_ofc, status
      ORDER BY total DESC, marketplace_ofc ASC, status ASC
      LIMIT 60`
  );

  const clientes = await queryEngine(
    `SELECT cliente_id,
            status,
            COUNT(*)::int AS total,
            MIN(criado_em) AS mais_antigo_em,
            MAX(criado_em) AS mais_novo_em
       FROM engine_jobs_cliente
      WHERE status IN ('pendente', 'diagnosticado', 'pronto_para_importar')
      GROUP BY cliente_id, status
      ORDER BY total DESC, cliente_id ASC, status ASC
      LIMIT 60`
  );

  return {
    ok: Boolean(status.ok && marketplaces.ok && clientes.ok),
    status: status.ok ? status.resultado.rows : [],
    marketplaces: marketplaces.ok ? marketplaces.resultado.rows : [],
    clientes: clientes.ok ? clientes.resultado.rows : [],
    erro: status.erro || marketplaces.erro || clientes.erro || "",
    motivo: status.motivo || marketplaces.motivo || clientes.motivo || ""
  };
}

async function consultarConsumoOfc({ minutos = 15 } = {}) {
  const janelaMinutos = Math.max(1, Math.min(120, Number(minutos || 15)));
  const resultado = await queryEngine(
    `SELECT etapa,
            status,
            COUNT(*)::int AS total,
            MIN(criado_em) AS primeiro_em,
            MAX(criado_em) AS ultimo_em
       FROM engine_processamentos
      WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
      GROUP BY etapa, status
      ORDER BY total DESC, etapa ASC, status ASC
      LIMIT 80`,
    [janelaMinutos]
  );

  if (!resultado.ok) {
    return { ok: false, janelaMinutos, etapas: [], erro: resultado.erro || "", motivo: resultado.motivo || "" };
  }

  return { ok: true, janelaMinutos, etapas: resultado.resultado.rows };
}

module.exports = {
  consultarReservatorioOfc,
  consultarConsumoOfc
};
