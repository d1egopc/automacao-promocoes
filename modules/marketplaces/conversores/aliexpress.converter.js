function criarGerarLinkAliExpress({
  fetch: fetchImpl = global.fetch,
  timestampGMT8,
  assinar
} = {}) {
  return async function gerarLinkCurtoAliExpress(urlOriginal, credenciais = {}) {
    try {
      const appKey = credenciais.appKey || "";
      const secret = credenciais.secret || "";
      const trackingId = credenciais.trackingId || "";

      if (!appKey || !secret || !trackingId || !urlOriginal) {
        return urlOriginal;
      }

      const params = {
        method: "aliexpress.affiliate.link.generate",
        app_key: appKey,
        timestamp: timestampGMT8(),
        sign_method: "md5",
        format: "json",
        v: "2.0",
        promotion_link_type: "0",
        source_values: urlOriginal,
        tracking_id: trackingId
      };

      params.sign = assinar(params, secret);

      const response = await fetchImpl("https://api-sg.aliexpress.com/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
        },
        body: new URLSearchParams(params)
      });

      const data = await response.json();

     console.log("[INFO] Ali link");

      const linkGerado =
        data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
        data?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
        "";

      return linkGerado || urlOriginal;

    } catch (e) {
      console.log("[ERRO] Erro gerar link curto AliExpress:", e.message);
      return urlOriginal;
    }
  };
}

module.exports = {
  criarGerarLinkAliExpress
};
