const axios = require("axios");

// ================= MOTOR UNIVERSAL DE CUPONS =================

async function buscarCupomMercadoLivre(oferta = {}, contexto = {}) {
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
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          Cookie: contexto.cookies || ""
      }
    });


console.log(
  "🎟️ URL FINAL CUPOM:",
  response.request?.res?.responseUrl
);

    const html = String(response.data || "");
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const textoLower = texto.toLowerCase();

console.log("🧪 TEM CUPOM:", textoLower.includes("cupom"));
console.log("🧪 TEM ECONOMIZE:", textoLower.includes("economize"));
console.log("🧪 TEM APLICAR CUPOM:", textoLower.includes("aplicar cupom"));
console.log("🧪 TEM DESCONTO ADICIONAL:", textoLower.includes("desconto adicional"));

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

console.log("🎟️ ML: tentando página geral de cupons...");


const cuponsPagina =
  await buscarCuponsPaginaMercadoLivre(contexto);

const cupomCampanha =
  escolherCupomMercadoLivreParaOferta(
    oferta,
    cuponsPagina
  );

if (cupomCampanha) {
  console.log(
    "✅ ML CUPOM CAMPANHA APLICADO:",
    cupomCampanha
  );

  return cupomCampanha;
}

console.log("🎟️ TRECHO CUPOM:", trechoCupom);

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

async function buscarCuponsPaginaMercadoLivre(contexto = {}) {
  const cookies = contexto.cookies || contexto.credenciais?.cookies || "";

  if (!cookies) {
    console.log("🎟️ ML CUPONS: sem cookies para buscar página de cupons");
    return [];
  }

  const urlCupons = "https://www.mercadolivre.com.br/cupons?source_page=mperfil";

  try {
    const { data: html, request } = await axios.get(urlCupons, {
      maxRedirects: 5,
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://www.mercadolivre.com.br/",
        "Cookie": cookies
      }
    });

    const urlFinal = request?.res?.responseUrl || urlCupons;

    console.log("🎟️ ML CUPONS URL FINAL:", urlFinal);

    if (
      String(urlFinal).includes("account-verification") ||
      String(html).includes("account-verification")
    ) {
      console.log("🚫 ML CUPONS bloqueado por account-verification");
      return [];
    }

    const texto = String(html)
      .replace(/\s+/g, " ")
      .trim();

console.log(
  "🧪 TRECHO CUPONS ML:",
  texto.slice(0, 5000)
);

    const cupons = [];

    const regexCupom = /\b[A-Z0-9]{5,25}\b/g;
    const encontrados = texto.match(regexCupom) || [];

    for (const codigo of encontrados) {
      if (
        codigo.includes("MLB") ||
        codigo.includes("HTML") ||
        codigo.includes("JSON") ||
        codigo.includes("HTTP")
      ) {
        continue;
      }

      const inicio = Math.max(0, texto.indexOf(codigo) - 250);
      const fim = Math.min(texto.length, texto.indexOf(codigo) + 350);
      const trecho = texto.slice(inicio, fim);

      cupons.push({
        cupom: codigo,
        tipoCupom: "campanha",
        origem: "pagina_cupons_ml",
        trecho
      });
    }

    const unicos = Array.from(
      new Map(cupons.map(c => [c.cupom, c])).values()
    );

    console.log("🎟️ ML CUPONS ENCONTRADOS:", unicos.map(c => c.cupom));

    return unicos;
  } catch (e) {
    console.log("❌ Erro buscarCuponsPaginaMercadoLivre:", e.message);
    return [];
  }
}

function escolherCupomMercadoLivreParaOferta(oferta = {}, cupons = []) {
  const titulo = String(oferta.titulo || oferta.nome || "").toLowerCase();
  const categoria = String(oferta.categoria || "").toLowerCase();
  const preco = Number(
    String(oferta.preco || oferta.precoAtual || "0")
      .replace(/[^\d,.-]/g, "")
      .replace(".", "")
      .replace(",", ".")
  );

  const textoOferta = `${titulo} ${categoria}`;

  const palavrasPorCategoria = {
    moda: [
      "moda", "roupa", "roupas", "camiseta", "t-shirt", "blusa",
      "calça", "vestido", "short", "polo", "insider", "feminina",
      "masculina"
    ],
    tenis: [
      "tênis", "tenis", "sapato", "chinelo", "adidas", "nike",
      "mizuno", "olympikus"
    ],
    informatica: [
      "informática", "informatica", "computador", "notebook", "pc",
      "ssd", "fonte", "fonte gamer", "placa de vídeo", "placa de video",
      "monitor", "teclado", "mouse", "hardware", "gamer"
    ],
    ferramentas: [
      "ferramenta", "ferramentas", "furadeira", "parafusadeira",
      "serra", "makita", "bosch"
    ],
    mercado: [
      "mercado", "supermercado", "alimento", "limpeza", "heinz",
      "yopro", "galderma"
    ],
    papelaria: [
      "papelaria", "escritório", "escritorio", "escola", "caderno",
      "caneta", "mochila"
    ]
  };

  const bloqueados = new Set([
    "INATIVO", "ATIVO", "DOCTYPE", "HTML", "JSON", "HTTP",
    "CUPOM", "CUPONS", "PERCENT", "TOTAL", "CORRIGIDO"
  ]);

  let melhor = null;

for (const item of cupons) {

  const cupom = String(item.cupom || "").toUpperCase().trim();
  const trecho = String(item.trecho || "").toLowerCase();

  if (!pareceCupomRealML(cupom)) {
    continue;
  }

   let pontos = 0;

const temLetra = /[A-Z]/.test(cupom);
const temNumero = /\d/.test(cupom);

if (temLetra && temNumero) pontos += 60;

if (cupom.startsWith("CUPOM")) pontos += 300;
if (cupom.includes("CUPOM")) pontos += 120;

if (cupom.includes("MODA")) pontos += 300;
if (cupom.includes("PRA")) pontos += 100;

if (cupom.includes("OFF")) pontos += 20;

if (cupom.includes("TENIS") || cupom.includes("TÊNIS")) pontos += 80;

const ofertaEhModa =
  textoOferta.includes("moda") ||
  textoOferta.includes("camiseta") ||
  textoOferta.includes("t-shirt") ||
  textoOferta.includes("roupa") ||
  textoOferta.includes("insider") ||
  textoOferta.includes("feminina") ||
  textoOferta.includes("masculina");

if (ofertaEhModa && cupom.includes("MODA")) {
  pontos += 500;
}

for (const [grupo, palavras] of Object.entries(palavrasPorCategoria)) {
  const ofertaCombina = palavras.some(p => textoOferta.includes(p));
  const cupomCombina =
    palavras.some(p => cupom.toLowerCase().includes(p)) ||
    palavras.some(p => trecho.includes(p));

  if (ofertaCombina && cupomCombina) {
    pontos += 50;
  }

  if (grupo === "moda" && ofertaCombina && trecho.includes("moda")) {
    pontos += 40;
  }

  if (grupo === "informatica" && ofertaCombina && trecho.includes("informática")) {
    pontos += 40;
  }
}

    if (trecho.includes("pix")) pontos += 10;
    if (trecho.includes("válido") || trecho.includes("valido")) pontos += 10;
    if (trecho.includes("inativo")) pontos -= 100;
    if (trecho.includes("expirado")) pontos -= 100;

    if (preco > 0) {
      const minMatch = trecho.match(/(?:acima de|mínimo|minimo|a partir de)\s*r?\$?\s*([\d.,]+)/i);
      if (minMatch) {
        const minimo = Number(
          minMatch[1].replace(".", "").replace(",", ".")
        );

        if (minimo && preco >= minimo) pontos += 20;
        if (minimo && preco < minimo) pontos -= 80;
      }
    }

    if (!melhor || pontos > melhor.pontos) {
      melhor = {
        cupom,
        pontos,
        trecho
      };
    }
  }

  if (!melhor || melhor.pontos < 40) {
    console.log("🎟️ ML: nenhum cupom com pontuação suficiente");
    return null;
  }

  console.log("🏆 ML MELHOR CUPOM:", {
    cupom: melhor.cupom,
    pontos: melhor.pontos
  });

  return {
    cupom: melhor.cupom,
    tipoCupom: "campanha",
    avisoCupom: `Use o cupom ${melhor.cupom} no carrinho e confira se aplica nesta oferta.`
  };
}

function pareceCupomRealML(cupom = "") {
  cupom = String(cupom).toUpperCase();

  const palavrasFortes = [
    "MELI",
    "CUPOM",
    "MODA",
    "BELEZA",
    "OFERTA",
    "PIX",
    "APP",
    "OFF"
  ];

  return palavrasFortes.some(p =>
    cupom.includes(p)
  );
}

async function aplicarCuponsAutomaticos(oferta = {}, contexto = {}) {
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
      cupomEncontrado = await buscarCupomMercadoLivre(oferta, contexto);
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
  buscarCupomMercadoLivre,
  buscarCuponsPaginaMercadoLivre,
  escolherCupomMercadoLivreParaOferta
};