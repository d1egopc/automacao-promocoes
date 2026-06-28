const {
  registrarAlertaIntegracao,
  limparAlertaIntegracao
} = require("../../utils/alertas-integracoes");

const {
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  limparPreco,
  corrigirImagemUrl
} = require("./utils");

function extrairValorMlHtml(html = "", campos = []) {
  for (const campo of campos) {
    const re = new RegExp(`"${campo}"\\s*:\\s*"([^"]{1,500})"`, "i");
    const valor = html.match(re)?.[1];
    if (valor) return htmlDecode(valor).trim();
  }

  return "";
}

function extrairPrecoMlHtml(html = "") {
  const candidatos = [
    html.match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"current_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"price_amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"fraction"\s*:\s*"?(\d{1,6})"?[^}]{0,180}"cents"\s*:"?(\d{1,2})"?/)?.slice(1, 3).join("."),
    html.match(/R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})/)?.[1]
  ].filter(Boolean);

  const bruto = candidatos.find(Boolean) || "";
  if (!bruto) return "";

  if (/^\d+\.\d{1,2}$/.test(String(bruto))) {
    return Number(bruto).toFixed(2).replace(".", ",");
  }

  return limparPreco(bruto);
}

async function importarMercadoLivre(url, clienteIdAlvo = "admin", deps = {}) {
  const {
    getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre
  } = deps;

  const integracaoML =
    getIntegracaoCliente(clienteIdAlvo, "mercadolivre");

  const cookies =
    integracaoML?.credenciais?.cookies || "";  
  
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

console.log("🧪 ML IMPORTADOR MANUAL", {
  clienteIdAlvo,
  temCookies: !!cookies,
  status: response.status,
  urlOriginal: url,
  urlFinal: response.url
});

if (
  response.status === 403 ||
  response.status === 429 ||
  response.url.includes("account-verification") ||
  response.url.includes("login")
) {
  registrarAlertaIntegracao(clienteIdAlvo, "mercadolivre", {
    tipo: "cookie_invalido",
    status: "atencao",
    mensagem: "Atualize os cookies do Mercado Livre para manter a captura de ofertas funcionando.",
    detalhes: {
      httpStatus: response.status,
      urlFinal: response.url
    }
  });

  return null;
}

  const html = await response.text();

  const jsonLd = extrairJsonLd(html);

  let titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    extrairValorMlHtml(html, ["poly_component_title", "name", "title"]) ||
    "Produto Mercado Livre";

  let preco =
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    extrairPrecoMlHtml(html) ||
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
let precoAntigo = "";

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
}


    const linkAfiliadoGerado =
  await gerarLinkAfiliadoMercadoLivre(
    url,
    getIntegracaoCliente(clienteIdAlvo, "mercadolivre"),
    { clienteId: clienteIdAlvo }
  );

  const tituloLimpo = htmlDecode(titulo)
    .replace(" | MercadoLivre", "")
    .replace(" | Mercado Livre", "")
    .trim();

  limparAlertaIntegracao(clienteIdAlvo, "mercadolivre");

  return {
    marketplace: "mercadolivre",
    titulo: tituloLimpo,
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    link: linkAfiliadoGerado || "",
    linkAfiliado: linkAfiliadoGerado || "",
    linkFinal: linkAfiliadoGerado || "",
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Mercado Livre"
  };
}

module.exports = {
  importarMercadoLivre
};
