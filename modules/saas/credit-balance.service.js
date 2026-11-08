"use strict";

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : fallback;
}

function projetarSaldoCreditos({ mode, usuario, saldo } = {}) {
  if (mode === "LEGACY") {
    const total = usuario?.creditos == null
      ? null : numeroSeguro(usuario.creditos, 0);
    return {
      total,
      disponivel: total,
      reservado: 0,
      historicoBloqueado: 0,
      planoConcedido: 0,
      planoDisponivel: total,
      planoReservado: 0,
      planoConsumido: 0,
      adicionaisDisponiveis: 0,
      modoFonte: "LEGACY"
    };
  }
  if (mode !== "UNIVERSAL") throw new Error("credit_mode_not_ready");
  if (!saldo || typeof saldo !== "object") {
    throw new Error("universal_credit_projection_required");
  }
  const fonteAtiva = ["ACTIVE", "ACTIVE_SEGREGATED"]
    .includes(String(saldo.sourceMode || ""));
  const disponivel = saldo.available ?? saldo.spendable ??
    (fonteAtiva ? 0 : saldo.balance);
  return {
    total: numeroSeguro(saldo.balance),
    disponivel: numeroSeguro(disponivel),
    reservado: numeroSeguro(saldo.reserved),
    historicoBloqueado: numeroSeguro(saldo.legacySegregated),
    planoConcedido: numeroSeguro(saldo.cycleGranted),
    planoDisponivel: numeroSeguro(saldo.cycleAvailable),
    planoReservado: numeroSeguro(saldo.cycleReserved),
    planoConsumido: numeroSeguro(saldo.cycleConsumed),
    adicionaisDisponiveis: numeroSeguro(saldo.adminAvailable),
    modoFonte: String(saldo.sourceMode || "UNIVERSAL")
  };
}

async function lerProjecaoCreditosSomenteLeitura({
  mode,
  workspaceId,
  usuario,
  readBalance
} = {}) {
  if (mode === "LEGACY") return projetarSaldoCreditos({ mode, usuario });
  if (mode !== "UNIVERSAL") throw new Error("credit_mode_not_ready");
  if (typeof readBalance !== "function") {
    throw new Error("universal_credit_reader_required");
  }
  const saldo = await readBalance({ workspaceId });
  return projetarSaldoCreditos({ mode, usuario, saldo });
}

async function lerSaldoCreditosSomenteLeitura({
  mode,
  workspaceId,
  usuario,
  readBalance
} = {}) {
  const projecao = await lerProjecaoCreditosSomenteLeitura({
    mode, workspaceId, usuario, readBalance
  });
  return projecao.total;
}

async function lerProjecaoCreditosOperacional({
  mode,
  workspaceId,
  usuario,
  renew,
  readBalance,
  onStage = () => {}
} = {}) {
  if (mode === "UNIVERSAL" && usuario) {
    if (typeof renew !== "function") {
      throw new Error("universal_credit_renewer_required");
    }
    onStage("credit.renewal");
    await renew(usuario, { onStage });
  }
  onStage("credit.ledger_read");
  return lerProjecaoCreditosSomenteLeitura({
    mode, workspaceId, usuario, readBalance
  });
}

async function lerSaldoCreditosOperacional({
  mode,
  workspaceId,
  usuario,
  renew,
  readBalance,
  onStage = () => {}
} = {}) {
  const projecao = await lerProjecaoCreditosOperacional({
    mode, workspaceId, usuario, renew, readBalance, onStage
  });
  return projecao.disponivel;
}

module.exports = {
  projetarSaldoCreditos,
  lerProjecaoCreditosSomenteLeitura,
  lerProjecaoCreditosOperacional,
  lerSaldoCreditosSomenteLeitura,
  lerSaldoCreditosOperacional
};
