const assert = require("assert");

const {
  buscarImagemCanonicaMercadoLivre,
  buscarImagemOficialMercadoLivrePorMlb,
  extrairImagemOficialMercadoLivreApi
} = require("../modules/engine/importer/importer.service");

function respostaHtml(status = 404, html = "", url = "https://produto.mercadolivre.com.br/MLB3696123026") {
  return {
    status,
    url,
    text: async () => html
  };
}

function respostaJson(status = 200, dados = {}) {
  return {
    status,
    url: "https://api.mercadolibre.com/items/MLB3696123026",
    json: async () => dados
  };
}

async function comFetchMock(respostas, fn) {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    const resposta = respostas.shift();
    if (!resposta) throw new Error("fetch inesperado: " + url);
    if (typeof resposta === "function") return resposta(url, opcoes);
    return resposta;
  };
  try {
    const retorno = await fn(chamadas);
    return { retorno, chamadas };
  } finally {
    global.fetch = original;
  }
}

(async () => {
  {
    const urlRica = "https://produto.mercadolivre.com.br/MLB-6797156948-kit-refletores-led-_JM";
    const imagemRica = "https://http2.mlstatic.com/D_NQ_NP_REFLETORES-MLB.webp";
    const oferta = {
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB6797156948",
      linkOriginal: "https://meli.la/1YX9xJh",
      linkAfiliado: "https://meli.la/workspace-a",
      preco: 40,
      precoPix: 39,
      cupom: "RADAR40",
      beneficioTexto: "Radar preservado"
    };

    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<script type="application/ld+json">{"@type":"Product","image":"${imagemRica}"}</script>`, urlRica)
    ], () => buscarImagemCanonicaMercadoLivre(oferta));

    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].url, "https://meli.la/1YX9xJh");
    assert.strictEqual(chamadas[0].opcoes.redirect, "follow");
    assert.strictEqual(retorno.imagem, imagemRica);
    assert.strictEqual(retorno.origem, "canonical.jsonLd.image");
    assert.strictEqual(retorno.linkResolvido, urlRica);
    assert.strictEqual(oferta.linkAfiliado, "https://meli.la/workspace-a");
    assert.strictEqual(oferta.preco, 40);
    assert.strictEqual(oferta.precoPix, 39);
    assert.strictEqual(oferta.cupom, "RADAR40");
    assert.strictEqual(oferta.beneficioTexto, "Radar preservado");
  }

  {
    const urlRica = "https://produto.mercadolivre.com.br/MLB-4128758301-hidratante-400ml-_JM";
    const imagemRica = "https://http2.mlstatic.com/D_NQ_NP_HIDRATANTE-MLB.webp";
    const oferta = {
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB4128758301",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB4128758301",
      linkExpandido: "https://produto.mercadolivre.com.br/MLB4128758301",
      metadata: {
        produto: {
          permalink: urlRica
        }
      }
    };

    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<meta property="og:image" content="${imagemRica}">`, urlRica)
    ], () => buscarImagemCanonicaMercadoLivre(oferta));

    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].url, urlRica);
    assert.strictEqual(retorno.imagem, imagemRica);
    assert.strictEqual(retorno.origem, "canonical.og:image");
    assert.strictEqual(retorno.linkResolvido, urlRica);
  }

  {
    const casosSemUrlRica = [
      ["MLB6797156948", "https://meli.la/1YX9xJh", "https://www.mercadolivre.com.br/social/promosinc"],
      ["MLB4128758301", "https://meli.la/2BNNjZi", "https://www.mercadolivre.com.br/social/diegopc2015"]
    ];

    for (const [mlb, meliLa, social] of casosSemUrlRica) {
      const id = mlb.replace("MLB", "");
      const generica = `https://produto.mercadolivre.com.br/MLB${id}`;
      const { retorno, chamadas } = await comFetchMock([
        respostaHtml(200, `<html><head><meta property="og:url" content="${social}"></head><body>${mlb}</body></html>`, social),
        respostaHtml(404, "<html>not found</html>", generica),
        respostaJson(403, {})
      ], () => buscarImagemCanonicaMercadoLivre({
        marketplace: "mercadolivre",
        produtoIdDetectado: mlb,
        linkOriginal: meliLa,
        linkExpandido: generica,
        linkAfiliado: `${meliLa}/workspace`
      }));

      assert.strictEqual(chamadas.length, 3, mlb);
      assert.strictEqual(chamadas[0].url, meliLa, mlb);
      assert.strictEqual(chamadas[1].url, generica, mlb);
      assert.strictEqual(chamadas[2].url, `https://api.mercadolibre.com/items/${mlb}`, mlb);
      assert.strictEqual(chamadas.some(item => /MLB-\d+-/.test(item.url)), false, mlb);
      assert.strictEqual(retorno.imagem, "", mlb);
      assert.strictEqual(retorno.motivo, "api_oficial_mlb_http_403", mlb);
    }
  }

  {
    const imagemOutroProduto = "https://http2.mlstatic.com/D_NQ_NP_OUTRO-PRODUTO-MLB.webp";
    const generica = "https://produto.mercadolivre.com.br/MLB6797156948";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<script type="application/ld+json">{"@type":"Product","image":"${imagemOutroProduto}"}</script>`, "https://produto.mercadolivre.com.br/MLB-9999999999-produto-errado-_JM"),
      respostaHtml(404, "<html>not found</html>", generica),
      respostaJson(403, {})
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB6797156948",
      linkOriginal: "https://meli.la/produto-errado",
      linkExpandido: generica
    }));

    assert.strictEqual(chamadas.length, 3);
    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_http_403");
  }

  {
    const imagem = extrairImagemOficialMercadoLivreApi({
      price: 9999,
      title: "Titulo vindo da API nao deve importar",
      pictures: [
        { secure_url: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB.jpg" }
      ],
      thumbnail: "https://http2.mlstatic.com/D_NQ_NP_thumb-MLB.jpg"
    });

    assert.strictEqual(imagem.imagem, "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB.jpg");
    assert.strictEqual(imagem.origem, "api_mercadolibre.items.pictures[0].secure_url");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(imagem, "price"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(imagem, "title"), false);
  }

  {
    const oferta = {
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB3696123026",
      preco: 67,
      precoOriginal: 129.9,
      cupom: "RADAR67"
    };

    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(404, "<html>not found</html>"),
      respostaJson(200, {
        price: 999,
        title: "API nao pode vencer titulo/preco Radar",
        pictures: [
          { secure_url: "https://http2.mlstatic.com/D_NQ_NP_API-LAROCHE-MLB.jpg" }
        ]
      })
    ], () => buscarImagemCanonicaMercadoLivre(oferta));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1].url, "https://api.mercadolibre.com/items/MLB3696123026");
    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_NQ_NP_API-LAROCHE-MLB.jpg");
    assert.strictEqual(retorno.origem, "api_mercadolibre.items.pictures[0].secure_url");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_imagem_recuperada");
    assert.strictEqual(oferta.preco, 67);
    assert.strictEqual(oferta.precoOriginal, 129.9);
    assert.strictEqual(oferta.cupom, "RADAR67");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(retorno, "preco"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(retorno, "cupom"), false);
  }

  {
    const { retorno } = await comFetchMock([
      respostaHtml(404, "<html>not found</html>"),
      respostaJson(200, { id: "MLB3284064025", pictures: [], thumbnail: "" })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB3284064025",
      preco: 69,
      precoOriginal: 99
    }));

    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.origem, "");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_sem_imagem");
  }

  {
    const { retorno } = await comFetchMock([
      async () => { throw new Error("html indisponivel"); },
      respostaJson(200, {
        id: "MLB3284064025",
        pictures: [{ url: "https://http2.mlstatic.com/D_NQ_NP_API-VODKA-MLB.jpg" }]
      })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB3284064025"
    }));

    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_NQ_NP_API-VODKA-MLB.jpg");
    assert.strictEqual(retorno.origem, "api_mercadolibre.items.pictures[0].url");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_imagem_recuperada");
  }

  {
    const urlRica = "https://produto.mercadolivre.com.br/MLB-7777777777-sente-a-presso-_JM";
    const imagemRica = "https://http2.mlstatic.com/D_NQ_NP_SENTE-PRESSAO-MLB.webp";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<html><head><link rel="canonical" href="${urlRica}"></head><body></body></html>`),
      {
        status: 200,
        url: urlRica,
        text: async () => `<script type="application/ld+json">{"@type":"Product","image":"${imagemRica}"}</script>`
      }
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB7777777777",
      preco: 145,
      cupom: "VIPNOML"
    }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1].url, urlRica);
    assert.strictEqual(retorno.imagem, imagemRica);
    assert.strictEqual(retorno.origem, "canonical.jsonLd.image");
    assert.strictEqual(retorno.linkResolvido, urlRica);
  }

  {
    const { retorno } = await comFetchMock([
      respostaJson(200, {
        id: "MLB3284064025",
        secure_thumbnail: "https://http2.mlstatic.com/D_NQ_NP_SECURE-MLB.jpg",
        thumbnail: "https://http2.mlstatic.com/D_NQ_NP_THUMB-MLB.jpg"
      })
    ], () => buscarImagemOficialMercadoLivrePorMlb("MLB3284064025"));

    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_NQ_NP_SECURE-MLB.jpg");
    assert.strictEqual(retorno.origem, "api_mercadolibre.items.secure_thumbnail");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_imagem_recuperada");
  }

  console.log("mercadolivre-imagem-oficial-fallback.test.js ok");
})();
