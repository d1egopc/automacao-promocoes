function linhaAuxiliarCanal(linha = "") {
  const valor = String(linha || "").trim().replace(/^[^\p{L}\p{N}@]+/u, "").trim();
  return /^(?:mais\s+grupos?\s+de\s+ofertas?\s+e\s+cupons?|entre\s+(?:no|em\s+um)\s+grupo\s+de\s+cupons?|convide\s+um\s+amigo|link\s+geral\s+(?:de\s+)?todas?\s+as\s+redes|whatsapp\s+do\s+grupo|telegram\s+do\s+canal|canal\s+@|grupo\s+@|linktree|site\s+do\s+canal|siga\s+(?:nosso|o)\s+canal|an[uú]ncio|publicidade)\b/i.test(valor) ||
    /^site\s*:\s*(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?\s*$/i.test(valor);
}

function urlAuxiliarCanal(url = "") {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, "");
    return host === "chat.whatsapp.com" || host === "linktr.ee" ||
      host === "t.me" || host === "telegram.me" || host === "telegram.dog" ||
      host === "whatsapp.com";
  } catch {
    return false;
  }
}

function urlAuxiliarNoTexto(url = "", texto = "") {
  if (urlAuxiliarCanal(url)) return true;
  const linhas = String(texto || "").split(/\r?\n/);
  return linhas.some((linha, indice) => linha.includes(url) &&
    (linhaAuxiliarCanal(linha) || linhaAuxiliarCanal(linhas[indice - 1] || "")));
}

function textoComercialSemRodape(texto = "") {
  let linhaAnteriorAuxiliar = false;
  return String(texto || "").split(/\r?\n/).filter(linha => {
    const auxiliar = linhaAuxiliarCanal(linha);
    const apenasLinkOuHandle = /^\s*(?:https?:\/\/|www\.|@)[^\s]+\s*$/i.test(linha) ||
      /^\s*[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?\s*$/i.test(linha);
    const descartar = auxiliar || (linhaAnteriorAuxiliar && apenasLinkOuHandle) ||
      /^\s*(?:https?:\/\/|www\.)[^\s]+\s*$/i.test(linha) && urlAuxiliarCanal(linha.trim());
    if (linha.trim()) linhaAnteriorAuxiliar = auxiliar;
    return !descartar;
  }).join("\n");
}

module.exports = { linhaAuxiliarCanal, urlAuxiliarCanal, urlAuxiliarNoTexto, textoComercialSemRodape };
