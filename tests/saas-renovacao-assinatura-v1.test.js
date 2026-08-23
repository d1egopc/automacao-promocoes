"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const saas = require("../utils/saas-fundacao");
const { resolverFinanceiroUsuarioSaas } = require("../utils/saas-financeiro-estado");

const raiz = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const checkout = fs.readFileSync(path.join(raiz, "modules", "financeiro", "checkout.routes.js"), "utf8");
const helperFonte = fs.readFileSync(path.join(raiz, "utils", "saas-financeiro-estado.js"), "utf8");

const planoFree = {
  id: "free",
  nome: "Free",
  entradaBeta: true,
  renovacaoCreditos: "sem_renovacao",
  creditosModelo: "ciclo",
  creditosPorCiclo: 300,
  cicloDias: 30,
  preco: "R$ 0,00"
};

const planoPro = {
  id: "pro",
  nome: "Pro",
  entradaBeta: false,
  renovacaoCreditos: "pagamento",
  creditosModelo: "ciclo",
  creditosPorCiclo: 2000,
  cicloDias: 30,
  visivelPublicamente: true,
  contratavel: true,
  emBreve: false,
  preco: "R$ 34,90"
};

const planos = { free: planoFree, pro: planoPro };

function financeiro(usuario) {
  return resolverFinanceiroUsuarioSaas({ usuario, planos });
}

const freeZerado = financeiro({
  id: "free_0",
  plano: "free",
  planoAssinatura: "free",
  creditos: 0,
  assinaturaStatus: "nao_aplicavel",
  pagamentoUltimoStatus: "sem_renovacao"
});
assert.strictEqual(freeZerado.requerAtivacaoPagamento, false, "Free nunca exige ativacao paga");
assert.strictEqual(freeZerado.requerRenovacaoPagamento, false, "Free zerado nao vira renovacao pendente");

const primeiroPagamento = financeiro({
  id: "novo_pro",
  plano: "pro",
  planoAssinatura: "pro",
  creditos: 0,
  assinaturaStatus: "pendente_pagamento"
});
assert.strictEqual(primeiroPagamento.requerAtivacaoPagamento, true, "Pro novo sem ciclo anterior vai para paywall inicial");
assert.strictEqual(primeiroPagamento.requerRenovacaoPagamento, false, "Primeiro pagamento nao e renovacao");
assert.strictEqual(primeiroPagamento.motivo, "pagamento_inicial_pendente");

const ativoSemCredito = financeiro({
  id: "pro_ativo_zero",
  plano: "pro",
  planoAssinatura: "pro",
  creditos: 0,
  creditosModelo: "ciclo",
  assinaturaStatus: "ativa",
  pagamentoUltimoStatus: "aprovado",
  ultimoCicloCreditoId: "cycle_credit:mercadopago:pay_ativo"
});
assert.strictEqual(ativoSemCredito.requerAtivacaoPagamento, false, "Pago ativo com 0 creditos nao volta ao paywall inicial");
assert.strictEqual(ativoSemCredito.requerRenovacaoPagamento, false, "Pago ativo com 0 creditos nao e assinatura vencida");

const emCarencia = {
  id: "pro_carencia",
  plano: "pro",
  planoAssinatura: "pro",
  creditos: 73,
  creditosModelo: "ciclo",
  assinaturaStatus: "ativa",
  pagamentoUltimoStatus: "aprovado",
  cicloAtualInicio: "2026-07-01T00:00:00.000Z",
  cicloAtualFim: "2026-08-01T00:00:00.000Z",
  proximaRenovacao: "2026-08-01T00:00:00.000Z",
  ultimoCicloCreditoId: "pay_anterior"
};
const resultadoCarencia = saas.renovarCreditosPorPlano(emCarencia, planoPro, new Date("2026-08-01T12:00:00.000Z"));
assert.strictEqual(resultadoCarencia.motivo, "pagamento_pendente_carencia");
assert.strictEqual(emCarencia.assinaturaStatus, "pagamento_pendente");
assert.strictEqual(financeiro(emCarencia).requerRenovacaoPagamento, true, "Ciclo vencido em carencia vira renovacao pendente");

const suspenso = {
  ...emCarencia,
  id: "pro_suspenso",
  creditos: 0,
  assinaturaStatus: "suspensa",
  pagamentoUltimoStatus: "vencido_sem_pagamento",
  suspensoEm: "2026-08-03T00:00:00.000Z"
};
const financeiroSuspenso = financeiro(suspenso);
assert.strictEqual(financeiroSuspenso.requerAtivacaoPagamento, false, "Suspenso com ciclo anterior nao e primeiro pagamento");
assert.strictEqual(financeiroSuspenso.requerRenovacaoPagamento, true, "Suspenso vencido exige renovacao");
assert.strictEqual(financeiroSuspenso.motivo, "pagamento_renovacao_pendente");

assert.ok(helperFonte.includes("possuiCicloPagoAnterior"), "Renovacao deve depender de ciclo pago anterior");
assert.ok(helperFonte.includes("ASSINATURA_STATUS_RENOVACAO_PENDENTE"), "Estados de renovacao devem ser explicitos");
assert.ok(!/creditos\s*(?:===|==|<=|<)\s*0|Number\(usuario\.creditos/.test(helperFonte), "Renovacao nao pode usar creditos zero como autoridade");
assert.ok(!/pagamentoUltimoStatus === \"vencido_sem_pagamento\"[\s\S]*requerRenovacaoPagamento =[^&]*;/.test(helperFonte), "pagamentoUltimoStatus sozinho nao deve ser autoridade unica");

assert.ok(index.includes("resolverFinanceiroUsuarioSaas"), "/me deve usar helper financeiro compartilhado");
assert.ok(index.includes("renovarFinanceiroUsuario: renovarCreditosSeNecessario"), "/financeiro deve receber virada de ciclo existente");
assert.ok(checkout.includes("renovarFinanceiroUsuario(usuario)"), "/financeiro/assinatura deve refletir vencimento antes do payload");
assert.ok(checkout.includes("financeiro: financeiroUsuarioSanitizado"), "/financeiro/assinatura deve expor mesmo contrato financeiro");

console.log("saas-renovacao-assinatura-v1.test.js OK");
