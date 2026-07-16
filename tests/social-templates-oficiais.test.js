const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-templates-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const { publicarNoInstagram } = require("../modules/social/publicador-instagram.service");
const { executarAutomaticoCliente } = require("../modules/social/automatico.service");
const { resolverTemplateSocial } = require("../modules/social/templates/resolver");

const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 2 };
const AGORA = new Date("2026-07-14T12:00:00.000Z");

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
    scopes: [
      "instagram_business_content_publish",
      "instagram_business_manage_comments",
      "instagram_business_manage_messages"
    ]
  });
}

function oferta(id, dados = {}) {
  return {
    id,
    ofertaId: id,
    produtoId: `produto_${id}`,
    marketplace: "amazon",
    titulo: `Produto ${id}`,
    precoAtual: 100,
    precoOriginal: 140,
    cupom: "PROMO10",
    score: 90,
    categoria: "eletronicos",
    imagem: `https://cdn.optimus.test/${id}.jpg`,
    linkAfiliado: `https://go.optimus.test/${id}`,
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    criadoEm: "2026-07-14T11:45:00.000Z",
    ...dados
  };
}

function configAutomatico(extra = {}) {
  return {
    ativo: true,
    quantidadeDiaria: 1,
    intervaloMinimoMinutos: 20,
    idadeMaximaHoras: 6,
    scoreMinimo: 70,
    exigirCupom: false,
    permitirOfertaComum: true,
    evitarProdutoRepetidoDias: 30,
    janelaFuncionamento: { inicio: "00:00", fim: "23:59" },
    marketplacesPermitidos: [],
    categoriasPermitidas: [],
    gatilho: {
      ativo: true,
      palavra: "EU QUERO",
      respostaPublica: "Padrao Optimus respondeu."
    },
    ...extra
  };
}

function mockHttpClient(sufixo = "ok") {
  return {
    chamadas: [],
    async post(url, body) {
      this.chamadas.push({ metodo: "post", url, body: String(body || "") });
      if (url.endsWith("/media")) return { data: { id: `container_${sufixo}` } };
      if (url.endsWith("/media_publish")) return { data: { id: `media_${sufixo}` } };
      return { data: {} };
    },
    async get(url) {
      this.chamadas.push({ metodo: "get", url });
      if (url.includes(`/container_${sufixo}`)) return { data: { status_code: "FINISHED" } };
      return { data: {} };
    }
  };
}

function rendererOk(sufixo = "render") {
  const chamadas = [];
  const fn = async ({ clienteId, ofertaId, templateId, gatilho }) => {
    chamadas.push({ clienteId, ofertaId, templateId, gatilho });
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

(async () => {
  assert.strictEqual(
    resolverTemplateSocial("sem_custom", "__padrao_cliente").templateId,
    "padrao-instagram",
    "sem template personalizado usa Padrao Optimus"
  );

  const salvo = storage.salvarTemplateSocial("cliente_tpl", {
    id: "tpl_custom",
    nome: "Template Custom",
    padrao: true,
    legenda: "Legenda custom salva",
    visual: { faixaSuperiorTexto: "CUSTOM" },
    gatilho: {
      ativo: true,
      palavra: "OFERTA",
      ctaPublico: "Comente OFERTA",
      respostaPublica: "Resposta custom",
      mensagemDirect: "Direct custom"
    },
    cta: { tipo: "direct", texto: "Comente OFERTA" }
  });
  assert.strictEqual(salvo.visual.faixaSuperiorTexto, "CUSTOM", "salva visual personalizado");
  assert.strictEqual(salvo.gatilho.palavra, "OFERTA", "salva palavra-gatilho");
  assert.strictEqual(storage.getConfigAutomaticoSocial("cliente_tpl").templatePadraoId, "tpl_custom");

  storage.salvarTemplateSocial("cliente_tpl", {
    id: "tpl_outro",
    nome: "Outro Template",
    padrao: true,
    visual: { faixaSuperiorTexto: "OUTRO" },
    gatilho: { ativo: false, palavra: "OFF" }
  });
  const templates = storage.listarTemplatesSocial("cliente_tpl");
  assert.strictEqual(templates.filter(item => item.padrao).length, 1, "somente um personalizado fica como padrao");
  assert.strictEqual(templates.find(item => item.padrao).id, "tpl_outro");
  assert.strictEqual(resolverTemplateSocial("cliente_tpl", "template_invalido").templateId, "padrao-instagram");
  storage.salvarTemplateSocial("cliente_tpl", {
    ...templates.find(item => item.id === "tpl_outro"),
    padrao: false
  });
  assert.strictEqual(storage.getConfigAutomaticoSocial("cliente_tpl").templatePadraoId, "padrao-instagram", "sem personalizado marcado volta ao Padrao Optimus");
  assert.strictEqual(resolverTemplateSocial("cliente_tpl", "__padrao_cliente").templateId, "padrao-instagram");

  conectar("cliente_auto_tpl", "auto_tpl");
  writeClienteJson("cliente_auto_tpl", "fila.json", [oferta("auto_tpl_1")]);
  storage.salvarTemplateSocial("cliente_auto_tpl", {
    id: "tpl_auto",
    nome: "Template Automatico",
    padrao: true,
    legenda: "Legenda do automatico",
    visual: { faixaSuperiorTexto: "AUTO" },
    gatilho: {
      ativo: true,
      palavra: "AUTO",
      ctaPublico: "Comente AUTO",
      respostaPublica: "Resposta auto",
      mensagemDirect: "Direct auto"
    }
  });
  storage.setConfigAutomaticoSocial("cliente_auto_tpl", configAutomatico({
    templatePadraoId: "tpl_auto"
  }));
  const rodada = await executarAutomaticoCliente({ clienteId: "cliente_auto_tpl", agora: AGORA });
  assert.strictEqual(rodada.agendamentosCriados.length, 1);
  const agendamento = rodada.agendamentosCriados[0];
  assert.strictEqual(agendamento.templateId, "tpl_auto", "Automatico usa o template padrao escolhido");
  assert.strictEqual(agendamento.gatilho.palavra, "AUTO");
  assert.strictEqual(agendamento.automatico.template.id, "tpl_auto", "Automatico grava snapshot completo");
  storage.salvarTemplateSocial("cliente_auto_tpl", {
    id: "tpl_auto",
    nome: "Template Automatico Editado",
    padrao: true,
    legenda: "Legenda editada depois",
    visual: { faixaSuperiorTexto: "EDITADO" },
    gatilho: {
      ativo: true,
      palavra: "EDITADO",
      ctaPublico: "Comente EDITADO",
      respostaPublica: "Resposta editada",
      mensagemDirect: "Direct editado"
    }
  });
  const agendamentoSalvo = storage.listarAgendamentosSocial("cliente_auto_tpl")
    .find(item => item.id === agendamento.id);
  assert.strictEqual(
    agendamentoSalvo.automatico.template.gatilho.palavra,
    "AUTO",
    "snapshot protege agendamentos ja criados"
  );

  conectar("cliente_auto_default", "auto_default");
  writeClienteJson("cliente_auto_default", "fila.json", [oferta("auto_default_1")]);
  storage.setConfigAutomaticoSocial("cliente_auto_default", configAutomatico({
    templatePadraoId: "template_invalido"
  }));
  const rodadaDefault = await executarAutomaticoCliente({ clienteId: "cliente_auto_default", agora: AGORA });
  assert.strictEqual(rodadaDefault.agendamentosCriados[0].templateId, "padrao-instagram", "fallback seguro para Padrao Optimus");
  assert.strictEqual(rodadaDefault.agendamentosCriados[0].gatilho.palavra, "EU QUERO", "gatilho do Padrao Optimus/config continua funcionando");

  conectar("cliente_manual_tpl", "manual_tpl");
  writeClienteJson("cliente_manual_tpl", "fila.json", [
    oferta("manual_a"),
    oferta("manual_b", { titulo: "Produto Manual B" }),
    oferta("manual_c", { titulo: "Produto Manual C", linkAfiliado: "https://go.optimus.test/manual-c" })
  ]);
  storage.salvarTemplateSocial("cliente_manual_tpl", {
    id: "tpl_padrao_manual",
    nome: "Padrao Manual",
    padrao: true,
    legenda: "Legenda padrao manual",
    visual: { faixaSuperiorTexto: "PADRAO" },
    gatilho: { ativo: true, palavra: "PADRAO", respostaPublica: "Resposta padrao", mensagemDirect: "Direct padrao" }
  });
  storage.salvarTemplateSocial("cliente_manual_tpl", {
    id: "tpl_escolhido_manual",
    nome: "Escolhido Manual",
    padrao: false,
    legenda: "Legenda escolhida manual",
    visual: { faixaSuperiorTexto: "ESCOLHIDO" },
    gatilho: { ativo: false, palavra: "OFF", respostaPublica: "Nao usar", mensagemDirect: "Nao usar" }
  });
  storage.salvarTemplateSocial("cliente_manual_tpl", {
    id: "tpl_ligado_manual",
    nome: "Ligado Manual",
    padrao: false,
    legenda: "Legenda ligada manual",
    visual: { faixaSuperiorTexto: "LIGADO" },
    gatilho: {
      ativo: true,
      palavra: "LIGA",
      ctaPublico: "Comente LIGA",
      respostaPublica: "Resposta ligada",
      mensagemDirect: "Direct ligado"
    },
    cta: { tipo: "direct", texto: "Comente LIGA" }
  });
  const httpManual = mockHttpClient("manual_tpl");
  const renderManual = rendererOk("manual_tpl");
  const publicadaManual = await publicarNoInstagram({
    clienteId: "cliente_manual_tpl",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_b",
    templateId: "tpl_escolhido_manual",
    legenda: "Legenda do modal",
    gatilho: { ativo: true, palavra: "MODAL", respostaPublica: "Modal" },
    renderizadorArte: renderManual,
    httpClient: httpManual,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaManual.publicacao.templateId, "tpl_escolhido_manual");
  assert.strictEqual(publicadaManual.publicacao.legenda, "Legenda escolhida manual", "template manual escolhido vale so para esta publicacao");
  assert.ok(!publicadaManual.publicacao.gatilho?.ativo, "gatilho desligado publica como post comum");
  assert.strictEqual(storage.getConfigAutomaticoSocial("cliente_manual_tpl").templatePadraoId, "tpl_padrao_manual", "escolha manual nao altera padrao global");
  assert.strictEqual(renderManual.chamadas[0].templateId, "tpl_escolhido_manual", "renderer atual recebe o templateId resolvido");

  const httpLigado = mockHttpClient("manual_ligado");
  const renderLigado = rendererOk("manual_ligado");
  const publicadaLigada = await publicarNoInstagram({
    clienteId: "cliente_manual_tpl",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_c",
    templateId: "tpl_ligado_manual",
    renderizadorArte: renderLigado,
    httpClient: httpLigado,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaLigada.publicacao.gatilho.palavra, "LIGA");
  assert.strictEqual(publicadaLigada.publicacao.respostaPublica, "Resposta ligada");
  assert.strictEqual(publicadaLigada.publicacao.gatilho.textoDirect, "Direct ligado");
  assert.strictEqual(publicadaLigada.publicacao.gatilho.ctaPublico, "Comente LIGA");
  assert.strictEqual(publicadaLigada.publicacao.urlDestino, "https://go.optimus.test/manual-c");

  const httpPadrao = mockHttpClient("padrao_tpl");
  const renderPadrao = rendererOk("padrao_tpl");
  const publicadaPadrao = await publicarNoInstagram({
    clienteId: "cliente_manual_tpl",
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_a",
    templateId: "padrao-instagram",
    gatilho: { ativo: true, palavra: "EU QUERO", respostaPublica: "Resposta padrao" },
    renderizadorArte: renderPadrao,
    httpClient: httpPadrao,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaPadrao.publicacao.templateId, "padrao-instagram");
  assert.strictEqual(renderPadrao.chamadas[0].templateId, "padrao-instagram", "Padrao Optimus preserva renderer oficial");
  assert.strictEqual(publicadaPadrao.publicacao.gatilho.palavra, "EU QUERO", "gatilho do Padrao Optimus continua ativo");

  console.log("social-templates-oficiais.test.js ok");
})();
