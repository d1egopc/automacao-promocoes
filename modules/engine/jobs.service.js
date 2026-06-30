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

module.exports = {
  criarJobsParaClientes
};