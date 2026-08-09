const assert = require("assert");

const {
  buscarImagemCanonicaMercadoLivre,
  buscarImagemOficialMercadoLivrePorMlb,
  extrairImagemOficialMercadoLivreApi
} = require("../modules/engine/importer/importer.service");

function respostaHtml(status = 404, html = "") {
  return {
    status,
    url: "https://produto.mercadolivre.com.br/MLB3696123026",
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
