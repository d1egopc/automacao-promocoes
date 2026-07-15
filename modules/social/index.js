const storage = require("./storage");
const criarRotasSocial = require("./routes");
const { logSocial } = require("./logs");
const { criarAdaptadorInstagram } = require("./instagram");
const { criarAdaptadorFacebook } = require("./facebook");
const { criarAdaptadorTelegramSocial } = require("./telegram");
const publicadorInstagram = require("./publicador-instagram.service");
const automaticoSocial = require("./automatico.service");
const schedulerSocial = require("./scheduler");

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
  schedulerSocial.iniciarSchedulerAgendamentosSocial();

  return {
    integracoes,
    storage
  };
}

module.exports = {
  ...storage,
  ...publicadorInstagram,
  ...automaticoSocial,
  ...schedulerSocial,
  criarRotasSocial,
  inicializarSocialModule
};
