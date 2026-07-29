const { queryEngine } = require("./database");
const {
  detectarMarketplaceLink,
  normalizarLinksExtraidos,
  normalizarTexto
} = require("./normalizers");
const {
  logEngineJobClienteCriado,
  logEngineJobClienteErro
} = require("./logger");
const coberturaRadar = require("../radar/cobertura-v1");

function normalizarClientes(clientes = []) {
  const lista = Array.isArray(clientes) ? clientes : [clientes].filter(Boolean);
  const ids = lista
    .map(cliente => typeof cliente === "string" ? cliente : cliente?.id || cliente?.clienteId)
    .map(id => normalizarTexto(id || ""))
    .filter(Boolean)
    .filter(id => id.toLowerCase() !== "admin");

  return [...new Set(ids)];
}

function marketplacePrincipal(links = []) {
  const normalizados = normalizarLinksExtraidos(links);
  return normalizados.map(detectarMarketplaceLink).find(Boolean) || "";
}

function jsonbParam(valor, fallback) {
  const base = valor === undefined ? fallback : valor;
  const serializado = JSON.stringify(base);
  return serializado === undefined ? JSON.stringify(fallback) : serializado;
}

async function ignorarJobsAdminNaoOperacional() {
  const motivo = "admin_nao_e_cliente_operacional";
  const resultado = await queryEngine(
    `WITH jobs_admin AS (
       UPDATE engine_jobs_cliente
          SET status = 'ignorado',
              motivo_final = $1,
              atualizado_em = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE LOWER(TRIM(cliente_id)) = 'admin'
          AND (status IS DISTINCT FROM 'ignorado' OR motivo_final IS DISTINCT FROM $1)
        RETURNING id, oferta_id
     ), ofertas_admin AS (
       UPDATE engine_ofertas o
          SET status = 'retida',
              motivo_status = $1,
              atualizada_em = NOW()
        WHERE o.id IN (
          SELECT j.oferta_id
            FROM engine_jobs_cliente j
           WHERE LOWER(TRIM(j.cliente_id)) = 'admin'
             AND j.oferta_id IS NOT NULL
        )
          AND o.status IN ('importada', 'oferta_criada', 'distribuindo')
        RETURNING o.id
     )
     SELECT
       (SELECT COUNT(*)::int FROM jobs_admin) AS jobs_ignorados,
       (SELECT COUNT(*)::int FROM ofertas_admin) AS ofertas_retidas`,
    [motivo, jsonbParam({ motivo, operacional: false }, {})]
  );

  if (!resultado.ok) {
    logEngineJobClienteErro({
      clienteId: "admin",
      motivo: resultado.motivo || "admin_jobs_neutralizacao_falhou",
      erro: resultado.erro || ""
    });
    return { ok: false, motivo: resultado.motivo || "admin_jobs_neutralizacao_falhou", erro: resultado.erro || "" };
  }

  const resumo = resultado.resultado.rows[0] || {};
  if (resumo.jobs_ignorados || resumo.ofertas_retidas) {
    console.log("[ENGINE-ADMIN-NAO-OPERACIONAL]", JSON.stringify({
      motivo,
      jobsIgnorados: Number(resumo.jobs_ignorados || 0),
      ofertasRetidas: Number(resumo.ofertas_retidas || 0)
    }));
  }

  return {
    ok: true,
    motivo,
    jobsIgnorados: Number(resumo.jobs_ignorados || 0),
    ofertasRetidas: Number(resumo.ofertas_retidas || 0)
  };
}

async function criarJobsParaClientes({ eventoId, ofertaId = null, clientes = [], marketplaceDetectado = "", linksExtraidos = [], metadataEvento = {} } = {}) {
  const contextoCobertura = {
    coberturaTraceId: metadataEvento?.coberturaTraceId || "",
    fidelidadeTraceId: metadataEvento?.fidelidadeTraceId || "",
    eventoEngineId: eventoId || "",
    ofertaId: ofertaId || "",
    marketplace: marketplaceDetectado || marketplacePrincipal(linksExtraidos),
    links: linksExtraidos
  };
  coberturaRadar.registrar("engine_job_inicio", {
    ...contextoCobertura,
    decisao: "iniciado"
  });
  if (!eventoId) {
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      decisao: "rejeitado",
      motivo: "evento_id_ausente",
      jobNovoCriado: false
    });
    return { ok: false, motivo: "evento_id_ausente", criados: 0 };
  }

  await ignorarJobsAdminNaoOperacional();

  const clientesIds = normalizarClientes(clientes);
  const marketplace = normalizarTexto(marketplaceDetectado || marketplacePrincipal(linksExtraidos));
  const metadataJob = {
    fase: "1.1",
    ...(coberturaRadar.flagAtiva() && metadataEvento?.coberturaTraceId ? { coberturaTraceId: metadataEvento.coberturaTraceId } : {}),
    ...(coberturaRadar.flagAtiva() && metadataEvento?.fidelidadeTraceId ? { fidelidadeTraceId: metadataEvento.fidelidadeTraceId } : {}),
    imagemRadar: metadataEvento?.imagem || metadataEvento?.image || metadataEvento?.thumbnail || metadataEvento?.imagemUrl || "",
    imagemEventoOriginal: metadataEvento?.imagemOriginal || metadataEvento?.imagemRadar || metadataEvento?.foto || metadataEvento?.midia || "",
    metadataEvento
  };
  let criados = 0;
  let existentes = 0;

  const adminIgnorado = (Array.isArray(clientes) ? clientes : [clientes])
    .some(cliente => normalizarTexto(typeof cliente === "string" ? cliente : cliente?.id || cliente?.clienteId || "").toLowerCase() === "admin");

  if (adminIgnorado) {
    console.log("[ENGINE-ADMIN-NAO-OPERACIONAL]", JSON.stringify({
      eventoId,
      motivo: "admin_nao_e_cliente_operacional",
      jobCriado: false
    }));
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      clienteId: "admin",
      decisao: "rejeitado",
      motivo: "admin_nao_e_cliente_operacional",
      jobNovoCriado: false
    });
  }

  if (!clientesIds.length) {
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      decisao: "rejeitado",
      motivo: "sem_clientes_operacionais",
      jobNovoCriado: false
    });
  }

  for (const clienteId of clientesIds) {
    try {
      const insert = await queryEngine(
        `INSERT INTO engine_jobs_cliente (
           evento_id, oferta_id, cliente_id, marketplace_detectado, marketplace,
           status, prioridade, tentativas, metadata
         )
         SELECT $1, $2, $3, $4, $4, 'pendente', 0, 0, $5::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente
             WHERE evento_id = $1
               AND cliente_id = $3
          )
         RETURNING id`,
        [eventoId, ofertaId, clienteId, marketplace, jsonbParam(metadataJob, {})]
      );

      if (!insert.ok) {
        logEngineJobClienteErro({ eventoId, clienteId, motivo: insert.motivo || "insert_falhou", erro: insert.erro || "" });
        coberturaRadar.registrar("engine_job_erro", {
          ...contextoCobertura,
          clienteId,
          decisao: "erro",
          motivo: insert.motivo || "insert_falhou",
          erro: insert.erro || "",
          jobNovoCriado: false
        });
        continue;
      }

      const jobId = insert.resultado.rows[0]?.id;
      if (!jobId) {
        existentes += 1;
        coberturaRadar.registrar("engine_job_existente", {
          ...contextoCobertura,
          clienteId,
          decisao: "reaproveitado",
          motivo: "job_existente",
          jobNovoCriado: false
        });
        continue;
      }

      criados += 1;
      logEngineJobClienteCriado({ id: jobId, eventoId, clienteId, marketplaceDetectado: marketplace });
      coberturaRadar.registrar("engine_job_criado", {
        ...contextoCobertura,
        clienteId,
        decisao: "aceito",
        motivo: "job_criado",
        jobId,
        jobNovoCriado: true
      });
    } catch (e) {
      logEngineJobClienteErro({ eventoId, clienteId, motivo: "erro_inesperado", erro: e.message });
      coberturaRadar.registrar("engine_job_erro", {
        ...contextoCobertura,
        clienteId,
        decisao: "erro",
        motivo: "erro_inesperado",
        erro: e.message,
        jobNovoCriado: false
      });
    }
  }

  return { ok: true, criados, existentes };
}

function normalizarStatusLimpeza(status = []) {
  const lista = Array.isArray(status) ? status : [status].filter(Boolean);
  return [...new Set(
    lista
      .map(item => normalizarTexto(item).toLowerCase())
      .filter(Boolean)
      .filter(item => item !== "cancelado")
  )];
}

function resumirJobsAfetados(rows = []) {
  const porStatus = {};
  const porCliente = {};

  for (const row of rows) {
    const status = row.status_anterior || "sem_status";
    const clienteId = row.cliente_id || "sem_cliente";
    porStatus[status] = (porStatus[status] || 0) + 1;
    porCliente[clienteId] = (porCliente[clienteId] || 0) + 1;
  }

  return { porStatus, porCliente };
}

async function limparJobsAntigosEngine({ antesDoId = 0, status = [] } = {}) {
  const limiteId = Number(antesDoId || 0);
  const statusLimpeza = normalizarStatusLimpeza(status);

  if (!Number.isFinite(limiteId) || limiteId <= 0) {
    return { ok: false, motivo: "antesDoId_invalido", afetados: 0, porStatus: {}, porCliente: {} };
  }

  if (!statusLimpeza.length) {
    return { ok: false, motivo: "status_vazio", afetados: 0, porStatus: {}, porCliente: {} };
  }

  const resultado = await queryEngine(
    `WITH selecionados AS (
       SELECT id, cliente_id, status AS status_anterior
         FROM engine_jobs_cliente
        WHERE id < $1
          AND status = ANY($2::text[])
     ), atualizados AS (
       UPDATE engine_jobs_cliente j
          SET status = 'cancelado',
              motivo_final = 'limpeza_teste_clientes_antigos',
              atualizado_em = NOW(),
              metadata = COALESCE(j.metadata, '{}'::jsonb) || $3::jsonb
         FROM selecionados s
        WHERE j.id = s.id
        RETURNING j.id, s.cliente_id, s.status_anterior
     )
     SELECT id, cliente_id, status_anterior
       FROM atualizados
      ORDER BY id ASC`,
    [
      Math.floor(limiteId),
      statusLimpeza,
      JSON.stringify({ limpeza: "limpeza_teste_clientes_antigos", antesDoId: Math.floor(limiteId) })
    ]
  );

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo || "limpeza_falhou", erro: resultado.erro || "", afetados: 0, porStatus: {}, porCliente: {} };
  }

  const rows = resultado.resultado.rows || [];
  const resumo = resumirJobsAfetados(rows);

  return {
    ok: true,
    antesDoId: Math.floor(limiteId),
    statusSolicitados: statusLimpeza,
    novoStatus: "cancelado",
    motivoFinal: "limpeza_teste_clientes_antigos",
    afetados: rows.length,
    ...resumo
  };
}

module.exports = {
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine
};
