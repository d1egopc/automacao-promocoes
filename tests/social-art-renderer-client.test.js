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

  console.log("social-art-renderer-client: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
