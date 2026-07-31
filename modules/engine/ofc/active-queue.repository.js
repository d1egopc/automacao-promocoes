const { queryEngine } = require("../database");

const STATUS_ELEGIVEIS_FILA_ATIVA_OFC = ["pronto_para_importar", "pendente"];

function limitarInteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

async function consultarCandidatosFilaAtivaOfc({ limite = 1000 } = {}) {
  const limiteFinal = limitarInteiro(limite, 1000, 1, 5000);
  const resultado = await queryEngine(
    `SELECT id,
            cliente_id,
            status,
            COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), 'desconhecido') AS marketplace,
            criado_em
       FROM engine_jobs_cliente
      WHERE status = ANY($1::text[])
      ORDER BY CASE status
                 WHEN 'pronto_para_importar' THEN 0
                 WHEN 'pendente' THEN 1
                 ELSE 2
               END ASC,
               criado_em ASC,
               id ASC
      LIMIT $2`,
    [STATUS_ELEGIVEIS_FILA_ATIVA_OFC, limiteFinal]
  );

  if (!resultado.ok) {
    return {
      ok: false,
      jobs: [],
      totalAvaliado: 0,
      erro: resultado.erro || "",
      motivo: resultado.motivo || "consulta_fila_ativa_falhou"
    };
  }

  const rows = resultado.resultado?.rows || [];
  return {
    ok: true,
    jobs: rows,
    totalAvaliado: rows.length,
    erro: "",
    motivo: ""
  };
}

module.exports = {
  STATUS_ELEGIVEIS_FILA_ATIVA_OFC,
  consultarCandidatosFilaAtivaOfc
};
