const assert = require("assert");

const {
  importarMercadoLivreEngine,
  _test: testesMercadoLivre
} = require("../modules/engine/importer/adapters/mercadolivre.adapter");
const {
  extrairProvaIdentidadeMercadoLivreHtml,
  ORIGEM_PROVA_CANDIDATO_RADAR,
  ORIGEM_PROVA_BLOCO_PRINCIPAL
} = require("../modules/radar/mercadolivre-social-identidade");

const URL_PRODUTO = "https://produto.mercadolivre.com.br/MLB-777777-furadeira-parafusadeira-impacto-21v-_JM";
const URL_PRODUTO_BERMUDA = "https://produto.mercadolivre.com.br/MLB-3382028526-kit-3-bermuda-masculina-sarja-short-jeans-social-brim-lisa-_JM";
const URL_AFILIADA = "https://meli.la/cliente-fallback";
const URL_SOCIAL_AMBIGUA = "https://www.mercadolivre.com.br/social/perfil?ref=ambigua";
const URL_IMAGEM_OFICIAL = "https://http2.mlstatic.com/D_NQ_NP_2X_OFICIAL-MLB.jpg";
const URL_PRODUTO_COM_PROVA = "https://www.mercadolivre.com.br/processador-amd-ryzen-5-5600gt/p/MLB32444906?pdp_filters=item_id%3AMLB4876269031";
const URL_PRODUTO_BLOCO_PRINCIPAL = "https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB44556677?pdp_filters=item_id%3AMLB9988776655";

function job(extras = {}) {
  return {
    id: 987,
    evento_id: 654,
    cliente_id: "workspace_ml",
    marketplace: "mercadolivre",
    ...extras
  };
}

function eventoRadar({
  titulo = "Furadeira Parafusadeira Impacto 21v",
  preco = 149.9,
  precoAnterior = 229.9,
  cupom = "PROMO50",
  midia = null
} = {}) {
  return {
    id: 654,
    evento_id: 654,
    origem: "radar",
    origem_tipo: "whatsapp",
    grupo_id: "grupo@g.us",
    grupo_nome: "Radar ML",
    texto_original: `${titulo}\nPor R$ ${String(preco).replace(".", ",")}\nCupom ${cupom}\n${URL_PRODUTO}`,
    links_extraidos: [URL_PRODUTO],
    metadata: {
      radarMirror: {
        produto: { tituloCapturado: titulo },
        preco: {
          atualCapturado: preco,
          anteriorCapturado: precoAnterior
        },
        cupom: {
          codigoCapturado: cupom,
          textoCapturado: `Cupom ${cupom}`,
          condicaoCapturada: `Use ${cupom}`
        },
        comercial: {
          precoAtual: { valor: preco, confianca: "alta" },
          precoAntigo: { valor: precoAnterior, confianca: "media" },
          cupom: { codigo: cupom, instrucao: `Use ${cupom}`, confianca: "alta" }
        },
        ...(midia ? { midia } : {})
      }
    }
  };
}

function eventoClonador({
  titulo = "Kit 3 Bermuda Masculina Sarja Short Jeans Social Brim Lisa",
  preco = 106.94,
  precoAnterior = 183,
  cupom = "OFERTASEMPRE",
  beneficio = "Aplique o cupom OFERTASEMPRE + Pix para chegar neste valor.",
  origem = "clonador_grupos",
  imagem = ""
} = {}) {
  const campos = {};
  if (titulo) campos.titulo = true;
  if (preco !== null && preco !== undefined && preco !== "") campos.precoAtual = true;
  if (precoAnterior !== null && precoAnterior !== undefined && precoAnterior !== "") campos.precoAnterior = true;
  if (cupom) campos.cupom = true;
  if (beneficio) campos.beneficio = true;
  if (imagem) campos.imagem = true;
  return {
    id: 655,
    evento_id: 655,
    origem,
    origem_tipo: "whatsapp",
    grupo_id: "grupo-clonador@g.us",
    grupo_nome: "Clonador ML",
    texto_original: [
      "PRECINHO DE 107 LEVA 3 BERMUDAS",
      "",
      titulo || "",
      "",
      "De: R$ 183",
      "Por: R$ 106,94 no Pix",
      "",
      "Cupom: OFERTASEMPRE",
      "",
      URL_PRODUTO_BERMUDA,
      "",
      beneficio || ""
    ].join("\n"),
    links_extraidos: [URL_PRODUTO_BERMUDA],
    metadata: {
      clonadorGrupos: {
        bufferId: "6",
        destinoIds: ["destino_autorizado"],
        sessaoId: "sessao_a",
        grupoJid: "grupo-clonador@g.us",
        grupoNome: "Clonador ML"
      },
      comercialCapturado: {
        versao: "clonador_comercial_capturado_v1",
        origem: "clonador_grupos",
        tituloCapturado: titulo || "",
        precoAtual: preco,
        precoAnterior,
        cupom,
        beneficioTexto: beneficio,
        beneficioExtra: beneficio,
        imagem,
        campos
      }
    }
  };
}

function links(url = URL_PRODUTO) {
  return [{
    url_original: url,
    url_normalizada: url,
    url_expandida: url,
    marketplace_detectado: "mercadolivre"
  }];
}

function provaMeliValida() {
  return {
    ok: true,
    origem: "card-featured.polycards[0].metadata",
    cardFeaturedUnico: true,
    totalPolycards: 1,
    mlbItem: "MLB4876269031",
    mlbProduto: "MLB32444906",
    urlProduto: URL_PRODUTO_COM_PROVA
  };
}

function htmlBlocoPrincipalSocial({ mlbItem = "MLB9988776655", mlbProduto = "MLB44556677", url = URL_PRODUTO_BLOCO_PRINCIPAL } = {}) {
  return `<html><script>${JSON.stringify({
    components: [{
      id: "main-product",
      item_id: mlbItem,
      product_id: mlbProduto,
      url
    }]
  })}</script></html>`;
}

function htmlCandidatoRadarSocial({
  mlbItem = "MLB7197806380",
  mlbProduto = "MLB35277819",
  titulo = "Booster Facial Medicube Vita A Retinal Volufiline 5 15ml",
  url = "https://produto.mercadolivre.com.br/MLB-7197806380-booster-facial-medicube-vita-a-retinal-volufiline-5-15ml-_JM"
} = {}) {
  return `<html><script>${JSON.stringify({
    recommendations: {
      polycards: [{
        metadata: {
          id: mlbItem,
          product_id: mlbProduto,
          title: titulo,
          url
        }
      }]
    }
  })}</script></html>`;
}

function produtoHtmlOk() {
  return {
    marketplace: "mercadolivre",
    titulo: "Produto HTML factual",
    nome: "Produto HTML factual",
    precoAtual: 111.11,
    preco: 111.11,
    precoOriginal: 199.99,
    imagem: "https://http2.mlstatic.com/D_NQ_NP_html.jpg",
    imagemOrigem: "jsonLd.image",
    linkOriginal: URL_PRODUTO,
    urlFinal: URL_PRODUTO,
    linkAfiliado: URL_AFILIADA,
    categoria: "Ferramentas",
    statusHttp: 200
  };
}

function depsBase({ produto = null, wall = false, linkAfiliado = URL_AFILIADA, recusarMeliLaDireto = false, imagemOficial = null, imagemOficialErro = null } = {}) {
  const chamadas = {
    importar: [],
    afiliado: [],
    imagemOficial: []
  };
  return {
    chamadas,
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie", tag: "tag" } }),
      importarMercadoLivre: async (url, clienteId, opcoes = {}) => {
        chamadas.importar.push({ url, clienteId, chaves: Object.keys(opcoes).sort() });
        if (wall && typeof opcoes.registrarBloqueioOperacionalMercadoLivre === "function") {
          opcoes.registrarBloqueioOperacionalMercadoLivre({
            motivo: "ml_wall_captcha",
            statusHttp: 200,
            urlFinal: "https://www.mercadolivre.com.br/captcha/wall/logged",
            temBloqueio: true
          });
        }
        return produto;
      },
      gerarLinkAfiliadoMercadoLivre: async (url, integracao, contexto) => {
        chamadas.afiliado.push({ url, temIntegracao: Boolean(integracao), clienteId: contexto?.clienteId || "" });
        if (recusarMeliLaDireto && /^https?:\/\/(?:www\.)?meli\.la\//i.test(String(url || ""))) return "";
        return linkAfiliado;
      },
      buscarImagemOficialMercadoLivrePorMlb: async (mlb, opcoes = {}) => {
        chamadas.imagemOficial.push({
          mlb,
          clienteId: opcoes.clienteId || "",
          temGetIntegracaoCliente: typeof opcoes.getIntegracaoCliente === "function"
        });
        if (imagemOficialErro) throw imagemOficialErro;
        return imagemOficial || { imagem: "", origem: "", motivo: "api_oficial_mlb_sem_imagem" };
      }
    }
  };
}

async function capturarLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args);
  try {
    const retorno = await fn();
    return { logs, retorno };
  } finally {
    console.log = original;
  }
}

async function testarHtmlFactualPreservado() {
  const contexto = depsBase({ produto: produtoHtmlOk() });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Produto HTML factual");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.imagem, "https://http2.mlstatic.com/D_NQ_NP_html.jpg");
  assert.notStrictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
  assert.strictEqual(resultado.metadata.origemPreco, "texto_radar");
}

async function testarWallComRadarSuficienteRecuperaOferta() {
  const contexto = depsBase({ wall: true });
  const { logs, retorno: resultado } = await capturarLogs(() => importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(),
    deps: contexto.deps
  }));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
  assert.strictEqual(resultado.metadata.origemComercial, "radar");
  assert.strictEqual(resultado.metadata.origemPreco, "texto_radar");
  assert.strictEqual(resultado.metadata.origemTitulo, "texto_radar");
  assert.strictEqual(resultado.titulo, "Furadeira Parafusadeira Impacto 21v");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.precoOriginal, 229.9);
  assert.strictEqual(resultado.cupom, "PROMO50");
  assert.strictEqual(resultado.linkAfiliado, URL_AFILIADA);
  assert.strictEqual(contexto.chamadas.afiliado.length, 1);
  assert(logs.some(args => String(args[0]) === "[ENGINE-ML-FALLBACK-RADAR]" && String(args[1] || "").includes("oferta_recuperada")));
}

async function testarWallComImagemRadarHttpValidaPreservaImagem() {
  const imagemRadar = "https://cdn.exemplo.com/produto-radar.jpg";
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, imagemRadar);
  assert.strictEqual(resultado.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(resultado.metadata.origemImagem, "radar_mirror/mensagem.midia.imagemOriginal");
}

async function testarWallRadarComImagemOficialSubstituiSomenteImagem() {
  const imagemRadar = "https://cdn.exemplo.com/produto-radar-com-logo.jpg";
  const contexto = depsBase({
    wall: true,
    imagemOficial: {
      imagem: URL_IMAGEM_OFICIAL,
      origem: "api_mercadolibre.items.pictures[0].secure_url",
      motivo: "api_oficial_mlb_imagem_recuperada",
      title: "Titulo API ignorado",
      price: 9999
    }
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Furadeira Parafusadeira Impacto 21v");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.precoOriginal, 229.9);
  assert.strictEqual(resultado.cupom, "PROMO50");
  assert.strictEqual(resultado.linkAfiliado, URL_AFILIADA);
  assert.strictEqual(resultado.imagem, URL_IMAGEM_OFICIAL);
  assert.strictEqual(resultado.imagemOrigem, "api_mercadolibre.items.pictures[0].secure_url");
  assert.strictEqual(resultado.metadata.origemImagem, "api_mercadolibre.items.pictures[0].secure_url");
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 1);
  assert.strictEqual(contexto.chamadas.imagemOficial[0].mlb, "MLB777777");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(resultado, "title"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(resultado, "price"), false);
}

async function testarWallRadarFalhaImagemOficialMantemRadarExata() {
  const imagemRadar = "https://cdn.exemplo.com/produto-radar-preservado.jpg";
  const contexto = depsBase({
    wall: true,
    imagemOficialErro: new Error("api_indisponivel")
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, imagemRadar);
  assert.strictEqual(resultado.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(resultado.metadata.origemImagem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(resultado.titulo, "Furadeira Parafusadeira Impacto 21v");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.cupom, "PROMO50");
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 1);
}

async function testarWallRadarPdpFiltersUsaItemIdSemUsarCatalogo() {
  const imagemRadar = "https://cdn.exemplo.com/radar-pdp.jpg";
  const urlPdp = "https://www.mercadolivre.com.br/processador-amd/p/MLB32444906?pdp_filters=item_id%3AMLB4876269031";
  const contexto = depsBase({
    wall: true,
    imagemOficial: {
      imagem: URL_IMAGEM_OFICIAL,
      origem: "api_mercadolibre.items.pictures[0].secure_url"
    }
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(urlPdp),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, URL_IMAGEM_OFICIAL);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 1);
  assert.strictEqual(contexto.chamadas.imagemOficial[0].mlb, "MLB4876269031");
}

async function testarWallRadarPdpSemItemIdNaoChamaImagemOficial() {
  const imagemRadar = "https://cdn.exemplo.com/radar-pdp-sem-item.jpg";
  const urlPdp = "https://www.mercadolivre.com.br/processador-amd/p/MLB32444906";
  const contexto = depsBase({
    wall: true,
    imagemOficial: {
      imagem: URL_IMAGEM_OFICIAL,
      origem: "api_mercadolibre.items.pictures[0].secure_url"
    }
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(urlPdp),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, imagemRadar);
  assert.strictEqual(resultado.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
}

async function testarWallComThumbnailEDirectPathSegueSemImagem() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: "/v/t62.7118-24/direct-path"
      }
    }),
    links: links(),
    deps: contexto.deps
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, "");
  assert.strictEqual(resultado.metadata.origemImagem, "nenhuma");

  const resultadoThumbnail = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "thumbnail",
        imagemOriginal: "thumbnail:imageMessage"
      }
    }),
    links: links(),
    deps: contexto.deps
  });
  assert.strictEqual(resultadoThumbnail.ok, true);
  assert.strictEqual(resultadoThumbnail.imagem, "");
  assert.strictEqual(resultadoThumbnail.metadata.origemImagem, "nenhuma");
}

async function testarWallSemTituloFalhaSeguro() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ titulo: "" }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.titulo, true);
}

async function testarTituloWindowsIsoladoContinuaBloqueado() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ titulo: "windows" }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.titulo, true);
}

async function testarTituloLegitimoComWindowsContinuaAceito() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ titulo: "Notebook Lenovo IdeaPad com Windows 11" }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Notebook Lenovo IdeaPad com Windows 11");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
}

async function testarWallSemPrecoFalhaSeguro() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ preco: "" }),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.preco, true);
}

async function testarWallComFalhaAfiliadoFalhaSeguro() {
  const contexto = depsBase({ wall: true, linkAfiliado: "" });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
}

async function testarWallClonadorComContratoSuficienteRecuperaOfertaSemImagem() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador(),
    links: links(URL_PRODUTO_BERMUDA),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreClonador, true);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, undefined);
  assert.strictEqual(resultado.metadata.origemComercial, "clonador_grupos");
  assert.strictEqual(resultado.metadata.origemPreco, "clonador_grupos");
  assert.strictEqual(resultado.metadata.origemTitulo, "clonador_grupos");
  assert.strictEqual(resultado.titulo, "Kit 3 Bermuda Masculina Sarja Short Jeans Social Brim Lisa");
  assert.strictEqual(resultado.preco, 106.94);
  assert.strictEqual(resultado.precoOriginal, 183);
  assert.strictEqual(resultado.cupom, "OFERTASEMPRE");
  assert.ok(resultado.beneficioExtra.includes("OFERTASEMPRE + Pix"));
  assert.strictEqual(resultado.produtoIdDetectado, "MLB3382028526");
  assert.strictEqual(resultado.imagem, "");
  assert.strictEqual(resultado.metadata.origemImagem, "nenhuma");
  assert.strictEqual(resultado.linkAfiliado, URL_AFILIADA);
  assert.ok(!resultado.metadata.radarMirror);
}

async function testarRadarSocialAmbiguoSegueFallbackPuroSemVazarCandidato() {
  const shortlink = "https://meli.la/shortlink-radar-ambigua";
  const imagemRadar = "https://cdn.exemplo.com/radar-original.jpg";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: URL_PRODUTO,
    linkResolvido: URL_PRODUTO,
    metodoResolucaoMeli: "fallback_intermediario"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: imagemRadar
      }
    }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
  assert.strictEqual(resultado.metadata.motivoFallback, "mercadolivre_identidade_nao_confirmada");
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
  assert.ok(contexto.chamadas.afiliado.every(chamada => !/^https?:\/\/(?:www\.)?meli\.la\//i.test(String(chamada.url || ""))));
  assert.ok(contexto.chamadas.afiliado.every(chamada => !/^https?:\/\/(?:www\.)?mercadolivre\.com\.br\/social\//i.test(String(chamada.url || ""))));
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
  const serializado = JSON.stringify(resultado);
  assert.ok(!serializado.includes(URL_PRODUTO), "URL candidata insegura nao pode vazar para fallback puro Radar");
  assert.ok(!serializado.includes("MLB777777"), "MLB candidato inseguro nao pode vazar para fallback puro Radar");
}

async function testarRadarUrlResolvidaProdutoDiretoViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-url-resolvida-produto";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_PRODUTO,
    linkResolvido: "",
    linkOriginalLimpo: "",
    tipoLinkRadar: "shortlink_meli_social",
    metodoResolucaoMeli: "redirect"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.linkExpandido, shortlink);
  assert.strictEqual(resultado.titulo, "Furadeira Parafusadeira Impacto 21v");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.precoOriginal, 229.9);
  assert.strictEqual(resultado.cupom, "PROMO50");
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 1);
  assert.strictEqual(contexto.chamadas.afiliado[0].url, URL_PRODUTO);
}

async function testarRadarProdutoComProvaForteViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-produto-com-prova";
  const prova = provaMeliValida();

  const transporte = testesMercadoLivre.resolverUrlTransporteAfiliadoFallbackPuroMercadoLivre(shortlink, {
    urlProduto: prova.urlProduto,
    linkExpandidoEngine: prova.urlProduto,
    resolucaoRadar: {
      ok: true,
      urlResolvida: URL_SOCIAL_AMBIGUA,
      linkOriginalLimpo: prova.urlProduto,
      linkResolvido: prova.urlProduto,
      tipoLinkRadar: "shortlink_meli",
      metodoResolucaoMeli: "html",
      provaIdentidadeMeli: prova
    }
  });

  assert.strictEqual(transporte, URL_PRODUTO_COM_PROVA);
}

async function testarRadarProdutoComProvaBlocoPrincipalViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-produto-com-prova-bloco-principal";
  const prova = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipalSocial());
  assert.strictEqual(prova.ok, true);
  assert.strictEqual(prova.origem, ORIGEM_PROVA_BLOCO_PRINCIPAL);

  const transporte = testesMercadoLivre.resolverUrlTransporteAfiliadoFallbackPuroMercadoLivre(shortlink, {
    urlProduto: prova.urlProduto,
    linkExpandidoEngine: prova.urlProduto,
    resolucaoRadar: {
      ok: true,
      urlResolvida: URL_SOCIAL_AMBIGUA,
      linkOriginalLimpo: prova.urlProduto,
      linkResolvido: prova.urlProduto,
      tipoLinkRadar: "shortlink_meli",
      metodoResolucaoMeli: "fallback_intermediario",
      provaIdentidadeMeli: prova
    }
  });

  assert.strictEqual(transporte, URL_PRODUTO_BLOCO_PRINCIPAL);
}

async function testarRadarComProvaBlocoPrincipalPreservaPublicadosEComercial() {
  const shortlink = "https://meli.la/shortlink-prova-bloco-principal-fim-a-fim";
  const imagemRadar = "https://cdn.exemplo.com/oferta-original.jpg";
  const prova = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipalSocial());
  assert.strictEqual(prova.ok, true);

  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: prova.urlProduto,
    linkResolvido: prova.urlProduto,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "fallback_intermediario",
    provaIdentidadeMeli: prova
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({ midia: { imagemOrigem: "mensagem", imagemOriginal: imagemRadar } }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.linkExpandido, shortlink);
  assert.strictEqual(resultado.titulo, "Furadeira Parafusadeira Impacto 21v");
  assert.strictEqual(resultado.preco, 149.9);
  assert.strictEqual(resultado.precoOriginal, 229.9);
  assert.strictEqual(resultado.cupom, "PROMO50");
  assert.strictEqual(resultado.imagem, imagemRadar);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 1);
  assert.strictEqual(contexto.chamadas.afiliado[0].url, URL_PRODUTO_BLOCO_PRINCIPAL);
}

async function testarRadarCandidatoProvadoAlimentaAfiliadoEImagemOficial() {
  const shortlink = "https://meli.la/shortlink-candidato-radar-provado";
  const titulo = "Booster Facial Medicube Vita A Retinal Volufiline 5 15ml";
  const imagemRadar = "https://cdn.exemplo.com/radar-grupo-marca.jpg";
  const prova = extrairProvaIdentidadeMercadoLivreHtml(htmlCandidatoRadarSocial(), { tituloRadar: titulo });
  assert.strictEqual(prova.ok, true);
  assert.strictEqual(prova.origem, ORIGEM_PROVA_CANDIDATO_RADAR);

  const contexto = depsBase({
    wall: true,
    recusarMeliLaDireto: true,
    imagemOficial: {
      imagem: URL_IMAGEM_OFICIAL,
      origem: "api_mercadolibre.items.pictures[0].secure_url"
    }
  });
  contexto.deps.resolverLinkOriginalRadar = async (url, opcoes = {}) => {
    assert.strictEqual(url, shortlink);
    assert.strictEqual(opcoes.tituloRadar, titulo);
    return {
      ok: true,
      urlResolvida: URL_SOCIAL_AMBIGUA,
      linkOriginalLimpo: prova.urlProduto,
      linkResolvido: prova.urlProduto,
      tipoLinkRadar: "shortlink_meli",
      metodoResolucaoMeli: "fallback_intermediario",
      provaIdentidadeMeli: prova
    };
  };

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      titulo,
      preco: 88.88,
      precoAnterior: 129.9,
      cupom: "VITA15",
      midia: { imagemOrigem: "mensagem", imagemOriginal: imagemRadar }
    }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.linkExpandido, shortlink);
  assert.strictEqual(resultado.titulo, titulo);
  assert.strictEqual(resultado.preco, 88.88);
  assert.strictEqual(resultado.precoOriginal, 129.9);
  assert.strictEqual(resultado.cupom, "VITA15");
  assert.strictEqual(resultado.imagem, URL_IMAGEM_OFICIAL);
  assert.strictEqual(resultado.imagemOrigem, "api_mercadolibre.items.pictures[0].secure_url");
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 1);
  assert.strictEqual(contexto.chamadas.afiliado[0].url, prova.urlProduto);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 1);
  assert.strictEqual(contexto.chamadas.imagemOficial[0].mlb, prova.mlbItem);
}

async function testarRadarCandidatoProvadoComErroImagemMantemRadar() {
  const shortlink = "https://meli.la/shortlink-candidato-radar-imagem-falha";
  const titulo = "Booster Facial Medicube Vita A Retinal Volufiline 5 15ml";
  const imagemRadar = "https://cdn.exemplo.com/radar-fallback-original.jpg";
  const prova = extrairProvaIdentidadeMercadoLivreHtml(htmlCandidatoRadarSocial(), { tituloRadar: titulo });
  const contexto = depsBase({
    wall: true,
    recusarMeliLaDireto: true,
    imagemOficialErro: new Error("api_imagem_indisponivel")
  });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: prova.urlProduto,
    linkResolvido: prova.urlProduto,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "fallback_intermediario",
    provaIdentidadeMeli: prova
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar({
      titulo,
      preco: 88.88,
      precoAnterior: 129.9,
      cupom: "VITA15",
      midia: { imagemOrigem: "mensagem", imagemOriginal: imagemRadar }
    }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.linkExpandido, shortlink);
  assert.strictEqual(resultado.titulo, titulo);
  assert.strictEqual(resultado.preco, 88.88);
  assert.strictEqual(resultado.precoOriginal, 129.9);
  assert.strictEqual(resultado.cupom, "VITA15");
  assert.strictEqual(resultado.imagem, imagemRadar);
  assert.strictEqual(contexto.chamadas.afiliado[0].url, prova.urlProduto);
  assert.strictEqual(contexto.chamadas.imagemOficial[0].mlb, prova.mlbItem);
}

async function testarRadarProdutoDivergeProvaNaoViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-produto-diverge-prova";
  const prova = provaMeliValida();
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: URL_PRODUTO_BERMUDA,
    linkResolvido: URL_PRODUTO_BERMUDA,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "html",
    provaIdentidadeMeli: prova
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
}

async function testarRadarProdutoDiretoComParametroMlbDivergenteNaoViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-produto-direto-parametro-divergente";
  const prova = provaMeliValida();
  const produtoAComParametroB = `${URL_PRODUTO}?pdp_filters=item_id%3A${prova.mlbItem}`;

  const transporte = testesMercadoLivre.resolverUrlTransporteAfiliadoFallbackPuroMercadoLivre(shortlink, {
    urlProduto: produtoAComParametroB,
    linkExpandidoEngine: produtoAComParametroB,
    resolucaoRadar: {
      ok: true,
      urlResolvida: URL_SOCIAL_AMBIGUA,
      linkOriginalLimpo: produtoAComParametroB,
      linkResolvido: produtoAComParametroB,
      tipoLinkRadar: "shortlink_meli",
      metodoResolucaoMeli: "html",
      provaIdentidadeMeli: prova
    }
  });

  assert.strictEqual(transporte, "");
}

async function testarRadarUrlNaoResolvidaSegueFallbackPuroQuandoSuficiente() {
  const shortlink = "https://meli.la/shortlink-sem-produto";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: false,
    urlResolvida: "https://www.mercadolivre.com.br/social/perfil?ref=sem-produto",
    motivo: "identidade_ml_nao_comprovada"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
  assert.strictEqual(resultado.metadata.motivoFallback, "ml_url_produto_nao_resolvida");
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
}

async function testarRadarSocialComFalhaAfiliadoContinuaInsuficiente() {
  const shortlink = "https://meli.la/shortlink-social-sem-afiliado";
  const contexto = depsBase({ wall: true, linkAfiliado: "", recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: URL_PRODUTO,
    linkResolvido: URL_PRODUTO,
    metodoResolucaoMeli: "fallback_intermediario"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
}

async function testarSocialForaDeUrlResolvidaNaoViraTransporteAfiliado() {
  const shortlink = "https://meli.la/shortlink-social-nao-direta";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "",
    linkResolvido: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: URL_PRODUTO,
    metodoResolucaoMeli: "html"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
}

async function testarFallbackPuroSemTransporteSeguroNaoEnviaMeliLaAfiliado() {
  const shortlink = "https://meli.la/shortlink-sem-transporte-seguro";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: false,
    urlResolvida: "",
    linkResolvido: URL_SOCIAL_AMBIGUA,
    metodoResolucaoMeli: "html"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
}

async function testarClonadorSocialAmbiguoSegueFallbackPuroSemVazarCandidato() {
  const shortlink = "https://meli.la/shortlink-ambigua";
  const imagemClone = "https://cdn.exemplo.com/clone-original.jpg";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: URL_SOCIAL_AMBIGUA,
    linkOriginalLimpo: URL_PRODUTO_BERMUDA,
    linkResolvido: URL_PRODUTO_BERMUDA,
    metodoResolucaoMeli: "fallback_intermediario"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador({ imagem: imagemClone }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_clonador_insuficiente");
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreClonador, true);
  assert.strictEqual(resultado.metadata.motivoFallback, "mercadolivre_identidade_nao_confirmada");
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 0);
  const serializado = JSON.stringify(resultado);
  assert.ok(!serializado.includes(URL_PRODUTO_BERMUDA), "URL candidata insegura nao pode vazar para fallback puro Clone");
  assert.ok(!serializado.includes("MLB3382028526"), "MLB candidato inseguro nao pode vazar para fallback puro Clone");
}

async function testarClonadorComProvaUsaMlbItemParaImagemOficial() {
  const shortlink = "https://meli.la/shortlink-prova-imagem-oficial";
  const imagemClone = "https://cdn.exemplo.com/clone-com-marca.jpg";
  const prova = {
    ok: true,
    origem: "card-featured.polycards[0].metadata",
    cardFeaturedUnico: true,
    totalPolycards: 1,
    mlbItem: "MLB4876269031",
    mlbProduto: "MLB32444906",
    urlProduto: "https://www.mercadolivre.com.br/processador-amd-ryzen-5-5600gt/p/MLB32444906?pdp_filters=item_id%3AMLB4876269031"
  };
  const contexto = depsBase({
    wall: true,
    imagemOficial: {
      imagem: URL_IMAGEM_OFICIAL,
      origem: "api_mercadolibre.items.pictures[0].secure_url"
    }
  });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/grupostecnoart",
    linkOriginalLimpo: prova.urlProduto,
    linkResolvido: prova.urlProduto,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "html",
    provaIdentidadeMeli: prova
  });

  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador({
      titulo: "Processador AMD Ryzen 5 5600GT",
      preco: 799.9,
      precoAnterior: 999.9,
      cupom: "AMD100",
      beneficio: "Cupom AMD100 no Pix.",
      imagem: imagemClone
    }),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Processador AMD Ryzen 5 5600GT");
  assert.strictEqual(resultado.preco, 799.9);
  assert.strictEqual(resultado.precoOriginal, 999.9);
  assert.strictEqual(resultado.cupom, "AMD100");
  assert.strictEqual(resultado.imagem, URL_IMAGEM_OFICIAL);
  assert.strictEqual(resultado.imagemOrigem, "api_mercadolibre.items.pictures[0].secure_url");
  assert.strictEqual(contexto.chamadas.imagemOficial.length, 1);
  assert.strictEqual(contexto.chamadas.imagemOficial[0].mlb, "MLB4876269031");
}

async function testarClonadorSocialComParametroExplicitoEstruturadoPassa() {
  const contexto = depsBase({ wall: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/perfil?url=https%3A%2F%2Fproduto.mercadolivre.com.br%2FMLB-3382028526",
    linkOriginalLimpo: URL_PRODUTO_BERMUDA,
    linkResolvido: URL_PRODUTO_BERMUDA,
    metodoResolucaoMeli: "parametro"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador(),
    links: links("https://meli.la/shortlink-parametro"),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreClonador, true);
  assert.strictEqual(contexto.chamadas.importar.length, 1);
  assert.strictEqual(contexto.chamadas.afiliado.length, 1);
  assert.strictEqual(contexto.chamadas.afiliado[0].url, URL_PRODUTO_BERMUDA);
}

async function testarClonadorParametroSocialSemVinculoSegueFallbackPuro() {
  const shortlink = "https://meli.la/shortlink-parametro-social";
  const contexto = depsBase({ wall: true, recusarMeliLaDireto: true });
  contexto.deps.resolverLinkOriginalRadar = async () => ({
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/perfil?reco_backend=item_decorator",
    linkOriginalLimpo: URL_PRODUTO_BERMUDA,
    linkResolvido: URL_PRODUTO_BERMUDA,
    metodoResolucaoMeli: "parametro"
  });

  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador(),
    links: links(shortlink),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_clonador_insuficiente");
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreClonador, true);
  assert.strictEqual(resultado.metadata.motivoFallback, "mercadolivre_identidade_nao_confirmada");
  assert.strictEqual(resultado.linkOriginal, shortlink);
  assert.strictEqual(resultado.metadata.insuficiente.linkAfiliado, true);
  assert.strictEqual(contexto.chamadas.importar.length, 0);
  assert.strictEqual(contexto.chamadas.afiliado.length, 0);
  const serializado = JSON.stringify(resultado);
  assert.ok(!serializado.includes(URL_PRODUTO_BERMUDA), "produto candidato por recommendation nao pode vazar para fallback puro Clone");
}

async function testarOrigemDiferenteNaoUsaComercialCapturadoClonador() {
  const contexto = depsBase({ wall: true });
  const resultado = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador({ origem: "engine" }),
    links: links(URL_PRODUTO_BERMUDA),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "fallback_radar_insuficiente");
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreClonador, undefined);
  assert.strictEqual(resultado.metadata.fallbackMercadoLivreRadar, true);
}

async function testarWallClonadorSemTituloOuPrecoFalhaSeguro() {
  const contextoSemTitulo = depsBase({ wall: true });
  const semTitulo = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador({ titulo: "" }),
    links: links(URL_PRODUTO_BERMUDA),
    deps: contextoSemTitulo.deps
  });
  assert.strictEqual(semTitulo.ok, false);
  assert.strictEqual(semTitulo.motivo, "fallback_clonador_insuficiente");
  assert.strictEqual(semTitulo.metadata.insuficiente.titulo, true);

  const contextoSemPreco = depsBase({ wall: true });
  const semPreco = await importarMercadoLivreEngine({
    job: job({ evento_id: 655 }),
    evento: eventoClonador({ preco: null }),
    links: links(URL_PRODUTO_BERMUDA),
    deps: contextoSemPreco.deps
  });
  assert.strictEqual(semPreco.ok, false);
  assert.strictEqual(semPreco.motivo, "fallback_clonador_insuficiente");
  assert.strictEqual(semPreco.metadata.insuficiente.preco, true);
}

async function testarErroGenericoNaoAtivaFallback() {
  const contexto = depsBase({ produto: null, wall: false });
  const resultado = await importarMercadoLivreEngine({
    job: job(),
    evento: eventoRadar(),
    links: links(),
    deps: contexto.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "importador_sem_retorno");
  assert.strictEqual(resultado.metadata?.fallbackMercadoLivreRadar, undefined);
}

(async () => {
  await testarHtmlFactualPreservado();
  await testarWallComRadarSuficienteRecuperaOferta();
  await testarWallComImagemRadarHttpValidaPreservaImagem();
  await testarWallRadarComImagemOficialSubstituiSomenteImagem();
  await testarWallRadarFalhaImagemOficialMantemRadarExata();
  await testarWallRadarPdpFiltersUsaItemIdSemUsarCatalogo();
  await testarWallRadarPdpSemItemIdNaoChamaImagemOficial();
  await testarWallComThumbnailEDirectPathSegueSemImagem();
  await testarWallSemTituloFalhaSeguro();
  await testarTituloWindowsIsoladoContinuaBloqueado();
  await testarTituloLegitimoComWindowsContinuaAceito();
  await testarWallSemPrecoFalhaSeguro();
  await testarWallComFalhaAfiliadoFalhaSeguro();
  await testarWallClonadorComContratoSuficienteRecuperaOfertaSemImagem();
  await testarRadarSocialAmbiguoSegueFallbackPuroSemVazarCandidato();
  await testarRadarUrlResolvidaProdutoDiretoViraTransporteAfiliado();
  await testarRadarProdutoComProvaForteViraTransporteAfiliado();
  await testarRadarProdutoComProvaBlocoPrincipalViraTransporteAfiliado();
  await testarRadarComProvaBlocoPrincipalPreservaPublicadosEComercial();
  await testarRadarCandidatoProvadoAlimentaAfiliadoEImagemOficial();
  await testarRadarCandidatoProvadoComErroImagemMantemRadar();
  await testarRadarProdutoDivergeProvaNaoViraTransporteAfiliado();
  await testarRadarProdutoDiretoComParametroMlbDivergenteNaoViraTransporteAfiliado();
  await testarRadarUrlNaoResolvidaSegueFallbackPuroQuandoSuficiente();
  await testarRadarSocialComFalhaAfiliadoContinuaInsuficiente();
  await testarSocialForaDeUrlResolvidaNaoViraTransporteAfiliado();
  await testarFallbackPuroSemTransporteSeguroNaoEnviaMeliLaAfiliado();
  await testarClonadorSocialAmbiguoSegueFallbackPuroSemVazarCandidato();
  await testarClonadorComProvaUsaMlbItemParaImagemOficial();
  await testarClonadorSocialComParametroExplicitoEstruturadoPassa();
  await testarClonadorParametroSocialSemVinculoSegueFallbackPuro();
  await testarOrigemDiferenteNaoUsaComercialCapturadoClonador();
  await testarWallClonadorSemTituloOuPrecoFalhaSeguro();
  await testarErroGenericoNaoAtivaFallback();
  console.log("mercadolivre-radar-fallback.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
