const assert = require("assert");

const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
const { montarOfertaUniversalEngine } = require("../modules/engine/oferta-universal.contract");
const { extrairEvidenciasRadarLocal } = require("../modules/radar/extrator-local");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");
const {
  resolverPrecedenciaComercialRadar,
  tituloComercialUniversalValido
} = require("../modules/radar/comercial-precedencia");
const { gerarTemplateUniversal } = require("../modules/template-universal");

const LINKS_VOLTOU50 = [
  "https://s.shopee.com.br/AKaNWnC4Ql",
  "https://s.shopee.com.br/3qMtmqjTgS"
];

const TEXTO_VOLTOU50 = [
  "🔥 Cupom Shopee",
  "",
  "🏷️ R$ 50,00 OFF a partir de R$ 249,00: VOLTOU50",
  "",
  "🚨 Resgate aqui:",
  LINKS_VOLTOU50[0],
  "",
  "🛒 Link do Carrinho:",
  LINKS_VOLTOU50[1]
].join("\n");

function ofertaImportadorShopee(overrides = {}) {
  return {
    marketplace: "shopee",
    titulo: "Tubo cônico para Calibragem de cart de metal e plástico",
    nome: "Tubo cônico para Calibragem de cart de metal e plástico",
    preco: 33.67,
    precoAtual: 33.67,
    linkOriginal: LINKS_VOLTOU50[1],
    linkExpandido: "https://shopee.com.br/product/344373801/58255334999",
    linkAfiliado: "https://s.shopee.com.br/W6Pu1lwe3",
    categoria: "Diversos",
    ...overrides
  };
}

function resolverTituloRadar(textoOriginal = TEXTO_VOLTOU50, oferta = ofertaImportadorShopee()) {
  const extracao = extrairEvidenciasRadarLocal({
    textoOriginal,
    links: LINKS_VOLTOU50,
    marketplace: "shopee",
    marketplaceDetectado: "shopee"
  });
  const mirror = criarRadarMirror({
    textoOriginal,
    links: LINKS_VOLTOU50,
    extracaoRadarLocal: extracao,
    marketplace: "shopee"
  });
  const resolucao = resolverPrecedenciaComercialRadar({
    ofertaImportador: oferta,
    radarMirror: mirror,
    metadata: oferta.metadata || {},
    clienteId: "user_pss60lus",
    marketplace: "shopee"
  });
  return { extracao, mirror, resolucao };
}

async function importarOfertaShopeeComTexto(textoOriginal, precoAtual = "33,67") {
  const links = LINKS_VOLTOU50.map((url, indice) => ({
    id: indice + 1,
    url_original: url,
    metadata: { papelLink: indice === 0 ? "cupom" : "produto" }
  }));
  const evento = {
    id: 3117,
    evento_id: 3117,
    texto_original: textoOriginal,
    links_extraidos: LINKS_VOLTOU50,
    marketplace_detectado: "shopee"
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await importarShopeeEngine({
      job: { id: 4439, evento_id: 3117, cliente_id: "user_pss60lus" },
      evento,
      links,
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
        importarShopee: async url => ({
          ok: true,
          marketplace: "shopee",
          titulo: "Tubo cônico para Calibragem de cart de metal e plástico",
          nome: "Tubo cônico para Calibragem de cart de metal e plástico",
          precoAtual,
          preco: precoAtual,
          imagem: "https://img.test/produto.jpg",
          linkOriginal: url,
          linkExpandido: "https://shopee.com.br/product/344373801/58255334999",
          linkAfiliado: "https://s.shopee.com.br/W6Pu1lwe3",
          shopId: "344373801",
          itemId: "58255334999"
        }),
        gerarShortLinkShopee: async () => ({ ok: true, shortLink: "https://s.shopee.com.br/3qMtmumOle" }),
        expandirShortlinkShopee: async () => "https://shopee.com.br/user/voucher-wallet?x=1"
      }
    });
  } finally {
    console.log = originalLog;
  }
}

function ofertaUniversalDoAdapter(adapter, evento = {}) {
  return montarOfertaUniversalEngine({
    oferta: adapter,
    ofertaEntrada: adapter,
    job: { id: 4439, evento_id: 3117, cliente_id: "user_pss60lus" },
    evento,
    link: {
      url_original: LINKS_VOLTOU50[1],
      url_expandida: "https://shopee.com.br/product/344373801/58255334999"
    },
    metadata: adapter.metadata || {},
    status: "importada"
  });
}

function testarLinhaPromocionalNaoViraTitulo() {
  const { extracao, mirror, resolucao } = resolverTituloRadar();
  assert.strictEqual(extracao.titulo.valor, null);
  assert.strictEqual(mirror.produto.tituloCapturado, null);
  assert.strictEqual(resolucao.resolucao.tituloRadar, null);
  assert.strictEqual(resolucao.oferta.titulo, "Tubo cônico para Calibragem de cart de metal e plástico");
}

function testarTituloPromocionalEmMirrorAntigoTambemNaoVence() {
  const oferta = ofertaImportadorShopee();
  const mirror = criarRadarMirror({
    textoOriginal: TEXTO_VOLTOU50,
    links: LINKS_VOLTOU50,
    extracaoRadarLocal: {
      titulo: {
        valor: "R$ 50,00 OFF a partir de R$ 249,00: VOLTOU50",
        confianca: "media",
        evidencia: "R$ 50,00 OFF a partir de R$ 249,00: VOLTOU50"
      }
    },
    marketplace: "shopee"
  });
  const resolucao = resolverPrecedenciaComercialRadar({
    ofertaImportador: oferta,
    radarMirror: mirror,
    metadata: {},
    clienteId: "user_pss60lus",
    marketplace: "shopee"
  });
  assert.strictEqual(resolucao.resolucao.tituloRadar, null);
  assert.strictEqual(resolucao.resolucao.tituloRadarRejeitado, "R$ 50,00 OFF a partir de R$ 249,00: VOLTOU50");
  assert.strictEqual(resolucao.oferta.titulo, oferta.titulo);
}

function testarExemplosPromocionaisRejeitadosETituloRealPreservado() {
  assert.strictEqual(tituloComercialUniversalValido("R$ 50,00 OFF a partir de R$ 249,00: VOLTOU50", { marketplace: "shopee" }), false);
  assert.strictEqual(tituloComercialUniversalValido("R$ 20 OFF acima de R$ 100", { marketplace: "shopee" }), false);
  assert.strictEqual(tituloComercialUniversalValido("Cupom R$ 15 OFF", { marketplace: "shopee" }), false);
  assert.strictEqual(tituloComercialUniversalValido("10% OFF com cupom XYZ", { marketplace: "shopee" }), false);
  assert.strictEqual(tituloComercialUniversalValido("Fonte MSI MAG A650BNL 650W 80 Plus Bronze", { marketplace: "shopee" }), true);
}

async function testarBeneficioCondicionadoAteTemplate(precoAtual) {
  const adapter = await importarOfertaShopeeComTexto(TEXTO_VOLTOU50, precoAtual);
  assert.strictEqual(adapter.ok, true);
  assert.strictEqual(adapter.titulo, "Tubo cônico para Calibragem de cart de metal e plástico");
  assert.strictEqual(adapter.beneficioExtra, "R$ 50,00 OFF a partir de R$ 249,00");
  assert.strictEqual(adapter.beneficioTexto, "R$ 50,00 OFF a partir de R$ 249,00");
  assert.strictEqual(adapter.cupom, "");
  assert.strictEqual(adapter.cupomTipo, "beneficio_texto_radar");

  const ofertaUniversal = ofertaUniversalDoAdapter(adapter, { texto_original: TEXTO_VOLTOU50 });
  assert.strictEqual(ofertaUniversal.produto.titulo, "Tubo cônico para Calibragem de cart de metal e plástico");
  assert.ok(ofertaUniversal.comercial.beneficios.includes("R$ 50,00 OFF a partir de R$ 249,00"));

  const mensagem = gerarTemplateUniversal({
    ...adapter,
    linksComerciais: [
      { tipo: "resgate", papel: "link_resgate", urlAfiliadaWorkspace: "https://s.shopee.com.br/3qMtmumOle", renderizavel: true, ordemCaptura: 1 },
      { tipo: "produto", papel: "produto", urlAfiliadaWorkspace: "https://s.shopee.com.br/W6Pu1lwe3", renderizavel: true, ordemCaptura: 2 }
    ]
  });
  assert.ok(mensagem.includes("Tubo cônico para Calibragem de cart de metal e plástico"));
  assert.ok(mensagem.includes("R$ 50,00 OFF a partir de R$ 249,00"));
  assert.ok(!mensagem.includes("🎁 R$ 50,00 OFF\n"));
}

async function testarBeneficiosSimplesContinuam() {
  const valor = await importarOfertaShopeeComTexto("Cupom Shopee\nR$ 10,00 OFF\nLink do Carrinho:\nhttps://s.shopee.com.br/3qMtmqjTgS");
  assert.strictEqual(valor.beneficioExtra, "R$ 10,00 OFF");

  const percentual = await importarOfertaShopeeComTexto("Cupom Shopee\n10% OFF\nLink do Carrinho:\nhttps://s.shopee.com.br/3qMtmqjTgS");
  assert.strictEqual(percentual.beneficioExtra, "10% OFF");
}

function testarRadarPrecoCupomContinuamSoberanos() {
  const mirror = criarRadarMirror({
    textoOriginal: [
      "Produto real",
      "Por R$ 99,90",
      "Cupom: RADAR10",
      "https://s.shopee.com.br/3qMtmqjTgS"
    ].join("\n"),
    links: [LINKS_VOLTOU50[1]],
    extracaoRadarLocal: {
      titulo: { valor: "Produto real", confianca: "alta", evidencia: "Produto real" },
      precoAtual: { valor: 99.9, confianca: "alta", evidencia: "Por R$ 99,90", tipo: "final" },
      cupom: { codigo: "RADAR10", codigos: ["RADAR10"], texto: "Cupom: RADAR10", instrucao: "Cupom: RADAR10", confianca: "alta" },
      comercial: {
        precoAtual: { valor: 99.9, confianca: "alta", evidencia: "Por R$ 99,90", tipo: "final" },
        cupom: { codigo: "RADAR10", codigos: ["RADAR10"], texto: "Cupom: RADAR10", instrucao: "Cupom: RADAR10", confianca: "alta" }
      }
    },
    marketplace: "shopee"
  });
  const resultado = resolverPrecedenciaComercialRadar({
    ofertaImportador: ofertaImportadorShopee({ preco: 150, precoAtual: 150, cupom: "API10", codigoCupom: "API10" }),
    radarMirror: mirror,
    metadata: {},
    clienteId: "user_pss60lus",
    marketplace: "shopee"
  });
  assert.strictEqual(resultado.oferta.preco, 99.9);
  assert.strictEqual(resultado.oferta.cupom, "RADAR10");
}

(async () => {
  testarLinhaPromocionalNaoViraTitulo();
  testarTituloPromocionalEmMirrorAntigoTambemNaoVence();
  testarExemplosPromocionaisRejeitadosETituloRealPreservado();
  await testarBeneficioCondicionadoAteTemplate("33,67");
  await testarBeneficioCondicionadoAteTemplate("28,95");
  await testarBeneficiosSimplesContinuam();
  testarRadarPrecoCupomContinuamSoberanos();

  console.log("shopee-rio-titulo-beneficio.test.js ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
