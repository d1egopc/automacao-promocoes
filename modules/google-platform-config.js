"use strict";

const { getPlatformVariable } = require("./platform-variables");

const GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID";
const GOOGLE_OAUTH_CLIENT_ID = "GOOGLE_OAUTH_CLIENT_ID";
const VARIAVEIS_GOOGLE_HOMOLOGADAS = new Set([GOOGLE_CLIENT_ID]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

async function obterVariavelGoogle(nome, {
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable,
  defaultValue = ""
} = {}) {
  if (!VARIAVEIS_GOOGLE_HOMOLOGADAS.has(nome)) {
    throw new Error("google_platform_variable_nao_homologada");
  }

  try {
    const resultado = await getPlatformVariableImpl(nome, {
      envFallback: false,
      defaultValue
    });
    if (resultado?.ok === true && texto(resultado.value)) return resultado.value;
  } catch {
    // Fallback temporario para ENV quando a central ainda nao estiver disponivel.
  }

  if (Object.prototype.hasOwnProperty.call(env, nome) && texto(env[nome])) return env[nome];
  if (nome === GOOGLE_CLIENT_ID && Object.prototype.hasOwnProperty.call(env, GOOGLE_OAUTH_CLIENT_ID)) {
    return env[GOOGLE_OAUTH_CLIENT_ID];
  }
  return defaultValue;
}

async function getGoogleClientId({
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  return texto(await obterVariavelGoogle(GOOGLE_CLIENT_ID, {
    env,
    getPlatformVariableImpl,
    defaultValue: ""
  }));
}

async function payloadGoogleConfigPublica(opcoes = {}) {
  return {
    googleClientId: await getGoogleClientId(opcoes)
  };
}

module.exports = {
  GOOGLE_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_ID,
  VARIAVEIS_GOOGLE_HOMOLOGADAS,
  getGoogleClientId,
  obterVariavelGoogle,
  payloadGoogleConfigPublica
};
