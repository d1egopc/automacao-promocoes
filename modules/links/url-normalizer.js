const { protocoloUrlPermitido } = require("./url-validator");

function textoLink(valor = "") {
  return String(valor || "").trim();
}

function normalizarDominioPublico(valor = "", { exigirProtocolo = false } = {}) {
  const texto = textoLink(valor);
  if (!texto) return "";
  if (exigirProtocolo && !/^https?:\/\//i.test(texto)) return "";

  const candidato = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(texto) ? texto : "https://" + texto;

  try {
    const url = new URL(candidato);
    if (!protocoloUrlPermitido(url.protocol) || !url.hostname) return "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

module.exports = {
  textoLink,
  normalizarDominioPublico
};
