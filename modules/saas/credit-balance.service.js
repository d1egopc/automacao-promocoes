"use strict";

async function lerSaldoCreditosSomenteLeitura({
  mode,
  workspaceId,
  usuario,
  readBalance
} = {}) {
  if (mode === "LEGACY") return usuario?.creditos ?? null;
  if (mode !== "UNIVERSAL") throw new Error("credit_mode_not_ready");
  if (typeof readBalance !== "function") {
    throw new Error("universal_credit_reader_required");
  }

  const saldo = await readBalance({ workspaceId });
  return saldo.balance;
}

async function lerSaldoCreditosOperacional({
  mode,
  workspaceId,
  usuario,
  renew,
  readBalance,
  onStage = () => {}
} = {}) {
  if (mode === "LEGACY") return usuario?.creditos ?? null;
  if (mode !== "UNIVERSAL") throw new Error("credit_mode_not_ready");
  if (usuario) {
    if (typeof renew !== "function") {
      throw new Error("universal_credit_renewer_required");
    }
    onStage("credit.renewal");
    await renew(usuario, { onStage });
  }

  onStage("credit.ledger_read");
  return lerSaldoCreditosSomenteLeitura({
    mode,
    workspaceId,
    usuario,
    readBalance
  });
}

module.exports = {
  lerSaldoCreditosSomenteLeitura,
  lerSaldoCreditosOperacional
};
