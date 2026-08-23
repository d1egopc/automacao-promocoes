"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const fundacao = fs.readFileSync(path.join(raiz, "utils", "saas-fundacao.js"), "utf8");
const helper = fs.readFileSync(path.join(raiz, "utils", "saas-financeiro-estado.js"), "utf8");

assert.ok(index.includes("planoAssinatura: usuario.planoAssinatura || usuario.plano || \"\""), "/me deve expor planoAssinatura sanitizado");
assert.ok(index.includes("assinaturaStatus: usuario.assinaturaStatus || \"\""), "/me deve expor assinaturaStatus sanitizado");
assert.ok(index.includes("statusConta: usuario.statusConta || \"\""), "/me deve expor statusConta sanitizado");
assert.ok(index.includes("creditosModelo: usuario.creditosModelo || \"\""), "/me deve expor creditosModelo sanitizado");
assert.ok(index.includes("cicloAtualInicio: usuario.cicloAtualInicio || \"\""), "/me deve expor cicloAtualInicio sanitizado");
assert.ok(index.includes("cicloAtualFim: usuario.cicloAtualFim || \"\""), "/me deve expor cicloAtualFim sanitizado");
assert.ok(index.includes("proximaRenovacao: usuario.proximaRenovacao || \"\""), "/me deve expor proximaRenovacao sanitizado");
assert.ok(index.includes("pagamentoUltimoStatus: usuario.pagamentoUltimoStatus || \"\""), "/me deve expor pagamentoUltimoStatus sanitizado");
assert.ok(index.includes("financeiro: resolverFinanceiroUsuarioMe(usuario)"), "/me deve expor financeiro derivado");
assert.ok(index.includes("resolverFinanceiroUsuarioSaas"), "/me deve usar helper unico derivado para financeiro");

assert.ok(helper.includes("saasFundacao.buscarEntradaPlano(planos, planoInformado)"), "Helper deve resolver plano pelo catalogo atual");
assert.ok(helper.includes("saasFundacao.politicaCreditosPlano(plano)"), "Helper deve usar politica estrutural do plano");
assert.ok(helper.includes("plano.entradaBeta !== true"), "Free/Beta nunca deve exigir ativacao paga");
assert.ok(helper.includes('politica.renovacaoCreditos === "pagamento"'), "Paywall deve depender de renovacao por pagamento");
assert.ok(helper.includes("possuiCicloPagoAnterior"), "Paywall deve distinguir primeiro pagamento pendente de conta paga ja ativada");
assert.ok(helper.includes("!possuiCicloPagoAnterior"), "Usuario pago ja ativado nao deve ser bloqueado por pendencia posterior");
assert.ok(helper.includes("ASSINATURA_STATUS_PAGAMENTO_INICIAL_PENDENTE.has(statusAssinatura)"), "Paywall deve depender do estado inicial pendente");
assert.ok(helper.includes("pagamento_inicial_pendente"), "Motivo tecnico deve ser explicito");
assert.ok(helper.includes("requerAtivacaoPagamento"), "Contrato financeiro deve ser exposto");
assert.ok(!/creditos\s*(?:===|==|<=|<)\s*0|Number\(usuario\.creditos/.test(helper), "Paywall nao pode usar creditos zero como autoridade");
assert.ok(!/cicloAtualInicio|cicloAtualFim|proximaRenovacao/.test(helper), "Datas de ciclo nao podem provar pagamento");

assert.ok(fundacao.includes('"pendente_pagamento"'), "Cadastro pago novo deve nascer como pendente_pagamento");
assert.ok(fundacao.includes('usuario.assinaturaStatus = "ativa"'), "Pagamento aprovado deve ativar assinatura existente");

console.log("saas-paywall-pre-dashboard-v1.test.js OK");
