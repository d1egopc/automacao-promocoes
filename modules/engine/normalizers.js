function normalizarTexto(valor = "") {
  return String(valor || "").trim();
}

function normalizarOrigemTipo(valor = "") {
  const texto = normalizarTexto(valor).toLowerCase();
  if (texto.includes("telegram")) return "telegram";
  if (texto.includes("whatsapp")) return "whatsapp";
  return texto || "desconhecida";
}

function normalizarLinksExtraidos(links = []) {
  const lista = Array.isArray(links) ? links : [links].filter(Boolean);
  return [...new Set(
    lista
      .map(link => normalizarTexto(link))
      .filter(Boolean)
  )];
}

function detectarMarketplaceLink(url = "") {
  const texto = normalizarTexto(url).toLowerCase();
  if (!texto) return "";
  try {
    const host = new URL(texto).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "meli.la" || host.endsWith(".meli.la") || host === "mercadolivre.com" || host.endsWith(".mercadolivre.com") || host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br")) return "mercadolivre";
    if (host === "shopee.com.br" || host.endsWith(".shopee.com.br") || host.includes("shopee.")) return "shopee";
    if (host === "amzn.divulgador.link" || host.endsWith(".amzn.divulgador.link")) return "amazon";
    if (host === "amazon.com.br" || host.endsWith(".amazon.com.br") || host === "amzn.to" || host.endsWith(".amzn.to") || host.includes("amazon.")) return "amazon";
    if (host.includes("aliexpress.")) return "aliexpress";
    if (host === "kabum.com.br" || host.endsWith(".kabum.com.br")) return "kabum";
    if (host === "awin1.com" || host.endsWith(".awin1.com") || host === "awin.com" || host.endsWith(".awin.com")) return "awin";
    if (host === "magazineluiza.com" || host.endsWith(".magazineluiza.com") || host === "magazineluiza.com.br" || host.endsWith(".magazineluiza.com.br") || host === "magazinevoce.com.br" || host.endsWith(".magazinevoce.com.br") || host === "magalu.com" || host.endsWith(".magalu.com") || host === "magazineluiza.onelink.me") return "magalu";
  } catch {}

  if (texto.includes("mercadolivre.com") || texto.includes("meli.la")) return "mercadolivre";
  if (texto.includes("shopee.")) return "shopee";
  if (texto.includes("amzn.divulgador.link")) return "amazon";
  if (texto.includes("amazon.") || texto.includes("amzn.to")) return "amazon";
  if (texto.includes("magazineluiza.com") || texto.includes("magazinevoce.com.br") || texto.includes("magazineluiza.onelink.me") || texto.includes("magalu.")) return "magalu";
  if (texto.includes("aliexpress.")) return "aliexpress";
  if (texto.includes("kabum.com.br")) return "kabum";
  if (texto.includes("awin1.com") || texto.includes("awin.com")) return "awin";
  return "";
}

function normalizarUrl(url = "") {
  const texto = normalizarTexto(url);
  if (!texto) return "";

  try {
    const parsed = new URL(texto);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return texto;
  }
}

function normalizarEventoBruto(evento = {}) {
  const linksExtraidos = normalizarLinksExtraidos(evento.linksExtraidos || evento.links_extraidos || evento.links || []);

  return {
    origem: normalizarTexto(evento.origem || "radar"),
    origemTipo: normalizarOrigemTipo(evento.origemTipo || evento.origem_tipo || ""),
    sessaoId: normalizarTexto(evento.sessaoId || evento.sessao_id || ""),
    grupoId: normalizarTexto(evento.grupoId || evento.grupo_id || ""),
    grupoNome: normalizarTexto(evento.grupoNome || evento.grupo_nome || ""),
    textoOriginal: normalizarTexto(evento.textoOriginal || evento.texto_original || evento.texto || ""),
    linksExtraidos,
    capturadoEm: evento.capturadoEm || evento.capturado_em || new Date()
  };
}

module.exports = {
  normalizarTexto,
  normalizarOrigemTipo,
  normalizarLinksExtraidos,
  detectarMarketplaceLink,
  normalizarUrl,
  normalizarEventoBruto
};
