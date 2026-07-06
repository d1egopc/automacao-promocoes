function texto(valor = "") {
  return String(valor || "").trim();
}

function decodificar(valor = "") {
  let atual = texto(valor)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/");

  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(atual); i += 1) {
    try {
      const proximo = decodeURIComponent(atual);
      if (proximo === atual) break;
      atual = proximo;
    } catch {
      break;
    }
  }

  return atual.trim();
}

function urlShopeeValida(url = "") {
  try {
    const parsed = new URL(texto(url));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return ["http:", "https:"].includes(parsed.protocol) && (host === "shopee.com.br" || host.endsWith(".shopee.com.br"));
  } catch {
    return false;
  }
}

function extrairUrlShopeeEmbutida(url = "") {
  try {
    const parsed = new URL(texto(url));
    const chaves = ["url", "redirect", "redirect_url", "target", "target_url", "deep_link", "deeplink"];
    for (const chave of chaves) {
      const candidata = decodificar(parsed.searchParams.get(chave) || "");
      if (urlShopeeValida(candidata)) return candidata;
    }
  } catch {}
  return "";
}

function canonicalizarUrlShopee(url = "") {
  let entrada = texto(url);
  if (entrada && !/^https?:\/\//i.test(entrada)) entrada = `https://${entrada}`;
  const embutida = extrairUrlShopeeEmbutida(entrada);
  if (embutida) entrada = embutida;

  try {
    const parsed = new URL(entrada);
    if (!urlShopeeValida(parsed.toString())) return texto(url);

    const remover = [
      "mobile", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "mmp_pid", "uls_trackid", "smtt", "sp_atk", "xptdk", "share_channel_code",
      "uls_trackid", "is_from_login", "stm_referrer"
    ];
    remover.forEach(chave => parsed.searchParams.delete(chave));
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return entrada;
  }
}

function extrairIdsShopee(url = "") {
  const valor = decodificar(url);
  const semQuery = valor.split("?")[0];
  const product = semQuery.match(/\/product\/(\d+)\/(\d+)/i);
  const opaanlp = semQuery.match(/\/opaanlp\/(\d+)\/(\d+)(?:\/|$)/i);
  const antigo = semQuery.match(/(?:-i\.|\/i\.)(\d+)\.(\d+)/i);

  if (product || opaanlp || antigo) {
    const match = product || opaanlp || antigo;
    return { shopId: match[1], itemId: match[2] };
  }

  try {
    const parsed = new URL(valor);
    return {
      shopId: parsed.searchParams.get("shopId") || parsed.searchParams.get("shop_id") || "",
      itemId: parsed.searchParams.get("itemId") || parsed.searchParams.get("item_id") || ""
    };
  } catch {
    return { shopId: "", itemId: "" };
  }
}

function tituloShopeeValido(titulo = "") {
  const valor = texto(titulo)
    .replace(/\s*\|\s*Shopee(?: Brasil)?\s*$/i, "")
    .trim();
  if (!valor || /^\d+$/.test(valor)) return false;
  if (/^(?:produto\s+shopee|error\s+page|shopee)$/i.test(valor)) return false;
  return valor.length >= 4;
}

function gerarKeywordShopee(url = "") {
  try {
    const semQuery = canonicalizarUrlShopee(url).split("?")[0];
    const parte = decodeURIComponent(semQuery.split("/").pop() || "");
    const antesDoId = parte.split("-i.")[0] || parte;
    const keyword = antesDoId
      .replace(/-/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return tituloShopeeValido(keyword) ? keyword : "";
  } catch {
    return "";
  }
}

function atributosHtml(tag = "") {
  const atributos = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(String(tag || ""))) !== null) {
    atributos[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return atributos;
}

function extrairMetaShopee(html = "", chave = "") {
  const alvo = texto(chave).toLowerCase();
  const metas = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const meta of metas) {
    const atributos = atributosHtml(meta);
    if (texto(atributos.property || atributos.name).toLowerCase() === alvo) return decodificar(atributos.content || "");
  }
  return "";
}

function encontrarProductJsonLd(valor, profundidade = 0) {
  if (!valor || profundidade > 8) return null;
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const product = encontrarProductJsonLd(item, profundidade + 1);
      if (product) return product;
    }
    return null;
  }
  if (typeof valor !== "object") return null;
  const tipos = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
  if (tipos.some(tipo => texto(tipo).toLowerCase() === "product")) return valor;
  for (const item of Object.values(valor)) {
    const product = encontrarProductJsonLd(item, profundidade + 1);
    if (product) return product;
  }
  return null;
}

function extrairJsonLdShopee(html = "") {
  const scripts = String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    try {
      const product = encontrarProductJsonLd(JSON.parse(script[1]));
      if (product) return product;
    } catch {}
  }
  return null;
}

function normalizarImagemShopee(valor = "") {
  const bruto = typeof valor === "object" && valor
    ? texto(valor.url || valor.contentUrl || valor.src || "")
    : texto(valor);
  if (!bruto) return "";
  let imagem = decodificar(bruto);
  if (imagem.startsWith("//")) imagem = `https:${imagem}`;
  try {
    const parsed = new URL(imagem);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function extrairDadosHtmlShopee(html = "") {
  const jsonLd = extrairJsonLdShopee(html);
  const imagemJsonLd = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
  const imagemOg = extrairMetaShopee(html, "og:image");
  const imagemTwitter = extrairMetaShopee(html, "twitter:image");
  const imagem = normalizarImagemShopee(imagemJsonLd || imagemOg || imagemTwitter);
  const offers = Array.isArray(jsonLd?.offers) ? jsonLd.offers[0] : jsonLd?.offers;

  return {
    titulo: texto(jsonLd?.name || extrairMetaShopee(html, "og:title") || extrairMetaShopee(html, "twitter:title")),
    preco: offers?.price || offers?.lowPrice || extrairMetaShopee(html, "product:price:amount") || "",
    imagem,
    origemImagem: imagemJsonLd ? "jsonLd.image" : imagemOg ? "og:image" : imagemTwitter ? "twitter:image" : "nenhuma",
    canonical: extrairMetaShopee(html, "og:url")
  };
}

module.exports = {
  canonicalizarUrlShopee,
  extrairDadosHtmlShopee,
  extrairIdsShopee,
  gerarKeywordShopee,
  tituloShopeeValido,
  urlShopeeValida
};
