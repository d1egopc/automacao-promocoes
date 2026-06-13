const axios = require("axios");

const CACHE_TTL_MS = 60 * 60 * 1000;
const cacheCuponsPorCliente = {};

function pareceCupomRealML(cupom = "") {
  const codigo = String(cupom || "").toUpperCase().trim();

  if (codigo.length < 5 || codigo.length > 40) return false;
  if (!/[A-Z]/.test(codigo)) return false;

  const bloqueados = new Set([
    "HTML",
    "JSON",
    "HTTP",
    "HTTPS",
    "DOCTYPE",
    "SCRIPT",
    "STYLE",
    "MERCADOLIVRE",
    "MERCADOPAGO",
    "MLB",
    "MLA",
    "MLM",
    "CUPOM",
    "CUPONS",
    "COUPON",
    "COUPONS",
    "INATIVO",
    "ATIVO",
    "VALIDO",
    "VALIDADE"
  ]);

  if (bloqueados.has(codigo)) return false;

  const palavrasFortes = [
    "MELI",
    "CUPOM",
    "MODA",
    "BELEZA",
    "OFERTA",
    "GANHA",
    "COMPRA",
    "ESQUENTA",
    "APP",
    "PIX",
    "OFF"
  ];

  if (palavrasFortes.some(palavra => codigo.includes(palavra))) {
    return true;
  }

  return /[A-Z]{3,}\d{1,}/.test(codigo);
}

function extrairCuponsDoHtmlCuponsML(html = "") {
  const texto = String(html || "").replace(/\s+/g, " ");
  const encontrados = texto.match(/\b[A-Z0-9][A-Z0-9_-]{4,39}\b/g) || [];
  const candidatos = [];

  for (const codigo of encontrados) {
    const cupom = String(codigo || "").toUpperCase().trim();

    if (!pareceCupomRealML(cupom)) continue;

    const idx = texto.indexOf(codigo);
    const trecho = texto.slice(
      Math.max(0, idx - 300),
      Math.min(texto.length, idx + 500)
    );

    candidatos.push({
      cupom,
      origem: "pagina_cupons_ml",
      trecho,
      encontradoEm: new Date().toISOString()
    });
  }

  return Array.from(
    new Map(candidatos.map(item => [item.cupom, item])).values()
  );
}

async function buscarCuponsMercadoLivreCliente({ cookies } = {}) {
  const cookiesLimpos = String(cookies || "").trim();

  if (!cookiesLimpos) {
    console.log("ML cupons: sem cookies");
    return [];
  }

  const url = "https://www.mercadolivre.com.br/cupons?source_page=mperfil";

  try {
    const { data: html, request } = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://www.mercadolivre.com.br/",
        "Cookie": cookiesLimpos
      }
    });

    const urlFinal = request?.res?.responseUrl || url;
    const htmlTexto = String(html || "");

    if (
      String(urlFinal).includes("account-verification") ||
      htmlTexto.includes("account-verification")
    ) {
      console.log("ML cupons: account-verification");
      return [];
    }

    const cupons = extrairCuponsDoHtmlCuponsML(htmlTexto);

    console.log("ML cupons encontrados:", cupons.length);

    return cupons;
  } catch (e) {
    console.log("ML cupons erro:", e.message);
    return [];
  }
}

async function obterCuponsMLCliente(clienteId = "admin", cookies = "") {
  const id = String(clienteId || "admin");
  const agora = Date.now();
  const cache = cacheCuponsPorCliente[id];

  if (cache && agora - cache.atualizadoEm < CACHE_TTL_MS) {
    console.log("ML cupons cache:", {
      clienteId: id,
      total: cache.cupons.length
    });

    return cache.cupons;
  }

  const cupons = await buscarCuponsMercadoLivreCliente({ cookies });

  cacheCuponsPorCliente[id] = {
    atualizadoEm: agora,
    cupons
  };

  return cupons;
}

function escolherCupomParaOfertaML(oferta = {}, cupons = []) {
  if (!Array.isArray(cupons) || !cupons.length) return null;

  const titulo = String(oferta.titulo || oferta.nome || "").toLowerCase();
  const categoria = String(oferta.categoria || "").toLowerCase();
  const textoOferta = `${titulo} ${categoria}`;

  let melhor = null;

  for (const item of cupons) {
    const cupom = String(item?.cupom || "").toUpperCase().trim();
    const trecho = String(item?.trecho || "").toLowerCase();

    if (!pareceCupomRealML(cupom)) continue;

    let score = 0;

    const ofertaModa =
      /moda|camiseta|camisa|roupa|calca|calça|jeans|tenis|tênis|sapato|chinelo|vestido|blusa|bermuda|short|polo|moletom|jaqueta/i
        .test(textoOferta);

    const ofertaBeleza =
      /beleza|perfume|perfumaria|cosmetico|cosmético|maquiagem|skincare|hidratante|shampoo|condicionador|protetor solar/i
        .test(textoOferta);

    const ofertaEsporte =
      /esporte|fitness|academia|bicicleta|bike|treino|musculacao|musculação|esteira|suplemento|whey/i
        .test(textoOferta);

    const ofertaMercado =
      /mercado|supermercado|alimento|limpeza|cafe|café|arroz|feijao|feijão|azeite|chocolate|biscoito/i
        .test(textoOferta);

    if (cupom.includes("CUPOM")) score += 30;
    if (cupom.includes("MELI")) score += 25;
    if (cupom.includes("OFF")) score += 15;
    if (cupom.includes("PIX")) score += 10;
    if (/[A-Z]{3,}\d{1,}/.test(cupom)) score += 10;

    if (ofertaModa && /MODA|TENIS|TÊNIS|ROUPA/.test(cupom)) score += 70;
    if (ofertaBeleza && /BELEZA|PERFUME|COSMET/.test(cupom)) score += 70;
    if (ofertaEsporte && /SPORT|ESPORTE|FIT/.test(cupom)) score += 70;
    if (ofertaMercado && /MERCADO|SUPER|ALIMENTO/.test(cupom)) score += 70;

    if (ofertaModa && /moda|roupa|camiseta|tenis|tênis/.test(trecho)) score += 35;
    if (ofertaBeleza && /beleza|perfume|cosmetico|cosmético/.test(trecho)) score += 35;
    if (ofertaEsporte && /esporte|fitness|academia/.test(trecho)) score += 35;
    if (ofertaMercado && /mercado|supermercado|alimento|limpeza/.test(trecho)) score += 35;

    if (trecho.includes("pix")) score += 10;
    if (trecho.includes("app")) score += 10;
    if (trecho.includes("valido") || trecho.includes("válido")) score += 10;
    if (trecho.includes("inativo")) score -= 100;
    if (trecho.includes("expirado")) score -= 100;

    if (!melhor || score > melhor.score) {
      melhor = {
        cupom,
        score,
        trecho,
        origem: item.origem || ""
      };
    }
  }

  if (!melhor || melhor.score < 30) return null;

  if (melhor.score >= 70) {
    return {
      cupom: melhor.cupom,
      tipoCupom: "confirmado_cliente",
      cupomConfianca: melhor.score,
      avisoCupom: `Use o cupom ${melhor.cupom} no carrinho e confira a regra da campanha.`
    };
  }

  return {
    cupom: "",
    tipoCupom: "possivel_cliente",
    cupomConfianca: melhor.score,
    avisoCupom:
      "Pode haver cupom disponivel para esta categoria. Confira no carrinho/app do Mercado Livre."
  };
}

module.exports = {
  buscarCuponsMercadoLivreCliente,
  extrairCuponsDoHtmlCuponsML,
  pareceCupomRealML,
  obterCuponsMLCliente,
  escolherCupomParaOfertaML
};
