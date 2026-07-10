const {
  readClienteJson,
  writeClienteJson
} = require("../../utils/storage");
const { logSocial, logErroSocial } = require("./logs");

const ARQUIVOS = {
  config: "social-config.json",
  meta: "social-meta.json",
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
  const limiteSeguro = Math.max(1, Math.min(50, Number(limite || 50) || 50));
  const itens = lista(readClienteJson(clienteId, "fila.json", []))
    .filter(item => texto(item?.clienteId || "admin") === texto(clienteId || "admin"));
  const vistas = new Set();
  const oportunidades = [];

  for (const item of itens) {
    const v2 = item.inteligenciaUniversalV2 || {};
    const titulo = texto(item.titulo || item.nome);
    const marketplace = texto(item.marketplace);
    const imagem = texto(item.imagem || item.image || item.thumbnail);
    const linkAfiliado = texto(item.linkAfiliado || item.linkFinal || item.link);
    const linkOriginal = texto(item.linkOriginal || item.urlOriginal || item.url || item.link);
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

    if (!titulo || !marketplace || !temImagemValida(imagem) || !temLinkValido(linkAfiliado)) continue;
    if (precoAtual === null || precoAtual <= 0) continue;
    if (expirado) continue;
    if (bloqueada) continue;
    if (!aprovadoV2 && !(score !== null && score >= 60) && !cupom) continue;

    const chave =
      texto(item.produtoId || item.productId || item.sku) ||
      normalizarChave(linkOriginal) ||
      normalizarChave(linkAfiliado) ||
      `${normalizarChave(titulo)}|${normalizarChave(marketplace)}`;

    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);

    const criadoEm = texto(item.criadoEm || item.dataCriacao || item.createdAt || item.recebidoEm || item.atualizadoEm);
    const idBase = texto(item.id || item.ofertaId || item.produtoId || chave);

    oportunidades.push({
      id: `social_${normalizarChave(idBase).replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || criarId("oportunidade")}`,
      ofertaUniversalId: texto(item.ofertaUniversalId || item.id || item.ofertaId),
      titulo,
      imagem,
      marketplace,
      categoria: texto(v2.categoria || item.categoria),
      precoAtual,
      precoOriginal,
      valorEfetivo: numero(v2.valorEfetivo ?? item.valorEfetivo),
      cupom,
      score,
      prioridade,
      origem: texto(item.origem || "fila"),
      linkAfiliadoPresente: true,
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
  listarAgendamentosSocial,
  salvarAgendamentoSocial,
  listarPublicacoesSocial,
  registrarPublicacaoSocial,
  listarOportunidadesSocial,
  criarMetaPadrao,
  getConexaoMetaSocial,
  setConexaoMetaSocial,
  selecionarAtivoMetaSocial,
  limparConexaoMetaSocial,
  sanitizarConexaoMeta,
  resumirOfertaUniversal
};
