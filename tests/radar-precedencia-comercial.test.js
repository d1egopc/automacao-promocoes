const assert = require("assert");

const {
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog,
  deveLogarDivergenciaComercial
} = require("../modules/radar/comercial-precedencia");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");

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

const envOn = { RADAR_PRECEDENCIA_COMERCIAL_ATIVA: "true" };
const envOff = { RADAR_PRECEDENCIA_COMERCIAL_ATIVA: "false" };

function resolver(ofertaImportador, radarMirror, env = envOn) {
  return resolverPrecedenciaComercialRadar({
    ofertaImportador,
    radarMirror,
    metadata: ofertaImportador.metadata || {},
    clienteId: "user_teste",
    marketplace: ofertaImportador.marketplace || "mercadolivre",
    env
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
  assert.strictEqual(r.resolucao.origemPreco, "importador");
  assert.strictEqual(r.resolucao.precoPublicacao, 88.8);
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

function testarMediaSemMarcadorNaoAplica() {
  const m = mirrorSemPreco();
  m.preco.atualCapturado = 77.7;
  m.preco.confianca = "media";
  m.preco.condicionado = false;
  m.comercial.precoAtual = campo(77.7, "media", "77,70", { tipo: "inferido_unico" });
  const r = resolver(oferta({ preco: 90, precoAtual: 90 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "importador");
  assert.strictEqual(r.oferta.preco, 90);
}

function testarParcelaNaoViraTotal() {
  const m = mirrorSemPreco({ comercial: { cupom: {} } });
  m.comercial.precoParcelado = campo(19.99, "alta", "10x R$ 19,99", { tipo: "parcela" });
  m.comercial.parcelamento = { quantidade: 10, valorParcela: 19.99, semJuros: true, confianca: "alta" };
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "importador");
  assert.strictEqual(r.resolucao.condicoesComerciais.parcelamento.quantidade, 10);
}

function testarPercentualNaoViraPreco() {
  const m = mirrorSemPreco({ comercial: { descontoPercentual: campo(50, "alta", "50% OFF"), cupom: {} } });
  const r = resolver(oferta({ preco: 129.9, precoAtual: 129.9 }), m);
  assert.strictEqual(r.resolucao.origemPreco, "importador");
  assert.strictEqual(r.resolucao.precoPublicacao, 129.9);
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
  assert.strictEqual(r.resolucao.origemCupom, "importador");
  assert.strictEqual(r.resolucao.cupomPublicacao, "IMP10");
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
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 299.9);
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
  const r = resolverPrecedenciaComercialRadar({ ofertaImportador: oferta({ origem: "manual" }), metadata: {}, env: envOn });
  assert.strictEqual(r.aplicavel, false);
}

function testarFlagOffSimulaSemAlterarPreco() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror(), envOff);
  assert.strictEqual(r.modo, "simulacao");
  assert.strictEqual(r.resolucao.origemPreco, "radar");
  assert.strictEqual(r.oferta.preco, 199.9);
  assert.strictEqual(r.metadata.precedenciaComercial.precoPublicacao, 99.9);
}

function testarFlagOnAplicaPreco() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror(), envOn);
  assert.strictEqual(r.modo, "ativo");
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
  assert.strictEqual(r.resolucao.origemPreco, "importador");
  assert.strictEqual(r.resolucao.statusComparacaoPreco, "radar_invalido");
  assert.strictEqual(r.oferta.preco, 55.5);
}

function testarPreservacaoAteFila() {
  const r = resolver(oferta({ preco: 199.9, precoAtual: 199.9 }), mirror(), envOn);
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

const testes = [
  testarPrecoAltaCoerente,
  testarPrecoAltaDivergente,
  testarSemPrecoRadarUsaImportador,
  testarMediaComMarcador,
  testarMediaSemMarcadorNaoAplica,
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
  testarFlagOffSimulaSemAlterarPreco,
  testarFlagOnAplicaPreco,
  testarImportadorAbsurdoCorrigidoPorRadar,
  testarPrecoRadarInvalidoNaoAplica,
  testarPreservacaoAteFila,
  testarResumoLogSanitizado
];

for (const teste of testes) teste();
console.log(`radar-precedencia-comercial: ${testes.length} cenarios ok`);







