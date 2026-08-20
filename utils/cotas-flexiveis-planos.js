function numeroLimite(valor) {
  if (valor === "ilimitado") return Infinity;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function primeiroLimite(...valores) {
  for (const valor of valores) {
    const limite = numeroLimite(valor);
    if (limite !== null) return limite;
  }
  return null;
}

function normalizarListaMarketplaces(marketplaces = []) {
  if (Array.isArray(marketplaces)) {
    return marketplaces.map((item) => String(item || "").toLowerCase().trim()).filter(Boolean);
  }
  if (marketplaces && typeof marketplaces === "object") {
    return Object.entries(marketplaces)
      .filter(([, ativo]) => ativo === true)
      .map(([key]) => String(key || "").toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}

function normalizarLimitesPlano(plano = {}, usuario = {}) {
  const limitesPlano = plano?.limites || {};
  const limitesUsuario = usuario?.limites || {};
  const marketplacesLiberados = normalizarListaMarketplaces(plano?.marketplaces);
  const maxConexoes = primeiroLimite(
    limitesPlano.maxConexoes,
    limitesPlano.conexoes,
    limitesPlano.sessoes,
    limitesUsuario.maxConexoes,
    limitesUsuario.conexoes,
    limitesUsuario.sessoes
  );
  const maxMarketplacesSelecionados = primeiroLimite(
    limitesPlano.maxMarketplacesSelecionados,
    limitesPlano.marketplaces,
    limitesUsuario.maxMarketplacesSelecionados,
    limitesUsuario.marketplaces
  );

  return {
    ...limitesPlano,
    sessoes: maxConexoes ?? primeiroLimite(limitesPlano.sessoes, limitesUsuario.sessoes, 1) ?? 1,
    maxConexoes: maxConexoes ?? 1,
    maxMarketplacesSelecionados: maxMarketplacesSelecionados ?? marketplacesLiberados.length
  };
}

function dentroDoLimite(atual = 0, limite = 0) {
  if (limite === Infinity) return true;
  return Number(atual) <= Number(limite);
}

function limiteAtingido(atual = 0, limite = 0) {
  if (limite === Infinity) return false;
  return Number(atual) >= Number(limite);
}

function avaliarMarketplacePlano({ marketplace = "", liberados = [], selecionados = [], limite = 0 } = {}) {
  const mp = String(marketplace || "").toLowerCase().trim();
  const allowlist = normalizarListaMarketplaces(liberados);
  const atuais = normalizarListaMarketplaces(selecionados);
  if (!allowlist.includes(mp)) {
    return {
      ok: false,
      codigo: "recurso_nao_disponivel_no_plano",
      recurso: "marketplaces",
      atual: atuais.length,
      limite
    };
  }
  if (atuais.includes(mp)) {
    return { ok: true, existente: true, atual: atuais.length, limite };
  }
  if (limiteAtingido(atuais.length, limite)) {
    return {
      ok: false,
      codigo: "limite_do_plano_atingido",
      recurso: "marketplaces",
      atual: atuais.length,
      limite
    };
  }
  return { ok: true, existente: false, atual: atuais.length, limite };
}

module.exports = {
  numeroLimite,
  primeiroLimite,
  normalizarListaMarketplaces,
  normalizarLimitesPlano,
  dentroDoLimite,
  limiteAtingido,
  avaliarMarketplacePlano
};
