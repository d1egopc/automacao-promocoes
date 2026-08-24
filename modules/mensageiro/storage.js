const fs = require("fs");
const path = require("path");
const {
  getClienteJsonPath,
  readClienteJson,
  writeClienteJson,
  readGlobalJson,
  writeGlobalJson
} = require("../../utils/storage");

const DATA_DIR = process.env.DATA_DIR || "/data";
const MENSAGEIRO_FILE = path.join(DATA_DIR, "mensageiro.json");
const HISTORICO_ATENDIMENTO_MAX = 200;
const TIPOS_RESPOSTA_ATENDIMENTO = new Set(["texto", "imagemUrl", "videoUrl", "arquivoUrl", "link"]);
const ESCOPOS_ATENDIMENTO = new Set(["privado", "grupo", "ambos"]);
const MODOS_GATILHO_ATENDIMENTO = new Set(["todas", "qualquer"]);
const DESTINOS_MENSAGEM_GRUPO = new Set(["privado", "grupo"]);
const MODOS_MENSAGEM_GRUPO = new Set(["texto", "imagem", "imagem_texto"]);
const CORRESPONDENCIAS_COMANDO = new Set(["exato", "inicia"]);
const TIPOS_RESPOSTA_COMANDO = new Set(["texto", "imagem", "imagem_texto"]);
const TIPOS_PROGRAMACAO = new Set(["horario", "intervalo"]);
const TIPOS_CONTEUDO_PROGRAMACAO = new Set(["texto", "imagem", "imagem_texto"]);
const TIPOS_REGRA_GERENTE = new Set([
  "palavras_proibidas",
  "palavroes",
  "links_externos",
  "convite_whatsapp",
  "divulgacao",
  "flood",
  "repeticao",
  "excesso_mensagens",
  "midia_bloqueada"
]);
const ACOES_REGRA_GERENTE = new Set([
  "apagar",
  "apagar_avisar",
  "remover_imediato",
  "avisos_depois_remover"
]);
const TIPOS_MIDIA_GERENTE = new Set(["imagem", "video", "audio", "documento", "sticker"]);
const MAX_PERFIS_MENSAGEIRO = Number(process.env.MAX_PERFIS_MENSAGEIRO || 4) || 4;
const PERFIL_LEGADO_ID = "__legado__";
const INFRACOES_GERENTE_FILE = "mensageiro-gerente-infracoes.json";
const MODULOS_PERFIL_MENSAGEIRO = new Set([
  "boasVindas",
  "despedida",
  "comandos",
  "programacoes",
  "gerente"
]);

let mensageiroPorCliente = {};

function garantirDiretorio(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function clienteIdSeguro(clienteId) {
  return String(clienteId || "admin").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getDiretorioCliente(clienteId) {
  return path.join(DATA_DIR, "clientes", clienteIdSeguro(clienteId));
}

function getMensageiroConfigFile(clienteId) {
  return getClienteJsonPath(clienteId, "mensageiro-config.json");
}

function criarAtendimentoPadraoMensageiro() {
  return {
    ativo: false,
    delaySegundos: 2,
    escopo: "privado",
    respostasRapidas: []
  };
}

function criarEnvioPadraoMensageiro() {
  return {
    destino: "privado",
    modoGrupo: "imagem_texto",
    mensagemTemporaria: false,
    apagarAposSegundos: 20
  };
}

function normalizarEnvioMensageiro(envio = {}) {
  const atual = envio && typeof envio === "object" ? envio : {};
  const apagarAposSegundos = Math.max(
    1,
    Math.min(3600, Number(atual.apagarAposSegundos || 20) || 20)
  );

  return {
    ...criarEnvioPadraoMensageiro(),
    destino: DESTINOS_MENSAGEM_GRUPO.has(atual.destino)
      ? atual.destino
      : "privado",
    modoGrupo: MODOS_MENSAGEM_GRUPO.has(atual.modoGrupo)
      ? atual.modoGrupo
      : "imagem_texto",
    mensagemTemporaria: atual.mensagemTemporaria === true,
    apagarAposSegundos
  };
}

function normalizarConfigMensageiro(clienteId, config = {}) {
  const padrao = criarConfigPadraoMensageiro(clienteId);
  const atendimentoAtual =
    config.atendimento && typeof config.atendimento === "object"
      ? config.atendimento
      : {};
  const sessaoGruposId = String(
    config.sessaoGruposId ||
    config.sessaoWhatsappId ||
    config.sessaoId ||
    ""
  );

  return {
    ...padrao,
    ...config,
    clienteId,
    sessaoId: sessaoGruposId,
    sessaoWhatsappId: sessaoGruposId,
    sessaoGruposId,
    atendimento: {
      ...criarAtendimentoPadraoMensageiro(),
      ...atendimentoAtual,
      escopo: "privado",
      respostasRapidas: Array.isArray(atendimentoAtual.respostasRapidas)
        ? atendimentoAtual.respostasRapidas
        : []
    },
    boasVindasEnvio: normalizarEnvioMensageiro(config.boasVindasEnvio),
    despedidaEnvio: normalizarEnvioMensageiro(config.despedidaEnvio),
    perfis: normalizarPerfisMensageiro(config.perfis),
    comandos: normalizarComandosMensageiro(config.comandos),
    programacoes: normalizarProgramacoesMensageiro(config.programacoes)
  };
}

function carregarMensageiro() {
  try {
    mensageiroPorCliente = readGlobalJson("mensageiro.json", {});

    console.log(
      "✅ Mensageiro carregado:",
      Object.keys(mensageiroPorCliente).length
    );
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao carregar mensageiro:", e.message);
    mensageiroPorCliente = {};
  }
}

function salvarMensageiro() {
  try {
    writeGlobalJson("mensageiro.json", mensageiroPorCliente);
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao salvar mensageiro:", e.message);
  }
}

function criarConfigPadraoMensageiro(clienteId) {
  return {
    clienteId,
    ativo: false,

    sessaoId: "",
    sessaoWhatsappId: "",
    sessaoGruposId: "",

    boasVindasAtivo: false,
    despedidaAtivo: false,

    mensagemBoasVindas:
      "👋 Seja bem-vindo ao grupo!\n\nAproveite as ofertas e promoções.",
    mensagemDespedida:
      "😢 Obrigado por ter participado do grupo.\n\nVolte quando quiser!",

    imagemBoasVindas: "",
    imagemDespedida: "",

    grupos: [],

    boasVindasEnvio: criarEnvioPadraoMensageiro(),
    despedidaEnvio: criarEnvioPadraoMensageiro(),

    perfis: [],
    comandos: [],
    programacoes: [],

    atendimento: criarAtendimentoPadraoMensageiro(),

    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function erroContratoMensageiro(code, message, extra = {}) {
  const erro = new Error(message || code);
  erro.code = code;
  erro.statusCode = 400;
  Object.assign(erro, extra);
  return erro;
}

function criarConfigAtendimentoPadrao(clienteId) {
  return {
    clienteId,
    atendimentoAtivo: false,
    sessaoId: "",
    sessaoAtendimentoId: "",
    escopo: "privado",
    cooldownMinutos: 10,
    gatilhos: [],
    historico: [],
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function normalizarListaPalavras(lista = []) {
  const itens = Array.isArray(lista) ? lista : [lista];

  const vistas = new Set();
  return itens
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .filter(item => {
      const chave = item.toLowerCase();
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });
}

function normalizarRespostaComando(resposta = {}) {
  const raw = resposta && typeof resposta === "object" ? resposta : {};
  const tipo = TIPOS_RESPOSTA_COMANDO.has(raw.tipo)
    ? raw.tipo
    : "texto";

  return {
    tipo,
    texto: String(raw.texto || raw.mensagem || raw.conteudo || "").slice(0, 4000),
    imagem: String(raw.imagem || raw.imagemUrl || raw.url || "")
  };
}

function normalizarComandoMensageiro(comando = {}, index = 0) {
  const raw = comando && typeof comando === "object" ? comando : {};
  const gatilhos = normalizarListaPalavras(raw.gatilhos || raw.gatilho || raw.palavras);
  const correspondencia = CORRESPONDENCIAS_COMANDO.has(raw.correspondencia)
    ? raw.correspondencia
    : "exato";

  return {
    id: String(raw.id || `cmd_${Date.now()}_${index}`),
    ativo: raw.ativo !== false,
    nome: String(raw.nome || `Comando ${index + 1}`).trim(),
    perfilId: raw.perfilId ? String(raw.perfilId).trim() : "",
    gatilhos,
    correspondencia,
    grupos: normalizarListaPalavras(raw.grupos),
    mencionarAutor: raw.mencionarAutor === true,
    resposta: normalizarRespostaComando(raw.resposta || {}),
    cooldownSegundos: Math.max(5, Math.min(3600, Number(raw.cooldownSegundos || 30) || 30)),
    cooldownParticipanteSegundos: Math.max(
      5,
      Math.min(3600, Number(raw.cooldownParticipanteSegundos || 60) || 60)
    )
  };
}

function normalizarComandosMensageiro(comandos = []) {
  if (!Array.isArray(comandos)) return [];

  return comandos
    .map(normalizarComandoMensageiro)
    .filter(comando => comando.nome && comando.gatilhos.length)
    .filter(comando => {
      const { tipo, texto, imagem } = comando.resposta || {};
      if (tipo === "texto") return Boolean(texto);
      if (tipo === "imagem") return Boolean(imagem);
      return Boolean(texto || imagem);
    });
}

function normalizarHorarioMensageiro(valor = "") {
  const texto = String(valor || "").trim();
  const match = texto.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";

  const horas = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutos = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function normalizarDataMensageiro(valor = "") {
  const texto = String(valor || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : "";
}

function normalizarConteudoProgramacao(conteudo = {}, index = 0) {
  const raw = conteudo && typeof conteudo === "object" ? conteudo : {};
  const tipo = TIPOS_CONTEUDO_PROGRAMACAO.has(raw.tipo)
    ? raw.tipo
    : "texto";

  return {
    id: String(raw.id || `conteudo_${Date.now()}_${index}`),
    tipo,
    texto: String(raw.texto || raw.mensagem || raw.conteudo || "").slice(0, 4000),
    imagem: String(raw.imagem || raw.imagemUrl || raw.url || "")
  };
}

function conteudoProgramacaoValido(conteudo = {}) {
  if (conteudo.tipo === "texto") return Boolean(conteudo.texto);
  if (conteudo.tipo === "imagem") return Boolean(conteudo.imagem);
  return Boolean(conteudo.texto || conteudo.imagem);
}

function normalizarProgramacaoMensageiro(programacao = {}, index = 0) {
  const raw = programacao && typeof programacao === "object" ? programacao : {};
  const tipo = TIPOS_PROGRAMACAO.has(raw.tipo) ? raw.tipo : "horario";
  const conteudosRaw = Array.isArray(raw.conteudos)
    ? raw.conteudos
    : raw.conteudo
      ? [raw.conteudo]
      : raw.resposta
        ? [raw.resposta]
        : [];
  const conteudos = conteudosRaw
    .map(normalizarConteudoProgramacao)
    .filter(conteudoProgramacaoValido);
  const intervaloMinutos = Math.max(10, Math.min(1440, Number(raw.intervaloMinutos || 30) || 30));
  const indiceAtual = Math.max(0, Number(raw.indiceAtual || 0) || 0);

  return {
    id: String(raw.id || `prog_${Date.now()}_${index}`),
    ativo: raw.ativo !== false,
    nome: String(raw.nome || `Programacao ${index + 1}`).trim(),
    perfilId: raw.perfilId ? String(raw.perfilId).trim() : "",
    tipo,
    grupos: normalizarListaPalavras(raw.grupos),
    horario: normalizarHorarioMensageiro(raw.horario),
    data: normalizarDataMensageiro(raw.data),
    intervaloMinutos,
    janelaInicio: normalizarHorarioMensageiro(raw.janelaInicio),
    janelaFim: normalizarHorarioMensageiro(raw.janelaFim),
    timezone: String(raw.timezone || "America/Sao_Paulo"),
    conteudos,
    indiceAtual: conteudos.length ? indiceAtual % conteudos.length : 0,
    nextRunAt: raw.nextRunAt ? String(raw.nextRunAt) : "",
    ultimoEnvioEm: raw.ultimoEnvioEm ? String(raw.ultimoEnvioEm) : "",
    processandoEm: raw.processandoEm ? String(raw.processandoEm) : "",
    lockAte: raw.lockAte ? String(raw.lockAte) : "",
    status: String(raw.status || "pendente"),
    ultimoRunId: raw.ultimoRunId ? String(raw.ultimoRunId) : ""
  };
}

function normalizarConfigMensagemPerfil(raw = {}, fallback = {}) {
  const fonte = raw && typeof raw === "object" ? raw : {};
  return {
    mensagem: String(fonte.mensagem || fonte.texto || fallback.mensagem || "").slice(0, 4000),
    imagem: String(fonte.imagem || fallback.imagem || ""),
    envio: normalizarEnvioMensageiro(fonte.envio || fallback.envio)
  };
}

function normalizarModuloMensagemPerfil(raw = {}, fallback = {}) {
  const fonte = raw && typeof raw === "object" ? raw : {};
  return {
    ativo: fonte.ativo === undefined ? fallback.ativo === true : fonte.ativo === true,
    configuracao: normalizarConfigMensagemPerfil(fonte.configuracao || fonte, fallback.configuracao || {})
  };
}

function normalizarModuloSimplesPerfil(raw = {}, ativoPadrao = false) {
  const fonte = raw && typeof raw === "object" ? raw : {};
  return {
    ativo: fonte.ativo === undefined ? ativoPadrao === true : fonte.ativo === true
  };
}

function criarConfiguracaoGerentePadrao() {
  return {
    regras: [],
    isentarAdmins: true,
    isentarDono: true,
    autorizados: [],
    moderadores: [],
    resetInfracoesDias: 30,
    avisoTemporario: true,
    apagarAvisoAposSegundos: 20
  };
}

function normalizarTipoRegraGerente(tipo = "") {
  const valor = String(tipo || "").trim().toLowerCase();
  const mapa = {
    palavras: "palavras_proibidas",
    palavra: "palavras_proibidas",
    palavra_proibida: "palavras_proibidas",
    palavras_proibida: "palavras_proibidas",
    palavras_proibidas: "palavras_proibidas",
    palavroes: "palavroes",
    palavrões: "palavroes",
    palavrao: "palavroes",
    palavrão: "palavroes",
    links: "links_externos",
    link_externo: "links_externos",
    links_externos: "links_externos",
    convite: "convite_whatsapp",
    convite_whatsapp: "convite_whatsapp",
    links_whatsapp: "convite_whatsapp",
    link_grupo_whatsapp: "convite_whatsapp",
    divulgacao: "divulgacao",
    divulgação: "divulgacao",
    flood: "flood",
    repeticao: "repeticao",
    repetição: "repeticao",
    excesso: "excesso_mensagens",
    excesso_mensagens: "excesso_mensagens",
    midia: "midia_bloqueada",
    mídia: "midia_bloqueada",
    midia_bloqueada: "midia_bloqueada",
    mídia_bloqueada: "midia_bloqueada"
  };
  return TIPOS_REGRA_GERENTE.has(mapa[valor] || valor) ? (mapa[valor] || valor) : "";
}

function normalizarListaMidiasGerente(lista = []) {
  return normalizarListaPalavras(lista)
    .map(item => {
      const valor = String(item || "").toLowerCase();
      if (valor === "vídeo") return "video";
      if (valor === "áudio") return "audio";
      if (valor === "imagem") return "imagem";
      if (valor === "document") return "documento";
      return valor;
    })
    .filter(item => TIPOS_MIDIA_GERENTE.has(item));
}

function normalizarParametrosRegraGerente(parametros = {}) {
  const raw = parametros && typeof parametros === "object" ? parametros : {};
  return {
    ...raw,
    palavras: normalizarListaPalavras(raw.palavras || raw.termos || raw.lista || raw.palavroes),
    dominiosPermitidos: normalizarListaPalavras(raw.dominiosPermitidos || raw.whitelist || raw.dominiosAutorizados)
      .map(item => item.toLowerCase()),
    maxMensagens: Math.max(2, Math.min(50, Number(raw.maxMensagens || raw.limite || 5) || 5)),
    janelaSegundos: Math.max(3, Math.min(3600, Number(raw.janelaSegundos || raw.janela || 10) || 10)),
    repeticoes: Math.max(2, Math.min(20, Number(raw.repeticoes || raw.limiteRepeticoes || 3) || 3)),
    minCaracteres: Math.max(1, Math.min(200, Number(raw.minCaracteres || 8) || 8)),
    tiposMidia: normalizarListaMidiasGerente(raw.tiposMidia || raw.midias || raw.tipos)
  };
}

function normalizarRegraGerente(regra = {}, index = 0) {
  const raw = regra && typeof regra === "object" ? regra : {};
  const tipo = normalizarTipoRegraGerente(raw.tipo);
  const acao = ACOES_REGRA_GERENTE.has(raw.acao) ? raw.acao : "apagar_avisar";
  const parametros = normalizarParametrosRegraGerente(raw.parametros || {});

  return {
    id: String(raw.id || `gerente_regra_${Date.now()}_${index}`).trim(),
    ativo: raw.ativo === true,
    nome: String(raw.nome || raw.titulo || tipo || `Regra ${index + 1}`).trim().slice(0, 100),
    tipo,
    parametros,
    acao,
    limiteInfracoes: Math.max(1, Math.min(4, Number(raw.limiteInfracoes || 3) || 3)),
    avisoTexto: String(raw.avisoTexto || "").slice(0, 1000),
    temporizarAviso: raw.temporizarAviso === undefined ? undefined : raw.temporizarAviso === true,
    apagarAvisoAposSegundos: Math.max(
      1,
      Math.min(3600, Number(raw.apagarAvisoAposSegundos || 20) || 20)
    )
  };
}

function normalizarConfiguracaoGerente(raw = {}) {
  const fonte = raw && typeof raw === "object" ? raw : {};
  const padrao = criarConfiguracaoGerentePadrao();

  return {
    ...padrao,
    regras: Array.isArray(fonte.regras)
      ? fonte.regras
        .map(normalizarRegraGerente)
        .filter(regra => regra.id && regra.tipo)
      : [],
    isentarAdmins: fonte.isentarAdmins === undefined ? true : fonte.isentarAdmins === true,
    isentarDono: fonte.isentarDono === undefined ? true : fonte.isentarDono === true,
    autorizados: normalizarListaPalavras(fonte.autorizados),
    moderadores: normalizarListaPalavras(fonte.moderadores),
    resetInfracoesDias: Math.max(1, Math.min(3650, Number(fonte.resetInfracoesDias || 30) || 30)),
    avisoTemporario: fonte.avisoTemporario === undefined ? true : fonte.avisoTemporario === true,
    apagarAvisoAposSegundos: Math.max(
      1,
      Math.min(3600, Number(fonte.apagarAvisoAposSegundos || 20) || 20)
    )
  };
}

function normalizarModulosPerfilMensageiro(modulos = {}, fallback = {}) {
  const raw = modulos && typeof modulos === "object" ? modulos : {};
  return {
    boasVindas: normalizarModuloMensagemPerfil(raw.boasVindas, fallback.boasVindas),
    despedida: normalizarModuloMensagemPerfil(raw.despedida, fallback.despedida),
    comandos: normalizarModuloSimplesPerfil(raw.comandos, fallback.comandos?.ativo === true),
    programacoes: normalizarModuloSimplesPerfil(raw.programacoes, fallback.programacoes?.ativo === true),
    gerente: {
      ...normalizarModuloSimplesPerfil(raw.gerente, fallback.gerente?.ativo === true),
      configuracao: normalizarConfiguracaoGerente(raw.gerente?.configuracao || fallback.gerente?.configuracao || {})
    }
  };
}

function normalizarPerfilMensageiro(perfil = {}, index = 0) {
  const raw = perfil && typeof perfil === "object" ? perfil : {};
  const agora = new Date().toISOString();
  const id = String(raw.id || `perfil_${Date.now()}_${index}`).trim();
  const nome = String(raw.nome || `Perfil ${index + 1}`).trim().slice(0, 80);

  return {
    id,
    nome,
    ativo: raw.ativo !== false,
    sessaoId: String(raw.sessaoId || raw.sessaoWhatsappId || raw.sessaoGruposId || "").trim(),
    grupos: normalizarListaPalavras(raw.grupos || raw.gruposIds),
    modulos: normalizarModulosPerfilMensageiro(raw.modulos || {}),
    criadoEm: raw.criadoEm ? String(raw.criadoEm) : agora,
    atualizadoEm: raw.atualizadoEm ? String(raw.atualizadoEm) : agora,
    removidoEm: raw.removidoEm ? String(raw.removidoEm) : ""
  };
}

function normalizarPerfisMensageiro(perfis = []) {
  if (!Array.isArray(perfis)) return [];

  return perfis
    .map(normalizarPerfilMensageiro)
    .filter(perfil => perfil.id && perfil.nome);
}

function criarPerfilLegadoVirtual(config = {}) {
  return {
    id: PERFIL_LEGADO_ID,
    nome: "Legado",
    legado: true,
    ativo: true,
    sessaoId: String(config.sessaoGruposId || config.sessaoWhatsappId || config.sessaoId || ""),
    grupos: normalizarListaPalavras(config.grupos),
    modulos: {
      boasVindas: {
        ativo: config.boasVindasAtivo === true,
        configuracao: {
          mensagem: String(config.mensagemBoasVindas || ""),
          imagem: String(config.imagemBoasVindas || ""),
          envio: normalizarEnvioMensageiro(config.boasVindasEnvio)
        }
      },
      despedida: {
        ativo: config.despedidaAtivo === true,
        configuracao: {
          mensagem: String(config.mensagemDespedida || ""),
          imagem: String(config.imagemDespedida || ""),
          envio: normalizarEnvioMensageiro(config.despedidaEnvio)
        }
      },
      comandos: { ativo: true },
      programacoes: { ativo: true },
      gerente: { ativo: false, configuracao: {} }
    }
  };
}

function normalizarSet(valores = []) {
  if (valores instanceof Set) return valores;
  if (!Array.isArray(valores)) return new Set();
  return new Set(valores.map(item => String(item?.id || item || "").trim()).filter(Boolean));
}

function validarPerfisMensageiro(perfis = [], opcoes = {}) {
  const lista = normalizarPerfisMensageiro(perfis);
  const ativos = lista.filter(perfil => perfil.ativo && !perfil.removidoEm);
  const sessoesValidas = normalizarSet(opcoes.sessoesValidas);
  const gruposPorSessao = opcoes.gruposPorSessao && typeof opcoes.gruposPorSessao === "object"
    ? opcoes.gruposPorSessao
    : {};

  if (lista.length > MAX_PERFIS_MENSAGEIRO) {
    throw erroContratoMensageiro(
      "limite_perfis_mensageiro",
      `Limite de ${MAX_PERFIS_MENSAGEIRO} perfis do Mensageiro atingido.`,
      { max: MAX_PERFIS_MENSAGEIRO }
    );
  }

  const gruposAtivos = new Map();
  for (const perfil of ativos) {
    if (!perfil.sessaoId) {
      throw erroContratoMensageiro("sessao_invalida", "Perfil do Mensageiro precisa de uma sessao valida.", { perfilId: perfil.id });
    }
    if (sessoesValidas.size && !sessoesValidas.has(perfil.sessaoId)) {
      throw erroContratoMensageiro("sessao_invalida", "Sessao do perfil nao pertence ao workspace.", { perfilId: perfil.id });
    }

    const gruposValidosSessao = normalizarSet(gruposPorSessao[perfil.sessaoId]);
    for (const grupoId of perfil.grupos) {
      if (gruposValidosSessao.size && !gruposValidosSessao.has(grupoId)) {
        throw erroContratoMensageiro("grupo_fora_da_sessao", "Grupo do perfil nao pertence a sessao informada.", {
          perfilId: perfil.id,
          grupoId
        });
      }
      const dono = gruposAtivos.get(grupoId);
      if (dono && dono.perfilId !== perfil.id) {
        throw erroContratoMensageiro("grupo_duplicado_em_perfis", "Grupo duplicado em perfis ativos do Mensageiro.", {
          grupoId,
          perfilId: perfil.id,
          conflitoPerfilId: dono.perfilId
        });
      }
      gruposAtivos.set(grupoId, { perfilId: perfil.id, sessaoId: perfil.sessaoId });
    }
  }

  return lista;
}

function resolverPerfilMensageiro({ clienteId, sessaoId = "", grupoId = "", modulo = "", config } = {}) {
  const base = config || getMensageiroCliente(clienteId);
  const perfisAtivos = normalizarPerfisMensageiro(base.perfis)
    .filter(perfil => perfil.ativo && !perfil.removidoEm);
  const moduloSolicitado = String(modulo || "").trim();

  if (!perfisAtivos.length) {
    const legado = criarPerfilLegadoVirtual(base);
    return {
      ok: true,
      legado: true,
      perfil: legado,
      perfilId: legado.id,
      perfilNome: legado.nome,
      codigo: "perfil_legado"
    };
  }

  const candidatos = perfisAtivos.filter(perfil => {
    if (sessaoId && perfil.sessaoId !== sessaoId) return false;
    if (grupoId && !perfil.grupos.includes(grupoId)) return false;
    if (moduloSolicitado && MODULOS_PERFIL_MENSAGEIRO.has(moduloSolicitado)) {
      const moduloConfig = perfil.modulos?.[moduloSolicitado];
      if (!moduloConfig || moduloConfig.ativo !== true) return false;
    }
    return true;
  });

  if (candidatos.length === 1) {
    return {
      ok: true,
      legado: false,
      perfil: candidatos[0],
      perfilId: candidatos[0].id,
      perfilNome: candidatos[0].nome,
      codigo: "perfil_resolvido"
    };
  }

  if (candidatos.length > 1) {
    console.log("[MENSAGEIRO][PERFIS] conflito sanitizado", {
      clienteId,
      sessaoId,
      grupoId,
      modulo: moduloSolicitado,
      perfis: candidatos.map(perfil => perfil.id)
    });
    return {
      ok: false,
      codigo: "grupo_duplicado_em_perfis",
      erro: "Mais de um perfil ativo corresponde a este grupo.",
      perfis: candidatos.map(perfil => ({ id: perfil.id, nome: perfil.nome }))
    };
  }

  return {
    ok: false,
    codigo: "perfil_nao_encontrado",
    erro: "Nenhum perfil ativo corresponde a este grupo."
  };
}

function normalizarProgramacoesMensageiro(programacoes = []) {
  if (!Array.isArray(programacoes)) return [];

  return programacoes
    .map(normalizarProgramacaoMensageiro)
    .filter(programacao => programacao.nome && programacao.conteudos.length);
}

function normalizarRespostaAtendimento(resposta = {}, index = 0) {
  const tipo = TIPOS_RESPOSTA_ATENDIMENTO.has(resposta?.tipo)
    ? resposta.tipo
    : "texto";

  return {
    id: String(resposta?.id || `resposta_${Date.now()}_${index}`),
    tipo,
    conteudo: String(resposta?.conteudo || "").trim(),
    delaySegundos: Math.max(0, Math.min(60, Number(resposta?.delaySegundos || 0) || 0))
  };
}

function normalizarGatilhoAtendimento(gatilho = {}, index = 0) {
  const respostas = Array.isArray(gatilho?.respostas)
    ? gatilho.respostas
    : gatilho?.resposta
      ? [gatilho.resposta]
      : [];

  return {
    id: String(gatilho?.id || `gatilho_${Date.now()}_${index}`),
    ativo: gatilho?.ativo !== false,
    nome: String(gatilho?.nome || `Gatilho ${index + 1}`).trim(),
    modo: MODOS_GATILHO_ATENDIMENTO.has(gatilho?.modo) ? gatilho.modo : "todas",
    tipoCorrespondencia: String(
      gatilho?.tipoCorrespondencia ||
      gatilho?.correspondencia ||
      gatilho?.match ||
      "exato"
    ).toLowerCase(),
    palavrasObrigatorias: normalizarListaPalavras(gatilho?.palavrasObrigatorias),
    palavrasOpcionais: normalizarListaPalavras(gatilho?.palavrasOpcionais),
    respostas: respostas
      .map(normalizarRespostaAtendimento)
      .filter(resposta => resposta.conteudo)
  };
}

function normalizarHistoricoAtendimento(historico = []) {
  if (!Array.isArray(historico)) return [];

  return historico
    .slice(-HISTORICO_ATENDIMENTO_MAX)
    .map((evento, index) => {
      const respostaEnviada = Array.isArray(evento?.respostaEnviada)
        ? evento.respostaEnviada.map(item => String(item || "")).filter(Boolean)
        : String(evento?.respostaEnviada || "").trim()
          ? [String(evento.respostaEnviada)]
          : [];

      return {
        id: String(evento?.id || `hist_${Date.now()}_${index}`),
        data: evento?.data || new Date().toISOString(),
        tipo: String(evento?.tipo || "atendimento"),
        origem: String(evento?.origem || ""),
        contato: String(evento?.contato || evento?.jid || ""),
        contatoNome: String(evento?.contatoNome || evento?.nomeContato || ""),
        grupo: String(evento?.grupo || ""),
        grupoNome: String(evento?.grupoNome || evento?.nomeGrupo || ""),
        perfilId: String(evento?.perfilId || ""),
        perfilNome: String(evento?.perfilNome || ""),
        mensagemRecebida: String(evento?.mensagemRecebida || evento?.mensagem || "").slice(0, 500),
        gatilhoId: String(evento?.gatilhoId || evento?.comandoId || ""),
        gatilhoNome: String(evento?.gatilhoNome || evento?.comandoNome || evento?.gatilhoAcionado || ""),
        respostaEnviada,
        status: String(evento?.status || evento?.resultado || "registrado"),
        resultado: String(evento?.resultado || evento?.status || "registrado"),
        resumo: String(evento?.resumo || ""),
        detalhe: String(evento?.detalhe || ""),
        erro: String(evento?.erro || "")
      };
    });
}

function normalizarConfigAtendimentoCliente(clienteId, config = {}) {
  const padrao = criarConfigAtendimentoPadrao(clienteId);
  const raw = config && typeof config === "object" ? config : {};
  const nested = raw.atendimento && typeof raw.atendimento === "object" ? raw.atendimento : {};
  const fonte = Object.keys(nested).length ? nested : raw;
  const escopo = ESCOPOS_ATENDIMENTO.has(fonte.escopo) ? fonte.escopo : "privado";
  const podeUsarSessaoIdLegado = !raw.sessaoWhatsappId && !raw.sessaoGruposId && !raw.grupos && !raw.gruposIds;
  const sessaoId = String(
    fonte.sessaoAtendimentoId ||
    raw.sessaoAtendimentoId ||
    fonte.atendimentoSessaoId ||
    raw.atendimentoSessaoId ||
    fonte.sessionId ||
    fonte.whatsappSessionId ||
    (podeUsarSessaoIdLegado ? (fonte.sessaoId || raw.sessaoId || "") : "")
  );

  return {
    ...padrao,
    ...fonte,
    clienteId,
    atendimentoAtivo: fonte.atendimentoAtivo === true || fonte.ativo === true || raw.atendimentoAtivo === true,
    sessaoId,
    sessaoAtendimentoId: sessaoId,
    escopo,
    cooldownMinutos: Math.max(1, Math.min(120, Number(fonte.cooldownMinutos || raw.cooldownMinutos || 10) || 10)),
    gatilhos: Array.isArray(fonte.gatilhos)
      ? fonte.gatilhos
        .map(normalizarGatilhoAtendimento)
        .filter(gatilho => gatilho.palavrasObrigatorias.length && gatilho.respostas.length)
      : [],
    historico: normalizarHistoricoAtendimento(fonte.historico || raw.historico),
    atualizadoEm: fonte.atualizadoEm || raw.atualizadoEm || new Date().toISOString()
  };
}

function getAtendimentoConfigCliente(clienteId) {
  let config = criarConfigAtendimentoPadrao(clienteId);

  try {
    config = readClienteJson(clienteId, "mensageiro-config.json", config);
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao ler atendimento:", e.message);
  }

  return normalizarConfigAtendimentoCliente(clienteId, config);
}

function setAtendimentoConfigCliente(clienteId, dados = {}) {
  const arquivoAtual = readClienteJson(clienteId, "mensageiro-config.json", criarConfigPadraoMensageiro(clienteId));
  const atual = normalizarConfigAtendimentoCliente(clienteId, arquivoAtual);
  const payload = dados && typeof dados === "object" ? dados : {};
  const atualizado = normalizarConfigAtendimentoCliente(clienteId, {
    ...atual,
    ...payload,
    historico: payload.historico === undefined ? atual.historico : payload.historico,
    atualizadoEm: new Date().toISOString()
  });

  try {
    writeClienteJson(clienteId, "mensageiro-config.json", {
      ...arquivoAtual,
      atendimento: {
        ...(arquivoAtual.atendimento && typeof arquivoAtual.atendimento === "object" ? arquivoAtual.atendimento : {}),
        ...atualizado,
        sessaoId: atualizado.sessaoAtendimentoId,
        sessaoAtendimentoId: atualizado.sessaoAtendimentoId
      },
      atendimentoAtivo: atualizado.atendimentoAtivo,
      sessaoAtendimentoId: atualizado.sessaoAtendimentoId,
      atualizadoEm: new Date().toISOString()
    });
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao persistir atendimento:", e.message);
  }

  return atualizado;
}

function registrarHistoricoAtendimento(clienteId, evento = {}) {
  const atual = getAtendimentoConfigCliente(clienteId);
  return setAtendimentoConfigCliente(clienteId, {
    historico: [
      ...atual.historico,
      {
        id: evento.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        data: evento.data || new Date().toISOString(),
        ...evento
      }
    ].slice(-HISTORICO_ATENDIMENTO_MAX)
  });
}

function criarChaveInfracaoGerente({
  clienteId = "",
  perfilId = "",
  sessaoId = "",
  grupoId = "",
  participante = "",
  regraId = ""
} = {}) {
  return [
    clienteIdSeguro(clienteId),
    String(perfilId || ""),
    String(sessaoId || ""),
    String(grupoId || ""),
    String(participante || ""),
    String(regraId || "")
  ].join(":");
}

function normalizarInfracaoGerente(infracao = {}, index = 0) {
  const raw = infracao && typeof infracao === "object" ? infracao : {};
  const clienteId = String(raw.clienteId || "");
  const perfilId = String(raw.perfilId || "");
  const sessaoId = String(raw.sessaoId || "");
  const grupoId = String(raw.grupoId || "");
  const participante = String(raw.participante || "");
  const regraId = String(raw.regraId || "");

  return {
    id: String(raw.id || criarChaveInfracaoGerente({ clienteId, perfilId, sessaoId, grupoId, participante, regraId }) || `infracao_${index}`),
    clienteId,
    perfilId,
    perfilNome: String(raw.perfilNome || ""),
    sessaoId,
    grupoId,
    grupoNome: String(raw.grupoNome || ""),
    participante,
    participanteNome: String(raw.participanteNome || ""),
    regraId,
    regraNome: String(raw.regraNome || ""),
    tipoRegra: String(raw.tipoRegra || ""),
    contador: Math.max(0, Number(raw.contador || 0) || 0),
    primeiraInfracaoEm: raw.primeiraInfracaoEm ? String(raw.primeiraInfracaoEm) : "",
    ultimaInfracaoEm: raw.ultimaInfracaoEm ? String(raw.ultimaInfracaoEm) : "",
    ultimoMotivo: String(raw.ultimoMotivo || ""),
    ultimaMensagemId: String(raw.ultimaMensagemId || ""),
    status: String(raw.status || "ativa"),
    removidoEm: raw.removidoEm ? String(raw.removidoEm) : "",
    resetEm: raw.resetEm ? String(raw.resetEm) : ""
  };
}

function lerArquivoInfracoesGerente(clienteId) {
  const dados = readClienteJson(clienteId, INFRACOES_GERENTE_FILE, { versao: 1, infracoes: [] });
  const infracoes = Array.isArray(dados.infracoes) ? dados.infracoes : [];
  return {
    versao: 1,
    infracoes: infracoes.map(normalizarInfracaoGerente)
  };
}

function salvarArquivoInfracoesGerente(clienteId, dados = {}) {
  const payload = {
    versao: 1,
    infracoes: Array.isArray(dados.infracoes)
      ? dados.infracoes.map(normalizarInfracaoGerente)
      : []
  };
  writeClienteJson(clienteId, INFRACOES_GERENTE_FILE, payload);
  return payload;
}

function listarInfracoesGerenteCliente(clienteId, filtro = {}) {
  const dados = lerArquivoInfracoesGerente(clienteId);
  return dados.infracoes.filter(infracao => {
    if (filtro.perfilId && infracao.perfilId !== filtro.perfilId) return false;
    if (filtro.grupoId && infracao.grupoId !== filtro.grupoId) return false;
    if (filtro.participante && infracao.participante !== filtro.participante) return false;
    if (filtro.regraId && infracao.regraId !== filtro.regraId) return false;
    return true;
  });
}

function registrarInfracaoGerente(clienteId, evento = {}, opcoes = {}) {
  const agora = new Date().toISOString();
  const resetDias = Math.max(1, Number(opcoes.resetInfracoesDias || 30) || 30);
  const chave = criarChaveInfracaoGerente({ clienteId, ...evento });
  const dados = lerArquivoInfracoesGerente(clienteId);
  const infracoes = dados.infracoes.filter(item => item.id !== chave);
  const existente = dados.infracoes.find(item => item.id === chave);
  const expirada = existente?.ultimaInfracaoEm
    ? Date.now() - new Date(existente.ultimaInfracaoEm).getTime() > resetDias * 24 * 60 * 60 * 1000
    : false;
  const base = expirada ? null : existente;
  const contador = Math.max(0, Number(base?.contador || 0) || 0) + 1;
  const atualizada = normalizarInfracaoGerente({
    ...(base || {}),
    ...evento,
    id: chave,
    clienteId,
    contador,
    primeiraInfracaoEm: base?.primeiraInfracaoEm || agora,
    ultimaInfracaoEm: agora,
    status: evento.status || "ativa",
    removidoEm: evento.removidoEm || base?.removidoEm || "",
    resetEm: expirada ? agora : base?.resetEm || ""
  });

  salvarArquivoInfracoesGerente(clienteId, {
    infracoes: [...infracoes, atualizada]
  });

  return atualizada;
}

function zerarInfracaoGerenteCliente(clienteId, filtro = {}) {
  const dados = lerArquivoInfracoesGerente(clienteId);
  const agora = new Date().toISOString();
  let alterou = false;
  const infracoes = dados.infracoes.map(infracao => {
    const corresponde =
      (!filtro.id || infracao.id === filtro.id) &&
      (!filtro.perfilId || infracao.perfilId === filtro.perfilId) &&
      (!filtro.grupoId || infracao.grupoId === filtro.grupoId) &&
      (!filtro.participante || infracao.participante === filtro.participante) &&
      (!filtro.regraId || infracao.regraId === filtro.regraId);
    if (!corresponde) return infracao;
    alterou = true;
    return normalizarInfracaoGerente({
      ...infracao,
      contador: 0,
      status: "zerada",
      resetEm: agora
    });
  });

  if (alterou) salvarArquivoInfracoesGerente(clienteId, { infracoes });
  return listarInfracoesGerenteCliente(clienteId, filtro);
}

function atualizarInfracaoGerenteCliente(clienteId, filtro = {}, patch = {}) {
  const dados = lerArquivoInfracoesGerente(clienteId);
  let alterou = false;
  const infracoes = dados.infracoes.map(infracao => {
    const corresponde =
      (!filtro.id || infracao.id === filtro.id) &&
      (!filtro.perfilId || infracao.perfilId === filtro.perfilId) &&
      (!filtro.grupoId || infracao.grupoId === filtro.grupoId) &&
      (!filtro.participante || infracao.participante === filtro.participante) &&
      (!filtro.regraId || infracao.regraId === filtro.regraId);
    if (!corresponde) return infracao;
    alterou = true;
    return normalizarInfracaoGerente({
      ...infracao,
      ...patch
    });
  });

  if (alterou) salvarArquivoInfracoesGerente(clienteId, { infracoes });
  return listarInfracoesGerenteCliente(clienteId, filtro);
}

function getMensageiroCliente(clienteId) {
  if (!mensageiroPorCliente[clienteId]) {
    mensageiroPorCliente[clienteId] =
      criarConfigPadraoMensageiro(clienteId);

    salvarMensageiro();
  }

  const normalizado = normalizarConfigMensageiro(
    clienteId,
    mensageiroPorCliente[clienteId]
  );

  const mudou = JSON.stringify(normalizado) !== JSON.stringify(mensageiroPorCliente[clienteId]);
  mensageiroPorCliente[clienteId] = normalizado;

  if (mudou) salvarMensageiro();

  return mensageiroPorCliente[clienteId];
}

function setMensageiroCliente(clienteId, dados = {}) {
  const atual = getMensageiroCliente(clienteId);
  if (dados.perfis !== undefined) validarPerfisMensageiro(dados.perfis);

  mensageiroPorCliente[clienteId] = normalizarConfigMensageiro(clienteId, {
    ...atual,
    ...dados,
    clienteId,
    atualizadoEm: new Date().toISOString()
  });

  salvarMensageiro();

  return mensageiroPorCliente[clienteId];
}

function listarClientesMensageiro() {
  return Object.keys(mensageiroPorCliente || {});
}

module.exports = {
  carregarMensageiro,
  salvarMensageiro,
  getMensageiroCliente,
  setMensageiroCliente,
  listarClientesMensageiro,
  getAtendimentoConfigCliente,
  setAtendimentoConfigCliente,
  registrarHistoricoAtendimento,
  normalizarConfigAtendimentoCliente,
  normalizarProgramacoesMensageiro,
  normalizarPerfisMensageiro,
  normalizarConfiguracaoGerente,
  listarInfracoesGerenteCliente,
  registrarInfracaoGerente,
  zerarInfracaoGerenteCliente,
  atualizarInfracaoGerenteCliente,
  validarPerfisMensageiro,
  criarPerfilLegadoVirtual,
  resolverPerfilMensageiro,
  MAX_PERFIS_MENSAGEIRO,
  PERFIL_LEGADO_ID
};
