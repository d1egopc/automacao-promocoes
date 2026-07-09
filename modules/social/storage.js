const {
  readClienteJson,
  writeClienteJson
} = require("../../utils/storage");
const { logSocial, logErroSocial } = require("./logs");

const ARQUIVOS = {
  config: "social-config.json",
  templates: "social-templates.json",
  agendamentos: "social-agendamentos.json",
  publicacoes: "social-publicacoes.json",
  oportunidades: "social-oportunidades.json"
};

const REDES_SUPORTADAS = new Set(["instagram", "facebook", "telegram"]);
const STATUS_PUBLICACAO = new Set(["rascunho", "agendada", "pendente", "publicada", "erro", "cancelada"]);

function agoraIso() {
  return new Date().toISOString();
}

function criarId(prefixo = "social") {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarRede(rede = "") {
  const valor = texto(rede).toLowerCase();
  return REDES_SUPORTADAS.has(valor) ? valor : "";
}

function criarConfigPadrao(clienteId = "admin") {
  return {
    clienteId,
    ativo: false,
    redes: {
      instagram: { ativo: false, conectado: false, credenciaisConfiguradas: false },
      facebook: { ativo: false, conectado: false, credenciaisConfiguradas: false },
      telegram: { ativo: false, conectado: false, destinos: [] }
    },
    preferencias: {
      usarOfertaUniversal: true,
      publicarAutomaticamente: false,
      exigirAprovacaoManual: true
    },
    criadoEm: agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function normalizarConfig(clienteId, dados = {}) {
  const padrao = criarConfigPadrao(clienteId);
  const redes = dados.redes && typeof dados.redes === "object" ? dados.redes : {};

  return {
    ...padrao,
    ...dados,
    clienteId,
    ativo: dados.ativo === true,
    redes: {
      instagram: {
        ...padrao.redes.instagram,
        ...(redes.instagram && typeof redes.instagram === "object" ? redes.instagram : {}),
        ativo: redes.instagram?.ativo === true
      },
      facebook: {
        ...padrao.redes.facebook,
        ...(redes.facebook && typeof redes.facebook === "object" ? redes.facebook : {}),
        ativo: redes.facebook?.ativo === true
      },
      telegram: {
        ...padrao.redes.telegram,
        ...(redes.telegram && typeof redes.telegram === "object" ? redes.telegram : {}),
        ativo: redes.telegram?.ativo === true,
        destinos: lista(redes.telegram?.destinos).map(item => ({
          id: texto(item.id || criarId("destino")),
          nome: texto(item.nome),
          tipo: texto(item.tipo || "canal"),
          destino: texto(item.destino || item.chatId || item.url),
          ativo: item.ativo !== false
        })).filter(item => item.destino)
      }
    },
    preferencias: {
      ...padrao.preferencias,
      ...(dados.preferencias && typeof dados.preferencias === "object" ? dados.preferencias : {}),
      usarOfertaUniversal: true,
      publicarAutomaticamente: false
    },
    atualizadoEm: agoraIso()
  };
}

function normalizarTemplate(clienteId, template = {}, index = 0) {
  const rede = normalizarRede(template.rede) || "instagram";

  return {
    id: texto(template.id || criarId("template")),
    clienteId,
    nome: texto(template.nome || `Template Social ${index + 1}`),
    rede,
    ativo: template.ativo !== false,
    formato: texto(template.formato || "post"),
    conteudo: texto(template.conteudo || ""),
    camposOfertaUniversal: lista(template.camposOfertaUniversal).map(texto).filter(Boolean),
    criadoEm: template.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function normalizarAgendamento(clienteId, agendamento = {}, index = 0) {
  const redes = lista(agendamento.redes)
    .map(normalizarRede)
    .filter(Boolean);

  return {
    id: texto(agendamento.id || criarId("agendamento")),
    clienteId,
    nome: texto(agendamento.nome || `Agendamento Social ${index + 1}`),
    ativo: agendamento.ativo !== false,
    redes,
    horario: texto(agendamento.horario),
    timezone: texto(agendamento.timezone || "America/Sao_Paulo"),
    regras: agendamento.regras && typeof agendamento.regras === "object" ? agendamento.regras : {},
    criadoEm: agendamento.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function resumirOfertaUniversal(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};

  return {
    id: texto(oferta.id || oferta.ofertaId || criarId("oferta")),
    ofertaUniversal: oferta.ofertaUniversal === true || texto(oferta.versaoOfertaUniversal).startsWith("v2"),
    versaoOfertaUniversal: texto(oferta.versaoOfertaUniversal),
    titulo: texto(oferta.titulo || oferta.nome),
    marketplace: texto(oferta.marketplace),
    categoria: texto(v2.categoria || oferta.categoria),
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    cupom: texto(oferta.cupom || oferta.cupomCodigo),
    score: v2.score ?? oferta.score,
    prioridade: v2.prioridade ?? oferta.prioridade,
    linkAfiliado: texto(oferta.linkAfiliado || oferta.linkFinal || oferta.link),
    imagem: texto(oferta.imagem),
    origem: texto(oferta.origem)
  };
}

function normalizarPublicacao(clienteId, publicacao = {}, index = 0) {
  const status = texto(publicacao.status || "rascunho");

  return {
    id: texto(publicacao.id || criarId("publicacao")),
    clienteId,
    redes: lista(publicacao.redes).map(normalizarRede).filter(Boolean),
    status: STATUS_PUBLICACAO.has(status) ? status : "rascunho",
    modo: texto(publicacao.modo || "manual"),
    oferta: publicacao.oferta ? resumirOfertaUniversal(publicacao.oferta) : (publicacao.ofertaUniversal || null),
    conteudo: publicacao.conteudo && typeof publicacao.conteudo === "object" ? publicacao.conteudo : {},
    agendadoPara: texto(publicacao.agendadoPara),
    motivo: texto(publicacao.motivo),
    criadoEm: publicacao.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function lerCliente(clienteId, tipo, fallback) {
  try {
    return readClienteJson(clienteId, ARQUIVOS[tipo], fallback);
  } catch (e) {
    logErroSocial({ clienteId, tipo, erro: e.message });
    return fallback;
  }
}

function escreverCliente(clienteId, tipo, dados) {
  try {
    writeClienteJson(clienteId, ARQUIVOS[tipo], dados);
    return true;
  } catch (e) {
    logErroSocial({ clienteId, tipo, erro: e.message });
    return false;
  }
}

function getConfigSocial(clienteId = "admin") {
  return normalizarConfig(clienteId, lerCliente(clienteId, "config", criarConfigPadrao(clienteId)));
}

function setConfigSocial(clienteId = "admin", dados = {}) {
  const config = normalizarConfig(clienteId, {
    ...getConfigSocial(clienteId),
    ...(dados && typeof dados === "object" ? dados : {})
  });

  escreverCliente(clienteId, "config", config);
  logSocial("[SOCIAL-CONFIG]", { clienteId, atualizado: true });
  return config;
}

function listarTemplatesSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "templates", [])).map((item, index) =>
    normalizarTemplate(clienteId, item, index)
  );
}

function salvarTemplateSocial(clienteId = "admin", dados = {}) {
  const atuais = listarTemplatesSocial(clienteId);
  const novo = normalizarTemplate(clienteId, dados, atuais.length);
  const semAtual = atuais.filter(item => item.id !== novo.id);
  const templates = [...semAtual, novo];

  escreverCliente(clienteId, "templates", templates);
  logSocial("[SOCIAL-TEMPLATE]", { clienteId, id: novo.id, rede: novo.rede });
  return novo;
}

function listarAgendamentosSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "agendamentos", [])).map((item, index) =>
    normalizarAgendamento(clienteId, item, index)
  );
}

function salvarAgendamentoSocial(clienteId = "admin", dados = {}) {
  const atuais = listarAgendamentosSocial(clienteId);
  const novo = normalizarAgendamento(clienteId, dados, atuais.length);
  const semAtual = atuais.filter(item => item.id !== novo.id);
  const agendamentos = [...semAtual, novo];

  escreverCliente(clienteId, "agendamentos", agendamentos);
  logSocial("[SOCIAL-AGENDAMENTO]", { clienteId, id: novo.id, redes: novo.redes });
  return novo;
}

function listarPublicacoesSocial(clienteId = "admin", limite = 100) {
  return lista(lerCliente(clienteId, "publicacoes", []))
    .map((item, index) => normalizarPublicacao(clienteId, item, index))
    .slice(-limite)
    .reverse();
}

function registrarPublicacaoSocial(clienteId = "admin", dados = {}) {
  const atuais = lista(lerCliente(clienteId, "publicacoes", []));
  const publicacao = normalizarPublicacao(clienteId, {
    ...dados,
    status: dados.status || "rascunho",
    motivo: dados.motivo || "publicacao_social_nao_implementada"
  }, atuais.length);
  const publicacoes = [...atuais.filter(item => item.id !== publicacao.id), publicacao].slice(-500);

  escreverCliente(clienteId, "publicacoes", publicacoes);
  logSocial("[SOCIAL-PUBLICACAO]", {
    clienteId,
    id: publicacao.id,
    redes: publicacao.redes,
    status: publicacao.status,
    motivo: publicacao.motivo
  });
  return publicacao;
}

function listarOportunidadesSocial(clienteId = "admin", limite = 100) {
  return lista(lerCliente(clienteId, "oportunidades", []))
    .slice(-limite)
    .reverse();
}

module.exports = {
  ARQUIVOS,
  REDES_SUPORTADAS,
  criarConfigPadrao,
  getConfigSocial,
  setConfigSocial,
  listarTemplatesSocial,
  salvarTemplateSocial,
  listarAgendamentosSocial,
  salvarAgendamentoSocial,
  listarPublicacoesSocial,
  registrarPublicacaoSocial,
  listarOportunidadesSocial,
  resumirOfertaUniversal
};
