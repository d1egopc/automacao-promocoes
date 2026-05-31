const crypto = require("crypto");

async function buscarOfertasShopee(clienteId = "admin") {
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


const PORT = process.env.PORT || 3000;

function podeRodarAgora() {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  console.log({
    pausarMadrugada: config.pausarMadrugada,
    inicio: config.horarioInicio,
    fim: config.horarioFim,
    horaServidorBR: `${String(agoraBR.getHours()).padStart(2, "0")}:${String(agoraBR.getMinutes()).padStart(2, "0")}`
  });

  if (!config.pausarMadrugada) return true;

  const [inicioH, inicioM] = (config.horarioInicio || "08:00").split(":").map(Number);
  const [fimH, fimM] = (config.horarioFim || "23:00").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}

carregarConfig();

for (const usuario of usuarios) {
  carregarFila(usuario.id);
}

function garantirIdsFila() {
  let alterou = false;

  fila = fila.map((item) => {
    if (!item.id) {
      alterou = true;

      return {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
    }

    return item;
  });

  if (alterou) {
    salvarFila();
    console.log("🆔 IDs antigos da fila corrigidos");
  }
}

garantirIdsFila();

console.log("🚀 Dados iniciais carregados:", {
  fila: fila.length,
  usuarios: usuarios.length,
  integracoesClientes: Object.keys(integracoesPorCliente || {}).length,
  destinosClientes: Object.keys(destinosPorCliente || {}).length
});

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);

decairConfiancaCupons();

setInterval(() => {
  decairConfiancaCupons();
}, 4 * 60 * 60 * 1000);

  setTimeout(() => {
    console.log("🔄 Reconectando sessões WhatsApp automaticamente...");
 
let sessoesParaReconectar = [
  ...new Set(config?.sessoesWhatsapp || [])
];

sessoesParaReconectar = sessoesParaReconectar
  .filter(id => id && id.includes("_"))
  .filter(id => !id.includes("_user_"))
  .filter(id => !/^user_[^_]+_user_/.test(id));

config.sessoesWhatsapp = sessoesParaReconectar;
salvarConfig();

    sessoesParaReconectar.forEach((id, index) => {
      setTimeout(() => {
        console.log("🚀 Reconectando sessão:", id);
        iniciarWhatsApp(id);
      }, 3000 + index * 4000);
    });

  }, 3000);
});

module.exports = {
  buscarOfertasShopee
};
