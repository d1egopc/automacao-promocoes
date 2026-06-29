const {
  registrarAlertaIntegracao,
  limparAlertaIntegracao
} = require("../../utils/alertas-integracoes");

const {
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  limparPreco,
  corrigirImagemUrl
} = require("./utils");

function extrairValorMlHtml(html = "", campos = []) {
  for (const campo of campos) {
    const re = new RegExp(`"${campo}"\\s*:\\s*"([^"]{1,500})"`, "i");
    const valor = html.match(re)?.[1];
    if (valor) return htmlDecode(valor).trim();
  }

  return "";
}

function normalizarPrecoMl(valor = "") {
  const texto = String(valor || "")
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!texto) return "";

  let numero = 0;

  if (/^\d+(?:\.\d{1,2})$/.test(texto)) {
    numero = Number(texto);
  } else if (/^\d+(?:,\d{1,2})$/.test(texto)) {
    numero = Number(texto.replace(",", "."));
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(texto)) {
    numero = Number(texto.replace(/\./g, "").replace(",", "."));
  } else if (/^\d+$/.test(texto)) {
    numero = Number(texto);
  }

  if (!Number.isFinite(numero) || numero <= 0) return "";

  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: texto.includes(",") || texto.includes(".") ? 2 : 0,
    maximumFractionDigits: 2
  });
}

function extrairPrecoMlHtml(html = "") {
  const candidatos = [
    html.match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"current_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"price_amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
    html.match(/"fraction"\s*:\s*"?(\d{1,6})"?[^}]{0,180}"cents"\s*:"?(\d{1,2})"?/)?.slice(1, 3).join("."),
    html.match(/R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})/)?.[1]
  ].filter(Boolean);

  const bruto = candidatos.find(Boolean) || "";
  if (!bruto) return "";

  return normalizarPrecoMl(bruto) || limparPreco(bruto);
}

function normalizarTextoMlImportador(texto = "") {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tituloGenericoMercadoLivre(titulo = "") {
  const normalizado = normalizarTextoMlImportador(titulo);
  return !normalizado || normalizado === "produto mercado livre";
}

function formatarPrecoMlImportador(numero = 0) {
  return Number(numero).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function numeroPrecoMlImportador(valor = "") {
  const texto = String(valor || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const numero = Number(texto);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function limparLinhaTituloRadarMl(linha = "") {
  return String(linha || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/^[\s\-_*:\|\u2022]+/g, "")
    .replace(/[\s\-_*:\|\u2022]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTextoRadarMercadoLivre(deps = {}) {
  const contexto = deps.contextoRadar || deps.radar || deps.ofertaRadar || deps.contexto || {};

  return [
    deps.textoOriginal,
    deps.mensagemOriginalRadar,
    deps.textoRadar,
    contexto.textoOriginal,
    contexto.texto,
    contexto.mensagemOriginalRadar,
    contexto.mensagem,
    contexto.caption,
    contexto.descricao
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extrairTituloTextoRadarMl(texto = "") {
  const semLinks = String(texto || "")
    .replace(/https?:\/\/\S*(?:meli\.la|mercadolivre\.com\.br)\S*/gi, "");

  const linhas = semLinks
    .split(/\r?\n+/)
    .map(limparLinhaTituloRadarMl)
    .filter(Boolean);

  const rejeitar = /^(?:r\$|por\b|de\b|cupom\b|use\b|frete\b|link\b|compre\b|aproveite\b|promo\b|oferta\b|saindo\b|valor\b)/i;
  const candidatos = linhas.filter(linha => {
    if (linha.length < 8) return false;
    if (/^r\$\s*[\d.,]+$/i.test(linha)) return false;
    if (rejeitar.test(linha)) return false;
    if (/\b(cupom|frete|cashback|desconto|off)\b/i.test(linha) && linha.length < 35) return false;
    return /[a-zA-Z\u00c0-\u00ff]{3,}/.test(linha);
  });

  return (candidatos[0] || linhas.find(linha => /[a-zA-Z\u00c0-\u00ff]{3,}/.test(linha)) || "")
    .slice(0, 180)
    .trim();
}

function extrairPrecoTextoRadarMl(texto = "") {
  const original = String(texto || "");
  if (!original.trim()) return { ok: false, motivo: "texto_vazio" };

  if (/r\$\s*[\d.,]+\s*(?:a|ate|at\u00e9|-)\s*r?\$?\s*[\d.,]+/i.test(original)) {
    return { ok: false, motivo: "faixa_preco" };
  }

  const padraoPor = /(?:\bpor\b|\bsai\s+por\b|\bsaindo\s+por\b|\bvalor\s+final\b|\bpre[c\u00e7]o\s+final\b)\s*:?\s*r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/gi;
  const candidatosPor = [...original.matchAll(padraoPor)]
    .map(match => numeroPrecoMlImportador(match[1]))
    .filter(numero => numero > 0);
  const unicosPor = [...new Set(candidatosPor.map(numero => numero.toFixed(2)))];

  if (unicosPor.length === 1) {
    return {
      ok: true,
      preco: formatarPrecoMlImportador(Number(unicosPor[0])),
      origem: "texto_radar_por"
    };
  }
  if (unicosPor.length > 1) return { ok: false, motivo: "multiplos_precos_por" };

  const matches = [...original.matchAll(/r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/gi)];
  const candidatos = [];

  for (const match of matches) {
    const inicio = Math.max(0, match.index - 35);
    const fim = Math.min(original.length, match.index + match[0].length + 35);
    const contextoPreco = normalizarTextoMlImportador(original.slice(inicio, fim));

    if (/\b(cupom|off|desconto|cashback|frete)\b/.test(contextoPreco)) continue;

    const numero = numeroPrecoMlImportador(match[1]);
    if (numero > 0) candidatos.push(numero.toFixed(2));
  }

  const unicos = [...new Set(candidatos)];
  if (unicos.length === 1 && !/\b(de|era|antes)\s+r\$/i.test(original)) {
    return {
      ok: true,
      preco: formatarPrecoMlImportador(Number(unicos[0])),
      origem: "texto_radar_preco_unico"
    };
  }

  if (matches.length > 0) {
    return {
      ok: false,
      motivo: unicos.length > 1 || candidatos.length !== matches.length ? "ambiguidade" : "preco_nao_confirmado"
    };
  }

  return { ok: false, motivo: "sem_preco_texto" };
}

function extrairTituloSlugMercadoLivre(url = "") {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname || "");
    const match = pathname.match(/\/MLB-?\d+-([^/]+?)-?_JM$/i);
    if (!match?.[1]) return "";

    const titulo = match[1]
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, letra => letra.toUpperCase());

    return tituloGenericoMercadoLivre(titulo) ? "" : titulo;
  } catch {
    return "";
  }
}

function aplicarFallbacksRadarMercadoLivre(produto = {}, deps = {}, urls = {}) {
  const textoRadar = extrairTextoRadarMercadoLivre(deps);
  const link = urls.urlFinal || urls.urlOriginal || "";
  const resultado = { ...produto };
  const eventos = [];

  if (tituloGenericoMercadoLivre(resultado.titulo)) {
    const tituloTexto = extrairTituloTextoRadarMl(textoRadar);
    const tituloSlug = extrairTituloSlugMercadoLivre(link);
    const tituloFallback = tituloTexto || tituloSlug;

    if (tituloFallback && !tituloGenericoMercadoLivre(tituloFallback)) {
      resultado.titulo = tituloFallback;
      resultado.nome = tituloFallback;
      resultado.tituloOrigem = tituloTexto ? "texto_radar" : "slug_url";
      resultado.fallbackTituloMercadoLivre = true;
      eventos.push({
        campo: "titulo",
        origem: resultado.tituloOrigem,
        valor: tituloFallback
      });
    }
  }

  if (!resultado.precoAtual && !resultado.preco) {
    const precoTexto = extrairPrecoTextoRadarMl(textoRadar);

    if (precoTexto.ok) {
      resultado.precoAtual = precoTexto.preco;
      resultado.preco = precoTexto.preco;
      resultado.precoOrigem = "texto_radar";
      resultado.avisoPreco = "Preco extraido da mensagem do Radar";
      resultado.fallbackPrecoMercadoLivre = true;
      eventos.push({
        campo: "preco",
        origem: precoTexto.origem,
        valor: precoTexto.preco
      });
    } else if (textoRadar) {
      resultado.motivoPrecoFallbackMercadoLivre = precoTexto.motivo;
    }
  }

  if (eventos.length) {
    console.log("ml_importador_fallback_radar_usado", {
      link,
      eventos
    });
  }

  return resultado;
}

function criarPerfImportacaoManualMl(clienteIdAlvo = "admin", url = "") {
  const inicio = Date.now();
  let ultimaEtapa = inicio;
  const etapas = [];

  return {
    etapa(nome, detalhes = {}) {
      const agora = Date.now();
      etapas.push({
        etapa: nome,
        duracaoMs: agora - ultimaEtapa,
        desdeInicioMs: agora - inicio,
        ...detalhes
      });
      ultimaEtapa = agora;
    },
    fim(status = "ok", detalhes = {}) {
      console.log("[PERF][ML_IMPORTACAO_MANUAL]", {
        clienteId: clienteIdAlvo,
        status,
        duracaoTotalMs: Date.now() - inicio,
        url,
        etapas,
        ...detalhes
      });
    }
  };
}

async function importarMercadoLivre(url, clienteIdAlvo = "admin", deps = {}) {
  const perf = criarPerfImportacaoManualMl(clienteIdAlvo, url);
  const {
    getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre
  } = deps;

  try {
    const integracaoML = getIntegracaoCliente(clienteIdAlvo, "mercadolivre");
    const cookies = integracaoML?.credenciais?.cookies || "";

    perf.etapa("inicio_importador", {
      temIntegracao: !!integracaoML,
      temCookies: !!cookies
    });

    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language":
          "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Referer": "https://www.google.com/",
        ...(cookies ? { Cookie: cookies } : {})
      }
    });

    perf.etapa("busca_abre_link", {
      httpStatus: response.status,
      urlFinal: response.url
    });

    console.log("🧪 ML IMPORTADOR MANUAL", {
      clienteIdAlvo,
      temCookies: !!cookies,
      status: response.status,
      urlOriginal: url,
      urlFinal: response.url
    });

    if (
      response.status === 403 ||
      response.status === 429 ||
      response.url.includes("account-verification") ||
      response.url.includes("login")
    ) {
      registrarAlertaIntegracao(clienteIdAlvo, "mercadolivre", {
        tipo: "cookie_invalido",
        status: "atencao",
        mensagem: "Atualize os cookies do Mercado Livre para manter a captura de ofertas funcionando.",
        detalhes: {
          httpStatus: response.status,
          urlFinal: response.url
        }
      });

      perf.fim("bloqueado_cookie", {
        httpStatus: response.status,
        urlFinal: response.url
      });
      return null;
    }

    const html = await response.text();
    perf.etapa("download_html", {
      tamanhoHtml: html.length
    });

    const jsonLd = extrairJsonLd(html);

    let titulo =
      jsonLd?.name ||
      extrairMeta(html, "og:title") ||
      extrairMeta(html, "twitter:title") ||
      extrairValorMlHtml(html, ["poly_component_title", "name", "title"]) ||
      "Produto Mercado Livre";

    let preco =
      jsonLd?.offers?.price ||
      extrairMeta(html, "product:price:amount") ||
      extrairMeta(html, "og:price:amount") ||
      extrairPrecoMlHtml(html) ||
      "";

    const imagem =
      (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
      extrairMeta(html, "og:image") ||
      extrairMeta(html, "twitter:image") ||
      "";

    preco = normalizarPrecoMl(preco) || limparPreco(preco);

    // Correção ML: jsonLd às vezes vem como 48.9 e limparPreco vira 489.
    if (
      jsonLd?.offers?.price !== undefined &&
      String(jsonLd.offers.price).includes(".") &&
      !String(jsonLd.offers.price).includes(",")
    ) {
      preco = Number(jsonLd.offers.price)
        .toFixed(2)
        .replace(".", ",");
    }

    let precoNumero = Number(String(preco).replace(",", "."));
    let precoAntigo = "";

    const descontoMatch =
      html.match(/(\d{1,2})\s*%\s*OFF/i) ||
      html.match(/"discount_rate"\s*:\s*(\d{1,2})/i) ||
      html.match(/"discountPercentage"\s*:\s*(\d{1,2})/i) ||
      html.match(/(\d{1,2})\s*%\s*de desconto/i);
    const descontoReal = descontoMatch ? Number(descontoMatch[1]) : 0;

    if (
      Number.isFinite(precoNumero) &&
      precoNumero > 0 &&
      descontoReal > 0 &&
      descontoReal < 90
    ) {
      precoAntigo = (precoNumero / (1 - descontoReal / 100))
        .toFixed(2)
        .replace(".", ",");
    }

    if (!preco) {
      console.log("ml_importacao_sem_preco_html", {
        clienteId: clienteIdAlvo,
        urlOriginal: url,
        urlFinal: response.url,
        httpStatus: response.status,
        tamanhoHtml: html.length,
        temTitulo: !!titulo
      });
    }

    perf.etapa("extracao_preco_titulo_imagem", {
      temTitulo: !!titulo,
      temPreco: !!preco,
      temImagem: !!imagem
    });

    const linkAfiliadoGerado = await gerarLinkAfiliadoMercadoLivre(
      url,
      getIntegracaoCliente(clienteIdAlvo, "mercadolivre"),
      { clienteId: clienteIdAlvo }
    );

    perf.etapa("geracao_link_afiliado", {
      gerouLinkAfiliado: !!linkAfiliadoGerado,
      linkCurtoMeli: /^https?:\/\/meli\.la\//i.test(String(linkAfiliadoGerado || ""))
    });

    const tituloLimpo = htmlDecode(titulo)
      .replace(" | MercadoLivre", "")
      .replace(" | Mercado Livre", "")
      .trim();

    const produtoComFallbackRadar = aplicarFallbacksRadarMercadoLivre({
      titulo: tituloLimpo,
      precoAtual: preco,
      precoAntigo,
      cupom: "",
      imagem: corrigirImagemUrl(imagem) || imagem
    }, deps, {
      urlOriginal: url,
      urlFinal: response.url
    });

    limparAlertaIntegracao(clienteIdAlvo, "mercadolivre");
    perf.etapa("salvamento_retorno", {
      limpouAlerta: true
    });

    perf.fim("ok", {
      temPreco: !!(produtoComFallbackRadar.precoAtual || produtoComFallbackRadar.preco),
      temTitulo: !!produtoComFallbackRadar.titulo,
      gerouLinkAfiliado: !!linkAfiliadoGerado
    });

    return {
      marketplace: "mercadolivre",
      titulo: produtoComFallbackRadar.titulo,
      nome: produtoComFallbackRadar.nome || produtoComFallbackRadar.titulo,
      precoAntigo: produtoComFallbackRadar.precoAntigo || precoAntigo,
      precoAtual: produtoComFallbackRadar.precoAtual || produtoComFallbackRadar.preco || "",
      preco: produtoComFallbackRadar.preco || produtoComFallbackRadar.precoAtual || "",
      cupom: produtoComFallbackRadar.cupom || "",
      linkOriginal: url,
      link: linkAfiliadoGerado || "",
      linkAfiliado: linkAfiliadoGerado || "",
      linkFinal: linkAfiliadoGerado || "",
      imagem: produtoComFallbackRadar.imagem || "",
      categoria: "Mercado Livre",
      tituloOrigem: produtoComFallbackRadar.tituloOrigem,
      precoOrigem: produtoComFallbackRadar.precoOrigem,
      avisoPreco: produtoComFallbackRadar.avisoPreco,
      fallbackTituloMercadoLivre: produtoComFallbackRadar.fallbackTituloMercadoLivre,
      fallbackPrecoMercadoLivre: produtoComFallbackRadar.fallbackPrecoMercadoLivre,
      motivoPrecoFallbackMercadoLivre: produtoComFallbackRadar.motivoPrecoFallbackMercadoLivre
    };
  } catch (e) {
    perf.fim("erro", {
      erro: e.message
    });
    throw e;
  }
}

module.exports = {
  importarMercadoLivre
};
