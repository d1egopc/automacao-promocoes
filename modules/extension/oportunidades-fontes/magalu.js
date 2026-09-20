const {
  buscarPaginaOficial,
  normalizarTexto
} = require("./pagina-oficial");

const TTL_MS = 5 * 60 * 1000;
const WORKER_TTL_MS = 10 * 60 * 1000;
const URL_DESTINO = "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/";
const HOSTS_PERMITIDOS = [/^(?:[a-z0-9-]+\.)?magazineluiza\.com\.br$/i];
const INDICADOR = "ofertas do dia";

function temChallenge(conteudo = "") {
  return /az-request-verify|captcha|challenge|akamai|robot|verifique que voce nao e um robo/i.test(normalizarTexto(conteudo));
}

function criarSinal(agora, expiraEmMaximo = null) {
  const expiraPadrao = agora.getTime() + TTL_MS;
  const limite = expiraEmMaximo instanceof Date && Number.isFinite(expiraEmMaximo.getTime())
    ? expiraEmMaximo.getTime()
    : expiraPadrao;
  const expiraEm = Math.min(expiraPadrao, limite);
  return {
    marketplace: "magalu",
    ativo: true,
    quantidade: 1,
    titulo: "Magalu",
    mensagem: "Ofertas do dia disponíveis agora",
    urlDestino: URL_DESTINO,
    validoAte: new Date(expiraEm).toISOString(),
    cacheExpiraEm: new Date(expiraEm).toISOString(),
    fonte: "pagina_oficial_magalu"
  };
}

function fonteIndisponivel(motivo = "fonte_indisponivel") {
  return { ativo: false, cachear: false, motivo };
}

async function fallbackLocalWorker(contexto, agora) {
  try {
    const recente = typeof contexto.obterOportunidadeMagaluRecente === "function"
      ? await contexto.obterOportunidadeMagaluRecente()
      : null;
    const resultado = recente?.resultado;
    if (resultado?.accessible === true && typeof resultado.indicatorFound === "boolean") {
      const checkedAtMs = Date.parse(String(resultado.checkedAt || ""));
      const expiraEm = Number.isFinite(checkedAtMs) ? new Date(checkedAtMs + WORKER_TTL_MS) : null;
      if (!expiraEm || expiraEm.getTime() <= agora.getTime()) {
        if (typeof contexto.garantirOportunidadeMagalu === "function") await contexto.garantirOportunidadeMagalu();
        return fonteIndisponivel("resultado_local_worker_stale");
      }
      if (resultado.indicatorFound) return criarSinal(agora, expiraEm);
      return { ativo: false, cachear: true, cacheExpiraEm: expiraEm.toISOString() };
    }
    if (typeof contexto.garantirOportunidadeMagalu === "function") {
      await contexto.garantirOportunidadeMagalu();
    }
    return fonteIndisponivel();
  } catch {
    return fonteIndisponivel("fallback_local_worker_indisponivel");
  }
}

async function detectarOportunidade(contexto = {}) {
  const agora = contexto.agora instanceof Date ? contexto.agora : new Date();
  const buscarPagina = typeof contexto.buscarPagina === "function" ? contexto.buscarPagina : buscarPaginaOficial;
  try {
    const conteudo = await buscarPagina(URL_DESTINO, { hostsPermitidos: HOSTS_PERMITIDOS });
    if (temChallenge(conteudo)) return fallbackLocalWorker(contexto, agora);
    return normalizarTexto(conteudo).includes(INDICADOR) ? criarSinal(agora) : null;
  } catch {
    return fallbackLocalWorker(contexto, agora);
  }
}

module.exports = {
  marketplace: "magalu",
  ttlMs: TTL_MS,
  detectarOportunidade,
  temChallenge,
  URL_DESTINO,
  INDICADOR
};
