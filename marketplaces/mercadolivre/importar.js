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

function extrairMlbUrl(url = "") {
  return String(url || "").match(/\bMLB-?(\d{6,})\b/i)?.[1] || "";
}

function urlMercadoLivreCurtaSemSlug(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    return (
      parsed.hostname.toLowerCase() === "produto.mercadolivre.com.br" &&
      /^\/MLB-?\d+\/?$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function extrairUrlCanonicaMercadoLivre(html = "") {
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1] ||
    extrairMeta(html, "og:url") ||
    "";

  return htmlDecode(canonical).trim();
}

function urlCanonicaMercadoLivreSegura(urlCandidata = "", urlOriginal = "") {
  try {
    const candidata = new URL(String(urlCandidata || ""));
    const mlbOriginal = extrairMlbUrl(urlOriginal);
    const mlbCandidata = extrairMlbUrl(candidata.toString());

    return Boolean(
      candidata.protocol === "https:" &&
      candidata.hostname.toLowerCase().endsWith("mercadolivre.com.br") &&
      mlbOriginal &&
      mlbCandidata &&
      mlbOriginal === mlbCandidata &&
      !urlMercadoLivreCurtaSemSlug(candidata.toString())
    );
  } catch {
    return false;
  }
}

function normalizarNumeroMercadoLivre(valor = "") {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? valor : 0;
  }

  const texto = String(valor || "")
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!texto) return 0;

  let normalizado = texto.replace(/[^\d.,]/g, "");
  if (!normalizado) return 0;

  const temVirgula = normalizado.includes(",");
  const temPonto = normalizado.includes(".");

  if (temVirgula && temPonto) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    normalizado = normalizado.replace(",", ".");
  } else if (temPonto) {
    const partes = normalizado.split(".");
    const ultimo = partes[partes.length - 1] || "";
    const milhares = /^\d{1,3}(?:\.\d{3})+$/.test(normalizado);
    normalizado = milhares && ultimo.length === 3
      ? normalizado.replace(/\./g, "")
      : normalizado;
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function normalizarPrecoMl(valor = "") {
  const numero = normalizarNumeroMercadoLivre(valor);
  if (!numero) return "";

  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
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

function textoHtmlMl(html = "") {
  return htmlDecode(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function normalizarCupomMercadoLivre(cupom = "") {
  const codigo = String(cupom || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").trim();
  const bloqueados = new Set(["COPIADO", "APPLIED", "APPEARANCE", "APPLINK", "MERCADOLIVRE", "CUPOM", "CODIGO", "PROMOCAO"]);

  if (!codigo || codigo.length < 4 || codigo.length > 24 || bloqueados.has(codigo)) return "";
  if (!/[A-Z]/.test(codigo)) return "";
  return codigo;
}

function extrairCupomMlHtml(html = "") {
  const texto = textoHtmlMl(html);
  const match =
    texto.match(/(?:cupom|use o cupom|aplique o cupom|codigo promocional)\s*:?\s*([A-Z0-9_-]{4,24})/i) ||
    texto.match(/\b([A-Z]{3,}[A-Z0-9_-]{1,21})\b\s*(?:no carrinho|para ganhar|para desconto)/i);

  const cupom = normalizarCupomMercadoLivre(match?.[1] || "");
  if (!cupom) return { cupom: "", tipoCupom: "", avisoCupom: "" };

  return {
    cupom,
    tipoCupom: "detectado_html",
    avisoCupom: `Aplique o cupom ${cupom} antes de finalizar.`
  };
}

function extrairCupomTextoRadarMl(textoRadar = "") {
  const texto = String(textoRadar || "");
  const match =
    texto.match(/(?:cupom|use o cupom|aplique o cupom|codigo promocional|c[oó]digo promocional)\s*:?\s*([A-Z0-9_-]{4,24})/i) ||
    texto.match(/\b([A-Z]{3,}[A-Z0-9_-]{1,21})\b\s*(?:no carrinho|para ganhar|para desconto|com cupom)/i);

  const cupom = normalizarCupomMercadoLivre(match?.[1] || "");
  if (!cupom) return { cupom: "", tipoCupom: "", avisoCupom: "" };

  return {
    cupom,
    tipoCupom: "texto_radar",
    cupomTipo: "texto_radar",
    avisoCupom: `Aplique o cupom ${cupom} antes de finalizar.`
  };
}

function extrairBeneficiosMlHtml(html = "") {
  const texto = textoHtmlMl(html);
  const beneficios = [];

  const temCupomGenerico = /cupom|codigo promocional|desconto extra|aplicar desconto/i.test(texto);
  const compraNoApp = /(?:desconto|oferta|preco)\s+(?:no|pelo)\s+app|aplicativo/i.test(texto);
  const freteGratis = /frete\s+gratis|envio\s+gratis/i.test(texto);
  const cashbackMatch = texto.match(/cashback\s*(?:de|ate)?\s*(R\$\s*[0-9.,]+|[0-9]{1,3}%)/i);
  const pixMatch = texto.match(/(?:pix|pagamento via pix)[^\.]{0,80}?(R\$\s*[0-9.,]+|[0-9]{1,3}%)/i);
  const appMatch = texto.match(/(?:app|aplicativo)[^\.]{0,80}?(R\$\s*[0-9.,]+|[0-9]{1,3}%)/i);

  if (freteGratis) beneficios.push("Frete gratis");
  if (cashbackMatch?.[1]) beneficios.push(`Cashback ${cashbackMatch[1].trim()}`);
  if (pixMatch?.[1]) beneficios.push(`Desconto no Pix ${pixMatch[1].trim()}`);
  if (appMatch?.[1]) beneficios.push(`Desconto no app ${appMatch[1].trim()}`);
  if (compraNoApp) beneficios.push("Pode haver beneficio pelo app do Mercado Livre");

  return {
    avisoCupomGenerico: temCupomGenerico ? "Pode haver cupom disponivel. Confira no carrinho/app do Mercado Livre." : "",
    beneficioExtra: beneficios.join(" | "),
    freteGratis,
    cashback: cashbackMatch?.[1]?.trim() || "",
    descontoPix: pixMatch?.[1]?.trim() || "",
    descontoApp: appMatch?.[1]?.trim() || ""
  };
}

function extrairParcelamentoMlHtml(html = "") {
  const texto = textoHtmlMl(html);
  const match =
    texto.match(/(?:em\s+)?(\d{1,2})\s*x\s*(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,\d{2}|[0-9]+,\d{2})(?:\s*sem\s+juros)?/i) ||
    texto.match(/(\d{1,2})\s*parcelas\s*(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,\d{2}|[0-9]+,\d{2})/i);

  if (!match) return "";
  const semJuros = /sem\s+juros/i.test(match[0]);
  return `${match[1]}x de R$ ${match[2]}${semJuros ? " sem juros" : ""}`;
}

function calcularEconomiaMl(precoAntigo = "", precoAtual = "") {
  const antigo = numeroPrecoMlImportador(precoAntigo);
  const atual = numeroPrecoMlImportador(precoAtual);
  if (!antigo || !atual || atual >= antigo) return "";
  return (antigo - atual).toFixed(2);
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
  return normalizarNumeroMercadoLivre(valor);
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

  if (!resultado.cupom) {
    const cupomTexto = extrairCupomTextoRadarMl(textoRadar);
    if (cupomTexto.cupom) {
      resultado.cupom = cupomTexto.cupom;
      resultado.tipoCupom = cupomTexto.tipoCupom;
      resultado.cupomTipo = cupomTexto.cupomTipo || cupomTexto.tipoCupom;
      resultado.avisoCupom = resultado.avisoCupom || cupomTexto.avisoCupom;
      resultado.cupomOrigem = "texto_radar";
      eventos.push({
        campo: "cupom",
        origem: "texto_radar",
        valor: cupomTexto.cupom
      });
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

    const fetchOptions = {
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
    };
    let response = await fetch(url, fetchOptions);

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

    let html = await response.text();

    if (urlMercadoLivreCurtaSemSlug(url)) {
      let urlFinal = response.url || url;
      let resolveu = !urlMercadoLivreCurtaSemSlug(urlFinal);

      if (!resolveu) {
        const urlCanonica = extrairUrlCanonicaMercadoLivre(html);

        if (urlCanonicaMercadoLivreSegura(urlCanonica, url)) {
          try {
            const responseCanonica = await fetch(urlCanonica, fetchOptions);
            const htmlCanonico = await responseCanonica.text();

            if (responseCanonica.status < 400 && htmlCanonico) {
              response = responseCanonica;
              html = htmlCanonico;
              urlFinal = responseCanonica.url || urlCanonica;
              resolveu = !urlMercadoLivreCurtaSemSlug(urlCanonica) || !urlMercadoLivreCurtaSemSlug(urlFinal);
            }
          } catch {}
        }
      }

      console.log("[ML-LINK-RESOLVIDO]", JSON.stringify({
        urlOriginal: url,
        urlFinal: response.url || urlFinal || url,
        resolveu
      }));
    }

    const jsonLd = extrairJsonLd(html);
    const tituloJsonLd = jsonLd?.name || "";
    const tituloOg = extrairMeta(html, "og:title");
    const tituloTwitter = extrairMeta(html, "twitter:title");
    const tituloHtml = extrairValorMlHtml(html, ["poly_component_title", "name", "title"]);
    const precoAuditoriaBruto =
      jsonLd?.offers?.price ||
      extrairMeta(html, "product:price:amount") ||
      extrairMeta(html, "og:price:amount") ||
      extrairPrecoMlHtml(html) ||
      "";
    const imagemJsonLd = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
    const imagemOg = extrairMeta(html, "og:image");
    const imagemTwitter = extrairMeta(html, "twitter:image");
    const imagemAuditoria = imagemJsonLd || imagemOg || imagemTwitter || "";
    const origemImagemAuditoria =
      imagemJsonLd ? "jsonLd.image" :
      imagemOg ? "og:image" :
      imagemTwitter ? "twitter:image" :
      "nenhuma";
    const bloqueioOperacional =
      response.status === 403 ||
      response.status === 429 ||
      response.url.includes("account-verification") ||
      response.url.includes("login");
    const temBloqueioAuditoria = Boolean(
      bloqueioOperacional ||
      /captcha|account-verification|access denied|robot check|verifique[^<]{0,80}rob/i.test(html)
    );
    const contextoEngine = deps.contextoEngine || {};

    if (bloqueioOperacional) {
      console.log("[ML-HTML-AUDITORIA]", JSON.stringify({
        clienteId: contextoEngine.clienteId || clienteIdAlvo,
        jobId: contextoEngine.jobId || null,
        urlOriginal: url,
        urlFinal: response.url || url,
        statusHttp: response.status,
        tamanhoHtml: html.length,
        temBloqueio: temBloqueioAuditoria,
        temTituloProduto: Boolean(tituloJsonLd || tituloOg || tituloTwitter || tituloHtml),
        temJsonLd: Boolean(jsonLd),
        temOgTitle: Boolean(tituloOg),
        temOgImage: Boolean(imagemOg),
        temTwitterImage: Boolean(imagemTwitter),
        tituloExtraido: htmlDecode(tituloJsonLd || tituloOg || tituloTwitter || tituloHtml || "").trim(),
        precoAtual: normalizarPrecoMl(precoAuditoriaBruto) || limparPreco(precoAuditoriaBruto) || "",
        temImagem: Boolean(imagemAuditoria),
        origemImagem: origemImagemAuditoria
      }));
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

    perf.etapa("download_html", {
      tamanhoHtml: html.length
    });

    let titulo =
      tituloJsonLd ||
      tituloOg ||
      tituloTwitter ||
      tituloHtml ||
      "Produto Mercado Livre";

    let preco = precoAuditoriaBruto;

    const imagem =
      imagemJsonLd ||
      imagemOg ||
      imagemTwitter ||
      "";
    const origemImagem =
      imagemJsonLd ? "jsonLd.image" :
      imagemOg ? "og:image" :
      imagemTwitter ? "twitter:image" :
      "nenhuma";

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

    let precoNumero = numeroPrecoMlImportador(preco);
    let precoAntigo = "";

    const descontoMatch =
      html.match(/(\d{1,2})\s*%\s*OFF/i) ||
      html.match(/"discount_rate"\s*:\s*(\d{1,2})/i) ||
      html.match(/"discountPercentage"\s*:\s*(\d{1,2})/i) ||
      html.match(/(\d{1,2})\s*%\s*de desconto/i);
    const descontoReal = descontoMatch ? Number(descontoMatch[1]) : 0;
    const cupomHtml = extrairCupomMlHtml(html);
    const beneficiosHtml = extrairBeneficiosMlHtml(html);
    const parcelamento = extrairParcelamentoMlHtml(html);

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

    console.log("[ML-IMAGEM-ORIGEM]", JSON.stringify({
      titulo: tituloLimpo,
      url: response.url || url,
      temImagem: Boolean(imagem),
      origemImagem,
      imagemPreview: String(corrigirImagemUrl(imagem) || imagem || "").slice(0, 140)
    }));

    const produtoComFallbackRadar = aplicarFallbacksRadarMercadoLivre({
      titulo: tituloLimpo,
      precoAtual: preco,
      precoAntigo,
      precoOriginal: precoAntigo,
      descontoPercentual: descontoReal || "",
      economia: calcularEconomiaMl(precoAntigo, preco),
      cupom: cupomHtml.cupom || "",
      tipoCupom: cupomHtml.tipoCupom || (beneficiosHtml.avisoCupomGenerico ? "possivel_html" : ""),
      cupomTipo: cupomHtml.tipoCupom || (beneficiosHtml.avisoCupomGenerico ? "possivel_html" : ""),
      avisoCupom: cupomHtml.avisoCupom || beneficiosHtml.avisoCupomGenerico || "",
      beneficioExtra: beneficiosHtml.beneficioExtra || "",
      parcelamento,
      freteGratis: beneficiosHtml.freteGratis === true,
      cashback: beneficiosHtml.cashback || "",
      descontoPix: beneficiosHtml.descontoPix || "",
      descontoApp: beneficiosHtml.descontoApp || "",
      imagem: corrigirImagemUrl(imagem) || imagem
    }, deps, {
      urlOriginal: url,
      urlFinal: response.url
    });

    console.log("[ML-HTML-AUDITORIA]", JSON.stringify({
      clienteId: contextoEngine.clienteId || clienteIdAlvo,
      jobId: contextoEngine.jobId || null,
      urlOriginal: url,
      urlFinal: response.url || url,
      statusHttp: response.status,
      tamanhoHtml: html.length,
      temBloqueio: temBloqueioAuditoria,
      temTituloProduto: Boolean(tituloJsonLd || tituloOg || tituloTwitter || tituloHtml),
      temJsonLd: Boolean(jsonLd),
      temOgTitle: Boolean(tituloOg),
      temOgImage: Boolean(imagemOg),
      temTwitterImage: Boolean(imagemTwitter),
      tituloExtraido: produtoComFallbackRadar.titulo || tituloLimpo || "",
      precoAtual: produtoComFallbackRadar.precoAtual || produtoComFallbackRadar.preco || preco || "",
      temImagem: Boolean(produtoComFallbackRadar.imagem || imagem),
      origemImagem
    }));

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
      precoOriginal: produtoComFallbackRadar.precoOriginal || produtoComFallbackRadar.precoAntigo || precoAntigo,
      precoAtual: produtoComFallbackRadar.precoAtual || produtoComFallbackRadar.preco || "",
      preco: produtoComFallbackRadar.preco || produtoComFallbackRadar.precoAtual || "",
      descontoPercentual: produtoComFallbackRadar.descontoPercentual || descontoReal || "",
      economia: produtoComFallbackRadar.economia || calcularEconomiaMl(produtoComFallbackRadar.precoAntigo || precoAntigo, produtoComFallbackRadar.precoAtual || produtoComFallbackRadar.preco || preco),
      cupom: produtoComFallbackRadar.cupom || "",
      avisoCupom: produtoComFallbackRadar.avisoCupom || "",
      tipoCupom: produtoComFallbackRadar.tipoCupom || produtoComFallbackRadar.cupomTipo || "",
      cupomTipo: produtoComFallbackRadar.cupomTipo || produtoComFallbackRadar.tipoCupom || "",
      beneficioExtra: produtoComFallbackRadar.beneficioExtra || "",
      parcelamento: produtoComFallbackRadar.parcelamento || "",
      freteGratis: produtoComFallbackRadar.freteGratis === true,
      cashback: produtoComFallbackRadar.cashback || "",
      descontoPix: produtoComFallbackRadar.descontoPix || "",
      descontoApp: produtoComFallbackRadar.descontoApp || "",
      linkOriginal: url,
      urlFinal: response.url || url,
      statusHttp: response.status,
      link: linkAfiliadoGerado || "",
      linkAfiliado: linkAfiliadoGerado || "",
      linkFinal: linkAfiliadoGerado || "",
      imagem: produtoComFallbackRadar.imagem || "",
      imagemOrigem: produtoComFallbackRadar.imagem ? origemImagem : "nenhuma",
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
