"use strict";

const { chaveAlvo } = require("../../utils/destinos-multialvo");
const { chaveAlvoEntrega } = require("../fila/fila-checkpoint-entrega.service");

// Shared by the existing provider function and the post-epoch target runner.
// Without a targetKey the legacy fanout is unchanged. With one, no other
// target may reach the provider, even if the destination has many targets.
function selecionarAlvosParaProvider({ canal, alvos, targetKey }) {
  const lista = Array.isArray(alvos) ? alvos : [];
  const key = String(targetKey || "").trim();
  if (!key) return lista;
  const tipo = String(canal || "").trim().toLowerCase();
  const matches = lista.filter(alvo => String(tipo === "telegram"
    ? chaveAlvoEntrega(tipo, alvo) : chaveAlvo(alvo)) === key);
  if (matches.length !== 1) throw new Error("universal_provider_target_not_unique");
  return matches;
}

function chaveAlvoUniversal(canal, alvo) {
  return String(canal || "").toLowerCase() === "telegram"
    ? chaveAlvoEntrega("telegram", alvo) : chaveAlvo(alvo);
}

function providerMessageId(canal, response) {
  const type = String(canal || "").toLowerCase();
  if (type === "whatsapp") return String(response?.key?.id || "").trim();
  if (type === "telegram") return String(response?.data?.result?.message_id || "").trim();
  if (type === "discord") return String(response?.messageId || "").trim();
  return "";
}

function criarDispatcherProviderExistentePorAlvo({ send,
  resolveConfigCliente } = {}) {
  if (typeof send !== "function" || typeof resolveConfigCliente !== "function") {
    throw new Error("universal_existing_provider_dependencies_required");
  }
  return async (claim, prepared, { startAttempt } = {}) => {
    if (!claim?.target_key || !claim?.channel ||
        !prepared?.destination || !prepared?.rendered?.message ||
        typeof startAttempt !== "function") {
      throw new Error("universal_existing_provider_claim_invalid");
    }
    const workspaceId = String(claim.workspace_id || "");
    const offer = { ...(prepared.oferta || {}),
      id: `universal_${claim.queue_item_id}`, destinosEstado: [],
      destinosEnviados: [] };
    const facts = [];
    const credits = [];
    let result;
    let sendError;
    try {
      result = await send(prepared.destination, offer,
        prepared.rendered.message, workspaceId,
        resolveConfigCliente(workspaceId), {
        universalTargetKey: claim.target_key,
        reservaParDuravel: true,
        linkFinal: prepared.rendered.linkFinal || "",
        beforeUniversalProvider: async ({ canal, alvo }) => {
          if (String(canal).toLowerCase() !== String(claim.channel).toLowerCase() ||
              chaveAlvoUniversal(canal, alvo) !== String(claim.target_key)) {
            throw new Error("universal_provider_target_identity_mismatch");
          }
          await startAttempt();
        },
        onUniversalTargetCheckpoint: fact => facts.push(fact),
          onUniversalCreditResult: fact => credits.push(fact)
        });
    } catch (error) {
      sendError = error;
    }
    const confirmed = facts.find(fact => fact.checkpoint?.ok === true &&
      fact.checkpoint?.contexto?.estado === "enviado" &&
      chaveAlvoUniversal(fact.canal, fact.alvo) === String(claim.target_key));
    if (confirmed) {
      const messageId = providerMessageId(claim.channel,
        confirmed.checkpoint.resposta);
      const attemptId = String(confirmed.checkpoint.contexto.attemptId || "").trim();
      if (attemptId && messageId) {
        return { confirmed: true, confirmationKey: attemptId,
          providerMessageId: messageId,
          creditDebited: credits.some(credit =>
            String(credit.attemptId || "") === attemptId &&
            credit.debitou === true) };
      }
    }
    // The provider may have ACKed and persisted its checkpoint before later
    // rendering/telemetry/billing code throws. The ACK, not the outer return,
    // remains the factual authority for this one target.
    if (sendError) throw sendError;
    const failure = facts.find(fact =>
      fact.checkpoint?.contexto?.estado === "falha_confirmada" &&
      chaveAlvoUniversal(fact.canal, fact.alvo) === String(claim.target_key));
    if (failure && result?.enviado !== true) {
      return { failureConfirmed: true,
        failureReason: failure.checkpoint.resultado || "provider_no_effect_confirmed" };
    }
    if (!facts.length && result?.tentouEnvio === false) {
      return { reason: result.motivo || "provider_precheck_denied" };
    }
    return { confirmed: false, reason: result?.motivo || "provider_result_unproven" };
  };
}

module.exports = { selecionarAlvosParaProvider, chaveAlvoUniversal,
  providerMessageId, criarDispatcherProviderExistentePorAlvo };
