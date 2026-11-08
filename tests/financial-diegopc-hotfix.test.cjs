"use strict";

const assert = require("node:assert/strict");
const {
  projetarSaldoCreditos,
  lerSaldoCreditosSomenteLeitura,
  lerSaldoCreditosOperacional
} = require("../modules/saas/credit-balance.service");
const {
  calcularReconciliacaoAdministrativaHistorica
} = require("../modules/engine/universal-credit-reconciliation.service");

function source(id, kind, state, granted, available, reserved = 0,
  consumed = 0, expired = 0) {
  return { id, source_kind: kind, state, granted, available, reserved,
    consumed, expired };
}

function movimento(id, ledgerType, amount, balancePolicy = "add") {
  return { id, ledger_type: ledgerType, balance_policy: balancePolicy,
    amount, universal_credit_source_id: null,
    created_at: `2026-10-0${id}T00:00:00.000Z` };
}

function testarProjecao() {
  assert.deepEqual(projetarSaldoCreditos({ mode: "UNIVERSAL", saldo: {
    balance: 15436, reserved: 28, available: 0,
    legacySegregated: 15408, sourceMode: "ACTIVE_SEGREGATED",
    cycleGranted: 4000, cycleAvailable: 0, cycleReserved: 9,
    cycleConsumed: 3991, adminAvailable: 0
  } }), {
    total: 15436, disponivel: 0, reservado: 28,
    historicoBloqueado: 15408, planoConcedido: 4000,
    planoDisponivel: 0, planoReservado: 9, planoConsumido: 3991,
    adicionaisDisponiveis: 0, modoFonte: "ACTIVE_SEGREGATED"
  });
  assert.equal(projetarSaldoCreditos({ mode: "UNIVERSAL",
    saldo: { balance: 37 } }).disponivel, 37);
  assert.equal(projetarSaldoCreditos({ mode: "UNIVERSAL", saldo: {
    balance: 37, sourceMode: "ACTIVE_SEGREGATED"
  } }).disponivel, 0);
  assert.equal(projetarSaldoCreditos({ mode: "LEGACY",
    usuario: { creditos: 25 } }).disponivel, 25);
  assert.equal(projetarSaldoCreditos({ mode: "LEGACY",
    usuario: {} }).disponivel, null);
}

function testarDryRunDiego() {
  const entrada = {
    workspaceId: "user_pss60lus",
    epoch: "2026-10-30T00:00:00.000Z",
    sourceMode: "ACTIVE_SEGREGATED",
    balance: { balance: 15436, reserved: 28 },
    sources: [
      source("escrow", "legacy_escrow", "escrow", 19, 0, 19),
      source("legacy", "legacy_unclassified", "unclassified", 15408, 15408),
      source("cycle", "cycle", "active", 4000, 0, 9, 3991)
    ],
    movements: [
      movimento("1", "admin_credit", 6000),
      movimento("2", "admin_credit", 1000),
      movimento("3", "admin_credit", 9000),
      movimento("4", "admin_credit", 20000),
      movimento("5", "cycle_credit", 2588, "replace_cycle")
    ]
  };
  const resultado = calcularReconciliacaoAdministrativaHistorica(entrada);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.dryRun, true);
  assert.equal(resultado.applyAllowed, false);
  assert.equal(resultado.adminGranted, 36000);
  assert.equal(resultado.provenAdminCredits, 12820);
  assert.equal(resultado.unprovenCredits, 2588);
  assert.match(resultado.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(calcularReconciliacaoAdministrativaHistorica(entrada).proofHash,
    resultado.proofHash);

  const outroTenant = calcularReconciliacaoAdministrativaHistorica({
    ...entrada, workspaceId: "workspace_sintetica"
  });
  assert.notEqual(outroTenant.proofHash, resultado.proofHash);

  const comReservaIndevida = calcularReconciliacaoAdministrativaHistorica({
    ...entrada,
    sources: entrada.sources.map(item => item.id === "legacy"
      ? { ...item, available: 15407, reserved: 1 } : item)
  });
  assert.equal(comReservaIndevida.ok, false);
  assert.ok(comReservaIndevida.blockers.includes(
    "legacy_unclassified_has_reservations"));
  assert.equal(comReservaIndevida.applyAllowed, false);
}

async function testarCompatibilidadeTotalVsDisponivel() {
  const saldo = { balance: 15436, reserved: 28, available: 0,
    legacySegregated: 15408, sourceMode: "ACTIVE_SEGREGATED" };
  const readBalance = async () => saldo;
  assert.equal(await lerSaldoCreditosSomenteLeitura({ mode: "UNIVERSAL",
    workspaceId: "user_pss60lus", readBalance }), 15436,
  "read-only scalar keeps the aggregate balance contract");
  assert.equal(await lerSaldoCreditosOperacional({ mode: "UNIVERSAL",
    workspaceId: "user_pss60lus", readBalance }), 0,
  "operational gate uses only spendable credits");
}

(async () => {
  testarProjecao();
  testarDryRunDiego();
  await testarCompatibilidadeTotalVsDisponivel();
  console.log("FINANCIAL_DIEGOPC_HOTFIX_PASS", JSON.stringify({
    projection: true,
    legacyCompatibility: true,
    totalVsSpendable: true,
    dryRunOnly: true,
    provenAdminCredits: 12820,
    unprovenCredits: 2588,
    multiworkspaceIsolation: true
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
