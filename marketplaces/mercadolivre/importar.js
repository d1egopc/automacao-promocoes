const {
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  limparPreco,
  corrigirImagemUrl
} = require("./utils");

async function importarMercadoLivre(url, clienteIdAlvo = "admin", deps = {}) {
  const {
    getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre
  } = deps;

  const integracaoML =
    getIntegracaoCliente(clienteIdAlvo, "mercadolivre");

  const cookies =
    integracaoML?.credenciais?.cookies || "";  
  
console.log("ðŸŒ ML URL:", url);

  const response = await fetch(url, {
  method: "GET",
  redirect: "follow",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",

    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",

    "Accept-Language":
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

    "Cache-Control": "no-cache",

    "Pragma": "no-cache",

    "Upgrade-Insecure-Requests": "1",

    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",

"Sec-Fetch-User": "?1",
"Referer": "https://www.google.com/",
...(cookies ? { Cookie: cookies } : {})
  }
});

console.log("ðŸª ML cookies importador:", cookies ? "SIM" : "NÃƒO");

console.log("ðŸŒ URL FINAL:", response.url);

if (response.url.includes("account-verification")) {
  console.log("ðŸ›¡ï¸ ML ACCOUNT VERIFICATION DETECTADO");
  return null;
}

  const html = await response.text();

console.log(
  "ðŸ§ª HTML TEM UI-PDP:",
  html.includes("ui-pdp")
);

console.log(
  "ðŸ§ª HTML TEM AFFILIATES-SITE:",
  html.includes("affiliates-site")
);

console.log(
  "ðŸ§ª HTML TEM CUPOM:",
  html.toLowerCase().includes("cupom")
);

console.log(
  "ðŸ§ª HTML TEM COUPON:",
  html.toLowerCase().includes("coupon")
);

console.log(
  "ðŸ§ª HTML TEM PROMOTION:",
  html.toLowerCase().includes("promotion")
);

console.log(
  "ðŸ§ª HTML TEM DISCOUNT:",
  html.toLowerCase().includes("discount")
);

  const jsonLd = extrairJsonLd(html);

  const titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    "Produto Mercado Livre";

  let preco =
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    "";

  const imagem =
    (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
    extrairMeta(html, "og:image") ||
    extrairMeta(html, "twitter:image") ||
    "";

 preco = limparPreco(preco);

 // CorreÃ§Ã£o ML: jsonLd Ã s vezes vem como 48.9 e limparPreco vira 489
 if (
  jsonLd?.offers?.price !== undefined &&
  String(jsonLd.offers.price).includes(".") &&
  !String(jsonLd.offers.price).includes(",")
) {
  preco = Number(jsonLd.offers.price)
    .toFixed(2)
    .replace(".", ",");
}

let precoNumero = Number(String(preco).replace(",", "."));

  console.log("ðŸ§ª PREÃ‡O ML:", {
  original: jsonLd?.offers?.price,
  depoisLimpar: preco
  });
  
  const descontoMatch =
  html.match(/(\d{1,2})\s*%\s*OFF/i) ||
  html.match(/"discount_rate"\s*:\s*(\d{1,2})/i) ||
  html.match(/"discountPercentage"\s*:\s*(\d{1,2})/i) ||
  html.match(/(\d{1,2})\s*%\s*de desconto/i);
const descontoReal = descontoMatch ? Number(descontoMatch[1]) : 0;

if (
  Number.isFinite(precoNumero) &&
  precoNumero > 0 &&
  descontoReal > 0 &&
  descontoReal < 90
) {
  precoAntigo = (precoNumero / (1 - descontoReal / 100))
    .toFixed(2)
    .replace(".", ",");

  console.log("ðŸ·ï¸ Desconto real ML detectado:", descontoReal + "%");
}


    const linkAfiliadoGerado =
  await gerarLinkAfiliadoMercadoLivre(
    url,
    getIntegracaoCliente(clienteIdAlvo, "mercadolivre")
  );

  return {
    marketplace: "mercadolivre",
    titulo: htmlDecode(titulo).replace(" | MercadoLivre", "").replace(" | Mercado Livre", ""),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: linkAfiliadoGerado || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Mercado Livre"
  };
}

module.exports = {
  importarMercadoLivre
};
