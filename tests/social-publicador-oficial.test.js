const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-publicador-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const { publicarNoInstagram, normalizarOrigem } = require("../modules/social/publicador-instagram.service");
const {
  executarAgendamentosPendentesCliente,
  executarAutomaticoCliente,
  simularSelecaoAutomatica
} = require("../modules/social/automatico.service");
const socialMediaStorage = require("../modules/social/social-media-storage");

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

function oferta(item = {}) {
  return {
    id: "oferta_a",
    marketplace: "amazon",
    titulo: "Produto A",
    precoAtual: 100,
    cupom: "PROMO10",
    score: 90,
    categoria: "eletronicos",
    imagem: "https://cdn.optimus.test/produto-a.jpg",
    linkAfiliado: "https://go.optimus.test/a",
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    criadoEm: "2026-07-14T10:00:00.000Z",
    ...item
  };
}

function mockHttpClient(sufixo = "ok") {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body) {
      chamadas.push({ metodo: "post", url, body: String(body || "") });
      if (url.endsWith("/media")) return { data: { id: `container_${sufixo}` } };
      if (url.endsWith("/media_publish")) return { data: { id: `media_${sufixo}` } };
      return { data: {} };
    },
    async get(url) {
      chamadas.push({ metodo: "get", url });
      if (url.includes(`/container_${sufixo}`)) return { data: { status_code: "FINISHED" } };
      return { data: {} };
    }
  };
}

function rendererOk(sufixo = "render") {
  const chamadas = [];
  const fn = async ({ clienteId, ofertaId, oferta, templateId, gatilho }) => {
    chamadas.push({ clienteId, ofertaId, oferta, templateId, gatilho });
    return {
      ok: true,
      imagemUrlPublica: `https://cdn-art.optimus.test/${clienteId}/${ofertaId}/${sufixo}.png`,
      hash: `hash_${sufixo}`,
      templateVersao: 1,
      cache: false
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

function restaurarEnv(nome, valorAnterior) {
  if (valorAnterior === undefined) {
    delete process.env[nome];
    return;
  }
  process.env[nome] = valorAnterior;
}

(async () => {
  conectar("cliente_a", "a");
  conectar("cliente_b", "b");
  writeClienteJson("cliente_a", "fila.json", [
    oferta({ id: "oferta_a", ofertaId: "oferta_a", score: 92, cupom: "CUPOM10" }),
    oferta({
      id: "oferta_b",
      ofertaId: "oferta_b",
      produtoId: "produto_b",
      score: 99,
      cupom: "",
      titulo: "Produto B",
      imagem: "https://cdn.optimus.test/produto-b.jpg",
      linkAfiliado: "https://go.optimus.test/b",
      linkOriginal: "https://amazon.test/produto-b"
    })
  ]);
  writeClienteJson("cliente_b", "fila.json", [
    oferta({ id: "oferta_cliente_b", ofertaId: "oferta_cliente_b", linkAfiliado: "https://go.optimus.test/b" })
  ]);

  const httpOferta = mockHttpClient("oferta");
  const renderOferta = rendererOk("oferta");
  const legendaCustom = "Legenda custom da oferta";
  const publicadaOferta = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_a",
    templateId: "padrao-instagram",
    legenda: legendaCustom,
    idempotencyKey: "cliente_a:oferta_a:manual",
    renderizadorArte: renderOferta,
    httpClient: httpOferta,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaOferta.publicacao.status, "publicada");
  assert.strictEqual(publicadaOferta.publicacao.origem, "manual");
  assert.strictEqual(publicadaOferta.publicacao.tipoPublicacao, "oferta");
  assert.strictEqual(publicadaOferta.publicacao.legenda, legendaCustom, "publicador oficial nao deve descartar legenda recebida");
  assert.strictEqual(publicadaOferta.publicacao.renderizado, true, "publicacao de oferta deve usar arte renderizada");
  assert.strictEqual(publicadaOferta.publicacao.imagemOriginalUrl, "https://cdn.optimus.test/produto-a.jpg");
  assert.strictEqual(publicadaOferta.publicacao.imagemPublicadaUrl, "https://cdn-art.optimus.test/cliente_a/oferta_a/oferta.png");
  assert.strictEqual(renderOferta.chamadas.length, 1);
  assert.strictEqual(renderOferta.chamadas[0].oferta.imagem, "https://cdn.optimus.test/produto-a.jpg");
  assert.strictEqual(publicadaOferta.publicacao.idempotencyKey, "cliente_a:oferta_a:manual");
  assert.ok(httpOferta.chamadas.some(chamada => chamada.url.includes("/ig_a/media")));
  assert.ok(
    httpOferta.chamadas.some(chamada => chamada.url.includes("/ig_a/media") && chamada.body.includes("caption=Legenda+custom+da+oferta")),
    "criacao do container deve enviar caption junto com image_url"
  );
  assert.ok(
    httpOferta.chamadas.some(chamada => chamada.url.includes("/ig_a/media") && chamada.body.includes("image_url=https%3A%2F%2Fcdn-art.optimus.test%2Fcliente_a%2Foferta_a%2Foferta.png")),
    "criacao do container deve enviar image_url renderizada"
  );
  assert.ok(!httpOferta.chamadas.some(chamada => chamada.url.includes("/ig_a/media") && chamada.body.includes("cdn.optimus.test%2Fproduto-a.jpg")), "imagem original nao deve ser publicada quando existe arte renderizada");
  assert.ok(!JSON.stringify(publicadaOferta).includes("token_a"));

  conectar("cliente_legenda_vazia", "legenda_vazia");
  writeClienteJson("cliente_legenda_vazia", "fila.json", [
    oferta({
      id: "oferta_legenda_vazia",
      ofertaId: "oferta_legenda_vazia",
      produtoId: "produto_legenda_vazia",
      titulo: "Produto Legenda Vazia",
      imagem: "https://cdn.optimus.test/legenda-vazia.jpg",
      linkAfiliado: "https://go.optimus.test/legenda-vazia"
    })
  ]);
  const httpLegendaVazia = mockHttpClient("legenda_vazia");
  const renderLegendaVazia = rendererOk("legenda_vazia");
  const publicadaLegendaVazia = await publicarNoInstagram({
    clienteId: "cliente_legenda_vazia",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_legenda_vazia",
    legenda: "",
    renderizadorArte: renderLegendaVazia,
    httpClient: httpLegendaVazia,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaLegendaVazia.publicacao.status, "publicada");
  assert.ok(
    publicadaLegendaVazia.publicacao.legenda.includes("Produto Legenda Vazia"),
    "legenda vazia deve usar comportamento padrao existente"
  );
  assert.ok(
    httpLegendaVazia.chamadas.some(chamada => chamada.url.includes("/ig_legenda_vazia/media") && chamada.body.includes("caption=Produto+Legenda+Vazia")),
    "legenda padrao deve ir como caption quando a legenda do payload vier vazia"
  );

  conectar("cliente_renderer_erro", "renderer_erro");
  writeClienteJson("cliente_renderer_erro", "fila.json", [
    oferta({
      id: "oferta_renderer_erro",
      ofertaId: "oferta_renderer_erro",
      produtoId: "produto_renderer_erro",
      titulo: "Produto Renderer Erro",
      imagem: "https://cdn.optimus.test/renderer-erro.jpg",
      linkAfiliado: "https://go.optimus.test/renderer-erro"
    })
  ]);
  const httpRendererErro = mockHttpClient("renderer_erro");
  const publicadaRendererErro = await publicarNoInstagram({
    clienteId: "cliente_renderer_erro",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_renderer_erro",
    renderizadorArte: async () => { throw new Error("renderer_indisponivel"); },
    httpClient: httpRendererErro,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaRendererErro.publicacao.status, "erro");
  assert.strictEqual(publicadaRendererErro.publicacao.renderizado, false);
  assert.strictEqual(publicadaRendererErro.publicacao.imagemOriginalUrl, "https://cdn.optimus.test/renderer-erro.jpg");
  assert.ok(publicadaRendererErro.publicacao.erro.message.includes("renderer_indisponivel"));
  assert.ok(!httpRendererErro.chamadas.some(chamada => chamada.url.includes("/media")), "falha de renderer nao deve publicar imagem original");

  const duplicada = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_a",
    idempotencyKey: "cliente_a:oferta_a:manual",
    renderizadorArte: rendererOk("duplicada"),
    httpClient: mockHttpClient("duplicada"),
    polling: POLLING_TESTE
  });
  assert.strictEqual(duplicada.duplicada, true);
  assert.strictEqual(duplicada.publicacao.id, publicadaOferta.publicacao.id);

  const httpLivre = mockHttpClient("livre");
  const publicadaLivre = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "personalizada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/campanha.jpg",
    legenda: "Campanha institucional",
    templateId: "livre-instagram",
    gatilho: { ativo: true, palavra: "promo", respostaPublica: "Respondi no direct." },
    mensagemPrivada: "Mensagem privada livre.",
    urlDestino: "https://go.optimus.test/livre",
    redirect: { urlDestino: "https://go.optimus.test/livre" },
    cta: { urlDestino: "https://go.optimus.test/livre" },
    httpClient: httpLivre,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaLivre.publicacao.status, "publicada");
  assert.strictEqual(publicadaLivre.publicacao.rede, "instagram");
  assert.strictEqual(publicadaLivre.publicacao.origem, "personalizada");
  assert.strictEqual(publicadaLivre.publicacao.tipoPublicacao, "livre");
  assert.strictEqual(publicadaLivre.publicacao.ofertaId, "");
  assert.strictEqual(publicadaLivre.publicacao.imagemUrl, "https://cdn.optimus.test/campanha.jpg");
  assert.strictEqual(publicadaLivre.publicacao.imagemPublicadaUrl, "https://cdn.optimus.test/campanha.jpg");
  assert.strictEqual(publicadaLivre.publicacao.legenda, "Campanha institucional");
  assert.strictEqual(publicadaLivre.publicacao.respostaPublica, "Respondi no direct.");
  assert.strictEqual(publicadaLivre.publicacao.urlDestino, "https://go.optimus.test/livre");
  assert.strictEqual(publicadaLivre.publicacao.mensagemPrivadaPresente, true);
  assert.strictEqual(publicadaLivre.publicacao.redirectPresente, true);
  assert.strictEqual(publicadaLivre.publicacao.ctaPresente, true);
  assert.ok(httpLivre.chamadas.some(chamada => chamada.body.includes("Campanha+institucional")));
  assert.ok(httpLivre.chamadas.some(chamada => chamada.body.includes("image_url=https%3A%2F%2Fcdn.optimus.test%2Fcampanha.jpg")));
  assert.strictEqual(normalizarOrigem("personalizada"), "personalizada");

  const httpLivreSemConversao = mockHttpClient("livre_sem_conversao");
  const publicadaLivreSemConversao = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "personalizada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/livre-sem-conversao.jpg",
    legenda: "Campanha sem conversao",
    templateId: "livre-instagram",
    httpClient: httpLivreSemConversao,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaLivreSemConversao.publicacao.status, "publicada");
  assert.strictEqual(publicadaLivreSemConversao.publicacao.tipoPublicacao, "livre");
  assert.strictEqual(publicadaLivreSemConversao.publicacao.gatilho, null);
  assert.strictEqual(publicadaLivreSemConversao.publicacao.urlDestino, "");
  assert.strictEqual(publicadaLivreSemConversao.publicacao.mensagemPrivadaPresente, false);

  await assert.rejects(
    () => publicarNoInstagram({
      clienteId: "cliente_b",
      origem: "manual",
      tipoPublicacao: "oferta",
      ofertaId: "oferta_a",
      renderizadorArte: rendererOk("isolamento"),
      httpClient: mockHttpClient("isolamento"),
      polling: POLLING_TESTE
    }),
    /oferta_nao_encontrada/
  );

  const config = storage.setConfigAutomaticoSocial("cliente_a", {
    ativo: true,
    quantidadeDiaria: 10,
    intervaloMinimoMinutos: 15,
    scoreMinimo: 70,
    exigirCupom: true,
    evitarProdutoRepetidoDias: 1,
    janelaFuncionamento: { inicio: "00:00", fim: "23:59" }
  });
  assert.strictEqual(config.ativo, true);
  const simulado = simularSelecaoAutomatica({
    clienteId: "cliente_a",
    agora: new Date("2026-07-14T12:00:00.000Z")
  });
  assert.strictEqual(simulado.publicaria, false, "oferta com cupom ja publicada deve ser bloqueada por repeticao");
  assert.ok(simulado.diagnostico.some(item => item.ofertaId === "oferta_a" && item.motivos.includes("repetida")));
  assert.ok(simulado.diagnostico.some(item => item.ofertaId === "oferta_b" && item.motivos.includes("sem_cupom")));

  assert.throws(
    () => socialMediaStorage.salvar({
      clienteId: "cliente_a",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]),
      mimeType: "image/jpeg"
    }),
    /social_media_storage_nao_configurado/
  );

  const storageMidiaDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-midia-"));
  const envStorageDir = process.env.SOCIAL_MEDIA_STORAGE_DIR;
  const envStorageBase = process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL;
  const envStorageMax = process.env.SOCIAL_MEDIA_MAX_BYTES;
  process.env.SOCIAL_MEDIA_STORAGE_DIR = storageMidiaDir;
  process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL = "https://cdn-media.optimus.test/social/";
  process.env.SOCIAL_MEDIA_MAX_BYTES = String(1024 * 1024);
  const pngMinimo = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const midiaSalva = socialMediaStorage.salvar({
    clienteId: "cliente_a",
    buffer: pngMinimo,
    mimeType: "image/png",
    nomeLogico: "publicacao_personalizada"
  });
  assert.strictEqual(midiaSalva.mimeType, "image/png");
  assert.strictEqual(midiaSalva.bytes, pngMinimo.length);
  assert.ok(midiaSalva.url.startsWith("https://cdn-media.optimus.test/social/cliente_a/publicacao_personalizada_"));
  restaurarEnv("SOCIAL_MEDIA_STORAGE_DIR", envStorageDir);
  restaurarEnv("SOCIAL_MEDIA_PUBLIC_BASE_URL", envStorageBase);
  restaurarEnv("SOCIAL_MEDIA_MAX_BYTES", envStorageMax);

  conectar("cliente_auto", "auto");
  writeClienteJson("cliente_auto", "fila.json", [
    oferta({
      id: "oferta_auto",
      ofertaId: "oferta_auto",
      produtoId: "produto_auto",
      cupom: "AUTO10",
      linkAfiliado: "https://go.optimus.test/auto",
      imagem: "https://cdn.optimus.test/auto.jpg"
    })
  ]);
  storage.setConfigAutomaticoSocial("cliente_auto", {
    ativo: true,
    quantidadeDiaria: 10,
    intervaloMinimoMinutos: 15,
    scoreMinimo: 70,
    exigirCupom: true,
    evitarProdutoRepetidoDias: 1,
    janelaFuncionamento: { inicio: "00:00", fim: "23:59" }
  });
  const execAuto = await executarAutomaticoCliente({
    clienteId: "cliente_auto",
    agora: new Date("2026-07-14T12:00:00.000Z"),
    renderizadorArte: rendererOk("auto"),
    httpClient: mockHttpClient("auto"),
    polling: POLLING_TESTE
  });
  assert.strictEqual(execAuto.publicado, true);
  assert.strictEqual(execAuto.publicacao.origem, "automatica");
  assert.strictEqual(execAuto.publicacao.ofertaId, "oferta_auto");
  assert.strictEqual(execAuto.publicacao.renderizado, true);

  conectar("cliente_agendada", "agendada");
  const agendamento = storage.salvarAgendamentoSocial("cliente_agendada", {
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/agendada.jpg",
    legenda: "Post agendado",
    agendadoPara: "2026-07-14T10:00:00.000Z",
    status: "pendente"
  });
  const execAgendada = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_agendada",
    agora: new Date("2026-07-14T12:00:00.000Z"),
    httpClient: mockHttpClient("agendada"),
    polling: POLLING_TESTE
  });
  assert.strictEqual(execAgendada.executados.length, 1);
  assert.strictEqual(execAgendada.executados[0].status, "publicada");
  const agendamentosDepois = storage.listarAgendamentosSocial("cliente_agendada");
  assert.strictEqual(agendamentosDepois.find(item => item.id === agendamento.id).status, "publicada");

  console.log("social-publicador-oficial: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
