const assert = require("assert");
const fs = require("fs");
const path = require("path");
const radarCupomMensagem = require("../utils/radar-cupom-mensagem");
const {
  normalizarCodigoCupomSemantico,
  normalizarCuponsSemanticos
} = require("../modules/radar/cupom-semantico");

const {
  espelhoComercialRadarSuficiente,
  extrairDadosTecnicosImportador,
  motivoImportadorIgnoravelPeloEspelho,
  montarOfertaRadarEspelhoComercial
} = require("../modules/radar/espelho-comercial");

function campo(valor, confianca = "alta", evidencia = "", extras = {}) {
  return { valor, confianca, evidencia, ...extras };
}

function criarMirror() {
  return {
    versao: 1,
    origem: { clienteId: "admin", tipo: "whatsapp" },
    texto: {
      original: [
        "MODELO PERFEITINHO MENINAS",
        "Tenis Puma Carina Street BDP",
        "DE 499 | POR 205 no Pix ou 215,83 ate 6x",
        "CUPOM: FASHION ou MODACOMVC",
        "https://meli.la/2GTPyMb"
      ].join("\n"),
      limpo: [
        "MODELO PERFEITINHO MENINAS",
        "Tenis Puma Carina Street BDP",
        "DE 499 | POR 205 no Pix ou 215,83 ate 6x",
        "CUPOM: FASHION ou MODACOMVC",
        "https://meli.la/2GTPyMb"
      ].join("\n")
    },
    produto: {
      tituloCapturado: "Tenis Puma Carina Street BDP"
    },
    preco: {
      atualCapturado: 205,
      anteriorCapturado: 499,
      confianca: "alta",
      tipoCapturado: "pix",
      evidenciaCapturada: "POR 205 no Pix",
      marcadorComercial: "por"
    },
    cupom: {
      codigoCapturado: "FASHION",
      codigosCapturados: ["FASHION", "MODACOMVC"],
      textoCapturado: "CUPOM: FASHION ou MODACOMVC",
      condicaoCapturada: "CUPOM: FASHION ou MODACOMVC",
      confianca: "alta"
    },
    links: {
      encontrados: ["https://meli.la/2GTPyMb"],
      produtoOriginal: "https://meli.la/2GTPyMb",
      resgateCupom: null,
      adicionais: [],
      quantidadeEncontrada: 1
    },
    comercial: {
      precoAtual: campo(205, "alta", "POR 205 no Pix", {
        tipo: "pix",
        tipoCandidato: "preco_atual",
        marcadorAnterior: "por",
        possuiCifrao: false,
        nivelEvidencia: "alta"
      }),
      precoAntigo: campo(499, "media", "DE 499"),
      precoPix: campo(205, "alta", "R$ 205 no Pix"),
      precoUnitario: campo(null, "ausente", null),
      parcelamento: { quantidade: 6, valorParcela: 215.83, semJuros: false, confianca: "alta", evidencia: "R$ 215,83 ate 6x" },
      cupom: {
        codigo: "FASHION",
        codigos: ["FASHION", "MODACOMVC"],
        texto: "CUPOM: FASHION ou MODACOMVC",
        instrucao: "CUPOM: FASHION ou MODACOMVC",
        confianca: "alta",
        provavel: false
      },
      cashback: campo(null, "ausente", null),
      freteGratis: campo(false, "ausente", null),
      descontoPercentual: campo(null, "ausente", null),
      links: { produto: "https://meli.la/2GTPyMb", classificados: [{ link: "https://meli.la/2GTPyMb", tipo: "produto" }] }
    },
    comparacaoImportador: {}
  };
}

function criarMirrorComCupom(codigo, instrucao) {
  const mirror = criarMirror();
  mirror.cupom.codigoCapturado = codigo;
  mirror.cupom.codigosCapturados = [codigo];
  mirror.cupom.textoCapturado = instrucao;
  mirror.cupom.condicaoCapturada = instrucao;
  mirror.comercial.cupom.codigo = codigo;
  mirror.comercial.cupom.codigos = [codigo];
  mirror.comercial.cupom.texto = instrucao;
  mirror.comercial.cupom.instrucao = instrucao;
  return mirror;
}

function criarMirrorCupomPercentualSemCodigo() {
  const mirror = criarMirror();
  const textoOriginal = [
    "Pack com 12 unidades de 250ml",
    "DE 98 | POR 64,89 (5,41 cada)",
    "Aplique o cupom de 10% OFF no anuncio"
  ].join("\n");

  mirror.texto.original = textoOriginal;
  mirror.texto.limpo = textoOriginal;
  mirror.produto.tituloCapturado = "Pack com 12 unidades de 250ml";
  mirror.preco.atualCapturado = 64.89;
  mirror.preco.anteriorCapturado = 98;
  mirror.preco.evidenciaCapturada = "POR 64,89 (5,41 cada)";
  mirror.cupom.codigoCapturado = "OCUPOMDE10";
  mirror.cupom.codigosCapturados = ["OCUPOMDE10", "ANUNCIO", "OCUPOMDE10", "ANUNCIO"];
  mirror.cupom.textoCapturado = "cupom de 10% OFF no anuncio";
  mirror.cupom.condicaoCapturada = "Aplique o cupom de 10% OFF no anuncio";
  mirror.cupom.confianca = "media";
  mirror.comercial.precoAtual = campo(64.89, "alta", "POR 64,89", {
    tipo: "preco_atual",
    tipoCandidato: "preco_atual",
    marcadorAnterior: "por"
  });
  mirror.comercial.precoAntigo = campo(98, "alta", "DE 98");
  mirror.comercial.precoPix = campo(null, "ausente", null);
  mirror.comercial.precoUnitario = campo(5.41, "baixa", "Pack com 12 unidades de 250ml DE 98 | POR 64,89 (5,41 cada) Aplique o cupom de 10% OFF no anuncio", {
    tipo: "preco_unitario",
    tipoCandidato: "preco_unitario",
    marcadorPosterior: "unitario"
  });
  mirror.comercial.parcelamento = { quantidade: null, valorParcela: null, semJuros: false, confianca: "ausente", evidencia: null };
  mirror.comercial.cupom = {
    codigo: "OCUPOMDE10",
    codigos: ["OCUPOMDE10", "ANUNCIO", "OCUPOMDE10", "ANUNCIO"],
    texto: "cupom de 10% OFF no anuncio",
    instrucao: "Aplique o cupom de 10% OFF no anuncio",
    confianca: "media",
    evidencia: "cupom de 10% OFF no anuncio",
    provavel: false
  };
  mirror.comercial.beneficios = ["Aplique o cupom de 10% OFF no anuncio"];
  mirror.comercial.condicoesEspeciais = ["Aplique o cupom de 10% OFF no anuncio"];
  return mirror;
}

function montarOfertaEspelhoTeste(radarMirror) {
  return montarOfertaRadarEspelhoComercial({
    radarMirror,
    ofertaImportador: importadorDivergente,
    metadata: importadorDivergente.metadata,
    clienteId: "admin",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: "https://meli.la/2GTPyMb",
      linkOriginalRadar: "https://meli.la/2GTPyMb",
      linkOriginalLimpo: "https://www.mercadolivre.com.br/p/MLB123456789",
      urlResolvida: "https://www.mercadolivre.com.br/p/MLB123456789",
      tipoLinkRadar: "shortlink_meli_social"
    },
    contexto: { correlationId: "radar_teste_cupom" }
  });
}

const importadorDivergente = {
  marketplace: "mercadolivre",
  titulo: "Titulo da pagina que nao deve entrar",
  nome: "Titulo da pagina que nao deve entrar",
  preco: 999,
  precoAtual: 999,
  precoOriginal: 1200,
  cupom: "PAGINA10",
  codigoCupom: "PAGINA10",
  avisoCupom: "Cupom da pagina",
  beneficioExtra: "Beneficio da pagina",
  categoria: "Calcados",
  produtoId: "MLB123456789",
  permalink: "https://www.mercadolivre.com.br/p/MLB123456789",
  imagem: "https://cdn.example.com/produto.jpg",
  metadata: {
    produto: {
      produtoId: "MLB123456789",
      precoAtual: 999,
      cupom: "PAGINA10",
      imagemCandidatos: ["https://cdn.example.com/produto.jpg"]
    }
  }
};

{
  const mirror = criarMirror();
  assert.strictEqual(espelhoComercialRadarSuficiente(mirror), true);
  assert.strictEqual(motivoImportadorIgnoravelPeloEspelho("importacao_sem_preco", mirror), true);
}

{
  const tecnico = extrairDadosTecnicosImportador(importadorDivergente);
  assert.strictEqual(tecnico.titulo, undefined);
  assert.strictEqual(tecnico.precoAtual, undefined);
  assert.strictEqual(tecnico.cupom, undefined);
  assert.strictEqual(tecnico.produtoId, "MLB123456789");
  assert.strictEqual(tecnico.imagem, "https://cdn.example.com/produto.jpg");
  assert.deepStrictEqual(tecnico.metadata.produto.imagemCandidatos, ["https://cdn.example.com/produto.jpg"]);
  assert.strictEqual(tecnico.metadata.produto.precoAtual, undefined);
}

{
  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: criarMirror(),
    ofertaImportador: importadorDivergente,
    metadata: importadorDivergente.metadata,
    clienteId: "admin",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: "https://meli.la/2GTPyMb",
      linkOriginalRadar: "https://meli.la/2GTPyMb",
      linkOriginalLimpo: "https://www.mercadolivre.com.br/p/MLB123456789",
      urlResolvida: "https://www.mercadolivre.com.br/p/MLB123456789",
      tipoLinkRadar: "shortlink_meli_social"
    },
    contexto: { correlationId: "radar_teste_1" }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.titulo, "Tenis Puma Carina Street BDP");
  assert.strictEqual(resultado.oferta.precoAtual, 205);
  assert.strictEqual(resultado.oferta.preco, 205);
  assert.strictEqual(resultado.oferta.precoOriginal, 499);
  assert.strictEqual(resultado.oferta.cupom, "FASHION ou MODACOMVC");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["FASHION", "MODACOMVC"]);
  assert.strictEqual(resultado.oferta.instrucaoCupom, "");
  assert.strictEqual(resultado.oferta.precoPix, "R$ 205 no Pix");
  assert.strictEqual(resultado.oferta.parcelamento, "R$ 215,83 ate 6x");
  assert.strictEqual(resultado.oferta.imagem, "https://cdn.example.com/produto.jpg");
  assert.strictEqual(resultado.oferta.produtoId, "MLB123456789");
  assert.strictEqual(resultado.oferta.categoria, "Calcados");
  assert.strictEqual(resultado.oferta.linkAfiliado, "");
  assert.strictEqual(resultado.oferta.fonteComercial, "radar_espelho_comercial");
  assert.ok(resultado.oferta.documentoComercialCanonico.includes("CUPOM: FASHION ou MODACOMVC"));
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.importadorUsadoComo, "enriquecimento_tecnico");
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("MODACOMVC", "CUPOM: MODACOMVC"));
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.cupom, "MODACOMVC");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["MODACOMVC"]);
  assert.strictEqual(resultado.oferta.instrucaoCupom, "");
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.contratoComercial.instrucaoCupom, "");
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("MODACOMVC", "Aplique no carrinho."));
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.cupom, "MODACOMVC");
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique no carrinho.");
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("MODACOMVC", "Somente no App. Nao acumulativo."));
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.cupom, "MODACOMVC");
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Somente no App. Nao acumulativo.");
}

{
  for (const falso of ["AQUI", "HTTPS", "MENSAGEM", "DETECTADO", "PAGINA", "OCUPOM", "DISPONIVEL", "ANUNCIO", "TODOS", "CUPONS"]) {
    assert.strictEqual(normalizarCodigoCupomSemantico(falso), "");
  }

  for (const real of ["MODALIVRE", "AMOCUPOM", "MODAPRAVC", "OFFCASA", "SEMANANOVA", "CELULAR26", "CUPOMDANOITE", "D1AD0SP41S", "5Q0QOV4DWS"]) {
    assert.strictEqual(normalizarCodigoCupomSemantico(real), real);
  }

  assert.deepStrictEqual(normalizarCuponsSemanticos("Cupom: MODALIVRE ou AMOCUPOM"), ["MODALIVRE", "AMOCUPOM"]);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Use o cupom de 10% OFF disponivel no anuncio"), []);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Resgate todos os cupons desta pagina"), []);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Use cupom: CUPOMDANOITE ou resgate no anuncio"), ["CUPOMDANOITE"]);
}

{
  assert.strictEqual(radarCupomMensagem.normalizarCupomMensagemRadar("o cupom de 10% OFF no anuncio"), "");
  assert.deepStrictEqual(
    radarCupomMensagem.extrairCuponsMultiplosRadar("Aplique o cupom de 10% OFF no anuncio").cupons,
    []
  );

  const resultado = montarOfertaEspelhoTeste(criarMirrorCupomPercentualSemCodigo());
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.precoUnitario, "R$ 5,41 cada");
  assert.strictEqual(resultado.oferta.cupom, "");
  assert.strictEqual(resultado.oferta.codigoCupom, "");
  assert.strictEqual(resultado.oferta.cupomTexto, "");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, []);
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique o cupom de 10% OFF no anuncio");
  assert.strictEqual(resultado.oferta.avisoCupom, "");
  assert.strictEqual(resultado.oferta.beneficios.includes("Aplique o cupom de 10% OFF no anuncio"), false);
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.contratoComercial.precoUnitario, "R$ 5,41 cada");
  assert.deepStrictEqual(resultado.oferta.metadata.radarEspelhoComercial.contratoComercial.codigosCupom, []);
}

{
  const mirror = criarMirrorCupomPercentualSemCodigo();
  mirror.comercial.precoUnitario.evidencia = "sai R$ 17 cada cueca";
  const resultado = montarOfertaEspelhoTeste(mirror);
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.precoUnitario, "R$ 17 cada cueca");
}

{
  const mirror = criarMirrorComCupom("MODACOMVC", "Cupom: MODACOMVC ou MELICOM20");
  mirror.cupom.codigosCapturados = ["MODACOMVC", "MELICOM20"];
  mirror.comercial.cupom.codigos = ["MODACOMVC", "MELICOM20"];
  const resultado = montarOfertaEspelhoTeste(mirror);
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.cupom, "MODACOMVC ou MELICOM20");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["MODACOMVC", "MELICOM20"]);
}

{
  const mirror = criarMirrorComCupom("MODACOMVC", "Aplique no carrinho.");
  mirror.cupom.codigosCapturados = ["MODACOMVC", "MODACOMVC"];
  mirror.comercial.cupom.codigos = ["MODACOMVC", "MODACOMVC"];
  const resultado = montarOfertaEspelhoTeste(mirror);
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["MODACOMVC"]);
}

{
  const produtoShopee = "https://s.shopee.com.br/produto-real";
  const resgateShopee = "https://s.shopee.com.br/cupom-resgate";
  const mirror = criarMirror();
  mirror.links.encontrados = [resgateShopee, produtoShopee];
  mirror.links.resgateCupom = resgateShopee;
  mirror.links.produtoOriginal = produtoShopee;
  mirror.links.adicionais = [];
  mirror.comercial.links = {
    produto: produtoShopee,
    resgate: resgateShopee,
    classificados: [
      { link: resgateShopee, tipo: "resgate" },
      { link: produtoShopee, tipo: "produto" }
    ]
  };

  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: mirror,
    ofertaImportador: {
      marketplace: "shopee",
      produtoId: "SHOPEE123",
      linkResolvido: produtoShopee,
      permalink: produtoShopee
    },
    metadata: {},
    clienteId: "admin",
    marketplace: "shopee",
    resolucao: {
      urlCapturada: resgateShopee,
      linkOriginalRadar: resgateShopee,
      linkOriginalLimpo: resgateShopee,
      urlResolvida: resgateShopee,
      tipoLinkRadar: "resgate"
    },
    contexto: { correlationId: "radar_teste_shopee_dois_links" }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.linksProduto[0].original, produtoShopee);
  assert.strictEqual(resultado.oferta.linksProduto[0].resolvido, produtoShopee);
  assert.strictEqual(resultado.oferta.linksResgate[0].original, resgateShopee);
  assert.notStrictEqual(resultado.oferta.linksProduto[0].resolvido, resgateShopee);
}

{
  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: criarMirror(),
    ofertaImportador: {
      marketplace: "mercadolivre",
      titulo: "Produto Mercado Livre",
      nome: "Produto Mercado Livre",
      preco: 2.58,
      precoAtual: 2.58,
      precoOriginal: 3,
      cupom: "FALLBACK10",
      avisoCupom: "Cupom criado pelo fallback",
      beneficioExtra: "Frete gratis inventado",
      fallbackMercadoLivreRadarTexto: true,
      fallbackTecnicoRadarMirror: true,
      motivoFallback: "meli_social_importador_falhou_espelho_comercial",
      linkOriginal: "https://www.mercadolivre.com.br/p/MLB123456789"
    },
    metadata: {},
    clienteId: "admin",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: "https://meli.la/2GTPyMb",
      linkOriginalRadar: "https://meli.la/2GTPyMb",
      linkOriginalLimpo: "https://www.mercadolivre.com.br/p/MLB123456789",
      urlResolvida: "https://www.mercadolivre.com.br/p/MLB123456789",
      tipoLinkRadar: "shortlink_meli_social"
    },
    contexto: { correlationId: "radar_teste_fallback_ml" }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.titulo, "Tenis Puma Carina Street BDP");
  assert.strictEqual(resultado.oferta.precoAtual, 205);
  assert.strictEqual(resultado.oferta.precoOriginal, 499);
  assert.strictEqual(resultado.oferta.cupom, "FASHION ou MODACOMVC");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["FASHION", "MODACOMVC"]);
  assert.strictEqual(String(resultado.oferta.beneficioExtra || "").includes("Frete gratis inventado"), false);
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.importadorUsadoComo, "enriquecimento_tecnico");
}

{
  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: criarMirror(),
    ofertaImportador: {
      marketplace: "kabum",
      marketplaceOriginalRadar: "kabum",
      titulo: "Titulo reconstruido KaBuM",
      nome: "Titulo reconstruido KaBuM",
      preco: 111,
      precoAtual: 111,
      cupom: "KABUMFAKE",
      fallbackKabumRadar403: true,
      fallbackTecnicoRadarMirror: true,
      motivoFallback: "kabum_http_403_espelho_comercial",
      linkOriginal: "https://www.kabum.com.br/produto/123"
    },
    metadata: {},
    clienteId: "admin",
    marketplace: "kabum",
    resolucao: {
      urlCapturada: "https://www.kabum.com.br/produto/123",
      linkOriginalRadar: "https://www.kabum.com.br/produto/123",
      linkOriginalLimpo: "https://www.kabum.com.br/produto/123",
      urlResolvida: "https://www.kabum.com.br/produto/123",
      tipoLinkRadar: "produto"
    },
    contexto: { correlationId: "radar_teste_fallback_kabum" }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.titulo, "Tenis Puma Carina Street BDP");
  assert.strictEqual(resultado.oferta.precoAtual, 205);
  assert.strictEqual(resultado.oferta.precoOriginal, 499);
  assert.strictEqual(resultado.oferta.cupom, "FASHION ou MODACOMVC");
  assert.strictEqual(resultado.oferta.codigoCupom, "FASHION ou MODACOMVC");
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["FASHION", "MODACOMVC"]);
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.importadorUsadoComo, "enriquecimento_tecnico");
}

{
  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.includes("ml_titulo_fallback_texto_radar_bloqueado_espelho"));
  assert.ok(indexFonte.includes("ml_preco_fallback_texto_radar_bloqueado_espelho"));
  assert.ok(indexFonte.includes("fallbackTecnicoRadarMirror"));
  assert.ok(indexFonte.includes("meli_social_importador_falhou_espelho_comercial"));
  assert.ok(indexFonte.includes("kabum_http_403_espelho_comercial"));
}

console.log("radar-espelho-comercial.test.js OK");
