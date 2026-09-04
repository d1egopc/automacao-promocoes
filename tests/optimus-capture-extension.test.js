const assert = require("assert");
const path = require("path");

const raiz = path.join(__dirname, "..", "optimus-capture");
const detector = require(path.join(raiz, "core", "marketplace-detector.js"));
const contrato = require(path.join(raiz, "core", "product-contract.js"));
const ml = require(path.join(raiz, "adapters", "mercadolivre.js"));

function htmlProdutoJsonLd() {
  return `
    <html>
      <head>
        <title>Creatine Beauty Pro | Mercado Livre</title>
        <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_123.webp">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Creatine Beauty Pro 180g Cranberry",
            "image": ["https://http2.mlstatic.com/D_NQ_NP_456.webp"],
            "offers": {
              "@type": "Offer",
              "price": "129.90",
              "priceCurrency": "BRL",
              "listPrice": "199.90"
            }
          }
        </script>
      </head>
      <body>
        <h1>Creatine Beauty Pro</h1>
        <p>Use o cupom SEMDEMORA</p>
      </body>
    </html>
  `;
}

function htmlWall() {
  return `
    <html>
      <head><title>Seguridad - Mercado Libre</title></head>
      <body>captcha/wall/logged account-verification</body>
    </html>
  `;
}

function htmlPrecoAmbiguo() {
  return `
    <html>
      <head><meta property="og:title" content="Produto com preco ambiguo"></head>
      <body>
        <h1>Produto com preco ambiguo</h1>
        <span>R$ 129,90</span>
        <span>R$ 149,90</span>
      </body>
    </html>
  `;
}

(async function main() {
  {
    const deteccao = detector.detectarMarketplacePorUrl("https://produto.mercadolivre.com.br/MLB-123-produto-_JM");
    assert.strictEqual(deteccao.suportado, true);
    assert.strictEqual(deteccao.marketplace, "mercadolivre");
  }

  {
    const deteccao = detector.detectarMarketplacePorUrl("https://meli.la/abc123");
    assert.strictEqual(deteccao.suportado, false);
    assert.strictEqual(deteccao.motivo, "meli_la_requer_url_real");
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlProdutoJsonLd(),
      "https://produto.mercadolivre.com.br/MLB-5065365233-produto-_JM"
    );
    assert.strictEqual(produto.marketplace, "mercadolivre");
    assert.strictEqual(produto.titulo, "Creatine Beauty Pro 180g Cranberry");
    assert.strictEqual(produto.precoAtual, 129.9);
    assert.strictEqual(produto.precoAnterior, 199.9);
    assert.strictEqual(produto.imagem, "https://http2.mlstatic.com/D_NQ_NP_456.webp");
    assert.strictEqual(produto.cupom, "SEMDEMORA");
    assert.strictEqual(produto.completo, true);
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlWall(),
      "https://www.mercadolivre.com.br/captcha/wall/logged"
    );
    assert.strictEqual(produto.completo, false);
    assert.ok(produto.warnings.includes("wall_captcha_detectado"));
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlPrecoAmbiguo(),
      "https://produto.mercadolivre.com.br/MLB-123-produto-_JM"
    );
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoAmbiguo, true);
    assert.strictEqual(produto.requerConferencia, true);
  }

  {
    const payload = contrato.payloadPreview({
      marketplace: "mercadolivre",
      urlOriginal: "https://produto.mercadolivre.com.br/MLB-123-produto-_JM",
      titulo: "Produto editado",
      precoAtual: "129,90",
      precoAnterior: "199,90",
      imagem: "https://http2.mlstatic.com/imagem.webp",
      cupom: "sem demora",
      origem: "cliente_malicioso"
    });
    assert.deepStrictEqual(payload, {
      marketplace: "mercadolivre",
      urlOriginal: "https://produto.mercadolivre.com.br/MLB-123-produto-_JM",
      titulo: "Produto editado",
      precoAtual: 129.9,
      precoAnterior: 199.9,
      imagem: "https://http2.mlstatic.com/imagem.webp",
      cupom: "SEM DEMORA",
      origem: "optimus_capture_v1"
    });
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    const respostas = [
      { ok: true, status: 200, body: { ok: true, token: "jwt_secreto_teste", usuario: { id: "cliente_a", nome: "Cliente A" } } },
      { ok: true, status: 200, body: { ok: true, usuario: { id: "cliente_a", nome: "Cliente A", plano: "ultimate" } } },
      { ok: false, status: 401, body: { ok: false, erro: "nao_autorizado" } }
    ];
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      const resposta = respostas.shift();
      return {
        ok: resposta.ok,
        status: resposta.status,
        async json() {
          return resposta.body;
        }
      };
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    const authSalvo = await auth.autenticar("cliente_a", "senha_teste");
    assert.strictEqual(authSalvo.usuario.id, "cliente_a");
    assert.strictEqual(requests[0].url, api.endpoint("/login"));
    assert.ok(!JSON.stringify(requests[0].options.body || "").includes("jwt_secreto_teste"));
    const restaurado = await auth.restaurarSessao();
    assert.strictEqual(restaurado.usuario.plano, "ultimate");
    const depoisExpirado = await auth.restaurarSessao();
    assert.strictEqual(depoisExpirado, null);
    assert.strictEqual(await storage.lerAuth(), null);
  }


  {
    const { hashCodeChallenge } = require("../modules/auth/capture-handoff.service");
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    const handoff = require(path.join(raiz, "services", "handoff.js"));
    const codeVerifier = "verifier_seguro_capture_" + "x".repeat(48);
    const challenge = await handoff.criarCodeChallenge(codeVerifier);
    assert.strictEqual(challenge, hashCodeChallenge(codeVerifier));
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    const urlsAbertas = [];
    const status = [];
    let tentativasTroca = 0;
    let esperas = 0;
    api.iniciarCaptureHandoff = async (payload) => {
      assert.ok(payload.state.length >= 16);
      assert.ok(payload.codeChallenge.length >= 32);
      return { ok: true, handoffId: "handoff_teste", state: payload.state };
    };
    api.trocarCaptureHandoff = async (payload) => {
      assert.strictEqual(payload.handoffId, "handoff_teste");
      assert.ok(payload.codeVerifier.length >= 32);
      tentativasTroca += 1;
      if (tentativasTroca === 1) {
        const erro = new Error("capture_handoff_nao_autorizado");
        erro.status = 409;
        erro.body = { motivo: "capture_handoff_nao_autorizado" };
        throw erro;
      }
      return { ok: true, token: "jwt_capture_teste" };
    };
    api.me = async (token) => {
      assert.strictEqual(token, "jwt_capture_teste");
      return { ok: true, usuario: { id: "cliente_a", nome: "Cliente A", plano: "ultimate" } };
    };

    const authSalvo = await auth.conectarComOptimus({
      abrirUrl: (url) => urlsAbertas.push(url),
      onStatus: (mensagem) => status.push(mensagem),
      esperar: async () => { esperas += 1; },
      intervaloMs: 1,
      maxTentativas: 3
    });

    assert.strictEqual(authSalvo.token, "jwt_capture_teste");
    assert.strictEqual(authSalvo.origem, "capture_handoff");
    assert.strictEqual(authSalvo.usuario.id, "cliente_a");
    assert.strictEqual(tentativasTroca, 2);
    assert.strictEqual(esperas, 1);
    assert.strictEqual(urlsAbertas.length, 1);
    assert.ok(urlsAbertas[0].includes("/capture/connect?"));
    assert.ok(!urlsAbertas[0].includes("jwt_capture_teste"));
    assert.ok(status.includes("Conexao autorizada."));
    assert.strictEqual((await storage.lerAuth()).token, "jwt_capture_teste");
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    api.iniciarCaptureHandoff = async (payload) => ({ ok: true, handoffId: "handoff_expirado", state: payload.state });
    api.trocarCaptureHandoff = async () => {
      const erro = new Error("capture_handoff_expirado");
      erro.status = 410;
      erro.body = { motivo: "capture_handoff_expirado" };
      throw erro;
    };

    await assert.rejects(
      auth.conectarComOptimus({ abrirUrl: () => undefined, esperar: async () => undefined, maxTentativas: 1 }),
      /capture_handoff_expirado/
    );
    assert.strictEqual(await storage.lerAuth(), null);
  }
  console.log("optimus-capture-extension.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
