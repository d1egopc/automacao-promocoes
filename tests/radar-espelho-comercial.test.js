const assert = require("assert");
const fs = require("fs");
const path = require("path");
const radarCupomMensagem = require("../utils/radar-cupom-mensagem");
const {
  normalizarCodigoCupomSemantico,
  normalizarCuponsSemanticos
} = require("../modules/radar/cupom-semantico");
const {
  prepararDadosOficiaisTemplate
} = require("../modules/templates-clientes/dados-oficiais");

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
  const linhaCupom = instrucao || (codigo ? `Cupom: ${codigo}` : "");
  mirror.texto.original = [
    "MODELO PERFEITINHO MENINAS",
    "Tenis Puma Carina Street BDP",
    "DE 499 | POR 205 no Pix ou 215,83 ate 6x",
    linhaCupom,
    "https://meli.la/2GTPyMb"
  ].filter(Boolean).join("\n");
  mirror.texto.limpo = mirror.texto.original;
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
    "Aplique o cupom de 10% OFF no anuncio",
    "https://meli.la/pack12"
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
  mirror.links.encontrados = ["https://meli.la/pack12"];
  mirror.links.produtoOriginal = "https://meli.la/pack12";
  mirror.comercial.links = { produto: "https://meli.la/pack12", classificados: [{ link: "https://meli.la/pack12", tipo: "produto" }] };
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

function criarMirrorComTextoComercial(textoOriginal, ajustes = {}) {
  const mirror = JSON.parse(JSON.stringify(criarMirror()));
  mirror.texto.original = textoOriginal;
  mirror.texto.limpo = textoOriginal;
  mirror.produto.tituloCapturado = ajustes.tituloCapturado ?? "Titulo potencialmente errado";
  mirror.preco.atualCapturado = ajustes.precoAtual ?? 29;
  mirror.preco.anteriorCapturado = ajustes.precoAnterior ?? 600;
  mirror.preco.evidenciaCapturada = ajustes.evidenciaPreco ?? "Por R$ 29";
  mirror.cupom.codigoCapturado = ajustes.cupom ?? "ERRADO10";
  mirror.cupom.codigosCapturados = ajustes.codigosCupom ?? [mirror.cupom.codigoCapturado].filter(Boolean);
  mirror.comercial.cupom.codigo = mirror.cupom.codigoCapturado;
  mirror.comercial.cupom.codigos = [...mirror.cupom.codigosCapturados];
  mirror.comercial.cupom.instrucao = ajustes.instrucaoCupom ?? "";
  mirror.links.encontrados = ajustes.links || Array.from(textoOriginal.matchAll(/https?:\/\/[^\s]+/g)).map(match => match[0]);
  mirror.links.produtoOriginal = ajustes.produtoOriginal || mirror.links.encontrados[0] || "";
  mirror.links.quantidadeEncontrada = mirror.links.encontrados.length;
  mirror.comercial.links = {
    produto: mirror.links.produtoOriginal,
    classificados: mirror.links.encontrados.map(link => ({ link, tipo: "produto" }))
  };
  return mirror;
}

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
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique um dos cupons FASHION ou MODACOMVC para obter o desconto.");
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
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique o cupom MODACOMVC para obter o desconto.");
  assert.strictEqual(resultado.oferta.metadata.radarEspelhoComercial.contratoComercial.instrucaoCupom, "Aplique o cupom MODACOMVC para obter o desconto.");
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
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("MODACOMVC", "Cupom detectado na mensagem: MODACOMVC"));
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.cupom, "MODACOMVC");
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique o cupom MODACOMVC para obter o desconto.");
  assert.strictEqual(resultado.oferta.instrucaoCupom.includes("detectado"), false);
}

{
  for (const falso of ["AQUI", "PARA", "OBTER", "HTTPS", "HTTP", "MENSAGEM", "DETECTADO", "PAGINA", "OCUPOM", "DISPONIVEL", "ANUNCIO", "TODOS", "CUPONS", "SSHOPEECOMBR", "AMAZONCOMBR", "MELILA", "COMBR", "SHOPEE"]) {
    assert.strictEqual(normalizarCodigoCupomSemantico(falso), "");
  }

  for (const real of ["MODALIVRE", "AMOCUPOM", "MODAPRAVC", "OFFCASA", "SEMANANOVA", "CELULAR26", "CUPOMDANOITE", "D1AD0SP41S", "5Q0QOV4DWS"]) {
    assert.strictEqual(normalizarCodigoCupomSemantico(real), real);
  }

  assert.deepStrictEqual(normalizarCuponsSemanticos("Cupom: MODALIVRE ou AMOCUPOM"), ["MODALIVRE", "AMOCUPOM"]);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Use o cupom de 10% OFF disponivel no anuncio"), []);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Resgate todos os cupons desta pagina"), []);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Resgate todos os cupons desta página:"), []);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Use cupom: CUPOMDANOITE ou resgate no anuncio"), ["CUPOMDANOITE"]);
  assert.deepStrictEqual(normalizarCuponsSemanticos("Aplique o cupom MLSAUDE para obter o desconto."), ["MLSAUDE"]);
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
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("MLSAUDE", ""));
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["MLSAUDE"]);
  assert.strictEqual(resultado.oferta.cupom, "MLSAUDE");
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique o cupom MLSAUDE para obter o desconto.");
  assert.strictEqual(resultado.oferta.codigosCupom.includes("PARA"), false);
  assert.strictEqual(resultado.oferta.codigosCupom.includes("OBTER"), false);
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("15ACESS", ""));
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["15ACESS"]);
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Aplique o cupom 15ACESS para obter o desconto.");
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
  const mirror = criarMirrorComCupom("MLSAUDE", "Aplique o cupom MLSAUDE para obter o desconto.");
  mirror.comercial.cupom.codigos = ["MLSAUDE"];
  mirror.comercial.cupom.instrucao = "Aplique o cupom MLSAUDE para obter o desconto.";
  const resultado = montarOfertaEspelhoTeste(mirror);
  const reaplicado = montarOfertaRadarEspelhoComercial({
    radarMirror: {
      ...mirror,
      comercial: {
        ...mirror.comercial,
        cupom: {
          ...mirror.comercial.cupom,
          codigos: resultado.oferta.codigosCupom,
          instrucao: resultado.oferta.instrucaoCupom
        }
      }
    },
    ofertaImportador: {
      marketplace: "mercadolivre",
      produtoId: "MLB123456789"
    },
    metadata: {},
    clienteId: "admin",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: "https://meli.la/2GTPyMb",
      linkOriginalRadar: "https://meli.la/2GTPyMb"
    },
    contexto: { correlationId: "radar_teste_reprocessamento_proibido" }
  });
  assert.deepStrictEqual(reaplicado.oferta.codigosCupom, ["MLSAUDE"]);
}

{
  const produtoShopee = "https://s.shopee.com.br/produto-real";
  const resgateShopee = "https://s.shopee.com.br/cupom-resgate";
  const mirror = criarMirror();
  mirror.texto.original = [
    "Tenis Puma Carina Street BDP",
    "DE 499 | POR 205 no Pix ou 215,83 ate 6x",
    "Resgate os cupons aqui:",
    resgateShopee,
    "Produto:",
    produtoShopee
  ].join("\n");
  mirror.texto.limpo = mirror.texto.original;
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
  const produtoShopee = "https://s.shopee.com.br/3LPZvNiItu";
  const resgateShopee = "https://s.shopee.com.br/5q0qoV4Dws";
  const mirror = criarMirrorComCupom("", "Resgate os cupons aqui:");
  mirror.texto.original = [
    "Tenis Puma Carina Street BDP",
    "DE 499 | POR 205 no Pix",
    "Resgate os cupons aqui:",
    resgateShopee,
    "",
    "Produto:",
    produtoShopee
  ].join("\n");
  mirror.texto.limpo = mirror.texto.original;
  mirror.cupom.codigoCapturado = null;
  mirror.cupom.codigosCapturados = [];
  mirror.comercial.cupom.codigo = null;
  mirror.comercial.cupom.codigos = [];
  mirror.comercial.cupom.instrucao = "Resgate os cupons aqui:";
  mirror.links.encontrados = [resgateShopee, produtoShopee];
  mirror.links.resgateCupom = resgateShopee;
  mirror.links.produtoOriginal = produtoShopee;
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
    ofertaImportador: { marketplace: "shopee", linkResolvido: produtoShopee },
    metadata: {},
    clienteId: "admin",
    marketplace: "shopee",
    resolucao: {
      urlCapturada: resgateShopee,
      linkOriginalRadar: resgateShopee,
      linkOriginalLimpo: resgateShopee
    },
    contexto: { correlationId: "radar_teste_shopee_resgate_sem_codigo" }
  });

  assert.deepStrictEqual(resultado.oferta.codigosCupom, []);
  assert.strictEqual(resultado.oferta.instrucaoCupom, "Resgate os cupons aqui:");
  assert.strictEqual(JSON.stringify(resultado.oferta).includes("SSHOPEECOMBR"), false);
  assert.strictEqual(JSON.stringify(resultado.oferta).includes("HTTPS"), false);
  assert.strictEqual(JSON.stringify(resultado.oferta).includes("Cupom detectado na mensagem"), false);
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("5Q0QOV4DWS", "Cupom: 5Q0QOV4DWS"));
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["5Q0QOV4DWS"]);
  assert.strictEqual(resultado.oferta.cupom.includes("SSHOPEECOMBR"), false);
}

{
  const resultado = montarOfertaEspelhoTeste(criarMirrorComCupom("D1AD0SP41S", "Cupom detectado na mensagem: D1AD0SP41S"));
  const dados = prepararDadosOficiaisTemplate(resultado.oferta, { modo: "universal" });
  const serializadoOfertaRenderizavel = JSON.stringify({
    descricao: resultado.oferta.descricao,
    textoComercialCanonico: resultado.oferta.textoComercialCanonico,
    textoComercialOriginal: resultado.oferta.textoComercialOriginal,
    instrucaoCupom: resultado.oferta.instrucaoCupom,
    avisoCupom: resultado.oferta.avisoCupom,
    beneficioExtra: resultado.oferta.beneficioExtra,
    beneficios: resultado.oferta.beneficios,
    condicoes: resultado.oferta.condicoes
  });
  const serializadoDados = JSON.stringify(dados);
  assert.strictEqual(serializadoOfertaRenderizavel.includes("Cupom detectado na mensagem"), false);
  assert.strictEqual(serializadoDados.includes("Cupom detectado na mensagem"), false);
  assert.strictEqual(serializadoOfertaRenderizavel.includes("Código detectado"), false);
  assert.strictEqual(serializadoDados.includes("Código detectado"), false);
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

{
  const textoOriginal = [
    "OFERTA DO MERCADO",
    "Produto A Coerente",
    "De R$ 100,00",
    "Por R$ 50,00",
    "Cupom: A10REAL",
    "https://meli.la/produtoA",
    "",
    "Produto B Incoerente",
    "De R$ 600,00",
    "Por R$ 29,00",
    "Cupom: B10REAL",
    "https://meli.la/produtoB"
  ].join("\n");
  const resultado = montarOfertaEspelhoTeste(criarMirrorComTextoComercial(textoOriginal, {
    tituloCapturado: "Tirei hoje no supermercado",
    precoAtual: 29,
    precoAnterior: 600,
    cupom: "B10REAL"
  }));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "radar_contrato_comercial_ambiguo");
  assert.strictEqual(resultado.motivoTecnico, "multiplos_blocos_comerciais");
}

{
  const textoOriginal = [
    "Produto Um Oficial",
    "Por R$ 89,90",
    "https://meli.la/um",
    "Produto Dois Oficial",
    "Por R$ 129,90",
    "https://meli.la/dois"
  ].join("\n");
  const resultado = montarOfertaEspelhoTeste(criarMirrorComTextoComercial(textoOriginal, {
    tituloCapturado: "Produto Dois Oficial",
    precoAtual: 129.9,
    cupom: ""
  }));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "radar_contrato_comercial_ambiguo");
  assert.strictEqual(resultado.motivoTecnico, "multiplos_blocos_comerciais");
}

{
  const textoOriginal = [
    "CHAMADA 1",
    "Produto Chamada Um",
    "De R$ 75,00",
    "Por R$ 31,00",
    "https://meli.la/chamada1",
    "",
    "CHAMADA 2",
    "Produto Chamada Dois",
    "De R$ 200,00",
    "Por R$ 80,00",
    "https://meli.la/chamada2"
  ].join("\n");
  const resultado = montarOfertaEspelhoTeste(criarMirrorComTextoComercial(textoOriginal, {
    tituloCapturado: "CHAMADA 2",
    precoAtual: 80,
    precoAnterior: 200
  }));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "radar_contrato_comercial_ambiguo");
  assert.strictEqual(resultado.motivoTecnico, "multiplos_blocos_comerciais");
}

{
  const textoOriginal = [
    "Produto Sem Preco",
    "Cupom: SEMPRECO",
    "https://meli.la/sem-preco"
  ].join("\n");
  const resultado = montarOfertaEspelhoTeste(criarMirrorComTextoComercial(textoOriginal, {
    tituloCapturado: "Produto Sem Preco",
    precoAtual: null,
    precoAnterior: null,
    cupom: "SEMPRECO"
  }));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "radar_contrato_comercial_ambiguo");
  assert.strictEqual(resultado.motivoTecnico, "titulo_sem_preco");
}

{
  const textoOriginal = [
    "Tirei hoje no supermercado",
    "De R$ 600,00",
    "Por R$ 29,00",
    "https://meli.la/preco-sem-produto"
  ].join("\n");
  const resultado = montarOfertaEspelhoTeste(criarMirrorComTextoComercial(textoOriginal, {
    tituloCapturado: "Tirei hoje no supermercado",
    precoAtual: 29,
    precoAnterior: 600,
    cupom: ""
  }));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "radar_contrato_comercial_ambiguo");
  assert.strictEqual(resultado.motivoTecnico, "preco_sem_produto");
}

{
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const matchFuncao = indexSource.match(/function extrairCuponsRadarOferta\(oferta = \{\}\) \{([\s\S]*?)\n\}/);
  assert.ok(matchFuncao, "extrairCuponsRadarOferta deve existir no index.js");
  const corpo = matchFuncao[1];
  assert.ok(corpo.includes("normalizarCuponsSemanticos(entradas)"), "index deve delegar cupons ao Cupom Semantico");
  assert.strictEqual(/\.match\(/.test(corpo), false, "index nao pode tokenizar cupom com regex propria");
  assert.strictEqual(/new Set\(/.test(corpo), false, "index nao pode manter blacklist propria de cupom");
  assert.strictEqual(/replace\(/.test(corpo), false, "index nao pode normalizar cupom manualmente");
}

console.log("radar-espelho-comercial.test.js OK");
