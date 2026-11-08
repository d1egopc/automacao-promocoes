"use strict";

const { politicaCreditosPlano, normalizarPlanoSaasComId } =
  require("../../utils/saas-fundacao");
const sourceCredits = require("../engine/universal-credit-sources.repository");

function text(value) { return String(value ?? "").trim(); }

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function buildInitialMigrationGrant({ usuario = {}, plano = {}, planId = "",
  agora = new Date() } = {}) {
  const workspaceId = text(usuario.id);
  const normalizedPlan = normalizarPlanoSaasComId(plano,
    planId || usuario.plano || usuario.planoAssinatura);
  const resolvedPlanId = text(normalizedPlan.id || planId || usuario.plano);
  const policy = politicaCreditosPlano(normalizedPlan);
  const start = new Date(agora);
  const amount = policy.creditosModelo === "unicos"
    ? policy.creditosUnicos : policy.creditosPorCiclo;
  if (!workspaceId || !resolvedPlanId || !Number.isFinite(start.getTime()) ||
      !Number.isSafeInteger(amount) || amount <= 0 ||
      !Number.isSafeInteger(policy.cicloDias) || policy.cicloDias <= 0) {
    throw new Error("universal_migration_plan_policy_invalid");
  }
  const end = addUtcDays(start, policy.cicloDias);
  return {
    workspaceId,
    planId: resolvedPlanId,
    grant: {
      planId: resolvedPlanId,
      creditModel: policy.creditosModelo,
      renewalPolicy: policy.renovacaoCreditos,
      amount,
      cycleDays: policy.cicloDias,
      cycleStart: start.toISOString(),
      cycleEnd: end.toISOString()
    }
  };
}

async function migrateLegacyWorkspaceWithInitialGrant({ pool, usuario, plano,
  planId, baselineHash, agora, repository = sourceCredits } = {}) {
  const prepared = buildInitialMigrationGrant({ usuario, plano, planId, agora });
  return repository.activateWorkspaceSegregatedWithInitialGrant({
    pool,
    workspaceId: prepared.workspaceId,
    baselineHash,
    grant: prepared.grant
  });
}

module.exports = {
  buildInitialMigrationGrant,
  migrateLegacyWorkspaceWithInitialGrant
};
