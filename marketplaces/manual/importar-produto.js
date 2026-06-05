function detectarMarketplaceManual(url = "", marketplaceEntrada = "") {
  const marketplace = String(marketplaceEntrada || "").toLowerCase();
  const urlLower = String(url || "").toLowerCase();

  if (urlLower.includes("amazon.com") || urlLower.includes("amzn.to")) {
    return "amazon";
  }

  if (urlLower.includes("mercadolivre.com") || urlLower.includes("meli.la")) {
    return "mercadolivre";
  }

  if (urlLower.includes("shopee.com") || urlLower.includes("s.shopee")) {
    return "shopee";
  }

  if (urlLower.includes("aliexpress.com")) {
    return "aliexpress";
  }

  if (urlLower.includes("magalu.com") || urlLower.includes("magazineluiza.com")) {
    return "magalu";
  }

  if (urlLower.includes("awin1.com") || urlLower.includes("awin.com")) {
    return "awin";
  }

  return marketplace;
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

    gerarLinkAfiliadoMercadoLivre
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

  const config = integracoesPorCliente?.[clienteId]?.[marketplace];

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
        credenciais: integracaoAli?.credenciais || {}
      });
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
    console.error(`❌ ERRO IMPORTAÇÃO MANUAL ${marketplace}:`, e.message);

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