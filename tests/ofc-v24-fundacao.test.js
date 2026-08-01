"use strict";

const assert = require("assert");
const {
  auditarLogicaFixaOfc,
  criarAuditoriaOfcV24Shadow
} = require("../modules/ofc-v2/auditoria-ofc");
const {
  calcularUTOOferta,
  medirWorkspaceOperacional
} = require("../modules/ofc-v2/medidor-operacional");

const regras = auditarLogicaFixaOfc();
assert.ok(regras.length >= 5);
assert.ok(regras.some(item => item.arquivo.includes("active-gate.service.js")));
assert.ok(regras.some(item => item.arquivo.includes("performance-hotfix.js")));
assert.ok(regras.every(item => item.acaoRecomendada));

const auditoria = criarAuditoriaOfcV24Shadow({
  gateAbsorcao: {
    workspaces: [
      {
        workspaceId: "user_roger",
        estadoDaEsteira: "FECHADA",
        pressaoEsteiraViva: 50,
        slots15Min: 2,
        destinosAptos: 0,
        integracoesAptas: 0,
        janelaAbertaAgora: false,
        pendentesVivos: 47,
        emTentativaEnvio: 3,
        idadeMediaVivaMs: 600000,
        idadeP95VivaMs: 900000,
        entrada15Min: 0,
        saida15Min: 0
      },
      {
        workspaceId: "user_d1",
        estadoDaEsteira: "LIVRE",
        pressaoEsteiraViva: 0,
        slots15Min: 6,
        destinosAptos: 2,
        integracoesAptas: 2,
        janelaAbertaAgora: true,
        pendentesVivos: 0,
        emTentativaEnvio: 0,
        entrada15Min: 3,
        saida15Min: 2
      }
    ]
  }
});
assert.strictEqual(auditoria.modo, "shadow");
assert.strictEqual(auditoria.aplicouMudancas, false);
assert.strictEqual(auditoria.uto.resumo.utoPressaoViva, 50);
assert.strictEqual(auditoria.uto.resumo.utoCapacidade15Min, 8);
assert.strictEqual(auditoria.metricasWorkspace.length, 2);

const uto = calcularUTOOferta({
  destinosCompativeis: [
    { id: "whatsapp", ativo: true },
    { id: "telegram", ativo: true },
    { id: "instagram", ativo: false }
  ]
});
assert.strictEqual(uto.custoUTO, 2);
assert.strictEqual(uto.aplicouMudancas, false);

const metricas = medirWorkspaceOperacional({
  workspaceId: "user_teste",
  destinos: [
    { id: "destino_1", tipo: "whatsapp", ativo: true, intervaloMinutos: 5 },
    { id: "destino_2", tipo: "telegram", ativo: true, intervaloMinutos: 10 }
  ],
  eventos15m: { ofertasCriadas: 6, enviosConfirmados: 3, enviosErroFinal: 1 },
  eventos60m: { ofertasCriadas: 12, enviosConfirmados: 6 },
  agoraMs: Date.parse("2026-08-01T12:00:00.000Z"),
  readClienteJson: () => [
    { id: "a", status: "pendente", criadoEm: "2026-08-01T11:50:00.000Z" },
    { id: "b", status: "processando", criadoEm: "2026-08-01T11:55:00.000Z" },
    { id: "c", status: "enviado", criadoEm: "2026-08-01T11:30:00.000Z" }
  ]
});
assert.strictEqual(metricas.workspaceId, "user_teste");
assert.strictEqual(metricas.unidadesPendentes, 2);
assert.strictEqual(metricas.ofertasPendentes, 1);
assert.strictEqual(metricas.taxaEntrada15m, 0.4);
assert.strictEqual(metricas.taxaSaida15m, 0.2);
assert.strictEqual(metricas.taxaSucessoExecutor, 0.75);

console.log("ofc-v24-fundacao.test.js ok");
