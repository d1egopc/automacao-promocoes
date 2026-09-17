const assert = require("assert");

const {
  extrairTransporteShowProductMercadoLivreHtml,
  extrairOgImageOficialMercadoLivreHtml,
  ORIGEM_TRANSPORTE_SHOW_PRODUCT
} = require("../modules/radar/mercadolivre-social-identidade");
const {
  importarMercadoLivreEngine
} = require("../modules/engine/importer/adapters/mercadolivre.adapter");

const SOCIAL_GABINETE = "https://www.mercadolivre.com.br/social/gabinete-geometric?ref=radar&origin=share";
const CTA_GABINETE = "https://www.mercadolivre.com.br/gabinete-gamer-geometric-future-model-4-king-arthur-branco/up/MLBU3627661091?pdp_filters=item_id%3AMLB5974615150";
const CTA_MOLETOM = "https://www.mercadolivre.com.br/moletom-masculino-canguru-basico/p/MLB44556677?pdp_filters=item_id%3AMLB9988776655";
const OG_GABINETE = "https://http2.mlstatic.com/D_NQ_NP_626623-MLA89981269958_082025-O.webp";
const IMAGEM_OFICIAL_GABINETE = "https://http2.mlstatic.com/D_Q_NP_2X_626623-MLA89981269958_082025-F.jpg";

function htmlCtaPrincipal(url) {
  return [
    "<script>",
    '{"id":"card-featured","tracking":{"c_id":"/home/card-featured/element"},',
    '"action_links":[{"id":"show_product","type":"link","text":"Ir para produto","url":"',
    url.replace(/\//g, "\\u002F").replace(/&/g, "\\u0026"),
    '"}]}',
    "</script>"
  ].join("");
}

function htmlCtaFeatured(url, { cta = true, marcador = "/home/card-featured/element" } = {}) {
  if (!cta) return '<section data-card="featured"></section>';
  const href = `${url}&matt_event_ts=123#polycard_client=recommendations_home_affiliate-profile&c_id=${marcador}&c_uid=fixture`;
  return `<section data-card="featured"><a href="${href.replace(/&/g, "&amp;")}" class="poly-component__link--action-link">Ir para produto</a></section>`;
}

function transporte(html) {
  return extrairTransporteShowProductMercadoLivreHtml(html, {
    socialResolvido: SOCIAL_GABINETE
  });
}

function testarGabineteTemCtaPrincipalUnico() {
  const resultado = transporte(htmlCtaPrincipal(CTA_GABINETE));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.origem, ORIGEM_TRANSPORTE_SHOW_PRODUCT);
  assert.strictEqual(resultado.socialResolvido, SOCIAL_GABINETE);
  assert.strictEqual(resultado.linkResolvidoTecnico, CTA_GABINETE);
  assert.strictEqual(resultado.ctaPrincipalUnico, true);
}

function testarMoletomUsaRotaDiretaDoMesmoCta() {
  const resultado = transporte(htmlCtaPrincipal(CTA_MOLETOM));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkResolvidoTecnico, CTA_MOLETOM);
}

function testarHtmlRealFeaturedComCtaUnico() {
  const resultado = transporte(htmlCtaFeatured(CTA_GABINETE));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.origemCTA, "social_featured_card");
  assert.strictEqual(resultado.linkResolvidoTecnico, CTA_GABINETE);
}

function testarExtraiOgImageOficialDaMesmaSocial() {
  const html = `<meta property="og:image" content="${OG_GABINETE}">${htmlCtaFeatured(CTA_GABINETE)}`;
  assert.strictEqual(extrairOgImageOficialMercadoLivreHtml(html), OG_GABINETE);
  assert.strictEqual(extrairOgImageOficialMercadoLivreHtml('<meta property="og:image" content="https://terceiro.example/imagem.jpg">'), "");
}

function testarHtmlRealDuplicadoMantemUmCtaLogico() {
  const html = `${htmlCtaFeatured(CTA_GABINETE)}${htmlCtaFeatured(CTA_GABINETE)}`;
  const resultado = transporte(html);

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkResolvidoTecnico, CTA_GABINETE);
}

function testarTituloRadarAlteradoNaoParticipaDaDecisao() {
  const resultado = transporte(htmlCtaFeatured(CTA_GABINETE));
  const tituloRadarAlterado = "Casinha pra sua TV";
  const precoRadarDiferente = 99.9;

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(tituloRadarAlterado, "Casinha pra sua TV");
  assert.strictEqual(precoRadarDiferente, 99.9);
  assert.strictEqual(resultado.linkResolvidoTecnico, CTA_GABINETE);
}

function testarSemCtaPrincipalBloqueia() {
  const resultado = transporte(htmlCtaFeatured(CTA_GABINETE, { cta: false }));

  assert.deepStrictEqual(resultado, {
    ok: false,
    motivo: "show_product_principal_ausente"
  });
}

function testarCtasConflitantesBloqueiam() {
  const resultado = transporte(`${htmlCtaFeatured(CTA_GABINETE)}${htmlCtaFeatured(CTA_MOLETOM)}`);

  assert.deepStrictEqual(resultado, {
    ok: false,
    motivo: "show_product_principal_ambiguo"
  });
}

function testarCtaNaoProdutoBloqueia() {
  const resultado = transporte(htmlCtaFeatured("https://www.mercadolivre.com.br/social/outro-perfil"));

  assert.deepStrictEqual(resultado, {
    ok: false,
    motivo: "show_product_principal_ausente"
  });
}

function testarCtaDeRecommendationSecundariaBloqueia() {
  const resultado = transporte(htmlCtaFeatured(CTA_GABINETE, {
    marcador: "/home/recommendations/element"
  }));

  assert.deepStrictEqual(resultado, {
    ok: false,
    motivo: "show_product_principal_ausente"
  });
}

async function testarAdapterTransportaSomenteUrlDoCta() {
  const original = "https://meli.la/2V35P7z";
  const chamadas = [];
  const produtoRadar = {
    marketplace: "mercadolivre",
    titulo: "Gabinete Gamer Geometric Future Model 4 King Arthur Branco",
    precoAtual: 999.9,
    preco: 999.9,
    precoOriginal: 1199.9,
    produtoIdDetectado: "MLB5974615150",
    urlFinal: CTA_GABINETE,
    linkOriginal: CTA_GABINETE,
    linkAfiliado: "https://meli.la/workspace-link",
    imagem: "https://radar.example/imagem-tatuada.jpg",
    imagemOrigem: "radar_mirror",
    categoria: "Informatica",
    statusHttp: 200
  };
  const resultado = await importarMercadoLivreEngine({
    job: { id: 1, evento_id: 2, cliente_id: "workspace", marketplace: "mercadolivre" },
    evento: {
      id: 2,
      texto_original: "Casinha pra sua TV\nPor R$ 99,90",
      links_extraidos: [original],
      metadata: {
        radarMirror: {
          produto: { tituloCapturado: "Casinha pra sua TV" },
          preco: { atualCapturado: 99.9 }
        }
      }
    },
    links: [{ url_original: original }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie", tag: "tag" } }),
      resolverLinkOriginalRadar: async () => ({
        ok: true,
        urlResolvida: SOCIAL_GABINETE,
        linkResolvido: CTA_GABINETE,
        linkOriginalLimpo: CTA_GABINETE,
        tipoLinkRadar: "shortlink_meli",
        metodoResolucaoMeli: "social_action_links_show_product",
        provaTransporteShowProduct: {
          ok: true,
          origem: ORIGEM_TRANSPORTE_SHOW_PRODUCT,
          socialResolvido: SOCIAL_GABINETE,
          linkResolvidoTecnico: CTA_GABINETE,
          actionId: "show_product",
          ctaPrincipalUnico: true,
          imagemCandidataSocial: OG_GABINETE,
          imagemCandidataOrigem: "og:image",
          imagemCandidataAnchor: {
            linkOriginalRadar: original,
            socialResolvido: SOCIAL_GABINETE,
            eventoId: 2
          }
        }
      }),
      importarMercadoLivre: async url => {
        chamadas.push(url);
        return produtoRadar;
      },
      buscarImagemCanonicaMercadoLivre: async entrada => {
        assert.strictEqual(entrada.imagem, OG_GABINETE);
        assert.strictEqual(entrada.imagemOrigem, "og:image");
        assert.strictEqual(entrada.linkExpandido, CTA_GABINETE);
        assert.deepStrictEqual(entrada.metadata.imagemCandidataSocial.anchor, {
          linkOriginalRadar: original,
          socialResolvido: SOCIAL_GABINETE,
          eventoId: 2
        });
        return {
          imagem: IMAGEM_OFICIAL_GABINETE,
          origem: "og:image.picture_id",
          pictureId: "626623-MLA89981269958_082025",
          dimensoes: { largura: 1200, altura: 1200 },
          variante: { ordem: 1, tipo: "1200" },
          motivo: "og_image_picture_id_imagem_recuperada"
        };
      },
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/workspace-link"
    }
  });

  assert.deepStrictEqual(chamadas, [CTA_GABINETE]);
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.linkOriginalRadar, original);
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.socialResolvido, SOCIAL_GABINETE);
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.origemCTA, ORIGEM_TRANSPORTE_SHOW_PRODUCT);
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.linkResolvidoTecnico, CTA_GABINETE);
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.linkAfiliadoWorkspace, "https://meli.la/workspace-link");
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.transporteShowProductConfirmado, true);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
  assert.strictEqual(resultado.preco, 99.9);
  assert.strictEqual(resultado.imagem, IMAGEM_OFICIAL_GABINETE);
  assert.strictEqual(resultado.imagemOrigem, "og:image.picture_id");
  assert.strictEqual(resultado.metadata.transporteTecnicoMl.origemImagemOficial, "og:image.picture_id");
  assert.deepStrictEqual(resultado.metadata.transporteTecnicoMl.anchor, {
    linkOriginalRadar: original,
    socialResolvido: SOCIAL_GABINETE,
    eventoId: 2
  });
  assert.strictEqual(produtoRadar.imagem, "https://radar.example/imagem-tatuada.jpg");
  assert.strictEqual(resultado.metadata.produto.metadata.imagemOriginalParaAuditoria.imagem, produtoRadar.imagem);
}

(async () => {
  testarGabineteTemCtaPrincipalUnico();
  testarMoletomUsaRotaDiretaDoMesmoCta();
  testarHtmlRealFeaturedComCtaUnico();
  testarExtraiOgImageOficialDaMesmaSocial();
  testarHtmlRealDuplicadoMantemUmCtaLogico();
  testarTituloRadarAlteradoNaoParticipaDaDecisao();
  testarSemCtaPrincipalBloqueia();
  testarCtasConflitantesBloqueiam();
  testarCtaNaoProdutoBloqueia();
  testarCtaDeRecommendationSecundariaBloqueia();
  await testarAdapterTransportaSomenteUrlDoCta();
  console.log("mercadolivre-social-show-product.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
