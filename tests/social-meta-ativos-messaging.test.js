const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-meta-"));
process.env.DATA_DIR = dataDir;
process.env.META_APP_ID = "meta_app_optimus";
process.env.META_APP_SECRET = "meta_secret_optimus";
process.env.META_REDIRECT_URI = "https://api.optimus.test/social/meta/callback";
process.env.META_OAUTH_STATE_SECRET = "meta_state_secret_optimus";
delete process.env.META_SCOPES_CONEXAO;

const carregarOriginal = Module._load;
Module._load = function carregarComAxiosMock(request, parent, isMain) {
  if (request === "axios") return {};
  return carregarOriginal.call(this, request, parent, isMain);
};

const facebook = require("../modules/social/facebook");
const storage = require("../modules/social/storage");

function paginaMeta({ id, token, iba = "", username = "" }) {
  return {
    id,
    name: `Pagina ${id}`,
    username: `pagina_${id}`,
    access_token: token,
    instagram_business_account: iba
      ? { id: iba, username: username || `ig_${id}`, name: `Instagram ${id}` }
      : null
  };
}

function mockHttpClient(paginas = []) {
  const chamadas = [];
  return {
    chamadas,
    async get(url, config = {}) {
      chamadas.push({ metodo: "get", url, params: config.params || {} });
      if (url.endsWith("/oauth/access_token")) {
        return {
          data: {
            access_token: "meta_user_token_teste",
            token_type: "bearer",
            expires_in: 5184000
          }
        };
      }
      if (url.endsWith("/me/accounts")) {
        return { data: { data: paginas } };
      }
      throw new Error(`url_inesperada:${url}`);
    }
  };
}

(async () => {
  assert.ok(facebook.scopesConexaoMeta().includes("public_profile"));
  assert.ok(facebook.scopesConexaoMeta().includes("pages_show_list"));
  assert.ok(facebook.scopesConexaoMeta().includes("pages_read_engagement"));
  assert.ok(facebook.scopesConexaoMeta().includes("instagram_basic"));
  assert.ok(facebook.scopesConexaoMeta().includes("instagram_manage_comments"));
  assert.ok(facebook.scopesConexaoMeta().includes("pages_messaging"));

  const logsOriginais = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const inicio = facebook.iniciarConexaoMeta({
      clienteId: "user_meta_unico",
      redirectUri: process.env.META_REDIRECT_URI
    });
    const http = mockHttpClient([
      paginaMeta({
        id: "page_unica",
        token: "page_token_unico",
        iba: "iba_unica",
        username: "optimus_ig"
      })
    ]);
    const resultado = await facebook.concluirCallbackMeta({
      code: "code_meta_unico",
      state: inicio.state,
      redirectUri: process.env.META_REDIRECT_URI,
      httpClient: http
    });
    const salvo = storage.setConexaoMetaSocial(resultado.clienteId, resultado);

    assert.strictEqual(salvo.facebook.pageId, "page_unica");
    assert.strictEqual(salvo.facebook.pageAccessToken, "page_token_unico");
    assert.strictEqual(salvo.instagram.instagramBusinessAccountId, "iba_unica");
    assert.strictEqual(salvo.instagram.username, "optimus_ig");
    assert.strictEqual(salvo.paginas.length, 1);
    assert.strictEqual(salvo.paginas[0].accessToken, "page_token_unico");
    assert.strictEqual(salvo.paginas[0].instagramBusinessAccountId, "iba_unica");
    assert.strictEqual(salvo.paginas[0].conectado, true);

    const chamadaAccounts = http.chamadas.find(chamada => chamada.url.endsWith("/me/accounts"));
    assert.ok(chamadaAccounts, "/me/accounts deve ser consultado");
    assert.strictEqual(
      chamadaAccounts.params.fields,
      "id,name,username,access_token,instagram_business_account{id,username,name}"
    );

    const ativosMultiplos = await facebook.consultarAtivosMeta({
      clienteId: "user_meta_multi",
      accessToken: "meta_user_token_multi",
      httpClient: mockHttpClient([
        paginaMeta({ id: "page_a", token: "page_token_a", iba: "iba_a" }),
        paginaMeta({ id: "page_b", token: "page_token_b", iba: "iba_b" })
      ])
    });
    assert.strictEqual(ativosMultiplos.paginas.length, 2);
    assert.strictEqual(ativosMultiplos.paginas.filter(pagina => pagina.conectado).length, 0);

    const ativosSelecaoAtual = await facebook.consultarAtivosMeta({
      clienteId: "user_meta_multi",
      accessToken: "meta_user_token_multi",
      selecaoAtual: { pageId: "page_b" },
      httpClient: mockHttpClient([
        paginaMeta({ id: "page_a", token: "page_token_a", iba: "iba_a" }),
        paginaMeta({ id: "page_b", token: "page_token_b", iba: "iba_b" })
      ])
    });
    assert.strictEqual(ativosSelecaoAtual.paginas.find(pagina => pagina.id === "page_b").conectado, true);
    assert.strictEqual(ativosSelecaoAtual.paginas.find(pagina => pagina.id === "page_a").conectado, false);
  } finally {
    console.log = logsOriginais;
  }

  const logsTexto = logs.join("\n");
  assert.ok(logsTexto.includes("[INSTAGRAM-META-ATIVOS-DESCOBERTOS]"));
  assert.ok(!logsTexto.includes("page_token_unico"));
  assert.ok(!logsTexto.includes("page_token_a"));
  assert.ok(!logsTexto.includes("page_token_b"));

  console.log("social-meta-ativos-messaging: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
