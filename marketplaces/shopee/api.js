const crypto = require("crypto");

async function buscarOfertasShopee(clienteId = "admin", deps = {}) {
  const {
    config,
    getIntegracaoCliente
  } = deps;

  const configShopee =
    getIntegracaoCliente(clienteId, "shopee") ||
    getIntegracaoCliente("admin", "shopee");

if (
  !configShopee?.credenciais?.appId ||
  !configShopee?.credenciais?.secret
) {
  console.log("❌ Shopee sem credenciais configuradas");
  return [];
}

  const { appId, secret } = configShopee.credenciais;

  const timestamp = Math.floor(Date.now() / 1000);

  const bodyPayload = {
    query: `
      query {
        productOfferV2(
          listType: 0,
          sortType: 2,
          page: 1,
          limit: ${config.marketplaces?.shopee?.limiteBuscas || 30}
        ) {
          nodes {
            itemId
            productName
            productLink
            offerLink
            imageUrl
            priceMin
            priceMax
            priceDiscountRate
            sales
            ratingStar
            commissionRate
            shopId
            shopName
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

  const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
    },
    body: payload
  });

  const data = await response.json();

  console.log("🛍️ SHOPEE BUSCA RESPONSE:", JSON.stringify(data).slice(0, 1000));

  return data?.data?.productOfferV2?.nodes || [];
}


module.exports = {
  buscarOfertasShopee
};
