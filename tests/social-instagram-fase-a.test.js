const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-instagram-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";

const instagram = require("../modules/social/instagram");
const socialStorage = require("../modules/social/storage");

function clienteFile(clienteId, arquivo) {
  return path.join(dataDir, "clientes", clienteId, arquivo);
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body, config) {
      chamadas.push({ metodo: "post", url, body, config });
      if (opcoes.erroTokenCurto) throw new Error("token_curto_falhou");
      return {
        data: {
          access_token: `short_${opcoes.sufixo || "token"}`,
          token_type: "bearer"
        }
      };
    },
    async get(url, config) {
      chamadas.push({ metodo: "get", url, config });
      if (url.endsWith("/access_token")) {
        if (opcoes.erroTokenLongo) throw new Error("token_longo_falhou");
        return {
          data: {
            access_token: `long_${opcoes.sufixo || "token"}`,
            token_type: "bearer",
            expires_in: 5184000
          }
        };
      }
      if (url.endsWith("/me")) {
        if (opcoes.erroMe) throw new Error("me_falhou");
        return {
          data: {
            user_id: `ig_${opcoes.sufixo || "user"}`,
            username: `optimus_${opcoes.sufixo || "user"}`,
            account_type: "BUSINESS",
            profile_picture_url: "https://cdn.optimus.test/profile.jpg"
          }
        };
      }
      throw new Error(`url_inesperada:${url}`);
    }
  };
}

async function conectarCliente(clienteId, sufixo = clienteId) {
  const inicio = instagram.iniciarConexaoInstagram({ clienteId });
  const httpClient = mockHttpClient({ sufixo });
  const conexao = await instagram.concluirCallbackInstagram({
    code: `code_${sufixo}`,
    state: inicio.state,
    httpClient
  });
  return { inicio, httpClient, conexao };
}

(async () => {
  const inicio = instagram.iniciarConexaoInstagram({ clienteId: "cliente_a" });
  const estado = instagram.decodificarStateInstagram(inicio.state);
  assert.strictEqual(estado.clienteId, "cliente_a", "state deve carregar clienteId");
  assert.ok(estado.nonce, "state deve carregar nonce");
  assert.ok(estado.exp > Date.now(), "state deve carregar expiracao");
  assert.ok(inicio.authUrl.startsWith("https://api.instagram.com/oauth/authorize?"));
  assert.ok(inicio.authUrl.includes("scope=instagram_business_basic"));
  assert.ok(!inicio.authUrl.includes("client_secret"));

  await assert.rejects(
    () => instagram.concluirCallbackInstagram({ code: "", state: inicio.state, httpClient: mockHttpClient() }),
    /instagram_code_obrigatorio/
  );

  const expiradoPayload = Buffer.from(JSON.stringify({
    clienteId: "cliente_a",
    nonce: "nonce_expirado",
    exp: Date.now() - 1000
  })).toString("base64url");
  const crypto = require("crypto");
  const assinaturaExpirada = crypto
    .createHmac("sha256", process.env.INSTAGRAM_OAUTH_STATE_SECRET)
    .update(expiradoPayload)
    .digest("base64url");
  assert.throws(
    () => instagram.decodificarStateInstagram(`${expiradoPayload}.${assinaturaExpirada}`),
    /instagram_state_expirado/
  );

  const conectadoA = await instagram.concluirCallbackInstagram({
    code: "code_cliente_a",
    state: inicio.state,
    httpClient: mockHttpClient({ sufixo: "cliente_a" })
  });
  assert.strictEqual(conectadoA.conectado, true);
  assert.strictEqual(conectadoA.instagramUserId, "ig_cliente_a");
  assert.strictEqual(conectadoA.username, "optimus_cliente_a");
  assert.strictEqual(conectadoA.accountType, "BUSINESS");
  assert.ok(conectadoA.token.accessToken.startsWith("long_"));

  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_replay",
      state: inicio.state,
      httpClient: mockHttpClient({ sufixo: "replay" })
    }),
    /instagram_state_reutilizado/
  );

  const inicioErroToken = instagram.iniciarConexaoInstagram({ clienteId: "cliente_erro_token" });
  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_erro",
      state: inicioErroToken.state,
      httpClient: mockHttpClient({ erroTokenCurto: true })
    }),
    /token_curto_falhou/
  );

  const inicioErroMe = instagram.iniciarConexaoInstagram({ clienteId: "cliente_erro_me" });
  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_erro_me",
      state: inicioErroMe.state,
      httpClient: mockHttpClient({ erroMe: true })
    }),
    /me_falhou/
  );

  await conectarCliente("cliente_b", "cliente_b");
  const statusA = instagram.sanitizarConexaoInstagram(instagram.lerConexaoInstagram("cliente_a"));
  const statusB = instagram.sanitizarConexaoInstagram(instagram.lerConexaoInstagram("cliente_b"));
  assert.strictEqual(statusA.instagramUserId, "ig_cliente_a");
  assert.strictEqual(statusB.instagramUserId, "ig_cliente_b");
  assert.strictEqual(statusA.tokenPresente, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(statusA, "accessToken"), "status nao deve expor token");
  assert.ok(JSON.stringify(statusA).includes("long_") === false, "status nunca deve conter token");

  const persistido = JSON.parse(fs.readFileSync(clienteFile("cliente_a", "social-instagram.json"), "utf8"));
  assert.strictEqual(persistido.token.accessToken, "long_cliente_a");
  delete require.cache[require.resolve("../modules/social/instagram")];
  const instagramRecarregado = require("../modules/social/instagram");
  assert.strictEqual(instagramRecarregado.lerConexaoInstagram("cliente_a").instagramUserId, "ig_cliente_a");

  socialStorage.setConexaoMetaSocial("cliente_a", {
    conectado: true,
    token: { accessToken: "facebook_token" },
    facebook: { conectado: true, pageId: "page_1", pageName: "Pagina" },
    paginas: [{ id: "page_1", name: "Pagina", accessToken: "page_token", conectado: true }]
  });
  instagramRecarregado.limparConexaoInstagram("cliente_a");
  const instagramDesconectado = instagramRecarregado.sanitizarConexaoInstagram(
    instagramRecarregado.lerConexaoInstagram("cliente_a")
  );
  const metaDepois = socialStorage.getConexaoMetaSocial("cliente_a");
  assert.strictEqual(instagramDesconectado.conectado, false);
  assert.strictEqual(instagramDesconectado.tokenPresente, false);
  assert.strictEqual(metaDepois.token.accessToken, "facebook_token", "desconexao instagram nao remove Facebook");

  console.log("social-instagram-fase-a: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
