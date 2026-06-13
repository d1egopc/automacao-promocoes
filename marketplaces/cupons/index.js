const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ================= MOTOR UNIVERSAL DE CUPONS =================

const ARQUIVO_CUPONS_ML = "/data/cupons_ml.json";

const CUPONS_CONFIRMADOS_ML = [
  {
    cupom: "CUPOMPRAMODA",
    grupo: "moda",
    ativo: true,
    validoAte: "2026-06-10",
    confianca: 100,
    palavras: ["moda", "camiseta", "t-shirt", "roupa", "moletom", "calça", "blusa", "vestido", "short", "saia", "polo", "oversized", "insider", "jeans", "cropped", "legging", "jaqueta"]
  },
  {
    cupom: "ESQUENTABELEZA",
    grupo: "beleza",
    ativo: true,
    validoAte: "2026-06-10",
    confianca: 100,
    palavras: ["beleza", "perfume", "perfumaria", "lattafa", "yara", "edp", "eau de parfum", "cosmético", "cosmetico", "maquiagem", "skincare", "hidratante", "protetor solar", "serum", "sérum", "shampoo", "condicionador", "batom"]
  },
  {
    cupom: "6DO6SPORTS",
    grupo: "esporte",
    ativo: true,
    validoAte: "2026-06-05",
    confianca: 100,
    palavras: ["esporte", "fitness", "bicicleta", "spinning", "bike", "academia", "musculação", "musculacao", "treino", "esteira", "squeeze"]
  }
];

function garantirArquivoCuponsML() {
  try {
    if (!fs.existsSync("/data")) {
      fs.mkdirSync("/data", { recursive: true });
    }

    if (!fs.existsSync(ARQUIVO_CUPONS_ML)) {
      fs.writeFileSync(
        ARQUIVO_CUPONS_ML,
        JSON.stringify(CUPONS_CONFIRMADOS_ML, null, 2)
      );
    }
  } catch (e) {
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
  }
}

function carregarCuponsML() {
  try {
    garantirArquivoCuponsML();

    const conteudo = fs.readFileSync(ARQUIVO_CUPONS_ML, "utf8");
    const cupons = JSON.parse(conteudo);

   return Array.isArray(cupons) ? cupons : [];
  } catch (e) {
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
    return CUPONS_CONFIRMADOS_ML;
  }
}

function salvarCuponsML(cupons = []) {
  try {
    garantirArquivoCuponsML();

    fs.writeFileSync(
      ARQUIVO_CUPONS_ML,
      JSON.stringify(cupons, null, 2)
    );

    return true;
  } catch (e) {
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
    return false;
  }
}

function extrairCuponsDoHtmlProdutoML(html = "") {
  const candidatos = [];
  const texto = String(html);

  const regexCupomMarketing =
    /\b(?:CUPOM|MELI|ESQUENTA|COMPRA|GANHA|OFERTA)[A-Z0-9]{3,30}\b/g;

  const encontradosDiretos = texto.match(regexCupomMarketing) || [];

  for (const cupom of encontradosDiretos) {
    candidatos.push({
      cupom: cupom.toUpperCase(),
      tipoCupom: "produto",
      origem: "html_produto_ml",
      prioridade: 1000
    });
  }

  const regexJson =
    /"(?:code|coupon_code|couponCode|voucherCode|voucher_code)"\s*:\s*"([A-Z0-9_-]{5,40})"/gi;

  let match;

  while ((match = regexJson.exec(texto)) !== null) {
    candidatos.push({
      cupom: String(match[1]).toUpperCase(),
      tipoCupom: "produto",
      origem: "json_produto_ml",
      prioridade: 1200
    });
  }

  return Array.from(
    new Map(candidatos.map(c => [c.cupom, c])).values()
  );
}

function buscarCupomConfirmadoML(oferta = {}) {
  const titulo = String(oferta.titulo || oferta.nome || "").toLowerCase();
  const categoria = String(oferta.categoria || "").toLowerCase();
  const textoOferta = `${titulo} ${categoria}`;
  const hoje = new Date().toISOString().slice(0, 10);

  const cuponsConfirmados = carregarCuponsML();

  for (const regra of cuponsConfirmados) {
   
    if (!regra.ativo) continue;
    if (regra.validoAte && regra.validoAte < hoje) continue;

    const combina = regra.palavras.some(p =>
      textoOferta.includes(String(p).toLowerCase())
    );

    if (!combina) continue;

    return {
      cupom: regra.cupom,
      tipoCupom: "confirmado",
      avisoCupom: `Use o cupom ${regra.cupom} no carrinho e pague no Pix para chegar no menor valor.`,
      cupomConfianca: regra.confianca,
      cupomGrupo: regra.grupo
    };
  }

  return null;
}

async function buscarCupomMercadoLivre(oferta = {}, contexto = {}) {
  try {
    const url =
      oferta.linkOriginal ||
      oferta.urlOriginal ||
      oferta.linkProduto ||
      "";

    if (!url || !url.includes("mercadolivre.com")) {
      return null;
    }

const cupomConfirmado = buscarCupomConfirmadoML(oferta);

if (cupomConfirmado) {
  return cupomConfirmado;
}

    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Cookie": contexto.cookies || ""
}
    });

const html = response.data;

const cuponsProduto =
  extrairCuponsDoHtmlProdutoML(html);

if (cuponsProduto.length) {
  const melhorProduto =
    escolherCupomMercadoLivreParaOferta(
      oferta,
      cuponsProduto
    );

  if (melhorProduto) {
    return melhorProduto;
  }
}

const urlFinal =
  response?.request?.res?.responseUrl || url;

    const htmlProduto = String(response.data || "");
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

    if (!temSinalCupom) return null;

    const trechoCupom =
      texto.match(/.{0,80}(cupom|economize|desconto adicional).{0,120}/i)?.[0] ||
      "";

const cuponsPagina =
  await buscarCuponsPaginaMercadoLivre(contexto);

const cupomCampanha =
  escolherCupomMercadoLivreParaOferta(
    oferta,
    cuponsPagina
  );

if (cupomCampanha) return cupomCampanha;

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
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
    return null;
  }
}

async function buscarCuponsPaginaMercadoLivre(contexto = {}) {
  const cookies = contexto.cookies || contexto.credenciais?.cookies || "";

  if (!cookies) return [];

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

    if (
      String(urlFinal).includes("account-verification") ||
      String(html).includes("account-verification")
    ) {
      return [];
    }

    const texto = String(html)
      .replace(/\s+/g, " ")
      .trim();

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

    return unicos;
  } catch (e) {
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
    return [];
  }
}

function escolherCupomMercadoLivreParaOferta(oferta = {}, cupons = []) {
  const titulo = String(oferta.titulo || oferta.nome || "").toLowerCase();

const bloqueados = new Set([
  "CUPOM",
  "CUPONS",
  "INATIVO",
  "ATIVO",
  "MODA",
  "TÊNIS",
  "PRESENTES",
  "VENDEDORES",
  "ORIGINAIS",
  "INTERNACIONAL",
  "DOCTYPE",
  "HTML",
  "JSON",
  "HTTP",
  "PERCENT",
  "TOTAL",
  "CORRIGIDO",
  "40OFF",
  "50OFF",
  "60OFF",
  "70OFF",
  "CUPOM20REAIS1P"
]);


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

  let melhor = null;

for (const item of cupons) {

  const cupom = String(item.cupom || "").toUpperCase().trim();
  const trecho = String(item.trecho || "").toLowerCase();

 if (bloqueados.has(cupom)) {
  continue;
}

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

  if (!melhor || melhor.pontos < 40) return null;

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
    console.log("⚠️ ML CUPONS:", {
      erro: e.message
    });
    return oferta;
  }
}

module.exports = {
  aplicarCuponsAutomaticos,
  buscarCupomMercadoLivre,
  buscarCuponsPaginaMercadoLivre,
  escolherCupomMercadoLivreParaOferta
};
