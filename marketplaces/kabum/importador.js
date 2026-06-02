const axios = require("axios");

// ============================= FUNCAO IMPORTA AWIN/KABUM =====================================

async function importarProdutoKabumViaAwin(
  url,
  clienteId = "admin",
  deps = {}
) {
  const { gerarDeepLinkAwin } = deps;

  if (typeof gerarDeepLinkAwin !== "function") {
    throw new Error("gerarDeepLinkAwin não recebido no importador KaBuM");
  }  

   const response = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    },
    timeout: 15000
  });

  const html = response.data || "";

console.log("🧪 KABUM HTML DEBUG:", {
  status: response.status,
  tamanhoHtml: html.length,
  temOgImage: html.includes('og:image'),
  temTitle: html.includes("<title>"),
  temPreco: html.includes("R$"),
  temPix: html.toLowerCase().includes("pix"),
  trechoPreco: html.match(/R\$\s?[\d\.]+,\d{2}/g)?.slice(0, 10) || [],
  trechoImagem: html.match(/https?:\/\/[^"']+\.(jpg|jpeg|png|webp)/i)?.[0] || ""
});

      // ================= EXTRAIR TÍTULO =================

    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, " ")
        ?.trim() ||
      "Produto importado de Awin";

    // ================= EXTRAIR IMAGEM =================

    const imagem =
      html.match(/property="og:image"\s*content="([^"]+)"/i)?.[1] ||
      html.match(/<img[^>]+src="([^"]+)"/i)?.[1] ||
      "";

    // ================= EXTRAIR PREÇO =================

let precoAtual = "";
let precoAntigo = "";
let avisoPagamento = "";
let parcelamento = "";

const precosEncontrados = [
  ...html.matchAll(/R\$\s?[\d\.]+,\d{2}/g)
]
  .map(m => m[0])
  .map(p => p.replace(/\s+/g, " ").trim());

const precosNumericos = precosEncontrados
  .map((texto) => {
    const numero = Number(
      texto
        .replace("R$", "")
        .replace(/\./g, "")
        .replace(",", ".")
        .trim()
    );

    return { texto, numero };
  })
  .filter(p => Number.isFinite(p.numero) && p.numero > 0);

const pixMatch = html.match(/(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}À vista no PIX/i);

const parcelamentoMatch =
  html.match(/em\s+até\s+(\d+)x[\s\S]{0,80}de\s+(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}sem\s+juros/i) ||
  html.match(/(\d+)x[\s\S]{0,40}de\s+(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}sem\s+juros/i);

if (parcelamentoMatch?.[1] && parcelamentoMatch?.[2]) {
  parcelamento = `💳 Ou ${parcelamentoMatch[1]}x de ${parcelamentoMatch[2]} sem juros`;
}

if (!parcelamento) {
  const precoParcela = precosNumericos
    .filter(p => p.numero > 20 && p.numero < 1000)
    .sort((a, b) => a.numero - b.numero)[0];

  const precoTotalParcelado = precosNumericos
    .filter(p => p.numero > precoParcela?.numero * 5)
    .sort((a, b) => a.numero - b.numero)[0];

  if (precoParcela && precoTotalParcelado) {
    const vezes = Math.round(precoTotalParcelado.numero / precoParcela.numero);

    if (vezes >= 2 && vezes <= 12) {
      parcelamento = `💳 Ou ${vezes}x de ${precoParcela.texto} sem juros`;
    }
  }
}

if (pixMatch?.[1]) {
  precoAtual = pixMatch[1].trim();
  avisoPagamento = "À vista no PIX";
}

const precosValidos = precosNumericos.filter((p) => {
  return p.numero > 80 && p.numero < 100000;
});

if (!precoAtual && precosValidos.length) {
  const unicos = [];

  for (const preco of precosValidos) {
    if (!unicos.some(p => p.numero === preco.numero)) {
      unicos.push(preco);
    }
  }

  const ordenados = [...unicos].sort((a, b) => a.numero - b.numero);

  precoAtual = ordenados[0]?.texto || "";

  const possivelAntigo = [...unicos]
    .filter(p => p.numero > (ordenados[0]?.numero || 0))
    .sort((a, b) => b.numero - a.numero)[0];

  if (possivelAntigo) {
    precoAntigo = possivelAntigo.texto;
  }
}

console.log("🧪 PREÇOS KABUM EXTRAÍDOS:", precosEncontrados.slice(0, 20));
console.log("🧪 PREÇOS VALIDOS:", precosValidos.slice(0, 20));


  const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

console.log("🧪 KABUM IMPORTADO FINAL:", {
  titulo,
  precoAtual,
  precoAntigo,
  imagem,
  avisoPagamento,
  parcelamento,
  linkAfiliado
});

  return {
  marketplace: "kabum",
  titulo: titulo.replace(/\|.*?KaBuM.*/i, "").trim(),
  precoAtual,
  precoAntigo,
  avisoPagamento,
  avisoCupom: avisoPagamento ? "💳 Com desconto à vista no PIX." : "",
  parcelamento,
  linkOriginal: url,
  link: linkAfiliado || url,
  linkAfiliado: linkAfiliado || url,
  imagem,
  categoria: "Gamer e Hardware"
};
}

module.exports = {
  importarProdutoKabumViaAwin
};
