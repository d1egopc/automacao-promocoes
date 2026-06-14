const crypto = require("crypto");

function timestampGMT8() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function assinar(params, secret) {
  const keys = Object.keys(params).sort();
  let base = secret;

  for (const key of keys) {
    if (key !== "sign") base += key + params[key];
  }

  base += secret;

  return crypto
    .createHash("md5")
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function buscarProdutosAliExpressAPI(termo, credenciais = {}, opcoes = {}) {
  const appKey = credenciais.appKey || "";
  const secret = credenciais.secret || "";
  const trackingId = credenciais.trackingId || "";

  if (!appKey || !secret || !trackingId) {
    throw new Error("Credenciais AliExpress incompletas");
  }

  const params = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    timestamp: timestampGMT8(),
    sign_method: "md5",
    format: "json",
    v: "2.0",
    keywords: termo,
    target_currency: "BRL",
    target_language: "PT",
    ship_to_country: "BR",
    tracking_id: trackingId,
    page_no: opcoes.page || 1,
    page_size: opcoes.limit || 20
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

  console.log("[INFO] ALI API QUERY:", JSON.stringify(data).slice(0, 1000));

  if (data?.error_response) {
    throw new Error(
      `${data.error_response.code || "ALI_API"}: ${data.error_response.msg || "Erro API AliExpress"}`
    );
  }

  const result =
    data?.aliexpress_affiliate_product_query_response?.resp_result?.result ||
    data?.resp_result?.result ||
    data?.result ||
    {};

  const produtos =
    result?.products?.product ||
    result?.products ||
    result?.product ||
    [];

  return Array.isArray(produtos) ? produtos : [];
}

async function gerarLinkCurtoAliExpress(
  linkLongo,
  credenciais = {}
) {

  const appKey =
    credenciais.appKey || "";

  const secret =
    credenciais.secret || "";

  const trackingId =
    credenciais.trackingId || "";

  if (
    !appKey ||
    !secret ||
    !trackingId
  ) {
    return linkLongo;
  }

  try {

    const params = {
      method:
        "aliexpress.affiliate.link.generate",

      app_key: appKey,

      timestamp: timestampGMT8(),

      sign_method: "md5",

      format: "json",

      v: "2.0",

      promotion_link_type: 0,

      source_values: linkLongo,

      tracking_id: trackingId
    };

    params.sign =
      assinar(params, secret);

    const response = await fetch(
      "https://api-sg.aliexpress.com/sync",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=utf-8"
        },
        body:
          new URLSearchParams(params)
      }
    );

    const data =
      await response.json();

    console.log(
      "🔗 ALI SHORT RESPONSE:",
      JSON.stringify(data).slice(0, 1000)
    );

    const result =
      data?.
      aliexpress_affiliate_link_generate_response?.
      resp_result?.
      result;

    const linkCurto =
      result?.
      promotion_links?.
      promotion_link?.[0]?.
      promotion_link ||
      result?.
      promotion_link ||
      "";

    return (
      linkCurto ||
      linkLongo
    );

  } catch (e) {

    console.log(
      "⚠️ erro gerar link curto Ali:",
      e.message
    );

    return linkLongo;
  }
}

module.exports = {
  buscarProdutosAliExpressAPI,
  gerarLinkCurtoAliExpress
};