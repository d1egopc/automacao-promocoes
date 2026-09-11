const MARKETPLACES = Object.freeze({
  mercadolivre: {
    titulo: "Mercado Livre",
    hosts: [/^(?:[a-z0-9-]+\.)?mercadolivre\.com\.br$/i, /^meli\.la$/i]
  },
  amazon: {
    titulo: "Amazon",
    hosts: [/^(?:[a-z0-9-]+\.)?amazon\.com\.br$/i]
  },
  shopee: {
    titulo: "Shopee",
    hosts: [/^(?:[a-z0-9-]+\.)?shopee\.com\.br$/i]
  },
  aliexpress: {
    titulo: "AliExpress BR",
    hosts: [/^(?:[a-z0-9-]+\.)?aliexpress\.com$/i]
  },
  kabum_awin: {
    titulo: "KaBuM / AWIN",
    hosts: [/^(?:[a-z0-9-]+\.)?kabum\.com\.br$/i, /^(?:[a-z0-9-]+\.)?awin1\.com$/i]
  }
});
const { criarAgregadorFontes } = require("./oportunidades-fontes");
const agregadorFontesOficiais = criarAgregadorFontes();

const HOSTS_OPTIMUS = [/^www\.optimuspromo\.com\.br$/i, /^go\.optimuspromo\.com\.br$/i];

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function dataValidaFutura(valor, agora) {
  const data = new Date(valor);
  return Number.isFinite(data.getTime()) && data.getTime() > agora.getTime() ? data.toISOString() : "";
}

function urlDestinoAutorizada(valor, marketplace) {
  const configuracao = MARKETPLACES[marketplace];
  if (!configuracao) return "";

  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const hostsPermitidos = [...HOSTS_OPTIMUS, ...configuracao.hosts];
    return hostsPermitidos.some((host) => host.test(url.hostname)) ? url.toString() : "";
  } catch {
    return "";
  }
}

async function listarOportunidadesAtivas(clienteId, deps = {}) {
  const agora = deps.agora instanceof Date ? deps.agora : new Date();
  const fonte = typeof deps.listarSinais === "function"
    ? deps.listarSinais
    : () => agregadorFontesOficiais.listarSinais();
  const sinais = await fonte(clienteId, deps);
  const porMarketplace = new Map();

  for (const sinal of Array.isArray(sinais) ? sinais : []) {
    const marketplace = texto(sinal?.marketplace).toLowerCase();
    const definicao = MARKETPLACES[marketplace];
    const quantidade = Math.floor(Number(sinal?.quantidade || 0));
    const validoAte = dataValidaFutura(sinal?.validoAte, agora);
    const urlDestino = urlDestinoAutorizada(sinal?.urlDestino, marketplace);
    if (!definicao || quantidade <= 0 || !validoAte || !urlDestino) continue;

    const existente = porMarketplace.get(marketplace);
    if (existente) {
      existente.quantidade += quantidade;
      if (new Date(validoAte) > new Date(existente.validoAte)) existente.validoAte = validoAte;
      continue;
    }

    porMarketplace.set(marketplace, {
      marketplace,
      quantidade,
      titulo: definicao.titulo,
      mensagem: texto(sinal?.mensagem).slice(0, 140) || "Oportunidades disponíveis agora",
      urlDestino,
      validoAte
    });
  }

  return [...porMarketplace.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
}

module.exports = {
  MARKETPLACES,
  urlDestinoAutorizada,
  listarOportunidadesAtivas
};
