const axios = require("axios");

const TIMEOUT_MS = 8_000;
const TAMANHO_MAXIMO_HTML = 2 * 1024 * 1024;

function normalizarTexto(html = "") {
  return String(html)
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

function hostPermitido(url, hostsPermitidos = []) {
  try {
    const destino = new URL(url);
    return destino.protocol === "https:" && !destino.username && !destino.password && !destino.port
      && hostsPermitidos.some((host) => host.test(destino.hostname));
  } catch {
    return false;
  }
}

async function buscarPaginaOficial(url, { hostsPermitidos = [], httpClient = axios } = {}) {
  if (!hostPermitido(url, hostsPermitidos)) throw new Error("fonte_oficial_nao_autorizada");

  const resposta = await httpClient.get(url, {
    timeout: TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: TAMANHO_MAXIMO_HTML,
    responseType: "text",
    headers: {
      "user-agent": "OptimusOportunidades/1.0 (+https://www.optimuspromo.com.br)",
      "accept-language": "pt-BR,pt;q=0.9"
    },
    validateStatus: (status) => status === 200
  });

  return String(resposta.data || "");
}

function criarDetectorPagina({ marketplace, titulo, mensagem, urlDestino, hostsPermitidos, indicadores = [], ttlMs }) {
  return async function detectarOportunidade({ buscarPagina = buscarPaginaOficial, agora = new Date() } = {}) {
    try {
      const conteudo = normalizarTexto(await buscarPagina(urlDestino, { hostsPermitidos }));
      if (!indicadores.every((indicador) => conteudo.includes(String(indicador).toLocaleLowerCase("pt-BR")))) return null;

      return {
        marketplace,
        ativo: true,
        quantidade: 1,
        titulo,
        mensagem,
        urlDestino,
        validoAte: new Date(agora.getTime() + ttlMs).toISOString(),
        fonte: `pagina_oficial_${marketplace}`
      };
    } catch {
      return null;
    }
  };
}

module.exports = {
  buscarPaginaOficial,
  criarDetectorPagina,
  hostPermitido,
  normalizarTexto
};
