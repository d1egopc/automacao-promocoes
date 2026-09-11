const mercadolivre = require("./mercadolivre");
const shopee = require("./shopee");
const amazon = require("./amazon");
const kabum = require("./kabum");
const aliexpress = require("./aliexpress");

const FONTES_PADRAO = Object.freeze([mercadolivre, shopee, amazon, kabum, aliexpress]);

function criarAgregadorFontes({ fontes = FONTES_PADRAO, agora = () => new Date() } = {}) {
  const cachePorFonte = new Map();

  async function consultarFonte(fonte) {
    const chave = fonte.marketplace;
    const instante = agora();
    const existente = cachePorFonte.get(chave);
    if (existente?.expiraEm > instante.getTime()) return existente.sinais;
    if (existente?.emAndamento) return existente.emAndamento;

    const emAndamento = Promise.resolve(fonte.detectarOportunidade({ agora: instante }))
      .then((sinal) => sinal?.ativo ? [sinal] : [])
      .catch(() => [])
      .then((sinais) => {
        cachePorFonte.set(chave, {
          sinais,
          expiraEm: instante.getTime() + fonte.ttlMs
        });
        return sinais;
      });
    cachePorFonte.set(chave, { sinais: [], expiraEm: 0, emAndamento });
    return emAndamento;
  }

  return {
    async listarSinais() {
      const resultados = await Promise.all(fontes.map((fonte) => consultarFonte(fonte)));
      return resultados.flat();
    }
  };
}

module.exports = {
  FONTES_PADRAO,
  criarAgregadorFontes
};
