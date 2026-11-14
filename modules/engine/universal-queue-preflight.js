"use strict";
const { avaliarSegurancaPublicacao } = require("../inteligencia-universal/foundation-v1.service");
const { tituloPublicitarioOuInstrucao } = require("../radar/comercial-precedencia");

// The Universal queue never interprets a pending row as permission to send.
// Reuse the classified commercial freshness and destination cadence services;
// the application supplies its existing window/session/credit/media/link/dedup
// checks and renderer. No provider is called here.
const { avaliarFrescorPosClassificacaoCandidato } =
  require("./post-classification-freshness.candidate");
const { classificarTurboComercialCandidato } =
  require("./turbo-classification.candidate");
const { resolverCadenciaDestino } = require("./cadencia.service");
const { readDestinationClock } = require("./universal-queue.repository");

const PREPARE_STAGES = new Set([
  "commercial_freshness", "resolve_destination", "destination_cadence",
  "check_window", "check_daily_limit", "check_session", "check_credits",
  "check_media", "check_links", "render_message", "check_dedup"
]);
const RADAR_FIDELITY_ERROR_CODE = "RADAR_FIDELIDADE_COMERCIAL_INVALIDA";
const RADAR_FIDELITY_TERMINAL_REASONS = new Set([
  "radar_contrato_original_ausente", "radar_preco_original_nao_comprovado",
  "radar_preco_divergente", "radar_preco_publicacao_ausente",
  "radar_preco_anterior_nao_comprovado", "radar_preco_anterior_divergente",
  "radar_cupom_divergente", "radar_instrucao_cupom_divergente",
  "radar_condicao_comercial_divergente", "radar_titulo_operacional_ou_ausente",
  "radar_identidade_titulo_nao_confirmada", "radar_titulo_divergente_sem_identidade",
  "radar_identidade_destino_nao_produto"
]);

function motivoTerminalFidelidadeRadar(error) {
  if (error?.code !== RADAR_FIDELITY_ERROR_CODE) return null;
  const reason = String(error?.message || "").trim();
  // These are fixed business denials from the Radar validator. Persist them as
  // no-send outcomes; unknown renderer errors remain exceptions and fail closed.
  return RADAR_FIDELITY_TERMINAL_REASONS.has(reason) ? reason : null;
}

function marcarEtapaPreflight(error, stage) {
  const safeStage = PREPARE_STAGES.has(stage) ? stage : "resolve_destination";
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      if (!Object.getOwnPropertyDescriptor(error, "preflightStage")) {
        Object.defineProperty(error, "preflightStage", {
          value: safeStage, configurable: true
        });
      }
      return error;
    } catch { /* fall through to a sanitized Error for non-extensible throws */ }
  }
  const wrapped = new Error("universal_send_preflight_exception");
  Object.defineProperty(wrapped, "preflightStage", { value: safeStage });
  return wrapped;
}

async function executarEtapaPreflight(stage, callback) {
  try { return await callback(); }
  catch (error) { throw marcarEtapaPreflight(error, stage); }
}

const REQUIRED = ["resolveDestination", "checkWindow", "checkDailyLimit", "checkSession",
  "checkCredits", "checkMedia", "checkLinks", "checkDedup", "renderMessage"];

function criarPreflightFilaUniversal({ pool, getPool = null, configGlobal = {},
  readClock = readDestinationClock, now = Date.now, ...checks } = {}) {
  if (!pool || REQUIRED.some(name => typeof checks[name] !== "function") ||
      typeof readClock !== "function" || typeof now !== "function") {
    throw new Error("universal_send_preflight_dependencies_required");
  }
  const poolAtual = () => {
    const current = typeof getPool === "function" ? getPool() : pool;
    if (!current || typeof current.connect !== "function") {
      throw new Error("queue_pool_required");
    }
    return current;
  };
  return async (claim, { skipDedup = false } = {}) => {
    const workspaceId = String(claim?.workspace_id || "").trim();
    const destinationId = String(claim?.destination_id || "").trim();
    const captureMs = new Date(claim?.capturado_em).getTime();
    const epochMs = new Date(claim?.operationEpochStartedAt).getTime();
    const currentMs = Number(now());
    if (!workspaceId || !destinationId || !Number.isFinite(captureMs) ||
        !Number.isFinite(epochMs) || captureMs < epochMs ||
        !Number.isFinite(currentMs)) {
      return { ready: false, reason: "universal_send_identity_or_t0_invalid" };
    }
    const oferta = { ...(claim.item_payload || {}),
      evento_capturado_em: new Date(captureMs).toISOString(),
      evento_id: claim.evento_id,
      origemFluxo: claim.origem_fluxo };
    if (String(oferta.clienteId || "") !== workspaceId ||
        String(oferta.engineOfertaId || "") !== String(claim.oferta_id || "")) {
      return { ready: false, reason: "universal_send_offer_identity_mismatch" };
    }
    const seguranca = avaliarSegurancaPublicacao(oferta);
    if (!seguranca.ok) return { ready: false, reason: seguranca.motivo, terminalNoSend: true };
    if (String(oferta.marketplace || "").toLowerCase() === "mercadolivre" &&
        tituloPublicitarioOuInstrucao(oferta.titulo || oferta.nome || "", "mercadolivre")) {
      return { ready: false, reason: "ml_titulo_nao_produto", terminalNoSend: true };
    }
    const { turbo, freshness } = await executarEtapaPreflight("commercial_freshness", () => ({
      turbo: classificarTurboComercialCandidato(oferta),
      freshness: avaliarFrescorPosClassificacaoCandidato(oferta, currentMs)
    }));
    if (!freshness.ok) return { ready: false,
      reason: freshness.motivo || "commercial_freshness_denied",
      terminalNoSend: freshness.motivo === "captura_expirada_pos_classificacao" };
    const resolved = await executarEtapaPreflight("resolve_destination", () =>
      checks.resolveDestination({ claim, oferta, workspaceId, destinationId }));
    if (resolved?.ok !== true || !resolved.destination ||
        String(resolved.destination.id || resolved.destination.destinoId || "") !==
          destinationId) {
      return { ready: false, reason: resolved?.reason || "destination_not_current" };
    }
    const context = { claim, oferta, workspaceId, destinationId,
      destination: resolved.destination,
      configCliente: resolved.configCliente || {},
      turbo, freshness, nowMs: currentMs };
    const { cadence, lastConfirmed } = await executarEtapaPreflight("destination_cadence", async () => ({
      cadence: resolverCadenciaDestino({ destino: context.destination,
        configCliente: context.configCliente, configGlobal, oferta }),
      lastConfirmed: await readClock({ pool: poolAtual(), workspaceId, destinationId })
    }));
    const intervalMs = Number(cadence.intervaloEfetivoMin) * 60000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return { ready: false, reason: "destination_cadence_invalid" };
    }
    const lastMs = lastConfirmed ? new Date(lastConfirmed).getTime() : 0;
    if (lastConfirmed && !Number.isFinite(lastMs)) {
      return { ready: false, reason: "destination_clock_invalid" };
    }
    if (lastMs && lastMs + intervalMs > currentMs) {
      return { ready: false, reason: "destination_cadence_wait",
        retryAt: new Date(lastMs + intervalMs).toISOString() };
    }
    for (const [name, reason, stage] of [
      ["checkWindow", "destination_window_closed", "check_window"],
      ["checkDailyLimit", "destination_daily_limit_reached", "check_daily_limit"],
      ["checkSession", "destination_session_unavailable", "check_session"],
      ["checkCredits", "workspace_credits_unavailable", "check_credits"],
      ["checkMedia", "required_media_unpublishable", "check_media"],
      ["checkLinks", "commercial_link_unproven", "check_links"]
    ]) {
      const result = await executarEtapaPreflight(stage, () => checks[name](context));
      if (result?.ok !== true) return { ready: false,
        reason: result?.reason || reason,
        ...((result?.terminalFailure === true ||
          (["checkMedia", "checkLinks"].includes(name) &&
            result?.retryAt == null && result?.terminalNoSend !== true))
          ? { terminalFailure: true } : {}),
        ...(result?.terminalNoSend === true ? { terminalNoSend: true } : {}),
        ...(result?.retryAt ? { retryAt: result.retryAt } : {}) };
    }
    let rendered;
    try {
      rendered = await executarEtapaPreflight("render_message", () =>
        checks.renderMessage(context));
    } catch (error) {
      const reason = motivoTerminalFidelidadeRadar(error);
      if (reason) return { ready: false, reason, terminalNoSend: true };
      throw error;
    }
    if (rendered?.ok !== true || !rendered.message) {
      return { ready: false,
        reason: rendered?.reason || "destination_template_unavailable",
        terminalFailure: true };
    }
    // The durable commercial reservation may hold an advisory while the
    // provider adapter prepares transport. Acquire it only after all local
    // render failures have been ruled out.
    if (!skipDedup) {
      const dedup = await executarEtapaPreflight("check_dedup", () =>
        checks.checkDedup(context));
      if (dedup?.ok !== true) return { ready: false,
        reason: dedup?.reason || "destination_dedup_blocked",
        ...(dedup?.terminalNoSend === true ? { terminalNoSend: true } : {}),
        ...(dedup?.retryAt ? { retryAt: dedup.retryAt } : {}) };
    }
    return { ready: true, ...context, cadence, rendered };
  };
}

module.exports = { criarPreflightFilaUniversal };
