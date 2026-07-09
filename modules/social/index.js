const storage = require("./storage");
const criarRotasSocial = require("./routes");
const { logSocial } = require("./logs");
const { criarAdaptadorInstagram } = require("./instagram");
const { criarAdaptadorFacebook } = require("./facebook");
const { criarAdaptadorTelegramSocial } = require("./telegram");

function inicializarSocialModule(deps = {}) {
  const logger = deps.logger || console;
  const integracoes = {
    instagram: criarAdaptadorInstagram(),
    facebook: criarAdaptadorFacebook(),
    telegram: criarAdaptadorTelegramSocial()
  };

  logSocial("[SOCIAL-MODULE-INICIO]", {
    ativo: true,
    publicacaoAutomatica: false,
    integracoes
  }, logger);

  return {
    integracoes,
    storage
  };
}

module.exports = {
  ...storage,
  criarRotasSocial,
  inicializarSocialModule
};
