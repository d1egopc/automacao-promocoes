const assert = require("assert");

const {
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog,
  deveLogarDivergenciaComercial,
  deveLogarPrecoSuspeito,
  emitirLogRadarPrecoSuspeito
} = require("../modules/radar/comercial-precedencia");
const { avaliarOfertaUniversal } = require("../modules/inteligencia-universal");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { normalizarNumeroMoeda } = require("../utils/moeda");

function campo(valor, confianca = "alta", evidencia = "Por R$ 99,90", extras = {}) {
  return { valor, confianca, evidencia, ...extras };
}

function mirror(overrides = {}) {
  return {
    versao: 1,
    origem: { clienteId: "user_teste", tipo: "whatsapp" },
    preco: {
      atualCapturado: 99.9,
      anteriorCapturado: 149.9,
      confianca: "alta",
      condicionado: false,
      condicaoTexto: null,
      tipoCapturado: "final",
      evidenciaCapturada: "Por R$ 99,90",
      marcadorComercial: "final"
    },
    cupom: {
      codigoCapturado: "PROMO10",
      textoCapturado: "Cupom PROMO10",
      condicaoCapturada: "Use PROMO10",
      confianca: "alta"
    },
    links: {
      encontrados: ["https://www.mercadolivre.com.br/p/MLB123", "https://cupom.exemplo/resgate"],
      produtoOriginal: "https://www.mercadolivre.com.br/p/MLB123",
      resgateCupom: "https://cupom.exemplo/resgate",
      adicionais: [],
      quantidadeEncontrada: 2
    },
    comercial: {
      precoAtual: campo(99.9, "alta", "Por R$ 99,90", { tipo: "final" }),
      precoAntigo: campo(149.9, "media", "De R$ 149,90"),
      precoPix: campo(null, "ausente", null),
      precoBoleto: campo(null, "ausente", null),
      precoCartao: campo(null, "ausente", null),
      precoParcelado: campo(null, "ausente", null),
      parcelamento: { quantidade: null, valorParcela: null, semJuros: false, confianca: "ausente" },
      descontoPercentual: campo(null, "ausente", null),
      cupom: { codigo: "PROMO10", texto: "Cupom PROMO10", instrucao: "Use PROMO10", confianca: "alta", provavel: false },
      cashback: campo(null, "ausente", null),
      freteGratis: campo(true, "media", "Frete gratis"),
      moedasShopee: campo(null, "ausente", null),
      brindes: [],
      condicoesEspeciais: ["pix"],
      links: {
        produto: "https://www.mercadolivre.com.br/p/MLB123",
        resgate: "https://cupom.exemplo/resgate",
        classificados: [
          { link: "https://www.mercadolivre.com.br/p/MLB123", tipo: "produto" },
          { link: "https://cupom.exemplo/resgate", tipo: "resgate" }
        ]
      },
      marketplace: campo("mercadolivre", "alta", "mercadolivre"),
      categoria: campo("Casa", "media", "air fryer")
    },
    comparacaoImportador: {}
  };
}

function mirrorSemPreco(overrides = {}) {
  const base = mirror(overrides);
  base.preco = {
    ...(base.preco || {}),
    atualCapturado: null,
    anteriorCapturado: null,
    confianca: "ausente",
    tipoCapturado: null,
    evidenciaCapturada: null,
    marcadorComercial: null,
    condicionado: false,
    condicaoTexto: null
  };
  base.comercial = {
    ...(base.comercial || {}),
    precoAtual: campo(null, "ausente", null),
    precoAntigo: campo(null, "ausente", null),
    precoPix: campo(null, "ausente", null),
    precoBoleto: campo(null, "ausente", null),
    precoCartao: campo(null, "ausente", null)
  };
  return base;
}
function oferta(overrides = {}) {
  return {
    id: 10,
    uuid: "oferta_10",
    cliente_id: "user_teste",
    marketplace: "mercadolivre",
    titulo: "Produto Teste",
    preco: 99.9,
    precoAtual: 99.9,
    preco_original: 149.9,
    precoOriginal: 149.9,
    cupom: "IMP10",
    link_original: "https://www.mercadolivre.com.br/p/MLB123",
    linkOriginal: "https://www.mercadolivre.com.br/p/MLB123",
    link_afiliado: "https://go.optimus/r/abc123",
    linkAfiliado: "https://go.optimus/r/abc123",
    categoria: "Casa",
    score: 80,
    metadata: {},
    ...overrides
  };
}

function resolver(ofertaImportador, radarMirror) {
  return resolverPrecedenciaComercialRadar({
    ofertaImportador,
    radarMirror,
    metadata: ofertaImportador.metadata || {},
    clienteId: "user_teste",
    marketplace: ofertaImportador.marketplace || "mercadolivre"
  });
}

function testarPrecoAltaCoerente() {
  const r = resolver(oferta({ preco: 99.9, precoAtual: 99.9 }), mirror());
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "coerente");
  assert.strictEqual(r.oferta.preco, 99.9);
}

function testarPrecoAltaDivergente() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror());
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "divergente");
  assert.ok(r.resolucao.divergenciaPercentual > 40);
  assert.strictEqual(deveLogarDivergenciaComercial(r), true);
}

function testarSemPrecoRadarUsaImportador() {
  const m = mirrorSemPreco({ comercial: { cupom: {} } });
  const r = resolver(oferta({ preco: 88.8, precoAtual: 88.8 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.resolucao.precoPublicacao, null);
  assert.strictEqual(r.oferta.preco, 88.8);
}

function testarMediaComMarcador() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = 77.7;
  m.preco.confianca = "media";
  m.preco.condicionado = true;
  m.preco.condicaoTexto = "No Pix";
  m.preco.marcadorComercial = "pix";
  m.comercial.precoAtual = campo(77.7, "media", "No Pix R$ 77,70", { tipo: "pix" });
  const r = resolver(oferta({ preco: 90, precoAtual: 90 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 77.7);
}

function testarMediaSemMarcadorAplicaCloneRadar() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = 77.7;
  m.preco.confianca = "media";
  m.preco.condicionado = false;
  m.comercial.precoAtual = campo(77.7, "media", "77,70", { tipo: "inferido_unico" });
  const r = resolver(oferta({ preco: 90, precoAtual: 90 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.resolucao.motivoPreco, "radar_media_preco_explicito");
  assert.strictEqual(r.oferta.preco, 77.7);
}

function testarParcelaNaoViraTotal() {
  const m = mirrorSemPreco({ comercial: { cupom: {} } });
  m.comercial.precoParcelado = campo(19.99, "alta", "10x R$ 19,99", { tipo: "parcela" });
  m.comercial.parcelamento = { quantidade: 10, valorParcela: 19.99, semJuros: true, confianca: "alta" };
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.resolucao.condicoesComerciais.parcelamento.quantidade, 10);
  assert.strictEqual(r.oferta.preco, 199.9);
}

function testarPercentualNaoViraPreco() {
  const m = mirrorSemPreco({ comercial: { descontoPercentual: campo(50, "alta", "50% OFF"), cupom: {} } });
  const r = resolver(oferta({ preco: 129.9, precoAtual: 129.9 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.resolucao.precoPublicacao, null);
}

function testarCupomRadarClaro() {
  const r = resolver(oferta({ cupom: "IMP10" }), mirror());
  assert.strictEqual(r.resolucao.origemCupom, "radar");
  assert.strictEqual(r.oferta.cupom, "PROMO10");
}

function testarCupomImportadorFallback() {
  const m = mirror();
  m.cupom.codigoCapturado = null;
  m.cupom.confianca = "ausente";
  m.comercial.cupom = { codigo: null, provavel: false, confianca: "ausente" };
  const r = resolver(oferta({ cupom: "IMP10" }), m);
  assert.strictEqual(r.resolucao.origemCupom, "ausente");
  assert.strictEqual(r.resolucao.cupomPublicacao, null);
  assert.strictEqual(r.oferta.cupom, "IMP10");
}

function testarCupomProvavelNaoAplica() {
  const m = mirror();
  m.cupom.codigoCapturado = null;
  m.cupom.textoCapturado = "tem cupom";
  m.cupom.confianca = "media";
  m.comercial.cupom = { codigo: null, texto: "tem cupom", provavel: true, confianca: "media" };
  const r = resolver(oferta({ cupom: "" }), m);
  assert.strictEqual(r.resolucao.origemCupom, "ausente");
  assert.strictEqual(r.resolucao.cupomProvavel, true);
}

function testarLinksProdutoEResgate() {
  const m = mirror();
  m.links = { encontrados: ["https://s.shopee.com.br/a", "https://s.click.aliexpress.com/resgate"], produtoOriginal: "https://s.shopee.com.br/a", resgateCupom: "https://s.click.aliexpress.com/resgate", adicionais: [], quantidadeEncontrada: 2 };
  m.comercial.links = { produto: "https://s.shopee.com.br/a", resgate: "https://s.click.aliexpress.com/resgate", classificados: [{ link: "https://s.shopee.com.br/a", tipo: "produto" }, { link: "https://s.click.aliexpress.com/resgate", tipo: "resgate" }] };
  const r = resolver(oferta({ marketplace: "shopee" }), m);
  assert.strictEqual(r.resolucao.linkProdutoOriginal, "https://s.shopee.com.br/a");
  assert.strictEqual(r.resolucao.linkResgateCupom, "https://s.click.aliexpress.com/resgate");
}

function testarAmazonPix() {
  const m = mirrorSemPreco(); m.comercial.precoPix = campo(299.9, "alta", "No Pix R$ 299,90");
  const r = resolver(oferta({ marketplace: "amazon", preco: 329.9, precoAtual: 329.9 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.oferta.preco, 329.9);
  assert.strictEqual(r.resolucao.condicoesComerciais.pix.valor, 299.9);
}

function testarMercadoLivreCupom() {
  const r = resolver(oferta({ marketplace: "Mercado Livre", cupom: "" }), mirror());
  assert.strictEqual(r.resolucao.cupomPublicacao, "PROMO10");
  assert.strictEqual(r.resolucao.condicoesComerciais.freteGratis.valor, true);
}

function testarKabumAwin() {
  const m = mirror();
  m.links = { encontrados: ["https://www.kabum.com.br/produto/1/x", "https://awin1.com/cread.php?a=1"], produtoOriginal: "https://www.kabum.com.br/produto/1/x", resgateCupom: null, adicionais: ["https://awin1.com/cread.php?a=1"], quantidadeEncontrada: 2 };
  m.comercial.marketplace = campo("kabum", "alta", "kabum");
  m.comercial.links = { produto: "https://www.kabum.com.br/produto/1/x", classificados: [{ link: "https://www.kabum.com.br/produto/1/x", tipo: "produto" }, { link: "https://awin1.com/cread.php?a=1", tipo: "affiliate" }] };
  const r = resolver(oferta({ marketplace: "awin" }), m);
  assert.strictEqual(r.resolucao.linkProdutoOriginal, "https://www.kabum.com.br/produto/1/x");
  assert.strictEqual(r.resolucao.linksClassificados.totalEncontrados, 2);
}

function testarManualSemMetadataNaoAplica() {
  const r = resolverPrecedenciaComercialRadar({ ofertaImportador: oferta({ origem: "manual" }), metadata: {} });
  assert.strictEqual(r.aplicavel, false);
}

function testarRadarMirrorFielPadrao() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror());
  assert.strictEqual(r.modo, "radar_mirror_fiel");
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 99.9);
  assert.strictEqual(r.metadata.precedenciaComercial.precoPublicacao, 99.9);
}

function testarRadarMirrorAplicaPreco() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror());
  assert.strictEqual(r.modo, "radar_mirror_fiel");
  assert.strictEqual(r.oferta.preco, 99.9);
}

function testarImportadorAbsurdoCorrigidoPorRadar() {
  const m = mirror();
  m.preco.atualCapturado = 119.9;
  m.preco.confianca = "alta";
  m.preco.tipoCapturado = "final";
  m.preco.evidenciaCapturada = "Por R$ 119,90";
  m.comercial.precoAtual = campo(119.9, "alta", "Por R$ 119,90", { tipo: "final" });
  const r = resolver(oferta({ preco: 0.25, precoAtual: 0.25 }), m);
  assert.strictEqual(r.oferta.preco, 119.9);
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "divergente");
}

function testarPrecoRadarInvalidoNaoAplica() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = 0;
  m.preco.confianca = "alta";
  m.preco.tipoCapturado = "final";
  m.comercial.precoAtual = campo(0, "alta", "Por R$ 0,00", { tipo: "final" });
  const r = resolver(oferta({ preco: 55.5, precoAtual: 55.5 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "radar_invalido");
  assert.strictEqual(r.oferta.preco, 55.5);
}

function testarAmazonCloneComercialUniversal() {
  const m = removerCupomRadar(aplicarPrecoRadar(mirror(), 2249, "alta", "Por R$ 2.249"));
  m.origem = { clienteId: "workspace_amazon", tipo: "telegram" };
  m.preco.anteriorCapturado = null;
  m.cupom = {
    codigoCapturado: "TUDOAMAZON",
    textoCapturado: "Cupom TUDOAMAZON",
    condicaoCapturada: "Use o cupom TUDOAMAZON",
    confianca: "alta"
  };
  m.comercial.cupom = {
    codigo: "TUDOAMAZON",
    texto: "Cupom TUDOAMAZON",
    instrucao: "Use o cupom TUDOAMAZON",
    confianca: "alta",
    provavel: false
  };
  m.comercial.parcelamento = {
    quantidade: 10,
    valorParcela: 224.9,
    semJuros: true,
    confianca: "alta",
    evidencia: "10x de R$ 224,90 sem juros"
  };

  const r = resolver(oferta({
    marketplace: "amazon",
    preco: 2680,
    precoAtual: 2680,
    cupom: "",
    parcelamento: "12x de R$ 223,33",
    metadata: { produto: { preco: 2680, parcelamento: "12x de R$ 223,33" } }
  }), m);

  assert.strictEqual(r.oferta.preco, 2249);
  assert.strictEqual(r.oferta.precoAtual, 2249);
  assert.strictEqual(r.oferta.cupom, "TUDOAMAZON");
  assert.strictEqual(r.oferta.parcelamento, "10x de R$ 224,90 sem juros");
  assert.strictEqual(r.metadata.precoReferenciaApi, 2680);
  assert.strictEqual(r.metadata.parcelamentoReferenciaApi, "12x de R$ 223,33");
  assert.strictEqual(r.metadata.precedenciaComercial.politicaAutoridade, "radar_comercial_explicito_maior_que_api");
  assert.strictEqual(r.metadata.precedenciaComercial.camposProtegidos.preco, true);
  assert.strictEqual(r.metadata.precedenciaComercial.camposProtegidos.parcelamento, true);
  assert.strictEqual(r.metadata.precedenciaComercial.camposProtegidos.cupom, true);
}

function testarMagnitudeMonetariaBrasileiraNaoDeslocaCasas() {
  const casos = [
    ["17,50", 17.5],
    ["17,5", 17.5],
    ["17", 17],
    ["1750", 1750],
    ["1.750", 1750],
    ["1.750,50", 1750.5],
    ["140", 140],
    ["140,90", 140.9],
    ["R$49", 49],
    ["R$ 49", 49],
    ["R$140", 140],
    ["R$1.399,90", 1399.9],
    ["R$ 1.210,00", 1210]
  ];

  for (const [entrada, esperado] of casos) {
    assert.strictEqual(normalizarNumeroMoeda(entrada), esperado, `magnitude ${entrada}`);
  }
}

function testarCasosReaisMediaSemMarcadorPreservamValorRadar() {
  const casos = [
    ["R$ 153", 153],
    ["R$ 46,55", 46.55],
    ["R$ 140", 140],
    ["R$ 1.210,00", 1210]
  ];

  for (const [token, esperado] of casos) {
    const m = mirrorSemPreco();
    m.preco.atualCapturado = token;
    m.preco.confianca = "media";
    m.preco.evidenciaCapturada = token;
    m.preco.marcadorComercial = null;
    m.comercial.precoAtual = campo(token, "media", token, {
      tipo: "preco_atual",
      tipoCandidato: "preco_atual",
      possuiCifrao: true,
      nivelEvidencia: "media",
      motivos: ["valor_monetario_com_cifrao"]
    });
    const r = resolver(oferta({ preco: 0.45, precoAtual: 0.45 }), m);
    assert.strictEqual(r.resolucao.origemPreco, "radar", token);
    assert.strictEqual(r.oferta.preco, esperado, token);
    assert.strictEqual(r.metadata.precedenciaComercial.precoPublicacao, esperado, token);
    assert.strictEqual(r.metadata.precoReferenciaApi, 0.45, token);
  }
}

function testarPrecoCupomPixParcelamentoPreservadosDoRadar() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = "R$ 140";
  m.preco.confianca = "media";
  m.preco.evidenciaCapturada = "R$ 140 PIX";
  m.preco.marcadorComercial = null;
  m.comercial.precoAtual = campo("R$ 140", "media", "R$ 140 PIX", {
    tipo: "preco_atual",
    tipoCandidato: "preco_atual",
    possuiCifrao: true,
    nivelEvidencia: "media"
  });
  m.comercial.precoPix = campo(140, "alta", "R$ 140 PIX");
  m.comercial.parcelamento = { quantidade: 10, valorParcela: 14, semJuros: true, confianca: "alta", evidencia: "10x de R$ 14 sem juros" };
  m.cupom = { codigoCapturado: "PIX140", textoCapturado: "Cupom PIX140", condicaoCapturada: "Use PIX140", confianca: "alta" };
  m.comercial.cupom = { codigo: "PIX140", texto: "Cupom PIX140", instrucao: "Use PIX140", confianca: "alta", provavel: false };

  const r = resolver(oferta({ preco: 1.4, precoAtual: 1.4, cupom: "", parcelamento: "12x" }), m);
  assert.strictEqual(r.oferta.preco, 140);
  assert.strictEqual(r.oferta.precoPix, "R$ 140 PIX");
  assert.strictEqual(r.oferta.parcelamento, "10x de R$ 14 sem juros");
  assert.strictEqual(r.oferta.cupom, "PIX140");
  assert.strictEqual(r.metadata.precoReferenciaApi, 1.4);
  assert.strictEqual(r.metadata.parcelamentoReferenciaApi, "12x");
}

function testarAusenciaRealDePrecoNaoInventaValor() {
  const r = resolver(oferta({ preco: "", precoAtual: "", valor: "" }), mirrorSemPreco({ comercial: { cupom: {} } }));
  assert.strictEqual(r.resolucao.origemPreco, "ausente");
  assert.strictEqual(r.resolucao.precoPublicacao, null);
  assert.strictEqual(r.oferta.preco, "");
}

function testarInteligenciaUniversalComPrecoCanonicoNaoMantemPrecoInvalido() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = "R$ 153";
  m.preco.confianca = "media";
  m.preco.evidenciaCapturada = "R$ 153";
  m.comercial.precoAtual = campo("R$ 153", "media", "R$ 153", {
    tipo: "preco_atual",
    tipoCandidato: "preco_atual",
    possuiCifrao: true,
    nivelEvidencia: "media"
  });
  const r = resolver(oferta({ preco: "", precoAtual: "", linkAfiliado: "https://go.optimus/r/abc123" }), m);
  const resultado = avaliarOfertaUniversal({
    clienteId: "user_teste",
    titulo: r.oferta.titulo,
    marketplace: r.oferta.marketplace,
    precoAtual: r.oferta.preco,
    preco: r.oferta.preco,
    cupom: r.oferta.cupom,
    linkAfiliado: r.oferta.linkAfiliado,
    origem: "engine_importer"
  }, {
    clienteId: "user_teste",
    origem: "engine_importer",
    exigirLinkAfiliado: true,
    memoriaAnteriores: [],
    memoriaDisponivel: true
  });
  const validacao = (resultado.logs || []).find(log => log.etapa === "validacao");
  assert.strictEqual(validacao.status, "ok");
  assert.deepStrictEqual(validacao.erros, []);
  assert.notStrictEqual(resultado.valorEfetivoOrigem, "preco_invalido");
}

function testarPreservacaoAteFila() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror());
  const item = montarItemFilaEngine({
    id: 10,
    uuid: "u10",
    cliente_id: "user_teste",
    marketplace: "mercadolivre",
    titulo: "Produto Teste",
    preco: r.oferta.preco,
    preco_original: r.oferta.precoOriginal,
    cupom: r.oferta.cupom,
    link_original: r.oferta.linkOriginal,
    link_afiliado: r.oferta.linkAfiliado,
    categoria: "Casa",
    score: 80,
    metadata: r.metadata
  });
  assert.strictEqual(item.preco, 99.9);
  assert.strictEqual(item.metadata.precedenciaComercial.origemPreco, "radar");
  assert.strictEqual(item.metadata.precedenciaComercial.linkResgateCupom, "https://cupom.exemplo/resgate");
}

function testarResumoLogSanitizado() {
  const r = resolver(oferta(), mirror());
  const log = resumirPrecedenciaComercialLog(r);
  assert.strictEqual(log.linkProdutoHost, "mercadolivre.com.br");
  assert.strictEqual(log.linkResgateHost, "cupom.exemplo");
  assert.strictEqual(Object.values(log).some(valor => String(valor).includes("/p/MLB123")), false);
}

function removerCupomRadar(m = {}) {
  m.cupom = {
    codigoCapturado: null,
    textoCapturado: null,
    condicaoCapturada: null,
    confianca: "ausente"
  };
  m.comercial = {
    ...(m.comercial || {}),
    cupom: { codigo: null, texto: null, instrucao: null, confianca: "ausente", provavel: false }
  };
  return m;
}

function aplicarPrecoRadar(m = {}, valor = 99.9, confianca = "alta", evidencia = `Por R$ ${String(valor).replace(".", ",")}`) {
  m.preco.atualCapturado = valor;
  m.preco.confianca = confianca;
  m.preco.tipoCapturado = "final";
  m.preco.evidenciaCapturada = evidencia;
  m.preco.marcadorComercial = evidencia;
  m.comercial.precoAtual = campo(valor, confianca, evidencia, {
    tipo: "final",
    tipoCandidato: "preco_atual",
    marcadorAnterior: "por",
    possuiCifrao: true,
    nivelEvidencia: "alta",
    motivos: ["preco_radar_marcador_explicito", "evidencia_forte_preco"]
  });
  return m;
}

function testarDivergenciaExtremaImportadorGeraAlerta() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = 50;
  m.preco.confianca = "media";
  m.preco.condicionado = false;
  m.preco.marcadorComercial = null;
  m.comercial.precoAtual = campo(50, "media", "50", { tipo: "inferido_unico", tipoCandidato: "desconhecido", nivelEvidencia: "media" });
  const r = resolver(oferta({ marketplace: "amazon", preco: 419.06, precoAtual: 419.06 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 50);
  assert.ok(r.resolucao.divergenciaPercentual >= 80);
  assert.strictEqual(deveLogarPrecoSuspeito(r), true);
}

function testarDivergenciaExtremaRadarGeraAlerta() {
  const m = mirror();
  const r = resolver(oferta({ preco: 10, precoAtual: 10 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.ok(r.resolucao.divergenciaPercentual >= 80);
  assert.strictEqual(deveLogarPrecoSuspeito(r), true);
}

function testarRadarExtremoSemCupomNaoGanhaPrecedencia() {
  const m = removerCupomRadar(aplicarPrecoRadar(mirror(), 4.69, "alta", "Por R$ 4,69"));
  const r = resolver(oferta({ preco: 207, precoAtual: 207, cupom: "" }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "divergente");
  assert.strictEqual(r.oferta.preco, 4.69);
  assert.strictEqual(deveLogarPrecoSuspeito(r), true);
}

function testarRadarExtremoComCupomConfirmadoFicaAuditavel() {
  const m = aplicarPrecoRadar(mirror(), 4.69, "alta", "Por R$ 4,69");
  m.comercial.resolucaoPreco = {
    quantidadeCandidatosPreco: 3,
    tipoCandidatoEscolhido: "preco_atual",
    marcadorPrecoEscolhido: "por",
    possuiCifraoPrecoEscolhido: true,
    motivosConfiancaPreco: ["preco_radar_marcador_explicito"],
    candidatosRejeitadosPorTipo: { quantidade: 1, frete: 1 }
  };
  const r = resolver(oferta({ preco: 207, precoAtual: 207, cupom: "" }), m);
  const log = resumirPrecedenciaComercialLog(r);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 4.69);
  assert.strictEqual(deveLogarPrecoSuspeito(r), true);
  assert.strictEqual(log.quantidadeCandidatosPreco, 3);
  assert.strictEqual(log.tipoCandidatoEscolhido, "preco_atual");
  assert.strictEqual(log.marcadorPrecoEscolhido, "por");
  assert.strictEqual(log.possuiCifraoPrecoEscolhido, true);
  assert.deepStrictEqual(log.motivosConfiancaPreco, ["preco_radar_marcador_explicito", "evidencia_forte_preco"]);
  assert.deepStrictEqual(log.candidatosRejeitadosPorTipo, { quantidade: 1, frete: 1 });
}

function testarDivergenciaAbaixoLimiteMantemComportamentoAtual() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror());
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.ok(r.resolucao.divergenciaPercentual < 80);
  assert.strictEqual(deveLogarPrecoSuspeito(r), false);
}

function testarPrecoCoerenteNaoGeraAlerta() {
  const r = resolver(oferta({ preco: 99.9, precoAtual: 99.9 }), mirror());
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "coerente");
  assert.strictEqual(deveLogarPrecoSuspeito(r), false);
}

function testarPrecoBaixoRealCoerenteContinuaPermitido() {
  const m = aplicarPrecoRadar(mirror(), 4.69, "alta", "Por R$ 4,69");
  const r = resolver(oferta({ preco: 4.69, precoAtual: 4.69 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "coerente");
  assert.strictEqual(r.oferta.preco, 4.69);
  assert.strictEqual(deveLogarPrecoSuspeito(r), false);
}
function capturarLogsPrecoSuspeito(fn) {
  const original = console.log;
  const eventos = [];
  console.log = (...args) => {
    eventos.push(args);
  };
  try {
    const retorno = fn();
    return { eventos, retorno };
  } finally {
    console.log = original;
  }
}

function eventosPrecoSuspeito(eventos = []) {
  return eventos.filter(args => args[0] === "[RADAR-PRECO-SUSPEITO]");
}

function resultadoComDivergencia(divergenciaPercentual, origemPreco = "importador", overrides = {}) {
  return {
    resolucao: {
      versao: "radar_precedencia_comercial_v1",
      modo: overrides.modo || "radar_mirror_fiel",
      clienteId: "user_teste",
      marketplace: "amazon",
      origemPreco,
      precoRadar: 100,
      precoImportador: 100,
      precoPublicacao: origemPreco === "radar" ? 100 : 200,
      confiancaPrecoRadar: "alta",
      divergenciaPercentual,
      statusComparacaoPreco: overrides.statusComparacaoPreco || "divergente",
      origemCupom: overrides.origemCupom || "ausente",
      cupomRadar: overrides.cupomRadar || null,
      cupomImportador: null,
      linksClassificados: {},
      quantidadeCandidatosPreco: 2,
      tipoCandidatoEscolhido: "preco_atual",
      marcadorPrecoEscolhido: "por",
      possuiCifraoPrecoEscolhido: true,
      motivosConfiancaPreco: ["preco_radar_marcador_explicito"],
      candidatosRejeitadosPorTipo: { quantidade: 1 }
    }
  };
}

function testarLoggingNaoEmiteAbaixoDe80() {
  const { eventos, retorno } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(79.99), "teste"));
  assert.strictEqual(retorno, false);
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 0);
}

function testarLoggingEmiteEm80() {
  const { eventos, retorno } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(80), "teste"));
  assert.strictEqual(retorno, true);
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 1);
}

function testarLoggingEmiteEm193() {
  const { eventos } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(193.53), "teste"));
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 1);
}

function testarLoggingEmiteEm29100() {
  const { eventos } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(29100), "teste"));
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 1);
}

function testarLoggingOrigemRadarComCupomEmite() {
  const { eventos } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(121.64, "radar", { origemCupom: "radar", cupomRadar: "PROMO10" }), "teste"));
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 1);
}

function testarLoggingOrigemImportadorEmite() {
  const { eventos } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(114.19, "importador"), "teste"));
  assert.strictEqual(eventosPrecoSuspeito(eventos).length, 1);
}

function testarLoggingModoFielEmite() {
  const { eventos } = capturarLogsPrecoSuspeito(() => emitirLogRadarPrecoSuspeito(resultadoComDivergencia(84.44, "importador", { modo: "radar_mirror_fiel" }), "teste"));
  const suspeitos = eventosPrecoSuspeito(eventos);
  assert.strictEqual(suspeitos.length, 1);
  const payload = JSON.parse(suspeitos[0][1]);
  assert.strictEqual(payload.modo, "radar_mirror_fiel");
  assert.strictEqual(payload.etapa, "teste");
  assert.strictEqual(payload.quantidadeCandidatosPreco, 2);
  assert.strictEqual(payload.tipoCandidatoEscolhido, "preco_atual");
}
const testes = [
  testarPrecoAltaCoerente,
  testarPrecoAltaDivergente,
  testarSemPrecoRadarUsaImportador,
  testarMediaComMarcador,
  testarMediaSemMarcadorAplicaCloneRadar,
  testarParcelaNaoViraTotal,
  testarPercentualNaoViraPreco,
  testarCupomRadarClaro,
  testarCupomImportadorFallback,
  testarCupomProvavelNaoAplica,
  testarLinksProdutoEResgate,
  testarAmazonPix,
  testarMercadoLivreCupom,
  testarKabumAwin,
  testarManualSemMetadataNaoAplica,
  testarRadarMirrorFielPadrao,
  testarRadarMirrorAplicaPreco,
  testarImportadorAbsurdoCorrigidoPorRadar,
  testarPrecoRadarInvalidoNaoAplica,
  testarAmazonCloneComercialUniversal,
  testarMagnitudeMonetariaBrasileiraNaoDeslocaCasas,
  testarCasosReaisMediaSemMarcadorPreservamValorRadar,
  testarPrecoCupomPixParcelamentoPreservadosDoRadar,
  testarAusenciaRealDePrecoNaoInventaValor,
  testarInteligenciaUniversalComPrecoCanonicoNaoMantemPrecoInvalido,
  testarPreservacaoAteFila,
  testarResumoLogSanitizado,
  testarDivergenciaExtremaImportadorGeraAlerta,
  testarDivergenciaExtremaRadarGeraAlerta,
  testarRadarExtremoSemCupomNaoGanhaPrecedencia,
  testarRadarExtremoComCupomConfirmadoFicaAuditavel,
  testarDivergenciaAbaixoLimiteMantemComportamentoAtual,
  testarPrecoCoerenteNaoGeraAlerta,
  testarPrecoBaixoRealCoerenteContinuaPermitido,
  testarLoggingNaoEmiteAbaixoDe80,
  testarLoggingEmiteEm80,
  testarLoggingEmiteEm193,
  testarLoggingEmiteEm29100,
  testarLoggingOrigemRadarComCupomEmite,
  testarLoggingOrigemImportadorEmite,
  testarLoggingModoFielEmite
];

for (const teste of testes) teste();
console.log(`radar-precedencia-comercial: ${testes.length} cenarios ok`);







