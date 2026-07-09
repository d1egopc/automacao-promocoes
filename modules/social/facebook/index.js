const axios = require("axios");
const crypto = require("crypto");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_SCOPES_LOGIN_INICIAL = [
  "public_profile",
  "email"
];
const META_SCOPES_PUBLICACAO_FUTURA = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish"
];

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clienteIdSeguro(clienteId = "admin") {
  const valor = texto(clienteId || "admin");
  if (!/^(admin|user_[a-zA-Z0-9_-]+)$/.test(valor)) {
    throw new Error("clienteId_invalido");
  }
  return valor;
}

function appIdMeta() {
  return texto(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
}

function appSecretMeta() {
  return texto(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
}

function redirectUriMeta(valor = "") {
  return texto(valor || process.env.META_REDIRECT_URI || process.env.FACEBOOK_REDIRECT_URI);
}

function segredoStateMeta() {
  return texto(process.env.META_OAUTH_STATE_SECRET || appSecretMeta() || "social-meta-state-local");
}

function base64UrlJson(dados = {}) {
  return Buffer.from(JSON.stringify(dados)).toString("base64url");
}

function assinarEstado(payload = "") {
  return crypto
    .createHmac("sha256", segredoStateMeta())
    .update(payload)
    .digest("base64url");
}

function criarStateMeta(clienteId = "admin") {
  const payload = base64UrlJson({
    clienteId: clienteIdSeguro(clienteId),
    nonce: crypto.randomBytes(12).toString("hex"),
    exp: Date.now() + 15 * 60 * 1000
  });
  return `${payload}.${assinarEstado(payload)}`;
}

function validarStateMeta(state = "") {
  const [payload, assinatura] = texto(state).split(".");
  if (!payload || !assinatura) {
    throw new Error("state_invalido");
  }

  const assinaturaEsperada = assinarEstado(payload);
  const assinaturaBuffer = Buffer.from(assinatura);
  const esperadaBuffer = Buffer.from(assinaturaEsperada);

  if (
    assinaturaBuffer.length !== esperadaBuffer.length ||
    !crypto.timingSafeEqual(assinaturaBuffer, esperadaBuffer)
  ) {
    throw new Error("state_assinatura_invalida");
  }

  const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!dados?.clienteId || Number(dados.exp || 0) < Date.now()) {
    throw new Error("state_expirado");
  }

  return {
    clienteId: clienteIdSeguro(dados.clienteId),
    exp: dados.exp
  };
}

function iniciarConexaoMeta({ clienteId = "admin", redirectUri = "" } = {}) {
  const appId = appIdMeta();
  const uri = redirectUriMeta(redirectUri);

  if (!appId) throw new Error("meta_app_id_ausente");
  if (!uri) throw new Error("meta_redirect_uri_ausente");

  const state = criarStateMeta(clienteId);
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: uri,
    state,
    response_type: "code",
    scope: META_SCOPES_LOGIN_INICIAL.join(",")
  });

  return {
    ok: true,
    provider: "meta",
    status: "oauth_iniciado",
    authUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
    state,
    redirectUri: uri,
    scopes: META_SCOPES_LOGIN_INICIAL,
    scopesFuturos: META_SCOPES_PUBLICACAO_FUTURA
  };
}

function calcularExpiracao(expiresIn) {
  const segundos = Number(expiresIn || 0);
  if (!Number.isFinite(segundos) || segundos <= 0) return "";
  return new Date(Date.now() + segundos * 1000).toISOString();
}

async function trocarCodePorToken({ code = "", redirectUri = "", httpClient = axios } = {}) {
  const appId = appIdMeta();
  const appSecret = appSecretMeta();
  const uri = redirectUriMeta(redirectUri);

  if (!appId) throw new Error("meta_app_id_ausente");
  if (!appSecret) throw new Error("meta_app_secret_ausente");
  if (!uri) throw new Error("meta_redirect_uri_ausente");
  if (!texto(code)) throw new Error("code_obrigatorio");

  const resposta = await httpClient.get(`${GRAPH_BASE}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: uri,
      code
    },
    timeout: 10000
  });

  const dados = resposta?.data || {};
  if (!dados.access_token) throw new Error("meta_token_nao_retornado");
  return dados;
}

async function listarPaginasMeta({ accessToken = "", httpClient = axios } = {}) {
  if (!texto(accessToken)) return [];

  const resposta = await httpClient.get(`${GRAPH_BASE}/me/accounts`, {
    params: {
      access_token: accessToken,
      fields: "id,name,username,access_token,instagram_business_account{id,username,name}"
    },
    timeout: 10000
  });

  return Array.isArray(resposta?.data?.data) ? resposta.data.data : [];
}

function normalizarPaginasMeta(paginas = []) {
  return (Array.isArray(paginas) ? paginas : []).map((pagina, index) => ({
    id: texto(pagina.id),
    name: texto(pagina.name),
    username: texto(pagina.username),
    accessToken: texto(pagina.access_token),
    instagramBusinessAccountId: texto(pagina.instagram_business_account?.id),
    instagramUsername: texto(pagina.instagram_business_account?.username),
    instagramName: texto(pagina.instagram_business_account?.name),
    conectado: index === 0
  })).filter(pagina => pagina.id);
}

async function concluirCallbackMeta({ code = "", state = "", redirectUri = "", httpClient = axios } = {}) {
  const estado = validarStateMeta(state);
  const token = await trocarCodePorToken({ code, redirectUri, httpClient });
  const paginas = normalizarPaginasMeta(await listarPaginasMeta({
    accessToken: token.access_token,
    httpClient
  }));
  const paginaPrincipal = paginas[0] || {};

  return {
    clienteId: estado.clienteId,
    status: "conectado",
    conectado: true,
    token: {
      accessToken: texto(token.access_token),
      tokenType: texto(token.token_type || "bearer"),
      expiresIn: token.expires_in ?? null,
      expiresAt: calcularExpiracao(token.expires_in),
      recebidoEm: new Date().toISOString()
    },
    facebook: {
      conectado: Boolean(paginaPrincipal.id),
      pageId: texto(paginaPrincipal.id),
      pageName: texto(paginaPrincipal.name),
      pageUsername: texto(paginaPrincipal.username)
    },
    instagram: {
      conectado: Boolean(paginaPrincipal.instagramBusinessAccountId),
      instagramBusinessAccountId: texto(paginaPrincipal.instagramBusinessAccountId),
      username: texto(paginaPrincipal.instagramUsername),
      name: texto(paginaPrincipal.instagramName)
    },
    paginas
  };
}

function criarAdaptadorFacebook() {
  return {
    rede: "facebook",
    publicarImplementado: false,
    oauthImplementado: true,
    status: "estrutura_pronta"
  };
}

module.exports = {
  criarAdaptadorFacebook,
  concluirCallbackMeta,
  iniciarConexaoMeta,
  validarStateMeta
};
