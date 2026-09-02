"use strict";

const assert = require("assert");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-platform-vars-"));

const facebook = require("../modules/social/facebook");
const instagram = require("../modules/social/instagram");
const criarRotasSocial = require("../modules/social/routes");
const {
  obterConfigMetaAsync,
  obterConfigInstagramAsync,
  obterInstagramWebhookVerifyTokenAsync,
  obterVariavelSocial
} = require("../modules/social/platform-config");

function criarResolvedor(valores = {}, chamadas = []) {
  return async function getPlatformVariableImpl(nome, options = {}) {
    chamadas.push({ nome, options });
    if (Object.prototype.hasOwnProperty.call(valores, nome)) {
      return {
        ok: true,
        source: "platform_variables",
        nome,
        value: valores[nome]
      };
    }
    return {
      ok: false,
      source: "missing",
      nome,
      value: null
    };
  };
}

function assinaturaSha256(rawBody, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function mockMetaHttp() {
  const chamadas = [];
  return {
    chamadas,
    async get(url, config = {}) {
      chamadas.push({ metodo: "get", url, params: config.params || {} });
      if (url.endsWith("/oauth/access_token")) {
        return {
          status: 200,
          data: {
            access_token: "meta_user_token_teste",
            token_type: "bearer",
            expires_in: 5184000
          }
        };
      }
      if (url.endsWith("/me/permissions")) {
        return {
          status: 200,
          data: {
            data: [
              { permission: "pages_show_list", status: "granted" },
              { permission: "pages_read_engagement", status: "granted" }
            ]
          }
        };
      }
      if (url.endsWith("/me/accounts")) {
        return {
          status: 200,
          data: {
            data: [{
              id: "page_panel",
              name: "Pagina Panel",
              username: "pagina_panel",
              access_token: "page_token_panel"
            }]
          }
        };
      }
      throw new Error(`url_meta_inesperada:${url}`);
    }
  };
}

function mockInstagramHttp() {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body, config = {}) {
      chamadas.push({ metodo: "post", url, body, config });
      if (url.endsWith("/subscribed_apps")) {
        return { status: 200, data: { success: true } };
      }
      return {
        status: 200,
        data: {
          access_token: "short_panel",
          token_type: "bearer",
          user_id: "ig_panel"
        }
      };
    },
    async get(url, config = {}) {
      chamadas.push({ metodo: "get", url, params: config.params || {} });
      if (url.endsWith("/access_token")) {
        return {
          status: 200,
          data: {
            access_token: "long_panel",
            token_type: "bearer",
            expires_in: 5184000
          }
        };
      }
      if (url.endsWith("/me")) {
        return {
          status: 200,
          data: {
            user_id: "ig_panel",
            username: "optimus_panel",
            account_type: "BUSINESS",
            profile_picture_url: "https://cdn.optimus.test/ig.jpg"
          }
        };
      }
      if (url.endsWith("/subscribed_apps")) {
        return {
          status: 200,
          data: {
            data: [{ subscribed_fields: ["comments", "messages"] }]
          }
        };
      }
      throw new Error(`url_instagram_inesperada:${url}`);
    }
  };
}

async function request(app, metodo, url) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: url,
        method: metodo
      }, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body });
        });
      });
      req.end();
    });
  });
}

(async () => {
  const env = {
    META_APP_ID: "meta_env",
    META_APP_SECRET: "meta_secret_env",
    META_REDIRECT_URI: "https://api.env.test/social/meta/callback",
    INSTAGRAM_APP_ID: "ig_env",
    INSTAGRAM_APP_SECRET: "ig_secret_env",
    INSTAGRAM_OAUTH_STATE_SECRET: "ig_state_env",
    INSTAGRAM_REDIRECT_URI: "https://api.env.test/social/instagram/callback",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify_env"
  };
  const valoresPanel = {
    META_APP_ID: "meta_panel",
    META_APP_SECRET: "meta_secret_panel",
    META_REDIRECT_URI: "https://api.panel.test/social/meta/callback",
    INSTAGRAM_APP_ID: "ig_panel",
    INSTAGRAM_APP_SECRET: "ig_secret_panel",
    INSTAGRAM_OAUTH_STATE_SECRET: "ig_state_panel",
    INSTAGRAM_REDIRECT_URI: "https://api.panel.test/social/instagram/callback",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify_panel"
  };
  const chamadas = [];
  const getPlatformVariableImpl = criarResolvedor(valoresPanel, chamadas);

  const configMeta = await obterConfigMetaAsync({ env, getPlatformVariableImpl });
  assert.deepStrictEqual(configMeta, {
    appId: "meta_panel",
    appSecret: "meta_secret_panel",
    redirectUri: "https://api.panel.test/social/meta/callback"
  }, "Meta usa Platform Variables com precedencia sobre ENV");

  const configInstagram = await obterConfigInstagramAsync({ env, getPlatformVariableImpl });
  assert.strictEqual(configInstagram.appId, "ig_panel", "Instagram app id vem do painel");
  assert.strictEqual(configInstagram.appSecret, "ig_secret_panel", "Instagram app secret vem do painel");
  assert.strictEqual(configInstagram.oauthStateSecret, "ig_state_panel", "Instagram state secret vem do painel");
  assert.strictEqual(configInstagram.redirectUri, "https://api.panel.test/social/instagram/callback", "Instagram redirect HTTPS vem do painel");
  assert.strictEqual(configInstagram.webhookVerifyToken, "verify_panel", "Instagram webhook verify token vem do painel");
  assert.strictEqual(configInstagram.metaAppSecret, "meta_secret_panel", "Webhook Instagram pode usar META_APP_SECRET do painel");

  const configMetaEnv = await obterConfigMetaAsync({ env, getPlatformVariableImpl: criarResolvedor({}) });
  assert.strictEqual(configMetaEnv.appId, "meta_env", "Meta cai para ENV quando painel ausente");
  assert.strictEqual(configMetaEnv.appSecret, "meta_secret_env");
  assert.strictEqual(configMetaEnv.redirectUri, "https://api.env.test/social/meta/callback");

  const configInstagramSemNada = await obterConfigInstagramAsync({
    env: {},
    getPlatformVariableImpl: criarResolvedor({})
  });
  assert.deepStrictEqual(configInstagramSemNada, {
    appId: "",
    appSecret: "",
    oauthStateSecret: "",
    redirectUri: "",
    webhookVerifyToken: "",
    metaAppSecret: ""
  }, "ausencia de painel e ENV mantem default seguro vazio");

  const redirectInvalido = await obterConfigMetaAsync({
    env: { META_REDIRECT_URI: "http://inseguro.test/callback" },
    getPlatformVariableImpl: criarResolvedor({ META_REDIRECT_URI: "http://inseguro.test/callback" })
  });
  assert.strictEqual(redirectInvalido.redirectUri, "", "redirect URI nao HTTPS e rejeitada");
  await assert.rejects(
    () => obterVariavelSocial("GOOGLE_CLIENT_ID", { env, getPlatformVariableImpl }),
    /social_platform_variable_nao_homologada/,
    "allowlist impede variavel arbitraria"
  );

  const inicioMeta = await facebook.iniciarConexaoMetaAsync({
    clienteId: "user_meta_panel",
    env,
    getPlatformVariableImpl
  });
  assert.ok(inicioMeta.authUrl.includes("client_id=meta_panel"), "Meta OAuth usa app id do painel");
  assert.ok(inicioMeta.authUrl.includes(encodeURIComponent("https://api.panel.test/social/meta/callback")), "Meta OAuth usa redirect do painel");
  assert.ok(!inicioMeta.authUrl.includes("meta_secret_panel"), "Meta secret nao entra na URL");
  const metaHttp = mockMetaHttp();
  await facebook.concluirCallbackMeta({
    code: "code_panel",
    state: inicioMeta.state,
    httpClient: metaHttp,
    env,
    getPlatformVariableImpl
  });
  const tokenMeta = metaHttp.chamadas.find(chamada => chamada.url.endsWith("/oauth/access_token"));
  assert.strictEqual(tokenMeta.params.client_id, "meta_panel", "troca de token Meta usa app id do painel");
  assert.strictEqual(tokenMeta.params.client_secret, "meta_secret_panel", "troca de token Meta usa secret do painel");
  assert.strictEqual(tokenMeta.params.redirect_uri, "https://api.panel.test/social/meta/callback", "troca Meta usa redirect do painel");

  const inicioMetaRuntime = await facebook.iniciarConexaoMetaAsync({
    clienteId: "user_meta_panel",
    env,
    getPlatformVariableImpl: criarResolvedor({
      ...valoresPanel,
      META_APP_ID: "meta_panel_runtime",
      META_REDIRECT_URI: "https://api.runtime.test/social/meta/callback"
    })
  });
  assert.ok(inicioMetaRuntime.authUrl.includes("client_id=meta_panel_runtime"), "Meta reflete mudanca runtime sem reload de modulo");
  assert.ok(inicioMetaRuntime.authUrl.includes(encodeURIComponent("https://api.runtime.test/social/meta/callback")));

  const inicioInstagram = await instagram.iniciarConexaoInstagramAsync({
    clienteId: "user_ig_panel",
    env,
    getPlatformVariableImpl
  });
  assert.ok(inicioInstagram.authUrl.includes("client_id=ig_panel"), "Instagram OAuth usa app id do painel");
  assert.ok(inicioInstagram.authUrl.includes(encodeURIComponent("https://api.panel.test/social/instagram/callback")), "Instagram OAuth usa redirect do painel");
  assert.ok(!inicioInstagram.authUrl.includes("ig_secret_panel"), "Instagram secret nao entra na URL");
  const igHttp = mockInstagramHttp();
  await instagram.concluirCallbackInstagram({
    code: "code_ig_panel",
    state: inicioInstagram.state,
    httpClient: igHttp,
    env,
    getPlatformVariableImpl
  });
  const tokenCurto = igHttp.chamadas.find(chamada => chamada.metodo === "post" && chamada.url.endsWith("/oauth/access_token"));
  assert.ok(String(tokenCurto.body).includes("client_id=ig_panel"), "token curto Instagram usa app id do painel");
  assert.ok(String(tokenCurto.body).includes("client_secret=ig_secret_panel"), "token curto Instagram usa secret do painel");
  assert.ok(String(tokenCurto.body).includes(encodeURIComponent("https://api.panel.test/social/instagram/callback")), "token curto Instagram usa redirect do painel");
  const tokenLongo = igHttp.chamadas.find(chamada => chamada.metodo === "get" && chamada.url.endsWith("/access_token"));
  assert.strictEqual(tokenLongo.params.client_secret, "ig_secret_panel", "token longo Instagram usa secret do painel");

  const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
  const assinaturaPanel = assinaturaSha256(rawBody, "meta_secret_panel");
  const assinaturaEnv = assinaturaSha256(rawBody, "meta_secret_env");
  assert.strictEqual(
    await instagram.validarAssinaturaWebhookInstagramAsync({ assinatura: assinaturaPanel, rawBody, env, getPlatformVariableImpl }),
    true,
    "webhook aceita assinatura com secret vindo do painel"
  );
  assert.strictEqual(
    await instagram.validarAssinaturaWebhookInstagramAsync({ assinatura: assinaturaEnv, rawBody, env, getPlatformVariableImpl }),
    false,
    "webhook nao deixa ENV prevalecer sobre painel"
  );

  assert.strictEqual(
    await obterInstagramWebhookVerifyTokenAsync({ env, getPlatformVariableImpl }),
    "verify_panel",
    "verify token do webhook vem do painel"
  );
  assert.strictEqual(
    await obterInstagramWebhookVerifyTokenAsync({ env, getPlatformVariableImpl: criarResolvedor({}) }),
    "verify_env",
    "verify token cai para ENV quando painel ausente"
  );

  const app = express();
  app.use((req, _res, next) => {
    req.usuario = { papel: "admin_master" };
    next();
  });
  app.use("/social", criarRotasSocial({
    getClienteId: () => "user_rota_panel",
    usuarioTemRecurso: () => true,
    env,
    getPlatformVariableImpl
  }));
  const webhookOk = await request(app, "GET", "/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify_panel&hub.challenge=ok-panel");
  assert.strictEqual(webhookOk.status, 200, "rota webhook usa verify token do painel");
  assert.strictEqual(webhookOk.body, "ok-panel");
  const webhookEnvRejeitado = await request(app, "GET", "/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify_env&hub.challenge=erro");
  assert.strictEqual(webhookEnvRejeitado.status, 403, "rota webhook rejeita ENV quando painel existe");

  const logs = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    await instagram.validarAssinaturaWebhookInstagramAsync({ assinatura: assinaturaPanel, rawBody, env, getPlatformVariableImpl });
  } finally {
    console.log = originais.log;
    console.warn = originais.warn;
    console.error = originais.error;
  }
  const logsSerializados = logs.join("\n");
  for (const segredo of ["meta_secret_panel", "ig_secret_panel", "ig_state_panel", "verify_panel"]) {
    assert.ok(!logsSerializados.includes(segredo), `log nao expoe ${segredo}`);
  }

  assert.ok(chamadas.some(chamada => chamada.nome === "META_APP_ID"), "resolvedor consultou Meta");
  assert.ok(chamadas.some(chamada => chamada.nome === "INSTAGRAM_WEBHOOK_VERIFY_TOKEN"), "resolvedor consultou verify token");

  console.log("social-platform-variables-meta-instagram.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
