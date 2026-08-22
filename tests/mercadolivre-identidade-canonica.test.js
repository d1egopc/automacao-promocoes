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
  testarTituloPromocionalNaoRetemSemPrecoDivergente();
  testarTituloPrecoMlbDivergentesRetem();
  await testarImagemOficialMlVenceRadarMirror();
  console.log("mercadolivre-identidade-canonica.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
