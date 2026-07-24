function detectarMarketplaceManual(url = "", marketplaceEntrada = "") {
  const marketplace = String(marketplaceEntrada || "").toLowerCase();
  const urlLower = String(url || "").toLowerCase();

  if (marketplace === "kabum") {
    return "awin";
  }

  if (urlLower.includes("amazon.com") || urlLower.includes("amzn.to")) {
    return "amazon";
  }

  if (urlLower.includes("mercadolivre.com") || urlLower.includes("meli.la")) {
    return "mercadolivre";
  }

  if (urlLower.includes("shopee.com") || urlLower.includes("s.shopee")) {
    return "shopee";
  }

  if (urlLower.includes("aliexpress.com") || urlLower.includes("a.aliexpress.")) {
    return "aliexpress";
  }

  if (urlLower.includes("kabum.com.br")) {
    return "awin";
  }

  if (urlLower.includes("magalu.com") || urlLower.includes("magazineluiza.com")) {
    return "magalu";
  }

  if (urlLower.includes("awin1.com") || urlLower.includes("awin.com")) {
    return "awin";
  }

  return marketplace;
}

function extrairUrlKabumDeAwinManual(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    const candidatos = [
      parsed.searchParams.get("ued"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("u"),
      parsed.searchParams.get("destination"),
      parsed.searchParams.get("dest")
    ].filter(Boolean);

    for (const candidato of candidatos) {
      let atual = candidato;
      for (let i = 0; i < 3; i += 1) {
        try {
          const decodificado = decodeURIComponent(atual);
          if (decodificado === atual) break;
          atual = decodificado;
        } catch {
          break;
        }
      }

      if (/kabum\.com\.br/i.test(atual)) return atual;
    }
  } catch {}

  return "";
}

function respostaFallback(marketplace, url, mensagem = "Preencha manualmente.") {
  return {
    marketplace,
    titulo: `Produto importado de ${marketplace}`,
    precoAntigo: "",
    precoAtual: "",
    cupom: "",
    avisoCupom: "",
    parcelamento: "",
    linkOriginal: url,
    linkAfiliado: url,
    imagem: "",
    categoria: marketplace,
    aviso: mensagem
  };
}

async function importarProdutoManual(req, deps = {}) {
  const {
    getClienteId,
    integracoesPorCliente,
    getIntegracaoCliente,

    importarAmazon,
    importarAliExpress,
    importarMagalu,
    importarMercadoLivre,
    importarShopee,
    importarProdutoKabumViaAwin,

    gerarLinkAfiliadoMercadoLivre,
    gerarDeepLinkAwin
  } = deps;

  const clienteId = getClienteId(req);
  let marketplace = detectarMarketplaceManual(
    req.body?.url,
    req.body?.marketplace
  );

  let url = String(req.body?.url || "").trim();

  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  if (!marketplace || !url) {
    return {
      status: 400,
      body: {
        ok: false,
        erro: "marketplace e url obrigatórios"
      }
    };
  }

  const config = getIntegracaoCliente(clienteId, marketplace);

console.log("[API] IMPORTAO MANUAL CONFIG:", {
  clienteId,
  marketplace,
  tagUsada:
    config?.credenciais?.trackingId ||
    config?.credenciais?.partnerTag ||
    config?.credenciais?.appId,
  credenciais: Object.keys(config?.credenciais || {})
});



  if (!config) {
    return {
      status: 400,
      body: {
        ok: false,
        erro: `Integração ${marketplace} não configurada`
      }
    };
  }

  try {
    let produto;

    if (marketplace === "amazon") {
      produto = await importarAmazon(url, config);
    }

    if (marketplace === "aliexpress") {
      const integracaoAli = getIntegracaoCliente(clienteId, "aliexpress");

      produto = await importarAliExpress(url, {
        ...integracaoAli,
        clienteId,
        credenciais: integracaoAli?.credenciais || {}
      });
    }

    if (marketplace === "awin") {
      const urlKabum = extrairUrlKabumDeAwinManual(url) || url;

      if (/kabum\.com\.br/i.test(urlKabum) && typeof importarProdutoKabumViaAwin === "function") {
        produto = await importarProdutoKabumViaAwin(urlKabum, clienteId, {
          gerarDeepLinkAwin
        });
      } else if (typeof gerarDeepLinkAwin === "function") {
        const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);
        produto = {
          ...respostaFallback("awin", url, "Link AWIN convertido. Preencha os dados do produto manualmente."),
          linkAfiliado: linkAfiliado || url,
          linkFinal: linkAfiliado || url
        };
      }
    }

    if (marketplace === "magalu") {
      produto = await importarMagalu(url, config);
    }

    if (marketplace === "mercadolivre") {
      produto = await importarMercadoLivre(url, clienteId, {
        getIntegracaoCliente,
        gerarLinkAfiliadoMercadoLivre
      });
    }

    if (marketplace === "shopee") {
      produto = await importarShopee(url, config);
    }

    if (!produto) {
      return {
        status: 200,
        body: respostaFallback(
          marketplace,
          url,
          "Marketplace ainda não possui importador manual configurado."
        )
      };
    }

    return {
      status: 200,
      body: {
        ...produto,
        marketplace: produto.marketplace || marketplace,
        linkOriginal: produto.linkOriginal || url,
        linkAfiliado: produto.linkAfiliado || produto.link || url,
        origem: "manual",
        manual: true,
        status: "rascunho",
        statusDetalhe: "Importada para revisão"
      }
    };

  } catch (e) {
    console.error(`[API] ERRO IMPORTAO MANUAL ${marketplace}:`, e.message);

    return {
      status: 200,
      body: respostaFallback(
        marketplace,
        url,
        `Erro ao consultar ${marketplace}. Preencha manualmente.`
      )
    };
  }
}

module.exports = {
  detectarMarketplaceManual,
  importarProdutoManual
};
