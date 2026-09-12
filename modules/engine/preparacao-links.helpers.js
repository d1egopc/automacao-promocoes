"use strict";

// Helpers puros compartilhados pela deteccao de entrada e pelo importador.
// Eles nao expandem URL nem chamam rede; a politica de resolver continua
// pertencendo a cada origem.
function normalizarHostAmazon(url = "") {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ehShortlinkAmazonExterno(url = "") {
  const host = normalizarHostAmazon(url);
  return host === "amzn.to" ||
    host.endsWith(".amzn.to") ||
    host === "amzlink.to" ||
    host.endsWith(".amzlink.to") ||
    host === "link.amazon" ||
    host.endsWith(".link.amazon") ||
    host === "amzn.divulgador.link" ||
    host.endsWith(".amzn.divulgador.link");
}

function ehUrlAmazonDireta(url = "") {
  const host = normalizarHostAmazon(url);
  return host === "amazon.com.br" || host.endsWith(".amazon.com.br") || host.includes("amazon.");
}

function extrairAsinAmazonUrl(url = "") {
  try {
    const u = new URL(String(url || "").trim());
    return (
      u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1] ||
      ""
    ).toUpperCase();
  } catch {
    return "";
  }
}

function extrairUrlAmazonAninhada(url = "") {
  try {
    const u = new URL(String(url || "").trim());
    const chaves = ["btn_url", "url", "u", "target", "redirect", "destination", "dest", "link"];
    for (const chave of chaves) {
      const valor = u.searchParams.get(chave);
      if (!valor) continue;
      let decodificado = valor;
      for (let tentativa = 0; tentativa < 3 && /%[0-9a-f]{2}/i.test(decodificado); tentativa += 1) {
        try {
          const proximo = decodeURIComponent(decodificado);
          if (proximo === decodificado) break;
          decodificado = proximo;
        } catch {
          break;
        }
      }
      if (ehUrlAmazonDireta(decodificado) && extrairAsinAmazonUrl(decodificado)) return decodificado;
    }
  } catch {}
  return "";
}

function urlAmazonDiretaComAsin(url = "") {
  if (ehUrlAmazonDireta(url) && extrairAsinAmazonUrl(url)) return String(url || "").trim();
  return extrairUrlAmazonAninhada(url);
}

function hostAmazonReconhecido(host = "") {
  const normalizado = String(host || "").trim().toLowerCase().replace(/^www\./, "");
  return normalizado === "amzn.divulgador.link" ||
    normalizado.endsWith(".amzn.divulgador.link") ||
    normalizado === "amazon.com.br" ||
    normalizado.endsWith(".amazon.com.br") ||
    normalizado === "amzn.to" ||
    normalizado.endsWith(".amzn.to") ||
    normalizado === "amzlink.to" ||
    normalizado.endsWith(".amzlink.to") ||
    normalizado === "link.amazon" ||
    normalizado.endsWith(".link.amazon") ||
    normalizado.includes("amazon.");
}

module.exports = {
  ehShortlinkAmazonExterno,
  ehUrlAmazonDireta,
  extrairAsinAmazonUrl,
  extrairUrlAmazonAninhada,
  hostAmazonReconhecido,
  normalizarHostAmazon,
  urlAmazonDiretaComAsin
};
