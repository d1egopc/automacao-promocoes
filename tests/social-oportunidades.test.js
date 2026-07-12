const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-oportunidades-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";
const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 3 };

const storage = require("../modules/social/storage");
const instagram = require("../modules/social/instagram");
const { readClienteJson, writeClienteJson } = require("../utils/storage");

function filaBase(item = {}) {
  return {
    marketplace: "amazon",
    titulo: "Echo Dot 5",
    precoAtual: 199.9,
    precoOriginal: 299.9,
    cupom: "PROMO10",
    score: 91,
    prioridade: 100,
    categoria: "eletronicos",
    origem: "engine",
    imagem: "https://cdn.optimus.test/echo.jpg",
    linkAfiliado: "https://go.optimus.test/cliente-a/echo",
    linkOriginal: "https://amazon.test/echo",
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    criadoEm: "2026-07-11T10:00:00.000Z",
    ...item
  };
}

function mockHttpClient() {
  return {
    async post(url) {
      if (url.endsWith("/subscribed_apps")) return { data: { success: true } };
      if (url.endsWith("/media")) return { data: { id: "container_oportunidade" } };
      if (url.endsWith("/media_publish")) return { data: { id: "media_oportunidade" } };
      return { data: { access_token: "short_token", token_type: "bearer" } };
    },
    async get(url) {
      if (url.includes("graph.instagram.com/container_oportunidade")) {
        return { data: { status_code: "FINISHED", status: "FINISHED" } };
      }
      if (url.endsWith("/access_token")) {
        return { data: { access_token: "long_token", token_type: "bearer", expires_in: 5184000 } };
      }
      if (url.endsWith("/subscribed_apps")) {
        return { data: { data: [{ subscribed_fields: ["comments", "messages"] }] } };
      }
      return {
        data: {
          user_id: "ig_cliente_a",
          username: "optimus_cliente_a",
          account_type: "BUSINESS",
          profile_picture_url: "https://cdn.optimus.test/avatar.jpg"
        }
      };
    }
  };
}

(async () => {
  writeClienteJson("cliente_a", "fila.json", [
    filaBase({
      id: "social_engine_visual_123",
      engineOfertaId: "oferta_engine_oficial_123"
    }),
    filaBase({
      id: "engine_sem_link_visual",
      ofertaId: "oferta_sem_link",
      linkAfiliado: "",
      linkFinal: "",
      linkOriginal: "https://amazon.test/sem-link"
    })
  ]);
  writeClienteJson("cliente_b", "fila.json", [
    filaBase({
      id: "social_engine_visual_123",
      engineOfertaId: "oferta_cliente_b",
      linkAfiliado: "https://go.optimus.test/cliente-b/echo"
    })
  ]);

  const filaAntes = JSON.stringify(readClienteJson("cliente_a", "fila.json", []));
  const oportunidadesA = storage.listarOportunidadesSocial("cliente_a", 10);
  const oportunidadesB = storage.listarOportunidadesSocial("cliente_b", 10);
  const comLink = oportunidadesA.find(item => item.ofertaId === "oferta_engine_oficial_123");
  const semLink = oportunidadesA.find(item => item.ofertaId === "oferta_sem_link");

  assert.ok(comLink, "oportunidade com link deve preservar ofertaId oficial");
  assert.strictEqual(comLink.id, "social_social_engine_visual_123");
  assert.strictEqual(comLink.ofertaId, "oferta_engine_oficial_123");
  assert.strictEqual(comLink.linkAfiliadoPresente, true);
  assert.strictEqual(comLink.publicavel, true);
  assert.strictEqual(comLink.preco, 199.9);
  assert.strictEqual(comLink.origem, "engine");
  assert.ok(!JSON.stringify(oportunidadesA).includes("https://go.optimus.test"), "oportunidades nao devem expor link afiliado");

  assert.ok(semLink, "oportunidade sem link deve continuar visivel");
  assert.strictEqual(semLink.linkAfiliadoPresente, false);
  assert.strictEqual(semLink.publicavel, false);
  assert.strictEqual(semLink.motivoIndisponivel, "sem_link_afiliado");

  assert.ok(!oportunidadesA.some(item => item.ofertaId === "oferta_cliente_b"), "cliente A nao recebe oferta do cliente B");
  assert.ok(oportunidadesB.some(item => item.ofertaId === "oferta_cliente_b"), "cliente B mantem propria oportunidade");
  assert.strictEqual(JSON.stringify(readClienteJson("cliente_a", "fila.json", [])), filaAntes, "listar oportunidades nao altera fila historica");

  await instagram.concluirCallbackInstagram({
    code: "code_cliente_a",
    state: instagram.iniciarConexaoInstagram({ clienteId: "cliente_a" }).state,
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
    httpClient: mockHttpClient()
  });
  const publicada = await instagram.publicarImagemInstagram({
    clienteId: "cliente_a",
    ofertaId: comLink.ofertaId,
    templateId: "padrao-instagram",
    httpClient: mockHttpClient(),
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicada.publicacao.status, "publicada");
  assert.strictEqual(publicada.publicacao.ofertaId, "oferta_engine_oficial_123");

  console.log("social-oportunidades: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
