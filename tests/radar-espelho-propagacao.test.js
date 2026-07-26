const assert = require("assert");

const {
  aplicarAfiliadoLinkComercialRadar,
  montarOfertaRadarEspelhoComercial
} = require("../modules/radar/espelho-comercial");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const { gerarTemplateUniversal } = require("../modules/template-universal");
const { formatarOfertaUniversal } = require("../templates/oferta-template");

function campo(valor, confianca = "alta", evidencia = "", extras = {}) {
  return { valor, confianca, evidencia, ...extras };
}

function assertContem(texto, trecho, mensagem) {
  assert.ok(String(texto || "").replace(/\u00a0/g, " ").includes(trecho), mensagem || `esperado conter ${trecho}`);
}

function assertNaoContem(texto, trecho, mensagem) {
  assert.ok(!String(texto || "").replace(/\u00a0/g, " ").includes(trecho), mensagem || `nao esperado conter ${trecho}`);
}

function montarMirrorNewBalance() {
  const textoOriginal = [
    "Tenis New Balance 480 Low",
    "DE 549,90 | POR 165,59 no Pix ou 220,79 ate 5x",
    "Aplique o Cupom de 20% OFF no Anuncio.",
    "https://meli.la/1SSfCwQ",
    "Oferta Relampago.",
    "Valor referente ao tamanho: 40, 41 e 42"
  ].join("\n");

  return {
    origem: { clienteId: "admin", tipo: "whatsapp" },
    texto: { original: textoOriginal, limpo: textoOriginal },
    produto: { tituloCapturado: "Tenis New Balance 480 Low" },
    preco: {
      atualCapturado: 165.59,
      anteriorCapturado: 549.9,
      confianca: "alta",
      tipoCapturado: "pix",
      evidenciaCapturada: "POR 165,59 no Pix",
      condicaoTexto: "no Pix"
    },
    cupom: {
      codigoCapturado: null,
      codigosCapturados: [],
      textoCapturado: "Aplique o Cupom de 20% OFF no Anuncio.",
      condicaoCapturada: "Aplique o Cupom de 20% OFF no Anuncio.",
      confianca: "media"
    },
    links: {
      encontrados: ["https://meli.la/1SSfCwQ"],
      produtoOriginal: "https://meli.la/1SSfCwQ",
      adicionais: [],
      quantidadeEncontrada: 1,
      classificados: [{ link: "https://meli.la/1SSfCwQ", tipo: "produto" }]
    },
    comercial: {
      precoAtual: campo(165.59, "alta", "POR 165,59 no Pix", { tipo: "pix" }),
      precoAntigo: campo(549.9, "alta", "DE 549,90"),
      precoPix: campo(165.59, "alta", "R$ 165,59 no Pix"),
      parcelamento: { quantidade: 5, valorParcela: 220.79, semJuros: false, confianca: "alta", evidencia: "R$ 220,79 ate 5x" },
      precoUnitario: campo(null, "ausente", null),
      cupom: {
        codigo: null,
        codigos: [],
        texto: "Aplique o Cupom de 20% OFF no Anuncio.",
        instrucao: "Aplique o Cupom de 20% OFF no Anuncio.",
        confianca: "media",
        provavel: true
      },
      ofertaRelampago: campo(true, "alta", "Oferta Relampago"),
      condicoesEspeciais: ["Valor referente ao tamanho: 40, 41 e 42"],
      tamanhos: ["40", "41", "42"],
      links: { produto: "https://meli.la/1SSfCwQ", classificados: [{ link: "https://meli.la/1SSfCwQ", tipo: "produto" }] }
    },
    comparacaoImportador: {}
  };
}

function montarMirrorDoisLinks() {
  const mirror = montarMirrorNewBalance();
  mirror.links.encontrados = [
    "https://mercadolivre.com.br/produto/MLB999",
    "https://mercadolivre.com.br/cupons/resgate"
  ];
  mirror.links.produtoOriginal = "https://mercadolivre.com.br/produto/MLB999";
  mirror.links.resgateCupom = "https://mercadolivre.com.br/cupons/resgate";
  mirror.links.classificados = [
    { link: "https://mercadolivre.com.br/produto/MLB999", tipo: "produto" },
    { link: "https://mercadolivre.com.br/cupons/resgate", tipo: "resgate" }
  ];
  mirror.comercial.links = {
    produto: "https://mercadolivre.com.br/produto/MLB999",
    resgate: "https://mercadolivre.com.br/cupons/resgate",
    classificados: mirror.links.classificados
  };
  return mirror;
}

function montarOfertaFila(mirror, extras = {}) {
  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: mirror,
    ofertaImportador: {
      marketplace: "mercadolivre",
      titulo: "Titulo do importador nao deve vencer",
      preco: 999,
      precoAtual: 999,
      precoOriginal: 1000,
      cupom: "IMPORTADOR10",
      beneficioExtra: "Beneficio do importador",
      categoria: "Calcados",
      produtoId: "MLB999",
      imagem: "https://cdn.example.com/produto.jpg",
      metadata: { produto: { produtoId: "MLB999" } }
    },
    metadata: {},
    clienteId: "user_teste",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: mirror.links.produtoOriginal,
      linkOriginalRadar: mirror.links.produtoOriginal,
      linkOriginalLimpo: "https://mercadolivre.com.br/produto/MLB999",
      urlResolvida: "https://mercadolivre.com.br/produto/MLB999"
    },
    contexto: { correlationId: "radar_propagacao" }
  });
  let oferta = {
    ...resultado.oferta,
    clienteId: "user_teste",
    linkAfiliado: "https://meli.la/afiliado-produto",
    linkFinal: "https://meli.la/afiliado-produto",
    link: "https://meli.la/afiliado-produto",
    ...extras
  };
  oferta = aplicarAfiliadoLinkComercialRadar(oferta, {
    original: mirror.links.produtoOriginal,
    resolvido: "https://mercadolivre.com.br/produto/MLB999",
    afiliado: "https://meli.la/afiliado-produto"
  });
  oferta = aplicarAfiliadoLinkComercialRadar(oferta, {
    original: "https://mercadolivre.com.br/cupons/resgate",
    resolvido: "https://mercadolivre.com.br/cupons/resgate",
    afiliado: "https://meli.la/afiliado-resgate"
  });

  return montarItemFilaEngine({
    ...oferta,
    id: 10,
    uuid: "radar-u10",
    cliente_id: "user_teste",
    link_original: oferta.linkOriginal,
    link_afiliado: oferta.linkAfiliado,
    preco_original: oferta.precoOriginal
  });
}

{
  const item = montarOfertaFila(montarMirrorNewBalance());
  assert.strictEqual(item.titulo, "Tenis New Balance 480 Low");
  assert.strictEqual(item.precoOriginal, 549.9);
  assert.strictEqual(item.precoAtual, 165.59);
  assert.strictEqual(item.precoPix, "R$ 165,59 no Pix");
  assert.strictEqual(item.parcelamento, "R$ 220,79 ate 5x");
  assert.strictEqual(item.instrucaoCupom, "Aplique o Cupom de 20% OFF no Anuncio.");
  assert.deepStrictEqual(item.codigosCupom, []);
  assert.strictEqual(item.ofertaRelampago, true);
  assert.deepStrictEqual(item.tamanhos, ["40", "41", "42"]);
  assertContem(item.textoComercialCanonico, "Aplique o Cupom de 20% OFF no Anuncio.");

  const dados = prepararDadosOficiaisTemplate(item, { modo: "universal" });
  assert.strictEqual(dados.precoAtual, 165.59);
  assert.strictEqual(dados.precoOriginal, 549.9);
  assert.strictEqual(dados.precoPix, "R$ 165,59 no Pix");
  assert.strictEqual(dados.parcelamento, "R$ 220,79 ate 5x");
  assert.strictEqual(dados.instrucaoCupom, "Aplique o Cupom de 20% OFF no Anuncio.");

  const mensagem = gerarTemplateUniversal(dados);
  assertContem(mensagem, "Tenis New Balance 480 Low");
  assertContem(mensagem, "R$ 549,90");
  assertContem(mensagem, "R$ 165,59");
  assertContem(mensagem, "no Pix");
  assertContem(mensagem, "R$ 220,79 ate 5x");
  assertContem(mensagem, "Aplique o Cupom de 20% OFF no Anuncio.");
  assertContem(mensagem, "Oferta Relampago");
  assertContem(mensagem, "40, 41 e 42");
  assertNaoContem(mensagem, "ANUNCIO");
  assertNaoContem(mensagem, "OCUPOMDE20");
}

{
  const item = montarOfertaFila(montarMirrorDoisLinks());
  assert.strictEqual(item.linksComerciais.length, 2);
  assert.strictEqual(item.linksComerciais[0].afiliado, "https://meli.la/afiliado-produto");
  assert.strictEqual(item.linksComerciais[1].afiliado, "https://meli.la/afiliado-resgate");
  const mensagem = gerarTemplateUniversal(prepararDadosOficiaisTemplate(item, { modo: "universal" }));
  assertContem(mensagem, "https://meli.la/afiliado-produto");
  assertContem(mensagem, "https://meli.la/afiliado-resgate");
}

{
  const mensagem = formatarOfertaUniversal({
    titulo: "Kit com preco unitario",
    marketplace: "mercadolivre",
    precoAtual: 31,
    preco: 31,
    precoOriginal: 75,
    precoUnitario: "R$ 2,58 cada",
    linkAfiliado: "https://meli.la/unitario"
  });
  assertContem(mensagem, "R$ 31,00");
  assertContem(mensagem, "R$ 2,58 cada");
  assertNaoContem(mensagem, "Por: R$ 2,58");
}

{
  const mirror = montarMirrorNewBalance();
  mirror.cupom.codigoCapturado = "FASHION";
  mirror.cupom.codigosCapturados = ["FASHION", "MODACOMVC"];
  mirror.cupom.confianca = "alta";
  mirror.comercial.cupom.codigo = "FASHION";
  mirror.comercial.cupom.codigos = ["FASHION", "MODACOMVC"];
  mirror.comercial.cupom.provavel = false;
  const item = montarOfertaFila(mirror);
  assert.deepStrictEqual(item.codigosCupom, ["FASHION", "MODACOMVC"]);
  const mensagem = gerarTemplateUniversal(prepararDadosOficiaisTemplate(item, { modo: "universal" }));
  assertContem(mensagem, "FASHION ou MODACOMVC");
}

console.log("radar-espelho-propagacao.test.js OK");
