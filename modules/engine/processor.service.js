const { queryEngine } = require("./database");
const { STATUS_JOBS_ATIVOS_COM_LEASE } = require("./jobs.service");
const {
  calcularCotasFrescorPreImporter
} = require("./frescor-pre-importer.service");
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
  const cotas = calcularCotasFrescorPreImporter(limite);
  const resultado = await queryEngine(
    `WITH base AS (
       SELECT j.id, j.uuid, j.evento_id, j.oferta_id, j.cliente_id, j.marketplace_detectado,
              j.marketplace, j.status, j.motivo_final, j.metadata, j.prioridade,
              j.criado_em, j.atualizado_em,
              e.capturado_em AS evento_capturado_em,
              e.criado_em AS evento_criado_em,
              e.origem AS evento_origem,
              e.origem_tipo AS evento_origem_tipo,
              e.metadata AS evento_metadata,
              COALESCE(e.capturado_em, j.criado_em) AS origem_comercial_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 1
                ELSE 0
              END AS bucket_frescor_pre_importer
         FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
        WHERE j.status = 'pendente'
     ),
     frescos AS (
       SELECT *, 0 AS bucket_selecao_pre_importer
         FROM base
        WHERE bucket_frescor_pre_importer = 0
        ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, criado_em ASC, id ASC
        LIMIT $1
     ),
     limpeza AS (
       SELECT *, 1 AS bucket_selecao_pre_importer
         FROM base
        WHERE bucket_frescor_pre_importer = 1
        ORDER BY origem_comercial_pre_importer ASC, criado_em ASC, id ASC
        LIMIT $2
     )
     SELECT *
       FROM (
         SELECT * FROM frescos
         UNION ALL
         SELECT * FROM limpeza
       ) selecionados
      ORDER BY bucket_selecao_pre_importer ASC,
               COALESCE(prioridade, 0) DESC,
               origem_comercial_pre_importer ASC,
               criado_em ASC,
               id ASC
      LIMIT $3`,
    [cotas.frescos, cotas.limpeza, cotas.limite]
  );

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, jobs: resultado.resultado.rows };
}

async function marcarJobStatus(jobId, status, motivo = "", extras = {}) {
  const campos = ["status = $2", "motivo_final = $3", "atualizado_em = NOW()"];
  const params = [jobId, status, motivo || null];
  const statusEsperado = Array.isArray(extras.statusEsperado)
    ? extras.statusEsperado.map(item => String(item || "").trim()).filter(Boolean)
    : String(extras.statusEsperado || "").trim()
      ? [String(extras.statusEsperado).trim()]
      : [];

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

  const filtros = ["id = $1"];
  if (statusEsperado.length) {
    params.push(statusEsperado);
    filtros.push(`status = ANY($${params.length}::text[])`);
  }

  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET ${campos.join(", ")}
      WHERE ${filtros.join(" AND ")}
      RETURNING id, status`,
    params
  );

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa: "marcar_status", status, motivo: resultado.motivo || "update_falhou", erro: resultado.erro || "" });
  }

  if (resultado.ok && statusEsperado.length && resultado.resultado.rowCount === 0) {
    logEngineProcessadorErro({ jobId, etapa: "marcar_status", status, motivo: "status_origem_incompativel", erro: "" });
    return { ...resultado, ok: false, ignorado: true, motivo: "status_origem_incompativel" };
  }

  return resultado;
}

async function renovarHeartbeatJobAtivo(jobId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET atualizado_em = NOW()
      WHERE id = $1
        AND status = ANY($2::text[])
      RETURNING id, status`,
    [jobId, STATUS_JOBS_ATIVOS_COM_LEASE]
  );

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa: "heartbeat_job_ativo", motivo: resultado.motivo || "heartbeat_falhou", erro: resultado.erro || "" });
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
  } else {
    await renovarHeartbeatJobAtivo(jobId);
  }

  return resultado;
}

async function carregarEventoBruto(eventoId) {
  const resultado = await queryEngine(
    `SELECT id, uuid, origem, origem_tipo, sessao_id, grupo_id, grupo_nome,
            texto_original, links_extraidos, marketplace_detectado, metadata,
            capturado_em, criado_em
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
             marketplace_detectado, metadata, criado_em
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
  renovarHeartbeatJobAtivo,
  tentarMarcarProcessando,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento
};
