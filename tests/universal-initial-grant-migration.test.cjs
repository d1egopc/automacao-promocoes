"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildInitialMigrationGrant,
  migrateLegacyWorkspaceWithInitialGrant } =
  require("../modules/financeiro/universal-migration.service");
const { calcularJanelaCortesia } =
  require("../modules/financeiro/cortesia.service");

test("migration derives recurring grant from the current plan", async () => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  const plan = { id: "partners", nome: "Parceiros",
    creditosModelo: "ciclo", creditosPorCiclo: 6000,
    cicloDias: 30, renovacaoCreditos: "pagamento" };
  let received;
  const repository = {
    async activateWorkspaceSegregatedWithInitialGrant(args) {
      received = args;
      return { ok: true, spendable: args.grant.amount };
    }
  };
  const result = await migrateLegacyWorkspaceWithInitialGrant({ pool: {},
    usuario: { id: "workspace-a", plano: "partners",
      cortesiaAutomatica: true }, plano: plan,
    baselineHash: "a".repeat(64), agora: now,
    provenAdminTopupRemainder: { ledgerId:
      "21093e05-ea43-4384-8b1d-6f52c308d5a9",
    expectedRemaining: 2255, expectedRevision: 4294 }, repository });
  assert.equal(result.spendable, 6000);
  assert.deepEqual(received.grant, { planId: "partners",
    creditModel: "ciclo", renewalPolicy: "pagamento", amount: 6000,
    cycleDays: 30, cycleStart: now.toISOString(),
    cycleEnd: "2026-12-08T12:00:00.000Z" });
  assert.deepEqual(received.provenAdminTopupRemainder, {
    ledgerId: "21093e05-ea43-4384-8b1d-6f52c308d5a9",
    expectedRemaining: 2255, expectedRevision: 4294 });
});

test("free beta keeps configured 300-day non-renewing grant", () => {
  const grant = buildInitialMigrationGrant({
    usuario: { id: "workspace-beta", plano: "free-beta" },
    plano: { id: "free-beta", entradaBeta: true,
      creditosModelo: "ciclo", creditosPorCiclo: 300,
      cicloDias: 300, renovacaoCreditos: "sem_renovacao" },
    agora: "2026-11-08T00:00:00.000Z"
  });
  assert.deepEqual(grant.grant, { planId: "free-beta",
    creditModel: "ciclo", renewalPolicy: "sem_renovacao", amount: 300,
    cycleDays: 300, cycleStart: "2026-11-08T00:00:00.000Z",
    cycleEnd: "2027-09-04T00:00:00.000Z" });
  assert.deepEqual(calcularJanelaCortesia({
    usuario: { id: "workspace-beta", plano: "free-beta",
      cortesiaAutomatica: true }, plano: { id: "free-beta",
      entradaBeta: true, creditosModelo: "ciclo", creditosPorCiclo: 300,
      cicloDias: 300, renovacaoCreditos: "sem_renovacao" }
  }), { ok: false, reason: "courtesy_plan_not_cyclic" });
});

test("initial migration cycle suppresses courtesy in the same window", () => {
  const plan = { id: "partners", creditosModelo: "ciclo",
    creditosPorCiclo: 6000, cicloDias: 30,
    renovacaoCreditos: "pagamento" };
  const result = calcularJanelaCortesia({
    usuario: { id: "workspace-a", plano: "partners",
      cortesiaAutomatica: true },
    plano: plan,
    agora: "2026-11-10T00:00:00.000Z",
    ultimoCiclo: { cycle_end: "2026-12-08T00:00:00.000Z",
      projection_status: "projected", metadata: { origin:
        "universal_migration_initial", planSnapshot: {
          planoId: "partners" } } }
  });
  assert.equal(result.due, false);
  assert.equal(result.reason, "courtesy_cycle_current");
});

test("non-renewing plan never receives a courtesy renewal", () => {
  const result = calcularJanelaCortesia({
    usuario: { id: "workspace-no-renew", plano: "one-shot",
      cortesiaAutomatica: true },
    plano: { id: "one-shot", creditosModelo: "ciclo",
      creditosPorCiclo: 500, cicloDias: 90,
      renovacaoCreditos: "sem_renovacao" }
  });
  assert.deepEqual(result, { ok: false,
    reason: "courtesy_plan_not_cyclic" });
});

test("invalid plan cannot manufacture an opening grant", () => {
  assert.throws(() => buildInitialMigrationGrant({
    usuario: { id: "workspace-empty", plano: "empty" },
    plano: { id: "empty", creditosModelo: "ciclo",
      creditosPorCiclo: 0, cicloDias: 30 }
  }), /plan_policy_invalid/);
});
