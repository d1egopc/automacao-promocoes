const crypto = require("crypto");

// ================= IMPORTADOR API ALIEXPRESS =================

async function importarAliExpress(urlEntrada, config = {}) {
  try {
    if (urlEntrada && !urlEntrada.startsWith("http")) {
      urlEntrada = "https://" + urlEntrada;
    }

    const ehBrasil =
      String(urlEntrada).includes("ship_from%22%3A%22BR") ||
      String(urlEntrada).includes('"ship_from":"BR"') ||
      String(urlEntrada).includes("%22ship_from%22%3A%22BR%22");

    const productId =
      String(urlEntrada).match(/\/item\/(\d+)\.html/i)?.[1] ||
      String(urlEntrada).match(/[?&]productId=(\d+)/i)?.[1];

    if (!productId) {
      throw new Error("Product ID não encontrado no link AliExpress");
    }

    const credenciais = config?.credenciais || config || {};
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId) {
      throw new Error("Credenciais AliExpress incompletas");
    }

    const params = {
      method: "aliexpress.affiliate.productdetail.get",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      product_ids: productId,
      target_currency: "BRL",
      target_language: "PT",
      ship_to_country: "BR",
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: new URLSearchParams(params)
    });

    const data = await response.json();

    console.log("ALIEXPRESS API RESPONSE:", JSON.stringify(data));

    const result =
      data?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result ||
      data?.resp_result?.result ||
      data?.result ||
      {};

    const produto =
      result?.products?.product?.[0] ||
      result?.products?.[0] ||
      result?.product?.[0] ||
      result?.product ||
      {};

    const avisoCupom = ehBrasil
      ? "🇧🇷 Produto no Brasil. Confira cupom ou desconto com moedas na página."
      : "🌍 Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na página.";

    if (!produto || Object.keys(produto).length === 0) {
      return {
        marketplace: "aliexpress",
        titulo: "Produto AliExpress",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: urlEntrada,
        linkAfiliado: urlEntrada,
        imagem: "",
        categoria: "AliExpress",
        avisoCupom,
        aviso: "AliExpress não retornou dados pela API."
      };
    }

    let titulo =
      produto.product_title ||
      produto.title ||
      produto.productTitle ||
      "Produto AliExpress";

    let imagem =
      produto.product_main_image_url ||
      produto.product_small_image_urls?.string?.[0] ||
      produto.product_small_image_urls?.[0] ||
      produto.image_url ||
      "";

    let precoAtual =
      produto.target_sale_price ||
      produto.sale_price ||
      produto.target_app_sale_price ||
      produto.app_sale_price ||
      produto.target_min_sale_price ||
      produto.min_sale_price ||
      "";

    let precoAntigo =
      produto.target_original_price ||
      produto.original_price ||
      "";

    precoAtual = limparPreco(precoAtual);
    precoAntigo = limparPreco(precoAntigo);

    if (precoAntigo === precoAtual) {
      precoAntigo = "";
    }

    let linkAfiliado =
      produto.promotion_link ||
      produto.promotion_link_short ||
      produto.product_detail_url ||
      produto.product_url ||
      urlEntrada;

    if (String(linkAfiliado).includes("s.click.aliexpress.com/s/")) {
      const match = String(linkAfiliado).match(
        /https:\/\/s\.click\.aliexpress\.com\/e\/_[a-zA-Z0-9]+/i
      );

      if (match?.[0]) {
        linkAfiliado = match[0];
      }
    }

    return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo),
      precoAntigo,
      precoAtual,
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado,
      imagem: corrigirImagemUrl(imagem),
      categoria:
        produto.first_level_category_name ||
        produto.second_level_category_name ||
        "AliExpress",
      categoriaProduto:
        produto.first_level_category_name ||
        produto.second_level_category_name ||
        "AliExpress",
      avisoCupom,
      aviso: !imagem || titulo === "Produto AliExpress"
        ? "Dados parciais retornados pela API AliExpress."
        : ""
    };

  } catch (e) {
    console.log("❌ ERRO IMPORTAR ALIEXPRESS:", e.message);

    return {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar API AliExpress"
    };
  }
}

function timestampGMT8() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function assinar(params, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let base = appSecret;

  for (const key of sortedKeys) {
    if (key === "sign") continue;
    base += key + params[key];
  }

  base += appSecret;

  return crypto
    .createHash("md5")
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

function limparPreco(valor) {
  if (!valor) return "";

  return String(valor)
    .replace("R$", "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim();
}

function htmlDecode(str = "") {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function corrigirImagemUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

module.exports = {
  importarAliExpress
};