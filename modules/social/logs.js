const { mascararSecrets } = require("../../utils/storage");

function logSocial(tag, payload = {}, logger = console) {
  const destino = logger && typeof logger.log === "function" ? logger : console;

  try {
    destino.log(tag, JSON.stringify(mascararSecrets(payload || {})));
  } catch (e) {
    destino.log("[SOCIAL-ERRO]", JSON.stringify({
      erro: e.message || "erro_log_social"
    }));
  }
}

function logErroSocial(payload = {}, logger = console) {
  logSocial("[SOCIAL-ERRO]", payload, logger);
}

module.exports = {
  logSocial,
  logErroSocial
};
