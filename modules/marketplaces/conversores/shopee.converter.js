const crypto = require("crypto");

function criarGerarLinkShopee({
  fetch: fetchImpl = global.fetch,
  getIntegracaoCliente,
  logDebug
} = {}) {
  return async function gerarLinkShopeeCliente(clienteId, ofertaBase = {}) {
    try {
      const integracao = getIntegracaoCliente(clienteId, "shopee");

      logDebug("[INFO] CLIENTE:", clienteId);
      logDebug("[INFO] MARKETPLACE:", "shopee");
      logDebug("[INFO] Integrao encontrada?", !!integracao);
      logDebug("[INFO] Tem credenciais?", !!integracao?.credenciais);

      const appId = integracao?.credenciais?.appId || "";
      const secret = integracao?.credenciais?.secret || "";

      if (!appId || !secret) {
        return "";
      }

      const keyword = String(
        ofertaBase.titulo ||
        ofertaBase.nome ||
        ""
      )
        .replace(/"/g, "")
        .slice(0, 80);

      if (!keyword) {
        return "";
      }

      const timestamp = Math.floor(Date.now() / 1000);

      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              keyword: "${keyword}",
              page: 1,
              limit: 5
            ) {
              nodes {
                productName
                productLink
                offerLink
                itemId
                shopId
              }
            }
          }
        `
      };

      const payload = JSON.stringify(bodyPayload);
      const baseString = `${appId}${timestamp}${payload}${secret}`;

      const sign = crypto
        .createHash("sha256")
        .update(baseString, "utf8")
        .digest("hex");

      const response = await fetchImpl(
        "https://open-api.affiliate.shopee.com.br/graphql",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
          },
          body: payload
        }
      );

      const data = await response.json().catch(() => null);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      const ofertaTitulo = String(ofertaBase.titulo || ofertaBase.nome || "")
        .toLowerCase()
        .slice(0, 40);

      const produto =
        nodes.find(n =>
          String(n.productName || "")
            .toLowerCase()
            .includes(ofertaTitulo.slice(0, 20))
        ) || nodes[0];

      return produto?.offerLink || "";

    } catch (e) {
      console.log("[ERRO] erro gerarLinkShopeeCliente:", e.message);
      return "";
    }
  };
}

module.exports = {
  criarGerarLinkShopee
};
