const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-rascunhos-"));
process.env.DATA_DIR = dataDir;

const { readClienteJson, writeClienteJson, writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const {
  executarAgendamentosPendentesTodosClientes,
  publicarAgendamentoAgora
} = require("../modules/social/automatico.service");

const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 2 };
const usuariosTeste = new Map();

function registrarUsuarioAtivo(clienteId) {
  usuariosTeste.set(clienteId, { id: clienteId, ativo: true });
  writeGlobalJson("usuarios.json", Array.from(usuariosTeste.values()));
}

function conectar(clienteId, sufixo = clienteId) {
  registrarUsuarioAtivo(clienteId);
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
  assert.strictEqual(rascunho.formato, "feed", "rascunho antigo sem formato deve assumir feed");
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
    formato: "reels",
    imagemUrl: "https://cdn.optimus.test/status-rascunho.jpg",
    legenda: "Status rascunho nao permitido em agenda",
    status: "rascunho",
    ativo: false,
    agendadoPara: "2099-01-01T10:00:00.000Z"
  });
  assert.strictEqual(agendamentoComStatusRascunho.status, "pendente", "agendamento nao deve ser classificado como rascunho");
  assert.strictEqual(agendamentoComStatusRascunho.formato, "reels", "agendamento preserva formato informado");

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
  assert.strictEqual(agendamento.formato, "feed");
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


  storage.registrarPublicacaoSocial("cliente_limpeza_agenda", {
    id: "pub_real_preservada",
    origem: "agendada",
    tipoPublicacao: "livre",
    status: "publicada",
    instagramMediaId: "media_real_preservada",
    imagemUrl: "https://cdn.optimus.test/publicada.jpg"
  });
  writeClienteJson("cliente_limpeza_agenda", "fila.json", [{ ofertaId: "fila_preservada" }]);
  writeClienteJson("cliente_limpeza_agenda", "social-oportunidades.json", [{ ofertaId: "oportunidade_preservada" }]);
  storage.salvarAgendamentoSocial("cliente_limpeza_agenda", {
    id: "agenda_erro",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/erro.jpg",
    legenda: "Erro",
    status: "erro",
    ativo: false,
    agendadoPara: "2099-01-01T10:00:00.000Z"
  });
  storage.salvarAgendamentoSocial("cliente_limpeza_agenda", {
    id: "agenda_cancelada",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/cancelada.jpg",
    legenda: "Cancelada",
    status: "cancelada",
    ativo: false,
    agendadoPara: "2099-01-01T11:00:00.000Z"
  });
  storage.salvarAgendamentoSocial("cliente_limpeza_agenda", {
    id: "agenda_publicada",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/publicada-local.jpg",
    legenda: "Publicada local",
    status: "publicada",
    ativo: false,
    agendadoPara: "2099-01-01T12:00:00.000Z"
  });
  storage.salvarAgendamentoSocial("cliente_limpeza_agenda", {
    id: "agenda_futura",
    origem: "automatico",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/futura.jpg",
    legenda: "Futura",
    status: "agendada",
    ativo: true,
    agendadoPara: "2099-01-01T13:00:00.000Z"
  });

  assert.strictEqual(storage.limparAgendamentosSocial("cliente_limpeza_agenda", "erro").removidos, 1, "limpar erro remove somente erros");
  assert.strictEqual(storage.getAgendamentoSocial("cliente_limpeza_agenda", "agenda_erro"), null);
  assert.ok(storage.getAgendamentoSocial("cliente_limpeza_agenda", "agenda_cancelada"), "cancelada permanece apos limpar erro");

  assert.strictEqual(storage.limparAgendamentosSocial("cliente_limpeza_agenda", "cancelada").removidos, 1, "limpar cancelada remove somente canceladas");
  assert.strictEqual(storage.getAgendamentoSocial("cliente_limpeza_agenda", "agenda_cancelada"), null);

  assert.strictEqual(storage.limparAgendamentosSocial("cliente_limpeza_agenda", "publicada").removidos, 1, "limpar publicada remove apenas registro local da agenda");
  assert.strictEqual(storage.getAgendamentoSocial("cliente_limpeza_agenda", "agenda_publicada"), null);
  assert.ok(storage.listarPublicacoesSocial("cliente_limpeza_agenda").some(item => item.id === "pub_real_preservada"), "publicacao real permanece no historico");

  assert.strictEqual(storage.limparAgendamentosSocial("cliente_limpeza_agenda", "agendada").removidos, 1, "limpar agendada remove ativos futuros");
  assert.strictEqual(storage.getAgendamentoSocial("cliente_limpeza_agenda", "agenda_futura"), null, "agendada removida nao executa futuramente");
  assert.ok(readClienteJson("cliente_limpeza_agenda", "fila.json", []).some(item => item.ofertaId === "fila_preservada"), "fila oficial permanece intacta");
  assert.ok(readClienteJson("cliente_limpeza_agenda", "social-oportunidades.json", []).some(item => item.ofertaId === "oportunidade_preservada"), "oportunidades permanecem intactas");

  storage.salvarAgendamentoSocial("cliente_limpeza_tudo", {
    id: "agenda_tudo_erro",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/tudo-erro.jpg",
    legenda: "Tudo erro",
    status: "erro",
    ativo: false,
    agendadoPara: "2099-01-01T10:00:00.000Z"
  });
  storage.salvarAgendamentoSocial("cliente_limpeza_tudo", {
    id: "agenda_tudo_futura",
    origem: "agendada",
    tipoPublicacao: "livre",
    imagemUrl: "https://cdn.optimus.test/tudo-futura.jpg",
    legenda: "Tudo futura",
    status: "agendada",
    ativo: true,
    agendadoPara: "2099-01-01T11:00:00.000Z"
  });
  assert.strictEqual(storage.limparAgendamentosSocial("cliente_limpeza_tudo", "tudo").removidos, 2, "limpar tudo remove todos os agendamentos");
  assert.strictEqual(storage.listarAgendamentosSocial("cliente_limpeza_tudo").length, 0, "limpar tudo zera social-agendamentos.json");
  const removido = storage.removerRascunhoSocial("cliente_a", rascunho.id);
  assert.strictEqual(removido.id, rascunho.id);
  assert.strictEqual(storage.getRascunhoSocial("cliente_a", rascunho.id), null);

  console.log("social-rascunhos-agenda: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
