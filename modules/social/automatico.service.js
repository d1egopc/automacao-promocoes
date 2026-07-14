const storage = require("./storage");
const { listarPublicacoesInstagram } = require("./instagram");
const { publicarNoInstagram } = require("./publicador-instagram.service");
const { logSocial } = require("./logs");

const locksCliente = new Set();

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

function minutosHora(valor = "") {
  const [h, m] = texto(valor).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function dentroJanela(config = {}, agora = new Date()) {
  const inicio = minutosHora(config.janelaFuncionamento?.inicio || "08:00");
  const fim = minutosHora(config.janelaFuncionamento?.fim || "22:00");
  if (inicio === null || fim === null) return true;
  const atual = agora.getHours() * 60 + agora.getMinutes();
  if (inicio <= fim) return atual >= inicio && atual <= fim;
  return atual >= inicio || atual <= fim;
}

function publicadoRecentemente(publicacoes = [], ofertaId = "", dias = 0, agora = Date.now()) {
  if (!texto(ofertaId) || Number(dias) <= 0) return false;
  const limiteMs = Number(dias) * 24 * 60 * 60 * 1000;
  return publicacoes.some(item => {
    if (texto(item.ofertaId) !== texto(ofertaId)) return false;
    const data = Date.parse(texto(item.publicadoEm || item.criadoEm));
    return Number.isFinite(data) && agora - data <= limiteMs;
  });
}

function atingiuLimiteDiario(publicacoes = [], limite = 1, agora = new Date()) {
  const dia = agora.toISOString().slice(0, 10);
  const total = publicacoes.filter(item =>
    texto(item.status) === "publicada" &&
    texto(item.origem || "manual") === "automatica" &&
    texto(item.publicadoEm || item.criadoEm).startsWith(dia)
  ).length;
  return total >= Number(limite || 1);
}

function respeitaIntervalo(publicacoes = [], intervaloMinimoMinutos = 180, agora = Date.now()) {
  const ultima = publicacoes
    .filter(item => texto(item.status) === "publicada" && texto(item.origem || "manual") === "automatica")
    .map(item => Date.parse(texto(item.publicadoEm || item.criadoEm)))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!ultima) return true;
  return agora - ultima >= Number(intervaloMinimoMinutos || 180) * 60 * 1000;
}

function escolherOferta({ oportunidades = [], config = {}, publicacoes = [], agora = new Date() } = {}) {
  const diagnostico = [];
  const permitidosMarketplace = new Set((config.marketplacesPermitidos || []).map(normalizar).filter(Boolean));
  const permitidasCategorias = new Set((config.categoriasPermitidas || []).map(normalizar).filter(Boolean));
  const agoraMs = agora.getTime();
  const bloqueioGlobal = [];

  if (!config.ativo) bloqueioGlobal.push("automatico_desativado");
  if (!dentroJanela(config, agora)) bloqueioGlobal.push("fora_janela");
  if (atingiuLimiteDiario(publicacoes, config.quantidadeDiaria, agora)) bloqueioGlobal.push("limite_diario");
  if (!respeitaIntervalo(publicacoes, config.intervaloMinimoMinutos, agoraMs)) bloqueioGlobal.push("intervalo_minimo");

  for (const oferta of oportunidades) {
    const motivos = [...bloqueioGlobal];
    const score = Number(oferta.score ?? 0);
    const marketplace = normalizar(oferta.marketplace);
    const categoria = normalizar(oferta.categoria);
    const cupom = texto(oferta.cupom);

    if (!texto(oferta.imagem)) motivos.push("sem_imagem");
    if (oferta.linkAfiliadoPresente === false || oferta.publicavel === false) motivos.push("sem_link");
    if (permitidosMarketplace.size && !permitidosMarketplace.has(marketplace)) motivos.push("marketplace_bloqueado");
    if (permitidasCategorias.size && !permitidasCategorias.has(categoria)) motivos.push("categoria_bloqueada");
    if (score < Number(config.scoreMinimo || 0)) motivos.push("score_baixo");
    if (config.exigirCupom === true && !cupom) motivos.push("sem_cupom");
    if (config.permitirOfertaComum === false && !cupom) motivos.push("sem_cupom");
    if (publicadoRecentemente(publicacoes, oferta.ofertaId, config.evitarProdutoRepetidoDias, agoraMs)) {
      motivos.push("repetida");
    }

    diagnostico.push({
      ofertaId: texto(oferta.ofertaId),
      titulo: texto(oferta.titulo),
      marketplace: texto(oferta.marketplace),
      categoria: texto(oferta.categoria),
      score,
      cupomPresente: Boolean(cupom),
      decisao: motivos.length ? "ignorada" : "candidata",
      motivos
    });
  }

  const candidatas = oportunidades
    .filter(oferta => {
      const item = diagnostico.find(d => d.ofertaId === texto(oferta.ofertaId));
      return item && item.decisao === "candidata";
    })
    .sort((a, b) =>
      (texto(b.cupom) ? 1 : 0) - (texto(a.cupom) ? 1 : 0) ||
      Number(b.score ?? 0) - Number(a.score ?? 0) ||
      Date.parse(texto(b.criadoEm)) - Date.parse(texto(a.criadoEm))
    );

  const escolhida = candidatas[0] || null;
  if (escolhida) {
    const item = diagnostico.find(d => d.ofertaId === texto(escolhida.ofertaId));
    if (item) item.decisao = "escolhida";
  }

  return { escolhida, diagnostico };
}

function simularSelecaoAutomatica({ clienteId = "admin", limite = 50, agora = new Date() } = {}) {
  const config = storage.getConfigAutomaticoSocial(clienteId);
  const oportunidades = storage.listarOportunidadesSocial(clienteId, limite);
  const publicacoes = listarPublicacoesInstagram(clienteId, 200);
  const { escolhida, diagnostico } = escolherOferta({ oportunidades, config, publicacoes, agora });

  logSocial("[SOCIAL-AUTOMATICO-SIMULAR]", {
    clienteId,
    ativo: config.ativo,
    totalOportunidades: oportunidades.length,
    escolhida: texto(escolhida?.ofertaId)
  });

  return {
    ok: true,
    clienteId,
    publicaria: Boolean(escolhida),
    oferta: escolhida,
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

async function executarAutomaticoCliente({
  clienteId = "admin",
  agora = new Date(),
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  if (locksCliente.has(clienteSeguro)) {
    return { ok: false, clienteId: clienteSeguro, motivo: "lock_ativo" };
  }

  locksCliente.add(clienteSeguro);
  try {
    const simulacao = simularSelecaoAutomatica({ clienteId: clienteSeguro, agora });
    if (!simulacao.publicaria || !simulacao.oferta?.ofertaId) {
      return { ok: true, clienteId: clienteSeguro, publicado: false, motivo: "sem_oferta_elegivel", simulacao };
    }

    const config = simulacao.config;
    const ofertaId = texto(simulacao.oferta.ofertaId);
    const janela = agora.toISOString().slice(0, 13);
    const resultado = await publicarNoInstagram({
      clienteId: clienteSeguro,
      origem: "automatica",
      tipoPublicacao: "oferta",
      ofertaId,
      templateId: config.templatePadraoId || "padrao-instagram",
      gatilho: gatilhoAutomatico(config),
      respostaPublica: texto(config.gatilho?.respostaPublica),
      idempotencyKey: `auto:${clienteSeguro}:${ofertaId}:${janela}`,
      httpClient,
      polling
    });

    return {
      ok: resultado.publicacao?.status !== "erro",
      clienteId: clienteSeguro,
      publicado: resultado.publicacao?.status === "publicada",
      duplicada: resultado.duplicada === true,
      publicacao: resultado.publicacao,
      simulacao
    };
  } finally {
    locksCliente.delete(clienteSeguro);
  }
}

function agendamentoVencido(agendamento = {}, agora = new Date()) {
  const status = texto(agendamento.status || "pendente");
  if (!["pendente", "agendada"].includes(status)) return false;
  const data = Date.parse(texto(agendamento.agendadoPara || agendamento.horario));
  return Number.isFinite(data) && data <= agora.getTime();
}

async function executarAgendamentosPendentesCliente({
  clienteId = "admin",
  agora = new Date(),
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const agendamentos = storage.listarAgendamentosSocial(clienteSeguro);
  const executados = [];

  for (const agendamento of agendamentos.filter(item => agendamentoVencido(item, agora))) {
    const emProcessamento = storage.salvarAgendamentoSocial(clienteSeguro, {
      ...agendamento,
      status: "processando"
    });
    try {
      const resultado = await publicarNoInstagram({
        clienteId: clienteSeguro,
        origem: "agendada",
        tipoPublicacao: emProcessamento.tipoPublicacao,
        ofertaId: emProcessamento.ofertaId,
        imagemUrl: emProcessamento.imagemUrl,
        legenda: emProcessamento.legenda,
        templateId: emProcessamento.templateId,
        gatilho: emProcessamento.gatilho,
        respostaPublica: emProcessamento.respostaPublica,
        agendamentoId: emProcessamento.id,
        idempotencyKey: `agendada:${clienteSeguro}:${emProcessamento.id}`,
        httpClient,
        polling
      });
      const status = resultado.publicacao?.status === "publicada" ? "publicada" : "erro";
      storage.salvarAgendamentoSocial(clienteSeguro, {
        ...emProcessamento,
        status,
        publicacaoId: resultado.publicacao?.id || "",
        erro: resultado.publicacao?.erro || null
      });
      executados.push({ agendamentoId: emProcessamento.id, status, publicacao: resultado.publicacao });
    } catch (e) {
      storage.salvarAgendamentoSocial(clienteSeguro, {
        ...emProcessamento,
        status: "erro",
        erro: { message: texto(e.message || "agendamento_publicacao_falhou") }
      });
      executados.push({ agendamentoId: emProcessamento.id, status: "erro", erro: texto(e.message) });
    }
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

module.exports = {
  simularSelecaoAutomatica,
  executarAutomaticoCliente,
  executarAgendamentosPendentesCliente,
  escolherOferta
};
