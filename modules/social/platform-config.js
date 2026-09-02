"use strict";

const { getPlatformVariable } = require("../platform-variables");

const META_APP_ID = "META_APP_ID";
const META_APP_SECRET = "META_APP_SECRET";
const META_REDIRECT_URI = "META_REDIRECT_URI";
const INSTAGRAM_APP_ID = "INSTAGRAM_APP_ID";
const INSTAGRAM_APP_SECRET = "INSTAGRAM_APP_SECRET";
const INSTAGRAM_OAUTH_STATE_SECRET = "INSTAGRAM_OAUTH_STATE_SECRET";
const INSTAGRAM_REDIRECT_URI = "INSTAGRAM_REDIRECT_URI";
const INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "INSTAGRAM_WEBHOOK_VERIFY_TOKEN";

const VARIAVEIS_SOCIAL_HOMOLOGADAS = new Set([
  META_APP_ID,
  META_APP_SECRET,
  META_REDIRECT_URI,
  INSTAGRAM_APP_ID,
  INSTAGRAM_APP_SECRET,
  INSTAGRAM_OAUTH_STATE_SECRET,
  INSTAGRAM_REDIRECT_URI,
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function urlHttps(valor = "") {
  const uri = texto(valor);
  if (!uri) return "";
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function obterVariavelSocial(nome, {
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable,
  defaultValue = ""
} = {}) {
  if (!VARIAVEIS_SOCIAL_HOMOLOGADAS.has(nome)) {
    throw new Error("social_platform_variable_nao_homologada");
  }
  try {
    const resultado = await getPlatformVariableImpl(nome, {
      envFallback: true,
      defaultValue
    });
    if (resultado?.ok === true) return resultado.value;
  } catch {
    // Fallback temporario para ENV quando a central ainda nao estiver disponivel.
  }
  if (Object.prototype.hasOwnProperty.call(env, nome)) return env[nome];
  return defaultValue;
}

function obterConfigMetaEnv({ env = process.env } = {}) {
  return {
    appId: texto(env.META_APP_ID),
    appSecret: texto(env.META_APP_SECRET),
    redirectUri: urlHttps(env.META_REDIRECT_URI)
  };
}

async function obterConfigMetaAsync({
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const [appId, appSecret, redirectUri] = await Promise.all([
    obterVariavelSocial(META_APP_ID, { env, getPlatformVariableImpl }),
    obterVariavelSocial(META_APP_SECRET, { env, getPlatformVariableImpl }),
    obterVariavelSocial(META_REDIRECT_URI, { env, getPlatformVariableImpl })
  ]);
  return {
    appId: texto(appId),
    appSecret: texto(appSecret),
    redirectUri: urlHttps(redirectUri)
  };
}

function obterConfigInstagramEnv({ env = process.env } = {}) {
  return {
    appId: texto(env.INSTAGRAM_APP_ID),
    appSecret: texto(env.INSTAGRAM_APP_SECRET),
    oauthStateSecret: texto(env.INSTAGRAM_OAUTH_STATE_SECRET),
    redirectUri: urlHttps(env.INSTAGRAM_REDIRECT_URI),
    webhookVerifyToken: texto(env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN),
    metaAppSecret: texto(env.META_APP_SECRET)
  };
}

async function obterConfigInstagramAsync({
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const [
    appId,
    appSecret,
    oauthStateSecret,
    redirectUri,
    webhookVerifyToken,
    metaAppSecret
  ] = await Promise.all([
    obterVariavelSocial(INSTAGRAM_APP_ID, { env, getPlatformVariableImpl }),
    obterVariavelSocial(INSTAGRAM_APP_SECRET, { env, getPlatformVariableImpl }),
    obterVariavelSocial(INSTAGRAM_OAUTH_STATE_SECRET, { env, getPlatformVariableImpl }),
    obterVariavelSocial(INSTAGRAM_REDIRECT_URI, { env, getPlatformVariableImpl }),
    obterVariavelSocial(INSTAGRAM_WEBHOOK_VERIFY_TOKEN, { env, getPlatformVariableImpl }),
    obterVariavelSocial(META_APP_SECRET, { env, getPlatformVariableImpl })
  ]);
  return {
    appId: texto(appId),
    appSecret: texto(appSecret),
    oauthStateSecret: texto(oauthStateSecret),
    redirectUri: urlHttps(redirectUri),
    webhookVerifyToken: texto(webhookVerifyToken),
    metaAppSecret: texto(metaAppSecret)
  };
}

async function obterInstagramWebhookVerifyTokenAsync(opcoes = {}) {
  const config = await obterConfigInstagramAsync(opcoes);
  return config.webhookVerifyToken;
}

module.exports = {
  VARIAVEIS_SOCIAL_HOMOLOGADAS,
  obterConfigMetaEnv,
  obterConfigMetaAsync,
  obterConfigInstagramEnv,
  obterConfigInstagramAsync,
  obterInstagramWebhookVerifyTokenAsync,
  obterVariavelSocial,
  urlHttps
};
