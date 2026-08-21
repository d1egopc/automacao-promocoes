"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const saas = require("../utils/saas-fundacao");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function trechoEntre(fonte, inicio, fim) {
  const ini = fonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = fonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return fonte.slice(ini, end);
}

const planoPago = {
  nome: "Plano Dinamico Pago",
  contratavel: true,
  creditosModelo: "ciclo",
  limites: {
    creditosPorCiclo: 2000,
    cicloDias: 30,
    carenciaPagamentoDias: 1
  }
};

const planoPagoNovo = {
  nome: "Plano Novo Admin",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 777, cicloDias: 15 }
};

const planoInterno = {
  nome: "Plano Interno Nao Contratavel",
  visivelPublicamente: false,
  contratavel: false,
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 555, cicloDias: 30 }
};

const planoFree = {
  nome: "Teste Unico",
  creditosModelo: "unicos",
  limites: { creditosUnicos: 300 }
};

let usuario = {
  id: "user_pago",
  email: "pago@teste.local",
  plano: planoPago.nome,
  assinaturaStatus: "pendente",
  creditos: 0
};

let aprovado = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_001",
  agora: new Date("2026-08-01T10:00:00.000Z"),
  operador: "admin"
});

assert.strictEqual(aprovado.ok, true, "pagamento aprovado inicial deve ser aceito");
assert.strictEqual(usuario.assinaturaStatus, "ativa");
assert.strictEqual(usuario.pagamentoUltimoStatus, "aprovado");
assert.strictEqual(usuario.pagamentoUltimoId, "pay_001");
assert.strictEqual(usuario.ultimoCicloCreditoId, "pay_001");
assert.strictEqual(usuario.planoAssinatura, planoPago.nome);
assert.strictEqual(usuario.creditos, 2000, "ciclo aprovado carrega exatamente creditosPorCiclo");
assert.strictEqual(usuario.cicloAtualInicio, "2026-08-01T10:00:00.000Z");
assert.strictEqual(usuario.cicloAtualFim, "2026-08-31T10:00:00.000Z");
assert.strictEqual(usuario.proximaRenovacao, "2026-08-31T10:00:00.000Z");

usuario.creditos = 73;
const repetido1 = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_001",
  agora: new Date("2026-08-01T11:00:00.000Z"),
  operador: "admin"
});
const repetido2 = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_001",
  agora: new Date("2026-08-01T12:00:00.000Z"),
  operador: "admin"
});
assert.strictEqual(repetido1.idempotente, true, "mesmo pagamentoId deve ser idempotente");
assert.strictEqual(repetido2.idempotente, true, "terceira chegada do mesmo pagamentoId tambem deve ser idempotente");
assert.strictEqual(usuario.creditos, 73, "pagamento repetido nao recarrega creditos");

const recusado = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "recusado",
  pagamentoId: "pay_recusado",
  agora: new Date("2026-08-02T00:00:00.000Z")
});
assert.strictEqual(recusado.motivo, "pagamento_recusado");
assert.strictEqual(usuario.assinaturaStatus, "pagamento_pendente");
assert.strictEqual(usuario.pagamentoUltimoStatus, "recusado");

const pendente = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "pendente",
  pagamentoId: "pay_pendente",
  agora: new Date("2026-08-02T01:00:00.000Z")
});
assert.strictEqual(pendente.motivo, "pagamento_pendente");
assert.strictEqual(usuario.assinaturaStatus, "pagamento_pendente");
assert.strictEqual(usuario.pagamentoUltimoStatus, "pendente");

usuario = {
  id: "user_vencido",
  plano: planoPago.nome,
  creditosModelo: "ciclo",
  assinaturaStatus: "ativa",
  pagamentoUltimoStatus: "aprovado",
  creditos: 73,
  cicloAtualInicio: "2026-08-01T00:00:00.000Z",
  cicloAtualFim: "2026-08-31T00:00:00.000Z",
  proximaRenovacao: "2026-08-31T00:00:00.000Z",
  ultimoCicloCreditoId: "pay_ciclo_antigo"
};

const vencidoCarencia = saas.renovarCreditosPorPlano(usuario, planoPago, new Date("2026-08-31T12:00:00.000Z"));
assert.strictEqual(vencidoCarencia.motivo, "pagamento_pendente_carencia");
assert.strictEqual(usuario.assinaturaStatus, "pagamento_pendente", "vencimento sem pagamento marca pendencia");
assert.strictEqual(usuario.creditos, 73, "vencimento nao gera creditos nem zera durante carencia");

const vencidoSuspenso = saas.renovarCreditosPorPlano(usuario, planoPago, new Date("2026-09-02T00:00:00.000Z"));
assert.strictEqual(vencidoSuspenso.motivo, "assinatura_suspensa_sem_pagamento");
assert.strictEqual(usuario.assinaturaStatus, "suspensa");
assert.strictEqual(usuario.creditos, 0, "fim da carencia suspende operacao com creditos 0");

const reativado = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_reativa",
  agora: new Date("2026-09-03T00:00:00.000Z")
});
assert.strictEqual(reativado.ok, true);
assert.strictEqual(usuario.assinaturaStatus, "ativa");
assert.strictEqual(usuario.creditos, 2000, "pagamento posterior reabre ciclo com saldo do plano");

usuario.creditos = 73;
const cicloNovo = saas.aplicarPagamentoSimulado(usuario, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_novo_ciclo",
  agora: new Date("2026-10-03T00:00:00.000Z")
});
assert.strictEqual(cicloNovo.ok, true);
assert.strictEqual(usuario.creditos, 2000, "novo ciclo substitui saldo residual, nao soma");

const free = { id: "user_free", plano: planoFree.nome, creditos: 0, statusConta: "ativa" };
const freeRenovacao = saas.renovarCreditosPorPlano(free, planoFree, new Date("2026-08-20T00:00:00.000Z"));
assert.strictEqual(freeRenovacao.motivo, "teste_esgotado");
assert.strictEqual(free.statusConta, "teste_esgotado");
assert.strictEqual(free.creditos, 0, "creditos unicos nao renovam");

const workspace = { id: "workspace_preservado" };
const configs = { user_free: workspace };
const upgrade = saas.aplicarPagamentoSimulado(free, planoPago, {
  estado: "aprovado",
  pagamentoId: "pay_upgrade",
  agora: new Date("2026-08-21T00:00:00.000Z")
});
assert.strictEqual(upgrade.ok, true);
assert.strictEqual(free.plano, planoPago.nome, "upgrade aplica plano pago escolhido");
assert.strictEqual(free.assinaturaStatus, "ativa");
assert.strictEqual(free.creditos, 2000);
assert.strictEqual(configs.user_free, workspace, "upgrade preserva workspace existente");

const dinamico = { id: "user_dinamico", plano: planoPagoNovo.nome };
assert.strictEqual(
  saas.aplicarPagamentoSimulado(dinamico, planoPagoNovo, {
    estado: "aprovado",
    pagamentoId: "pay_dinamico",
    agora: new Date("2026-08-22T00:00:00.000Z")
  }).ok,
  true,
  "plano dinamico criado pelo Admin deve funcionar por contrato"
);
assert.strictEqual(dinamico.creditos, 777);

const interno = { id: "user_interno", plano: planoInterno.nome };
assert.strictEqual(
  saas.aplicarPagamentoSimulado(interno, planoInterno, {
    estado: "aprovado",
    pagamentoId: "pay_interno",
    agora: new Date("2026-08-22T00:00:00.000Z")
  }).ok,
  true,
  "contratavel=false nao impede atribuicao interna/Admin"
);
assert.strictEqual(interno.creditos, 555);

assert.strictEqual(
  saas.aplicarPagamentoSimulado({ id: "sem_plano" }, null, {
    estado: "aprovado",
    pagamentoId: "pay_sem_plano"
  }).codigo,
  "plano_nao_encontrado",
  "ausencia de plano deve falhar explicitamente"
);

assert.strictEqual(
  saas.aplicarPagamentoSimulado({ id: "sem_id_pagamento" }, planoPago, {
    estado: "aprovado"
  }).codigo,
  "pagamento_id_obrigatorio",
  "aprovado exige pagamentoId unico"
);

assert.strictEqual(
  saas.aplicarPagamentoSimulado({ id: "estado_invalido" }, planoPago, {
    estado: "estornado",
    pagamentoId: "pay_estornado"
  }).codigo,
  "estado_pagamento_invalido",
  "endpoint deve aceitar somente estados controlados"
);

const rotaAssinatura = trechoEntre(
  indexFonte,
  'app.post("/admin/assinaturas/:usuarioId/pagamento-simulado"',
  'app.get("/admin/usuarios"'
);
assert.ok(
  rotaAssinatura.includes("exigirAdminMasterEstrito"),
  "rota de pagamento simulado deve exigir Admin Master estrito"
);
assert.ok(
  rotaAssinatura.includes("executarPagamentoSimuladoAssinaturaAdmin"),
  "rota deve reutilizar helper interno de assinatura"
);

const helperAssinatura = trechoEntre(
  indexFonte,
  "function executarPagamentoSimuladoAssinaturaAdmin",
  'app.get("/public/saas-config"'
);
assert.ok(
  !/\b(free|pro|premium|enterprise|ultimate|starter)\b/i.test(helperAssinatura),
  "assinatura nao pode depender de nomes fixos de plano"
);
assert.ok(
  helperAssinatura.includes("salvarUsuarios()"),
  "evento financeiro simulado deve persistir usuario"
);

console.log("saas-assinatura-v1.test.js OK");
