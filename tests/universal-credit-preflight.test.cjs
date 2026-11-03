"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  avaliarDireitoConsumoUniversal
} = require("../modules/engine/universal-credit-eligibility.service");

const planoPago = {
  nome: "Pro",
  creditosModelo: "ciclo",
  renovacaoCreditos: "pagamento",
  creditosPorCiclo: 100,
  cicloDias: 30
};

test("preflight Universal e puro e exige direito vigente", () => {
  const saldo = { balance: 10, reserved: 2, available: 8 };
  const vigente = avaliarDireitoConsumoUniversal({
    usuario: {
      assinaturaStatus: "ativa",
      pagamentoUltimoStatus: "aprovado",
      ultimoCicloCreditoId: "pagamento-fixture",
      cicloAtualFim: "2026-12-01T00:00:00.000Z"
    },
    plano: planoPago,
    saldo,
    agora: "2026-11-03T12:00:00.000Z"
  });
  assert.deepEqual(vigente, {
    ok: true,
    reason: "paid_cycle_current",
    origin: "payment_cycle"
  });

  const vencido = avaliarDireitoConsumoUniversal({
    usuario: {
      assinaturaStatus: "ativa",
      pagamentoUltimoStatus: "aprovado",
      ultimoCicloCreditoId: "pagamento-fixture",
      cicloAtualFim: "2026-10-01T00:00:00.000Z"
    },
    plano: planoPago,
    saldo,
    agora: "2026-11-03T12:00:00.000Z"
  });
  assert.equal(vencido.ok, false);
  assert.equal(vencido.reason, "credit_cycle_expired");

  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf("async function creditoDisponivelParaEnvio");
  const fim = fonte.indexOf("async function saldoCreditosParaExibicao", inicio);
  const preflight = fonte.slice(inicio, fim);
  assert.ok(preflight.includes("creditoDisponivelSomenteLeitura"));
  assert.ok(!preflight.includes("renovarCreditosUniversalSeNecessario"));
  assert.ok(!preflight.includes("POLICY_BALANCE_SET"));
});

test("credito administrativo vigente e independente de assinatura pendente", () => {
  const resultado = avaliarDireitoConsumoUniversal({
    usuario: {
      assinaturaStatus: "pagamento_pendente",
      creditosAdminManualAtivo: true,
      creditosAdminManualExpiraEm: "2026-11-10T00:00:00.000Z"
    },
    plano: planoPago,
    saldo: { balance: 5, reserved: 1, available: 4 },
    agora: "2026-11-03T12:00:00.000Z"
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.origin, "admin_credit");
});

test("saldo, data isolada e credito administrativo expirado nao autorizam", () => {
  const base = {
    plano: planoPago,
    saldo: { balance: 50, reserved: 0, available: 50 },
    agora: "2026-11-03T12:00:00.000Z"
  };
  const semProva = avaliarDireitoConsumoUniversal({ ...base,
    usuario: { assinaturaStatus: "ativa",
      cicloAtualFim: "2026-12-01T00:00:00.000Z" } });
  assert.equal(semProva.ok, false);
  assert.equal(semProva.reason, "credit_entitlement_not_proven");

  const adminExpirado = avaliarDireitoConsumoUniversal({ ...base,
    usuario: { assinaturaStatus: "suspensa",
      creditosAdminManualAtivo: true,
      creditosAdminManualExpiraEm: "2026-11-02T00:00:00.000Z",
      cicloAtualFim: "2026-10-01T00:00:00.000Z" } });
  assert.equal(adminExpirado.ok, false);
});
