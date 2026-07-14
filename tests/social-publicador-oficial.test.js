const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-publicador-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const { publicarNoInstagram } = require("../modules/social/publicador-instagram.service");
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
  const publicadaOferta = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_a",
    templateId: "padrao-instagram",
    idempotencyKey: "cliente_a:oferta_a:manual",
    httpClient: httpOferta,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaOferta.publicacao.status, "publicada");
  assert.strictEqual(publicadaOferta.publicacao.origem, "manual");
  assert.strictEqual(publicadaOferta.publicacao.tipoPublicacao, "oferta");
  assert.strictEqual(publicadaOferta.publicacao.idempotencyKey, "cliente_a:oferta_a:manual");
  assert.ok(httpOferta.chamadas.some(chamada => chamada.url.includes("/ig_a/media")));
  assert.ok(!JSON.stringify(publicadaOferta).includes("token_a"));

  const duplicada = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "oferta_a",
    idempotencyKey: "cliente_a:oferta_a:manual",
    httpClient: mockHttpClient("duplicada"),
    polling: POLLING_TESTE
  });
  assert.strictEqual(duplicada.duplicada, true);
  assert.strictEqual(duplicada.publicacao.id, publicadaOferta.publicacao.id);

  const httpLivre = mockHttpClient("livre");
  const publicadaLivre = await publicarNoInstagram({
    clienteId: "cliente_a",
    origem: "manual",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/campanha.jpg",
    legenda: "Campanha institucional",
    templateId: "livre-instagram",
    httpClient: httpLivre,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaLivre.publicacao.status, "publicada");
  assert.strictEqual(publicadaLivre.publicacao.tipoPublicacao, "livre");
  assert.strictEqual(publicadaLivre.publicacao.ofertaId, "");
  assert.ok(httpLivre.chamadas.some(chamada => chamada.body.includes("Campanha+institucional")));

  await assert.rejects(
    () => publicarNoInstagram({
      clienteId: "cliente_b",
      origem: "manual",
      tipoPublicacao: "oferta",
      ofertaId: "oferta_a",
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
    httpClient: mockHttpClient("auto"),
    polling: POLLING_TESTE
  });
  assert.strictEqual(execAuto.publicado, true);
  assert.strictEqual(execAuto.publicacao.origem, "automatica");
  assert.strictEqual(execAuto.publicacao.ofertaId, "oferta_auto");

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
