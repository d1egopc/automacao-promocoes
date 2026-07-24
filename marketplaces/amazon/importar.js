const { normalizarNumeroMoeda } = require("../../utils/moeda");
function criarImportarAmazon(deps = {}) {
  const {
    extrairJsonLd,
    extrairMeta,
    htmlDecode,
    limparPreco,
    corrigirImagemUrl,
    limparLinkAmazon,
    gerarLinkOptimus,
    extrairCuponsAmazonDoHtml,
    detectarAvisoCupomAmazon,
    escolherCupomParaOfertaAmazon
  } = deps;

  return async function importarAmazon(url, config = {}) {
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    const cookies = config?.credenciais?.cookies || "";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookies
      }
    });

    const html = await response.text();
    const jsonLd = extrairJsonLd(html);
    const contextoEngine = config.contextoEngine || {};
    const temCaptchaAuditoria = /captcha|captchacharacters|validateCaptcha/i.test(html);
    const temRobotCheckAuditoria = /robot check|automated access|api-services-support@amazon|sorry[^<]{0,80}robot/i.test(html);
    const temProductTitleAuditoria = /id=["']productTitle["']/i.test(html);
    const temOgTitleAuditoria = Boolean(extrairMeta(html, "og:title"));
    const temOgImageAuditoria = Boolean(extrairMeta(html, "og:image"));
    const temDynamicImageAuditoria = /data-a-dynamic-image=["'][^"']+["']/i.test(html);

    function limparHtml(texto) {
      if (!texto) return "";
      return htmlDecode(
        String(texto)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      );
    }

    function primeiroMatch(regex) {
      const match = html.match(regex);
      return match?.[1] ? limparHtml(match[1]) : "";
    }

    function primeiroMatchDetalhado(regex, origem) {
      const match = html.match(regex);
      const bruto = match?.[1]
        ? String(match[1]).replace(/\s+/g, " ").trim()
        : "";

      return {
        origem,
        bruto,
        valor: bruto ? limparHtml(bruto) : ""
      };
    }

    function numeroPrecoAmazon(valor) {
      return normalizarNumeroMoeda(valor) || 0;
    }

    function formatarPrecoAmazon(numero = 0) {
      return Number(numero).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function normalizarPrecoAmazon(valor = "") {
      const numero = numeroPrecoAmazon(valor);
      return numero ? formatarPrecoAmazon(numero) : "";
    }

    function textoOriginalRadarAmazon() {
      const contexto = config.contextoRadar || config.radar || config.ofertaRadar || config.contexto || {};
      return [
        config.textoOriginal,
        config.mensagemOriginalRadar,
        config.textoRadar,
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

    function extrairPrecoTextoRadarAmazon(textoRadar = "") {
      const original = String(textoRadar || "");
      if (!original.trim()) return { ok: false, motivo: "texto_vazio" };

      if (/r\$\s*[\d.,]+\s*(?:a|ate|até|-)\s*r?\$?\s*[\d.,]+/i.test(original)) {
        return { ok: false, motivo: "faixa_preco" };
      }

      const padraoPor = /(?:\bpor\b|\bsai\s+por\b|\bsaindo\s+por\b|\bvalor\s+final\b|\bpre[cç]o\s+final\b)\s*:?\s*r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:[,.][0-9]{2})?)/gi;
      const candidatosPor = [...original.matchAll(padraoPor)]
        .map(match => numeroPrecoAmazon(match[1]))
        .filter(numero => numero > 0);
      const unicosPor = [...new Set(candidatosPor.map(numero => numero.toFixed(2)))];

      if (unicosPor.length === 1) {
        return {
          ok: true,
          preco: formatarPrecoAmazon(Number(unicosPor[0])),
          numero: Number(unicosPor[0]),
          origem: "texto_radar_por"
        };
      }
      if (unicosPor.length > 1) return { ok: false, motivo: "multiplos_precos_por" };

      const matches = [...original.matchAll(/r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:[,.][0-9]{2})?)/gi)];
      const candidatos = [];

      for (const match of matches) {
        const inicio = Math.max(0, match.index - 35);
        const fim = Math.min(original.length, match.index + match[0].length + 35);
        const contextoPreco = original.slice(inicio, fim).toLowerCase();
        if (/\b(cupom|off|desconto|cashback|frete)\b/i.test(contextoPreco)) continue;

        const numero = numeroPrecoAmazon(match[1]);
        if (numero > 0) candidatos.push(numero.toFixed(2));
      }

      const unicos = [...new Set(candidatos)];
      if (unicos.length === 1 && !/\b(de|era|antes)\s+r\$/i.test(original)) {
        return {
          ok: true,
          preco: formatarPrecoAmazon(Number(unicos[0])),
          numero: Number(unicos[0]),
          origem: "texto_radar_preco_unico"
        };
      }

      if (matches.length > 0) {
        return { ok: false, motivo: unicos.length > 1 || candidatos.length !== matches.length ? "ambiguidade" : "preco_nao_confirmado" };
      }

      return { ok: false, motivo: "sem_preco_texto" };
    }

    function normalizarCupomTextoAmazon(cupom = "") {
      const codigo = String(cupom || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").trim();
      const bloqueados = new Set(["AMAZON", "CUPOM", "CODIGO", "PROMOCAO", "DESCONTO", "OFERTA", "PRIME", "APP", "SITE", "BRASIL", "COMPRE", "GANHE", "CLIENTE", "PARA"]);
      if (!codigo || codigo.length < 4 || codigo.length > 24 || bloqueados.has(codigo)) return "";
      if (!/[A-Z]/.test(codigo)) return "";
      return codigo;
    }

    function extrairCupomTextoRadarAmazon(textoRadar = "") {
      const fonte = String(textoRadar || "");
      const match =
        fonte.match(/(?:cupom|use o cupom|aplique o cupom|codigo promocional|c[oó]digo promocional|com o c[oó]digo)\s*:?\s*([A-Z0-9_-]{4,24})/i) ||
        fonte.match(/\b([A-Z]{3,}[A-Z0-9_-]{1,21})\b\s*(?:na amazon|amazon|no carrinho|para ganhar|para desconto|com cupom)/i);

      const cupom = normalizarCupomTextoAmazon(match?.[1] || "");
      if (!cupom) return { cupom: "", tipoCupom: "", avisoCupom: "" };
      return {
        cupom,
        tipoCupom: "texto_radar",
        avisoCupom: `Aplique o cupom ${cupom} antes de finalizar.`
      };
    }

    function extrairBeneficioTextoRadarAmazon(textoRadar = "") {
      const texto = String(textoRadar || "");
      const valorCupom = texto.match(/(?:cupom|desconto|off|economize)[^\n]{0,50}?(R\$\s*[0-9]{1,5}(?:[,.][0-9]{2})?)/i)?.[1] || "";
      if (valorCupom) return `${valorCupom.replace(/\s+/g, " ").trim()} OFF no cupom/pagina`;

      const percentual = texto.match(/(?:cupom|desconto|off|economize)[^\n]{0,50}?([0-9]{1,3}\s*%)/i)?.[1] || "";
      if (percentual) return `${percentual.replace(/\s+/g, "").trim()} OFF no cupom/pagina`;

      if (/frete\s+gr[aá]tis|envio\s+gr[aá]tis/i.test(texto)) return "Frete grátis";
      return "";
    }

    function deveUsarPrecoRadarAmazon(precoHtml = 0, precoRadar = 0) {
      if (!precoRadar) return false;
      if (!precoHtml) return true;
      if (Math.abs(precoHtml - (precoRadar * 100)) < 0.01) return true;
      const diferencaPercentual = Math.abs(precoHtml - precoRadar) / precoRadar;
      return diferencaPercentual > 0.25 || precoHtml > precoRadar * 1.5;
    }

    function extrairImagemAmazon() {
      const imagemJsonLd = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
      const imagemOg = extrairMeta(html, "og:image");
      const imagemTwitter = extrairMeta(html, "twitter:image");
      const imagemLanding = html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i)?.[1];
      const imagemOldHires = html.match(/data-old-hires=["']([^"']+)["']/i)?.[1];
      const imagemMeta =
        imagemJsonLd ||
        imagemOg ||
        imagemTwitter ||
        imagemLanding ||
        imagemOldHires ||
        "";

      if (imagemMeta) {
        const origemImagem =
          imagemJsonLd ? "jsonLd.image" :
          imagemOg ? "og:image" :
          imagemTwitter ? "twitter:image" :
          "html/gallery";
        return {
          imagem: htmlDecode(imagemMeta).replace(/\\u002F/g, "/"),
          origemImagem
        };
      }

      const dynamicImageRaw =
        html.match(/data-a-dynamic-image=["']([^"']+)["']/i)?.[1] || "";

      if (dynamicImageRaw) {
        try {
          const decoded = htmlDecode(dynamicImageRaw).replace(/\\u002F/g, "/");
          const parsed = JSON.parse(decoded);
          const primeira = Object.keys(parsed || {})[0];
          if (primeira) {
            return {
              imagem: primeira,
              origemImagem: "html/gallery"
            };
          }
        } catch {}
      }

      return {
        imagem: "",
        origemImagem: "nenhuma"
      };
    }

    const titulo =
      jsonLd?.name ||
      extrairMeta(html, "og:title") ||
      extrairMeta(html, "twitter:title") ||
      primeiroMatch(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) ||
      "Produto Amazon";

    const precoCoreDisplay = primeiroMatch(/id=["']corePriceDisplay_desktop_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const precoPriceToPay = primeiroMatch(/class=["'][^"']*priceToPay[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const precoJsonLd = jsonLd?.offers?.price || "";
    const precoProductPrice = extrairMeta(html, "product:price:amount");
    const precoOgPrice = extrairMeta(html, "og:price:amount");

    let origemPreco = "";
    let valorBrutoPreco = "";
    let preco = "";

    if (precoCoreDisplay) {
      origemPreco = "corePriceDisplay_desktop_feature_div .a-offscreen";
      valorBrutoPreco = precoCoreDisplay;
      preco = precoCoreDisplay;
    } else if (precoPriceToPay) {
      origemPreco = "priceToPay .a-offscreen";
      valorBrutoPreco = precoPriceToPay;
      preco = precoPriceToPay;
    } else if (precoJsonLd) {
      origemPreco = "jsonLd.offers.price";
      valorBrutoPreco = precoJsonLd;
      preco = precoJsonLd;
    } else if (precoProductPrice) {
      origemPreco = "product:price:amount";
      valorBrutoPreco = precoProductPrice;
      preco = precoProductPrice;
    } else if (precoOgPrice) {
      origemPreco = "og:price:amount";
      valorBrutoPreco = precoOgPrice;
      preco = precoOgPrice;
    }

    preco = normalizarPrecoAmazon(htmlDecode(preco)) || limparPreco(htmlDecode(preco));

    const textoRadarAmazon = textoOriginalRadarAmazon();
    const precoTextoRadar = extrairPrecoTextoRadarAmazon(textoRadarAmazon);
    const precoNumeroHtmlInicial = numeroPrecoAmazon(preco);
    let usouFallbackRadarPreco = false;

    if (precoTextoRadar.ok && deveUsarPrecoRadarAmazon(precoNumeroHtmlInicial, precoTextoRadar.numero)) {
      usouFallbackRadarPreco = true;
      if (!origemPreco) origemPreco = "fallback_radar";
      if (!valorBrutoPreco) valorBrutoPreco = precoTextoRadar.preco;
      preco = precoTextoRadar.preco;
      console.log("[AMZ-PRECO-FALLBACK-RADAR]", {
        url,
        origem: precoTextoRadar.origem,
        precoTexto: precoTextoRadar.preco,
        precoHtmlAnterior: precoNumeroHtmlInicial || ""
      });
    }

    console.log("[AMZ-PRECO-ORIGEM]", JSON.stringify({
      titulo: htmlDecode(titulo).replace("Amazon.com.br:", "").replace("Amazon.com:", "").trim(),
      url,
      origemPreco,
      valorBruto: valorBrutoPreco,
      valorNormalizado: preco,
      usouFallbackRadar: usouFallbackRadarPreco,
      precoTextoRadar: precoTextoRadar.ok ? precoTextoRadar.preco : ""
    }));

    const precoAntigoExtraido = primeiroMatchDetalhado(
      /class=["'][^"']*a-text-price[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      "a-text-price .a-offscreen"
    );

    let precoAntigo = precoAntigoExtraido.valor || "";

    precoAntigo = normalizarPrecoAmazon(htmlDecode(precoAntigo)) || limparPreco(htmlDecode(precoAntigo));

    let origemPrecoAntigo = precoAntigo
      ? {
          seletor: precoAntigoExtraido.origem,
          bruto: precoAntigoExtraido.bruto,
          valorLimpo: precoAntigo
        }
      : "nao_encontrado";

    const precoAtualNumero = numeroPrecoAmazon(preco);
    const precoAntigoNumero = numeroPrecoAmazon(precoAntigo);

    if (precoAntigoNumero <= 0 || precoAtualNumero <= 0 || precoAntigoNumero <= precoAtualNumero) {
      if (precoAntigo) {
        origemPrecoAntigo = {
          origem: origemPrecoAntigo,
          motivoDescarte: "preco_antigo_invalido_ou_menor_que_atual",
          precoAtualNumero,
          precoAntigoNumero
        };
      }

      precoAntigo = "";
    }

    console.log("[AMZ-PRECO]", {
      titulo: htmlDecode(titulo)
        .replace("Amazon.com.br:", "")
        .replace("Amazon.com:", "")
        .trim(),
      precoAtual: preco,
      precoAntigo,
      origemPrecoAntigo
    });

    // Nao inventar preco antigo automatico na Amazon.
    // Se nao veio preco antigo real, fica vazio.
    const parcelamento =
      primeiroMatch(/(\d+x\s+de\s+R\$\s*[\d.,]+\s*sem juros)/i) ||
      primeiroMatch(/(\d+\s*x\s*R\$\s*[\d.,]+)/i) ||
      "";

    const imagemAmazon = extrairImagemAmazon();
    const imagem = imagemAmazon.imagem || "";

    let linkAfiliado = url;

   const trackingId =
   config?.credenciais?.trackingId ||
   config?.credenciais?.partnerTag ||
   config?.credenciais?.tag ||
   config?.credenciais?.appId ||
   "";

    if (trackingId) {
      try {
        const u = new URL(url);
        u.searchParams.set("tag", trackingId);
        linkAfiliado = u.toString();
      } catch {
        linkAfiliado = url;
      }
    }

    const tituloLimpo = htmlDecode(titulo)
      .replace("Amazon.com.br:", "")
      .replace("Amazon.com:", "")
      .trim();

    console.log("[AMZ-IMAGEM-ORIGEM]", JSON.stringify({
      titulo: tituloLimpo,
      url,
      temImagem: Boolean(imagem),
      origemImagem: imagemAmazon.origemImagem || "nenhuma",
      imagemPreview: String(corrigirImagemUrl(imagem) || imagem || "").slice(0, 140)
    }));

    console.log("[AMZ-HTML-AUDITORIA]", JSON.stringify({
      clienteId: contextoEngine.clienteId || config.clienteId || "",
      jobId: contextoEngine.jobId || null,
      urlOriginal: url,
      urlFinal: response.url || url,
      statusHttp: response.status,
      tamanhoHtml: html.length,
      temCaptcha: temCaptchaAuditoria,
      temRobotCheck: temRobotCheckAuditoria,
      temProductTitle: temProductTitleAuditoria,
      temJsonLd: Boolean(jsonLd),
      temOgTitle: temOgTitleAuditoria,
      temOgImage: temOgImageAuditoria,
      temDynamicImage: temDynamicImageAuditoria,
      tituloExtraido: tituloLimpo,
      precoAtual: preco || "",
      temImagem: Boolean(corrigirImagemUrl(imagem) || imagem),
      origemImagem: imagemAmazon.origemImagem || "nenhuma"
    }));

    let cupom = "";
    let avisoCupom = "";
    let tipoCupom = "";
    let valorCupom = "";
    let percentualCupom = "";
    let descontoPix = "";
    let descontoApp = "";
    let beneficioExtra = "";

    if (
      typeof extrairCuponsAmazonDoHtml === "function" &&
      typeof detectarAvisoCupomAmazon === "function" &&
      typeof escolherCupomParaOfertaAmazon === "function"
    ) {
      const cuponsAmazon = extrairCuponsAmazonDoHtml(html);
      const avisoAmazon = detectarAvisoCupomAmazon(html);
      const dadosCuponsAmazon = avisoAmazon
        ? [...cuponsAmazon, avisoAmazon]
        : cuponsAmazon;
      const cupomOfertaAmazon = escolherCupomParaOfertaAmazon(
        { titulo: tituloLimpo, marketplace: "amazon" },
        dadosCuponsAmazon
      );

      if (cupomOfertaAmazon) {
        cupom = cupomOfertaAmazon.cupom || "";
        avisoCupom = cupomOfertaAmazon.avisoCupom || "";
        tipoCupom = cupomOfertaAmazon.tipoCupom || "";
        valorCupom = cupomOfertaAmazon.valorCupom || cupomOfertaAmazon.cupomValor || "";
        percentualCupom = cupomOfertaAmazon.percentualCupom || cupomOfertaAmazon.cupomPercentual || "";
        descontoPix = cupomOfertaAmazon.descontoPix || "";
        descontoApp = cupomOfertaAmazon.descontoApp || "";
        beneficioExtra = cupomOfertaAmazon.beneficioExtra || "";
      }

      const cupomTextoRadar = extrairCupomTextoRadarAmazon(textoRadarAmazon);
      const beneficioTextoRadar = extrairBeneficioTextoRadarAmazon(textoRadarAmazon);

      if (!cupom && cupomTextoRadar.cupom) {
        cupom = cupomTextoRadar.cupom;
        tipoCupom = cupomTextoRadar.tipoCupom;
        avisoCupom = avisoCupom || cupomTextoRadar.avisoCupom;
        beneficioExtra = beneficioExtra || beneficioTextoRadar || cupomTextoRadar.avisoCupom;
      } else if (!beneficioExtra && !avisoCupom && beneficioTextoRadar) {
        beneficioExtra = beneficioTextoRadar;
        avisoCupom = beneficioTextoRadar;
        tipoCupom = tipoCupom || "texto_radar_beneficio";
      }
    } else {
      cupom =
        primeiroMatch(/Use o cupom\s+([A-Z0-9]{4,20})/i) ||
        primeiroMatch(/Aplique o cupom\s+([A-Z0-9]{4,20})/i) ||
        primeiroMatch(/com o c[oó]digo\s+([A-Z0-9]{4,20})/i) ||
        "";

      if (cupom) {
        avisoCupom = `Cupom: ${cupom}`;
        beneficioExtra = `Cupom: ${cupom}`;
        tipoCupom = "confirmado_amazon";
      }

      const cupomTextoRadar = extrairCupomTextoRadarAmazon(textoRadarAmazon);
      const beneficioTextoRadar = extrairBeneficioTextoRadarAmazon(textoRadarAmazon);

      if (!cupom && cupomTextoRadar.cupom) {
        cupom = cupomTextoRadar.cupom;
        avisoCupom = cupomTextoRadar.avisoCupom;
        beneficioExtra = beneficioTextoRadar || cupomTextoRadar.avisoCupom;
        tipoCupom = cupomTextoRadar.tipoCupom;
      } else if (!beneficioExtra && !avisoCupom && beneficioTextoRadar) {
        beneficioExtra = beneficioTextoRadar;
        avisoCupom = beneficioTextoRadar;
        tipoCupom = "texto_radar_beneficio";
      }
    }

    linkAfiliado = limparLinkAmazon(linkAfiliado);

const usarLinksOptimus =
  config?.linksOptimus?.ativo === true;

const linkFinal = usarLinksOptimus
  ? gerarLinkOptimus(linkAfiliado, "amazon")
  : linkAfiliado;

    return {
      marketplace: "amazon",
      titulo: tituloLimpo,
      precoAntigo,
      precoAtual: preco,
      parcelamento,
      cupom,
      avisoCupom,
      tipoCupom,
      valorCupom,
      percentualCupom,
      descontoPix,
      descontoApp,
      beneficioExtra,
      linkOriginal: linkAfiliado,
      link: linkFinal,
      linkAfiliado: linkFinal,
      imagem: corrigirImagemUrl(imagem) || imagem,
      categoria: "Amazon"
    };
  };
}

module.exports = {
  criarImportarAmazon
};




