const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-automatico-"));
process.env.DATA_DIR = dataDir;

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/social/storage");
const {
  executarAutomaticoCliente,
  executarAutomaticoTodosClientes,
  executarAgendamentosPendentesCliente,
  simularSelecaoAutomatica
} = require("../modules/social/automatico.service");
const { executarRodadaSchedulerAgendamentosSocial } = require("../modules/social/scheduler");

const AGORA = new Date("2026-07-14T12:00:00.000Z");
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

function oferta(id, dados = {}) {
  return {
    id,
    ofertaId: id,
    produtoId: `produto_${id}`,
    marketplace: "amazon",
    titulo: `Produto ${id}`,
    precoAtual: 100,
    precoOriginal: 150,
    cupom: "",
    score: 80,
    categoria: "eletronicos",
    imagem: `https://cdn.optimus.test/${id}.jpg`,
    linkAfiliado: `https://go.optimus.test/${id}`,
    linkOriginal: `https://loja.test/${id}`,
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    criadoEm: "2026-07-14T11:30:00.000Z",
    ...dados
  };
}

function configAutomatico(extra = {}) {
  return {
    ativo: true,
    quantidadeDiaria: 5,
    intervaloMinimoMinutos: 40,
    idadeMaximaHoras: 6,
    scoreMinimo: 70,
    exigirCupom: false,
    permitirOfertaComum: true,
    evitarProdutoRepetidoDias: 30,
    janelaFuncionamento: { inicio: "00:00", fim: "23:59" },
    marketplacesPermitidos: [],
    ...extra
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

function rendererOk(sufixo = "auto") {
  const chamadas = [];
  const fn = async ({ clienteId, ofertaId }) => {
    chamadas.push({ clienteId, ofertaId });
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

function minutosEntre(a, b) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 60000;
}

(async () => {
  conectar("cliente_off", "off");
  storage.salvarAgendamentoSocial("cliente_off", {
    origem: "automatico",
    tipoPublicacao: "oferta",
    ofertaId: "existente",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T14:00:00.000Z"
  });
  storage.setConfigAutomaticoSocial("cliente_off", configAutomatico({ ativo: false }));
  const desligado = await executarAutomaticoCliente({ clienteId: "cliente_off", agora: AGORA });
  assert.strictEqual(desligado.motivo, "automatico_desativado");
  assert.strictEqual(storage.listarAgendamentosSocial("cliente_off").length, 1, "desligar nao apaga agendamento existente");

  const configNormalizada = storage.setConfigAutomaticoSocial("cliente_norm", configAutomatico({
    quantidadeDiaria: 12,
    intervaloMinimoMinutos: 10
  }));
  assert.strictEqual(configNormalizada.quantidadeDiaria, 10);
  assert.strictEqual(configNormalizada.intervaloMinimoMinutos, 20);

  conectar("cliente_limite", "limite");
  writeClienteJson("cliente_limite", "fila.json", Array.from({ length: 12 }, (_, i) =>
    oferta(`limite_${i}`, {
      score: 90 - i,
      cupom: i % 2 === 0 ? `CUPOM${i}` : "",
      criadoEm: `2026-07-14T11:${String(50 - i).padStart(2, "0")}:00.000Z`
    })
  ));
  storage.salvarAgendamentoSocial("cliente_limite", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_ocupado",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T12:01:00.000Z"
  });
  storage.setConfigAutomaticoSocial("cliente_limite", configAutomatico({
    quantidadeDiaria: 12,
    intervaloMinimoMinutos: 10
  }));
  const rodadaLimite = await executarAutomaticoCliente({ clienteId: "cliente_limite", agora: AGORA });
  assert.strictEqual(rodadaLimite.agendamentosCriados.length, 10, "nunca deve ultrapassar 10 automaticos no dia");
  const autosLimite = storage.listarAgendamentosSocial("cliente_limite").filter(item => item.origem === "automatico");
  assert.strictEqual(autosLimite.length, 10);
  assert.ok(autosLimite.every(item => item.status === "agendada"));
  assert.ok(autosLimite.every(item => Date.parse(item.agendadoPara) > AGORA.getTime()), "nao agenda no passado");
  assert.ok(autosLimite.every(item => item.agendadoPara.startsWith("2026-07-14")), "respeita janela do dia");
  const ordenadosLimite = autosLimite.map(item => item.agendadoPara).sort();
  for (let i = 1; i < ordenadosLimite.length; i += 1) {
    assert.ok(minutosEntre(ordenadosLimite[i], ordenadosLimite[i - 1]) >= 20, "respeita intervalo minimo absoluto");
  }
  assert.ok(minutosEntre(ordenadosLimite[0], "2026-07-14T12:01:00.000Z") >= 20, "considera agendamento manual existente");
  const segundaRodadaLimite = await executarAutomaticoCliente({ clienteId: "cliente_limite", agora: AGORA });
  assert.strictEqual(segundaRodadaLimite.agendamentosCriados.length, 0, "duas rodadas nao duplicam oportunidades");

  conectar("cliente_prioridade", "prioridade");
  writeClienteJson("cliente_prioridade", "fila.json", [
    oferta("sem_cupom_score_alto", { score: 99, cupom: "", criadoEm: "2026-07-14T11:55:00.000Z" }),
    oferta("com_cupom_score_menor", { score: 70, cupom: "PROMO", criadoEm: "2026-07-14T11:50:00.000Z" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_prioridade", configAutomatico({ quantidadeDiaria: 1 }));
  const prioridade = await executarAutomaticoCliente({ clienteId: "cliente_prioridade", agora: AGORA });
  assert.strictEqual(prioridade.agendamentosCriados[0].ofertaId, "com_cupom_score_menor", "cupom tem prioridade");

  conectar("cliente_recencia", "recencia");
  writeClienteJson("cliente_recencia", "fila.json", [
    oferta("antiga", { score: 88, cupom: "PROMO", criadoEm: "2026-07-14T10:00:00.000Z" }),
    oferta("nova", { score: 88, cupom: "PROMO", criadoEm: "2026-07-14T11:59:00.000Z" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_recencia", configAutomatico({ quantidadeDiaria: 1 }));
  const recencia = await executarAutomaticoCliente({ clienteId: "cliente_recencia", agora: AGORA });
  assert.strictEqual(recencia.agendamentosCriados[0].ofertaId, "nova", "recencia desempata");

  conectar("cliente_recencia_data_fila", "recencia_data_fila");
  writeClienteJson("cliente_recencia_data_fila", "fila.json", [
    oferta("antiga_data_fila", {
      score: 99,
      cupom: "OLD",
      criadoEm: "14/07/2026, 08:00:00",
      dataEntradaFila: "2026-07-14T00:00:00.000Z"
    }),
    oferta("nova_data_fila", {
      score: 80,
      cupom: "",
      criadoEm: "14/07/2026, 08:00:00",
      dataEntradaFila: "2026-07-14T11:55:00.000Z"
    })
  ]);
  storage.setConfigAutomaticoSocial("cliente_recencia_data_fila", configAutomatico({ quantidadeDiaria: 2 }));
  const recenciaDataFila = await executarAutomaticoCliente({ clienteId: "cliente_recencia_data_fila", agora: AGORA });
  assert.deepStrictEqual(
    recenciaDataFila.agendamentosCriados.map(item => item.ofertaId),
    ["nova_data_fila"],
    "recem-chegada com dataEntradaFila valida fica elegivel e antiga real continua fora"
  );
  assert.ok(
    recenciaDataFila.diagnostico.some(item => item.ofertaId === "antiga_data_fila" && item.motivos.includes("fora_idade_maxima")),
    "oferta antiga com data real nao deve ser rejuvenescida"
  );

  conectar("cliente_filtros", "filtros");
  writeClienteJson("cliente_filtros", "fila.json", [
    oferta("sem_imagem", { imagem: "" }),
    oferta("sem_link", { linkAfiliado: "" }),
    oferta("marketplace_bloqueado", { marketplace: "shopee" }),
    oferta("velha", { criadoEm: "2026-07-14T00:00:00.000Z" }),
    oferta("ja_publicada"),
    oferta("ja_agendada"),
    oferta("valida", { cupom: "OK", score: 95 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_filtros", configAutomatico({
    quantidadeDiaria: 5,
    marketplacesPermitidos: ["amazon"]
  }));
  writeClienteJson("cliente_filtros", "social-publicacoes.json", [{
    id: "pub_ja_publicada",
    clienteId: "cliente_filtros",
    rede: "instagram",
    origem: "manual",
    tipoPublicacao: "oferta",
    status: "publicada",
    ofertaId: "ja_publicada",
    publicadoEm: "2026-07-14T09:00:00.000Z"
  }]);
  storage.salvarAgendamentoSocial("cliente_filtros", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "ja_agendada",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T13:00:00.000Z"
  });
  const simFiltros = simularSelecaoAutomatica({ clienteId: "cliente_filtros", agora: AGORA });
  assert.ok(!simFiltros.selecionadas.some(item => item.ofertaId === "sem_link"));
  assert.ok(!simFiltros.selecionadas.some(item => item.ofertaId === "marketplace_bloqueado"));
  assert.ok(!simFiltros.selecionadas.some(item => item.ofertaId === "velha"));
  assert.ok(!simFiltros.selecionadas.some(item => item.ofertaId === "ja_publicada"));
  assert.ok(!simFiltros.selecionadas.some(item => item.ofertaId === "ja_agendada"));
  assert.ok(simFiltros.selecionadas.some(item => item.ofertaId === "valida"));
  assert.ok(simFiltros.diagnostico.some(item => item.ofertaId === "sem_link" && item.motivos.includes("sem_link")));
  assert.ok(simFiltros.diagnostico.some(item => item.ofertaId === "marketplace_bloqueado" && item.motivos.includes("marketplace_bloqueado")));
  assert.ok(simFiltros.diagnostico.some(item => item.ofertaId === "velha" && item.motivos.includes("fora_idade_maxima")));

  conectar("cliente_aprovacao", "aprovacao");
  writeClienteJson("cliente_aprovacao", "fila.json", [
    oferta("aprovacao_auto", { cupom: "APROVA", score: 95 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_aprovacao", configAutomatico({
    quantidadeDiaria: 1,
    aprovacaoManual: true
  }));
  const rodadaAprovacao = await executarAutomaticoCliente({ clienteId: "cliente_aprovacao", agora: AGORA });
  assert.strictEqual(rodadaAprovacao.agendamentosCriados[0].status, "aguardando_aprovacao");
  const httpAprovacao = mockHttpClient("aprovacao");
  const schedulerAprovacao = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_aprovacao",
    agora: new Date("2026-07-14T23:00:00.000Z"),
    httpClient: httpAprovacao,
    polling: POLLING_TESTE
  });
  assert.strictEqual(schedulerAprovacao.executados.length, 0, "aprovacao manual nao publica antes de aprovar");
  assert.strictEqual(httpAprovacao.chamadas.length, 0);

  conectar("cliente_scheduler", "scheduler");
  writeClienteJson("cliente_scheduler", "fila.json", [
    oferta("scheduler_auto", { cupom: "RUN", score: 99 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_scheduler", configAutomatico({
    quantidadeDiaria: 1
  }));
  const rodadaScheduler = await executarAutomaticoCliente({ clienteId: "cliente_scheduler", agora: AGORA });
  const httpScheduler = mockHttpClient("scheduler");
  const rendererScheduler = rendererOk("scheduler");
  const execScheduler = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_scheduler",
    agora: new Date(Date.parse(rodadaScheduler.agendamentosCriados[0].agendadoPara) + 60000),
    renderizadorArte: rendererScheduler,
    httpClient: httpScheduler,
    polling: POLLING_TESTE
  });
  assert.strictEqual(execScheduler.executados.length, 1, "scheduler oficial executa agendamento automatico");
  assert.strictEqual(execScheduler.executados[0].publicacao.origem, "automatica");
  assert.strictEqual(execScheduler.executados[0].publicacao.ofertaId, "scheduler_auto");
  assert.strictEqual(rendererScheduler.chamadas.length, 1, "publicador oficial/renderizador sao usados no scheduler");

  conectar("cliente_limpeza_auto", "limpeza_auto");
  writeClienteJson("cliente_limpeza_auto", "fila.json", [
    oferta("auto_velha", { score: 99, cupom: "OLD", criadoEm: "2026-07-14T00:00:00.000Z" }),
    oferta("auto_nova", { score: 80, cupom: "", criadoEm: "2026-07-14T11:55:00.000Z" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_limpeza_auto", configAutomatico({
    quantidadeDiaria: 2,
    limparAutomaticamenteOportunidadesAntigas: true
  }));
  const rodadaLimpezaAuto = await executarAutomaticoCliente({ clienteId: "cliente_limpeza_auto", agora: AGORA });
  assert.deepStrictEqual(
    rodadaLimpezaAuto.agendamentosCriados.map(item => item.ofertaId),
    ["auto_nova"],
    "limpeza automatica remove antigas antes da rodada sem bloquear oferta recente"
  );
  assert.ok(!storage.listarOportunidadesSocial("cliente_limpeza_auto", 10).some(item => item.ofertaId === "auto_velha"));

  conectar("cliente_auto_erro", "auto_erro");
  writeClienteJson("cliente_auto_erro", "fila.json", [
    oferta("auto_erro_oferta", { cupom: "ERR", score: 99 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_auto_erro", configAutomatico({ quantidadeDiaria: 1 }));
  conectar("cliente_auto_ok", "auto_ok");
  writeClienteJson("cliente_auto_ok", "fila.json", [
    oferta("auto_ok_oferta", { cupom: "OK", score: 99 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_auto_ok", configAutomatico({ quantidadeDiaria: 1 }));
  const listarOportunidadesOriginal = storage.listarOportunidadesSocial;
  try {
    storage.listarOportunidadesSocial = (clienteId, ...args) => {
      if (clienteId === "cliente_auto_erro") throw new Error("falha_cliente_teste");
      return listarOportunidadesOriginal.call(storage, clienteId, ...args);
    };
    const todosComErro = await executarAutomaticoTodosClientes({ agora: AGORA });
    assert.ok(todosComErro.erros.some(item => item.clienteId === "cliente_auto_erro"), "erro por cliente fica isolado");
    assert.ok(
      storage.listarAgendamentosSocial("cliente_auto_ok").some(item => item.ofertaId === "auto_ok_oferta"),
      "erro em um cliente nao impede os demais"
    );
  } finally {
    storage.listarOportunidadesSocial = listarOportunidadesOriginal;
  }

  conectar("cliente_scheduler_oficial", "scheduler_oficial");
  writeClienteJson("cliente_scheduler_oficial", "fila.json", [
    oferta("scheduler_oficial_auto", { cupom: "RUN", score: 99, criadoEm: "2026-07-14T11:59:00.000Z" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_scheduler_oficial", configAutomatico({ quantidadeDiaria: 1 }));
  const httpSchedulerOficial = mockHttpClient("scheduler_oficial");
  const rendererSchedulerOficial = rendererOk("scheduler_oficial");
  const rodadaSchedulerOficial = await executarRodadaSchedulerAgendamentosSocial({
    agora: AGORA,
    renderizadorArte: rendererSchedulerOficial,
    httpClient: httpSchedulerOficial,
    polling: POLLING_TESTE
  });
  const agendamentosSchedulerOficial = storage
    .listarAgendamentosSocial("cliente_scheduler_oficial")
    .filter(item => item.ofertaId === "scheduler_oficial_auto");
  assert.ok(rodadaSchedulerOficial.automatico, "scheduler chama automatico na rodada oficial");
  assert.ok(rodadaSchedulerOficial.agendamentos, "scheduler executa pendentes na mesma rodada oficial");
  assert.strictEqual(agendamentosSchedulerOficial.length, 1, "oportunidade elegivel vira agendamento na rodada");
  assert.ok(Date.parse(agendamentosSchedulerOficial[0].agendadoPara) > AGORA.getTime(), "automatico agenda para horario futuro");
  assert.strictEqual(httpSchedulerOficial.chamadas.length, 0, "agendamento futuro nao e publicado imediatamente");
  const segundaRodadaSchedulerOficial = await executarRodadaSchedulerAgendamentosSocial({
    agora: AGORA,
    renderizadorArte: rendererSchedulerOficial,
    httpClient: httpSchedulerOficial,
    polling: POLLING_TESTE
  });
  const agendamentosSchedulerOficialAposSegunda = storage
    .listarAgendamentosSocial("cliente_scheduler_oficial")
    .filter(item => item.ofertaId === "scheduler_oficial_auto");
  assert.ok(segundaRodadaSchedulerOficial.automatico.totalAgendados >= 0);
  assert.strictEqual(agendamentosSchedulerOficialAposSegunda.length, 1, "duas rodadas do scheduler nao duplicam");

  conectar("cliente_scheduler_desligado", "scheduler_desligado");
  writeClienteJson("cliente_scheduler_desligado", "fila.json", [
    oferta("scheduler_desligado_auto", { cupom: "OFF", score: 99 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_scheduler_desligado", configAutomatico({ ativo: false, quantidadeDiaria: 1 }));
  await executarRodadaSchedulerAgendamentosSocial({
    agora: AGORA,
    renderizadorArte: rendererSchedulerOficial,
    httpClient: httpSchedulerOficial,
    polling: POLLING_TESTE
  });
  assert.ok(
    !storage.listarAgendamentosSocial("cliente_scheduler_desligado").some(item => item.ofertaId === "scheduler_desligado_auto"),
    "automatico desligado nao agenda pela rodada oficial"
  );

  conectar("cliente_scheduler_vencido", "scheduler_vencido");
  writeClienteJson("cliente_scheduler_vencido", "fila.json", [
    oferta("scheduler_vencido_auto", { cupom: "DUE", score: 99 })
  ]);
  storage.setConfigAutomaticoSocial("cliente_scheduler_vencido", configAutomatico({ ativo: false }));
  storage.salvarAgendamentoSocial("cliente_scheduler_vencido", {
    origem: "automatico",
    tipoPublicacao: "oferta",
    ofertaId: "scheduler_vencido_auto",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-14T11:50:00.000Z"
  });
  const httpSchedulerVencido = mockHttpClient("scheduler_vencido");
  const rendererSchedulerVencido = rendererOk("scheduler_vencido");
  const rodadaSchedulerVencido = await executarRodadaSchedulerAgendamentosSocial({
    agora: AGORA,
    renderizadorArte: rendererSchedulerVencido,
    httpClient: httpSchedulerVencido,
    polling: POLLING_TESTE
  });
  const agendamentoVencidoPublicado = storage
    .listarAgendamentosSocial("cliente_scheduler_vencido")
    .find(item => item.ofertaId === "scheduler_vencido_auto");
  assert.strictEqual(agendamentoVencidoPublicado.status, "publicada", "agendamento vencido continua publicado pelo scheduler oficial");
  assert.strictEqual(rendererSchedulerVencido.chamadas.length, 1, "publicacao passa pelo publicador oficial/renderizador");
  assert.ok(
    httpSchedulerVencido.chamadas.some(item => item.metodo === "post" && item.url.endsWith("/media_publish")),
    "publicador oficial permanece o ponto de publicacao"
  );
  assert.ok(rodadaSchedulerVencido.totalExecutados >= 1, "resumo da rodada informa vencidos executados");

  console.log("social-automatico-agendamentos: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
