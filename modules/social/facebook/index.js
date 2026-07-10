const axios = require("axios");
const crypto = require("crypto");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_SCOPES_CONEXAO_PADRAO = [
  "public_profile"
];
const META_SCOPES_ATIVOS_PADRAO = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic"
];
const META_SCOPES_PUBLICACAO_FUTURA = [
  "pages_manage_posts",
  "instagram_content_publish"
];

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function listaScopes(valor = "", fallback = []) {
  const itens = texto(valor)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return itens.length ? itens : fallback;
}

function scopesConexaoMeta() {
  return listaScopes(process.env.META_SCOPES_CONEXAO, [
    ...META_SCOPES_CONEXAO_PADRAO,
    ...META_SCOPES_ATIVOS_PADRAO
  ]);
}

function scopesPublicacaoFuturaMeta() {
  return listaScopes(process.env.META_SCOPES_PUBLICACAO_FUTURA, META_SCOPES_PUBLICACAO_FUTURA);
}

function clienteIdSeguro(clienteId = "admin") {
  const valor = texto(clienteId || "admin");
  if (!/^(admin|user_[a-zA-Z0-9_-]+)$/.test(valor)) {
    throw new Error("clienteId_invalido");
  }
  return valor;
}

function appIdMeta() {
  return texto(process.env.META_APP_ID);
}

function appSecretMeta() {
  return texto(process.env.META_APP_SECRET);
}

function redirectUriMeta(valor = "") {
  return texto(valor || process.env.META_REDIRECT_URI);
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

function codeFinal(code = "") {
  return texto(code).slice(-6);
}

function erroMetaSeguro(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  const mensagem = texto(metaErro.message || erro?.message || "meta_token_erro");

  return {
    statusHttp: erro?.response?.status || "",
    type: texto(metaErro.type),
    code: metaErro.code ?? "",
    errorSubcode: metaErro.error_subcode ?? "",
    message: mensagem.slice(0, 300)
  };
}

function logMetaSeguro(tag, payload = {}) {
  console.log(tag, JSON.stringify(payload || {}));
}

function mascararValorExato(valor, sensiveis = []) {
  if (typeof valor === "string") {
    return sensiveis.reduce((textoAtual, sensivel) => {
      const alvo = texto(sensivel);
      return alvo ? textoAtual.split(alvo).join("[MASCARADO]") : textoAtual;
    }, valor);
  }

  if (Array.isArray(valor)) {
    return valor.map(item => mascararValorExato(item, sensiveis));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [
        chave,
        mascararValorExato(item, sensiveis)
      ])
    );
  }

  return valor;
}

function logRespostaMetaTokenBruta(resposta = {}, contexto = {}) {
  const sensiveis = [contexto.code, contexto.appSecret].filter(Boolean);

  logMetaSeguro("[SOCIAL-META-TOKEN-RAW-RESPONSE]", {
    request: {
      url: `${GRAPH_BASE}/oauth/access_token`,
      client_id: contexto.appId || "",
      redirect_uri: contexto.redirectUri || "",
      grant_type: contexto.grantType || "",
      code: contexto.code ? "[MASCARADO]" : "",
      client_secret: contexto.appSecret ? "[MASCARADO]" : ""
    },
    response: {
      status: resposta?.status || "",
      data: mascararValorExato(resposta?.data ?? null, sensiveis),
      headers: mascararValorExato(resposta?.headers || {}, sensiveis)
    }
  });
}

function criarStateMeta(clienteId = "admin", redirectUri = "") {
  const payload = base64UrlJson({
    clienteId: clienteIdSeguro(clienteId),
    redirectUri: redirectUriMeta(redirectUri),
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

  const clienteId = clienteIdSeguro(dados.clienteId);
  logMetaSeguro("[SOCIAL-META-STATE-CLIENTE]", {
    clienteId
  });

  return {
    clienteId,
    redirectUri: redirectUriMeta(dados.redirectUri),
    exp: dados.exp
  };
}

function iniciarConexaoMeta({ clienteId = "admin", redirectUri = "" } = {}) {
  const appId = appIdMeta();
  const uri = redirectUriMeta(redirectUri);

  if (!appId) throw new Error("meta_app_id_ausente");
  if (!uri) throw new Error("meta_redirect_uri_ausente");

  const state = criarStateMeta(clienteId, uri);
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: uri,
    state,
    response_type: "code",
    scope: scopesConexaoMeta().join(",")
  });

  return {
    ok: true,
    provider: "meta",
    status: "oauth_iniciado",
    authUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
    state,
    redirectUri: uri,
    scopes: scopesConexaoMeta(),
    scopesFuturos: scopesPublicacaoFuturaMeta()
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

  logMetaSeguro("[SOCIAL-META-TOKEN-REQUEST]", {
    graphBase: GRAPH_BASE,
    codeFinal: codeFinal(code),
    client_id: appId,
    redirectUri: uri,
    grant_type: "nao_enviado",
    env: {
      META_APP_ID: Boolean(appId),
      META_APP_SECRET: Boolean(appSecret),
      META_REDIRECT_URI: Boolean(process.env.META_REDIRECT_URI)
    }
  });

  try {
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
    if (!dados.access_token) {
      logRespostaMetaTokenBruta(resposta, {
        appId,
        appSecret,
        code,
        redirectUri: uri,
        grantType: "nao_enviado"
      });
      logMetaSeguro("[SOCIAL-META-TOKEN-ERRO]", {
        codeFinal: codeFinal(code),
        redirectUri: uri,
        erro: "meta_token_nao_retornado"
      });
      throw new Error("meta_token_nao_retornado");
    }

    logMetaSeguro("[SOCIAL-META-TOKEN-OK]", {
      codeFinal: codeFinal(code),
      redirectUri: uri,
      tokenType: texto(dados.token_type || "bearer"),
      expiresIn: dados.expires_in ?? null
    });

    return dados;
  } catch (e) {
    if (e.response) {
      logRespostaMetaTokenBruta(e.response, {
        appId,
        appSecret,
        code,
        redirectUri: uri,
        grantType: "nao_enviado"
      });
    }
    const erro = erroMetaSeguro(e);
    logMetaSeguro("[SOCIAL-META-TOKEN-ERRO]", {
      codeFinal: codeFinal(code),
      redirectUri: uri,
      erro
    });
    throw new Error(erro.code ? `meta_token_erro_${erro.code}` : "meta_token_erro");
  }
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

function erroPermissaoMeta(erro) {
  const metaErro = erro?.response?.data?.error || {};
  const codigo = Number(metaErro.code || 0);
  const mensagem = texto(metaErro.message || erro?.message || "").toLowerCase();
  return codigo === 10 || codigo === 200 || mensagem.includes("permission") || mensagem.includes("permiss");
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

async function consultarAtivosMeta({ clienteId = "", accessToken = "", httpClient = axios } = {}) {
  logMetaSeguro("[SOCIAL-META-ATIVOS-CONSULTA]", {
    clienteId,
    tokenPresente: Boolean(texto(accessToken))
  });

  try {
    const paginas = normalizarPaginasMeta(await listarPaginasMeta({ accessToken, httpClient }));

    logMetaSeguro("[SOCIAL-META-PAGINAS-ENCONTRADAS]", {
      clienteId,
      paginasTotal: paginas.length
    });

    for (const pagina of paginas) {
      if (pagina.instagramBusinessAccountId) {
        logMetaSeguro("[SOCIAL-META-INSTAGRAM-ENCONTRADO]", {
          clienteId,
          pageId: pagina.id,
          instagramBusinessAccountId: pagina.instagramBusinessAccountId,
          instagramUsername: pagina.instagramUsername
        });
      }
    }

    return {
      ok: true,
      status: paginas.length ? "ativos_encontrados" : "nenhuma_pagina",
      paginas
    };
  } catch (e) {
    const permissaoInsuficiente = erroPermissaoMeta(e);
    const erro = erroMetaSeguro(e);
    if (permissaoInsuficiente) {
      logMetaSeguro("[SOCIAL-META-PERMISSAO-INSUFICIENTE]", {
        clienteId,
        erro
      });
    }

    return {
      ok: false,
      status: permissaoInsuficiente ? "permissao_insuficiente" : "erro_graph_api",
      motivo: erro.message || "meta_ativos_erro",
      erro,
      paginas: []
    };
  }
}

async function concluirCallbackMeta({ code = "", state = "", redirectUri = "", httpClient = axios } = {}) {
  const estado = validarStateMeta(state);
  const uri = redirectUriMeta(redirectUri || estado.redirectUri);
  const token = await trocarCodePorToken({ code, redirectUri: uri, httpClient });
  const ativos = await consultarAtivosMeta({
    clienteId: estado.clienteId,
    accessToken: token.access_token,
    httpClient
  });
  const paginas = ativos.paginas || [];
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
    ativos: {
      status: ativos.status,
      motivo: ativos.motivo || "",
      atualizadoEm: new Date().toISOString()
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
  consultarAtivosMeta,
  concluirCallbackMeta,
  iniciarConexaoMeta,
  scopesConexaoMeta,
  scopesPublicacaoFuturaMeta,
  validarStateMeta
};
