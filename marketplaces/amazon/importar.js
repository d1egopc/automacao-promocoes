function criarImportarAmazon(deps = {}) {
  const {
    extrairJsonLd,
    extrairMeta,
    htmlDecode,
    limparPreco,
    corrigirImagemUrl,
    limparLinkAmazon,
    gerarLinkOptimus
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

    let precoAntigo =
      primeiroMatch(/class=["'][^"']*a-text-price[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      "";

    precoAntigo = limparPreco(htmlDecode(precoAntigo));

    if (precoAntigo === preco) {
      precoAntigo = "";
    }

    // NÃO inventar preço antigo automático na Amazon
    // Se não veio preço antigo real, fica vazio.
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

    let cupom =
      primeiroMatch(/Use o cupom\s+([A-Z0-9]{4,20})/i) ||
      primeiroMatch(/Aplique o cupom\s+([A-Z0-9]{4,20})/i) ||
      primeiroMatch(/com o código\s+([A-Z0-9]{4,20})/i) ||
      "";

    let avisoCupom = "";

    if (cupom) {
      avisoCupom = `Aplique o cupom ${cupom} no carrinho.`;
    } else if (/resgatar|aplique o cupom|cupom disponível|desconto extra/i.test(html)) {
      avisoCupom = "Há cupom/desconto extra na página. Resgate antes de finalizar.";
    }

    linkAfiliado = limparLinkAmazon(linkAfiliado);

const usarLinksOptimus =
  config?.linksOptimus?.ativo === true;

const linkFinal = usarLinksOptimus
  ? gerarLinkOptimus(linkAfiliado, "amazon")
  : linkAfiliado;

    return {
      marketplace: "amazon",
      titulo: htmlDecode(titulo)
        .replace("Amazon.com.br:", "")
        .replace("Amazon.com:", "")
        .trim(),
      precoAntigo,
      precoAtual: preco,
      parcelamento,
      cupom,
      avisoCupom,
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