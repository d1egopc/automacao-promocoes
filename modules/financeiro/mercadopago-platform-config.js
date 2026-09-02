"use strict";

const { getPlatformVariable } = require("../platform-variables");

const MERCADOPAGO_ACCESS_TOKEN = "MERCADOPAGO_ACCESS_TOKEN";
const MERCADOPAGO_ENV = "MERCADOPAGO_ENV";
const MERCADOPAGO_WEBHOOK_SECRET = "MERCADOPAGO_WEBHOOK_SECRET";

const MERCADOPAGO_VARIAVEIS_HOMOLOGADAS = new Set([
  MERCADOPAGO_ACCESS_TOKEN,
  MERCADOPAGO_ENV,
  MERCADOPAGO_WEBHOOK_SECRET
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
}

function normalizarAmbienteMercadoPago(valor = "test") {
  const ambiente = textoLower(valor || "test") || "test";
  if (ambiente === "test" || ambiente === "production") {
    return { ok: true, ambiente };
  }
  return { ok: false, ambiente: "test", codigo: "mercadopago_env_invalido" };
}

async function obterVariavelMercadoPago(nome, {
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable,
  defaultValue = ""
} = {}) {
  if (!MERCADOPAGO_VARIAVEIS_HOMOLOGADAS.has(nome)) {
    throw new Error("mercadopago_platform_variable_nao_homologada");
  }

  try {
    const resultado = await getPlatformVariableImpl(nome, {
      envFallback: false,
      defaultValue
    });
    if (resultado?.ok === true && texto(resultado.value)) return resultado.value;
  } catch {
    // Mantem compatibilidade temporaria com ENV quando a central ainda nao estiver disponivel.
  }

  if (Object.prototype.hasOwnProperty.call(env, nome) && texto(env[nome])) return env[nome];
  return defaultValue;
}

function mercadoPagoConfigFromValues({
  accessToken = "",
  webhookSecret = "",
  ambiente = "test",
  ambienteExplicito = true
} = {}) {
  const normalizado = normalizarAmbienteMercadoPago(ambiente);
  return {
    configurado: normalizado.ok && Boolean(texto(accessToken)),
    webhookConfigurado: Boolean(texto(webhookSecret)),
    accessToken: texto(accessToken),
    webhookSecret: texto(webhookSecret),
    ambiente: normalizado.ambiente,
    sandboxTeste: ambienteExplicito === true && normalizado.ambiente === "test",
    ambienteValido: normalizado.ok,
    codigo: normalizado.ok ? "" : normalizado.codigo
  };
}

function mercadoPagoConfigEnv(env = process.env) {
  const ambienteEnv = texto(env.MERCADOPAGO_ENV);
  return mercadoPagoConfigFromValues({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
    ambiente: ambienteEnv || "test",
    ambienteExplicito: Boolean(ambienteEnv)
  });
}

async function resolverConfigMercadoPago({
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const [accessToken, ambiente, webhookSecret] = await Promise.all([
    obterVariavelMercadoPago(MERCADOPAGO_ACCESS_TOKEN, { env, getPlatformVariableImpl, defaultValue: "" }),
    obterVariavelMercadoPago(MERCADOPAGO_ENV, { env, getPlatformVariableImpl, defaultValue: "" }),
    obterVariavelMercadoPago(MERCADOPAGO_WEBHOOK_SECRET, { env, getPlatformVariableImpl, defaultValue: "" })
  ]);
  const ambienteTexto = texto(ambiente);

  return mercadoPagoConfigFromValues({
    accessToken,
    webhookSecret,
    ambiente: ambienteTexto || "test",
    ambienteExplicito: Boolean(ambienteTexto)
  });
}

function ambienteMercadoPagoTesteFromConfig(config = {}) {
  return config.sandboxTeste === true;
}

module.exports = {
  MERCADOPAGO_ACCESS_TOKEN,
  MERCADOPAGO_ENV,
  MERCADOPAGO_WEBHOOK_SECRET,
  MERCADOPAGO_VARIAVEIS_HOMOLOGADAS,
  ambienteMercadoPagoTesteFromConfig,
  mercadoPagoConfigEnv,
  mercadoPagoConfigFromValues,
  normalizarAmbienteMercadoPago,
  obterVariavelMercadoPago,
  resolverConfigMercadoPago
};
