function protocoloUrlPermitido(protocol = "") {
  return protocol === "http:" || protocol === "https:";
}

function validarUrlHttpHttps(valor = "") {
  try {
    const url = new URL(String(valor || "").trim());
    return protocoloUrlPermitido(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  protocoloUrlPermitido,
  validarUrlHttpHttps
};
