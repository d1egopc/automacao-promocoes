const { queryEngine } = require("./database");
const {
  logEngineProcessadorEtapa,
  logEngineProcessadorErro
} = require("./logger");

function limitarJobs(valor = 20) {
  const numero = Number(valor || 20);
  if (!Number.isFinite(numero) || numero <= 0) return 20;
  return Math.min(Math.floor(numero), 100);
}

async function buscarJobsPendentes(limite = 20) {
  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, oferta_id, cliente_id, marketplace_detectado,
            marketplace, status, motivo_final, criado_em, atualizado_em
       FROM engine_jobs_cliente
      WHERE status = 'pendente'
      ORDER BY criado_em ASC, id ASC
      LIMIT $1`,
    [limitarJobs(limite)]
  );

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, jobs: resultado.resultado.rows };
}

async function marcarJobStatus(jobId, status, motivo = "", extras = {}) {
  const campos = ["status = $2", "motivo_final = $3", "atualizado_em = NOW()"];
  const params = [jobId, status, motivo || null];

  if (Object.prototype.hasOwnProperty.call(extras, "marketplace")) {
    params.push(extras.marketplace || null);
    campos.push(`marketplace = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "marketplaceDetectado")) {
    params.push(extras.marketplaceDetectado || null);
    campos.push(`marketplace_detectado = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "categoria")) {
    params.push(extras.categoria || null);
    campos.push(`categoria = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "score")) {
    params.push(extras.score || null);
    campos.push(`score = $${params.length}`);
  }

  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET ${campos.join(", ")}
      WHERE id = $1
      RETURNING id, status`,
    params
  );

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa: "marcar_status", status, motivo: resultado.motivo || "update_falhou", erro: resultado.erro || "" });
  }

  return resultado;
}

async function tentarMarcarProcessando(jobId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'processando', atualizado_em = NOW()
      WHERE id = $1 AND status = 'pendente'
      RETURNING id, status`,
    [jobId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro };
  return { ok: resultado.resultado.rowCount > 0, ignorado: resultado.resultado.rowCount === 0 };
}

async function registrarProcessamento(jobId, etapa, status, motivo = "", detalhes = {}) {
  const resultado = await queryEngine(
    `INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [jobId, etapa, status, motivo || null, JSON.stringify(detalhes || {})]
  );

  logEngineProcessadorEtapa({ jobId, etapa, status, motivo });

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa, motivo: resultado.motivo || "processamento_insert_falhou", erro: resultado.erro || "" });
  }

  return resultado;
}

async function carregarEventoBruto(eventoId) {
  const resultado = await queryEngine(
    `SELECT id, uuid, origem, origem_tipo, sessao_id, grupo_id, grupo_nome,
            texto_original, links_extraidos, marketplace_detectado, capturado_em, criado_em
       FROM engine_eventos_brutos
      WHERE id = $1
      LIMIT 1`,
    [eventoId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, evento: resultado.resultado.rows[0] || null };
}

async function carregarLinksEvento(eventoId) {
  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, url_original, url_normalizada, url_expandida,
            dominio_original, dominio_final, redirect_ok, motivo_redirect,
            marketplace_detectado, criado_em
       FROM engine_links
      WHERE evento_id = $1
      ORDER BY id ASC`,
    [eventoId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro, links: [] };
  return { ok: true, links: resultado.resultado.rows };
}

module.exports = {
  limitarJobs,
  buscarJobsPendentes,
  marcarJobStatus,
  tentarMarcarProcessando,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento
};