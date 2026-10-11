const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-gatilho-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.META_APP_SECRET = "secret_meta_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "verify_optimus";
process.env.META_GRAPH_VERSION = "v20.0";

const instagram = require("../modules/social/instagram");
const { readClienteJson, writeClienteJson } = require("../utils/storage");
const routesFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "social", "routes.js"), "utf8");
const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function assinar(payload) {
  return assinarComSecret(payload, process.env.META_APP_SECRET);
}

function assinarComSecret(payload, secret) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const assinatura = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
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
  writeClienteJson(clienteId, "social-meta.json", {
    clienteId,
    conectado: true,
    token: { accessToken: `meta_user_token_${clienteId}` },
    facebook: {
      conectado: true,
      pageId: `page_${clienteId}`,
      pageName: `Pagina ${clienteId}`
    },
    instagram: {
      conectado: true,
      instagramBusinessAccountId: `iba_${clienteId}`,
      username: `${clienteId}_perfil`
    },
    paginas: [{
      id: `page_${clienteId}`,
      name: `Pagina ${clienteId}`,
      accessToken: `page_token_${clienteId}`,
      instagramBusinessAccountId: `iba_${clienteId}`,
      instagramUsername: `${clienteId}_perfil`,
      conectado: true
    }]
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

function salvarClienteInstagramPersonalizado(clienteId, {
  ig = `ig_${clienteId}`,
  media = `media_${clienteId}`,
  gatilho = null,
  link = "",
  urlDestino = link,
  gravarLinkAfiliado = true,
  mensagemPrivada = "",
  respostaPublica = gatilho?.respostaPublica || ""
} = {}) {
  writeClienteJson(clienteId, "social-instagram.json", {
    clienteId,
    conectado: true,
    instagramUserId: ig,
    username: `${clienteId}_perfil`,
    token: { accessToken: `token_${clienteId}`, expiresAt: "2099-01-01T00:00:00.000Z" },
    scopes: instagram.scopesInstagramConexao()
  });
  writeClienteJson(clienteId, "social-publicacoes.json", [{
    id: `pub_${clienteId}`,
    clienteId,
    rede: "instagram",
    origem: "personalizada",
    tipoPublicacao: "livre",
    status: "publicada",
    ofertaId: "",
    imagemUrl: "https://cdn.optimus.test/personalizada.jpg",
    legenda: "Post personalizado",
    linkAfiliado: gravarLinkAfiliado ? link : "",
    urlDestino,
    mensagemPrivada,
    respostaPublica,
    redirect: urlDestino ? { urlDestino } : null,
    cta: urlDestino ? { urlDestino } : null,
    instagramUserId: ig,
    instagramMediaId: media,
    gatilho
  }]);
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  const permissoes = opcoes.permissoes || [
    { permission: "instagram_business_manage_comments", status: "granted" },
    { permission: "instagram_business_manage_messages", status: "granted" }
  ];
  return {
    chamadas,
    async get(url, config = {}) {
      chamadas.push({ metodo: "get", url, params: config.params || {} });
      if (url.endsWith("/me/permissions")) {
        if (opcoes.erroPermissoes) {
          const erro = new Error("permissoes_indisponiveis");
          erro.response = { data: { error: { code: 190, type: "OAuthException", message: "Cannot inspect token" } } };
          throw erro;
        }
        return { data: { data: permissoes } };
      }
      if (url.includes("/comment_")) {
        if (opcoes.comentarioNaoConsultavel) {
          const erro = new Error("comentario_nao_consultavel");
          erro.response = { data: { error: { code: 100, type: "IGApiException", message: "Unsupported get request" } } };
          throw erro;
        }
        return { data: { id: url.split("/").pop() } };
      }
      throw new Error(`url_inesperada:${url}`);
    },
    async post(url, body) {
      chamadas.push({ metodo: "post", url, body: String(body || "") });
      if (url.endsWith("/replies")) return { data: { id: "reply_1" } };
      if (url.includes("graph.instagram.com") && url.endsWith("/messages")) {
        if (opcoes.erroDirect) {
          const erro = new Error("direct_recusado");
          erro.response = { status: 400, data: { error: { code: 100, type: "OAuthException", message: "Private reply not allowed" } } };
          throw erro;
        }
        return { data: { recipient_id: "recipient_1", message_id: "direct_1" } };
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
  const assinaturaFallback = assinarComSecret(payload, process.env.INSTAGRAM_APP_SECRET);
  assert.strictEqual(instagram.validarAssinaturaWebhookInstagram(assinaturaFallback), true, "fallback com INSTAGRAM_APP_SECRET deve ser aceito durante diagnostico");
  const assinaturaInvalida = assinarComSecret(payload, "secret_errado");
  assert.strictEqual(instagram.validarAssinaturaWebhookInstagram(assinaturaInvalida), false, "assinatura invalida deve falhar contra ambos os secrets");
  assert.strictEqual(instagram.validarAssinaturaWebhookInstagram({ assinatura: "sha256=deadbeef", rawBody }), false);
  const logsOriginais = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  try {
    assert.strictEqual(instagram.validarAssinaturaWebhookInstagram({ assinatura, rawBody }), true);
    assert.strictEqual(instagram.validarAssinaturaWebhookInstagram(assinaturaFallback), true);
    assert.strictEqual(instagram.validarAssinaturaWebhookInstagram(assinaturaInvalida), false);
  } finally {
    console.log = logsOriginais;
  }
  const logsTexto = logs.join("\n");
  assert.ok(logsTexto.includes("[INSTAGRAM-WEBHOOK-SECRET-CORRESPONDENTE]"), "origem do secret correspondente deve ser logada");
  assert.ok(logsTexto.includes("meta_app_secret"), "META_APP_SECRET deve ser priorizado no HMAC");
  assert.ok(logsTexto.includes("instagram_app_secret"), "INSTAGRAM_APP_SECRET deve aparecer somente como fallback correspondente");
  assert.ok(!logsTexto.includes(process.env.META_APP_SECRET), "logs nao devem expor META_APP_SECRET");
  assert.ok(!logsTexto.includes(process.env.INSTAGRAM_APP_SECRET), "logs nao devem expor INSTAGRAM_APP_SECRET");

  const http = mockHttpClient();
  const resultado = await instagram.processarWebhookInstagram({ payload, assinatura, rawBody, httpClient: http });
  assert.strictEqual(resultado.total, 1);
  assert.strictEqual(resultado.resultados[0].status, "respondida");
  assert.strictEqual(http.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 1);
  assert.strictEqual(http.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);
  assert.strictEqual(http.chamadas.filter(chamada => chamada.metodo === "get" && chamada.url.endsWith("/comment_1")).length, 1);
  assert.strictEqual(http.chamadas.filter(chamada => chamada.metodo === "get" && chamada.url.endsWith("/me/permissions")).length, 1);
  const chamadaDirect = http.chamadas.find(chamada => chamada.url.endsWith("/messages"));
  assert.ok(chamadaDirect.url.includes("graph.instagram.com/ig_cliente_a/messages"), "Direct deve usar graph.instagram.com com instagramUserId");
  assert.ok(chamadaDirect.body.includes("access_token=token_cliente_a"), "Direct deve usar Instagram User Access Token");
  assert.ok(chamadaDirect.body.includes("recipient=%7B%22comment_id%22%3A%22comment_1%22%7D"), "payload deve usar recipient.comment_id");
  assert.ok(chamadaDirect.body.includes("https%3A%2F%2Fgo.optimus.test%2Fa%2Foferta"));
  assert.ok(!chamadaDirect.url.includes("page_cliente_a"), "Direct nao deve depender de pageId");
  assert.ok(!chamadaDirect.body.includes("page_token_cliente_a"), "Direct nao deve usar Page Access Token");
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

  const comentarioNaoConsultavelPayload = payloadComentario({ comment: "comment_nao_consultavel" });
  const comentarioNaoConsultavelAssinado = assinar(comentarioNaoConsultavelPayload);
  const httpComentarioNaoConsultavel = mockHttpClient({ comentarioNaoConsultavel: true });
  const comentarioNaoConsultavel = await instagram.processarWebhookInstagram({
    payload: comentarioNaoConsultavelPayload,
    ...comentarioNaoConsultavelAssinado,
    httpClient: httpComentarioNaoConsultavel
  });
  assert.strictEqual(comentarioNaoConsultavel.resultados[0].status, "respondida");
  assert.strictEqual(httpComentarioNaoConsultavel.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);

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
  assert.strictEqual(directErro.resultados[0].interacao.erro.code, 100);
  assert.strictEqual(directErro.resultados[0].interacao.erro.type, "OAuthException");
  assert.ok(!JSON.stringify(directErro.resultados[0].interacao.erro).includes("token_cliente_a"), "erro Graph sanitizado nao deve expor token");
  assert.ok(directErro.resultados[0].interacao.respostaPublicaEnviadaEm);

  const semMensagensPayload = payloadComentario({ comment: "comment_sem_mensagens" });
  const semMensagensAssinado = assinar(semMensagensPayload);
  const httpSemMensagens = mockHttpClient({
    permissoes: [
      { permission: "instagram_business_manage_comments", status: "granted" },
      { permission: "instagram_business_manage_messages", status: "declined" }
    ]
  });
  const semMensagens = await instagram.processarWebhookInstagram({ payload: semMensagensPayload, ...semMensagensAssinado, httpClient: httpSemMensagens });
  assert.strictEqual(semMensagens.resultados[0].status, "respondida");

  const fallbackPermissoesPayload = payloadComentario({ comment: "comment_permissoes_fallback" });
  const fallbackPermissoesAssinado = assinar(fallbackPermissoesPayload);
  const httpFallbackPermissoes = mockHttpClient({ erroPermissoes: true });
  const fallbackPermissoes = await instagram.processarWebhookInstagram({ payload: fallbackPermissoesPayload, ...fallbackPermissoesAssinado, httpClient: httpFallbackPermissoes });
  assert.strictEqual(fallbackPermissoes.resultados[0].status, "respondida");

  const httpRetry = mockHttpClient();
  const retryDirect = await instagram.processarWebhookInstagram({ payload: directErroPayload, ...directErroAssinado, httpClient: httpRetry });
  assert.strictEqual(retryDirect.resultados[0].status, "respondida");
  assert.strictEqual(httpRetry.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 0, "retry de Direct nao deve repetir resposta publica");
  assert.strictEqual(httpRetry.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);

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
  assert.strictEqual(httpConcorrente.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);

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
  assert.strictEqual(httpSemCupom.chamadas.find(chamada => chamada.url.endsWith("/messages")).body.includes("Cupom"), false);

  salvarClienteInstagramPersonalizado("cliente_livre_resposta_sem_link", {
    ig: "ig_livre_resposta_sem_link",
    media: "media_livre_resposta_sem_link",
    link: "",
    gravarLinkAfiliado: false,
    gatilho: {
      ativo: true,
      palavra: "PROMO",
      respostaPublica: "Mensagem publica personalizada."
    }
  });
  const livreRespostaSemLinkPayload = payloadComentario({
    ig: "ig_livre_resposta_sem_link",
    media: "media_livre_resposta_sem_link",
    comment: "comment_livre_resposta_sem_link",
    text: "PROMO"
  });
  const livreRespostaSemLinkAssinado = assinar(livreRespostaSemLinkPayload);
  const httpLivreRespostaSemLink = mockHttpClient();
  const livreRespostaSemLink = await instagram.processarWebhookInstagram({
    payload: livreRespostaSemLinkPayload,
    ...livreRespostaSemLinkAssinado,
    httpClient: httpLivreRespostaSemLink
  });
  assert.strictEqual(livreRespostaSemLink.resultados[0].status, "respondida");
  assert.notStrictEqual(livreRespostaSemLink.resultados[0].interacao?.erro?.message, "oferta_link_ausente");
  assert.strictEqual(httpLivreRespostaSemLink.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 1);
  assert.strictEqual(httpLivreRespostaSemLink.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 0);

  salvarClienteInstagramPersonalizado("cliente_livre_direct_sem_link", {
    ig: "ig_livre_direct_sem_link",
    media: "media_livre_direct_sem_link",
    link: "",
    gravarLinkAfiliado: false,
    mensagemPrivada: "Mensagem privada sem link.",
    gatilho: {
      ativo: true,
      palavra: "PROMO",
      textoDirect: "Mensagem privada sem link."
    }
  });
  const livreDirectSemLinkPayload = payloadComentario({
    ig: "ig_livre_direct_sem_link",
    media: "media_livre_direct_sem_link",
    comment: "comment_livre_direct_sem_link",
    text: "PROMO"
  });
  const livreDirectSemLinkAssinado = assinar(livreDirectSemLinkPayload);
  const httpLivreDirectSemLink = mockHttpClient();
  const livreDirectSemLink = await instagram.processarWebhookInstagram({
    payload: livreDirectSemLinkPayload,
    ...livreDirectSemLinkAssinado,
    httpClient: httpLivreDirectSemLink
  });
  assert.strictEqual(livreDirectSemLink.resultados[0].status, "respondida");
  assert.notStrictEqual(livreDirectSemLink.resultados[0].interacao?.erro?.message, "oferta_link_ausente");
  assert.strictEqual(httpLivreDirectSemLink.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 0);
  assert.strictEqual(httpLivreDirectSemLink.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);
  const directLivreSemLink = httpLivreDirectSemLink.chamadas.find(chamada => chamada.url.endsWith("/messages"));
  assert.ok(directLivreSemLink.body.includes("Mensagem+privada+sem+link"));
  assert.ok(!directLivreSemLink.body.includes("Link%3A"));
  assert.ok(!directLivreSemLink.body.includes("https%3A%2F%2Fgo.optimus.test"));

  salvarClienteInstagramPersonalizado("cliente_livre_sem_acao_configurada", {
    ig: "ig_livre_sem_acao_configurada",
    media: "media_livre_sem_acao_configurada",
    link: "",
    gravarLinkAfiliado: false,
    gatilho: {
      ativo: true,
      palavra: "PROMO"
    }
  });
  const livreSemAcaoPayload = payloadComentario({
    ig: "ig_livre_sem_acao_configurada",
    media: "media_livre_sem_acao_configurada",
    comment: "comment_livre_sem_acao_configurada",
    text: "PROMO"
  });
  const livreSemAcaoAssinado = assinar(livreSemAcaoPayload);
  const httpLivreSemAcao = mockHttpClient();
  const livreSemAcao = await instagram.processarWebhookInstagram({
    payload: livreSemAcaoPayload,
    ...livreSemAcaoAssinado,
    httpClient: httpLivreSemAcao
  });
  assert.strictEqual(livreSemAcao.resultados[0].status, "ignorado");
  assert.strictEqual(livreSemAcao.resultados[0].interacao.erro.message, "acao_configurada_ausente");
  assert.strictEqual(httpLivreSemAcao.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 0);
  assert.strictEqual(httpLivreSemAcao.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 0);

  salvarClienteInstagramPersonalizado("cliente_livre_sem_conversao", {
    ig: "ig_livre_sem_conversao",
    media: "media_livre_sem_conversao"
  });
  const livreSemConversaoPayload = payloadComentario({
    ig: "ig_livre_sem_conversao",
    media: "media_livre_sem_conversao",
    comment: "comment_livre_sem_conversao",
    text: "PROMO"
  });
  const livreSemConversaoAssinado = assinar(livreSemConversaoPayload);
  const httpLivreSemConversao = mockHttpClient();
  const livreSemConversao = await instagram.processarWebhookInstagram({
    payload: livreSemConversaoPayload,
    ...livreSemConversaoAssinado,
    httpClient: httpLivreSemConversao
  });
  assert.strictEqual(livreSemConversao.resultados[0].status, "ignorado");
  assert.strictEqual(livreSemConversao.resultados[0].interacao.erro.message, "gatilho_inativo");
  assert.strictEqual(httpLivreSemConversao.chamadas.length, 0, "personalizada sem conversao nao deve responder nem enviar Direct");

  salvarClienteInstagramPersonalizado("cliente_livre_com_conversao", {
    ig: "ig_livre_com_conversao",
    media: "media_livre_com_conversao",
    link: "https://go.optimus.test/personalizada",
    mensagemPrivada: "Mensagem privada personalizada:",
    gatilho: {
      ativo: true,
      palavra: "PROMO",
      respostaPublica: "Te chamei no Direct.",
      textoDirect: "Mensagem privada personalizada:"
    }
  });
  const livreComConversaoPayload = payloadComentario({
    ig: "ig_livre_com_conversao",
    media: "media_livre_com_conversao",
    comment: "comment_livre_com_conversao",
    text: "promo"
  });
  const livreComConversaoAssinado = assinar(livreComConversaoPayload);
  const httpLivreComConversao = mockHttpClient();
  const livreComConversao = await instagram.processarWebhookInstagram({
    payload: livreComConversaoPayload,
    ...livreComConversaoAssinado,
    httpClient: httpLivreComConversao
  });
  assert.strictEqual(livreComConversao.resultados[0].status, "respondida");
  assert.strictEqual(httpLivreComConversao.chamadas.filter(chamada => chamada.url.endsWith("/replies")).length, 1);
  assert.strictEqual(httpLivreComConversao.chamadas.filter(chamada => chamada.url.endsWith("/messages")).length, 1);
  const directLivre = httpLivreComConversao.chamadas.find(chamada => chamada.url.endsWith("/messages"));
  assert.ok(directLivre.url.includes("graph.instagram.com/ig_livre_com_conversao/messages"));
  assert.ok(directLivre.body.includes("recipient=%7B%22comment_id%22%3A%22comment_livre_com_conversao%22%7D"));
  assert.ok(directLivre.body.includes("Mensagem+privada+personalizada"));
  assert.ok(directLivre.body.includes("https%3A%2F%2Fgo.optimus.test%2Fpersonalizada"));

  salvarClienteInstagramPersonalizado("cliente_livre_url_destino", {
    ig: "ig_livre_url_destino",
    media: "media_livre_url_destino",
    link: "",
    urlDestino: "https://go.optimus.test/url-destino",
    gravarLinkAfiliado: false,
    mensagemPrivada: "Mensagem por urlDestino:",
    gatilho: {
      ativo: true,
      palavra: "PROMO",
      respostaPublica: "Te chamei no Direct.",
      textoDirect: "Mensagem por urlDestino:"
    }
  });
  const livreUrlDestinoPayload = payloadComentario({
    ig: "ig_livre_url_destino",
    media: "media_livre_url_destino",
    comment: "comment_livre_url_destino",
    text: "PROMO"
  });
  const livreUrlDestinoAssinado = assinar(livreUrlDestinoPayload);
  const httpLivreUrlDestino = mockHttpClient();
  const livreUrlDestino = await instagram.processarWebhookInstagram({
    payload: livreUrlDestinoPayload,
    ...livreUrlDestinoAssinado,
    httpClient: httpLivreUrlDestino
  });
  assert.notStrictEqual(livreUrlDestino.resultados[0].interacao?.erro?.message, "oferta_link_ausente");
  assert.strictEqual(livreUrlDestino.resultados[0].status, "respondida");
  const directUrlDestino = httpLivreUrlDestino.chamadas.find(chamada => chamada.url.endsWith("/messages"));
  assert.ok(directUrlDestino.body.includes("https%3A%2F%2Fgo.optimus.test%2Furl-destino"));

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
