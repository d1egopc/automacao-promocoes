const assert = require("assert");

const {
  resolverPrecedenciaComercialRadar
} = require("../modules/radar/comercial-precedencia");

function campo(valor, confianca = "alta", evidencia = "", extras = {}) {
  return { valor, confianca, evidencia, ...extras };
}

function mirrorBase(overrides = {}) {
  return {
    versao: 1,
    origem: { clienteId: "user_teste", tipo: "whatsapp" },
    texto: {
      original: [
        "Produto Radar Oficial",
        "De R$ 59,90",
        "Por R$ 49,90",
        "Use o cupom RADAR10",
        "https://produto.exemplo/p/123",
        "https://cupom.exemplo/resgate"
      ].join("\n")
    },
    produto: {
      tituloCapturado: "Produto Radar Oficial"
    },
    preco: {
      atualCapturado: 49.9,
      anteriorCapturado: 59.9,
      confianca: "alta",
      tipoCapturado: "final",
      evidenciaCapturada: "Por R$ 49,90",
      marcadorComercial: "por"
    },
    cupom: {
      codigoCapturado: "RADAR10",
      textoCapturado: "Use o cupom RADAR10",
      condicaoCapturada: "Use o cupom RADAR10",
      confianca: "alta"
    },
    links: {
      encontrados: ["https://produto.exemplo/p/123", "https://cupom.exemplo/resgate"],
      produtoOriginal: "https://produto.exemplo/p/123",
      resgateCupom: "https://cupom.exemplo/resgate",
      adicionais: [],
      quantidadeEncontrada: 2
    },
    comercial: {
      precoAtual: campo(49.9, "alta", "Por R$ 49,90", {
        tipo: "final",
        tipoCandidato: "preco_atual",
        marcadorAnterior: "por",
        possuiCifrao: true,
        nivelEvidencia: "alta",
        motivos: ["preco_radar_marcador_explicito"]
      }),
      precoAntigo: campo(59.9, "media", "De R$ 59,90"),
      precoPix: campo(47.9, "alta", "No Pix R$ 47,90"),
      precoBoleto: campo(null, "ausente", null),
      precoCartao: campo(null, "ausente", null),
      parcelamento: { quantidade: 3, valorParcela: 16.63, semJuros: true, confianca: "media" },
      cupom: { codigo: "RADAR10", texto: "Use o cupom RADAR10", instrucao: "Use o cupom RADAR10", confianca: "alta", provavel: false },
      cashback: campo("5%", "media", "Cashback 5%"),
      freteGratis: campo(true, "media", "Frete gratis"),
      descontoPercentual: campo(16, "media", "16% OFF"),
      moedasShopee: campo(null, "ausente", null),
      brindes: [],
      condicoesEspeciais: ["valido ate meia-noite"],
      links: {
        produto: "https://produto.exemplo/p/123",
        resgate: "https://cupom.exemplo/resgate",
        classificados: [
          { link: "https://produto.exemplo/p/123", tipo: "produto" },
          { link: "https://cupom.exemplo/resgate", tipo: "resgate" }
        ]
      }
    },
    comparacaoImportador: {},
    ...overrides
  };
}

function ofertaImportador(overrides = {}) {
  return {
    marketplace: "mercadolivre",
    titulo: "Titulo vindo da pagina",
    nome: "Titulo vindo da pagina",
    preco: 69.9,
    preco_atual: 69.9,
    precoAtual: 69.9,
    preco_original: 99.9,
    precoOriginal: 99.9,
    cupom: "PAGINA10",
    codigoCupom: "PAGINA10",
    codigo_cupom: "PAGINA10",
    avisoCupom: "Cupom encontrado na pagina",
    beneficioExtra: "Beneficio vindo da pagina",
    linkOriginal: "https://produto.exemplo/p/123",
    linkAfiliado: "https://go.optimus/r/abc123",
    imagem: "https://cdn.exemplo/produto.jpg",
    produtoId: "123",
    metadata: { produto: { sku: "123" } },
    ...overrides
  };
}

function resolver(mirror, oferta = ofertaImportador()) {
  return resolverPrecedenciaComercialRadar({
    ofertaImportador: oferta,
    radarMirror: mirror,
    metadata: oferta.metadata || {},
    clienteId: "user_teste",
    marketplace: oferta.marketplace
  });
}

function testarRadarMirrorAssumeCamposComerciais() {
  const r = resolver(mirrorBase());
  assert.strictEqual(r.modo, "radar_mirror_fiel");
  assert.strictEqual(r.metadata.fonteComercial, "radar_mirror");
  assert.strictEqual(r.oferta.fonteComercial, "radar_mirror");
  assert.strictEqual(r.oferta.titulo, "Produto Radar Oficial");
  assert.strictEqual(r.oferta.preco, 49.9);
  assert.strictEqual(r.oferta.precoAtual, 49.9);
  assert.strictEqual(r.oferta.preco_atual, 49.9);
  assert.strictEqual(r.oferta.precoOriginal, 59.9);
  assert.strictEqual(r.oferta.preco_original, 59.9);
  assert.strictEqual(r.oferta.cupom, "RADAR10");
  assert.strictEqual(r.oferta.codigoCupom, "RADAR10");
  assert.strictEqual(r.oferta.codigo_cupom, "RADAR10");
  assert.strictEqual(r.oferta.avisoCupom, "Use o cupom RADAR10");
  assert.strictEqual(r.oferta.linkResgateCupom, "https://cupom.exemplo/resgate");
  assert.strictEqual(r.oferta.linkAfiliado, "https://go.optimus/r/abc123");
  assert.strictEqual(r.oferta.imagem, "https://cdn.exemplo/produto.jpg");
}

function testarCupomDaPaginaNaoPublica() {
  const mirror = mirrorBase();
  mirror.cupom = { codigoCapturado: null, textoCapturado: null, condicaoCapturada: null, confianca: "ausente" };
  mirror.comercial.cupom = { codigo: null, texto: null, instrucao: null, confianca: "ausente", provavel: false };
  const r = resolver(mirror);
  assert.strictEqual(r.resolucao.origemCupom, "ausente");
  assert.strictEqual(r.oferta.cupom, undefined);
  assert.strictEqual(r.oferta.codigoCupom, undefined);
  assert.strictEqual(r.oferta.codigo_cupom, undefined);
  assert.strictEqual(r.oferta.avisoCupom, undefined);
}

function testarPrecoPaginaNaoSubstituiRadar() {
  const r = resolver(mirrorBase(), ofertaImportador({ preco: 999, precoAtual: 999, precoOriginal: 1200 }));
  assert.strictEqual(r.resolucao.precoImportador, 999);
  assert.strictEqual(r.resolucao.precoRadar, 49.9);
  assert.strictEqual(r.oferta.preco, 49.9);
  assert.strictEqual(r.oferta.precoOriginal, 59.9);
}

function testarPrecoPixFicaCondicaoSeparada() {
  const mirror = mirrorBase();
  mirror.preco.atualCapturado = null;
  mirror.preco.anteriorCapturado = null;
  mirror.preco.confianca = "ausente";
  mirror.comercial.precoAtual = campo(null, "ausente", null);
  mirror.comercial.precoAntigo = campo(null, "ausente", null);
  mirror.comercial.precoPix = campo(47.9, "alta", "No Pix R$ 47,90");
  const r = resolver(mirror);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.oferta.preco, undefined);
  assert.strictEqual(r.oferta.precoPix, "No Pix R$ 47,90");
  assert.strictEqual(r.resolucao.condicoesComerciais.pix.valor, 47.9);
}

function testarPrecoDeSoMaiorQuePor() {
  const mirror = mirrorBase();
  mirror.preco.anteriorCapturado = 39.9;
  mirror.comercial.precoAntigo = campo(39.9, "media", "De R$ 39,90");
  const r = resolver(mirror);
  assert.strictEqual(r.oferta.preco, 49.9);
  assert.strictEqual(r.oferta.precoOriginal, undefined);
  assert.strictEqual(r.oferta.precoAnterior, undefined);
}

const testes = [
  testarRadarMirrorAssumeCamposComerciais,
  testarCupomDaPaginaNaoPublica,
  testarPrecoPaginaNaoSubstituiRadar,
  testarPrecoPixFicaCondicaoSeparada,
  testarPrecoDeSoMaiorQuePor
];

for (const teste of testes) teste();
console.log(`radar-espelho-fiel: ${testes.length} cenarios ok`);
