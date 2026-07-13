const axios = require("axios");
const {
  camposIdentidadeCanonicaOferta
} = require("../../modules/radar/produto-canonico");

const KABUM_HTML_TIMEOUT_MS = 20000;

function criarHeadersHtmlKabum(url) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.kabum.com.br/",
    "Upgrade-Insecure-Requests": "1",
    "Sec-CH-UA": "\"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\"",
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": "\"Windows\"",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1"
  };
}

async function baixarHtmlKabum(url) {
  try {
    return await axios.get(url, {
      headers: criarHeadersHtmlKabum(url),
      timeout: KABUM_HTML_TIMEOUT_MS,
      responseType: "text",
      maxRedirects: 5,
      decompress: true
    });
  } catch (e) {
    if (e.response?.status === 403) {
      const erro = new Error("KaBuM bloqueou scraping HTTP 403");
      erro.status = 403;
      throw erro;
    }

    throw e;
  }
}

function textoKabumSeguro(valor = "") {
  return String(valor || "").trim();
}

function normalizarTituloKabum(valor = "") {
  return textoKabumSeguro(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limparSufixoTituloKabum(titulo = "") {
  return textoKabumSeguro(titulo)
    .replace(/\s*(?:\||-)\s*(?:KaBuM!?|Kabum BR|BR Kabum)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tituloGenericoKabum(titulo = "") {
  const normalizadoOriginal = normalizarTituloKabum(titulo);
  const normalizadoLimpo = normalizarTituloKabum(limparSufixoTituloKabum(titulo));

  if (["access denied", "just a moment", "cloudflare"].some(item => normalizadoOriginal.includes(item))) {
    return {
      generico: true,
      motivo: "kabum_html_intermediario",
      tituloNormalizado: normalizadoOriginal
    };
  }

  const genericosExatos = new Set([
    "br kabum",
    "kabum br",
    "kabum",
    "loja kabum",
    "pagina kabum",
    "produto importado de awin"
  ]);

  if (!normalizadoLimpo || genericosExatos.has(normalizadoLimpo)) {
    return {
      generico: true,
      motivo: "kabum_titulo_generico",
      tituloNormalizado: normalizadoLimpo || normalizadoOriginal
    };
  }

  const termosProduto = normalizadoLimpo
    .split(" ")
    .filter(Boolean)
    .filter(termo => !["br", "kabum", "loja", "pagina", "produto"].includes(termo));

  if (termosProduto.length < 2) {
    return {
      generico: true,
      motivo: "kabum_titulo_generico",
      tituloNormalizado: normalizadoLimpo
    };
  }

  return {
    generico: false,
    motivo: "",
    tituloNormalizado: normalizadoLimpo
  };
}

function decodeUrlKabumSeguro(url = "") {
  let atual = textoKabumSeguro(url);
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(atual); i += 1) {
    try {
      const decodificada = decodeURIComponent(atual);
      if (decodificada === atual) break;
      atual = decodificada;
    } catch {
      break;
    }
  }
  return atual;
}

function diagnosticarProdutoKabum(url = "", titulo = "", imagem = "") {
  const tituloDiagnostico = tituloGenericoKabum(titulo);
  const identidade = camposIdentidadeCanonicaOferta({
    marketplace: "kabum",
    urlOriginal: url,
    linkOriginal: url,
    urlFinal: url
  });
  const host = (() => {
    try {
      return new URL(textoKabumSeguro(url)).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const produtoIdCanonico = textoKabumSeguro(identidade.produtoIdCanonico || identidade.produtoId);
  const urlTexto = textoKabumSeguro(url);
  const urlDecodificada = decodeUrlKabumSeguro(urlTexto);
  const temProdutoId = Boolean(produtoIdCanonico);
  const urlKabumProduto = /kabum\.com\.br\/produto\/\d+/i.test(urlTexto);
  const awinComProduto = /awin1?\.com/i.test(host) && /kabum\.com\.br\/produto\/\d+/i.test(urlDecodificada);
  const urlValida = urlKabumProduto || awinComProduto || (temProdutoId && /kabum\.com\.br|awin1?\.com/i.test(urlTexto));

  const base = {
    host,
    temProdutoId,
    temImagem: Boolean(imagem),
    tituloNormalizado: tituloDiagnostico.tituloNormalizado,
    chaveCanonica: identidade.chaveCanonica || "",
    produtoIdCanonico
  };

  if (tituloDiagnostico.generico) {
    return {
      ...base,
      ok: false,
      motivo: tituloDiagnostico.motivo
    };
  }

  if (!urlValida || !temProdutoId) {
    return {
      ...base,
      ok: false,
      motivo: "kabum_produto_nao_comprovado"
    };
  }

  return {
    ...base,
    ok: true,
    motivo: ""
  };
}

function erroKabumControlado(motivo = "kabum_produto_nao_comprovado", diagnostico = {}) {
  const erro = new Error(motivo);
  erro.codigo = motivo;
  erro.motivo = motivo;
  erro.kabumDiagnostico = diagnostico;
  return erro;
}

// ============================= FUNCAO IMPORTA AWIN/KABUM =====================================

async function importarProdutoKabumViaAwin(
  url,
  clienteId = "admin",
  deps = {}
) {
  const { gerarDeepLinkAwin } = deps;

  if (typeof gerarDeepLinkAwin !== "function") {
    throw new Error("gerarDeepLinkAwin nÃ£o recebido no importador KaBuM");
  }
  const response = await baixarHtmlKabum(url);

  const html = response.data || "";

console.log("[DEBUG] KABUM HTML DEBUG:", {
  status: response.status,
  tamanhoHtml: html.length,
  temOgImage: html.includes('og:image'),
  temTitle: html.includes("<title>"),
  temPreco: html.includes("R$"),
  temPix: html.toLowerCase().includes("pix"),
  trechoPreco: html.match(/R\$\s?[\d\.]+,\d{2}/g)?.slice(0, 10) || [],
  trechoImagem: html.match(/https?:\/\/[^"']+\.(jpg|jpeg|png|webp)/i)?.[0] || ""
});

      // ================= EXTRAIR TÃTULO =================

    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, " ")
        ?.trim() ||
      "Produto importado de Awin";

    // ================= EXTRAIR IMAGEM =================

  let imagem =
  html.match(/property="og:image"\s*content="([^"]+)"/i)?.[1] ||
  html.match(/name="twitter:image"\s*content="([^"]+)"/i)?.[1] ||
  "";

if (imagem) {
  imagem = imagem
    .replace(/\/(medium|small|thumb|thumbnail)\//gi, "/large/")
    .replace(/([?&])(width|height|w|h)=\d+/gi, "")
    .replace(/_\d+x\d+(?=\.)/gi, "");
}

if (imagem) {
  imagem = imagem
    .replace("_m.jpg", "_g.jpg")
    .replace("_p.jpg", "_g.jpg");
}

console.log("[INFO] IMAGEM KABUM:", imagem);

  // ================= EXTRAIR PREÃ‡O =================

const tituloFinal = limparSufixoTituloKabum(titulo);
const diagnosticoProduto = diagnosticarProdutoKabum(url, tituloFinal || titulo, imagem);

if (!diagnosticoProduto.ok) {
  throw erroKabumControlado(diagnosticoProduto.motivo, diagnosticoProduto);
}

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

const pixMatch =
  html.match(/(R\$\s?[\d\.]+,\d{2})\s*Ã€ vista no PIX/i) ||
  html.match(/(R\$\s?[\d\.]+,\d{2})\s*Ã€ vista no PIX com/i);

console.log("[INFO] PIX MATCH:", pixMatch?.[1]);

const parcelamentoMatch =
  html.match(/em\s+atÃ©\s+(\d+)x[\s\S]{0,80}de\s+(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}sem\s+juros/i) ||
  html.match(/(\d+)x[\s\S]{0,40}de\s+(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}sem\s+juros/i);

if (parcelamentoMatch?.[1] && parcelamentoMatch?.[2]) {
  parcelamento = `ðŸ’³ Ou ${parcelamentoMatch[1]}x de ${parcelamentoMatch[2]} sem juros`;
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
      parcelamento = `ðŸ’³ Ou ${vezes}x de ${precoParcela.texto} sem juros`;
    }
  }
}

if (pixMatch?.[1]) {
  precoAtual = pixMatch[1].trim();
  avisoPagamento = "Ã€ vista no PIX";
}

if (!avisoPagamento && precoAtual && html.toLowerCase().includes("vista no pix")) {
  avisoPagamento = "Ã€ vista no PIX";
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

  const parcelasProvaveis = unicos.filter(p => {
    return unicos.some(outro => {
      if (outro.numero <= p.numero) return false;

      const vezes = Math.round(outro.numero / p.numero);
      const diferenca = Math.abs(outro.numero - p.numero * vezes);

      return vezes >= 2 && vezes <= 12 && diferenca < 2;
    });
  });

  const semParcelas = unicos.filter(p =>
    !parcelasProvaveis.some(pp => pp.numero === p.numero)
  );

  const ordenados = [...semParcelas].sort((a, b) => a.numero - b.numero);

  precoAtual = ordenados[0]?.texto || "";

  const possivelAntigo = [...semParcelas]
    .filter(p => p.numero > (ordenados[0]?.numero || 0))
    .sort((a, b) => b.numero - a.numero)[0];

  if (possivelAntigo) {
    precoAntigo = possivelAntigo.texto;
  }
}

console.log("[INFO] PREOS KABUM EXTRADOS:", precosEncontrados.slice(0, 20));
console.log("[INFO] PREOS VALIDOS:", precosValidos.slice(0, 20));


  const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

console.log("[API] KABUM IMPORTADO FINAL:", {
  titulo,
  precoAtual,
  precoAntigo,
  imagem,
  avisoPagamento,
  parcelamento,
  linkAfiliado
});

avisoPagamento = avisoPagamento || "";

  return {
  marketplace: "kabum",
  titulo: tituloFinal,
  produtoId: diagnosticoProduto.produtoIdCanonico || "",
  produtoIdCanonico: diagnosticoProduto.produtoIdCanonico || "",
  chaveCanonica: diagnosticoProduto.chaveCanonica || "",
  precoAtual,
  preco: precoAtual,
  precoAntigo,
  avisoPagamento,
  avisoCupom: "",
  parcelamento,
  linkOriginal: url,
  link: linkAfiliado || url,
  linkAfiliado: linkAfiliado || url,
  imagem,
  categoria: "Gamer e Hardware"
};
}

module.exports = {
  importarProdutoKabumViaAwin,
  diagnosticarProdutoKabum,
  limparSufixoTituloKabum,
  normalizarTituloKabum,
  tituloGenericoKabum
};
