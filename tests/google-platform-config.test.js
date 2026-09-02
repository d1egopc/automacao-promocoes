"use strict";

const assert = require("assert");

const {
  GOOGLE_CLIENT_ID,
  getGoogleClientId,
  obterVariavelGoogle,
  payloadGoogleConfigPublica
} = require("../modules/google-platform-config");

(async () => {
  const env = {
    GOOGLE_CLIENT_ID: "env-google-client.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_ID: "alias-google-client.apps.googleusercontent.com"
  };

  const chamadasPainel = [];
  const painel = async (nome) => {
    chamadasPainel.push(nome);
    return {
      ok: true,
      source: "platform_variables",
      value: nome === GOOGLE_CLIENT_ID ? "painel-google-client.apps.googleusercontent.com" : ""
    };
  };
  const clientIdPainel = await getGoogleClientId({ env, getPlatformVariableImpl: painel });
  assert.strictEqual(clientIdPainel, "painel-google-client.apps.googleusercontent.com", "painel vence ENV");
  assert.deepStrictEqual(chamadasPainel, [GOOGLE_CLIENT_ID], "somente GOOGLE_CLIENT_ID deve ser resolvido no painel");

  const ausente = async () => ({ ok: false, source: "missing", value: null });
  assert.strictEqual(
    await getGoogleClientId({ env, getPlatformVariableImpl: ausente }),
    "env-google-client.apps.googleusercontent.com",
    "GOOGLE_CLIENT_ID deve ser fallback ENV principal"
  );
  assert.strictEqual(
    await getGoogleClientId({
      env: { GOOGLE_OAUTH_CLIENT_ID: "alias-google-client.apps.googleusercontent.com" },
      getPlatformVariableImpl: ausente
    }),
    "alias-google-client.apps.googleusercontent.com",
    "GOOGLE_OAUTH_CLIENT_ID deve permanecer alias legado de ENV"
  );
  assert.strictEqual(
    await getGoogleClientId({ env: {}, getPlatformVariableImpl: ausente }),
    "",
    "ausencia total deve preservar fail-closed do consumidor"
  );

  let rodada = 0;
  const runtime = async () => {
    rodada += 1;
    return {
      ok: true,
      source: "platform_variables",
      value: `runtime-google-client-${rodada}.apps.googleusercontent.com`
    };
  };
  assert.strictEqual(
    await getGoogleClientId({ env, getPlatformVariableImpl: runtime }),
    "runtime-google-client-1.apps.googleusercontent.com",
    "primeira leitura runtime"
  );
  assert.strictEqual(
    await getGoogleClientId({ env, getPlatformVariableImpl: runtime }),
    "runtime-google-client-2.apps.googleusercontent.com",
    "segunda leitura runtime sem cache/import-time"
  );

  const falhaCentral = async () => {
    throw new Error("postgres_indisponivel");
  };
  assert.strictEqual(
    await getGoogleClientId({ env, getPlatformVariableImpl: falhaCentral }),
    "env-google-client.apps.googleusercontent.com",
    "falha temporaria da central deve preservar fallback ENV"
  );

  const payload = await payloadGoogleConfigPublica({
    env,
    getPlatformVariableImpl: painel
  });
  assert.deepStrictEqual(payload, {
    googleClientId: "painel-google-client.apps.googleusercontent.com"
  });
  assert.ok(!JSON.stringify(payload).includes("GOOGLE_OAUTH_CLIENT_ID"), "payload publico nao expõe alias/variavel generica");

  await assert.rejects(
    () => obterVariavelGoogle("GOOGLE_JWKS_JSON", { env, getPlatformVariableImpl: painel }),
    /google_platform_variable_nao_homologada/,
    "JWKS nao entra na allowlist do corte Google"
  );

  console.log("google-platform-config.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
