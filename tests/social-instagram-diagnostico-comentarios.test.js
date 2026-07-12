const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-ig-diagnostico-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";

const instagram = require("../modules/social/instagram");
const { writeClienteJson } = require("../utils/storage");

function salvarBaseCliente(clienteId, { ig = "ig_cliente", media = "media_cliente", publicacao = "pub_cliente", token = "token_cliente" } = {}) {
  writeClienteJson(clienteId, "social-instagram.json", {
    clienteId,
    conectado: true,
    instagramUserId: ig,
    username: `${clienteId}_perfil`,
    token: {
      accessToken: token,
      expiresAt: "2099-01-01T00:00:00.000Z"
    },
    scopes: instagram.scopesInstagramConexao()
  });
  writeClienteJson(clienteId, "social-publicacoes.json", [{
    id: publicacao,
    clienteId,
    rede: "instagram",
    status: "publicada",
    ofertaId: `oferta_${clienteId}`,
    instagramUserId: ig,
    instagramMediaId: media,
    gatilho: {
      ativo: true,
      palavra: "PROMO"
    }
  }]);
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  return {
    chamadas,
    async get(url, config = {}) {
      chamadas.push({ metodo: "get", url, params: config.params || {} });
      if (url.endsWith("/comments")) {
        if (opcoes.erroComentarios) {
          const erro = new Error("permissao_negada");
          erro.response = {
            status: 403,
            data: {
              error: {
                message: "Missing permission",
                code: 10,
                error_subcode: 2207037,
                type: "OAuthException"
              }
            }
          };
          throw erro;
        }
        return {
          data: {
            data: opcoes.comentarios || []
          }
        };
      }
      if (url.endsWith("/subscribed_apps")) {
        return {
          data: {
            data: [{
              subscribed_fields: opcoes.webhookCampos || ["comments", "messages"]
            }]
          }
        };
      }
      throw new Error(`url_inesperada:${url}`);
    }
  };
}

(async () => {
  salvarBaseCliente("cliente_a", {
    ig: "ig_a",
    media: "media_a",
    publicacao: "pub_a",
    token: "token_cliente_a"
  });
  salvarBaseCliente("cliente_b", {
    ig: "ig_b",
    media: "media_b",
    publicacao: "pub_b",
    token: "token_cliente_b"
  });

  const fonteRotas = fs.readFileSync(path.join(__dirname, "..", "modules", "social", "routes.js"), "utf8");
  const trechoRota = fonteRotas.slice(
    fonteRotas.indexOf('router.post("/instagram/diagnostico-comentarios"'),
    fonteRotas.indexOf('router.get("/instagram/interacoes"')
  );
  assert.ok(trechoRota.includes("if (!socialPermitido(req))"), "diagnostico deve exigir autorizacao do modulo social");
  assert.ok(trechoRota.includes("return res.status(403)"), "diagnostico deve bloquear acesso sem permissao");

  await assert.rejects(
    () => instagram.diagnosticarComentariosPublicacaoInstagram({
      clienteId: "cliente_a",
      publicacaoId: "pub_b",
      httpClient: mockHttpClient()
    }),
    /publicacao_nao_encontrada/,
    "cliente A nao pode diagnosticar publicacao do cliente B"
  );

  await assert.rejects(
    () => instagram.diagnosticarComentariosPublicacaoInstagram({
      clienteId: "cliente_a",
      publicacaoId: "inexistente",
      httpClient: mockHttpClient()
    }),
    /publicacao_nao_encontrada/
  );

  const httpVisivel = mockHttpClient({
    comentarios: [{
      id: "comment_1",
      text: "promo quero detalhes do produto completo",
      username: "comprador_real",
      timestamp: "2026-07-12T12:00:00+0000"
    }]
  });
  const visivel = await instagram.diagnosticarComentariosPublicacaoInstagram({
    clienteId: "cliente_a",
    publicacaoId: "pub_a",
    httpClient: httpVisivel
  });
  assert.strictEqual(visivel.ok, true);
  assert.strictEqual(visivel.comentarioEncontrado, true);
  assert.strictEqual(visivel.totalComentarios, 1);
  assert.strictEqual(visivel.webhookContaAssinada, true);
  assert.deepStrictEqual(visivel.webhookCampos, ["comments", "messages"]);
  assert.strictEqual(visivel.statusCodeComentarios, 200);
  assert.strictEqual(visivel.statusCodeAssinatura, 200);
  assert.ok(!JSON.stringify(visivel).includes("token_cliente_a"), "resposta nunca deve expor token");
  assert.ok(!JSON.stringify(visivel).includes("produto completo"), "comentario completo nao deve ser exposto");
  assert.ok(httpVisivel.chamadas.find(chamada => chamada.url.includes("/media_a/comments")), "deve consultar comments da media correta");
  assert.ok(httpVisivel.chamadas.find(chamada => chamada.url.includes("/ig_a/subscribed_apps")), "deve consultar assinatura da conta correta");

  const ausente = await instagram.diagnosticarComentariosPublicacaoInstagram({
    clienteId: "cliente_a",
    publicacaoId: "pub_a",
    httpClient: mockHttpClient({
      comentarios: [{
        id: "comment_2",
        text: "qual o valor?",
        username: "comprador_2",
        timestamp: "2026-07-12T12:02:00+0000"
      }]
    })
  });
  assert.strictEqual(ausente.ok, true);
  assert.strictEqual(ausente.comentarioEncontrado, false);
  assert.strictEqual(ausente.totalComentarios, 1);

  const permissao = await instagram.diagnosticarComentariosPublicacaoInstagram({
    clienteId: "cliente_a",
    publicacaoId: "pub_a",
    httpClient: mockHttpClient({ erroComentarios: true })
  });
  assert.strictEqual(permissao.ok, false);
  assert.strictEqual(permissao.statusCodeComentarios, 403);
  assert.strictEqual(permissao.erroSanitizado.code, 10);
  assert.strictEqual(permissao.erroSanitizado.subcode, 2207037);
  assert.ok(!JSON.stringify(permissao).includes("token_cliente_a"), "erro sanitizado nao deve expor token");

  assert.ok(fonteRotas.includes('router.post("/instagram/diagnostico-comentarios"'), "rota temporaria deve existir");
  assert.ok(fonteRotas.includes('POST /social/instagram/diagnostico-comentarios'), "rota deve aparecer no log de modulo");

  console.log("social-instagram-diagnostico-comentarios: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
