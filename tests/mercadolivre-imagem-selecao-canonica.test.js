const assert = require("assert");

const {
  resolverImagemCanonicaFinalEvento,
  _limparCacheImagemCanonicaEvento
} = require("../modules/imagens/cache-canonico-evento");
const {
  extrairImagemOficialMercadoLivreApi,
  imagemMercadoLivreDeveBuscarCanonica
} = require("../modules/engine/importer/importer.service");

function url(nome) {
  return `https://cdn.exemplo.com/ml/${nome}.jpg`;
}

function mlImg(nome, sufixo = "V") {
  return `https://http2.mlstatic.com/D_NQ_NP_2X_${nome}-MLB1234567890_012026-${sufixo}.webp`;
}

(async () => {
  {
    const limpaPolycard = mlImg("POLYCARD-LIMPA", "V");
    const thumbnail = mlImg("THUMB-DECISAO", "T");
    assert.deepStrictEqual(
      imagemMercadoLivreDeveBuscarCanonica({ imagem: "", imagemOrigem: "" }),
      { deveBuscar: true, motivo: "imagem_ausente" }
    );
    assert.strictEqual(
      imagemMercadoLivreDeveBuscarCanonica({ imagem: url("radar-com-tatuagem"), imagemOrigem: "radar_mirror/mensagem" }).deveBuscar,
      true
    );
    assert.strictEqual(
      imagemMercadoLivreDeveBuscarCanonica({ imagem: thumbnail, imagemOrigem: "secure_thumbnail" }).deveBuscar,
      true
    );
    assert.strictEqual(
      imagemMercadoLivreDeveBuscarCanonica({ imagem: limpaPolycard, imagemOrigem: "polycard.picture_template" }).deveBuscar,
      false
    );
  }

  {
    const ruim = mlImg("THUMB-RUIM", "T");
    const boa = mlImg("API-OFICIAL", "V");
    const imagem = extrairImagemOficialMercadoLivreApi({
      price: 9999,
      title: "Titulo tecnico nao deve vazar",
      pictures: [
        { secure_url: ruim, width: 120, height: 120 },
        { secure_url: boa, width: 1200, height: 1200 }
      ],
      secure_thumbnail: mlImg("SECURE-THUMB", "T")
    });

    assert.strictEqual(imagem.imagem, boa);
    assert.strictEqual(imagem.origem, "api_mercadolibre.items.pictures[1].secure_url");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(imagem, "price"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(imagem, "title"), false);
    assert.ok(imagem.candidatos.some((candidato) => candidato.imagem === ruim && candidato.qualidade.baixa));
  }

  {
    _limparCacheImagemCanonicaEvento();
    const thumbnailImportador = mlImg("IMPORTADOR-THUMB", "T");
    const radar = url("radar-com-tatuagem");
    const oficial = mlImg("API-LIMPA", "V");
    let apiChamadas = 0;
    const ofertaEnriquecida = {
      marketplace: "mercadolivre",
      titulo: "Produto Correto Mercado Livre",
      produtoIdDetectado: "MLB1234567890",
      linkExpandido: "https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto",
      imagem: thumbnailImportador,
      imagemOrigem: "secure_thumbnail",
      preco: 77,
      cupom: "RADAR77"
    };

    const resultado = await resolverImagemCanonicaFinalEvento({
      eventoId: 9901,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto"],
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemMaterializada: radar
          }
        }
      },
      ofertaEnriquecida
    }, {
      buscarImagemOficialMl: async () => {
        apiChamadas += 1;
        return {
          imagem: oficial,
          origem: "api_mercadolibre.items.pictures[0].secure_url",
          motivo: "api_oficial_mlb_imagem_recuperada",
          apiConsultada: true
        };
      },
      buscarImagemHistorica: async () => {
        throw new Error("historico_nao_deveria_ser_usado");
      }
    });

    assert.strictEqual(apiChamadas, 1);
    assert.strictEqual(resultado.imagemCanonicaDuravel, oficial);
    assert.strictEqual(resultado.imagemOrigem, "api_mercadolibre.items.pictures[0].secure_url");
    assert.notStrictEqual(resultado.imagemCanonicaDuravel, thumbnailImportador);
    assert.notStrictEqual(resultado.imagemCanonicaDuravel, radar);
    assert.strictEqual(ofertaEnriquecida.preco, 77);
    assert.strictEqual(ofertaEnriquecida.cupom, "RADAR77");
  }

  {
    _limparCacheImagemCanonicaEvento();
    const thumbnailImportador = mlImg("IMPORTADOR-THUMB-SEMRADAR", "T");
    const radar = url("radar-fallback-final");
    let apiChamadas = 0;

    const resultado = await resolverImagemCanonicaFinalEvento({
      eventoId: 9902,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto"],
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemMaterializada: radar
          }
        }
      },
      ofertaEnriquecida: {
        marketplace: "mercadolivre",
        produtoIdDetectado: "MLB1234567890",
        linkExpandido: "https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto",
        imagem: thumbnailImportador,
        imagemOrigem: "secure_thumbnail"
      }
    }, {
      buscarImagemOficialMl: async () => {
        apiChamadas += 1;
        return { imagem: "", motivo: "api_oficial_mlb_sem_imagem" };
      },
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" })
    });

    assert.strictEqual(apiChamadas, 1);
    assert.strictEqual(resultado.imagemCanonicaDuravel, "");
    assert.strictEqual(resultado.imagemStatus, "nao_resolvida");
    assert.strictEqual(resultado.motivo, "imagem_radar_nao_publicavel");
    assert.strictEqual(resultado.imagemFallbackRadarDisponivel, true);
    assert.notStrictEqual(resultado.imagemCanonicaDuravel, thumbnailImportador);
  }

  {
    _limparCacheImagemCanonicaEvento();
    const thumbnailImportador = mlImg("ULTIMO-FALLBACK", "T");

    const resultado = await resolverImagemCanonicaFinalEvento({
      eventoId: 9903,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto"],
      metadataEvento: {},
      ofertaEnriquecida: {
        marketplace: "mercadolivre",
        produtoIdDetectado: "MLB1234567890",
        linkExpandido: "https://produto.mercadolivre.com.br/MLB-1234567890-produto-correto",
        imagem: thumbnailImportador,
        imagemOrigem: "secure_thumbnail"
      }
    }, {
      buscarImagemOficialMl: async () => ({ imagem: "", motivo: "api_oficial_mlb_sem_imagem" }),
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" })
    });

    assert.strictEqual(resultado.imagemCanonicaDuravel, thumbnailImportador);
    assert.strictEqual(resultado.imagemStatus, "mercadolivre_thumbnail_fallback");
    assert.strictEqual(resultado.imagemQualidadeMercadoLivre, "baixa_fallback_final");
  }

  console.log("mercadolivre-imagem-selecao-canonica.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
