const radarCupons = {
  ml: { confirmados: 0, avisos: 0 },
  shopee: { confirmados: 0, avisos: 0 },
  amazon: { confirmados: 0, avisos: 0 }
};

function normalizarMarketplace(marketplace = "") {
  const nome = String(marketplace || "").toLowerCase().trim();

  if (nome === "ml" || nome === "mercadolivre" || nome === "mercado_livre") return "ml";
  if (nome === "shopee") return "shopee";
  if (nome === "amazon") return "amazon";

  return "";
}

function obterRadarCupons() {
  return {
    ml: { ...radarCupons.ml },
    shopee: { ...radarCupons.shopee },
    amazon: { ...radarCupons.amazon }
  };
}

function logarRadarCupons() {
  console.log("[CUPONS-RADAR]", obterRadarCupons());
}

function registrarRadarCupons(marketplace, dados = {}) {
  const chave = normalizarMarketplace(marketplace);

  if (!chave || !radarCupons[chave]) return obterRadarCupons();

  const confirmados = Number(dados.confirmados || 0);
  const avisos = Number(dados.avisos || 0);

  if (Number.isFinite(confirmados) && confirmados > 0) {
    radarCupons[chave].confirmados += confirmados;
  }

  if (Number.isFinite(avisos) && avisos > 0) {
    radarCupons[chave].avisos += avisos;
  }

  logarRadarCupons();
  return obterRadarCupons();
}

module.exports = {
  registrarRadarCupons,
  obterRadarCupons,
  logarRadarCupons
};

