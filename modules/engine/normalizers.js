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
  if (texto.includes("mercadolivre.com") || texto.includes("meli.la")) return "mercadolivre";
  if (texto.includes("shopee.")) return "shopee";
  if (texto.includes("amazon.") || texto.includes("amzn.to")) return "amazon";
  if (texto.includes("magazineluiza.com") || texto.includes("magalu.")) return "magalu";
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
