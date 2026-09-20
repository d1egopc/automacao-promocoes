const mercadolivre = require("./mercadolivre");
const shopee = require("./shopee");
const amazon = require("./amazon");
const kabum = require("./kabum");
const aliexpress = require("./aliexpress");
const magalu = require("./magalu");

const FONTES_PADRAO = Object.freeze([mercadolivre, shopee, amazon, kabum, aliexpress, magalu]);

function criarAgregadorFontes({ fontes = FONTES_PADRAO, agora = () => new Date() } = {}) {
  const cachePorFonte = new Map();
  const versaoPorFonte = new Map();

  function invalidarFonte(chave) {
    const id = String(chave || "").trim();
    if (!id) return false;
    versaoPorFonte.set(id, Number(versaoPorFonte.get(id) || 0) + 1);
    return cachePorFonte.delete(id);
  }

  async function consultarFonte(fonte, contexto) {
    const chave = typeof fonte.cacheKey === "function"
      ? fonte.cacheKey(contexto) || fonte.marketplace
      : fonte.marketplace;
    const instante = agora();
    const existente = cachePorFonte.get(chave);
    if (existente?.expiraEm > instante.getTime()) return existente.sinais;
    if (existente?.emAndamento) return existente.emAndamento;
    const versaoConsulta = Number(versaoPorFonte.get(chave) || 0);

    const emAndamento = Promise.resolve(fonte.detectarOportunidade({ ...contexto, agora: instante }))
      .then((sinal) => ({ sinais: sinal?.ativo ? [sinal] : [], cachear: sinal?.cachear !== false, cacheExpiraEm: sinal?.cacheExpiraEm }))
      .catch(() => ({ sinais: [], cachear: true }))
      .then(({ sinais, cachear, cacheExpiraEm }) => {
        const invalidadaDuranteConsulta = Number(versaoPorFonte.get(chave) || 0) !== versaoConsulta;
        if (cachear && !invalidadaDuranteConsulta) {
          const expiraEmEspecifico = Date.parse(String(cacheExpiraEm || ""));
          cachePorFonte.set(chave, {
            sinais,
            expiraEm: Number.isFinite(expiraEmEspecifico)
              ? Math.min(instante.getTime() + fonte.ttlMs, expiraEmEspecifico)
              : instante.getTime() + fonte.ttlMs
          });
        } else if (!invalidadaDuranteConsulta) {
          cachePorFonte.delete(chave);
        }
        return sinais;
      });
    cachePorFonte.set(chave, { sinais: [], expiraEm: 0, emAndamento });
    return emAndamento;
  }

  return {
    invalidarFonte,
    async listarSinais(clienteId, deps = {}) {
      const contexto = { ...deps, clienteId };
      const resultados = await Promise.all(fontes.map((fonte) => consultarFonte(fonte, contexto)));
      return resultados.flat();
    }
  };
}

module.exports = {
  FONTES_PADRAO,
  criarAgregadorFontes
};
