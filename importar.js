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
      const numero = Number(
        String(valor || "")
          .replace("R$", "")
          .replace(/\./g, "")
          .replace(",", ".")
          .replace(/[^\d.]/g, "")
          .trim()
      );

      return Number.isFinite(numero) ? numero : 0;
    }

    function extrairImagemAmazon() {
      const imagemMeta =
        (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
        extrairMeta(html, "og:image") ||
        extrairMeta(html, "twitter:image") ||
        html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
        html.match(/data-old-hires=["']([^"']+)["']/i)?.[1] ||
        "";

      if (imagemMeta) return htmlDecode(imagemMeta).replace(/\\u002F/g, "/");

      const dynamicImageRaw =
        html.match(/data-a-dynamic-image=["']([^"']+)["']/i)?.[1] || "";

      if (dynamicImageRaw) {
        try {
          const decoded = htmlDecode(dynamicImageRaw).replace(/\\u002F/g, "/");
          const parsed = JSON.parse(decoded);
          const primeira = Object.keys(parsed || {})[0];
          if (primeira) return primeira;
        } catch {}
      }

      return "";
    }

    const titulo =
      jsonLd?.name ||
      extrairMeta(html, "og:title") ||
      extrairMeta(html, "twitter:title") ||
      primeiroMatch(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) ||
      "Produto Amazon";

    let preco =
      primeiroMatch(/id=["']corePriceDisplay_desktop_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      primeiroMatch(/class=["'][^"']*priceToPay[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      jsonLd?.offers?.price ||
      extrairMeta(html, "product:price:amount") ||
      extrairMeta(html, "og:price:amount") ||
      "";

    preco = limparPreco(htmlDecode(preco));

    const precoAntigoExtraido = primeiroMatchDetalhado(
      /class=["'][^"']*a-text-price[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      "a-text-price .a-offscreen"
    );

    let precoAntigo = precoAntigoExtraido.valor || "";

    precoAntigo = limparPreco(htmlDecode(precoAntigo));

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

    const imagem = extrairImagemAmazon();

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

