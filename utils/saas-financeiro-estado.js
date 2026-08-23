"use strict";

const saasFundacao = require("./saas-fundacao");

const ASSINATURA_STATUS_PAGAMENTO_INICIAL_PENDENTE = new Set([
  "pendente_pagamento",
  "pagamento_pendente",
  "pending_payment"
]);

const ASSINATURA_STATUS_RENOVACAO_PENDENTE = new Set([
  "pagamento_pendente",
  "pending_payment",
  "suspensa",
  "suspended"
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
}

function resolverFinanceiroUsuarioSaas({ usuario = {}, planos = {} } = {}) {
  const planoInformado = usuario.planoAssinatura || usuario.plano || "";
  const entradaPlano = saasFundacao.buscarEntradaPlano(planos, planoInformado);
  const planoIdFallback = texto(planoInformado);

  if (!entradaPlano?.plano) {
    return {
      requerAtivacaoPagamento: false,
      requerRenovacaoPagamento: false,
      planoId: planoIdFallback,
      motivo: ""
    };
  }

  const plano = saasFundacao.normalizarPlanoSaasComId(entradaPlano.plano, entradaPlano.chave);
  const politica = saasFundacao.politicaCreditosPlano(plano);
  const statusAssinatura = textoLower(usuario.assinaturaStatus);
  const pagamentoUltimoStatus = textoLower(usuario.pagamentoUltimoStatus);
  const possuiCicloPagoAnterior = Boolean(
    usuario.ultimoCicloCreditoId ||
    usuario.ultimoCicloCreditoIdempotencyKey ||
    pagamentoUltimoStatus === "aprovado"
  );
  const planoPagoPorPagamento =
    plano.entradaBeta !== true &&
    politica.renovacaoCreditos === "pagamento";

  const requerAtivacaoPagamento =
    planoPagoPorPagamento &&
    !possuiCicloPagoAnterior &&
    ASSINATURA_STATUS_PAGAMENTO_INICIAL_PENDENTE.has(statusAssinatura);

  const requerRenovacaoPagamento =
    planoPagoPorPagamento &&
    possuiCicloPagoAnterior &&
    !requerAtivacaoPagamento &&
    (
      ASSINATURA_STATUS_RENOVACAO_PENDENTE.has(statusAssinatura) ||
      pagamentoUltimoStatus === "vencido_sem_pagamento"
    );

  return {
    requerAtivacaoPagamento,
    requerRenovacaoPagamento,
    planoId: plano.id || plano.nome || planoIdFallback,
    motivo: requerAtivacaoPagamento
      ? "pagamento_inicial_pendente"
      : requerRenovacaoPagamento
        ? "pagamento_renovacao_pendente"
        : ""
  };
}

module.exports = {
  resolverFinanceiroUsuarioSaas
};
