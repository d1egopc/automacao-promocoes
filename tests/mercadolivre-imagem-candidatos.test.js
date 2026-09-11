const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ml-img-"));

const { importarMercadoLivre } = require("../marketplaces/mercadolivre/importar");

const originalFetch = global.fetch;

function mlstatic(nome) {
  return `https://http2.mlstatic.com/D_NQ_NP_${nome}.jpg`;
}

function htmlProdutoMl({ imagemJsonLd = "", imagemOg = "", imagemTwitter = "", estado = "" } = {}) {
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Produto Mercado Livre Teste",
    ...(imagemJsonLd ? { image: imagemJsonLd } : {}),
    offers: { price: "199.90" }
  });
  return `
    <html><head>
      ${imagemOg ? `<meta property="og:image" content="${imagemOg}" />` : ""}
      ${imagemTwitter ? `<meta name="twitter:image" content="${imagemTwitter}" />` : ""}
      <script type="application/ld+json">${jsonLd}</script>
    </head><body>
      <h1>Produto Mercado Livre Teste</h1>
      <span class="andes-money-amount__fraction">199</span>
      <script>window.__STATE__ = ${estado || "{}"};</script>
    </body></html>
  `;
}

async function importarHtmlImagem(html, jobId) {
  global.fetch = async () => ({
    status: 200,
    url: "https://www.mercadolivre.com.br/produto/p/MLB123456",
    text: async () => html
  });
  return importarMercadoLivre("https://meli.la/teste", "cliente_ml", {
    getIntegracaoCliente: () => ({ credenciais: {} }),
    gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado",
    contextoEngine: { clienteId: "cliente_ml", jobId }
  });
}

async function testarPreservacaoCandidatosImagem() {
  const imagemPrincipal = mlstatic("principal");
  const html = `
    <html>
      <head>
        <meta property="og:image" content="${mlstatic("og")}" />
        <meta name="twitter:image" content="${mlstatic("twitter")}" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Produto Mercado Livre Teste",
            "image": ["${imagemPrincipal}", "${mlstatic("jsonld-2")}"],
            "offers": { "price": "199.90" }
          }
        </script>
      </head>
      <body>
        <h1>Produto Mercado Livre Teste</h1>
        <span class="andes-money-amount__fraction">199</span>
        <script>
          window.__STATE__ = {
            "secure_thumbnail":"${mlstatic("secure-thumb")}",
            "thumbnail":"${mlstatic("thumb")}",
            "thumbnailUrl":"${mlstatic("thumb-url")}",
            "picture_url":"${mlstatic("picture-url")}",
            "pictures":[
              {"secure_url":"${mlstatic("picture-secure")}"},
              {"url":"${mlstatic("picture-url-array")}"},
              {"url":"data:image/png;base64,abc"},
              {"url":"${mlstatic("picture-url-array")}"}
            ]
          };
        </script>
      </body>
    </html>
  `;

  global.fetch = async () => ({
    status: 200,
    url: "https://www.mercadolivre.com.br/produto/p/MLB123456",
    text: async () => html
  });

  const produto = await importarMercadoLivre("https://meli.la/teste", "cliente_ml", {
    getIntegracaoCliente: () => ({ credenciais: {} }),
    gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado",
    contextoEngine: { clienteId: "cliente_ml", jobId: "job_ml" }
  });

  assert(produto, "produto deve ser importado");
  assert.strictEqual(produto.imagem, imagemPrincipal);
  assert.strictEqual(produto.imagemOrigem, "jsonLd.image");
  assert.strictEqual(produto.secure_thumbnail, mlstatic("secure-thumb"));
  assert.strictEqual(produto.thumbnail, mlstatic("thumb"));
  assert.strictEqual(produto.thumbnailUrl, mlstatic("thumb-url"));
  assert.strictEqual(produto.picture_url, mlstatic("picture-url"));
  assert(produto.pictures.some((item) => item.secure_url === mlstatic("picture-secure")));
  assert(produto.pictures.some((item) => item.url === mlstatic("picture-url-array")));
  assert(!produto.imagemCandidatos.some((item) => /^data:image/i.test(item.url)));
  assert.strictEqual(new Set(produto.imagemCandidatos.map((item) => item.url)).size, produto.imagemCandidatos.length);
  assert(produto.imagemCandidatos.length <= 12);
  assert.deepStrictEqual(produto.metadata.produto.images, produto.images);
  assert.deepStrictEqual(produto.metadata.produto.pictures, produto.pictures);
}

async function testarPrecedenciaECandidatoPrincipalSeguro() {
  const pictureSecure = mlstatic("picture-secure-principal");
  const pictureUrl = mlstatic("picture-url-principal");
  const estadoComPictures = JSON.stringify({
    pictures: [{ secure_url: pictureSecure }],
    picture_url: pictureUrl,
    secure_thumbnail: mlstatic("secure-thumb-nao-promover"),
    thumbnail: mlstatic("thumb-nao-promover")
  });

  const jsonLd = await importarHtmlImagem(htmlProdutoMl({
    imagemJsonLd: mlstatic("jsonld-principal"),
    estado: estadoComPictures
  }), "job_jsonld");
  assert.strictEqual(jsonLd.imagem, mlstatic("jsonld-principal"), "JSON-LD continua prioritario");
  assert.strictEqual(jsonLd.imagemOrigem, "jsonLd.image");

  const og = await importarHtmlImagem(htmlProdutoMl({
    imagemOg: mlstatic("og-principal"),
    estado: estadoComPictures
  }), "job_og");
  assert.strictEqual(og.imagem, mlstatic("og-principal"), "OG continua prioritario");
  assert.strictEqual(og.imagemOrigem, "og:image");

  const twitter = await importarHtmlImagem(htmlProdutoMl({
    imagemTwitter: mlstatic("twitter-principal"),
    estado: estadoComPictures
  }), "job_twitter");
  assert.strictEqual(twitter.imagem, mlstatic("twitter-principal"), "Twitter continua prioritario");
  assert.strictEqual(twitter.imagemOrigem, "twitter:image");

  const pictures = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ pictures: [{ secure_url: pictureSecure }] })
  }), "job_pictures");
  assert.strictEqual(pictures.imagem, pictureSecure, "pictures[].secure_url vira principal apenas sem meta principal");
  assert.strictEqual(pictures.imagemOrigem, "pictures[0].secure_url");

  const picture = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ picture_url: pictureUrl })
  }), "job_picture_url");
  assert.strictEqual(picture.imagem, pictureUrl, "picture_url vira principal apenas sem meta principal");
  assert.strictEqual(picture.imagemOrigem, "picture_url");

  const somenteSecureThumbnail = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ secure_thumbnail: mlstatic("secure-thumb-somente") })
  }), "job_secure_thumbnail");
  assert.strictEqual(somenteSecureThumbnail.imagem, "", "secure_thumbnail nao pode ser promovido");

  const somenteThumbnail = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ thumbnail: mlstatic("thumb-somente") })
  }), "job_thumbnail");
  assert.strictEqual(somenteThumbnail.imagem, "", "thumbnail nao pode ser promovido");

  const externo = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ picture_url: "https://cdn.externo.test/produto.jpg" })
  }), "job_host_externo");
  assert.strictEqual(externo.imagem, "", "host externo continua rejeitado pelo normalizador ML");

  const protocolRelative = await importarHtmlImagem(htmlProdutoMl({
    estado: JSON.stringify({ picture_url: "//http2.mlstatic.com/D_NQ_NP_PROTOCOL_RELATIVE.jpg" })
  }), "job_protocol_relative");
  assert.strictEqual(protocolRelative.imagem, "https://http2.mlstatic.com/D_NQ_NP_PROTOCOL_RELATIVE.jpg");
  assert.strictEqual(protocolRelative.imagemOrigem, "picture_url");
}

async function testarCaptchaHttp200FailClosed() {
  const html = `
    <html>
      <head><title>windows</title></head>
      <body>
        <h1>Verifique se voce e um robo</h1>
        <script>window.__STATE__ = {"title":"windows"};</script>
      </body>
    </html>
  `;

  global.fetch = async () => ({
    status: 200,
    url: "https://www.mercadolivre.com.br/captcha/wall/logged?go=https%3A%2F%2Fproduto.mercadolivre.com.br%2FMLB-123-produto-real-_JM",
    text: async () => html
  });

  const produto = await importarMercadoLivre("https://produto.mercadolivre.com.br/MLB-123-produto-real-_JM", "cliente_ml", {
    getIntegracaoCliente: () => ({ credenciais: {} }),
    gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado",
    contextoEngine: { clienteId: "cliente_ml", jobId: "job_captcha" }
  });

  assert.strictEqual(produto, null, "captcha/wall HTTP 200 nao pode virar produto importado");
}

async function testarTituloTecnicoSemBloqueioFailClosed() {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Just a moment" />
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"Just a moment","offers":{"price":"199.90"}}
        </script>
      </head>
      <body><h1>Just a moment</h1></body>
    </html>
  `;

  global.fetch = async () => ({
    status: 200,
    url: "https://produto.mercadolivre.com.br/MLB-456",
    text: async () => html
  });

  const produto = await importarMercadoLivre("https://produto.mercadolivre.com.br/MLB-456", "cliente_ml", {
    getIntegracaoCliente: () => ({ credenciais: {} }),
    gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado",
    contextoEngine: { clienteId: "cliente_ml", jobId: "job_titulo_tecnico" }
  });

  assert.strictEqual(produto, null, "titulo tecnico nao pode virar titulo de produto");
}

async function testarWindowsNaoViraTituloProduto() {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="windows" />
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"windows","offers":{"price":"199.90"}}
        </script>
      </head>
      <body><h1>windows</h1></body>
    </html>
  `;

  global.fetch = async () => ({
    status: 200,
    url: "https://produto.mercadolivre.com.br/MLB-789",
    text: async () => html
  });

  const produto = await importarMercadoLivre("https://produto.mercadolivre.com.br/MLB-789", "cliente_ml", {
    getIntegracaoCliente: () => ({ credenciais: {} }),
    gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/afiliado",
    contextoEngine: { clienteId: "cliente_ml", jobId: "job_windows" }
  });

  assert.strictEqual(produto, null, "windows nao pode virar titulo de produto Mercado Livre");
}

(async () => {
  try {
    await testarPreservacaoCandidatosImagem();
    await testarPrecedenciaECandidatoPrincipalSeguro();
    await testarCaptchaHttp200FailClosed();
    await testarTituloTecnicoSemBloqueioFailClosed();
    await testarWindowsNaoViraTituloProduto();
    console.log("mercadolivre-imagem-candidatos.test.js ok");
  } finally {
    global.fetch = originalFetch;
  }
})();
