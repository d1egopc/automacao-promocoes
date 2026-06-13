function htmlDecode(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extrairMeta(html = "", property = "") {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );

  return htmlDecode(html.match(regex)?.[1] || "");
}

function extrairJsonLd(html = "") {
  const matches = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        const product = data.find((x) => x["@type"] === "Product");
        if (product) return product;
      }

      if (data["@type"] === "Product") return data;

      if (data["@graph"]) {
        const product = data["@graph"].find((x) => x["@type"] === "Product");
        if (product) return product;
      }
    } catch {}
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