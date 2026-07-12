const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-gatilho-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "verify_optimus";

const instagram = require("../modules/social/instagram");
const { readClienteJson, writeClienteJson } = require("../utils/storage");
const routesFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "social", "routes.js"), "utf8");
const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function assinar(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const assinatura = `sha256=${crypto.createHmac("sha256", process.env.INSTAGRAM_APP_SECRET).update(rawBody).digest("hex")}`;
  return { rawBody, assinatura };
}

function payloadComentario({ ig = "ig_cliente_a", media = "media_pub_a", comment = "comment_1", text = "EU QUERO", from = "usuario_1", username = "comprador" } = {}) {
  return {
    object: "instagram",
    entry: [{
      id: ig,
      changes: [{
        field: "comments",
        value: {
          id: comment,
          media: { id: media },
          text,
          from: { id: from, username }
        }
      }]
    }]
  };
}

function salvarClienteInstagram(clienteId, { ig = "ig_cliente_a", media = "media_pub_a", oferta = "oferta_a", link = "https://go.optimus.test/a/oferta", cupom = "PROMO10" } = {}) {
  writeClienteJson(clienteId, "social-instagram.json", {
    clienteId,
    conectado: true,
    instagramUserId: ig,
    username: `${clienteId}_perfil`,
    token: { accessToken: `token_${clienteId}`, expiresAt: "2099-01-01T00:00:00.000Z" },
    scopes: instagram.scopesInstagramConexao()
  });
  writeClienteJson(clienteId, "fila.json", [{
    id: oferta,
    clienteId,
    titulo: `Oferta ${clienteId}`,
    marketplace: "amazon",
    imagem: "https://cdn.optimus.test/oferta.jpg",
    precoAtual: 99.9,
    cupom,
    linkAfiliado: link,
    ofertaUniversal: true
  }]);
  writeClienteJson(clienteId, "social-publicacoes.json", [{
    id: `pub_${clienteId}`,
    clienteId,
    rede: "instagram",
    status: "publicada",
    ofertaId: oferta,
    instagramUserId: ig,
    instagramMediaId: media,
    gatilho: {
      ativo: true,
      palavra: "EU QUERO",
      respostaPublica: "Pronto! Enviei no Direct.",
      textoDirect: "Aqui está a oferta:",
      grupoUrl: "https://grupo.optimus.test/a",
      grupoTexto: "Mais ofertas no grupo:"
    }
  }]);
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body) {
      chamadas.push({ metodo: "post", url, body: String(body || "") });
      if (url.endsWith("/replies")) return { data: { id: "reply_1" } };
      if (url.endsWith("/private_replies")) {
        if (opcoes.erroDirect) {
          const erro = new Error("direct_recusado");
          erro.response = { data: { error: { code: 10, type: "IGApiException", message: "Private reply not allowed" } } };
          throw erro;
        }
        return { data: { id: "direct_1" } };
      }
      throw new Error(`url_inesperada:${url}`);
    }
  };
}

(async () => {
  salvarClienteInstagram("cliente_a");
  salvarClienteInstagram("cliente_b", {
    ig: "ig_cliente_b",
    media: "media_pub_b",
    oferta: "oferta_b",
    link: "https://go.optimus.test/b/oferta"
  });

  assert.ok(routesFonte.includes('router.get("/instagram/webhook"'), "webhook GET deve existir");
  assert.ok(routesFonte.includes('router.post("/instagram/webhook"'), "webhook POST deve existir");
  assert.ok(routesFonte.includes('erro: "verify_token_invalido"'), "verify token invalido deve ser rejeitado");
  assert.ok(routesFonte.includes('erro: "assinatura_invalida"'), "assinatura invalida deve ser rejeitada");
  assert.ok(routesFonte.includes("setImmediate"), "webhook deve responder antes do processamento pesado");
  assert.ok(indexFonte.includes('req.path === "/social/instagram/webhook"'), "webhook precisa ser publico no auth global");

  assert.ok(instagram.scopesInstagramConexao().includes("instagram_business_manage_comments"));
  assert.ok(instagram.scopesInstagramConexao().includes("instagram_business_manage_messages"));
  assert.strictEqual(instagram.contemGatilhoSeguro("Êu  quérõ por favor", "EU QUERO"), true);
  assert.strictEqual(instagram.contemGatilhoSeguro("eu querolandia", "EU QUERO"), false);

  const payload = payloadComentario();
  const { rawBody, assinatura } = assinar(payload);
  assert.strictEqual(instagram.validarAssinaturaWebhookInstagram({ assinatura, rawBody }), true);
  assert.strictEqual(instagram.validarAssinaturaWebhookInstagram({ assinatura: "sha256=deadbeef", rawBody }), false);

  const http = mockHttpClient();
  const resultado = await instagram.processarWebhookInstagram({ payload, assinatura, rawBody, httpClient: http });
  assert.strictEqual(resultado.total, 1);
  assert.strictEqual(resultado.resultados[0].status, "respondida");
  assert.strictEqual(http.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 1);
  assert.strictEqual(http.chamadas.filter(chamada => chamada.url.endsWith("/private_replies")).length, 1);
  assert.ok(http.chamadas.find(chamada => chamada.url.endsWith("/private_replies")).body.includes("https%3A%2F%2Fgo.optimus.test%2Fa%2Foferta"));
  assert.ok(!JSON.stringify(instagram.listarInteracoesInstagram("cliente_a")).includes("token_cliente_a"));

  const duplicado = await instagram.processarWebhookInstagram({ payload, assinatura, rawBody, httpClient: mockHttpClient() });
  assert.strictEqual(duplicado.resultados[0].status, "duplicado");

  const semGatilhoPayload = payloadComentario({ comment: "comment_sem_gatilho", text: "qual o preço?" });
  const semGatilhoAssinado = assinar(semGatilhoPayload);
  const semGatilho = await instagram.processarWebhookInstagram({ payload: semGatilhoPayload, ...semGatilhoAssinado, httpClient: mockHttpClient() });
  assert.strictEqual(semGatilho.resultados[0].interacao.erro.message, "sem_gatilho");

  const proprioPayload = payloadComentario({ comment: "comment_proprio", from: "ig_cliente_a" });
  const proprioAssinado = assinar(proprioPayload);
  const proprio = await instagram.processarWebhookInstagram({ payload: proprioPayload, ...proprioAssinado, httpClient: mockHttpClient() });
  assert.strictEqual(proprio.resultados[0].interacao.erro.message, "comentario_proprio");

  const naoOptimusPayload = payloadComentario({ comment: "comment_outro", media: "media_nao_optimus" });
  const naoOptimusAssinado = assinar(naoOptimusPayload);
  const naoOptimus = await instagram.processarWebhookInstagram({ payload: naoOptimusPayload, ...naoOptimusAssinado, httpClient: mockHttpClient() });
  assert.strictEqual(naoOptimus.resultados[0].status, "ignorado");

  salvarClienteInstagram("cliente_sem_link", {
    ig: "ig_sem_link",
    media: "media_sem_link",
    oferta: "oferta_sem_link",
    link: ""
  });
  const semLinkPayload = payloadComentario({ ig: "ig_sem_link", media: "media_sem_link", comment: "comment_sem_link" });
  const semLinkAssinado = assinar(semLinkPayload);
  const semLink = await instagram.processarWebhookInstagram({ payload: semLinkPayload, ...semLinkAssinado, httpClient: mockHttpClient() });
  assert.strictEqual(semLink.resultados[0].interacao.erro.message, "oferta_link_ausente");

  const directErroPayload = payloadComentario({ comment: "comment_direct_erro" });
  const directErroAssinado = assinar(directErroPayload);
  const directErro = await instagram.processarWebhookInstagram({ payload: directErroPayload, ...directErroAssinado, httpClient: mockHttpClient({ erroDirect: true }) });
  assert.strictEqual(directErro.resultados[0].status, "parcial");
  assert.strictEqual(directErro.resultados[0].interacao.respostaPublicaStatus, "concluida");
  assert.strictEqual(directErro.resultados[0].interacao.privateReplyStatus, "erro");
  assert.ok(directErro.resultados[0].interacao.respostaPublicaEnviadaEm);

  const httpRetry = mockHttpClient();
  const retryDirect = await instagram.processarWebhookInstagram({ payload: directErroPayload, ...directErroAssinado, httpClient: httpRetry });
  assert.strictEqual(retryDirect.resultados[0].status, "respondida");
  assert.strictEqual(httpRetry.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 0, "retry de Direct nao deve repetir resposta publica");
  assert.strictEqual(httpRetry.chamadas.filter(chamada => chamada.url.endsWith("/private_replies")).length, 1);

  const concorrentePayload = payloadComentario({ comment: "comment_concorrente" });
  const concorrenteAssinado = assinar(concorrentePayload);
  const httpConcorrente = mockHttpClient();
  const [concorrenteA, concorrenteB] = await Promise.all([
    instagram.processarWebhookInstagram({ payload: concorrentePayload, ...concorrenteAssinado, httpClient: httpConcorrente }),
    instagram.processarWebhookInstagram({ payload: concorrentePayload, ...concorrenteAssinado, httpClient: httpConcorrente })
  ]);
  assert.strictEqual([concorrenteA.resultados[0].status, concorrenteB.resultados[0].status].filter(status => status === "respondida").length, 1);
  assert.strictEqual([concorrenteA.resultados[0].status, concorrenteB.resultados[0].status].filter(status => status === "duplicado").length, 1);
  assert.strictEqual(httpConcorrente.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 1);
  assert.strictEqual(httpConcorrente.chamadas.filter(chamada => chamada.url.endsWith("/private_replies")).length, 1);

  salvarClienteInstagram("cliente_sem_cupom", {
    ig: "ig_sem_cupom",
    media: "media_sem_cupom",
    oferta: "oferta_sem_cupom",
    cupom: ""
  });
  const semCupomPayload = payloadComentario({ ig: "ig_sem_cupom", media: "media_sem_cupom", comment: "comment_sem_cupom" });
  const semCupomAssinado = assinar(semCupomPayload);
  const httpSemCupom = mockHttpClient();
  const semCupom = await instagram.processarWebhookInstagram({ payload: semCupomPayload, ...semCupomAssinado, httpClient: httpSemCupom });
  assert.strictEqual(semCupom.resultados[0].status, "respondida");
  assert.strictEqual(httpSemCupom.chamadas.find(chamada => chamada.url.endsWith("/private_replies")).body.includes("Cupom"), false);

  salvarClienteInstagram("cliente_antigo_sem_gatilho", {
    ig: "ig_antigo_sem_gatilho",
    media: "media_antigo_sem_gatilho",
    oferta: "oferta_antigo_sem_gatilho"
  });
  const publicacoesAntigas = readClienteJson("cliente_antigo_sem_gatilho", "social-publicacoes.json", []);
  delete publicacoesAntigas[0].gatilho;
  writeClienteJson("cliente_antigo_sem_gatilho", "social-publicacoes.json", publicacoesAntigas);
  const antigoPayload = payloadComentario({
    ig: "ig_antigo_sem_gatilho",
    media: "media_antigo_sem_gatilho",
    comment: "comment_antigo_sem_gatilho",
    text: "EU QUERO"
  });
  const antigoAssinado = assinar(antigoPayload);
  const httpAntigo = mockHttpClient();
  const antigo = await instagram.processarWebhookInstagram({ payload: antigoPayload, ...antigoAssinado, httpClient: httpAntigo });
  assert.strictEqual(antigo.resultados[0].status, "ignorado");
  assert.strictEqual(antigo.resultados[0].interacao.erro.message, "gatilho_inativo");
  assert.strictEqual(httpAntigo.chamadas.length, 0, "publicacao antiga sem gatilho nao deve disparar respostas");

  salvarClienteInstagram("cliente_dup_a", { ig: "ig_duplicado", media: "media_dup", oferta: "oferta_dup_a" });
  salvarClienteInstagram("cliente_dup_b", { ig: "ig_duplicado", media: "media_dup", oferta: "oferta_dup_b" });
  const duplicadoClientePayload = payloadComentario({ ig: "ig_duplicado", media: "media_dup", comment: "comment_cliente_dup" });
  const duplicadoClienteAssinado = assinar(duplicadoClientePayload);
  const duplicadoCliente = await instagram.processarWebhookInstagram({ payload: duplicadoClientePayload, ...duplicadoClienteAssinado, httpClient: mockHttpClient() });
  assert.strictEqual(duplicadoCliente.resultados[0].status, "ignorado");

  const listaA = instagram.listarInteracoesInstagram("cliente_a");
  const listaB = instagram.listarInteracoesInstagram("cliente_b");
  assert.ok(listaA.some(item => item.instagramCommentId === "comment_1"));
  assert.strictEqual(listaB.some(item => item.instagramCommentId === "comment_1"), false);
  assert.deepStrictEqual(readClienteJson("cliente_b", "social-interacoes.json", []), []);

  console.log("social-instagram-gatilho: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
