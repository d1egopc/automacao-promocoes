const assert = require("assert");

const {
  importarMercadoLivreEngine,
  _test
} = require("../modules/engine/importer/adapters/mercadolivre.adapter");
const { avaliarGateIdentidadeMercadoLivre } = require("../modules/engine/importer/importer.service");
const { resolverImagemCanonicaFinalEvento } = require("../modules/imagens/cache-canonico-evento");

const IMG_OFICIAL = "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB1234567890_012024-F.webp";
const IMG_RADAR = "https://cdn.exemplo.com/radar-produto-anterior.jpg";

function eventoRadar({ titulo = "Mini Body Splash Tododia Acerola e Hibisco 60ml", preco = 23.8 } = {}) {
  return {
    id: 187062,
    evento_id: 187062,
    texto_original: `${titulo}\nPor R$ ${String(preco).replace(".", ",")}\nhttps://meli.la/body`,
    metadata: {
      radarMirror: {
        produto: { tituloCapturado: titulo },
        preco: { atualCapturado: preco }
      }
    },
    links_extraidos: ["https://meli.la/body"]
  };
}

function job() {
  return {
    id: 343867,
    evento_id: 187062,
    cliente_id: "user_teste",
    marketplace: "mercadolivre"
  };
}

function linkMeli({ original = "https://meli.la/body", expandida = "https://produto.mercadolivre.com.br/MLB-6988990376-perfume-errado-_JM" } = {}) {
  return [{
    url_original: original,
    url_normalizada: original,
    url_expandida: expandida,
    marketplace_detectado: "mercadolivre"
  }];
}

function produtoMl({
  titulo = "Mini Body Splash Tododia Acerola e Hibisco 60ml",
  preco = "23,80",
  mlb = "MLB5271769078",
  imagem = IMG_OFICIAL
} = {}) {
  return {
    marketplace: "mercadolivre",
    titulo,
    nome: titulo,
    precoAtual: preco,
    preco,
    linkOriginal: `https://produto.mercadolivre.com.br/${mlb}-produto-_JM`,
    urlFinal: `https://produto.mercadolivre.com.br/${mlb}-produto-_JM`,
    linkAfiliado: "https://meli.la/afiliado",
    imagem,
    imagemOrigem: "jsonLd.image",
    statusHttp: 200
  };
}

function produtoMlComTituloPrecoMlb(titulo, preco, mlb) {
  return produtoMl({ titulo, preco, mlb });
}

function depsBasicas({ resolverUrl = "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM", produto = produtoMl() } = {}) {
  const chamadas = { importador: [] };
  return {
    chamadas,
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "ok", tag: "tag" } }),
      resolverLinkOriginalRadar: async () => ({
        ok: true,
        urlResolvida: resolverUrl,
        linkResolvido: resolverUrl,
        tipoLinkRadar: "produto"
      }),
      importarMercadoLivre: async (url) => {
        chamadas.importador.push(url);
        return produto;
      },
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado"
    }
  };
}

async function testarMeliLaContaminadoCorrigeParaShortlinkRevalidado() {
  const contexto = depsBasicas();
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: linkMeli(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(contexto.chamadas.importador[0], "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM");
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.corrigiuUrlExpandidaPrevia, true);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
}

async function testarMeliLaCorretoContinuaPublicando() {
  const contexto = depsBasicas({
    resolverUrl: "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM"
  });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: linkMeli({ expandida: "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM" }),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
}

async function testarLinkDiretoSemRegressao() {
  const direto = "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM";
  const contexto = depsBasicas({ produto: produtoMl({ mlb: "MLB5271769078" }) });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: [{ url_original: direto, url_expandida: direto, marketplace_detectado: "mercadolivre" }],
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(contexto.chamadas.importador[0], direto);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
}

async function testarProdutoConfirmadoPrecoMudouContinuaPublicando() {
  const direto = "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM";
  const contexto = depsBasicas({
    produto: produtoMl({
      titulo: "Mini Body Splash Tododia Acerola e Hibisco 60ml",
      preco: "39,90",
      mlb: "MLB5271769078"
    })
  });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ preco: 23.8 }),
    links: [{ url_original: direto, url_expandida: direto, marketplace_detectado: "mercadolivre" }],
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
  assert.strictEqual(resultado.preco, 23.8);
}

async function testarTituloPequenaVariacaoContinuaPublicando() {
  const contexto = depsBasicas({
    produto: produtoMl({
      titulo: "Mini Body Splash Tododia Acerola Hibisco 60 ml",
      preco: "23,80",
      mlb: "MLB5271769078"
    })
  });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: linkMeli({ expandida: "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM" }),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
}

function testarMesmoMlbComMedidasTextuaisDiferentesContinuaPublicando() {
  const direto = "https://produto.mercadolivre.com.br/MLB-1684184338-espelho-confirmado-_JM";
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: direto,
    resolucaoProduto: { urlProduto: direto },
    produto: produtoMlComTituloPrecoMlb(
      "Espelho Para Banheiro Decorativo Redondo 60cm",
      "74,90",
      "MLB1684184338"
    ),
    evento: eventoRadar({ titulo: "Espelho 100x50 Orgânico Corpo Inteiro Grande Moldura Caramelo", preco: 90 })
  });

  assert.strictEqual(identidade.status, "consistente");
  assert.strictEqual(identidade.mlbForteConfirmado, true);
  assert.ok(identidade.sinais.includes("medida_distintiva_diverge_titulo_radar"));
}

async function testarMlbComprovadamenteDivergenteBloqueiaAntesDaOfertaFinal() {
  const direto = "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM";
  const contexto = depsBasicas({
    produto: produtoMl({
      titulo: "Perfume Eau De Toilette Bergamota Fragrancia Fresca Duradoura",
      preco: "58,50",
      mlb: "MLB6988990376"
    })
  });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: [{ url_original: direto, url_expandida: direto, marketplace_detectado: "mercadolivre" }],
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "mercadolivre_identidade_inconsistente");
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "inconsistente");
  assert.ok(!resultado.linkAfiliado);
}

function testarTituloPromocionalNaoRetemSemPrecoDivergente() {
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: "https://meli.la/promo",
    resolucaoProduto: { urlProduto: "https://produto.mercadolivre.com.br/MLB-1111111111-power-bank-_JM" },
    produto: produtoMl({
      titulo: "Power Bank 20.000mah Carregador Portatil Rapido Com Display",
      preco: "64",
      mlb: "MLB1111111111"
    }),
    evento: eventoRadar({ titulo: "ENERGIA PRA VIAGEM TODA", preco: 64 })
  });

  assert.strictEqual(identidade.status, "consistente");
}

function testarTituloPrecoMlbDivergentesRetem() {
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: "https://meli.la/body",
    resolucaoProduto: { urlProduto: "https://produto.mercadolivre.com.br/MLB-6988990376-perfume-errado-_JM" },
    produto: produtoMl({
      titulo: "Perfume Eau De Toilette Bergamota Fragrancia Fresca Duradoura",
      preco: "58,50",
      mlb: "MLB6988990376"
    }),
    evento: eventoRadar()
  });
  const gate = avaliarGateIdentidadeMercadoLivre(
    { marketplace: "mercadolivre" },
    { identidadeCanonicaMl: identidade }
  );

  assert.strictEqual(identidade.status, "inconsistente");
  assert.strictEqual(gate.retida, true);
  assert.strictEqual(gate.motivo, "mercadolivre_identidade_inconsistente");
  assert.ok(gate.reprocessavel);
}

function testarCasioVersusRelogioGenericoRetem() {
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: "https://meli.la/1zF4xyb",
    resolucaoProduto: { urlProduto: "https://produto.mercadolivre.com.br/MLB-4849476701-relogio-generico-_JM" },
    produto: produtoMlComTituloPrecoMlb(
      "Relogio Digital Multifuncional Retro",
      "26,18",
      "MLB4849476701"
    ),
    evento: eventoRadar({ titulo: "Relógio Casio W-59-1VQ", preco: 97 })
  });

  assert.strictEqual(identidade.status, "inconsistente");
  assert.ok(identidade.sinais.includes("preco_importador_diverge_radar"));
  assert.ok(identidade.sinais.includes("modelo_distintivo_radar_ausente_importador"));
}

function testarEspelhoMedidaFormatoIncompativelRetem() {
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: "https://meli.la/2gcPUhY",
    resolucaoProduto: { urlProduto: "https://produto.mercadolivre.com.br/MLB-1684184338-espelho-redondo-_JM" },
    produto: produtoMlComTituloPrecoMlb(
      "Espelho Para Banheiro Decorativo Redondo 60cm",
      "74,90",
      "MLB1684184338"
    ),
    evento: eventoRadar({ titulo: "Espelho 100x50 Orgânico Corpo Inteiro Grande Moldura Caramelo", preco: 90 })
  });

  assert.strictEqual(identidade.status, "inconsistente");
  assert.ok(identidade.sinais.includes("medida_distintiva_diverge_titulo_radar"));
}

function testarCestoYikasaVersusGenericoRetem() {
  const identidade = _test.avaliarIdentidadeCanonicaMercadoLivre({
    urlOriginalEngine: "https://meli.la/2sLtSNx",
    resolucaoProduto: { urlProduto: "https://produto.mercadolivre.com.br/MLB-7583457936-cesto-generico-_JM" },
    produto: produtoMlComTituloPrecoMlb(
      "Cesto Organizador Bambu 70l Funcional Com Alças",
      "111,87",
      "MLB7583457936"
    ),
    evento: eventoRadar({ titulo: "Cesto De Roupas De Bambu 70 Litros Yikasa", preco: 54 })
  });

  assert.strictEqual(identidade.status, "inconsistente");
  assert.ok(identidade.sinais.includes("preco_importador_diverge_radar"));
  assert.ok(identidade.sinais.includes("termo_distintivo_radar_ausente_importador"));
}

async function testarMeliLaSocialSemProvaNaoUsaPrimeiroMlb() {
  const contexto = depsBasicas({
    resolverUrl: "https://www.mercadolivre.com.br/social/promocoes?reco_backend=item_decorator",
    produto: produtoMl({
      titulo: "Relogio Digital Multifuncional Retro",
      preco: "26,18",
      mlb: "MLB4849476701"
    })
  });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/promocoes?reco_backend=item_decorator",
    linkResolvido: "https://produto.mercadolivre.com.br/MLB-4849476701-relogio-generico-_JM",
    linkOriginalLimpo: "https://produto.mercadolivre.com.br/MLB-4849476701-relogio-generico-_JM",
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "html"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ titulo: "Relógio Casio W-59-1VQ", preco: 97 }),
    links: linkMeli({ original: "https://meli.la/1zF4xyb", expandida: "" }),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "mercadolivre_identidade_nao_confirmada");
  assert.strictEqual(contexto.chamadas.importador.length, 0);
}

async function testarMeliLaSocialComProvaEstruturadaContinuaPublicando() {
  const prova = {
    ok: true,
    origem: "card-featured.polycards[0].metadata",
    cardFeaturedUnico: true,
    totalPolycards: 1,
    mlbItem: "MLB4876269031",
    mlbProduto: "MLB32444906",
    urlProduto: "https://www.mercadolivre.com.br/processador-amd-ryzen-5-5600gt/p/MLB32444906?pdp_filters=item_id%3AMLB4876269031"
  };
  const contexto = depsBasicas({
    produto: produtoMl({
      titulo: "Processador AMD Ryzen 5 5600GT",
      preco: "799,90",
      mlb: "MLB32444906"
    })
  });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/grupostecnoart?ref=seguro",
    linkResolvido: prova.urlProduto,
    linkOriginalLimpo: prova.urlProduto,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "html",
    provaIdentidadeMeli: prova
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ titulo: "Processador AMD Ryzen 5 5600GT", preco: 799.9 }),
    links: linkMeli({ original: "https://meli.la/caso-seguro", expandida: "" }),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(contexto.chamadas.importador[0], prova.urlProduto);
  assert.strictEqual(resultado.metadata.identidadeCanonicaMl.status, "consistente");
}

async function testarImagemOficialMlVenceRadarMirror() {
  const resultado = await resolverImagemCanonicaFinalEvento({
    eventoId: 187062,
    marketplace: "mercadolivre",
    linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM"],
    metadataEvento: {
      radarMirror: {
        midia: {
          imagemOrigem: "mensagem",
          imagemOriginal: IMG_RADAR
        }
      }
    },
    ofertaEnriquecida: {
      marketplace: "mercadolivre",
      produtoIdDetectado: "MLB5271769078",
      linkExpandido: "https://produto.mercadolivre.com.br/MLB-5271769078-body-splash-_JM",
      imagem: IMG_OFICIAL,
      imagemOrigem: "jsonLd.image"
    }
  });

  assert.strictEqual(resultado.imagemCanonicaDuravel, IMG_OFICIAL);
  assert.strictEqual(resultado.imagemOrigem, "jsonLd.image");
  assert.notStrictEqual(resultado.imagemCanonicaDuravel, IMG_RADAR);
}

(async () => {
  await testarMeliLaContaminadoCorrigeParaShortlinkRevalidado();
  await testarMeliLaCorretoContinuaPublicando();
  await testarLinkDiretoSemRegressao();
  await testarProdutoConfirmadoPrecoMudouContinuaPublicando();
  await testarTituloPequenaVariacaoContinuaPublicando();
  testarMesmoMlbComMedidasTextuaisDiferentesContinuaPublicando();
  await testarMlbComprovadamenteDivergenteBloqueiaAntesDaOfertaFinal();
  testarTituloPromocionalNaoRetemSemPrecoDivergente();
  testarTituloPrecoMlbDivergentesRetem();
  testarCasioVersusRelogioGenericoRetem();
  testarEspelhoMedidaFormatoIncompativelRetem();
  testarCestoYikasaVersusGenericoRetem();
  await testarMeliLaSocialSemProvaNaoUsaPrimeiroMlb();
  await testarMeliLaSocialComProvaEstruturadaContinuaPublicando();
  await testarImagemOficialMlVenceRadarMirror();
  console.log("mercadolivre-identidade-canonica.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
