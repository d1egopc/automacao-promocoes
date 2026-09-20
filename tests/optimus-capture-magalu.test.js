const assert = require("assert");
const fs = require("fs");

const detector = require("../optimus-capture/core/marketplace-detector");
const contrato = require("../optimus-capture/core/product-contract");
const magalu = require("../optimus-capture/adapters/magalu");
const registry = require("../optimus-capture/adapters/registry");

function documento(html, href) {
  return {
    location: { href },
    documentElement: { outerHTML: html }
  };
}

function htmlProduto({ id = "afh3e1g80j", imagem = "https://a-static.mlcdn.com.br/produto.jpg" } = {}) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Smart TV Magalu Teste",
    sku: id,
    category: "Eletronicos",
    image: [imagem],
    offers: {
      price: "999.90",
      listPrice: "1299.90",
      seller: { name: "Loja Oficial" }
    }
  })}</script><meta property="og:title" content="Smart TV Magalu Teste"><h1>Smart TV Magalu Teste</h1>`;
}

(async function main() {
  const url = "https://www.magazineluiza.com.br/smart-tv-teste/p/afh3e1g80j/";
  const deteccao = detector.detectarMarketplacePorUrl(url);
  assert.strictEqual(deteccao.marketplace, "magalu");
  assert.strictEqual(deteccao.suportado, true);
  assert.strictEqual(deteccao.produtoId, "afh3e1g80j");

  const magazineVoce = detector.detectarMarketplacePorUrl("https://www.magazinevoce.com.br/d1egopc/smart-tv/p/241382400/");
  assert.strictEqual(magazineVoce.suportado, true);
  assert.strictEqual(magazineVoce.produtoId, "241382400");
  const semProduto = detector.detectarMarketplacePorUrl("https://www.magazineluiza.com.br/busca/tv/");
  assert.strictEqual(semProduto.suportado, false);
  assert.strictEqual(semProduto.motivo, "pagina_magalu_sem_produto");
  assert.strictEqual(detector.detectarMarketplacePorUrl("https://evil.example/p/afh3e1g80j/").marketplace, "");

  const produto = magalu.capturarMagaluDeHtml(htmlProduto(), url);
  assert.strictEqual(produto.marketplace, "magalu");
  assert.strictEqual(produto.produtoId, "afh3e1g80j");
  assert.strictEqual(produto.sku, "afh3e1g80j");
  assert.strictEqual(produto.titulo, "Smart TV Magalu Teste");
  assert.strictEqual(produto.precoAtual, 999.9);
  assert.strictEqual(produto.precoAnterior, 1299.9);
  assert.ok(!produto.precoPix, "sem evidencia Pix o campo permanece vazio");
  assert.strictEqual(produto.imagem, "https://a-static.mlcdn.com.br/produto.jpg");
  assert.strictEqual(magalu.imagemOficial("https://evilmlcdn.com.br/produto.jpg"), "");
  assert.strictEqual(magalu.imagemOficial("https://mlcdn.com.br.evil.com/produto.jpg"), "");
  assert.strictEqual(magalu.imagemOficial("http://a-static.mlcdn.com.br/produto.jpg"), "");
  assert.strictEqual(produto.seller, "Loja Oficial");
  assert.strictEqual(produto.categoria, "Eletronicos");
  assert.strictEqual(produto.completo, true);
  assert.strictEqual(magalu.capturarMagaluDeHtml(htmlProduto({ imagem: "https://images.example/terceiro.jpg" }), url).imagem, "");

  const pepsiUrl = "https://www.magazineluiza.com.br/refrigerante-pepsi/p/236699800/";
  const pepsiHtml = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Refrigerante Pepsi Twist 350ml Lata 12 Unidades",
    sku: "236699800",
    image: ["https://a-static.mlcdn.com.br/pepsi.jpg"],
    offers: {
      price: "37.90",
      priceCurrency: "BRL",
      priceSpecification: [
        { name: "Pix", price: "37.90", paymentMethod: "Pix" },
        { name: "1x sem juros", price: "38.28", paymentMethod: "creditCard" }
      ]
    }
  })}</script><div data-testid="price-pix"><span>Pix</span><strong>R$ 37,90</strong></div><div data-testid="installment-price">R$ 38,28 em 1x sem juros</div>`;
  const pepsi = magalu.capturarMagaluDeHtml(pepsiHtml, pepsiUrl);
  assert.strictEqual(pepsi.precoAtual, 37.9);
  assert.strictEqual(pepsi.precoPix, 37.9);
  assert.strictEqual(pepsi.precoAnterior, null);
  assert.strictEqual(pepsi.precoMin, null);
  assert.strictEqual(pepsi.precoMax, null);
  assert.strictEqual(pepsi.temVariacaoPreco, false);

  const faixaHtml = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product", sku: "faixa-magalu", name: "Produto com variacao", image: ["https://a-static.mlcdn.com.br/faixa.jpg"],
    offers: { lowPrice: "10.00", highPrice: "20.00", priceCurrency: "BRL" }
  })}</script><div data-testid="price-range">A partir de R$ 10,00</div>`;
  const faixa = magalu.capturarMagaluDeHtml(faixaHtml, "https://www.magazineluiza.com.br/produto/p/faixa-magalu/");
  assert.strictEqual(faixa.precoAtual, null);
  assert.strictEqual(faixa.precoMin, 10);
  assert.strictEqual(faixa.precoMax, 20);
  assert.strictEqual(faixa.temVariacaoPreco, true);
  const faixaEstruturada = magalu.capturarMagaluDeHtml(
    `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", sku: "faixa-estruturada", name: "Produto", image: ["https://a-static.mlcdn.com.br/faixa-2.jpg"], offers: { price: "10.00" } })}</script><div data-testid="price-min">A partir de R$ 10,00</div><div data-testid="price-max">Até R$ 20,00</div>`,
    "https://www.magazineluiza.com.br/produto/p/faixa-estruturada/"
  );
  assert.strictEqual(faixaEstruturada.precoMin, 10);
  assert.strictEqual(faixaEstruturada.precoMax, 20);
  assert.strictEqual(faixaEstruturada.precoAtual, null);

  const capturado = registry.capturarPaginaAtual(documento(htmlProduto(), url), { href: url });
  assert.strictEqual(capturado.ok, true);
  assert.strictEqual(capturado.produto.produtoId, "afh3e1g80j");

  const payload = contrato.payloadPreview({
    ...produto,
    marketplace: "magalu",
    precoPix: "899,90",
    cupom: "MAGALU10",
    categoria: "Eletronicos",
    seller: "Loja Oficial",
    parcelamento: "10x de R$ 99,90",
    condicaoPix: "no Pix",
    imposto: "0",
    moedas: "100 moedas"
  });
  assert.strictEqual(payload.precoAnterior, 1299.9);
  assert.strictEqual(payload.precoPix, "899,90");
  assert.strictEqual(payload.cupom, "MAGALU10");
  assert.strictEqual(payload.categoria, "Eletronicos");
  assert.strictEqual(payload.seller, "Loja Oficial");
  assert.strictEqual(payload.parcelamento, "10x de R$ 99,90");
  assert.strictEqual(payload.condicaoPix, "no Pix");
  assert.strictEqual(payload.imposto, "0");
  assert.strictEqual(payload.moedas, "100 moedas");

  const painel = fs.readFileSync("optimus-capture/sidepanel/panel.js", "utf8");
  const painelHtml = fs.readFileSync("optimus-capture/sidepanel/panel.html", "utf8");
  assert.ok(painel.includes("campoPrecoPix") && painel.includes("campoPrecoMin") && painel.includes("campoPrecoMax"));
  assert.ok(painel.includes("valorOpcionalEditado") && painel.includes("campoParcelamento"));
  assert.ok(painelHtml.includes('id="campoPrecoPix"') && painelHtml.includes('id="campoPrecoMin"'));

  const manifest = JSON.parse(fs.readFileSync("optimus-capture/manifest.json", "utf8"));
  assert.ok(manifest.content_scripts.some((item) => item.matches.some((match) => match.includes("magazineluiza.com.br"))));
  assert.ok(manifest.content_scripts.some((item) => item.js.includes("adapters/magalu.js")));
  console.log("optimus-capture-magalu.test.js: ok");
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
