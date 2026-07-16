const storage = require("./storage");
const { listarPublicacoesInstagram } = require("./instagram");
const { publicarNoInstagram } = require("./publicador-instagram.service");
const { logSocial } = require("./logs");
const {
  resolverTemplateSocial,
  payloadTemplatePersonalizadoSocial,
  snapshotTemplateSocial
} = require("./templates/resolver");

const locksCliente = new Set();
const locksAgendamentosCliente = new Set();
const PROCESSANDO_TTL_MINUTOS = Math.max(5, Math.min(180, Number(process.env.SOCIAL_AGENDAMENTOS_PROCESSANDO_TTL_MINUTOS || 30) || 30));
const STATUS_AGENDAMENTO_ATIVO = new Set(["pendente", "agendada", "aguardando_aprovacao", "processando"]);
const TIMEZONE_SOCIAL_PADRAO = "America/Sao_Paulo";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizar(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const limpo = texto(valor).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function minutosHora(valor = "") {
  const [h, m] = texto(valor).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function dataMs(valor = "") {
  const ms = Date.parse(texto(valor));
  return Number.isFinite(ms) ? ms : 0;
}

function inicioDia(data = new Date()) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

function chaveDia(data = new Date()) {
  return inicioDia(data).toISOString().slice(0, 10);
}

function dataNoDia(data = new Date(), minutos = 0) {
  const d = inicioDia(data);
  d.setMinutes(minutos, 0, 0);
  return d;
}

function partesDataTimezone(data = new Date(), timezone = TIMEZONE_SOCIAL_PADRAO) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(data);
  const mapa = {};
  for (const parte of partes) {
    if (parte.type !== "literal") mapa[parte.type] = Number(parte.value);
  }
  return {
    year: mapa.year,
    month: mapa.month,
    day: mapa.day,
    hour: mapa.hour || 0,
    minute: mapa.minute || 0,
    second: mapa.second || 0
  };
}

function adicionarDiasLocal(partes = {}, dias = 0) {
  const base = new Date(Date.UTC(partes.year, partes.month - 1, partes.day + dias, 12, 0, 0, 0));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate()
  };
}

function dataLocalParaUtc({
  timezone = TIMEZONE_SOCIAL_PADRAO,
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0
} = {}) {
  const alvoUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let utc = alvoUtc;
  for (let i = 0; i < 3; i += 1) {
    const partes = partesDataTimezone(new Date(utc), timezone);
    const atualComoUtc = Date.UTC(
      partes.year,
      partes.month - 1,
      partes.day,
      partes.hour,
      partes.minute,
      partes.second,
      0
    );
    const diferenca = alvoUtc - atualComoUtc;
    if (diferenca === 0) break;
    utc += diferenca;
  }
  return new Date(utc);
}

function dataNoDiaTimezone(partesDia = {}, minutos = 0, timezone = TIMEZONE_SOCIAL_PADRAO) {
  return dataLocalParaUtc({
    timezone,
    year: partesDia.year,
    month: partesDia.month,
    day: partesDia.day,
    hour: Math.floor(minutos / 60),
    minute: minutos % 60,
    second: 0
  });
}

function janelaDoDia(config = {}, agora = new Date()) {
  const inicio = minutosHora(config.janelaFuncionamento?.inicio || "08:00") ?? 8 * 60;
  const fim = minutosHora(config.janelaFuncionamento?.fim || "22:00") ?? 22 * 60;
  const timezone = texto(config.timezone || TIMEZONE_SOCIAL_PADRAO) || TIMEZONE_SOCIAL_PADRAO;
  const partesInicio = partesDataTimezone(agora, timezone);
  const partesFim = fim < inicio ? adicionarDiasLocal(partesInicio, 1) : partesInicio;
  const inicioData = dataNoDiaTimezone(partesInicio, inicio, timezone);
  const fimData = dataNoDiaTimezone(partesFim, fim, timezone);
  return { inicio: inicioData, fim: fimData };
}

function dentroJanela(config = {}, agora = new Date()) {
  const janela = janelaDoDia(config, agora);
  const ms = agora.getTime();
  return ms >= janela.inicio.getTime() && ms <= janela.fim.getTime();
}

function publicadoRecentemente(publicacoes = [], ofertaId = "", dias = 0, agora = Date.now()) {
  if (!texto(ofertaId) || Number(dias) <= 0) return false;
  const limiteMs = Number(dias) * 24 * 60 * 60 * 1000;
  return publicacoes.some(item => {
    if (texto(item.ofertaId) !== texto(ofertaId)) return false;
    const data = dataMs(item.publicadoEm || item.criadoEm);
    return data > 0 && agora - data <= limiteMs;
  });
}

function jaPublicado(publicacoes = [], ofertaId = "") {
  if (!texto(ofertaId)) return false;
  return publicacoes.some(item =>
    texto(item.ofertaId) === texto(ofertaId) &&
    texto(item.status || item.statusGeral) === "publicada"
  );
}

function agendamentoAtivo(agendamento = {}) {
  if (agendamento.ativo === false) return false;
  const status = texto(agendamento.status || "pendente");
  return STATUS_AGENDAMENTO_ATIVO.has(status);
}

function jaAgendado(agendamentos = [], ofertaId = "") {
  if (!texto(ofertaId)) return false;
  return agendamentos.some(item => texto(item.ofertaId) === texto(ofertaId) && agendamentoAtivo(item));
}

function agendamentosAutomaticosNoDia(agendamentos = [], agora = new Date()) {
  const dia = chaveDia(agora);
  return agendamentos.filter(item =>
    texto(item.origem) === "automatico" &&
    agendamentoAtivo(item) &&
    texto(item.agendadoPara || item.horario).startsWith(dia)
  );
}

function descontoOferta(oferta = {}) {
  const direto = numero(oferta.desconto || oferta.percentualDesconto || oferta.descontoPercentual);
  if (direto !== null) return direto;
  const atual = numero(oferta.precoAtual ?? oferta.preco);
  const original = numero(oferta.precoOriginal);
  if (atual === null || original === null || original <= 0 || atual >= original) return 0;
  return Math.round(((original - atual) / original) * 10000) / 100;
}

function recenciaMs(oferta = {}) {
  return dataMs(oferta.criadoEm || oferta.capturadaEm || oferta.recebidoEm || oferta.atualizadoEm);
}

function validarElegibilidadeOferta({ oferta = {}, config = {}, publicacoes = [], agendamentos = [], agora = new Date() } = {}) {
  const motivos = [];
  const score = Number(oferta.score ?? 0);
  const marketplace = normalizar(oferta.marketplace);
  const categoria = normalizar(oferta.categoria);
  const cupom = texto(oferta.cupom);
  const ofertaId = texto(oferta.ofertaId);
  const permitidosMarketplace = new Set((config.marketplacesPermitidos || []).map(normalizar).filter(Boolean));
  const permitidasCategorias = new Set((config.categoriasPermitidas || []).map(normalizar).filter(Boolean));
  const capturadaMs = recenciaMs(oferta);
  const idadeMs = capturadaMs ? agora.getTime() - capturadaMs : Infinity;
  const idadeMaximaMs = Number(config.idadeMaximaHoras || 6) * 60 * 60 * 1000;

  if (!config.ativo) motivos.push("automatico_desativado");
  if (!ofertaId) motivos.push("oferta_id_ausente");
  if (!texto(oferta.imagem)) motivos.push("sem_imagem");
  if (oferta.linkAfiliadoPresente === false || oferta.publicavel === false) motivos.push("sem_link");
  if (permitidosMarketplace.size && !permitidosMarketplace.has(marketplace)) motivos.push("marketplace_bloqueado");
  if (permitidasCategorias.size && !permitidasCategorias.has(categoria)) motivos.push("categoria_bloqueada");
  if (score < Number(config.scoreMinimo || 0)) motivos.push("score_baixo");
  if (config.exigirCupom === true && !cupom) motivos.push("sem_cupom");
  if (config.exigirCupom !== true && config.permitirOfertaComum === false && !cupom) motivos.push("sem_cupom");
  if (!capturadaMs || idadeMs < 0 || idadeMs > idadeMaximaMs) motivos.push("fora_idade_maxima");
  if (jaPublicado(publicacoes, ofertaId)) motivos.push("ja_publicada");
  if (publicadoRecentemente(publicacoes, ofertaId, config.evitarProdutoRepetidoDias, agora.getTime())) motivos.push("repetida");
  if (jaAgendado(agendamentos, ofertaId)) motivos.push("ja_agendada");

  return motivos;
}

function diagnosticoOferta(oferta = {}, motivos = []) {
  return {
    ofertaId: texto(oferta.ofertaId),
    titulo: texto(oferta.titulo),
    marketplace: texto(oferta.marketplace),
    categoria: texto(oferta.categoria),
    score: Number(oferta.score ?? 0),
    cupomPresente: Boolean(texto(oferta.cupom)),
    capturadaEm: texto(oferta.criadoEm || oferta.capturadaEm || oferta.recebidoEm || oferta.atualizadoEm),
    decisao: motivos.length ? "ignorada" : "candidata",
    motivos
  };
}

function ordenarCandidatas(candidatas = []) {
  return [...candidatas].sort((a, b) =>
    (texto(b.cupom) ? 1 : 0) - (texto(a.cupom) ? 1 : 0) ||
    Number(b.score ?? 0) - Number(a.score ?? 0) ||
    recenciaMs(b) - recenciaMs(a) ||
    descontoOferta(b) - descontoOferta(a) ||
    normalizar(a.marketplace).localeCompare(normalizar(b.marketplace)) ||
    normalizar(a.categoria).localeCompare(normalizar(b.categoria)) ||
    texto(a.ofertaId).localeCompare(texto(b.ofertaId))
  );
}

function selecionarOportunidades({ oportunidades = [], config = {}, publicacoes = [], agendamentos = [], agora = new Date(), limite = 1 } = {}) {
  const diagnostico = [];
  const candidatas = [];

  for (const oferta of oportunidades) {
    const motivos = validarElegibilidadeOferta({ oferta, config, publicacoes, agendamentos, agora });
    const itemDiagnostico = diagnosticoOferta(oferta, motivos);
    diagnostico.push(itemDiagnostico);
    if (!motivos.length) candidatas.push(oferta);
  }

  const ordenadas = ordenarCandidatas(candidatas);
  const selecionadas = ordenadas.slice(0, Math.max(0, Number(limite || 0) || 0));
  for (const selecionada of selecionadas) {
    const item = diagnostico.find(d => d.ofertaId === texto(selecionada.ofertaId));
    if (item) item.decisao = "selecionada";
  }

  return { selecionadas, diagnostico, candidatas: ordenadas };
}

function escolherOferta({ oportunidades = [], config = {}, publicacoes = [], agendamentos = [], agora = new Date() } = {}) {
  const { selecionadas, diagnostico } = selecionarOportunidades({
    oportunidades,
    config,
    publicacoes,
    agendamentos,
    agora,
    limite: 1
  });
  const escolhida = selecionadas[0] || null;
  if (escolhida) {
    const item = diagnostico.find(d => d.ofertaId === texto(escolhida.ofertaId));
    if (item) item.decisao = "escolhida";
  }
  return { escolhida, diagnostico };
}

function horariosOcupados(agendamentos = [], agora = new Date()) {
  const dia = chaveDia(agora);
  return agendamentos
    .filter(agendamentoAtivo)
    .map(item => dataMs(item.agendadoPara || item.horario))
    .filter(ms => ms > 0 && new Date(ms).toISOString().slice(0, 10) === dia)
    .sort((a, b) => a - b);
}

function respeitaDistancia(ms = 0, ocupados = [], intervaloMinutos = 40) {
  const distancia = Number(intervaloMinutos || 40) * 60 * 1000;
  return ocupados.every(ocupado => Math.abs(ms - ocupado) >= distancia);
}

function proximosHorariosDisponiveis({ config = {}, agendamentos = [], agora = new Date(), quantidade = 0 } = {}) {
  const intervalo = Math.max(20, Number(config.intervaloMinimoMinutos || 40) || 40);
  const janela = janelaDoDia(config, agora);
  const foraDaRodadaDoDia = agora.getTime() > janela.fim.getTime();
  const ocupados = horariosOcupados(agendamentos, agora);
  const horarios = [];
  const passoMs = 60 * 1000;
  const intervaloMs = intervalo * 60 * 1000;
  const cursorInicial = Math.max(agora.getTime() + passoMs, janela.inicio.getTime());
  let cursor = cursorInicial;
  let rejeitadosPorIntervalo = 0;

  if (foraDaRodadaDoDia) {
    cursor = janela.fim.getTime() + passoMs;
  }

  while (cursor <= janela.fim.getTime() && horarios.length < quantidade) {
    if (respeitaDistancia(cursor, ocupados, intervalo)) {
      horarios.push(new Date(cursor));
      ocupados.push(cursor);
      ocupados.sort((a, b) => a - b);
      cursor += intervaloMs;
      continue;
    }
    rejeitadosPorIntervalo += 1;
    cursor += passoMs;
  }

  let motivo = "slots_calculados";
  if (Number(quantidade || 0) <= 0) {
    motivo = "quantidade_zero";
  } else if (foraDaRodadaDoDia) {
    motivo = "rodada_diaria_encerrada";
  } else if (horarios.length < quantidade && cursorInicial > janela.fim.getTime()) {
    motivo = "cursor_inicial_fora_da_janela";
  } else if (horarios.length < quantidade && horarios.length === 0 && rejeitadosPorIntervalo > 0) {
    motivo = "todos_eliminados_por_intervalo_minimo";
  } else if (horarios.length < quantidade) {
    motivo = "janela_sem_slots_suficientes";
  }

  logSocial("[SOCIAL-AUTOMATICO-HORARIOS-TEMP]", {
    janelaInicio: janela.inicio.toISOString(),
    janelaFim: janela.fim.toISOString(),
    agora: agora.toISOString(),
    intervaloMinimo: intervalo,
    quantidadeDiaria: Number(config.quantidadeDiaria || 5),
    slotsCalculados: horarios.length,
    proximoHorario: horarios[0]?.toISOString() || "",
    motivo
  });

  return horarios;
}

function simularSelecaoAutomatica({ clienteId = "admin", limite = 50, agora = new Date() } = {}) {
  const config = storage.getConfigAutomaticoSocial(clienteId);
  const oportunidades = storage.listarOportunidadesSocial(clienteId, limite);
  const publicacoes = listarPublicacoesInstagram(clienteId, 200);
  const agendamentos = storage.listarAgendamentosSocial(clienteId);
  const restantes = Math.max(0, Number(config.quantidadeDiaria || 5) - agendamentosAutomaticosNoDia(agendamentos, agora).length);
  const { selecionadas, diagnostico } = selecionarOportunidades({
    oportunidades,
    config,
    publicacoes,
    agendamentos,
    agora,
    limite: restantes || 1
  });

  logSocial("[SOCIAL-AUTOMATICO-SIMULAR]", {
    clienteId,
    ativo: config.ativo,
    totalOportunidades: oportunidades.length,
    selecionadas: selecionadas.length,
    primeira: texto(selecionadas[0]?.ofertaId)
  });

  return {
    ok: true,
    clienteId,
    publicaria: Boolean(selecionadas[0]),
    oferta: selecionadas[0] || null,
    selecionadas,
    diagnostico,
    config
  };
}

function gatilhoAutomatico(config = {}) {
  const gatilho = config.gatilho && typeof config.gatilho === "object" ? config.gatilho : {};
  if (gatilho.ativo !== true) return undefined;
  return {
    ativo: true,
    palavra: texto(gatilho.palavra || "PROMO"),
    respostaPublica: texto(gatilho.respostaPublica)
  };
}

function resumoConfigAutomatico(config = {}) {
  return {
    quantidadeDiaria: Number(config.quantidadeDiaria || 5),
    intervaloMinimoMinutos: Number(config.intervaloMinimoMinutos || 40),
    janelaFuncionamento: config.janelaFuncionamento,
    scoreMinimo: Number(config.scoreMinimo || 0),
    exigirCupom: config.exigirCupom === true,
    permitirOfertaComum: config.permitirOfertaComum !== false,
    idadeMaximaHoras: Number(config.idadeMaximaHoras || 6),
    aprovacaoManual: config.aprovacaoManual === true,
    templatePadraoId: texto(config.templatePadraoId || "padrao-instagram")
  };
}

function auditoriaAgendamentoAutomatico(oferta = {}, config = {}, agendadoPara = new Date()) {
  return {
    origem: "automatico",
    ofertaId: texto(oferta.ofertaId),
    score: Number(oferta.score ?? 0),
    motivoSelecao: texto(oferta.cupom) ? "cupom_score_recencia" : "score_recencia",
    cupomPresente: Boolean(texto(oferta.cupom)),
    marketplace: texto(oferta.marketplace),
    categoria: texto(oferta.categoria),
    capturadaEm: texto(oferta.criadoEm || oferta.capturadaEm || oferta.recebidoEm || oferta.atualizadoEm),
    agendadoPara: agendadoPara.toISOString(),
    config: resumoConfigAutomatico(config)
  };
}

function dadosTemplateAutomatico(clienteId = "admin", templateId = "") {
  const resolvido = resolverTemplateSocial(clienteId, templateId || "padrao-instagram");
  const personalizado = payloadTemplatePersonalizadoSocial(resolvido);
  return {
    resolvido,
    personalizado,
    templateId: resolvido.templateId || "padrao-instagram",
    snapshot: personalizado?.snapshot || snapshotTemplateSocial(resolvido)
  };
}

async function executarAutomaticoCliente({
  clienteId = "admin",
  agora = new Date()
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  if (locksCliente.has(clienteSeguro)) {
    return { ok: false, clienteId: clienteSeguro, motivo: "lock_ativo", agendamentosCriados: [] };
  }

  locksCliente.add(clienteSeguro);
  try {
    logSocial("[SOCIAL-AUTOMATICO-RODADA-INICIO]", { clienteId: clienteSeguro, agora: agora.toISOString() });
    const config = storage.getConfigAutomaticoSocial(clienteSeguro);
    logSocial("[SOCIAL-AUTOMATICO-CONFIG]", {
      clienteId: clienteSeguro,
      ativo: config.ativo,
      quantidadeDiaria: config.quantidadeDiaria,
      intervaloMinimoMinutos: config.intervaloMinimoMinutos,
      scoreMinimo: config.scoreMinimo,
      idadeMaximaHoras: config.idadeMaximaHoras
    });

    if (!config.ativo) {
      logSocial("[SOCIAL-AUTOMATICO-RODADA-FIM]", { clienteId: clienteSeguro, motivo: "automatico_desativado", agendamentosCriados: 0 });
      return { ok: true, clienteId: clienteSeguro, publicado: false, agendamentosCriados: [], motivo: "automatico_desativado" };
    }

    if (config.limparAutomaticamenteOportunidadesAntigas === true) {
      storage.limparOportunidadesSocial(clienteSeguro, {
        modo: "antigas",
        idadeMaximaHoras: config.idadeMaximaHoras,
        agora
      });
    }

    const oportunidades = storage.listarOportunidadesSocial(clienteSeguro, 50);
    const publicacoes = listarPublicacoesInstagram(clienteSeguro, 200);
    const agendamentos = storage.listarAgendamentosSocial(clienteSeguro);
    const jaCriadosHoje = agendamentosAutomaticosNoDia(agendamentos, agora);
    const quantidadeDiaria = Math.min(10, Math.max(1, Number(config.quantidadeDiaria || 5) || 5));
    const restanteDia = Math.max(0, quantidadeDiaria - jaCriadosHoje.length);

    logSocial("[SOCIAL-AUTOMATICO-CANDIDATOS]", {
      clienteId: clienteSeguro,
      totalOportunidades: oportunidades.length,
      agendamentosAutomaticosHoje: jaCriadosHoje.length,
      restanteDia
    });

    if (restanteDia <= 0) {
      logSocial("[SOCIAL-AUTOMATICO-LIMITE]", { clienteId: clienteSeguro, limite: quantidadeDiaria, motivo: "limite_diario" });
      return { ok: true, clienteId: clienteSeguro, publicado: false, agendamentosCriados: [], motivo: "limite_diario" };
    }

    const { selecionadas, diagnostico } = selecionarOportunidades({
      oportunidades,
      config,
      publicacoes,
      agendamentos,
      agora,
      limite: restanteDia
    });

    for (const item of diagnostico.filter(d => d.decisao === "ignorada").slice(0, 20)) {
      logSocial("[SOCIAL-AUTOMATICO-IGNORADA]", {
        clienteId: clienteSeguro,
        ofertaId: item.ofertaId,
        motivos: item.motivos
      });
    }

    const horarios = proximosHorariosDisponiveis({
      config,
      agendamentos,
      agora,
      quantidade: Math.min(restanteDia, selecionadas.length)
    });

    if (!selecionadas.length || !horarios.length) {
      const motivo = selecionadas.length ? "sem_espaco_janela" : "sem_oportunidade_elegivel";
      logSocial("[SOCIAL-AUTOMATICO-RODADA-FIM]", { clienteId: clienteSeguro, motivo, agendamentosCriados: 0 });
      return { ok: true, clienteId: clienteSeguro, publicado: false, agendamentosCriados: [], motivo, diagnostico };
    }

    const templateAutomatico = dadosTemplateAutomatico(clienteSeguro, config.templatePadraoId);
    const criados = [];
    for (let i = 0; i < Math.min(selecionadas.length, horarios.length); i += 1) {
      const oferta = selecionadas[i];
      const agendadoPara = horarios[i];
      const automatico = auditoriaAgendamentoAutomatico(oferta, config, agendadoPara);
      const payloadTemplate = templateAutomatico.personalizado || {};
      const gatilhoAgendamento = templateAutomatico.personalizado
        ? payloadTemplate.gatilho
        : gatilhoAutomatico(config);
      const respostaPublicaAgendamento = templateAutomatico.personalizado
        ? payloadTemplate.respostaPublica
        : texto(config.gatilho?.respostaPublica);
      const mensagemPrivadaAgendamento = templateAutomatico.personalizado
        ? payloadTemplate.mensagemPrivada
        : "";
      const ctaAgendamento = templateAutomatico.personalizado ? payloadTemplate.cta : undefined;
      const legendaAgendamento = templateAutomatico.personalizado ? payloadTemplate.legenda : "";
      const automaticoComTemplate = {
        ...automatico,
        template: templateAutomatico.snapshot
      };
      logSocial("[SOCIAL-AUTOMATICO-SELECIONADA]", {
        clienteId: clienteSeguro,
        ofertaId: texto(oferta.ofertaId),
        score: Number(oferta.score ?? 0),
        cupomPresente: Boolean(texto(oferta.cupom)),
        marketplace: texto(oferta.marketplace),
        categoria: texto(oferta.categoria)
      });
      const agendamento = storage.salvarAgendamentoSocial(clienteSeguro, {
        origem: "automatico",
        tipoPublicacao: "oferta",
        status: config.aprovacaoManual ? "aguardando_aprovacao" : "agendada",
        ativo: true,
        redes: ["instagram"],
        ofertaId: texto(oferta.ofertaId),
        imagemUrl: texto(oferta.imagem || oferta.image || oferta.thumbnail),
        legenda: legendaAgendamento,
        templateId: templateAutomatico.templateId,
        gatilho: gatilhoAgendamento,
        respostaPublica: respostaPublicaAgendamento,
        mensagemPrivada: mensagemPrivadaAgendamento,
        cta: ctaAgendamento,
        agendadoPara: agendadoPara.toISOString(),
        horario: agendadoPara.toISOString(),
        timezone: "America/Sao_Paulo",
        automatico: automaticoComTemplate,
        regras: {
          automatico: automaticoComTemplate
        }
      });
      criados.push(agendamento);
      agendamentos.push(agendamento);
      logSocial("[SOCIAL-AUTOMATICO-AGENDADA]", {
        clienteId: clienteSeguro,
        agendamentoId: agendamento.id,
        ofertaId: agendamento.ofertaId,
        agendadoPara: agendamento.agendadoPara,
        status: agendamento.status
      });
    }

    logSocial("[SOCIAL-AUTOMATICO-RODADA-FIM]", {
      clienteId: clienteSeguro,
      agendamentosCriados: criados.length
    });

    return {
      ok: true,
      clienteId: clienteSeguro,
      publicado: false,
      agendamentosCriados: criados,
      totalAgendamentosCriados: criados.length,
      diagnostico
    };
  } catch (e) {
    logSocial("[SOCIAL-AUTOMATICO-ERRO]", {
      clienteId: clienteSeguro,
      erro: texto(e.message || "social_automatico_erro")
    });
    throw e;
  } finally {
    locksCliente.delete(clienteSeguro);
  }
}

async function executarAutomaticoTodosClientes({ agora = new Date() } = {}) {
  const clientes = typeof storage.listClientes === "function" ? storage.listClientes() : [];
  const resultados = [];
  const erros = [];
  let totalAgendados = 0;
  let clientesExecutados = 0;

  logSocial("[SOCIAL-AUTOMATICO-TODOS-INICIO]", {
    agora: agora.toISOString(),
    clientes: clientes.length
  });

  for (const clienteId of clientes) {
    clientesExecutados += 1;
    try {
      const resultado = await executarAutomaticoCliente({ clienteId, agora });
      const agendamentosCriados = Number(
        resultado.totalAgendamentosCriados ?? resultado.agendamentosCriados?.length ?? 0
      ) || 0;
      totalAgendados += agendamentosCriados;
      resultados.push({
        ok: resultado.ok !== false,
        clienteId,
        agendamentosCriados,
        motivo: texto(resultado.motivo)
      });
      logSocial("[SOCIAL-AUTOMATICO-TODOS-CLIENTE]", {
        clienteId,
        ok: resultado.ok !== false,
        agendamentosCriados,
        motivo: texto(resultado.motivo)
      });
    } catch (e) {
      const erro = {
        clienteId,
        erro: texto(e.message || "social_automatico_cliente_falhou")
      };
      erros.push(erro);
      resultados.push({
        ok: false,
        clienteId,
        agendamentosCriados: 0,
        erro: erro.erro
      });
      logSocial("[SOCIAL-AUTOMATICO-TODOS-CLIENTE]", {
        clienteId,
        ok: false,
        agendamentosCriados: 0,
        erro: erro.erro
      });
    }
  }

  const resumo = {
    ok: erros.length === 0,
    clientes: clientes.length,
    clientesExecutados,
    totalAgendados,
    erros,
    resultados
  };

  logSocial("[SOCIAL-AUTOMATICO-TODOS-FIM]", {
    clientes: resumo.clientes,
    clientesExecutados: resumo.clientesExecutados,
    totalAgendados: resumo.totalAgendados,
    erros: resumo.erros.length
  });

  return resumo;
}

function agendamentoVencido(agendamento = {}, agora = new Date()) {
  const status = texto(agendamento.status || "pendente");
  if (agendamento.ativo === false) return false;
  if (status === "processando") {
    const atualizadoMs = dataMs(agendamento.atualizadoEm || agendamento.criadoEm);
    return atualizadoMs > 0 && agora.getTime() - atualizadoMs >= PROCESSANDO_TTL_MINUTOS * 60 * 1000;
  }
  if (!["pendente", "agendada"].includes(status)) return false;
  const data = dataMs(agendamento.agendadoPara || agendamento.horario);
  return data > 0 && data <= agora.getTime();
}

function payloadPublicadorAgendamento(clienteSeguro = "admin", agendamento = {}, extras = {}) {
  const tipoPublicacao = texto(agendamento.tipoPublicacao || "oferta") || "oferta";
  const origemAgendamento = texto(agendamento.origem || "agendada") || "agendada";
  return {
    clienteId: clienteSeguro,
    origem: origemAgendamento === "automatico" ? "automatica" : origemAgendamento,
    tipoPublicacao,
    ofertaId: agendamento.ofertaId,
    imagemUrl: agendamento.imagemUrl,
    legenda: agendamento.legenda,
    templateId: agendamento.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram"),
    gatilho: agendamento.gatilho,
    respostaPublica: agendamento.respostaPublica,
    mensagemPrivada: agendamento.mensagemPrivada,
    direct: agendamento.direct,
    redirect: agendamento.redirect,
    urlDestino: agendamento.urlDestino,
    cta: agendamento.cta,
    linkAfiliado: agendamento.linkAfiliado,
    agendamentoId: agendamento.id,
    idempotencyKey: `agendada:${clienteSeguro}:${agendamento.id}`,
    ...extras
  };
}

async function publicarAgendamentoSocial({
  clienteId = "admin",
  agendamento = {},
  renderizadorArte,
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const agendamentoId = texto(agendamento.id);
  if (!agendamentoId) throw new Error("agendamento_id_obrigatorio");

  const emProcessamento = storage.salvarAgendamentoSocial(clienteSeguro, {
    ...agendamento,
    status: "processando"
  });

  try {
    const resultado = await publicarNoInstagram(payloadPublicadorAgendamento(clienteSeguro, emProcessamento, {
      renderizadorArte,
      httpClient,
      polling
    }));
    const status = resultado.publicacao?.status === "publicada" ? "publicada" : "erro";
    const final = storage.salvarAgendamentoSocial(clienteSeguro, {
      ...emProcessamento,
      status,
      publicacaoId: resultado.publicacao?.id || "",
      erro: resultado.publicacao?.erro || null
    });
    return { agendamentoId: emProcessamento.id, status, agendamento: final, publicacao: resultado.publicacao };
  } catch (e) {
    const final = storage.salvarAgendamentoSocial(clienteSeguro, {
      ...emProcessamento,
      status: "erro",
      erro: { message: texto(e.message || "agendamento_publicacao_falhou") }
    });
    return { agendamentoId: emProcessamento.id, status: "erro", agendamento: final, erro: texto(e.message) };
  }
}

async function executarAgendamentosPendentesCliente({
  clienteId = "admin",
  agora = new Date(),
  renderizadorArte,
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  if (locksAgendamentosCliente.has(clienteSeguro)) {
    return { ok: false, clienteId: clienteSeguro, motivo: "lock_ativo", executados: [] };
  }

  locksAgendamentosCliente.add(clienteSeguro);
  const executados = [];

  try {
    const agendamentos = storage.listarAgendamentosSocial(clienteSeguro);
    for (const agendamento of agendamentos.filter(item => agendamentoVencido(item, agora))) {
      const resultado = await publicarAgendamentoSocial({
        clienteId: clienteSeguro,
        agendamento,
        renderizadorArte,
        httpClient,
        polling
      });
      executados.push({
        agendamentoId: resultado.agendamentoId,
        status: resultado.status,
        publicacao: resultado.publicacao,
        erro: resultado.erro
      });
    }
  } finally {
    locksAgendamentosCliente.delete(clienteSeguro);
  }

  logSocial("[SOCIAL-AGENDAMENTOS-EXECUTADOS]", {
    clienteId: clienteSeguro,
    total: executados.length
  });

  return {
    ok: true,
    clienteId: clienteSeguro,
    executados
  };
}

async function publicarAgendamentoAgora({
  clienteId = "admin",
  agendamentoId = "",
  renderizadorArte,
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const agendamento = storage.getAgendamentoSocial(clienteSeguro, agendamentoId);
  if (!agendamento) throw new Error("agendamento_nao_encontrado");
  if (["publicada", "processando"].includes(texto(agendamento.status))) {
    return { ok: false, clienteId: clienteSeguro, motivo: "agendamento_nao_publicavel", agendamento };
  }

  const resultado = await publicarAgendamentoSocial({
    clienteId: clienteSeguro,
    agendamento,
    renderizadorArte,
    httpClient,
    polling
  });

  return {
    ok: resultado.status === "publicada",
    clienteId: clienteSeguro,
    ...resultado
  };
}

async function executarAgendamentosPendentesTodosClientes({
  agora = new Date(),
  renderizadorArte,
  httpClient,
  polling
} = {}) {
  const clientes = typeof storage.listClientes === "function" ? storage.listClientes() : [];
  const resultados = [];

  for (const clienteId of clientes) {
    try {
      const resultado = await executarAgendamentosPendentesCliente({
        clienteId,
        agora,
        renderizadorArte,
        httpClient,
        polling
      });
      if (resultado.executados.length || resultado.ok === false) resultados.push(resultado);
    } catch (e) {
      resultados.push({ ok: false, clienteId, erro: texto(e.message), executados: [] });
    }
  }

  const totalExecutados = resultados.reduce((total, item) => total + (item.executados?.length || 0), 0);
  logSocial("[SOCIAL-AGENDAMENTOS-SCHEDULER-RODADA]", {
    clientes: clientes.length,
    clientesComExecucao: resultados.length,
    totalExecutados
  });

  return {
    ok: true,
    clientes: clientes.length,
    totalExecutados,
    resultados
  };
}

module.exports = {
  simularSelecaoAutomatica,
  executarAutomaticoCliente,
  executarAutomaticoTodosClientes,
  executarAgendamentosPendentesCliente,
  executarAgendamentosPendentesTodosClientes,
  publicarAgendamentoAgora,
  escolherOferta
};
