const {
  readClienteJson,
  writeClienteJson,
  listClientes
} = require("../../utils/storage");
const { logSocial, logErroSocial } = require("./logs");

const ARQUIVOS = {
  config: "social-config.json",
  meta: "social-meta.json",
  templates: "social-templates.json",
  rascunhos: "social-rascunhos.json",
  agendamentos: "social-agendamentos.json",
  publicacoes: "social-publicacoes.json",
  oportunidades: "social-oportunidades.json",
  automatico: "social-automatico.json"
};

const REDES_SUPORTADAS = new Set(["instagram", "facebook", "telegram"]);
const STATUS_PUBLICACAO = new Set(["rascunho", "agendada", "pendente", "aguardando_aprovacao", "processando", "publicada", "erro", "cancelada"]);
const ORIGENS_PUBLICACAO = new Set(["manual", "personalizada", "automatica", "automatico", "agendada"]);
const TIPOS_PUBLICACAO = new Set(["oferta", "livre"]);

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

function normalizarOrigemSocial(valor = "", fallback = "manual") {
  const origem = texto(valor || fallback).toLowerCase();
  return ORIGENS_PUBLICACAO.has(origem) ? origem : fallback;
}

function normalizarTipoPublicacao(valor = "", fallback = "oferta") {
  const tipo = texto(valor || fallback).toLowerCase();
  return TIPOS_PUBLICACAO.has(tipo) ? tipo : fallback;
}

function objetoOpcional(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const limpo = texto(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!limpo) return null;

  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : null;
}

function inteiro(valor, fallback = 0, min = 0, max = 9999) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function hora(valor = "", fallback = "") {
  const v = texto(valor);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function urlHttpsOpcional(valor = "") {
  const v = texto(valor);
  if (!v) return "";
  try {
    const parsed = new URL(v);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function dataMs(valor = "") {
  const data = Date.parse(texto(valor));
  return Number.isFinite(data) ? data : 0;
}

function normalizarChave(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function temImagemValida(valor = "") {
  const imagem = texto(valor);
  return /^https?:\/\//i.test(imagem);
}

function temLinkValido(valor = "") {
  const link = texto(valor);
  return /^https?:\/\//i.test(link);
}

function idOfertaOficialSocial(item = {}) {
  const candidatos = [
    item.ofertaId,
    item.ofertaUniversalId,
    item.engineOfertaId,
    item.engineOfertaUuid,
    item.produtoId,
    item.productId,
    item.sku,
    item.id
  ];
  return texto(candidatos.find(valor => {
    const id = texto(valor);
    return id && !id.startsWith("social_");
  }));
}

function caminhoLogicoCliente(clienteId = "admin", tipo = "") {
  return `${process.env.DATA_DIR || "/data"}/clientes/${texto(clienteId || "admin")}/${ARQUIVOS[tipo] || ""}`;
}

function resumoMetaStorage(meta = {}) {
  return {
    conectado: meta.conectado === true,
    tokenPresente: Boolean(texto(meta.token?.accessToken || meta.accessToken)),
    paginasTotal: lista(meta.paginas).length
  };
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

function criarMetaPadrao(clienteId = "admin") {
  return {
    clienteId,
    status: "desconectado",
    conectado: false,
    facebook: {
      conectado: false,
      pageId: "",
      pageName: "",
      pageUsername: ""
    },
    instagram: {
      conectado: false,
      instagramBusinessAccountId: "",
      username: "",
      name: ""
    },
    ativos: {
      status: "pendente",
      motivo: "",
      atualizadoEm: ""
    },
    token: {
      accessToken: "",
      tokenType: "",
      expiresIn: null,
      expiresAt: "",
      recebidoEm: ""
    },
    paginas: [],
    atualizadoEm: agoraIso()
  };
}

function criarConfigAutomaticoPadrao(clienteId = "admin") {
  return {
    clienteId,
    ativo: false,
    templatePadraoId: "padrao-instagram",
    horarios: [],
    quantidadeDiaria: 5,
    janelaFuncionamento: {
      inicio: "08:00",
      fim: "22:00"
    },
    intervaloMinimoMinutos: 40,
    idadeMaximaHoras: 6,
    marketplacesPermitidos: [],
    categoriasPermitidas: [],
    scoreMinimo: 70,
    exigirCupom: false,
    permitirOfertaComum: true,
    aprovacaoManual: false,
    evitarProdutoRepetidoDias: 30,
    gatilho: {
      ativo: false,
      palavra: "PROMO",
      respostaPublica: ""
    },
    cta: {
      destino: "bio",
      linkGrupo: "",
      whatsapp: "",
      linkBio: ""
    },
    criadoEm: agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function temToken(valor = "") {
  return Boolean(texto(valor));
}

function sanitizarConexaoMeta(meta = {}) {
  const token = meta.token && typeof meta.token === "object" ? meta.token : {};

  return {
    clienteId: texto(meta.clienteId),
    status: meta.conectado ? "conectado" : "desconectado",
    conectado: meta.conectado === true,
    facebook: {
      conectado: meta.facebook?.conectado === true,
      pageId: texto(meta.facebook?.pageId),
      pageName: texto(meta.facebook?.pageName),
      pageUsername: texto(meta.facebook?.pageUsername)
    },
    instagram: {
      conectado: meta.instagram?.conectado === true,
      instagramBusinessAccountId: texto(meta.instagram?.instagramBusinessAccountId),
      username: texto(meta.instagram?.username),
      name: texto(meta.instagram?.name)
    },
    ativos: {
      status: texto(meta.ativos?.status || "pendente"),
      motivo: texto(meta.ativos?.motivo),
      atualizadoEm: texto(meta.ativos?.atualizadoEm)
    },
    token: {
      presente: temToken(token.accessToken),
      tokenType: texto(token.tokenType),
      expiresIn: token.expiresIn ?? null,
      expiresAt: texto(token.expiresAt),
      recebidoEm: texto(token.recebidoEm)
    },
    paginas: lista(meta.paginas).map(pagina => ({
      id: texto(pagina.id),
      name: texto(pagina.name),
      username: texto(pagina.username),
      instagramBusinessAccountId: texto(pagina.instagramBusinessAccountId),
      instagramUsername: texto(pagina.instagramUsername),
      instagramName: texto(pagina.instagramName),
      conectado: pagina.conectado === true
    })),
    atualizadoEm: texto(meta.atualizadoEm)
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
  const statusEntrada = texto(agendamento.status || "pendente");
  const status = statusEntrada === "rascunho" ? "pendente" : statusEntrada;
  const tipoPublicacao = normalizarTipoPublicacao(agendamento.tipoPublicacao || agendamento.tipo, "oferta");
  const origem = normalizarOrigemSocial(agendamento.origem, "agendada");

  return {
    id: texto(agendamento.id || criarId("agendamento")),
    clienteId,
    nome: texto(agendamento.nome || `Agendamento Social ${index + 1}`),
    ativo: agendamento.ativo !== false,
    redes,
    origem,
    tipoPublicacao,
    status: STATUS_PUBLICACAO.has(status) ? status : "pendente",
    ofertaId: texto(agendamento.ofertaId || agendamento.oportunidadeId),
    imagemUrl: texto(agendamento.imagemUrl || agendamento.imagem),
    legenda: texto(agendamento.legenda || agendamento.mensagem),
    templateId: texto(agendamento.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram")),
    gatilho: objetoOpcional(agendamento.gatilho),
    respostaPublica: texto(agendamento.respostaPublica || agendamento.gatilho?.respostaPublica),
    mensagemPrivada: texto(agendamento.mensagemPrivada || agendamento.mensagemDirect || agendamento.textoDirect || agendamento.gatilho?.textoDirect),
    direct: objetoOpcional(agendamento.direct),
    redirect: objetoOpcional(agendamento.redirect),
    urlDestino: texto(agendamento.urlDestino || agendamento.linkDestino || agendamento.linkAfiliado || agendamento.direct?.urlDestino || agendamento.direct?.url || agendamento.redirect?.urlDestino || agendamento.redirect?.url || agendamento.cta?.urlDestino || agendamento.cta?.url),
    cta: objetoOpcional(agendamento.cta),
    linkAfiliado: texto(agendamento.linkAfiliado || agendamento.urlDestino),
    agendadoPara: texto(agendamento.agendadoPara || agendamento.horarioExecucao),
    horario: texto(agendamento.horario),
    timezone: texto(agendamento.timezone || "America/Sao_Paulo"),
    regras: agendamento.regras && typeof agendamento.regras === "object" ? agendamento.regras : {},
    automatico: agendamento.automatico && typeof agendamento.automatico === "object" ? agendamento.automatico : null,
    publicacaoId: texto(agendamento.publicacaoId),
    erro: agendamento.erro && typeof agendamento.erro === "object" ? agendamento.erro : null,
    criadoEm: agendamento.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function normalizarRascunho(clienteId, rascunho = {}, index = 0) {
  const status = texto(rascunho.status || "rascunho");
  const tipoPublicacao = normalizarTipoPublicacao(rascunho.tipoPublicacao || rascunho.tipo, "oferta");
  const origem = normalizarOrigemSocial(rascunho.origem, tipoPublicacao === "livre" ? "personalizada" : "manual");

  return {
    id: texto(rascunho.id || criarId("rascunho")),
    clienteId,
    nome: texto(rascunho.nome || `Rascunho Social ${index + 1}`),
    origem,
    tipoPublicacao,
    status: STATUS_PUBLICACAO.has(status) ? status : "rascunho",
    ofertaId: texto(rascunho.ofertaId || rascunho.oportunidadeId),
    imagemUrl: texto(rascunho.imagemUrl || rascunho.imagem),
    legenda: texto(rascunho.legenda || rascunho.mensagem),
    templateId: texto(rascunho.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram")),
    gatilho: objetoOpcional(rascunho.gatilho),
    respostaPublica: texto(rascunho.respostaPublica || rascunho.gatilho?.respostaPublica),
    mensagemPrivada: texto(rascunho.mensagemPrivada || rascunho.mensagemDirect || rascunho.textoDirect || rascunho.gatilho?.textoDirect),
    direct: objetoOpcional(rascunho.direct),
    redirect: objetoOpcional(rascunho.redirect),
    urlDestino: texto(rascunho.urlDestino || rascunho.linkDestino || rascunho.linkAfiliado || rascunho.direct?.urlDestino || rascunho.direct?.url || rascunho.redirect?.urlDestino || rascunho.redirect?.url || rascunho.cta?.urlDestino || rascunho.cta?.url),
    cta: objetoOpcional(rascunho.cta),
    linkAfiliado: texto(rascunho.linkAfiliado || rascunho.urlDestino),
    agendadoPara: texto(rascunho.agendadoPara || rascunho.horarioExecucao),
    agendamentoId: texto(rascunho.agendamentoId),
    publicacaoId: texto(rascunho.publicacaoId),
    erro: objetoOpcional(rascunho.erro),
    criadoEm: rascunho.criadoEm || agoraIso(),
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
  const config = normalizarConfig(clienteId, lerCliente(clienteId, "config", criarConfigPadrao(clienteId)));
  const meta = sanitizarConexaoMeta(getConexaoMetaSocial(clienteId));

  return {
    ...config,
    redes: {
      ...config.redes,
      facebook: {
        ...config.redes.facebook,
        conectado: meta.facebook.conectado,
        credenciaisConfiguradas: meta.token.presente,
        pageId: meta.facebook.pageId,
        pageName: meta.facebook.pageName
      },
      instagram: {
        ...config.redes.instagram,
        conectado: meta.instagram.conectado,
        credenciaisConfiguradas: meta.token.presente,
        instagramBusinessAccountId: meta.instagram.instagramBusinessAccountId,
        username: meta.instagram.username
      }
    },
    conexoes: {
      meta
    }
  };
}

function normalizarConfigAutomatico(clienteId = "admin", config = {}) {
  const padrao = criarConfigAutomaticoPadrao(clienteId);
  const janela = config.janelaFuncionamento && typeof config.janelaFuncionamento === "object"
    ? config.janelaFuncionamento
    : {};
  const gatilho = config.gatilho && typeof config.gatilho === "object" ? config.gatilho : {};
  const cta = config.cta && typeof config.cta === "object" ? config.cta : {};
  const destino = texto(cta.destino || padrao.cta.destino).toLowerCase();

  return {
    ...padrao,
    ...config,
    clienteId,
    ativo: config.ativo === true,
    templatePadraoId: texto(config.templatePadraoId || padrao.templatePadraoId),
    horarios: lista(config.horarios).map(item => hora(item)).filter(Boolean).slice(0, 24),
    quantidadeDiaria: inteiro(config.quantidadeDiaria, padrao.quantidadeDiaria, 1, 10),
    janelaFuncionamento: {
      inicio: hora(janela.inicio, padrao.janelaFuncionamento.inicio),
      fim: hora(janela.fim, padrao.janelaFuncionamento.fim)
    },
    intervaloMinimoMinutos: inteiro(config.intervaloMinimoMinutos, padrao.intervaloMinimoMinutos, 20, 1440),
    idadeMaximaHoras: inteiro(config.idadeMaximaHoras, padrao.idadeMaximaHoras, 1, 168),
    marketplacesPermitidos: lista(config.marketplacesPermitidos).map(texto).filter(Boolean),
    categoriasPermitidas: lista(config.categoriasPermitidas).map(texto).filter(Boolean),
    scoreMinimo: inteiro(config.scoreMinimo, padrao.scoreMinimo, 0, 100),
    exigirCupom: config.exigirCupom === true,
    permitirOfertaComum: config.permitirOfertaComum !== false,
    aprovacaoManual: config.aprovacaoManual === true,
    evitarProdutoRepetidoDias: inteiro(config.evitarProdutoRepetidoDias, padrao.evitarProdutoRepetidoDias, 0, 365),
    gatilho: {
      ativo: gatilho.ativo === true,
      palavra: texto(gatilho.palavra || padrao.gatilho.palavra).slice(0, 40),
      respostaPublica: texto(gatilho.respostaPublica).slice(0, 220)
    },
    cta: {
      destino: ["bio", "grupo", "whatsapp"].includes(destino) ? destino : "bio",
      linkGrupo: urlHttpsOpcional(cta.linkGrupo),
      whatsapp: texto(cta.whatsapp).slice(0, 120),
      linkBio: urlHttpsOpcional(cta.linkBio)
    },
    criadoEm: config.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
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

function listarRascunhosSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "rascunhos", [])).map((item, index) =>
    normalizarRascunho(clienteId, item, index)
  );
}

function getRascunhoSocial(clienteId = "admin", id = "") {
  const rascunhoId = texto(id);
  if (!rascunhoId) return null;
  return listarRascunhosSocial(clienteId).find(item => item.id === rascunhoId) || null;
}

function salvarRascunhoSocial(clienteId = "admin", dados = {}) {
  const atuais = listarRascunhosSocial(clienteId);
  const existente = texto(dados.id)
    ? atuais.find(item => item.id === texto(dados.id))
    : null;
  const novo = normalizarRascunho(clienteId, {
    ...(existente || {}),
    ...dados,
    status: dados.status || existente?.status || "rascunho",
    criadoEm: existente?.criadoEm || dados.criadoEm
  }, atuais.length);
  const rascunhos = [...atuais.filter(item => item.id !== novo.id), novo].slice(-500);

  escreverCliente(clienteId, "rascunhos", rascunhos);
  logSocial("[SOCIAL-RASCUNHO]", {
    clienteId,
    id: novo.id,
    origem: novo.origem,
    tipoPublicacao: novo.tipoPublicacao,
    status: novo.status
  });
  return novo;
}

function removerRascunhoSocial(clienteId = "admin", id = "") {
  const rascunhoId = texto(id);
  const atuais = listarRascunhosSocial(clienteId);
  const existente = atuais.find(item => item.id === rascunhoId) || null;
  if (!existente) return null;
  escreverCliente(clienteId, "rascunhos", atuais.filter(item => item.id !== rascunhoId));
  logSocial("[SOCIAL-RASCUNHO-EXCLUIDO]", { clienteId, id: rascunhoId });
  return existente;
}

function salvarAgendamentoSocial(clienteId = "admin", dados = {}) {
  const atuais = listarAgendamentosSocial(clienteId);
  const existente = texto(dados.id)
    ? atuais.find(item => item.id === texto(dados.id))
    : null;
  const novo = normalizarAgendamento(clienteId, {
    ...(existente || {}),
    ...dados,
    criadoEm: existente?.criadoEm || dados.criadoEm
  }, atuais.length);
  const semAtual = atuais.filter(item => item.id !== novo.id);
  const agendamentos = [...semAtual, novo];

  escreverCliente(clienteId, "agendamentos", agendamentos);
  logSocial("[SOCIAL-AGENDAMENTO]", { clienteId, id: novo.id, redes: novo.redes });
  return novo;
}

function getAgendamentoSocial(clienteId = "admin", id = "") {
  const agendamentoId = texto(id);
  if (!agendamentoId) return null;
  return listarAgendamentosSocial(clienteId).find(item => item.id === agendamentoId) || null;
}

function removerAgendamentoSocial(clienteId = "admin", id = "") {
  const agendamentoId = texto(id);
  const atuais = listarAgendamentosSocial(clienteId);
  const existente = atuais.find(item => item.id === agendamentoId) || null;
  if (!existente) return null;
  escreverCliente(clienteId, "agendamentos", atuais.filter(item => item.id !== agendamentoId));
  logSocial("[SOCIAL-AGENDAMENTO-EXCLUIDO]", { clienteId, id: agendamentoId });
  return existente;
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
  const limiteSeguro = Math.max(1, Math.min(50, Number(limite || 50) || 50));
  const clienteSeguro = texto(clienteId || "admin");
  const itens = lista(readClienteJson(clienteSeguro, "fila.json", []))
    .filter(item => !texto(item?.clienteId) || texto(item?.clienteId) === clienteSeguro);
  const vistas = new Set();
  const oportunidades = [];

  for (const item of itens) {
    const v2 = item.inteligenciaUniversalV2 || {};
    const titulo = texto(item.titulo || item.nome);
    const marketplace = texto(item.marketplace);
    const imagem = texto(item.imagem || item.image || item.thumbnail);
    const linkAfiliado = texto(item.linkAfiliado || item.linkFinal || item.link_afiliado);
    const linkOriginal = texto(item.linkOriginal || item.urlOriginal || item.url || item.link);
    const linkReferencia = linkAfiliado || linkOriginal;
    const precoAtual = numero(v2.valorEfetivo ?? item.valorEfetivo ?? item.precoAtual ?? item.preco);
    const precoOriginal = numero(item.precoOriginal ?? item.precoAntigo ?? item.precoDe);
    const score = numero(v2.score?.score ?? v2.score ?? item.score ?? item.radarScore);
    const prioridade = numero(v2.prioridade ?? item.prioridade ?? item.prioridadeEnvio ?? item.prioridadeFila);
    const cupom = texto(item.cupom || item.cupomCodigo || item.cupomInfo?.cupom);
    const expiraEm = texto(item.expiraEm || item.validadeCupom || item.cupomExpiraEm);
    const statusOperacional = texto(item.status).toLowerCase();
    const statusV2 = texto(v2.status).toLowerCase();
    const expirado =
      ["expirada", "expirado"].includes(statusOperacional) ||
      texto(item.statusDetalhe).toLowerCase().includes("expirado") ||
      (expiraEm && dataMs(expiraEm) > 0 && dataMs(expiraEm) < Date.now());
    const bloqueada =
      ["retida", "erro", "reprovada"].includes(statusOperacional) ||
      ["retida", "erro", "reprovada"].includes(statusV2);
    const aprovadoV2 =
      v2.ok === true ||
      ["aprovada", "aprovado"].includes(statusV2) ||
      item.ofertaUniversal === true ||
      texto(item.versaoOfertaUniversal).startsWith("v2");
    const ofertaId = idOfertaOficialSocial(item);
    const linkAfiliadoPresente = temLinkValido(linkAfiliado);

    if (!ofertaId || !titulo || !marketplace || !temImagemValida(imagem)) continue;
    if (precoAtual === null || precoAtual <= 0) continue;
    if (expirado) continue;
    if (bloqueada) continue;
    if (!aprovadoV2 && !(score !== null && score >= 60) && !cupom) continue;

    const chave =
      texto(item.produtoId || item.productId || item.sku) ||
      normalizarChave(linkOriginal) ||
      normalizarChave(linkReferencia) ||
      normalizarChave(ofertaId) ||
      `${normalizarChave(titulo)}|${normalizarChave(marketplace)}`;

    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);

    const criadoEm = texto(item.criadoEm || item.dataCriacao || item.createdAt || item.recebidoEm || item.atualizadoEm);
    const idBase = texto(item.id || item.ofertaId || item.produtoId || chave);
    const motivoIndisponivel = linkAfiliadoPresente ? "" : "sem_link_afiliado";

    oportunidades.push({
      id: `social_${normalizarChave(idBase).replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || criarId("oportunidade")}`,
      ofertaId,
      ofertaUniversalId: texto(item.ofertaUniversalId || item.id || item.ofertaId),
      titulo,
      imagem,
      marketplace,
      categoria: texto(v2.categoria || item.categoria),
      preco: precoAtual,
      precoAtual,
      precoOriginal,
      valorEfetivo: numero(v2.valorEfetivo ?? item.valorEfetivo),
      cupom,
      score,
      prioridade,
      origem: texto(item.origem || "fila"),
      linkAfiliadoPresente,
      publicavel: linkAfiliadoPresente,
      motivoIndisponivel,
      criadoEm,
      expiraEm,
      statusSocial: "nova",
      _ordenacao: {
        cupom: cupom ? 1 : 0,
        score: score ?? 0,
        prioridade: prioridade ?? 0,
        criadoEm: dataMs(criadoEm)
      }
    });
  }

  oportunidades.sort((a, b) =>
    b._ordenacao.cupom - a._ordenacao.cupom ||
    b._ordenacao.score - a._ordenacao.score ||
    b._ordenacao.prioridade - a._ordenacao.prioridade ||
    b._ordenacao.criadoEm - a._ordenacao.criadoEm
  );

  const resultado = oportunidades
    .slice(0, limiteSeguro)
    .map(({ _ordenacao, ...item }) => item);

  logSocial("[SOCIAL-OPORTUNIDADES-FONTE]", {
    clienteId,
    fonte: "fila_cliente",
    totalFonte: itens.length,
    elegiveis: oportunidades.length,
    retornadas: resultado.length
  });

  return resultado;
}

function getConfigAutomaticoSocial(clienteId = "admin") {
  return normalizarConfigAutomatico(
    clienteId,
    lerCliente(clienteId, "automatico", criarConfigAutomaticoPadrao(clienteId))
  );
}

function setConfigAutomaticoSocial(clienteId = "admin", dados = {}) {
  const atual = getConfigAutomaticoSocial(clienteId);
  const config = normalizarConfigAutomatico(clienteId, {
    ...atual,
    ...(dados && typeof dados === "object" ? dados : {})
  });
  escreverCliente(clienteId, "automatico", config);
  logSocial("[SOCIAL-AUTOMATICO-CONFIG]", {
    clienteId,
    ativo: config.ativo,
    quantidadeDiaria: config.quantidadeDiaria,
    scoreMinimo: config.scoreMinimo
  });
  return config;
}

function getConexaoMetaSocial(clienteId = "admin") {
  const padrao = criarMetaPadrao(clienteId);
  const dados = lerCliente(clienteId, "meta", padrao);
  const paginas = lista(dados.paginas).map(pagina => ({
    id: texto(pagina.id),
    name: texto(pagina.name),
    username: texto(pagina.username),
    accessToken: texto(pagina.accessToken),
    instagramBusinessAccountId: texto(pagina.instagramBusinessAccountId),
    instagramUsername: texto(pagina.instagramUsername),
    instagramName: texto(pagina.instagramName),
    conectado: pagina.conectado === true
  }));
  const paginaPrincipal = paginas.find(pagina => pagina.conectado) || paginas[0] || {};
  const instagramConectado = Boolean(paginaPrincipal.instagramBusinessAccountId);
  const token = dados.token && typeof dados.token === "object" ? dados.token : {};
  const accessToken = texto(dados.accessToken || token.accessToken);

  const conexao = {
    ...padrao,
    ...dados,
    clienteId,
    status: accessToken ? "conectado" : "desconectado",
    conectado: Boolean(accessToken),
    facebook: {
      ...padrao.facebook,
      ...(dados.facebook && typeof dados.facebook === "object" ? dados.facebook : {}),
      conectado: Boolean(paginaPrincipal.id),
      pageId: texto(dados.facebook?.pageId || paginaPrincipal.id),
      pageAccessToken: texto(dados.facebook?.pageAccessToken || paginaPrincipal.accessToken),
      pageName: texto(dados.facebook?.pageName || paginaPrincipal.name),
      pageUsername: texto(dados.facebook?.pageUsername || paginaPrincipal.username)
    },
    instagram: {
      ...padrao.instagram,
      ...(dados.instagram && typeof dados.instagram === "object" ? dados.instagram : {}),
      conectado: instagramConectado,
      instagramBusinessAccountId: texto(dados.instagram?.instagramBusinessAccountId || paginaPrincipal.instagramBusinessAccountId),
      username: texto(dados.instagram?.username || paginaPrincipal.instagramUsername),
      name: texto(dados.instagram?.name || paginaPrincipal.instagramName)
    },
    token: {
      ...padrao.token,
      ...token,
      accessToken
    },
    ativos: {
      ...padrao.ativos,
      ...(dados.ativos && typeof dados.ativos === "object" ? dados.ativos : {})
    },
    paginas,
    atualizadoEm: texto(dados.atualizadoEm || agoraIso())
  };

  logSocial("[SOCIAL-META-STORAGE-LER]", {
    clienteId,
    caminhoLogico: caminhoLogicoCliente(clienteId, "meta"),
    ...resumoMetaStorage(conexao)
  });

  return conexao;
}

function setConexaoMetaSocial(clienteId = "admin", dados = {}) {
  const atual = getConexaoMetaSocial(clienteId);
  const atualizado = {
    ...atual,
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    atualizadoEm: agoraIso()
  };

  const gravou = escreverCliente(clienteId, "meta", atualizado);
  logSocial("[SOCIAL-META-STORAGE-SALVAR]", {
    clienteId,
    caminhoLogico: caminhoLogicoCliente(clienteId, "meta"),
    gravou,
    ...resumoMetaStorage({
      ...atualizado,
      conectado: Boolean(atualizado.token?.accessToken || atualizado.accessToken)
    })
  });

  if (!gravou) {
    throw new Error("social_meta_storage_salvar_falhou");
  }

  logSocial("[SOCIAL-META-CONEXAO]", {
    clienteId,
    conectado: Boolean(atualizado.token?.accessToken || atualizado.accessToken),
    paginas: lista(atualizado.paginas).length
  });
  return getConexaoMetaSocial(clienteId);
}

function selecionarAtivoMetaSocial(clienteId = "admin", selecao = {}) {
  const atual = getConexaoMetaSocial(clienteId);
  const pageId = texto(selecao.pageId || selecao.paginaId || selecao.facebookPageId);
  const instagramId = texto(selecao.instagramBusinessAccountId || selecao.instagramId);

  if (!pageId) {
    throw new Error("social_meta_pageId_obrigatorio");
  }

  const paginas = lista(atual.paginas);
  const paginaSelecionada = paginas.find(pagina => texto(pagina.id) === pageId);

  if (!paginaSelecionada) {
    throw new Error("social_meta_pagina_nao_autorizada");
  }

  if (instagramId && texto(paginaSelecionada.instagramBusinessAccountId) !== instagramId) {
    throw new Error("social_meta_instagram_nao_autorizado");
  }

  const paginasAtualizadas = paginas.map(pagina => ({
    ...pagina,
    conectado: texto(pagina.id) === pageId
  }));
  const instagramSelecionado = instagramId || texto(paginaSelecionada.instagramBusinessAccountId);
  const atualizado = setConexaoMetaSocial(clienteId, {
    ...atual,
    facebook: {
      conectado: true,
      pageId: texto(paginaSelecionada.id),
      pageAccessToken: texto(paginaSelecionada.accessToken),
      pageName: texto(paginaSelecionada.name),
      pageUsername: texto(paginaSelecionada.username)
    },
    instagram: {
      conectado: Boolean(instagramSelecionado),
      instagramBusinessAccountId: instagramSelecionado,
      username: texto(paginaSelecionada.instagramUsername),
      name: texto(paginaSelecionada.instagramName)
    },
    paginas: paginasAtualizadas,
    ativos: {
      ...(atual.ativos || {}),
      status: "ativo_selecionado",
      atualizadoEm: agoraIso()
    }
  });

  logSocial("[SOCIAL-META-ATIVO-SELECIONADO]", {
    clienteId,
    pageId: texto(paginaSelecionada.id),
    instagramBusinessAccountId: instagramSelecionado,
    instagramConectado: Boolean(instagramSelecionado)
  });

  return atualizado;
}

function limparConexaoMetaSocial(clienteId = "admin") {
  const desconectado = criarMetaPadrao(clienteId);
  escreverCliente(clienteId, "meta", desconectado);
  logSocial("[SOCIAL-META-DESCONECTADO]", { clienteId });
  return sanitizarConexaoMeta(desconectado);
}

module.exports = {
  ARQUIVOS,
  REDES_SUPORTADAS,
  criarConfigPadrao,
  getConfigSocial,
  setConfigSocial,
  listarTemplatesSocial,
  salvarTemplateSocial,
  listarRascunhosSocial,
  getRascunhoSocial,
  salvarRascunhoSocial,
  removerRascunhoSocial,
  listarAgendamentosSocial,
  salvarAgendamentoSocial,
  getAgendamentoSocial,
  removerAgendamentoSocial,
  criarConfigAutomaticoPadrao,
  getConfigAutomaticoSocial,
  setConfigAutomaticoSocial,
  listarPublicacoesSocial,
  registrarPublicacaoSocial,
  listarOportunidadesSocial,
  criarMetaPadrao,
  getConexaoMetaSocial,
  setConexaoMetaSocial,
  selecionarAtivoMetaSocial,
  limparConexaoMetaSocial,
  sanitizarConexaoMeta,
  resumirOfertaUniversal,
  listClientes
};
