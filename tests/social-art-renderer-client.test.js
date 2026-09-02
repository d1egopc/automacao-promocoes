const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-art-client-"));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_ART_RENDERER_URL = "https://renderer.optimus.test";
process.env.SOCIAL_ART_RENDERER_TOKEN = "token_interno_renderer";

const { writeClienteJson } = require("../utils/storage");
const {
  montarPayloadArteSocial,
  resolverConfigRendererSocial,
  renderizarArtePublicacaoSocial,
  validarUrlHttps
} = require("../modules/social/social-art-renderer.client");

(async () => {
  writeClienteJson("cliente_a", "social-templates.json", [
    {
      id: "padrao-instagram",
      visual: {
        faixaSuperiorAtiva: true,
        faixaSuperiorTexto: "OFERTA TESTE",
        faixaSuperiorCor: "#f97316",
        mostrarPrecoAntigo: true,
        mostrarCupom: true,
        mostrarMarketplace: true,
        faixaInferiorAtiva: true,
        ctaTemplate: 'COMENTE "{gatilho}"',
        posicaoCard: "bottom-left",
        corMoldura: "#0f172a",
        corCard: "#ffffff",
        corDestaquePreco: "#16a34a"
      }
    }
  ]);

  const oferta = {
    titulo: "Produto A",
    imagem: "https://cdn.optimus.test/produto-a.jpg",
    precoAtual: 100,
    precoOriginal: 150,
    cupom: "PROMO10",
    marketplace: "amazon"
  };
  const payloadLigado = montarPayloadArteSocial({
    clienteId: "cliente_a",
    ofertaId: "oferta_a",
    oferta,
    templateId: "padrao-instagram",
    gatilho: { ativo: true, palavra: "quero" }
  });
  assert.strictEqual(payloadLigado.versao, 1);
  assert.strictEqual(payloadLigado.template.faixaInferiorAtiva, true);
  assert.strictEqual(payloadLigado.cta, 'COMENTE "QUERO"');
  assert.strictEqual(payloadLigado.dados.imagem, "https://cdn.optimus.test/produto-a.jpg");
  assert.ok(!JSON.stringify(payloadLigado).includes("token"), "payload do renderer nao deve conter tokens");

  const payloadDesligado = montarPayloadArteSocial({
    clienteId: "cliente_a",
    ofertaId: "oferta_a",
    oferta,
    templateId: "padrao-instagram",
    gatilho: { ativo: false, palavra: "quero" }
  });
  assert.strictEqual(payloadDesligado.template.faixaInferiorAtiva, false);
  assert.strictEqual(payloadDesligado.cta, "");

  assert.strictEqual(validarUrlHttps("https://cdn.optimus.test/a.png"), "https://cdn.optimus.test/a.png");
  assert.throws(() => validarUrlHttps("http://cdn.optimus.test/a.png"), /social_art_url_publica_invalida/);

  const envFallback = {
    SOCIAL_ART_RENDERER_URL: "https://renderer-env.optimus.test",
    SOCIAL_ART_RENDERER_TOKEN: "token_env_renderer",
    SOCIAL_ART_RENDERER_TIMEOUT_MS: "3100"
  };
  const resolverAusente = async () => ({ ok: false, source: "missing", value: null });
  const configEnv = await resolverConfigRendererSocial({
    env: envFallback,
    getPlatformVariableImpl: resolverAusente
  });
  assert.deepStrictEqual(configEnv, {
    base: "https://renderer-env.optimus.test",
    token: "token_env_renderer",
    timeoutMs: 3100
  });

  const nomesSolicitadosPainel = [];
  const resolverPainel = async (nome) => {
    nomesSolicitadosPainel.push(nome);
    return {
      ok: true,
      source: "platform_variables",
      value: {
        SOCIAL_ART_RENDERER_URL: "https://renderer-painel.optimus.test/",
        SOCIAL_ART_RENDERER_TOKEN: "token_painel_renderer",
        SOCIAL_ART_RENDERER_TIMEOUT_MS: 4200
      }[nome]
    };
  };
  const configPainel = await resolverConfigRendererSocial({
    env: envFallback,
    getPlatformVariableImpl: resolverPainel
  });
  assert.deepStrictEqual(configPainel, {
    base: "https://renderer-painel.optimus.test",
    token: "token_painel_renderer",
    timeoutMs: 4200
  });
  assert.deepStrictEqual(nomesSolicitadosPainel.sort(), [
    "SOCIAL_ART_RENDERER_TIMEOUT_MS",
    "SOCIAL_ART_RENDERER_TOKEN",
    "SOCIAL_ART_RENDERER_URL"
  ]);

  const configSemNada = await resolverConfigRendererSocial({
    env: {},
    getPlatformVariableImpl: resolverAusente
  });
  assert.deepStrictEqual(configSemNada, {
    base: "",
    token: "",
    timeoutMs: 20000
  });

  const resolverTimeoutInvalido = async (nome) => ({
    ok: nome === "SOCIAL_ART_RENDERER_TIMEOUT_MS",
    value: nome === "SOCIAL_ART_RENDERER_TIMEOUT_MS" ? "abc" : null
  });
  const configTimeoutFallbackEnv = await resolverConfigRendererSocial({
    env: envFallback,
    getPlatformVariableImpl: resolverTimeoutInvalido
  });
  assert.strictEqual(configTimeoutFallbackEnv.timeoutMs, 3100);

  const configTimeoutFallbackDefault = await resolverConfigRendererSocial({
    env: { SOCIAL_ART_RENDERER_TIMEOUT_MS: "tambem-invalido" },
    getPlatformVariableImpl: resolverTimeoutInvalido
  });
  assert.strictEqual(configTimeoutFallbackDefault.timeoutMs, 20000);

  let requestBody = null;
  const resposta = await renderizarArtePublicacaoSocial({
    clienteId: "cliente_a",
    ofertaId: "oferta_a",
    oferta,
    templateId: "padrao-instagram",
    gatilho: { ativo: true, palavra: "promo" },
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      assert.strictEqual(url, "https://renderer.optimus.test/render/social/post-art");
      assert.strictEqual(options.headers.Authorization, "Bearer token_interno_renderer");
      assert.ok(!options.body.includes("token_interno_renderer"));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            imagemUrlPublica: "https://cdn.optimus.test/posts/cliente_a/oferta_a/render.png",
            hash: requestBody.hash,
            templateVersao: 1,
            cache: false
          };
        }
      };
    }
  });
  assert.strictEqual(resposta.imagemUrlPublica, "https://cdn.optimus.test/posts/cliente_a/oferta_a/render.png");
  assert.strictEqual(resposta.hash, requestBody.hash);

  let chamadaRuntime = 0;
  const urlsRuntime = [];
  const resolverRuntime = async (nome) => {
    chamadaRuntime += 1;
    const rodada = Math.ceil(chamadaRuntime / 3);
    return {
      ok: true,
      value: {
        SOCIAL_ART_RENDERER_URL: `https://renderer-runtime-${rodada}.optimus.test`,
        SOCIAL_ART_RENDERER_TOKEN: `token_runtime_${rodada}`,
        SOCIAL_ART_RENDERER_TIMEOUT_MS: 1000 + rodada
      }[nome]
    };
  };
  for (let i = 1; i <= 2; i += 1) {
    await renderizarArtePublicacaoSocial({
      clienteId: "cliente_a",
      ofertaId: `oferta_runtime_${i}`,
      oferta,
      getPlatformVariableImpl: resolverRuntime,
      fetchImpl: async (url, options) => {
        urlsRuntime.push(url);
        assert.strictEqual(options.headers.Authorization, `Bearer token_runtime_${i}`);
        assert.ok(!options.body.includes(`token_runtime_${i}`), "token do painel nao entra no payload/logico");
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, imagemUrlPublica: `https://cdn.optimus.test/runtime-${i}.png` };
          }
        };
      }
    });
  }
  assert.deepStrictEqual(urlsRuntime, [
    "https://renderer-runtime-1.optimus.test/render/social/post-art",
    "https://renderer-runtime-2.optimus.test/render/social/post-art"
  ]);

  await assert.rejects(
    () => renderizarArtePublicacaoSocial({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      oferta,
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        async json() { return { ok: false, erro: "renderer_indisponivel" }; }
      })
    }),
    /renderer_indisponivel/
  );

  await assert.rejects(
    () => renderizarArtePublicacaoSocial({
      clienteId: "cliente_a",
      ofertaId: "oferta_sem_config",
      oferta,
      env: {},
      getPlatformVariableImpl: resolverAusente,
      fetchImpl: async () => {
        throw new Error("fetch_nao_deveria_rodar");
      }
    }),
    /social_art_renderer_nao_configurado/
  );

  console.log("social-art-renderer-client: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
