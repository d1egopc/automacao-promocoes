"use strict";

// Only fixed diagnostic codes cross from the resolver to persisted metadata.
// Never persist a raw exception, URL, HTML body, or response header here.
const CODIGOS = new Set([
  "redirect_timeout",
  "REDIRECT_LIMIT",
  "REDIRECT_LOOP",
  "URL_BLOQUEADA_SEGURANCA",
  "REDIRECT_BODY_LIMIT",
  "redirect_bloqueado",
  "redirect_nao_resolvido",
  "html_destino_nao_identificado",
  "redirect_destino_nao_permitido",
  "limite_redirect_html",
  "identidade_nao_comprovada",
  "destino_comercial_nao_comprovado",
  "identidade_ml_nao_comprovada",
  "dominio_redirect_nao_permitido"
]);

function normalizarMotivoTecnicoRedirect(resultado = {}) {
  const motivo = typeof resultado === "string" ? resultado : resultado?.motivo;
  const metodo = typeof resultado === "string" ? "" : resultado?.metodo;
  const statusHttp = typeof resultado === "string" ? "" : resultado?.statusHttp;
  if (motivo === "redirect_nao_resolvido" && metodo === "html_sem_redirect") {
    return "html_destino_nao_identificado";
  }
  if (CODIGOS.has(motivo)) return motivo;
  if (/^(?:http_status_|promozone_api_status_)[45]\d{2}$/.test(motivo || "")) return motivo;
  if (metodo === "erro_http" && /^[45]\d{2}$/.test(String(statusHttp || ""))) {
    return `http_status_${statusHttp}`;
  }
  return "redirect_falha_nao_classificada";
}

module.exports = { normalizarMotivoTecnicoRedirect };
