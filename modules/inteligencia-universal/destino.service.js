const { texto, normalizarMarketplace } = require("./normalizacao.service");

function destinoAtivo(destino = {}) {
  return destino.ativo !== false && destino.status !== "inativo";
}

function listaIncluiNormalizado(lista = [], valor = "") {
  const alvo = normalizarMarketplace(valor) || texto(valor).toLowerCase();
  if (!alvo) return true;
  return lista.map(item => normalizarMarketplace(item) || texto(item).toLowerCase()).includes(alvo);
}

function destinoCompativel(ofertaUniversal = {}, destino = {}) {
  if (!destinoAtivo(destino)) return { ok: false, motivo: "destino_inativo" };

  const marketplaces = Array.isArray(destino.marketplaces) ? destino.marketplaces : [];
  if (marketplaces.length && !listaIncluiNormalizado(marketplaces, ofertaUniversal.marketplace)) {
    return { ok: false, motivo: "marketplace_bloqueado" };
  }

  const categorias = Array.isArray(destino.categorias) ? destino.categorias : [];
  if (categorias.length) {
    const categoria = texto(ofertaUniversal.categoria).toLowerCase();
    const permitido = categorias.map(c => texto(c).toLowerCase()).includes(categoria);
    if (!permitido) return { ok: false, motivo: "categoria_bloqueada" };
  }

  return { ok: true, motivo: "destino_compativel" };
}

function avaliarDestinoUniversal(ofertaUniversal = {}, contexto = {}) {
  const destinos = Array.isArray(contexto.destinos) ? contexto.destinos : [];
  const compativeis = [];
  const rejeitados = [];

  for (const destino of destinos) {
    const avaliacao = destinoCompativel(ofertaUniversal, destino);
    if (avaliacao.ok) compativeis.push(destino);
    else rejeitados.push({ destino, motivo: avaliacao.motivo });
  }

  const ok = destinos.length === 0 ? true : compativeis.length > 0;
  const motivo = ok ? "destino_ok" : "sem_destino_compativel";

  return {
    ok,
    motivo,
    compativeis,
    rejeitados,
    logs: [{ etapa: "destino", status: ok ? "ok" : "retida", motivo, totalCompativeis: compativeis.length }]
  };
}

module.exports = {
  avaliarDestinoUniversal,
  destinoCompativel
};
