const crypto = require("crypto");

function criarImportarShopee(deps = {}) {
  const {
    limparPreco,
    htmlDecode,
    extrairMeta,
    corrigirImagemUrl
  } = deps;

return async function importarShopee(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const { appId, secret } = config.credenciais || {};

  function normalizarPrecoShopee(valor) {
    if (!valor) return "";

    let texto = String(valor).trim();

    if (texto.includes(",")) return limparPreco(texto);

   if (/^\d+\.\d+$/.test(texto)) {
   return Number(texto).toFixed(2).replace(".", ",");
   }

    if (/^\d+$/.test(texto)) {
      let numero = Number(texto);

      if (numero > 100000) {
        numero = numero / 100000;
      } else if (numero > 1000) {
        numero = numero / 100;
      }

      return numero.toFixed(2).replace(".", ",");
    }

    return limparPreco(texto);
  }

  function extrairIdsShopee(link) {
    const texto = String(link || "").split("?")[0];

    // Formato novo: /product/shopId/itemId
    const matchProduct = texto.match(/\/product\/(\d+)\/(\d+)/i);
    if (matchProduct) {
      return {
        shopId: matchProduct[1],
        itemId: matchProduct[2]
      };
    }

    // Formato antigo: -i.shopId.itemId
    const match1 = texto.match(/-i\.(\d+)\.(\d+)/i);
    if (match1) {
      return {
        shopId: match1[1],
        itemId: match1[2]
      };
    }

    // Outro formato: i.shopId.itemId
    const match2 = texto.match(/i\.(\d+)\.(\d+)/i);
    if (match2) {
      return {
        shopId: match2[1],
        itemId: match2[2]
      };
    }

    return {
      shopId: "",
      itemId: ""
    };
  }

  function gerarKeywordShopee(link) {
    try {
      const semQuery = String(link).split("?")[0];
      const parte = decodeURIComponent(semQuery.split("/").pop() || "");
      const antesDoId = parte.split("-i.")[0] || parte;

      return antesDoId
        .replace(/-/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    } catch {
      return "";
    }
  }

  async function chamarShopeeGraphQL(bodyPayload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(bodyPayload);

    const baseString = `${appId}${timestamp}${payload}${secret}`;

    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch(
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

    const data = await response.json();

    console.log("SHOPEE RESPONSE:", JSON.stringify(data));

    return data;
  }

  const ids = extrairIdsShopee(url);
  const keyword = gerarKeywordShopee(url);

  let produto = null;

  // 1) Tenta buscar pelo itemId do próprio link
  if (ids.itemId) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              itemId: ${ids.itemId},
              page: 1,
              limit: 10
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

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto =
        nodes.find((p) => String(p.itemId) === String(ids.itemId)) ||
        nodes[0] ||
        null;
    } catch (e) {
      console.error("SHOPEE ITEMID ERRO:", e.message);
    }
  }

  // 2) Se não achou, tenta por keyword do link
  if (!produto && keyword) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              keyword: ${JSON.stringify(keyword)},
              listType: 0,
              sortType: 2,
              page: 1,
              limit: 20
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

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto = nodes[0] || null;
    } catch (e) {
      console.error("SHOPEE KEYWORD ERRO:", e.message);
    }
  }

  // 3) Se a API não encontrou, fallback simples pelo HTML
  if (!produto) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      const html = await response.text();

console.log("🧪 SHOPEE HTML TAMANHO:", html.length);
console.log("🧪 SHOPEE HTML TEM R$:", html.includes("R$"));
console.log("🧪 SHOPEE HTML PREÇOS:", html.match(/R\$\s*[\d.]+,\d{2}/g)?.slice(0, 10));
console.log("🧪 SHOPEE KEYWORD:", keyword);
console.log("🧪 SHOPEE IDS:", ids);


      const titulo =
        extrairMeta(html, "og:title") ||
        extrairMeta(html, "twitter:title") ||
        keyword ||
        "Produto Shopee";

        const imagem =
        extrairMeta(html, "og:image") ||
        extrairMeta(html, "twitter:image") ||
        "";

       console.log("🧪 SHOPEE PRODUTO RAW:", JSON.stringify(produto, null, 2));

      let cupom = "";
      let avisoCupom =
  "🎟️ Verifique se há cupons disponíveis na página";

const precosHtml = [...html.matchAll(/R\$\s*[\d.]+,\d{2}/g)]
  .map(m => m[0])
  .filter(Boolean);

let precoAtual = "";

if (precosHtml.length) {
  const unicos = [...new Set(precosHtml)];

  if (unicos.length >= 2) {
    precoAtual = `${unicos[0].replace("R$", "").trim()} a ${unicos[1].replace("R$", "").trim()}`;
  } else {
    precoAtual = unicos[0].replace("R$", "").trim();
  }
}

      return {
  marketplace: "shopee",
  titulo: htmlDecode(titulo)
    .replace(" | Shopee Brasil", "")
    .replace(" | Shopee", "")
    .trim(),
  precoAntigo: "",
  precoAtual,
  cupom,
  avisoCupom,
  linkOriginal: url,
  linkAfiliado: url,
  imagem: corrigirImagemUrl(imagem) || imagem,
  categoria: "Shopee"
};
  } catch (e) {
   console.error("SHOPEE HTML ERRO:", e.message);
    }
  }

 const precoMin = normalizarPrecoShopee(produto?.priceMin || "");

console.log("🧪 SHOPEE PRODUTO API FINAL:", JSON.stringify(produto, null, 2));

const precoMax = normalizarPrecoShopee(produto?.priceMax || "");

let precoAtual = "";
let precoAntigo = "";

const minNumero = Number(String(precoMin).replace(",", "."));
const maxNumero = Number(String(precoMax).replace(",", "."));

const temMin = Number.isFinite(minNumero) && minNumero > 0;
const temMax = Number.isFinite(maxNumero) && maxNumero > 0;

if (temMin && temMax && minNumero !== maxNumero) {
  precoAtual = `${precoMin} a ${precoMax}`;

  // Produto com variação: não inventa preço antigo automático
  precoAntigo = "";
} else {
  precoAtual = precoMin || precoMax || "";

  // Shopee não retorna preço antigo real nesse endpoint.
  // Não calcular "De" automaticamente para evitar desconto inflado.
  precoAntigo = "";
}

  let imagem = produto?.imageUrl || "";
  imagem = htmlDecode(imagem).replace(/\\u002F/g, "/");

  if (imagem && imagem.startsWith("//")) {
    imagem = "https:" + imagem;
  }

  return {
    marketplace: "shopee",
    titulo: htmlDecode(produto?.productName || keyword || "Produto Shopee")
      .replace(" | Shopee Brasil", "")
      .replace(" | Shopee", "")
      .trim(),
    precoAntigo,
    precoAtual,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: produto?.offerLink || produto?.productLink || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Shopee"
  };
}


module.exports = {
  criarImportarShopee
};