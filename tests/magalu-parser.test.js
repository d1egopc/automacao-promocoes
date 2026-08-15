"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  consultarProdutoMagalu,
  parseMagaluProdutoHtml,
  normalizarPrecoMagalu,
  produtoIdPorUrl,
  hostMagaluValido
} = require("../modules/marketplaces/magalu/magalu-parser");

function moeda(valor) {
  return String(valor || "").replace(/\s+/g, " ");
}

const urlProduto = "https://www.magazineluiza.com.br/smart-tv-teste/p/abc123/et/elit/";

const htmlCompleto = `
  <html>
    <head>
      <link rel="canonical" href="${urlProduto}">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Smart TV 50 Polegadas Magalu",
          "sku": "abc123",
          "image": ["https://a-static.mlcdn.com.br/tv.jpg"],
          "offers": {
            "@type": "Offer",
            "price": "1999.90",
            "priceCurrency": "BRL"
          }
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home" },
            { "@type": "ListItem", "position": 2, "name": "TV e Video" },
            { "@type": "ListItem", "position": 3, "name": "Smart TV" }
          ]
        }
      </script>
    </head>
    <body>
      <span>Preco anterior R$ 2.499,90</span>
      <p>em 10x de R$ 199,99 sem juros</p>
      <p>vendido e entregue por <strong>Magalu</strong></p>
      <p>Cupom MAGALU10</p>
      <p>Economia R$ 500,00</p>
    </body>
  </html>
`;

const completo = parseMagaluProdutoHtml({
  urlOriginal: urlProduto + "?utm=x",
  html: htmlCompleto
});

assert.strictEqual(completo.urlOriginal, urlProduto + "?utm=x");
assert.strictEqual(completo.urlCanonica, urlProduto);
assert.strictEqual(completo.produtoId, "abc123");
assert.strictEqual(completo.codigo, "abc123");
assert.strictEqual(completo.titulo, "Smart TV 50 Polegadas Magalu");
assert.strictEqual(completo.imagem, "https://a-static.mlcdn.com.br/tv.jpg");
assert.strictEqual(moeda(completo.precoAtual), "R$ 1.999,90");
assert.strictEqual(moeda(completo.precoAnterior), "R$ 2.499,90");
assert.strictEqual(completo.categoria, "TV e Video");
assert.strictEqual(completo.seller, "Magalu");
assert.ok(completo.parcelamento.includes("10x de R$ 199,99"), "parcelamento deve ser preservado como parcelamento");
assert.ok(completo.cupom.includes("MAGALU10"), "cupom explicito deve ser preservado como cupom");
assert.strictEqual(completo.metadata.parseOnly, true);
assert.strictEqual(completo.metadata.marketplace, "magalu");
assert.strictEqual(completo.metadata.fontes.titulo, "jsonld.name");
assert.strictEqual(completo.metadata.fontes.imagem, "jsonld.image");
assert.strictEqual(completo.metadata.fontes.precoAtual, "jsonld.offers.price");
assert.strictEqual(completo.metadata.fontes.precoAnterior, "html.preco_de");
assert.deepStrictEqual(Object.keys(completo).filter(k => /afiliad|promoter/i.test(k)), []);

const semPrecoAnterior = parseMagaluProdutoHtml({
  urlOriginal: urlProduto,
  html: `
    <meta property="og:title" content="Produto Sem Preco Anterior">
    <meta property="og:image" content="https://a-static.mlcdn.com.br/produto.jpg">
    <script type="application/ld+json">
      { "@type": "Product", "name": "Produto Sem Preco Anterior", "offers": { "price": "799.90" } }
    </script>
    <p>em 8x de R$ 99,99</p>
    <p>Economia R$ 100,00</p>
  `
});
assert.strictEqual(moeda(semPrecoAnterior.precoAtual), "R$ 799,90");
assert.strictEqual(semPrecoAnterior.precoAnterior, "", "ausencia de preco anterior real deve manter vazio");

const soParcela = parseMagaluProdutoHtml({
  urlOriginal: urlProduto,
  html: `
    <meta property="og:title" content="Produto Apenas Parcelado">
    <p>em 10x de R$ 39,99 sem juros</p>
  `
});
assert.strictEqual(soParcela.precoAtual, "", "parcela nao pode virar preco atual");
assert.strictEqual(soParcela.precoAnterior, "", "parcela nao pode virar preco anterior");
assert.ok(soParcela.parcelamento.includes("10x de R$ 39,99"));

const descontosSemPreco = parseMagaluProdutoHtml({
  urlOriginal: urlProduto,
  html: `
    <meta property="og:title" content="Produto Com Cupom">
    <p>Economia R$ 80,00</p>
    <p>Desconto R$ 50,00 no app</p>
    <p>Cupom R$ 20,00 OFF</p>
  `
});
assert.strictEqual(descontosSemPreco.precoAtual, "", "economia/desconto nominal nao pode virar preco");
assert.strictEqual(descontosSemPreco.precoAnterior, "", "cupom nao pode virar preco anterior");
assert.ok(descontosSemPreco.cupom.includes("Cupom R$ 20,00"));

const metaFallback = parseMagaluProdutoHtml({
  urlOriginal: "https://www.magazineluiza.com.br/item/p/zyx987/",
  html: `
    <link href="/item/p/zyx987/" rel="canonical">
    <meta property="og:title" content="Fone Bluetooth Magalu">
    <meta property="og:image" content="/fone.jpg">
    <meta property="product:price:amount" content="149.90">
    <script>window.__data={"oldPrice":"199.90"}</script>
    <span>Vendido e entregue por Loja Parceira</span>
  `
});
assert.strictEqual(metaFallback.urlCanonica, "https://www.magazineluiza.com.br/item/p/zyx987/");
assert.strictEqual(metaFallback.produtoId, "zyx987");
assert.strictEqual(metaFallback.titulo, "Fone Bluetooth Magalu");
assert.strictEqual(metaFallback.imagem, "https://www.magazineluiza.com.br/fone.jpg");
assert.strictEqual(moeda(metaFallback.precoAtual), "R$ 149,90");
assert.strictEqual(moeda(metaFallback.precoAnterior), "R$ 199,90");
assert.strictEqual(metaFallback.seller, "Loja Parceira");
assert.strictEqual(metaFallback.metadata.fontes.precoAtual, "meta.product_price_amount");

const parcial = parseMagaluProdutoHtml({
  urlOriginal: urlProduto,
  html: '<meta property="og:title" content="Produto Parcial Magalu">'
});
assert.strictEqual(parcial.titulo, "Produto Parcial Magalu");
assert.strictEqual(parcial.precoAtual, "");
assert.strictEqual(parcial.imagem, "");
assert.strictEqual(parcial.categoria, "");
assert.strictEqual(parcial.seller, "");

const semDados = parseMagaluProdutoHtml({
  urlOriginal: "https://www.magazineluiza.com.br/",
  html: "<title>Magazine Luiza</title><main>Home da loja</main>"
});
assert.strictEqual(semDados.titulo, "", "titulo generico nao deve fabricar produto");
assert.strictEqual(semDados.precoAtual, "");
assert.strictEqual(semDados.imagem, "");
assert.ok(semDados.avisos.includes("magalu_produto_nao_comprovado"));

assert.strictEqual(normalizarPrecoMagalu("2.345,67"), "R$\u00a02.345,67");
assert.strictEqual(produtoIdPorUrl(urlProduto), "abc123");
assert.strictEqual(hostMagaluValido(urlProduto), true);
assert.strictEqual(hostMagaluValido("https://example.com/produto/p/abc123/"), false);

(async () => {
  const chamadas = [];
  const consultado = await consultarProdutoMagalu("https://www.magazineluiza.com.br/produto/p/fetch123/", {
    fetchFn: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      return {
        ok: true,
        status: 200,
        url: "https://www.magazineluiza.com.br/produto/p/fetch123/",
        text: async () => '<meta property="og:title" content="Produto Via Fetch"><meta property="product:price:amount" content="88.80">'
      };
    },
    headers: { "user-agent": "teste" }
  });
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(consultado.titulo, "Produto Via Fetch");
  assert.strictEqual(moeda(consultado.precoAtual), "R$ 88,80");

  const invalido = await consultarProdutoMagalu("https://example.com/item");
  assert.ok(invalido.avisos.includes("magalu_url_invalida"));
  assert.strictEqual(invalido.titulo, "");

  const parserFonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "marketplaces", "magalu", "magalu-parser.js"),
    "utf8"
  );

  for (const proibido of [
    "importarMagalu",
    "/importar-magalu-manual",
    "farejarMagalu",
    "getIntegracaoCliente",
    "admin",
    "fila",
    "Engine",
    "Radar",
    "Distributor",
    "Oferta Universal",
    "Manual V2",
    "manual-v2",
    "linkAfiliado",
    "promoterId",
    "novoValorComercial"
  ]) {
    assert.ok(!parserFonte.includes(proibido), `parser Magalu parse-only nao deve referenciar ${proibido}`);
  }

  console.log("magalu-parser.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
