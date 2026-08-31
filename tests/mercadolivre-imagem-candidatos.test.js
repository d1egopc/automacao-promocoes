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
    await testarCaptchaHttp200FailClosed();
    await testarTituloTecnicoSemBloqueioFailClosed();
    await testarWindowsNaoViraTituloProduto();
    console.log("mercadolivre-imagem-candidatos.test.js ok");
  } finally {
    global.fetch = originalFetch;
  }
})();
