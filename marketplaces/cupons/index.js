const axios = require("axios");

// ================= MOTOR UNIVERSAL DE CUPONS =================

async function buscarCupomMercadoLivre(oferta = {}) {
  try {
    const url =
      oferta.linkOriginal ||
      oferta.urlOriginal ||
      oferta.linkProduto ||
      "";

    console.log("🎟️ BUSCADOR ML CUPOM ATIVO:", {
      nome: oferta.nome || oferta.titulo,
      link: oferta.link || "",
      linkOriginal: url
    });

    if (!url || !url.includes("mercadolivre.com")) {
      return null;
    }

console.log("🎟️ URL USADA PELO MOTOR:", url);

    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const html = String(response.data || "");
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const textoLower = texto.toLowerCase();

    const temSinalCupom =
      textoLower.includes("cupom") ||
      textoLower.includes("cupon") ||
      textoLower.includes("aplicar cupom") ||
      textoLower.includes("usar cupom") ||
      textoLower.includes("economize") ||
      textoLower.includes("desconto adicional");

    if (!temSinalCupom) {
      console.log("🎟️ ML SEM SINAL REAL DE CUPOM:", oferta.nome || oferta.titulo);
      return null;
    }

    const trechoCupom =
      texto.match(/.{0,80}(cupom|economize|desconto adicional).{0,120}/i)?.[0] ||
      "";

    console.log("🎟️ ML SINAL DE CUPOM ENCONTRADO:", trechoCupom);

    return {
      cupom: "",
      tipoCupom: "pagina",
      cupomMarketplace: "mercadolivre",
      avisoCupom:
        trechoCupom ||
        "Verifique na página do Mercado Livre se há cupom disponível para aplicar.",
      cupomValor: "",
      cupomPercentual: ""
    };
  } catch (e) {
    console.log("⚠️ Erro ao buscar cupom Mercado Livre:", e.message);
    return null;
  }
}

async function aplicarCuponsAutomaticos(oferta = {}) {
  try {

    console.log("🎟️ MOTOR CUPONS RECEBEU:", {
      marketplace: oferta.marketplace || oferta.loja,
      nome: oferta.nome || oferta.titulo,
      cupomAtual: oferta.cupom || ""
    });

    const marketplace = String(
      oferta.marketplace || oferta.loja || ""
    ).toLowerCase();

    let cupomEncontrado = null;

    if (
      marketplace === "mercadolivre" ||
      marketplace === "mercado_livre" ||
      marketplace === "ml"
    ) {
      cupomEncontrado = await buscarCupomMercadoLivre(oferta);
    }

    if (!cupomEncontrado) {
      return {
        ...oferta,
        cupom: oferta.cupom || "",
        tipoCupom: oferta.tipoCupom || "",
        avisoCupom: oferta.avisoCupom || "",
        cupomMarketplace: oferta.cupomMarketplace || marketplace || "",
        cupomValor: oferta.cupomValor || "",
        cupomPercentual: oferta.cupomPercentual || ""
      };
    }

    return {
      ...oferta,
      cupom: cupomEncontrado.cupom || "",
      tipoCupom: cupomEncontrado.tipoCupom || "",
      avisoCupom:
        cupomEncontrado.avisoCupom ||
        cupomEncontrado.descricao ||
        "",
      cupomMarketplace: marketplace,
      cupomValor: cupomEncontrado.cupomValor || "",
      cupomPercentual: cupomEncontrado.cupomPercentual || ""
    };
  } catch (e) {
    console.log("⚠️ Erro no motor universal de cupons:", e.message);
    return oferta;
  }
}

module.exports = {
  aplicarCuponsAutomaticos,
  buscarCupomMercadoLivre
};