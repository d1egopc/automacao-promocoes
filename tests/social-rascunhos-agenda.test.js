const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-rascunhos-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const {
  executarAgendamentosPendentesTodosClientes,
  publicarAgendamentoAgora
} = require("../modules/social/automatico.service");

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

  const rascunho = storage.salvarRascunhoSocial("cliente_a", {
    origem: "personalizada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/livre-a.jpg",
    legenda: "Legenda personalizada",
    gatilho: { ativo: true, palavra: "promo", respostaPublica: "Chamei no direct.", textoDirect: "Mensagem privada do rascunho." },
    respostaPublica: "Chamei no direct.",
    mensagemPrivada: "Mensagem privada do rascunho.",
    urlDestino: "https://go.optimus.test/rascunho",
    linkAfiliado: "https://go.optimus.test/rascunho",
    direct: { habilitado: true },
    redirect: { destino: "bio", urlDestino: "https://go.optimus.test/rascunho" },
    cta: { destino: "bio", urlDestino: "https://go.optimus.test/rascunho" }
  });

  assert.strictEqual(rascunho.clienteId, "cliente_a");
  assert.strictEqual(rascunho.origem, "personalizada");
  assert.strictEqual(rascunho.tipoPublicacao, "livre");
  assert.strictEqual(rascunho.status, "rascunho");
  assert.strictEqual(rascunho.templateId, "livre-instagram");
  assert.strictEqual(rascunho.mensagemPrivada, "Mensagem privada do rascunho.");
  assert.strictEqual(rascunho.urlDestino, "https://go.optimus.test/rascunho");
  assert.strictEqual(rascunho.linkAfiliado, "https://go.optimus.test/rascunho");
  assert.strictEqual(storage.listarRascunhosSocial("cliente_b").length, 0, "rascunho nao pode vazar para outro cliente");
  assert.strictEqual(storage.listarAgendamentosSocial("cliente_a").some(item => item.id === rascunho.id), false, "salvar rascunho nao deve criar agendamento");

  const agendamentoComStatusRascunho = storage.salvarAgendamentoSocial("cliente_a", {
    id: "agendamento_status_rascunho",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/status-rascunho.jpg",
    legenda: "Status rascunho nao permitido em agenda",
    status: "rascunho",
    ativo: false,
    agendadoPara: "2099-01-01T10:00:00.000Z"
  });
  assert.strictEqual(agendamentoComStatusRascunho.status, "pendente", "agendamento nao deve ser classificado como rascunho");

  const editado = storage.salvarRascunhoSocial("cliente_a", {
    ...rascunho,
    legenda: "Legenda editada"
  });
  assert.strictEqual(editado.id, rascunho.id);
  assert.strictEqual(editado.legenda, "Legenda editada");

  const agendamento = storage.salvarAgendamentoSocial("cliente_a", {
    ...editado,
    origem: "agendada",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T10:00:00.000Z"
  });
  assert.strictEqual(agendamento.tipoPublicacao, "livre");
  assert.strictEqual(agendamento.templateId, "livre-instagram");
  assert.strictEqual(agendamento.status, "agendada");
  assert.strictEqual(agendamento.mensagemPrivada, "Mensagem privada do rascunho.");
  assert.strictEqual(agendamento.urlDestino, "https://go.optimus.test/rascunho");
  assert.strictEqual(agendamento.linkAfiliado, "https://go.optimus.test/rascunho");
  assert.ok(storage.listarAgendamentosSocial("cliente_a").some(item => item.id === agendamento.id), "agendamento deve aparecer em agendamentos");

  const httpAgora = mockHttpClient("agenda_a");
  const publicadoAgora = await publicarAgendamentoAgora({
    clienteId: "cliente_a",
    agendamentoId: agendamento.id,
    httpClient: httpAgora,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadoAgora.ok, true);
  assert.strictEqual(publicadoAgora.publicacao.status, "publicada");
  assert.strictEqual(publicadoAgora.publicacao.tipoPublicacao, "livre");
  assert.strictEqual(publicadoAgora.publicacao.origem, "agendada");
  assert.strictEqual(publicadoAgora.publicacao.imagemUrl, "https://cdn.optimus.test/livre-a.jpg");
  assert.strictEqual(publicadoAgora.publicacao.urlDestino, "https://go.optimus.test/rascunho");
  assert.strictEqual(publicadoAgora.publicacao.mensagemPrivadaPresente, true);
  assert.ok(httpAgora.chamadas.some(chamada => chamada.body.includes("caption=Legenda+editada")));
  assert.ok(storage.listarAgendamentosSocial("cliente_a").find(item => item.id === agendamento.id && item.status === "publicada"));

  storage.salvarAgendamentoSocial("cliente_b", {
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/livre-b.jpg",
    legenda: "Legenda B",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T09:00:00.000Z"
  });
  storage.salvarAgendamentoSocial("cliente_a", {
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/futuro.jpg",
    legenda: "Futuro",
    status: "agendada",
    ativo: true,
    agendadoPara: "2099-01-01T09:00:00.000Z"
  });

  const httpScheduler = mockHttpClient("agenda_b");
  const rodada = await executarAgendamentosPendentesTodosClientes({
    agora: new Date("2026-07-14T12:00:00.000Z"),
    httpClient: httpScheduler,
    polling: POLLING_TESTE
  });
  assert.strictEqual(rodada.ok, true);
  assert.strictEqual(rodada.totalExecutados, 1);
  assert.ok(rodada.resultados.some(item => item.clienteId === "cliente_b" && item.executados.length === 1));
  assert.ok(!rodada.resultados.some(item => item.clienteId === "cliente_a" && item.executados.some(exec => exec.status === "publicada")), "scheduler nao deve republicar agendamento ja publicado nem futuro");

  const removido = storage.removerRascunhoSocial("cliente_a", rascunho.id);
  assert.strictEqual(removido.id, rascunho.id);
  assert.strictEqual(storage.getRascunhoSocial("cliente_a", rascunho.id), null);

  console.log("social-rascunhos-agenda: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
