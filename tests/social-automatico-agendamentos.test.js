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
  const config = {
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
  if (extra.quantidadeDiaria == null && extra.maxPublicacoesAutomaticasPorDia != null) {
    config.quantidadeDiaria = extra.maxPublicacoesAutomaticasPorDia;
  }
  return config;
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

function dataSaoPauloUtc(ano, mes, dia, hora, minuto = 0) {
  return new Date(Date.UTC(ano, mes - 1, dia, hora + 3, minuto, 0, 0));
}

function horaSaoPaulo(input) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(input));
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
  assert.strictEqual(configNormalizada.quantidadeDiaria, 12);
  assert.strictEqual(configNormalizada.maxPublicacoesAutomaticasPorDia, 12);
  assert.strictEqual(configNormalizada.intervaloMinimoMinutos, 10);
  const configNormalizadaMax = storage.setConfigAutomaticoSocial("cliente_norm_max", configAutomatico({ quantidadeDiaria: 25 }));
  assert.strictEqual(configNormalizadaMax.quantidadeDiaria, 20);
  const configFallbackMax = storage.setConfigAutomaticoSocial("cliente_norm_fallback", { ativo: true, maxPublicacoesAutomaticasPorDia: 8 });
  assert.strictEqual(configFallbackMax.quantidadeDiaria, 8);

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
  assert.strictEqual(rodadaLimite.agendamentosCriados.length, 12, "nunca deve ultrapassar o limite canonico automatico no dia");
  const autosLimite = storage.listarAgendamentosSocial("cliente_limite").filter(item => item.origem === "automatico");
  assert.strictEqual(autosLimite.length, 12);
  assert.ok(autosLimite.every(item => item.status === "agendada"));
  assert.ok(autosLimite.every(item => item.imagemUrl), "automaticos carregam miniatura da oferta");
  assert.ok(autosLimite.every(item => Date.parse(item.agendadoPara) > AGORA.getTime()), "nao agenda no passado");
  assert.ok(autosLimite.every(item => item.agendadoPara.startsWith("2026-07-14")), "respeita janela do dia");
  const ordenadosLimite = autosLimite.map(item => item.agendadoPara).sort();
  for (let i = 1; i < ordenadosLimite.length; i += 1) {
    assert.ok(minutosEntre(ordenadosLimite[i], ordenadosLimite[i - 1]) >= 10, "respeita intervalo minimo absoluto");
  }
  assert.ok(minutosEntre(ordenadosLimite[0], "2026-07-14T12:01:00.000Z") >= 10, "considera agendamento manual existente");
  const segundaRodadaLimite = await executarAutomaticoCliente({ clienteId: "cliente_limite", agora: AGORA });
  assert.strictEqual(segundaRodadaLimite.agendamentosCriados.length, 0, "duas rodadas nao duplicam oportunidades");

  conectar("cliente_limite_diario_on", "limite_diario_on");
  writeClienteJson("cliente_limite_diario_on", "fila.json", Array.from({ length: 8 }, (_, i) =>
    oferta(`limite_diario_on_${i}`, { score: 99 - i, cupom: "MAX" })
  ));
  storage.setConfigAutomaticoSocial("cliente_limite_diario_on", configAutomatico({
    quantidadeDiaria: 5,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 5
  }));
  const rodadaLimiteDiarioOn = await executarAutomaticoCliente({ clienteId: "cliente_limite_diario_on", agora: AGORA });
  assert.strictEqual(rodadaLimiteDiarioOn.agendamentosCriados.length, 5, "quantidadeDiaria canonica controla as ocupacoes automaticas do dia");
  const rodadaLimiteDiarioOnRetry = await executarAutomaticoCliente({ clienteId: "cliente_limite_diario_on", agora: AGORA });
  assert.strictEqual(rodadaLimiteDiarioOnRetry.agendamentosCriados.length, 0, "execucao repetida nao duplica quando limite diario esta cheio");

  conectar("cliente_limite_publicadas", "limite_publicadas");
  writeClienteJson("cliente_limite_publicadas", "fila.json", [
    oferta("limite_publicadas_nova", { score: 99, cupom: "FULL" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_limite_publicadas", configAutomatico({
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 5
  }));
  for (let i = 0; i < 3; i += 1) {
    storage.salvarAgendamentoSocial("cliente_limite_publicadas", {
      origem: "automatico",
      tipoPublicacao: "oferta",
      ofertaId: `limite_publicada_${i}`,
      status: "publicada",
      ativo: true,
      agendadoPara: `2026-07-14T${String(8 + i).padStart(2, "0")}:00:00.000Z`
    });
  }
  for (let i = 0; i < 2; i += 1) {
    storage.salvarAgendamentoSocial("cliente_limite_publicadas", {
      origem: "automatico",
      tipoPublicacao: "oferta",
      ofertaId: `limite_agendada_${i}`,
      status: "agendada",
      ativo: true,
      agendadoPara: `2026-07-14T1${i}:00:00.000Z`
    });
  }
  const rodadaLimitePublicadas = await executarAutomaticoCliente({ clienteId: "cliente_limite_publicadas", agora: AGORA });
  assert.strictEqual(rodadaLimitePublicadas.agendamentosCriados.length, 0, "3 publicadas + 2 agendadas impedem novas quando limite maximo e 5");

  conectar("cliente_limite_erro", "limite_erro");
  writeClienteJson("cliente_limite_erro", "fila.json", [
    oferta("limite_erro_nova", { score: 99, cupom: "ERR" })
  ]);
  storage.setConfigAutomaticoSocial("cliente_limite_erro", configAutomatico({
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 1
  }));
  storage.salvarAgendamentoSocial("cliente_limite_erro", {
    origem: "automatico",
    tipoPublicacao: "oferta",
    ofertaId: "limite_erro_antigo",
    status: "erro",
    ativo: true,
    agendadoPara: "2026-07-14T09:00:00.000Z"
  });
  const rodadaLimiteErro = await executarAutomaticoCliente({ clienteId: "cliente_limite_erro", agora: AGORA });
  assert.strictEqual(rodadaLimiteErro.agendamentosCriados.length, 1, "erro nao ocupa vaga do limite diario");

  conectar("cliente_limite_aumenta", "limite_aumenta");
  writeClienteJson("cliente_limite_aumenta", "fila.json", Array.from({ length: 4 }, (_, i) =>
    oferta(`limite_aumenta_nova_${i}`, { score: 90 - i, cupom: "UP" })
  ));
  storage.setConfigAutomaticoSocial("cliente_limite_aumenta", configAutomatico({
    quantidadeDiaria: 5,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 5
  }));
  for (let i = 0; i < 5; i += 1) {
    storage.salvarAgendamentoSocial("cliente_limite_aumenta", {
      origem: "automatico",
      tipoPublicacao: "oferta",
      ofertaId: `limite_aumenta_existente_${i}`,
      status: "agendada",
      ativo: true,
      agendadoPara: `2026-07-14T${String(7 + i).padStart(2, "0")}:00:00.000Z`
    });
  }
  storage.setConfigAutomaticoSocial("cliente_limite_aumenta", configAutomatico({
    quantidadeDiaria: 7,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 7
  }));
  const rodadaLimiteAumenta = await executarAutomaticoCliente({ clienteId: "cliente_limite_aumenta", agora: AGORA });
  assert.strictEqual(rodadaLimiteAumenta.agendamentosCriados.length, 2, "aumento de 5 para 7 abre somente 2 vagas");

  conectar("cliente_limite_ativa_sem_limpar", "limite_ativa_sem_limpar");
  for (let i = 0; i < 5; i += 1) {
    storage.salvarAgendamentoSocial("cliente_limite_ativa_sem_limpar", {
      origem: "automatico",
      tipoPublicacao: "oferta",
      ofertaId: `limite_ativa_existente_${i}`,
      status: "agendada",
      ativo: true,
      agendadoPara: `2099-07-14T1${i}:00:00.000Z`,
      automatico: { score: 100 - i }
    });
  }
  storage.setConfigAutomaticoSocial("cliente_limite_ativa_sem_limpar", configAutomatico({
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 3
  }));
  const agendamentosAtivacaoLimite = storage.listarAgendamentosSocial("cliente_limite_ativa_sem_limpar");
  assert.strictEqual(agendamentosAtivacaoLimite.filter(item => item.status === "agendada").length, 3, "reduzir quantidadeDiaria mantem somente os melhores futuros automaticos necessarios");
  assert.strictEqual(agendamentosAtivacaoLimite.filter(item => item.status === "cancelada" && item.motivo === "limite_diario_reduzido").length, 2, "reduzir quantidadeDiaria cancela excedentes futuros automaticos sem apagar");

  conectar("cliente_limite_reduz", "limite_reduz");
  storage.salvarAgendamentoSocial("cliente_limite_reduz", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_preservado",
    status: "agendada",
    ativo: true,
    agendadoPara: "2099-07-14T13:00:00.000Z"
  });
  storage.setConfigAutomaticoSocial("cliente_limite_reduz", configAutomatico({
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 7
  }));
  for (let i = 0; i < 5; i += 1) {
    storage.salvarAgendamentoSocial("cliente_limite_reduz", {
      origem: "automatico",
      tipoPublicacao: "oferta",
      ofertaId: `limite_reduz_${i}`,
      status: "agendada",
      ativo: true,
      agendadoPara: `2099-07-14T1${i}:00:00.000Z`,
      automatico: { score: 100 - i }
    });
  }
  storage.setConfigAutomaticoSocial("cliente_limite_reduz", configAutomatico({
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 3
  }));
  const agendamentosReduzidos = storage.listarAgendamentosSocial("cliente_limite_reduz");
  assert.strictEqual(agendamentosReduzidos.filter(item => item.origem === "manual" && item.status === "agendada").length, 1, "agendamento manual nao e cancelado");
  assert.strictEqual(agendamentosReduzidos.filter(item => item.origem === "automatico" && item.status === "agendada").length, 3, "reducao mantem somente os melhores futuros automaticos necessarios");
  assert.strictEqual(agendamentosReduzidos.filter(item => item.origem === "automatico" && item.status === "cancelada" && item.motivo === "limite_diario_reduzido").length, 2, "reducao cancela excedentes futuros automaticos sem apagar");

  conectar("cliente_repreenche_dia", "repreenche_dia");
  writeClienteJson("cliente_repreenche_dia", "fila.json", Array.from({ length: 6 }, (_, i) =>
    oferta(`repreenche_${i}`, {
      score: 95 - i,
      cupom: "HOJE",
      criadoEm: `2026-07-14T11:${String(50 - i).padStart(2, "0")}:00.000Z`
    })
  ));
  storage.setConfigAutomaticoSocial("cliente_repreenche_dia", configAutomatico({ quantidadeDiaria: 6 }));
  const rodadaRepreencheInicial = await executarAutomaticoCliente({ clienteId: "cliente_repreenche_dia", agora: AGORA });
  assert.strictEqual(rodadaRepreencheInicial.agendamentosCriados.length, 6, "preenche os 6 horarios do dia corrente");
  for (const agendamento of rodadaRepreencheInicial.agendamentosCriados) {
    storage.removerAgendamentoSocial("cliente_repreenche_dia", agendamento.id);
  }
  const rodadaRepreencheAposLimpeza = await executarAutomaticoCliente({ clienteId: "cliente_repreenche_dia", agora: new Date(AGORA.getTime() + 5 * 60 * 1000) });
  assert.strictEqual(rodadaRepreencheAposLimpeza.agendamentosCriados.length, 6, "se o usuario apagar os automaticos de hoje, a proxima rodada repoe somente o dia corrente");
  assert.ok(
    rodadaRepreencheAposLimpeza.agendamentosCriados.every(item => item.agendadoPara.startsWith("2026-07-14")),
    "repreenchimento nao cria agendamentos em dias futuros"
  );

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

  async function horariosAutomaticosPara(clienteId, agora, extraConfig = {}, totalOfertas = 1) {
    conectar(clienteId, clienteId);
    writeClienteJson(clienteId, "fila.json", Array.from({ length: totalOfertas }, (_, i) =>
      oferta(`${clienteId}_oferta_${i}`, {
        cupom: "HORA",
        score: 99 - i,
        criadoEm: new Date(agora.getTime() - 10 * 60 * 1000).toISOString()
      })
    ));
    storage.setConfigAutomaticoSocial(clienteId, configAutomatico({
      quantidadeDiaria: totalOfertas,
      intervaloMinimoMinutos: 40,
      idadeMaximaHoras: 48,
      janelaFuncionamento: { inicio: "08:00", fim: "22:00" },
      ...extraConfig
    }));
    const rodada = await executarAutomaticoCliente({ clienteId, agora });
    assert.strictEqual(rodada.agendamentosCriados.length, totalOfertas);
    return rodada.agendamentosCriados.map(item => item.agendadoPara);
  }

  async function horarioAutomaticoPara(clienteId, agora, extraConfig = {}) {
    const horarios = await horariosAutomaticosPara(clienteId, agora, extraConfig, 1);
    return horarios[0];
  }

  const horarioHojeNoite = await horarioAutomaticoPara("cliente_horario_2000", dataSaoPauloUtc(2026, 7, 14, 20, 0));
  assert.strictEqual(
    horarioHojeNoite,
    dataSaoPauloUtc(2026, 7, 14, 20, 1).toISOString(),
    "20:00 agenda hoje no proximo minuto disponivel"
  );
  assert.strictEqual(horaSaoPaulo(horarioHojeNoite), "20:01", "tela em Sao Paulo mostra 20:01");

  conectar("cliente_horario_limite_sem_clamp", "horario_limite_sem_clamp");
  writeClienteJson("cliente_horario_limite_sem_clamp", "fila.json", Array.from({ length: 10 }, (_, i) =>
    oferta(`cliente_horario_limite_sem_clamp_oferta_${i}`, {
      cupom: "HORA",
      score: 99 - i,
      criadoEm: "2026-07-14T23:40:00.000Z"
    })
  ));
  storage.setConfigAutomaticoSocial("cliente_horario_limite_sem_clamp", configAutomatico({
    quantidadeDiaria: 10,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 10,
    intervaloMinimoMinutos: 40,
    idadeMaximaHoras: 48,
    janelaFuncionamento: { inicio: "21:00", fim: "22:00" }
  }));
  const rodadaSemClamp = await executarAutomaticoCliente({
    clienteId: "cliente_horario_limite_sem_clamp",
    agora: dataSaoPauloUtc(2026, 7, 14, 21, 50)
  });
  assert.ok(rodadaSemClamp.agendamentosCriados.length < 10, "horario acima da janela para de agendar em vez de concentrar excedentes");
  assert.strictEqual(
    new Set(rodadaSemClamp.agendamentosCriados.map(item => item.agendadoPara)).size,
    rodadaSemClamp.agendamentosCriados.length,
    "nao cria dois automaticos no mesmo horario"
  );

  const agoraAposJanela = dataSaoPauloUtc(2026, 7, 14, 23, 43);
  conectar("cliente_horario_2343", "horario_2343");
  writeClienteJson("cliente_horario_2343", "fila.json", [
    oferta("cliente_horario_2343_oferta_0", {
      cupom: "HORA",
      score: 99,
      criadoEm: new Date(agoraAposJanela.getTime() - 10 * 60 * 1000).toISOString()
    })
  ]);
  storage.setConfigAutomaticoSocial("cliente_horario_2343", configAutomatico({
    quantidadeDiaria: 1,
    intervaloMinimoMinutos: 40,
    idadeMaximaHoras: 48,
    janelaFuncionamento: { inicio: "08:00", fim: "22:00" }
  }));
  const rodadaAposJanela = await executarAutomaticoCliente({ clienteId: "cliente_horario_2343", agora: agoraAposJanela });
  assert.strictEqual(rodadaAposJanela.agendamentosCriados.length, 0, "23:43 nao agenda na janela do proximo dia");
  assert.strictEqual(rodadaAposJanela.motivo, "sem_espaco_janela");
  assert.strictEqual(storage.listarAgendamentosSocial("cliente_horario_2343").length, 0, "rodada diaria encerrada nao cria agendamento futuro");

  const horarioAntesJanela = await horarioAutomaticoPara("cliente_horario_0700", dataSaoPauloUtc(2026, 7, 14, 7, 0));
  assert.strictEqual(
    horarioAntesJanela,
    dataSaoPauloUtc(2026, 7, 14, 8, 0).toISOString(),
    "07:00 agenda no inicio da janela do mesmo dia"
  );
  assert.strictEqual(horaSaoPaulo(horarioAntesJanela), "08:00", "tela em Sao Paulo mostra 08:00");

  const horariosJanelaCruzada = await horariosAutomaticosPara(
    "cliente_horario_cruza_meia_noite",
    dataSaoPauloUtc(2026, 7, 14, 23, 43),
    {
      quantidadeDiaria: 3,
      intervaloMinimoMinutos: 40,
      janelaFuncionamento: { inicio: "07:00", fim: "02:00" }
    },
    3
  );
  assert.deepStrictEqual(
    horariosJanelaCruzada.map(horaSaoPaulo),
    ["23:44", "00:24", "01:04"],
    "janela 07:00-02:00 atravessa a meia-noite local"
  );

  console.log("social-automatico-agendamentos: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
