"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  tituloPublicitarioOuInstrucao,
  tituloComercialUniversalValido
} = require("../modules/radar/comercial-precedencia");
const { extrairEvidenciasRadarLocal } = require("../modules/radar/extrator-local");
const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const { classificarCategoriaUniversal } = require("../modules/inteligencia-universal/categoria.service");
const { destinoAceitaOferta } = require("../utils/destinos");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");

const TITULOS_PUBLICITARIOS = [
  "SUAS PANELAS AGRADECEM ESSE CUIDADO",
  "Benefício em Esse item para casa",
  "2 - No canto INFERIOR DIREITO vá em mais",
  "O CARA DAS OFERTAS ACHOU PRA VOCÊ"
];

for (const titulo of TITULOS_PUBLICITARIOS) {
  test(`título publicitário não vira identidade: ${titulo}`, () => {
    assert.equal(tituloPublicitarioOuInstrucao(titulo), true);
    assert.equal(tituloComercialUniversalValido(titulo, { marketplace: "magalu" }), false);
  });
}

test("extrator Radar escolhe o produto quando a primeira linha é slogan", () => {
  const resultado = extrairEvidenciasRadarLocal({
    textoOriginal: [
      "SUAS PANELAS AGRADECEM ESSE CUIDADO",
      "Kit Utensílios Cozinha com Suporte",
      "DE R$ 56,99 | POR R$ 40,60",
      "Cupom: COZINHA10"
    ].join("\n"),
    links: ["https://magazineluiza.onelink.me/589508454/c7zm9t50"],
    marketplace: "magalu",
    marketplaceDetectado: "magalu"
  });

  assert.equal(resultado.titulo.valor, "Kit Utensílios Cozinha com Suporte");
  assert.equal(resultado.precoAtual.valor, 40.6);
  assert.equal(resultado.precoAnterior.valor, 56.99);
  assert.equal(resultado.cupom.codigo, "COZINHA10");
});

test("Magalu usa título técnico quando o Radar contém instrução e preserva fatos comerciais", async () => {
  const url = "https://www.magazineluiza.com.br/produto-abc123/p/abc123/te/ga07/";
  const urlWorkspace = "https://www.magazinevoce.com.br/tenant_titles/produto-abc123/p/abc123/te/ga07/";
  const resultado = await importarProdutoMagaluEngine({
    job: { id: 9021, evento_id: 9020, cliente_id: "tenant_titles", marketplace: "magalu" },
    evento: {
      titulo: "Benefício em Esse item para casa",
      cupom: "COZINHA10",
      texto_original: [
        "Benefício em Esse item para casa",
        "DE R$ 56,99 | POR R$ 40,60",
        "Cupom: COZINHA10",
        url
      ].join("\n"),
      links_extraidos: [url]
    },
    links: [{ url_original: url, url_normalizada: url, marketplace_detectado: "magalu" }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { promoterId: "tenant_titles" } }),
      resolverFatosMagalu: async () => ({
        ok: true,
        produtoId: "abc123",
        sellerIdOriginal: "magazineluiza",
        fatos: {
          produtoId: "abc123",
          codigo: "abc123",
          titulo: "Kit Utensílios Cozinha com Suporte",
          precoAtual: "99.90",
          urlOriginal: url,
          urlCanonica: urlWorkspace,
          urlAfiliavelComprovada: urlWorkspace,
          magaluWorkspaceValidado: true,
          imagem: "https://a-static.mlcdn.com.br/800x560/abc123.jpg",
          categoria: "Casa, Móveis e Decoração",
          avisos: []
        },
        avisos: []
      })
    }
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.titulo, "Kit Utensílios Cozinha com Suporte");
  assert.equal(resultado.precoAtual, 40.6);
  assert.equal(resultado.precoOriginal, "56,99");
  assert.equal(resultado.cupom, "COZINHA10");
});

test("amostras dos cinco marketplaces mantêm categoria factual sem ampliar Diversos", () => {
  const casos = [
    ["Impressora HP Smart Tank", "mercadolivre", "Periféricos"],
    ["Máscara capilar de hidratação", "shopee", "Perfumaria, Farmácia e Beleza"],
    ["Apple EarPods", "amazon", "Audio TV"],
    ["Tanquinho Colormaq", "magalu", "Eletrodomésticos"],
    ["SSD NVMe Movespeed 4TB", "aliexpress", "Gamer e Hardware"]
  ];
  for (const [titulo, marketplace, esperado] of casos) {
    assert.equal(
      classificarCategoriaOferta({ titulo, marketplace, categoria: "Diversos" }),
      esperado,
      `${marketplace}: ${titulo}`
    );
  }
});

test("categoria usa o produto principal e ignora brinde de vestuário", () => {
  const casos = [
    "Óleo Náutico Tcw3 2t Yamalube Kit 4l Grátis Boné Yamaha",
    "Óleo Náutico 2T Yamalube 1L + brinde: Boné Yamaha",
    "Lubrificante náutico para motor 2T (brinde boné)"
  ];
  for (const titulo of casos) {
    assert.equal(
      classificarCategoriaOferta({ titulo, marketplace: "mercadolivre", categoria: "Diversos" }, titulo),
      "Diversos",
      titulo
    );
  }
  assert.equal(
    classificarCategoriaOferta({ titulo: "Boné Yamaha Aba Curva", marketplace: "mercadolivre", categoria: "Diversos" }),
    "Roupas e Moda Masculina"
  );
});

test("categorias Yamalube e placa de captura não herdam fallback contaminado", () => {
  const casos = [
    {
      titulo: "Óleo Náutico Tcw3 2t Yamalube Kit 4l Grátis Boné Yamaha",
      marketplace: "mercadolivre",
      categoriaAnterior: "Roupas e Moda Masculina",
      categoriaEsperada: "Diversos",
      categoriaDestino: "Diversos"
    },
    {
      titulo: "Placa de captura de vídeo 4K HDTVI para USB 3.0, dispositivo de captura HDMI 1080P a 60 FPS",
      marketplace: "amazon",
      categoriaAnterior: "Perfumaria, Farmácia e Beleza",
      categoriaEsperada: "Periféricos",
      categoriaDestino: "Periféricos"
    }
  ];

  for (const caso of casos) {
    const oferta = {
      titulo: caso.titulo,
      marketplace: caso.marketplace,
      categoria: caso.categoriaAnterior,
      precoAtual: 99.9,
      cupom: "FIXTURE",
      linkAfiliado: "https://example.test/oferta"
    };
    const categoriaClassificada = classificarCategoriaOferta(oferta, caso.titulo);
    const universal = classificarCategoriaUniversal(oferta, { termo: caso.titulo });
    const persistida = { ...oferta, categoria: categoriaClassificada };
    const destino = {
      ativo: true,
      marketplaces: [caso.marketplace],
      categorias: [caso.categoriaDestino],
      origemOfertas: "ambos"
    };

    assert.equal(categoriaClassificada, caso.categoriaEsperada, `${caso.marketplace}: classificação`);
    assert.equal(universal.categoria, caso.categoriaEsperada, `${caso.marketplace}: categoria exibida/universal`);
    assert.equal(persistida.categoria, caso.categoriaEsperada, `${caso.marketplace}: categoria persistida`);
    assert.equal(destinoAceitaOferta(destino, persistida), true, `${caso.marketplace}: categoria usada no roteamento`);
    assert.equal(oferta.precoAtual, 99.9, `${caso.marketplace}: preço comercial preservado`);
    assert.equal(oferta.cupom, "FIXTURE", `${caso.marketplace}: cupom preservado`);
    assert.equal(oferta.linkAfiliado, "https://example.test/oferta", `${caso.marketplace}: link preservado`);
  }
});

console.log("diversos-titulos-focal.test.cjs OK");
