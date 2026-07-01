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

function normalizarClientes(clientes = []) {
  const lista = Array.isArray(clientes) ? clientes : [clientes].filter(Boolean);
  const ids = lista
    .map(cliente => typeof cliente === "string" ? cliente : cliente?.id || cliente?.clienteId)
    .map(id => normalizarTexto(id || ""))
    .filter(Boolean);

  return [...new Set(ids.length ? ids : ["admin"] )];
}

function marketplacePrincipal(links = []) {
  const normalizados = normalizarLinksExtraidos(links);
  return normalizados.map(detectarMarketplaceLink).find(Boolean) || "";
}

async function criarJobsParaClientes({ eventoId, ofertaId = null, clientes = [], marketplaceDetectado = "", linksExtraidos = [] } = {}) {
  if (!eventoId) return { ok: false, motivo: "evento_id_ausente", criados: 0 };

  const clientesIds = normalizarClientes(clientes);
  const marketplace = normalizarTexto(marketplaceDetectado || marketplacePrincipal(linksExtraidos));
  let criados = 0;

  for (const clienteId of clientesIds) {
    try {
      const insert = await queryEngine(
        `INSERT INTO engine_jobs_cliente (
           evento_id, oferta_id, cliente_id, marketplace_detectado, marketplace,
           status, prioridade, tentativas, metadata
         )
         VALUES ($1, $2, $3, $4, $4, 'pendente', 0, 0, $5::jsonb)
         RETURNING id`,
        [eventoId, ofertaId, clienteId, marketplace, JSON.stringify({ fase: "1.1" })]
      );

      if (!insert.ok) {
        logEngineJobClienteErro({ eventoId, clienteId, motivo: insert.motivo || "insert_falhou", erro: insert.erro || "" });
        continue;
      }

      criados += 1;
      logEngineJobClienteCriado({ id: insert.resultado.rows[0]?.id, eventoId, clienteId, marketplaceDetectado: marketplace });
    } catch (e) {
      logEngineJobClienteErro({ eventoId, clienteId, motivo: "erro_inesperado", erro: e.message });
    }
  }

  return { ok: true, criados };
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
  limparJobsAntigosEngine
};
