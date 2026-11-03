"use strict";

const saasFundacao = require("../../utils/saas-fundacao");

const STATUS_CICLO_INTERNO = new Set([
  "autorizada",
  "pagamento_confirmado",
  "teste_ciclo_autorizado",
  "trial_autorizado",
  "ativa_legacy",
  "manual"
]);

function texto(valor = "") {
  return String(valor ?? "").trim().toLowerCase();
}

function dataValida(valor = "") {
  const data = new Date(valor || "");
  return Number.isFinite(data.getTime()) ? data : null;
}

function resultado(ok, reason, origin = "") {
  return { ok, reason, origin };
}

// Esta avaliacao e deliberadamente pura: nao renova ciclo, nao concede saldo,
// nao persiste usuario e nao toca holds. A reserva continua sendo a autoridade
// transacional do ledger no instante de send_started.
function avaliarDireitoConsumoUniversal({ usuario = null, plano = null,
  saldo = null, quantidade = 1, agora = new Date() } = {}) {
  if (!usuario || !plano) return resultado(false, "credit_entitlement_missing");

  const necessario = Number(quantidade);
  const disponivel = Number(saldo?.available);
  if (!Number.isSafeInteger(necessario) || necessario <= 0) {
    return resultado(false, "credit_quantity_invalid");
  }
  if (!Number.isSafeInteger(disponivel) || disponivel < necessario) {
    return resultado(false, "workspace_credits_unavailable");
  }

  const agoraData = new Date(agora);
  if (!Number.isFinite(agoraData.getTime())) {
    return resultado(false, "credit_clock_invalid");
  }

  const expiraAdmin = dataValida(usuario.creditosAdminManualExpiraEm);
  if (usuario.creditosAdminManualAtivo === true && expiraAdmin &&
      expiraAdmin > agoraData) {
    return resultado(true, "admin_credit_current", "admin_credit");
  }

  const politica = saasFundacao.politicaCreditosPlano(plano);
  if (politica.creditosModelo === "unicos") {
    if (texto(usuario.statusConta) === "teste_esgotado") {
      return resultado(false, "one_time_credit_exhausted", "opening_balance");
    }
    return resultado(true, "one_time_credit_current", "opening_balance");
  }

  if (politica.creditosModelo !== "ciclo") {
    return resultado(false, "credit_model_unsupported");
  }

  const fimCiclo = dataValida(usuario.cicloAtualFim || usuario.proximaRenovacao);
  if (!fimCiclo) return resultado(false, "credit_cycle_end_missing");
  if (fimCiclo <= agoraData) return resultado(false, "credit_cycle_expired");

  const statusAssinatura = texto(usuario.assinaturaStatus);
  if (["suspensa", "suspended", "cancelada", "cancelled",
    "pagamento_pendente", "pendente_pagamento", "pending_payment"].includes(
    statusAssinatura)) {
    return resultado(false, "credit_subscription_not_authorized");
  }

  if (STATUS_CICLO_INTERNO.has(statusAssinatura)) {
    return resultado(true, "internal_cycle_current", "authorized_cycle");
  }

  const pagamentoComprovado = Boolean(
    usuario.ultimoCicloCreditoId ||
    usuario.ultimoCicloCreditoIdempotencyKey ||
    ["aprovado", "approved"].includes(texto(usuario.pagamentoUltimoStatus))
  );
  if (statusAssinatura === "ativa" && pagamentoComprovado) {
    return resultado(true, "paid_cycle_current", "payment_cycle");
  }

  // Planos sem renovacao podem consumir apenas o ciclo de entrada ainda
  // vigente; a data so e aceita junto da politica explicita do plano.
  if (politica.renovacaoCreditos === "sem_renovacao" &&
      statusAssinatura === "nao_aplicavel") {
    return resultado(true, "nonrenewing_cycle_current", "opening_cycle");
  }

  return resultado(false, "credit_entitlement_not_proven");
}

async function creditoDisponivelSomenteLeitura({ usuario = null, plano = null,
  workspaceId = "", quantidade = 1, readBalance, agora = new Date() } = {}) {
  if (typeof readBalance !== "function") {
    throw new Error("universal_credit_read_required");
  }
  const saldo = await readBalance({ workspaceId });
  return {
    ...avaliarDireitoConsumoUniversal({ usuario, plano, saldo, quantidade, agora }),
    balance: saldo.balance,
    reserved: saldo.reserved,
    available: saldo.available
  };
}

module.exports = {
  avaliarDireitoConsumoUniversal,
  creditoDisponivelSomenteLeitura
};
