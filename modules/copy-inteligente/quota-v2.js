const LIMITE_MINUTO_COPY_V2 = 20;
const LIMITE_DIA_COPY_V2 = 200;

const quotas = new Map();

function janelaMinuto(now = Date.now()) {
  return Math.floor(now / 60000);
}

function janelaDia(now = Date.now()) {
  return Math.floor(now / 86400000);
}

function consumirQuotaCopyV2(workspaceHash = "", opcoes = {}) {
  const workspace = String(workspaceHash || "");
  if (!workspace) return { ok: false, motivo: "workspace_invalido" };
  const now = Number(opcoes.nowMs) || Date.now();
  const limiteMinuto = Number(opcoes.limiteMinuto) || LIMITE_MINUTO_COPY_V2;
  const limiteDia = Number(opcoes.limiteDia) || LIMITE_DIA_COPY_V2;
  const atual = quotas.get(workspace) || { minuto: janelaMinuto(now), minutoCount: 0, dia: janelaDia(now), diaCount: 0 };

  if (atual.minuto !== janelaMinuto(now)) {
    atual.minuto = janelaMinuto(now);
    atual.minutoCount = 0;
  }
  if (atual.dia !== janelaDia(now)) {
    atual.dia = janelaDia(now);
    atual.diaCount = 0;
  }

  if (atual.minutoCount >= limiteMinuto || atual.diaCount >= limiteDia) {
    quotas.set(workspace, atual);
    return { ok: false, motivo: "quota_excedida" };
  }

  atual.minutoCount += 1;
  atual.diaCount += 1;
  quotas.set(workspace, atual);
  return { ok: true, motivo: "quota_ok" };
}

function limparQuotasCopyV2() {
  quotas.clear();
}

module.exports = {
  LIMITE_MINUTO_COPY_V2,
  LIMITE_DIA_COPY_V2,
  consumirQuotaCopyV2,
  limparQuotasCopyV2
};
