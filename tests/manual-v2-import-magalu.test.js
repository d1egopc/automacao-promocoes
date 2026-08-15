"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-magalu-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  normalizarMarketplaceManualV2
} = require("../modules/manual-v2/manual-offers.contract");
const {
  importarProdutoMagaluManualV2
} = require("../modules/manual-v2/adapters/magalu.manual.adapter");

const agora = "2026-08-15T10:00:00.000Z";
const urlProduto = "https://www.magazineluiza.com.br/smart-tv-50/p/abc123/et/elit/";
const urlRealA07 = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a07/p/240466500/te/ga07/";
const urlA17Divergente = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a17/p/240575800/te/ga17/";
const htmlCompleto = `
  <html>
    <head>
      <link rel="canonical" href="${urlProduto}">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Smart TV Magalu 50",
          "sku": "abc123",
          "image": "https://a-static.mlcdn.com.br/tv.jpg",
          "offers": { "price": "1999.90", "priceCurrency": "BRL" }
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
    </body>
  </html>
`;

function deps(comPromoter = true, parserOptions = {}) {
  return {
    clienteId: "cliente_magalu",
    now: agora,
    idFactory: () => "manual_v2_magalu",
    parserOptions,
    getIntegracaoCliente(clienteId, marketplace) {
      assert.strictEqual(clienteId, "cliente_magalu");
      assert.strictEqual(marketplace, "magalu");
      if (!comPromoter) return null;
      return { credenciais: { promoterId: "d1egopc" } };
    }
  };
}

(async function main() {
{
  assert.strictEqual(normalizarMarketplaceManualV2("Magazine Luiza"), "magalu");
  assert.strictEqual(normalizarMarketplaceManualV2("magazinevoce"), "magalu");
}

{
  const oferta = await importarProdutoMagaluManualV2(urlProduto, deps(true, { html: htmlCompleto }));

  assert.strictEqual(oferta.id, "manual_v2_magalu");
  assert.strictEqual(oferta.clienteId, "cliente_magalu");
  assert.strictEqual(oferta.marketplace, "magalu");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.urlOriginal, urlProduto);
  assert.strictEqual(
    oferta.urlAfiliada,
    "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/"
  );
  assert.strictEqual(oferta.titulo, "Smart TV Magalu 50");
  assert.strictEqual(oferta.precoAtual, "R$\u00a01.999,90");
  assert.strictEqual(oferta.precoAnterior, "R$\u00a02.499,90");
  assert.strictEqual(oferta.imagem, "https://a-static.mlcdn.com.br/tv.jpg");
  assert.strictEqual(oferta.categoria, "TV e Video");
  assert.strictEqual(oferta.seller, "Magalu");
  assert.strictEqual(oferta.cupom, "Cupom MAGALU10");
  assert.ok(oferta.parcelamento.includes("10x de R$ 199,99"));
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "magalu");
  assert.strictEqual(oferta.fonteImportacao.adapter, "magalu.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("urlAfiliada"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.ok(!Object.prototype.hasOwnProperty.call(oferta, "promoterId"), "oferta nao deve expor promoterId como campo");
  assert.ok(!JSON.stringify(oferta.fonteImportacao).includes("promoterId"), "fonteImportacao nao deve expor promoterId");
}

{
  const oferta = await importarProdutoMagaluManualV2(urlRealA07, deps(true, {
    html: `
      <link rel="canonical" href="${urlA17Divergente}">
      <script type="application/ld+json">
        { "@type": "Product", "name": "Samsung Galaxy A17", "sku": "240575800", "offers": { "price": "1299.90" } }
      </script>
    `
  }));

  assert.strictEqual(oferta.urlOriginal, urlRealA07);
  assert.strictEqual(
    oferta.urlAfiliada,
    "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a07/p/240466500/te/ga07/",
    "Manual V2 nao pode trocar 240466500 por 240575800"
  );
  assert.ok(!oferta.urlAfiliada.includes("240575800"));
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_canonica_produto_divergente_ignorada"));
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_jsonld_produto_divergente_ignorado"));
}

{
  const oferta = await importarProdutoMagaluManualV2(urlRealA07, deps(true, {
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
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.urlAfiliada, "", "CAPTCHA nao pode gerar afiliado de recomendacao");
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_captcha_detectado"));
}

{
  const oferta = await importarProdutoMagaluManualV2(urlProduto, deps(false, { html: htmlCompleto }));

  assert.strictEqual(oferta.titulo, "Smart TV Magalu 50");
  assert.strictEqual(oferta.precoAtual, "R$\u00a01.999,90");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_integracao_nao_configurada_url_afiliada_vazia"));
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_url_afiliada_vazia_sem_prova"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("urlAfiliada"));
}

{
  const oferta = await importarProdutoMagaluManualV2("https://www.magazinevoce.com.br/magazineoutra/smart-tv-50/p/abc123/et/elit/", deps(true, {
    html: '<meta property="og:title" content="Produto Outra Loja"><meta property="product:price:amount" content="99.90">'
  }));

  assert.strictEqual(oferta.titulo, "Produto Outra Loja");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_link_loja_divergente"));
}

{
  const oferta = await importarProdutoMagaluManualV2(urlProduto, deps(true, {
    html: `
      <meta property="og:title" content="Produto Sem Preco Anterior">
      <meta property="product:price:amount" content="799.90">
      <p>em 8x de R$ 99,99 sem juros</p>
      <p>Economia R$ 100,00</p>
      <p>Cupom R$ 20,00 OFF</p>
    `
  }));

  assert.strictEqual(oferta.titulo, "Produto Sem Preco Anterior");
  assert.strictEqual(oferta.precoAtual, "R$\u00a0799,90");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.ok(oferta.parcelamento.includes("8x de R$ 99,99"));
  assert.ok(oferta.cupom.includes("Cupom R$ 20,00"));
}

{
  const oferta = await importarProdutoMagaluManualV2("https://www.magazineluiza.com.br/", deps(true, {
    html: "<title>Magazine Luiza</title><main>Home generica</main>"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.imagem, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("magalu_produto_nao_comprovado"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_magalu", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_magalu", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "magalu.manual.adapter.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "importarMagalu",
    "/importar-magalu-manual",
    "farejarMagalu",
    "adicionarOfertaNaFila",
    "salvarFila",
    "processarFila",
    "prepararOfertaGlobal",
    "Distributor",
    "Engine",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual",
    "manual-offers.storage"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Adapter Magalu Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-magalu.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
