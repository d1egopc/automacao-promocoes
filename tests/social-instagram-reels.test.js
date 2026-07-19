const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-reels-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const instagram = require("../modules/social/instagram");
const { publicarNoInstagram } = require("../modules/social/publicador-instagram.service");

const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 2 };

function conectar(clienteId, sufixo = clienteId) {
  writeClienteJson(clienteId, "social-instagram.json", {
    clienteId,
    conectado: true,
    status: "conectado",
    instagramUserId: `ig_${sufixo}`,
    username: `cliente_${sufixo}`,
    token: {
      accessToken: `token_${sufixo}`,
      expiresAt: "2099-01-01T00:00:00.000Z"
    },
    scopes: ["instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_messages"]
  });
}

function salvarFila(clienteId, itens = []) {
  writeClienteJson(clienteId, "fila.json", itens.map(item => ({
    clienteId,
    id: item.id,
    ofertaId: item.ofertaId || item.id,
    titulo: "Oferta com video",
    marketplace: "amazon",
    precoAtual: 100,
    imagem: "https://cdn.optimus.test/oferta.jpg",
    videoUrl: "https://cdn.optimus.test/oferta.mp4",
    videoMimeType: "video/mp4",
    linkAfiliado: `https://go.optimus.test/${item.id}`,
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    ...item
  })));
}

function restaurarEnv(nome, valor) {
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  const statuses = Array.isArray(opcoes.statuses) && opcoes.statuses.length
    ? [...opcoes.statuses]
    : ["FINISHED"];
  return {
    chamadas,
    async post(url, body, config) {
      chamadas.push({ metodo: "post", url, body: String(body || ""), config });
      if (url.endsWith("/media")) {
        if (opcoes.erroContainer) {
          const erro = new Error("container_meta_erro");
          erro.response = { data: { error: { message: "Container recusado", code: 190, type: "OAuthException" } } };
          throw erro;
        }
        return { data: { id: `container_${opcoes.sufixo || "reels"}` } };
      }
      if (url.endsWith("/media_publish")) {
        if (opcoes.erroPublish) {
          const erro = new Error("publish_meta_erro");
          erro.response = { data: { error: { message: "Publish recusado", code: 10, type: "OAuthException" } } };
          throw erro;
        }
        return { data: { id: `media_${opcoes.sufixo || "reels"}` } };
      }
      return { data: {} };
    },
    async get(url, config) {
      chamadas.push({ metodo: "get", url, config });
      if (url.includes("graph.instagram.com/container_")) {
        const status = statuses.length > 1 ? statuses.shift() : statuses[0];
        return { data: { status_code: status, status } };
      }
      return { data: {} };
    }
  };
}

function rendererOk() {
  return async ({ clienteId, ofertaId }) => ({
    imagemUrlPublica: `https://cdn-art.optimus.test/${clienteId}/${ofertaId}/feed.png`,
    hash: "hash_feed",
    templateVersao: 1
  });
}

(async () => {
  conectar("cliente_feed", "feed");
  const httpSemFormato = mockHttpClient({ sufixo: "sem_formato" });
  const semFormato = await publicarNoInstagram({
    clienteId: "cliente_feed",
    origem: "personalizada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/livre.jpg",
    legenda: "Legenda feed",
    httpClient: httpSemFormato,
    polling: POLLING_TESTE
  });
  assert.strictEqual(semFormato.publicacao.formato, "feed", "payload sem formato continua feed");
  assert.ok(httpSemFormato.chamadas.some(chamada => chamada.url.endsWith("/media") && chamada.body.includes("image_url=")));
  assert.ok(!httpSemFormato.chamadas.some(chamada => String(chamada.body || "").includes("media_type=REELS")));

  const httpFeedExplicito = mockHttpClient({ sufixo: "feed_explicito" });
  const feedExplicito = await publicarNoInstagram({
    clienteId: "cliente_feed",
    origem: "personalizada",
    tipoPublicacao: "livre",
    formato: "feed",
    imagemUrl: "https://cdn.optimus.test/feed-explicito.jpg",
    legenda: "Legenda feed explicito",
    httpClient: httpFeedExplicito,
    polling: POLLING_TESTE
  });
  assert.strictEqual(feedExplicito.publicacao.formato, "feed");
  assert.ok(httpFeedExplicito.chamadas.some(chamada => chamada.url.endsWith("/media") && chamada.body.includes("image_url=")));

  conectar("cliente_reels", "reels");
  const httpReels = mockHttpClient({ sufixo: "reels_ok", statuses: ["IN_PROGRESS", "FINISHED"] });
  const reels = await publicarNoInstagram({
    clienteId: "cliente_reels",
    origem: "personalizada",
    tipoPublicacao: "livre",
    formato: "reels",
    videoUrl: "https://cdn.optimus.test/video-reels.mp4",
    mimeType: "video/mp4",
    legenda: "Legenda reels",
    gatilho: { ativo: true, palavra: "promo", respostaPublica: "Chamei no direct.", textoDirect: "Mensagem privada." },
    respostaPublica: "Chamei no direct.",
    mensagemPrivada: "Mensagem privada.",
    redirect: { urlDestino: "https://go.optimus.test/reels" },
    cta: { urlDestino: "https://go.optimus.test/reels" },
    urlDestino: "https://go.optimus.test/reels",
    httpClient: httpReels,
    polling: POLLING_TESTE
  });
  const chamadaContainerReels = httpReels.chamadas.find(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media"));
  assert.ok(chamadaContainerReels.body.includes("media_type=REELS"), "Reels cria container com media_type REELS");
  assert.ok(chamadaContainerReels.body.includes("video_url=https%3A%2F%2Fcdn.optimus.test%2Fvideo-reels.mp4"), "Reels usa video_url");
  assert.ok(!chamadaContainerReels.body.includes("image_url="), "Reels nao usa image_url");
  assert.ok(httpReels.chamadas.some(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media_publish")), "FINISHED libera media_publish");
  assert.strictEqual(reels.publicacao.status, "publicada");
  assert.strictEqual(reels.publicacao.formato, "reels");
  assert.strictEqual(reels.publicacao.instagramMediaId, "media_reels_ok");
  assert.strictEqual(reels.publicacao.videoUrl, "https://cdn.optimus.test/video-reels.mp4");
  assert.strictEqual(reels.publicacao.mensagemPrivadaPresente, true);
  assert.strictEqual(reels.publicacao.redirectPresente, true);
  assert.strictEqual(reels.publicacao.ctaPresente, true);

  const envPrimeiraEspera = process.env.INSTAGRAM_REELS_POLL_PRIMEIRA_ESPERA_MS;
  const envIntervalo = process.env.INSTAGRAM_REELS_POLL_INTERVALO_MS;
  const envMaxTentativas = process.env.INSTAGRAM_REELS_POLL_MAX_TENTATIVAS;
  process.env.INSTAGRAM_REELS_POLL_PRIMEIRA_ESPERA_MS = "0";
  process.env.INSTAGRAM_REELS_POLL_INTERVALO_MS = "0";
  process.env.INSTAGRAM_REELS_POLL_MAX_TENTATIVAS = "4";
  try {
    const httpReelsLento = mockHttpClient({
      sufixo: "reels_lento",
      statuses: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "FINISHED"]
    });
    const reelsLento = await publicarNoInstagram({
      clienteId: "cliente_reels",
      origem: "personalizada",
      tipoPublicacao: "livre",
      formato: "reels",
      videoUrl: "https://cdn.optimus.test/video-reels-lento.mp4",
      mimeType: "video/mp4",
      legenda: "Legenda reels lento",
      httpClient: httpReelsLento
    });
    assert.strictEqual(reelsLento.publicacao.status, "publicada");
    assert.strictEqual(
      httpReelsLento.chamadas.filter(chamada => chamada.metodo === "get" && chamada.url.includes("/container_reels_lento")).length,
      4,
      "polling configuravel continua ate FINISHED"
    );
    assert.ok(httpReelsLento.chamadas.some(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media_publish")));
  } finally {
    restaurarEnv("INSTAGRAM_REELS_POLL_PRIMEIRA_ESPERA_MS", envPrimeiraEspera);
    restaurarEnv("INSTAGRAM_REELS_POLL_INTERVALO_MS", envIntervalo);
    restaurarEnv("INSTAGRAM_REELS_POLL_MAX_TENTATIVAS", envMaxTentativas);
  }

  const httpInProgress = mockHttpClient({ sufixo: "reels_in_progress", statuses: ["IN_PROGRESS"] });
  const inProgress = await publicarNoInstagram({
    clienteId: "cliente_reels",
    origem: "personalizada",
    tipoPublicacao: "livre",
    formato: "reels",
    videoUrl: "https://cdn.optimus.test/in-progress.mp4",
    mimeType: "video/mp4",
    legenda: "Aguardando",
    httpClient: httpInProgress,
    polling: { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 1 }
  });
  assert.strictEqual(inProgress.publicacao.status, "erro");
  assert.strictEqual(inProgress.publicacao.erro.message, "reels_processamento_timeout");
  assert.strictEqual(httpInProgress.chamadas.some(chamada => chamada.url.endsWith("/media_publish")), false, "IN_PROGRESS nao publica");

  for (const [status, erroEsperado] of [
    ["ERROR", "reels_container_erro"],
    ["EXPIRED", "reels_container_expirado"]
  ]) {
    const httpStatus = mockHttpClient({ sufixo: `reels_${status.toLowerCase()}`, statuses: [status] });
    const resultado = await publicarNoInstagram({
      clienteId: "cliente_reels",
      origem: "personalizada",
      tipoPublicacao: "livre",
      formato: "reels",
      videoUrl: `https://cdn.optimus.test/${status.toLowerCase()}.mp4`,
      mimeType: "video/mp4",
      legenda: status,
      httpClient: httpStatus,
      polling: POLLING_TESTE
    });
    assert.strictEqual(resultado.publicacao.status, "erro");
    assert.strictEqual(resultado.publicacao.erro.message, erroEsperado);
    assert.strictEqual(httpStatus.chamadas.some(chamada => chamada.url.endsWith("/media_publish")), false);
  }

  const httpPublishErro = mockHttpClient({ sufixo: "reels_publish_erro", statuses: ["FINISHED"], erroPublish: true });
  const publishErro = await publicarNoInstagram({
    clienteId: "cliente_reels",
    origem: "personalizada",
    tipoPublicacao: "livre",
    formato: "reels",
    videoUrl: "https://cdn.optimus.test/publish-erro.mp4",
    mimeType: "video/mp4",
    legenda: "Erro publish",
    httpClient: httpPublishErro,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publishErro.publicacao.status, "erro");
  assert.strictEqual(publishErro.publicacao.erro.message, "reels_publicacao_meta_erro");

  await assert.rejects(
    () => publicarNoInstagram({
      clienteId: "cliente_reels",
      origem: "personalizada",
      tipoPublicacao: "livre",
      formato: "reels",
      legenda: "Sem video",
      httpClient: mockHttpClient()
    }),
    /reels_video_ausente/
  );
  assert.throws(
    () => instagram.validarVideoReelsPublico("https://cdn.optimus.test/imagem.jpg", { mimeType: "image/jpeg" }),
    /reels_video_invalido/
  );

  conectar("cliente_coexistencia", "coexistencia");
  salvarFila("cliente_coexistencia", [{ id: "oferta_um", ofertaId: "oferta_um" }]);
  const feed = await publicarNoInstagram({
    clienteId: "cliente_coexistencia",
    origem: "manual",
    tipoPublicacao: "oferta",
    formato: "feed",
    ofertaId: "oferta_um",
    templateId: "padrao-instagram",
    renderizadorArte: rendererOk(),
    httpClient: mockHttpClient({ sufixo: "coexist_feed" }),
    polling: POLLING_TESTE
  });
  const reelOferta = await publicarNoInstagram({
    clienteId: "cliente_coexistencia",
    origem: "manual",
    tipoPublicacao: "oferta",
    formato: "reels",
    ofertaId: "oferta_um",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "coexist_reels" }),
    polling: POLLING_TESTE
  });
  const reelDuplicado = await publicarNoInstagram({
    clienteId: "cliente_coexistencia",
    origem: "manual",
    tipoPublicacao: "oferta",
    formato: "reels",
    ofertaId: "oferta_um",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "coexist_reels_duplicado" }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(feed.publicacao.formato, "feed");
  assert.strictEqual(reelOferta.publicacao.formato, "reels");
  assert.strictEqual(reelDuplicado.duplicada, true, "segunda tentativa identica de reels deve ser duplicada");
  const historico = instagram.listarPublicacoesInstagram("cliente_coexistencia");
  assert.ok(historico.some(item => item.formato === "feed"));
  assert.ok(historico.some(item => item.formato === "reels"));

  console.log("social-instagram-reels: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
