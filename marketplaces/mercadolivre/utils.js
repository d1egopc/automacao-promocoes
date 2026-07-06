function htmlDecode(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extrairMeta(html = "", property = "") {
  const alvo = String(property || "").trim().toLowerCase();
  if (!alvo) return "";

  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const atributos = {};
    const regexAtributo = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match;

    while ((match = regexAtributo.exec(tag)) !== null) {
      atributos[match[1].toLowerCase()] = match[3];
    }

    const chave = String(atributos.property || atributos.name || "").trim().toLowerCase();
    if (chave === alvo && atributos.content) return htmlDecode(atributos.content).trim();
  }

  return "";
}

function extrairJsonLd(html = "") {
  const matches = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      const product = encontrarProdutoJsonLd(data);
      if (product) return product;
    } catch {}
  }

  return null;
}

function encontrarProdutoJsonLd(valor, profundidade = 0) {
  if (!valor || profundidade > 8) return null;
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const product = encontrarProdutoJsonLd(item, profundidade + 1);
      if (product) return product;
    }
    return null;
  }
  if (typeof valor !== "object") return null;

  const tipos = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
  if (tipos.some(tipo => String(tipo || "").toLowerCase() === "product")) return valor;

  for (const item of Object.values(valor)) {
    const product = encontrarProdutoJsonLd(item, profundidade + 1);
    if (product) return product;
  }

  return null;
}

function limparPreco(valor = "") {
  return String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
}


function corrigirImagemUrl(url = "") {
  if (!url) return "";

  return String(url)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace("&amp;", "&");
}

module.exports = {
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  limparPreco,
  corrigirImagemUrl
};
