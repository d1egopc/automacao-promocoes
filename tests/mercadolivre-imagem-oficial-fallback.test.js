const assert = require("assert");

const {
  buscarImagemCanonicaMercadoLivre,
  buscarImagemOficialMercadoLivrePorMlb,
  extrairImagemOficialMercadoLivreApi,
  extrairImagemPolycardMercadoLivreHtml,
  montarUrlImagemPolycardMl,
  imagemMercadoLivreDeveBuscarCanonica
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

function jpegDimensao(largura = 320, altura = 320) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (altura >> 8) & 0xff, altura & 0xff,
    (largura >> 8) & 0xff, largura & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
  ]);
}

function respostaImagem(status = 200, contentType = "image/webp", dimensoes = null) {
  const corpo = dimensoes ? jpegDimensao(dimensoes.largura, dimensoes.altura) : new Uint8Array([1, 2, 3]);
  return {
    status,
    url: "https://http2.mlstatic.com/imagem.webp",
    headers: {
      get: (nome) => String(nome || "").toLowerCase() === "content-type" ? contentType : ""
    },
    arrayBuffer: async () => corpo.buffer.slice(corpo.byteOffset, corpo.byteOffset + corpo.byteLength)
  };
}

function htmlSocialPolycardImagem({
  id = "MLB4387463577",
  productId = "",
  userProductId = "MLBU3692673629",
  metadataUrl = "www.mercadolivre.com.br/produto/up/MLBU3692673629",
  pictureId = "766763-MLB102163177100_122025",
  title = "Kit Growth Whey Protein Basic Chocolate 1kg Creatina",
  template = "https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp",
  includePicture = true
} = {}) {
  const productIdCampo = productId ? `"product_id":"${productId}",` : "";
  const pictureBlock = includePicture
    ? `"pictures":{"scale":"FILL","pictures":[{"id":"${pictureId}"}],"square":"Q","alt_text":"Imagem"}`
    : `"pictures":{"pictures":[]}`;
  return `
    <html><body><script>
      window.__PRELOADED_STATE__ = {
        "recommendation_info":{
          "polycard_context":{
            "picture_template":"${template}",
            "picture_size_default":"V",
            "picture_square_default":"Q"
          },
          "polycards":[{
            "metadata":{
              "id":"${id}",
              ${productIdCampo}
              "user_product_id":"${userProductId}",
              "url":"${metadataUrl}",
              "url_params":"?pdp_filters=item_id%3A${id}"
            },
            ${pictureBlock},
            "components":[{"type":"title","title":{"text":"${title}"}}]
          }]
        }
      };
    </script></body></html>
  `;
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
    const decisao = imagemMercadoLivreDeveBuscarCanonica({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/1o1uZwj",
      imagem: "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_whatsapp_tatuado.jpg",
      imagemUrl: "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_whatsapp_tatuado.jpg",
      imagemOrigem: "engine_ofertas.imagem"
    });

    assert.strictEqual(decisao.deveBuscar, true);
    assert.strictEqual(decisao.motivo, "imagem_radar_preservada_generica");
  }

  {
    const pictureId = "800867-MLB114378386969_072026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const esperado1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
    const radarTatuado = "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_whatsapp_sandrini_tatuado.jpg";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, "<html><head></head><body>social sem og nesta rota</body></html>", "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      titulo: "Tenis Sandrini Axys Onyx",
      linkOriginal: "https://meli.la/1piEYeW",
      linkAfiliado: "https://meli.la/1kTgdY6",
      imagem: radarTatuado,
      imagemUrl: radarTatuado,
      imagemOrigem: "radar_mirror/mensagem"
    }));

    assert.strictEqual(chamadas[0].url, "https://meli.la/1piEYeW");
    assert.strictEqual(chamadas[1].url, "https://meli.la/1kTgdY6");
    assert.strictEqual(chamadas[2].url, esperado1200);
    assert.strictEqual(retorno.imagem, esperado1200);
    assert.notStrictEqual(retorno.imagem, radarTatuado);
    assert.strictEqual(retorno.origem, "og:image.picture_id");
    assert.strictEqual(retorno.pictureId, pictureId);
    assert.deepStrictEqual(retorno.dimensoes, { largura: 1200, altura: 1200 });
  }

  {
    const pictureId = "623680-MLB95967214789_102025";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const esperado1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
    const html = `
      <html><head><meta property="og:image" content="${ogImage}"></head>
      <body>recommendation solta MLB9999999999 nao deve virar identidade</body></html>
    `;
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/prorelampago"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      titulo: "Camiseta Puma Essentials Small",
      linkOriginal: "https://meli.la/18gBD4H"
    }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[0].url, "https://meli.la/18gBD4H");
    assert.strictEqual(chamadas[1].url, esperado1200);
    assert.strictEqual(retorno.imagem, esperado1200);
    assert.strictEqual(retorno.origem, "og:image.picture_id");
    assert.strictEqual(retorno.pictureId, pictureId);
    assert.strictEqual(retorno.produtoId, undefined);
    assert.strictEqual(retorno.motivo, "og_image_picture_id_imagem_recuperada");
    assert.deepStrictEqual(retorno.dimensoes, { largura: 1200, altura: 1200 });
    assert.ok(!String(retorno.linkResolvido || "").includes("MLB9999999999"));
  }

  {
    const pictureId = "993034-MLB112006389990_062026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const oficial1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
    const radarTatuado = "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_whatsapp_tatuado.jpg";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      titulo: "Kit Chave De Impacto 2 Baterias",
      linkOriginal: "https://meli.la/1Rxt9jw",
      imagem: radarTatuado,
      imagemUrl: radarTatuado,
      imagemOrigem: "radar_mirror/mensagem",
      preco: 199.9,
      cupom: "RADAR"
    }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(retorno.imagem, oficial1200);
    assert.notStrictEqual(retorno.imagem, radarTatuado);
    assert.strictEqual(retorno.pictureId, pictureId);
    assert.strictEqual(retorno.preco, undefined);
    assert.strictEqual(retorno.cupom, undefined);
  }

  {
    const pictureId = "719063-MLB114125784889_072026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const variante640 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-V.webp`;
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(404, "text/html"),
      respostaImagem(200, "image/webp", { largura: 640, altura: 640 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/2MoHpPf",
      titulo: "Penteadeira Suspensa Com Gaveta"
    }));

    assert.strictEqual(chamadas[1].url, `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`);
    assert.strictEqual(chamadas[2].url, variante640);
    assert.strictEqual(retorno.imagem, variante640);
    assert.deepStrictEqual(retorno.dimensoes, { largura: 640, altura: 640 });
  }

  {
    const pictureId = "760577-MLB107688964948_032026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const variante320 = `https://http2.mlstatic.com/D_Q_NP_${pictureId}-V.webp`;
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(404, "text/html"),
      respostaImagem(404, "text/html"),
      respostaImagem(200, "image/webp", { largura: 320, altura: 320 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/1NFvwJM",
      titulo: "Tenis Fila Rise Up Feminino"
    }));

    assert.strictEqual(chamadas.at(-1).url, variante320);
    assert.strictEqual(retorno.imagem, variante320);
    assert.deepStrictEqual(retorno.dimensoes, { largura: 320, altura: 320 });
  }

  {
    const pictureId = "787896-MLB113444454464_072026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(404, "text/html"),
      respostaImagem(404, "text/html"),
      respostaImagem(404, "text/html"),
      respostaImagem(404, "text/html")
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/2TR2zjU",
      imagem: "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_whatsapp_fallback.jpg",
      imagemOrigem: "radar_mirror/mensagem"
    }));

    assert.strictEqual(chamadas.filter(item => /mlstatic\.com/i.test(item.url)).length, 4);
    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.motivo, "mlb_api_ausente");
  }

  {
    const pictureId = "897788-MLB116709477309_082026";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const esperado1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
    const html = `
      <meta property="og:image" content="${ogImage}">
      <script>window.__PRELOADED_STATE__={"recommendations":[{"id":"MLB0000000000","pictures":{"pictures":[{"id":"999999-MLB000000000000_012025"}]}}]}</script>
    `;
    const { retorno } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/18fCTXB",
      titulo: "Tenis New Balance CT300 V3"
    }));

    assert.strictEqual(retorno.imagem, esperado1200);
    assert.strictEqual(retorno.pictureId, pictureId);
    assert.ok(!retorno.imagem.includes("999999-MLB000000000000_012025"));
  }

  {
    const pictureId = "849075-MLB82170922584_022025";
    const ogImage = `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
    const esperado1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
    const respostas = [
      respostaHtml(200, "<html><head></head><body>sem imagem oficial</body></html>", "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaHtml(200, `<meta property="og:image" content="${ogImage}">`, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ];

    const primeiro = await comFetchMock(respostas.slice(0, 1), () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/2GBTFYK"
    }));
    assert.strictEqual(primeiro.retorno.imagem, "");

    const segundo = await comFetchMock(respostas.slice(1), () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      linkOriginal: "https://meli.la/2GBTFYK"
    }));
    assert.strictEqual(segundo.retorno.imagem, esperado1200);
    assert.strictEqual(segundo.retorno.pictureId, pictureId);
  }

  {
    const casosOgImage = [
      ["Creatina", "https://meli.la/2EVds4L", "https://http2.mlstatic.com/D_NQ_NP_776821-MLA99365251528_112025-O.webp", "776821-MLA99365251528_112025"],
      ["Malbec X", "https://meli.la/1U9rqbe", "https://http2.mlstatic.com/D_NQ_NP_672452-MLA84843234017_052025-O.webp", "672452-MLA84843234017_052025"],
      ["New Balance", "https://meli.la/2MW3aQW", "https://http2.mlstatic.com/D_NQ_NP_816072-MLB117196994531_092026-O.webp", "816072-MLB117196994531_092026"],
      ["Iluminador", "https://meli.la/2DPdE7H", "https://http2.mlstatic.com/D_NQ_NP_853057-MLU75854196381_042024-O.webp", "853057-MLU75854196381_042024"]
    ];

    for (const [nome, linkOriginal, ogImage, pictureId] of casosOgImage) {
      const esperado1200 = `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-F.jpg`;
      const oferta = {
        marketplace: "mercadolivre",
        titulo: nome,
        linkOriginal,
        imagem: ogImage,
        imagemOrigem: "og:image",
        preco: 123,
        cupom: "RADAR"
      };
      const { retorno, chamadas } = await comFetchMock([
        respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
      ], () => buscarImagemCanonicaMercadoLivre(oferta));

      assert.strictEqual(chamadas.length, 1, nome);
      assert.strictEqual(chamadas[0].url, esperado1200, nome);
      assert.strictEqual(retorno.imagem, esperado1200, nome);
      assert.strictEqual(retorno.origem, "og:image.picture_id", nome);
      assert.strictEqual(retorno.pictureId, pictureId, nome);
      assert.deepStrictEqual(retorno.dimensoes, { largura: 1200, altura: 1200 }, nome);
      assert.strictEqual(retorno.preco, undefined, nome);
      assert.strictEqual(retorno.cupom, undefined, nome);
      assert.strictEqual(oferta.preco, 123, nome);
      assert.strictEqual(oferta.cupom, "RADAR", nome);
    }
  }

  {
    const fixturesValidas = [
      ["Growth Whey + Creatina", "MLB4387463577", "", "MLBU3692673629", "766763-MLB102163177100_122025", "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"],
      ["Dr. Peanut", "MLB6711833172", "MLB50886744", "MLBU3933491095", "910611-MLA99017164196_112025", "Pasta de Amendoim Italiana Dr Peanut 600g Whey Protein"],
      ["Travesseiros", "MLB6195001116", "MLB64904437", "MLBU3697135979", "670844-MLA107444351607_022026", "Kit C2 Travesseiros Luxo Matelado Fibra Antialergica"],
      ["Bicicleta", "MLB5034728767", "MLB28263665", "MLBU4684351650", "970386-MLA115400583715_072026", "Bicicleta Ergonometrica Spinning Liftness X11 Brusfit"]
    ];

    for (const [nome, mlb, productId, userProductId, pictureId, title] of fixturesValidas) {
      const html = htmlSocialPolycardImagem({ id: mlb, productId, userProductId, pictureId, title });
      const candidato = extrairImagemPolycardMercadoLivreHtml(html, mlb, {
        titulo: title,
        textoOriginal: title
      });

      assert.strictEqual(candidato.pictureId, pictureId, nome);
      assert.strictEqual(candidato.origem, "polycard.picture_template", nome);
      assert.strictEqual(candidato.imagem, `https://http2.mlstatic.com/D_Q_NP_${pictureId}-V.webp`, nome);
    }
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB9999999999",
      pictureId: "766763-MLB102163177100_122025"
    });
    const candidato = extrairImagemPolycardMercadoLivreHtml(html, "MLB4387463577");
    assert.strictEqual(candidato.imagem, "");
    assert.strictEqual(candidato.motivo, "polycard_mlb_divergente");
  }

  {
    const html = `
      ${htmlSocialPolycardImagem({ id: "MLB4387463577", includePicture: false })}
      ${htmlSocialPolycardImagem({ id: "MLB9999999999", pictureId: "999999-MLB00000000000_012025" })}
    `;
    const candidato = extrairImagemPolycardMercadoLivreHtml(html, "MLB4387463577");
    assert.strictEqual(candidato.imagem, "");
    assert.strictEqual(candidato.motivo, "polycard_picture_id_ausente");
  }

  {
    assert.strictEqual(
      montarUrlImagemPolycardMl({
        template: "https://evil.example/D_{id}.webp",
        pictureId: "766763-MLB102163177100_122025",
        square: "Q",
        size: "V"
      }),
      ""
    );
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB4462027361",
      productId: "MLB23853955",
      userProductId: "MLBU3770153549",
      metadataUrl: "produto.mercadolivre.com.br/MLB-4462027361-dux-human-health-whey-protein-concentrado-suplemento-900g-sabor-chocolate-_JM",
      pictureId: "728880-MLA107260069950_032026",
      title: "Dux Human Health Whey Protein Concentrado Suplemento 900g Sabor Chocolate"
    });
    const candidato = extrairImagemPolycardMercadoLivreHtml(html, "MLB4462027361", {
      titulo: "Poltrona Inflavel Ultra Lounge Com Pufe Sofa Preguicoso",
      textoOriginal: "Poltrona Inflavel Ultra Lounge Com Pufe Sofa Preguicoso"
    });

    assert.strictEqual(candidato.imagem, "");
    assert.strictEqual(candidato.conflitoIdentidade, true);
    assert.strictEqual(candidato.motivo, "polycard_conflito_identidade");
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB4387463577",
      pictureId: "766763-MLB102163177100_122025",
      title: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"
    });
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(200, "image/jpeg", { largura: 1200, altura: 1200 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB4387463577",
      linkOriginal: "https://meli.la/2nKnMEm",
      linkAfiliado: "https://meli.la/workspace-a",
      titulo: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina",
      preco: 78,
      precoOriginal: 179,
      cupom: "GANHEIMAIS"
    }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[0].url, "https://meli.la/2nKnMEm");
    assert.strictEqual(chamadas[1].url, "https://http2.mlstatic.com/D_Q_NP_2X_766763-MLB102163177100_122025-F.jpg");
    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_Q_NP_2X_766763-MLB102163177100_122025-F.jpg");
    assert.strictEqual(retorno.origem, "polycard.picture_template");
    assert.strictEqual(retorno.motivo, "polycard_picture_id_imagem_recuperada");
    assert.strictEqual(retorno.statusHttp, 200);
    assert.deepStrictEqual(retorno.dimensoes, { largura: 1200, altura: 1200 });
    assert.strictEqual(retorno.pictureId, "766763-MLB102163177100_122025");
    assert.strictEqual(retorno.productId, "");
    assert.strictEqual(retorno.userProductId, "MLBU3692673629");
    assert.strictEqual(retorno.preco, undefined);
    assert.strictEqual(retorno.cupom, undefined);
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB4387463577",
      pictureId: "766763-MLB102163177100_122025",
      title: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"
    });
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/diegopc2015"),
      respostaImagem(404, "text/html"),
      respostaImagem(200, "image/webp", { largura: 640, altura: 640 })
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB4387463577",
      linkOriginal: "https://meli.la/2nKnMEm",
      titulo: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"
    }));

    assert.strictEqual(chamadas[1].url, "https://http2.mlstatic.com/D_Q_NP_2X_766763-MLB102163177100_122025-F.jpg");
    assert.strictEqual(chamadas[2].url, "https://http2.mlstatic.com/D_Q_NP_2X_766763-MLB102163177100_122025-V.webp");
    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_Q_NP_2X_766763-MLB102163177100_122025-V.webp");
    assert.deepStrictEqual(retorno.dimensoes, { largura: 640, altura: 640 });
    assert.strictEqual(new Set(chamadas.slice(1).map(item => item.url)).size, 2);
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB4387463577",
      pictureId: "766763-MLB102163177100_122025",
      title: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"
    });
    const respostasImagem = Array.from({ length: 2 }, () => respostaImagem(404, "text/html"));
    respostasImagem.push(respostaImagem(200, "image/webp", { largura: 320, altura: 320 }));
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/diegopc2015"),
      ...respostasImagem
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB4387463577",
      linkOriginal: "https://meli.la/2nKnMEm",
      titulo: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina"
    }));

    assert.strictEqual(chamadas.at(-1).url, "https://http2.mlstatic.com/D_Q_NP_766763-MLB102163177100_122025-V.webp");
    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_Q_NP_766763-MLB102163177100_122025-V.webp");
    assert.deepStrictEqual(retorno.dimensoes, { largura: 320, altura: 320 });
    assert.strictEqual(new Set(chamadas.slice(1).map(item => item.url)).size, 3);
  }

  {
    const html = htmlSocialPolycardImagem({
      id: "MLB6711833172",
      productId: "MLB50886744",
      userProductId: "MLBU3933491095",
      pictureId: "910611-MLA99017164196_112025",
      title: "Pasta de Amendoim Italiana Dr Peanut"
    });
    const generica = "https://produto.mercadolivre.com.br/MLB6711833172";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, html, "https://www.mercadolivre.com.br/social/diegopc2015"),
      ...Array.from({ length: 3 }, () => respostaImagem(200, "text/html")),
      respostaHtml(404, "<html>not found</html>", generica)
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB6711833172",
      linkOriginal: "https://meli.la/2B4h6q3",
      linkExpandido: generica,
      titulo: "Pasta de Amendoim Italiana Dr Peanut"
    }));

    assert.strictEqual(chamadas.at(-1).url, generica);
    assert.strictEqual(chamadas.filter(item => /mlstatic\.com/i.test(item.url)).length, 3);
    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_token_ausente");
  }

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
        respostaHtml(200, "<html><head></head><body>sem imagem oficial</body></html>", social),
        respostaHtml(404, "<html>not found</html>", generica)
      ], () => buscarImagemCanonicaMercadoLivre({
        marketplace: "mercadolivre",
        produtoIdDetectado: mlb,
        linkOriginal: meliLa,
        linkExpandido: generica,
        linkAfiliado: `${meliLa}/workspace`
      }));

      assert.strictEqual(chamadas[0].url, meliLa, mlb);
      assert.strictEqual(chamadas[1].url, `${meliLa}/workspace`, mlb);
      assert.strictEqual(chamadas[2].url, generica, mlb);
      assert.strictEqual(chamadas.some(item => /MLB-\d+-/.test(item.url)), false, mlb);
      assert.strictEqual(retorno.imagem, "", mlb);
      assert.strictEqual(retorno.motivo, "api_oficial_mlb_token_ausente", mlb);
    }
  }

  {
    const imagemOutroProduto = "https://http2.mlstatic.com/D_NQ_NP_OUTRO-PRODUTO-MLB.webp";
    const generica = "https://produto.mercadolivre.com.br/MLB6797156948";
    const { retorno, chamadas } = await comFetchMock([
      respostaHtml(200, `<script type="application/ld+json">{"@type":"Product","image":"${imagemOutroProduto}"}</script>`, "https://produto.mercadolivre.com.br/MLB-9999999999-produto-errado-_JM"),
      respostaHtml(404, "<html>not found</html>", generica)
    ], () => buscarImagemCanonicaMercadoLivre({
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB6797156948",
      linkOriginal: "https://meli.la/produto-errado",
      linkExpandido: generica
    }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_token_ausente");
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
    ], () => buscarImagemCanonicaMercadoLivre(oferta, { accessToken: "token_ml_valido" }));

    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1].url, "https://api.mercadolibre.com/items/MLB3696123026");
    assert.strictEqual(chamadas[1].opcoes.headers.Authorization, "Bearer token_ml_valido");
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
    }, { accessToken: "token_ml_valido" }));

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
    }, { accessToken: "token_ml_valido" }));

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
    ], () => buscarImagemOficialMercadoLivrePorMlb("MLB3284064025", { accessToken: "token_ml_valido" }));

    assert.strictEqual(retorno.imagem, "https://http2.mlstatic.com/D_NQ_NP_SECURE-MLB.jpg");
    assert.strictEqual(retorno.origem, "api_mercadolibre.items.secure_thumbnail");
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_imagem_recuperada");
  }

  {
    const { retorno, chamadas } = await comFetchMock([], () => buscarImagemOficialMercadoLivrePorMlb("MLB3284064025"));

    assert.strictEqual(chamadas.length, 0);
    assert.strictEqual(retorno.imagem, "");
    assert.strictEqual(retorno.apiConsultada, false);
    assert.strictEqual(retorno.motivo, "api_oficial_mlb_token_ausente");
  }

  console.log("mercadolivre-imagem-oficial-fallback.test.js ok");
})();
