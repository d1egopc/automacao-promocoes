"use strict";

const express = require("express");
const { queryEngine } = require("../engine/database");
const { normalizarMotivoTecnicoRedirect } = require("../radar/redirect/redirect-diagnostic-code");

const ORIGENS = new Set(["radar", "clonador_grupos"]);
const FONTES = new Set(["radar", "teleradar", "clonador_grupos"]);
const TIPOS = new Set(["whatsapp", "telegram"]);
const MARKETPLACES = new Set(["aliexpress", "amazon", "awin", "kabum", "magalu", "mercadolivre", "shopee"]);
const MOTIVOS_LEGADOS = new Set([
  "promozone_redirect_bloqueado", "promozone_redirect_nao_resolvido",
  "redirect_falhou", "redirect_nao_resolvido", "redirect_bloqueado"
]);

const CONSULTA_EVENTO = `SELECT e.id, e.origem, e.fonte, e.origem_tipo, e.capturado_em,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id,
      'redirect_ok', l.redirect_ok,
      'motivo_redirect', l.motivo_redirect,
      'motivo_tecnico', l.metadata ->> 'motivoRedirectTecnico',
      'marketplace', l.marketplace_detectado,
      'destino_resolvido', l.url_expandida IS NOT NULL
    ) ORDER BY l.id)
    FROM (SELECT id, redirect_ok, motivo_redirect, metadata, marketplace_detectado, url_expandida
            FROM engine_links WHERE evento_id = e.id ORDER BY id LIMIT 65) l
  ), '[]'::jsonb) AS links
  FROM engine_eventos_brutos e
 WHERE e.id = $1
   AND EXISTS (SELECT 1 FROM engine_jobs_cliente j
                WHERE j.evento_id = e.id AND j.cliente_id = $2)
 LIMIT 1`;

function codigoPermitido(valor, permitidos, fallback) {
  return permitidos.has(valor) ? valor : fallback;
}

function projetarLink(link = {}) {
  const redirectOk = link.redirect_ok === true ? true : link.redirect_ok === false ? false : null;
  const motivoTecnico = redirectOk === false && typeof link.motivo_tecnico === "string" && link.motivo_tecnico
    ? normalizarMotivoTecnicoRedirect(link.motivo_tecnico) : null;
  const marketplace = redirectOk === true && link.destino_resolvido === true
    ? codigoPermitido(link.marketplace, MARKETPLACES, "nao_comprovado") : "nao_comprovado";
  return {
    linkId: String(link.id),
    redirectOk,
    motivoRedirect: link.motivo_redirect
      ? codigoPermitido(link.motivo_redirect, MOTIVOS_LEGADOS, "redirect_falha_nao_classificada") : null,
    motivoRedirectTecnico: motivoTecnico,
    marketplace,
    estado: motivoTecnico ? "com_diagnostico" : "sem_diagnostico_tecnico"
  };
}

function projetarEvento(row) {
  const linksPersistidos = Array.isArray(row.links) ? row.links : [];
  const links = linksPersistidos.slice(0, 64).map(projetarLink);
  return {
    ok: true,
    eventoId: String(row.id),
    origem: codigoPermitido(row.origem, ORIGENS, "nao_comprovada"),
    fonte: codigoPermitido(row.fonte, FONTES, "nao_comprovada"),
    origemTipo: codigoPermitido(row.origem_tipo, TIPOS, "nao_comprovado"),
    capturadoEm: row.capturado_em || null,
    estado: links.length === 0 ? "sem_link_persistido"
      : links.some(link => link.motivoRedirectTecnico) ? "com_diagnostico"
        : "sem_diagnostico_tecnico",
    linksTruncados: linksPersistidos.length > 64,
    links
  };
}

function criarRotasDiagnosticoCapturaEngine({ query = queryEngine } = {}) {
  const router = express.Router();
  router.get("/:eventoId/diagnostico", async (req, res) => {
    const eventoId = String(req.params.eventoId || "");
    const clienteId = String(req.query.clienteId || "");
    if (!/^[1-9]\d{0,18}$/.test(eventoId) || BigInt(eventoId || "0") > 9223372036854775807n ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(clienteId)) {
      return res.status(400).json({ ok: false, erro: "PARAMETROS_INVALIDOS" });
    }
    try {
      const resultado = await query(CONSULTA_EVENTO, [eventoId, clienteId]);
      if (!resultado?.ok) return res.status(503).json({ ok: false, erro: "DIAGNOSTICO_INDISPONIVEL" });
      const row = resultado.resultado?.rows?.[0];
      if (!row) return res.status(404).json({ ok: false, estado: "evento_inexistente" });
      return res.json(projetarEvento(row));
    } catch {
      return res.status(503).json({ ok: false, erro: "DIAGNOSTICO_INDISPONIVEL" });
    }
  });
  return router;
}

module.exports = { criarRotasDiagnosticoCapturaEngine, projetarEvento };
