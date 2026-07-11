const crypto = require("crypto");
const {
  readClienteJson,
  writeClienteJson
} = require("../../../utils/storage");
const { logSocial } = require("../logs");

const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
const ARQUIVO_INSTAGRAM = "social-instagram.json";
const SCOPE_BASICO = "instagram_business_basic";
const STATE_TTL_MS = 15 * 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

async function httpFetchPadrao(url, opcoes = {}) {
  if (typeof fetch !== "function") {
    throw new Error("fetch_indisponivel");
  }

  const resposta = await fetch(url, opcoes);
  const data = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(data?.error?.message || data?.message || `http_${resposta.status}`);
    erro.response = {
      status: resposta.status,
      data
    };
    throw erro;
  }
  return { data };
}

function httpClientPadrao() {
  return {
    async post(url, body, config = {}) {
      return httpFetchPadrao(url, {
        method: "POST",
        headers: config.headers || {},
        body
      });
    },
    async get(url, config = {}) {
      const destino = new URL(url);
      for (const [chave, valor] of Object.entries(config.params || {})) {
        destino.searchParams.set(chave, valor);
      }
      return httpFetchPadrao(destino.toString(), {
        method: "GET",
        headers: config.headers || {}
      });
    }
  };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function agoraIso() {
  return new Date().toISOString();
}

function appIdInstagram() {
  return texto(process.env.INSTAGRAM_APP_ID);
}

function appSecretInstagram() {
  return texto(process.env.INSTAGRAM_APP_SECRET);
}

function redirectUriInstagram(valor = "") {
  return texto(valor || process.env.INSTAGRAM_REDIRECT_URI);
}

function segredoStateInstagram() {
  return texto(process.env.INSTAGRAM_OAUTH_STATE_SECRET || appSecretInstagram() || "social-instagram-state-local");
}

function criarInstagramPadrao(clienteId = "admin") {
  return {
    clienteId,
    status: "desconectado",
    conectado: false,
    instagramUserId: "",
    username: "",
    accountType: "",
    profilePictureUrl: "",
    token: {
      accessToken: "",
      tokenType: "bearer",
      expiresAt: "",
      recebidoEm: ""
    },
    scopes: [],
    oauthStates: {},
    atualizadoEm: agoraIso()
  };
}

function calcularExpiresAt(expiresIn) {
  const segundos = Number(expiresIn || 0);
  if (!Number.isFinite(segundos) || segundos <= 0) return "";
  return new Date(Date.now() + segundos * 1000).toISOString();
}

function base64UrlJson(dados = {}) {
  return Buffer.from(JSON.stringify(dados)).toString("base64url");
}

function assinarState(payload = "") {
  return crypto
    .createHmac("sha256", segredoStateInstagram())
    .update(payload)
    .digest("base64url");
}

function gerarStateInstagram(clienteId = "admin") {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = base64UrlJson({
    clienteId: texto(clienteId || "admin"),
    nonce,
    exp: Date.now() + STATE_TTL_MS
  });
  return {
    nonce,
    state: `${payload}.${assinarState(payload)}`
  };
}

function decodificarStateInstagram(state = "") {
  const [payload, assinatura] = texto(state).split(".");
  if (!payload || !assinatura) throw new Error("state_invalido");

  const esperada = assinarState(payload);
  const recebidaBuffer = Buffer.from(assinatura);
  const esperadaBuffer = Buffer.from(esperada);
  if (
    recebidaBuffer.length !== esperadaBuffer.length ||
    !crypto.timingSafeEqual(recebidaBuffer, esperadaBuffer)
  ) {
    throw new Error("state_invalido");
  }

  let dados;
  try {
    dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("state_invalido");
  }
  if (!dados?.clienteId || !dados?.nonce) throw new Error("state_invalido");
  if (Number(dados.exp || 0) < Date.now()) throw new Error("state_expirado");

  return {
    clienteId: texto(dados.clienteId),
    nonce: texto(dados.nonce),
    exp: Number(dados.exp || 0)
  };
}

function lerConexaoInstagram(clienteId = "admin") {
  const padrao = criarInstagramPadrao(clienteId);
  const dados = readClienteJson(clienteId, ARQUIVO_INSTAGRAM, padrao);
  const token = dados.token && typeof dados.token === "object" ? dados.token : {};
  const accessToken = texto(token.accessToken || dados.accessToken);

  return {
    ...padrao,
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    status: accessToken ? "conectado" : "desconectado",
    conectado: Boolean(accessToken),
    instagramUserId: texto(dados.instagramUserId || dados.userId || dados.id),
    username: texto(dados.username),
    accountType: texto(dados.accountType || dados.account_type),
    profilePictureUrl: texto(dados.profilePictureUrl || dados.profile_picture_url),
    token: {
      ...padrao.token,
      ...token,
      accessToken
    },
    scopes: lista(dados.scopes).map(texto).filter(Boolean),
    oauthStates: dados.oauthStates && typeof dados.oauthStates === "object" ? dados.oauthStates : {},
    atualizadoEm: texto(dados.atualizadoEm || agoraIso())
  };
}

function salvarConexaoInstagram(clienteId = "admin", dados = {}) {
  const atualizada = {
    ...criarInstagramPadrao(clienteId),
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    atualizadoEm: agoraIso()
  };

  writeClienteJson(clienteId, ARQUIVO_INSTAGRAM, atualizada);
  return lerConexaoInstagram(clienteId);
}

function sanitizarConexaoInstagram(conexao = {}) {
  return {
    conectado: conexao.conectado === true,
    instagramUserId: texto(conexao.instagramUserId),
    username: texto(conexao.username),
    accountType: texto(conexao.accountType),
    profilePictureUrl: texto(conexao.profilePictureUrl),
    tokenPresente: Boolean(texto(conexao.token?.accessToken)),
    expiresAt: texto(conexao.token?.expiresAt),
    scopes: lista(conexao.scopes).map(texto).filter(Boolean)
  };
}

function removerStatesExpirados(states = {}) {
  const agora = Date.now();
  return Object.fromEntries(
    Object.entries(states || {}).filter(([, state]) => {
      const exp = Number(state?.exp || 0);
      return exp && exp >= agora;
    })
  );
}

function registrarStatePendente(clienteId = "admin", nonce = "", exp = 0) {
  const atual = lerConexaoInstagram(clienteId);
  const oauthStates = removerStatesExpirados(atual.oauthStates);
  oauthStates[nonce] = {
    status: "pendente",
    exp,
    criadoEm: agoraIso()
  };
  salvarConexaoInstagram(clienteId, {
    ...atual,
    oauthStates
  });
}

function consumirStatePendente(clienteId = "admin", nonce = "") {
  const atual = lerConexaoInstagram(clienteId);
  const oauthStates = removerStatesExpirados(atual.oauthStates);
  const state = oauthStates[nonce];
  if (!state) throw new Error("instagram_state_replay_ou_ausente");
  if (state.status !== "pendente") throw new Error("instagram_state_reutilizado");
  oauthStates[nonce] = {
    ...state,
    status: "usado",
    usadoEm: agoraIso()
  };
  salvarConexaoInstagram(clienteId, {
    ...atual,
    oauthStates
  });
}

function scopesInstagramConexao() {
  return [SCOPE_BASICO];
}

function iniciarConexaoInstagram({ clienteId = "admin", redirectUri = "" } = {}) {
  const appId = appIdInstagram();
  const uri = redirectUriInstagram(redirectUri);
  if (!appId || !appSecretInstagram() || !uri) throw new Error("instagram_nao_configurado");

  const { nonce, state } = gerarStateInstagram(clienteId);
  const { exp } = decodificarStateInstagram(state);
  registrarStatePendente(clienteId, nonce, exp);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: uri,
    response_type: "code",
    scope: scopesInstagramConexao().join(","),
    force_reauth: "true",
    state
  });

  return {
    ok: true,
    provider: "instagram",
    status: "oauth_iniciado",
    authUrl: `${INSTAGRAM_AUTH_URL}?${params.toString()}`,
    redirectUri: uri,
    state,
    scopes: scopesInstagramConexao()
  };
}

function normalizarToken(dados = {}) {
  return {
    accessToken: texto(dados.access_token),
    tokenType: texto(dados.token_type || "bearer"),
    expiresAt: calcularExpiresAt(dados.expires_in),
    recebidoEm: agoraIso()
  };
}

async function trocarCodePorTokenCurto({ code = "", redirectUri = "", httpClient = httpClientPadrao() } = {}) {
  const appId = appIdInstagram();
  const appSecret = appSecretInstagram();
  const uri = redirectUriInstagram(redirectUri);
  if (!appId || !appSecret || !uri) throw new Error("instagram_nao_configurado");
  if (!texto(code)) throw new Error("code_ausente");

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: uri,
    code
  });
  try {
    const resposta = await httpClient.post(INSTAGRAM_TOKEN_URL, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    if (!dados.access_token) throw new Error("token_curto_nao_retornado");
    return dados;
  } catch {
    throw new Error("troca_token_falhou");
  }
}

async function trocarTokenLongaDuracao({ accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const appSecret = appSecretInstagram();
  if (!appSecret) throw new Error("instagram_nao_configurado");
  if (!texto(accessToken)) throw new Error("troca_token_falhou");

  try {
    const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/access_token`, {
      params: {
        grant_type: "ig_exchange_token",
        client_secret: appSecret,
        access_token: accessToken
      },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    if (!dados.access_token) throw new Error("token_longo_nao_retornado");
    return dados;
  } catch {
    throw new Error("troca_token_falhou");
  }
}

async function consultarContaInstagram({ accessToken = "", httpClient = httpClientPadrao() } = {}) {
  if (!texto(accessToken)) throw new Error("consulta_conta_falhou");

  try {
    const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/me`, {
      params: {
        fields: "user_id,username,account_type,profile_picture_url",
        access_token: accessToken
      },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    const instagramUserId = texto(dados.user_id || dados.id);
    if (!instagramUserId) throw new Error("me_id_nao_retornado");

    return {
      instagramUserId,
      username: texto(dados.username),
      accountType: texto(dados.account_type),
      profilePictureUrl: texto(dados.profile_picture_url)
    };
  } catch {
    throw new Error("consulta_conta_falhou");
  }
}

async function concluirCallbackInstagram({ code = "", state = "", redirectUri = "", httpClient = httpClientPadrao() } = {}) {
  if (!texto(code)) throw new Error("code_ausente");

  const estado = decodificarStateInstagram(state);
  consumirStatePendente(estado.clienteId, estado.nonce);
  const uri = redirectUriInstagram(redirectUri);
  const tokenCurto = await trocarCodePorTokenCurto({ code, redirectUri: uri, httpClient });
  const tokenLongo = await trocarTokenLongaDuracao({
    accessToken: tokenCurto.access_token,
    httpClient
  });
  const token = normalizarToken(tokenLongo);
  const conta = await consultarContaInstagram({
    accessToken: token.accessToken,
    httpClient
  });

  const conexao = salvarConexaoInstagram(estado.clienteId, {
    status: "conectado",
    conectado: true,
    ...conta,
    token,
    scopes: scopesInstagramConexao(),
    oauthStates: lerConexaoInstagram(estado.clienteId).oauthStates
  });

  logSocial("[SOCIAL-INSTAGRAM-OAUTH-CONECTADO]", {
    clienteId: estado.clienteId,
    instagramUserId: conta.instagramUserId,
    username: conta.username,
    tokenPresente: Boolean(token.accessToken),
    expiresAt: token.expiresAt,
    scopes: scopesInstagramConexao()
  });

  return conexao;
}

function limparConexaoInstagram(clienteId = "admin") {
  const atual = lerConexaoInstagram(clienteId);
  return salvarConexaoInstagram(clienteId, {
    ...criarInstagramPadrao(clienteId),
    oauthStates: atual.oauthStates
  });
}

function criarAdaptadorInstagram() {
  return {
    rede: "instagram",
    publicarImplementado: false,
    oauthImplementado: true,
    loginDiretoImplementado: true,
    status: "fase_a_instagram_login_direto"
  };
}

module.exports = {
  ARQUIVO_INSTAGRAM,
  INSTAGRAM_AUTH_URL,
  INSTAGRAM_GRAPH_BASE,
  SCOPE_BASICO,
  criarAdaptadorInstagram,
  criarInstagramPadrao,
  iniciarConexaoInstagram,
  concluirCallbackInstagram,
  lerConexaoInstagram,
  limparConexaoInstagram,
  sanitizarConexaoInstagram,
  decodificarStateInstagram,
  scopesInstagramConexao
};
