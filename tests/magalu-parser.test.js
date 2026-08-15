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

const urlRealA07 = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a07/p/240466500/te/ga07/";
const urlA17Divergente = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a17/p/240575800/te/ga17/";
const urlNightCaviar = "https://www.magazinevoce.com.br/d1egopc/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
const urlDivulgadorOferta = "https://www.magazineluiza.com.br/smart-tv-50-tcl-4k-uhd-qled-50p7k-google-tv-aipq-google-assistente-3-hdmi/divulgador/oferta/240144700/et/elit/?promoter_id=5438968&partner_id=3440";

const canonicalDivergente = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07,
  html: `
    <link rel="canonical" href="${urlA17Divergente}">
    <script type="application/ld+json">
      { "@type": "Product", "name": "Samsung Galaxy A17", "sku": "240575800", "offers": { "price": "1299.90" } }
    </script>
  `
});
assert.strictEqual(canonicalDivergente.urlCanonica, urlRealA07);
assert.strictEqual(canonicalDivergente.produtoId, "240466500");
assert.strictEqual(canonicalDivergente.titulo, "");
assert.strictEqual(canonicalDivergente.precoAtual, "");
assert.ok(canonicalDivergente.avisos.includes("magalu_canonica_produto_divergente_ignorada"));
assert.ok(canonicalDivergente.avisos.includes("magalu_jsonld_produto_divergente_ignorado"));

const ogUrlDivergente = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07,
  html: `
    <meta property="og:url" content="${urlA17Divergente}">
    <meta property="og:title" content="Smartphone Samsung A07">
  `
});
assert.strictEqual(ogUrlDivergente.urlCanonica, urlRealA07);
assert.strictEqual(ogUrlDivergente.produtoId, "240466500");
assert.strictEqual(ogUrlDivergente.titulo, "", "og:title de conteudo divergente nao deve contaminar produto original");
assert.ok(ogUrlDivergente.avisos.includes("magalu_canonica_produto_divergente_ignorada"));
assert.ok(ogUrlDivergente.avisos.includes("magalu_conteudo_produto_divergente_ignorado"));

const responseUrlDivergente = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07,
  urlFinal: urlA17Divergente,
  html: '<meta property="og:title" content="Smartphone Samsung A07"><meta property="og:image" content="https://www.magazineluiza.com.br/a17.jpg"><meta property="product:price:amount" content="1299.90">'
});
assert.strictEqual(responseUrlDivergente.urlCanonica, urlRealA07);
assert.strictEqual(responseUrlDivergente.produtoId, "240466500");
assert.strictEqual(responseUrlDivergente.titulo, "");
assert.strictEqual(responseUrlDivergente.imagem, "");
assert.strictEqual(responseUrlDivergente.precoAtual, "");
assert.ok(responseUrlDivergente.avisos.includes("magalu_canonica_produto_divergente_ignorada"));
assert.ok(responseUrlDivergente.avisos.includes("magalu_conteudo_produto_divergente_ignorado"));

const canonicalCorreta = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07 + "?utm=abc",
  html: `<link rel="canonical" href="${urlRealA07}"><meta property="og:title" content="Smartphone Samsung A07">`
});
assert.strictEqual(canonicalCorreta.urlCanonica, urlRealA07);
assert.strictEqual(canonicalCorreta.produtoId, "240466500");
assert.strictEqual(canonicalCorreta.titulo, "Smartphone Samsung A07");

const mesmoProdutoSlugQuery = parseMagaluProdutoHtml({
  urlOriginal: urlNightCaviar + "?utm_source=radar",
  urlFinal: "https://www.magazinevoce.com.br/d1egopc/noite-caviar-paris/p/be172949ba/pf/ppfm/?seller_id=lider",
  html: `
    <link rel="canonical" href="https://www.magazinevoce.com.br/d1egopc/noite-caviar-paris/p/be172949ba/pf/ppfm/">
    <meta property="og:title" content="Night Caviar 100ml - Paris Elysses">
    <meta property="product:price:amount" content="78.90">
  `
});
assert.strictEqual(mesmoProdutoSlugQuery.urlCanonica, "https://www.magazinevoce.com.br/d1egopc/noite-caviar-paris/p/be172949ba/pf/ppfm/");
assert.strictEqual(mesmoProdutoSlugQuery.produtoId, "be172949ba");
assert.strictEqual(mesmoProdutoSlugQuery.titulo, "Night Caviar 100ml - Paris Elysses");
assert.strictEqual(moeda(mesmoProdutoSlugQuery.precoAtual), "R$ 78,90");
assert.ok(!mesmoProdutoSlugQuery.avisos.includes("magalu_conteudo_produto_divergente_ignorado"));

const captcha = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07,
  urlFinal: "https://www.magazinevoce.com.br/az-request-verify?url=" + encodeURIComponent(urlRealA07),
  html: `
    <html>
      <head>
        <title>Captcha Magalu</title>
        <link rel="canonical" href="${urlA17Divergente}">
      </head>
      <body>Complete o CAPTCHA para continuar</body>
    </html>
  `
});
assert.strictEqual(captcha.titulo, "");
assert.strictEqual(captcha.precoAtual, "");
assert.strictEqual(captcha.precoAnterior, "");
assert.strictEqual(captcha.imagem, "");
assert.strictEqual(captcha.categoria, "");
assert.strictEqual(captcha.produtoId, "240466500");
assert.ok(captcha.avisos.includes("magalu_captcha_detectado"));
assert.ok(captcha.avisos.includes("magalu_canonica_produto_divergente_ignorada"));

const paginaIndisponivel = parseMagaluProdutoHtml({
  urlOriginal: urlNightCaviar,
  html: `
    <html>
      <head><title>Magazine Luiza | Não é possível acessar a página</title></head>
      <body>Não é possível acessar a página</body>
    </html>
  `
});
assert.strictEqual(paginaIndisponivel.titulo, "");
assert.strictEqual(paginaIndisponivel.precoAtual, "");
assert.strictEqual(paginaIndisponivel.precoAnterior, "");
assert.strictEqual(paginaIndisponivel.imagem, "");
assert.strictEqual(paginaIndisponivel.categoria, "");
assert.strictEqual(paginaIndisponivel.produtoId, "be172949ba");
assert.ok(paginaIndisponivel.avisos.includes("magalu_pagina_indisponivel"));
assert.ok(paginaIndisponivel.avisos.includes("magalu_produto_nao_comprovado"));

const htmlMetaDivergente = parseMagaluProdutoHtml({
  urlOriginal: urlRealA07,
  html: `
    <meta property="og:url" content="${urlA17Divergente}">
    <meta property="og:title" content="Samsung Galaxy A17">
    <meta property="og:image" content="https://www.magazineluiza.com.br/a17.jpg">
    <meta property="product:price:amount" content="1299.90">
    <meta property="product:category" content="Celulares">
    <span>Vendido e entregue por Loja A17</span>
    <p>Cupom A17OFF</p>
  `
});
assert.strictEqual(htmlMetaDivergente.titulo, "");
assert.strictEqual(htmlMetaDivergente.imagem, "");
assert.strictEqual(htmlMetaDivergente.precoAtual, "");
assert.strictEqual(htmlMetaDivergente.categoria, "");
assert.strictEqual(htmlMetaDivergente.seller, "");
assert.strictEqual(htmlMetaDivergente.cupom, "");
assert.ok(htmlMetaDivergente.avisos.includes("magalu_conteudo_produto_divergente_ignorado"));

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
assert.strictEqual(produtoIdPorUrl(urlRealA07), "240466500");
assert.strictEqual(produtoIdPorUrl(urlNightCaviar), "be172949ba");
assert.strictEqual(produtoIdPorUrl(urlDivulgadorOferta), "240144700");
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
